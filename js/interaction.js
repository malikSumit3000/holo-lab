// Gesture engine: turns hands (or the mouse) into grabbing, throwing, spinning, resizing,
// exploding, pulling parts out, disintegrating and light-pen sculpting.
import * as THREE from 'three';
import { analyzeHand, HAND_CONNECTIONS } from './hands.js';
import { createSculpture, strokeGeometry, dotTexture } from './objects.js';
import { COLORS, glowMaterial, glowLineMaterial, clamp } from './holo.js';
import { CONFIG as C } from './config.js';
import { OneEuro, OneEuro2D } from './filters.js';

const PEN_COLORS = [COLORS.magenta, COLORS.gold, COLORS.green, COLORS.cyan, COLORS.red];
const OBJECT_COLOR = { planet: COLORS.cyan, reactor: COLORS.cyan, assembly: COLORS.gold, dna: COLORS.magenta, hypercube: COLORS.magenta };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const deadzone = (v, dz) => Math.sign(v) * Math.max(0, Math.abs(v) - dz);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

class Pointer {
  constructor(id, kind, cursorEl = null) {
    this.id = id;
    this.kind = kind;              // 'hand' | 'mouse'
    this.cursorEl = cursorEl;
    this.present = false;
    this.lastSeen = -1;
    this.screen = { x: 0, y: 0 };
    this.palmScreen = { x: 0, y: 0 };
    this.prevPalmScreen = null;
    this.palmVel = new THREE.Vector2();   // px / s
    this.ndc = new THREE.Vector2();
    this.depth = 0;
    this.roll = 0;                 // unwrapped (continuous) hand twist angle
    this.pinching = false;
    this.pinchStarted = false;
    this.pinchEnded = false;
    this.releaseSince = null;
    this.open = false;
    this.fist = false;
    this.lmScreen = null;          // [{x,y,z}] for the skeleton
    this.state = 'idle';           // idle | grab | pull | draw | press
    this.grab = null;
    this.pull = null;
    this.hoverObj = null;
    this.hoverPart = null;
    this.hoverButton = null;
    this.fistObj = null;
    this.fistTime = 0;
    this.stroke = null;
    // One Euro filters
    this.fCursor = new OneEuro2D();
    this.fPalm = new OneEuro2D();
    this.fDepth = new OneEuro();
    this.fRoll = new OneEuro();
    this.fLm = Array.from({ length: 21 }, () => new OneEuro2D());
    this.rollRawPrev = null;
    this.rollUnwrapped = 0;
    // finger gun (Holo Shooter)
    this.gunPose = false;
    this.thumbDown = false;
    this.cocked = false;
    this.fire = false;             // one-shot event, consumed by the game
    this.fireAim = null;           // aim from just before the trigger pull (trigger jerk removed)
    this.lastShot = -1;
    this.aim = { x: 0, y: 0 };
    this.aimHist = [];
    this.fAim = new OneEuro2D();
  }

  resetFilters() {
    this.fAim.reset(); this.aimHist = [];
    this.pitchPrev = undefined; this.pitchT = undefined; this.pitchVel = 0; this.flickArmed = false;
    this.fCursor.reset(); this.fPalm.reset(); this.fDepth.reset(); this.fRoll.reset();
    this.fLm.forEach((f) => f.reset());
    this.rollRawPrev = null;
  }

  setPinch(on) {
    if (on && !this.pinching) this.pinchStarted = true;
    if (!on && this.pinching) this.pinchEnded = true;
    this.pinching = on;
  }
}

export class Interaction {
  constructor({ scene, camera, objects, particles, sfx, toast, onSpawn, onClear }) {
    this.scene = scene;
    this.camera = camera;
    this.objects = objects;
    this.particles = particles;
    this.sfx = sfx;
    this.toast = toast;
    this.onSpawn = onSpawn;
    this.onClear = onClear;
    this.focus = null;             // FocusManager, set by main
    this.mode = 'lab';             // 'lab' | 'game'
    this.penMode = false;
    this.penColor = 0;
    this.mapping = { sx: 1, sy: 1 };
    this.hands = [
      new Pointer(0, 'hand', document.getElementById('cursor0')),
      new Pointer(1, 'hand', document.getElementById('cursor1')),
    ];
    this.mouse = new Pointer(2, 'mouse');
    this.pointers = [...this.hands, this.mouse];
    this.visuals = this.hands.map(() => this._makeHandVisual());
    this._bindMouse();
  }

  // ======================================================================
  // Input: hands
  // ======================================================================
  setHandResults(result, vw, vh, nowS) {
    const world = result.worldLandmarks || [];
    const detected = (result.landmarks || []).map((lm, i) => analyzeHand(lm, vw, vh, world[i]));
    const free = new Set(this.hands);
    // keep each physical hand in the same slot: match by closeness to where the slot was last seen
    const assignments = [];
    for (const f of detected) {
      const s = this._toScreen(f.pinch);
      let best = null, bestD = 260;
      for (const p of free) {
        if (!p.present) continue;
        const d = Math.hypot(p.screen.x - s.x, p.screen.y - s.y);
        if (d < bestD) { best = p; bestD = d; }
      }
      if (best) { free.delete(best); assignments.push([best, f]); } else assignments.push([null, f]);
    }
    for (const a of assignments) {
      if (!a[0]) { const p = [...free][0]; if (!p) continue; free.delete(p); a[0] = p; }
      this._updateHandPointer(a[0], a[1], nowS);
    }
  }

  _toScreen(pt) {
    // raw video coords -> mirrored -> cropped like the background ("cover") -> pixels
    const sx = Number.isFinite(this.mapping.sx) && this.mapping.sx > 0 ? this.mapping.sx : 1;
    const sy = Number.isFinite(this.mapping.sy) && this.mapping.sy > 0 ? this.mapping.sy : 1;
    const u = ((1 - pt.x) - 0.5) / sx + 0.5;
    const v = (pt.y - 0.5) / sy + 0.5;
    return { x: u * innerWidth, y: v * innerHeight };
  }

  _updateHandPointer(p, f, t) {
    if (!p.present) p.resetFilters();
    p.present = true;
    p.lastSeen = t;
    const mc = C.smoothing, beta = C.responsiveness;

    const s = this._toScreen(f.pinch);
    p.fCursor.filter(s.x, s.y, t, mc, beta, p.screen);
    const pc = this._toScreen(f.palmCenter);
    p.fPalm.filter(pc.x, pc.y, t, mc, beta, p.palmScreen);

    const depthRaw = C.zFar + clamp((f.palmSize - C.depthFar) / (C.depthNear - C.depthFar), 0, 1) * (C.zNear - C.zFar);
    p.depth = p.fDepth.filter(depthRaw, t, mc * 0.6, beta * 60);

    // unwrap the twist angle so turning past +-180 degrees doesn't jump
    if (p.rollRawPrev === null) p.rollUnwrapped = f.roll;
    else p.rollUnwrapped += wrapAngle(f.roll - p.rollRawPrev);
    p.rollRawPrev = f.roll;
    p.roll = p.fRoll.filter(p.rollUnwrapped, t, mc, beta * 40);

    // sticky pinch: starts instantly, ends only after staying open for pinchReleaseMs
    if (!p.pinching) {
      if (f.pinchRatio < C.pinchOn && f.indexReach > C.minIndexReach) { p.setPinch(true); p.releaseSince = null; }
    } else if (f.pinchRatio > C.pinchOff) {
      if (p.releaseSince === null) p.releaseSince = t;
      if ((t - p.releaseSince) * 1000 >= C.pinchReleaseMs) { p.setPinch(false); p.releaseSince = null; }
    } else p.releaseSince = null;

    const nExt = f.extended.filter(Boolean).length;
    p.open = nExt === 4 && f.pinchRatio > 0.6;
    p.fist = nExt === 0 && !p.pinching && f.indexReach < C.minIndexReach;
    p.lmScreen = f.lm.map((l, i) => {
      const q = this._toScreen(l);
      const o = p.fLm[i].filter(q.x, q.y, t, mc, beta);
      return { x: o.x, y: o.y, z: l.z };
    });

    // ---- finger gun ----
    // Aim = the index KNUCKLE (steady, doesn't move when the thumb or finger twitches), amplified around
    // the screen centre so small hand moves cover the screen, plus the finger's real 3-D pointing direction.
    const knuckle = this._toScreen(f.lm[5]);
    const cx = innerWidth / 2, cy = innerHeight / 2, reach = Math.max(innerWidth, innerHeight) * 0.5;
    const rawX = cx + (knuckle.x - cx) * C.aimGain + (-f.pointDir.x) * C.aimPoint * reach;   // mirrored
    const rawY = cy + (knuckle.y - cy) * C.aimGain + (f.pointDir.y) * C.aimPoint * reach;
    p.fAim.filter(clamp(rawX, 0, innerWidth), clamp(rawY, 0, innerHeight), t, C.aimSmoothing, C.aimResponsiveness, p.aim);
    p.aimHist.push({ t, x: p.aim.x, y: p.aim.y });
    while (p.aimHist.length > 2 && t - p.aimHist[0].t > 0.2) p.aimHist.shift();
    p.gunPose = f.gunPose;
    p.thumbRatio = f.thumbRatio;

    const shoot = (why) => {
      if (!f.gunPose || t - p.lastShot < C.fireDebounce) return;
      p.fire = true;
      p.fireWhy = why;
      p.lastShot = t;
      // aim from ~100 ms before the trigger, so the trigger motion itself doesn't throw the shot off
      const before = p.aimHist.find((a) => t - a.t <= 0.1) || p.aimHist[p.aimHist.length - 1];
      p.fireAim = { x: before.x, y: before.y };
    };

    // Fire method 1 - thumb hammer: cocked (thumb out) -> down (thumb against the index)
    const wasCocked = p.cocked;
    const up = Math.max(C.thumbUpT, C.thumbDownT + 0.08);
    if (p.thumbDown) { if (f.thumbRatio > up) p.thumbDown = false; }
    else if (f.thumbRatio < C.thumbDownT) {
      p.thumbDown = true;
      if (wasCocked && C.fireMode !== 'flick') shoot('thumb');
    }
    p.cocked = f.gunPose && !p.thumbDown;

    // Fire method 2 - recoil flick: the finger snaps upward quickly (like a gun kicking)
    const pitch = Math.atan2(-f.pointDir.y, Math.hypot(f.pointDir.x, f.pointDir.z));
    if (p.pitchPrev !== undefined && p.pitchT !== undefined && t > p.pitchT) {
      const v = (pitch - p.pitchPrev) / (t - p.pitchT);
      p.pitchVel = (p.pitchVel || 0) * 0.3 + v * 0.7;
    }
    p.pitchPrev = pitch;
    p.pitchT = t;
    if (p.flickArmed === undefined) p.flickArmed = true;
    if (p.flickArmed && p.pitchVel > C.flickSpeed && C.fireMode !== 'thumb') { shoot('flick'); p.flickArmed = false; }
    else if (!p.flickArmed && Math.abs(p.pitchVel) < 1.5) p.flickArmed = true;
  }

  // ======================================================================
  // Input: mouse (fallback / testing): left = pinch, right-drag = spin, wheel = depth/resize/explode
  // ======================================================================
  _bindMouse() {
    const m = this.mouse;
    const move = (e) => { m.present = true; m.lastSeen = performance.now() / 1000; m.screen.x = m.palmScreen.x = e.clientX; m.screen.y = m.palmScreen.y = e.clientY; };
    addEventListener('mousemove', move);
    addEventListener('mousedown', (e) => {
      if (e.target.closest && e.target.closest('#boot, #tuning, #testpanel, #cmdbar input')) return;
      move(e);
      if (e.button === 0) m.setPinch(true);
      if (e.button === 2) m.open = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) m.setPinch(false); if (e.button === 2) m.open = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mouseleave', () => { m.present = false; });
    addEventListener('wheel', (e) => {
      if (e.target.closest && e.target.closest('#tuning')) return;
      const d = e.deltaY;
      if (m.state === 'grab' && m.grab) { m.depth = clamp(m.depth - d * 0.01, C.zFar - 3, C.zNear); return; }
      const obj = m.hoverObj;
      if (!obj) return;
      if (obj.explodable) obj.explodeTarget = clamp(obj.explodeTarget - d * 0.0015, 0, 1);
      else obj.baseScale = clamp(obj.baseScale * Math.exp(-d * 0.0012), 0.35, 3.5);
    }, { passive: true });
  }

  /** Clear all hand/mouse state (used by the test harness). */
  resetPointers() {
    for (const p of this.pointers) {
      if (p.state === 'grab') this._endGrab(p, performance.now() / 1000);
      if (p.state === 'pull') this._endPull(p, false);
      if (p.state === 'draw') this._endStroke(p);
      p.state = 'idle'; p.present = false; p.pinching = false; p.pinchStarted = p.pinchEnded = false;
      p.open = p.fist = false; p.grab = p.pull = p.stroke = null; p.hoverObj = p.hoverPart = p.hoverButton = null;
      p.releaseSince = null; p.resetFilters();
    }
  }

  // ======================================================================
  // Geometry helpers
  // ======================================================================
  screenToNdc(sx, sy, out = new THREE.Vector2()) {
    return out.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
  }

  /** World point under a screen position, on the plane z = const. */
  unprojectAtZ(ndc, z, out = new THREE.Vector3()) {
    const cam = this.camera;
    out.set(ndc.x, ndc.y, 0.5).unproject(cam).sub(cam.position).normalize();
    const t = (z - cam.position.z) / out.z;
    return out.multiplyScalar(t).add(cam.position);
  }

  /** Object under a screen point (screen-space test with a magnetic margin). */
  pick(sx, sy) {
    const cam = this.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    let best = null, bestScore = Infinity;
    for (const o of this.objects) {
      if (!o.pickable) continue;
      const c = o.group.position.clone().project(cam);
      if (c.z > 1) continue;
      const e = o.group.position.clone().addScaledVector(right, o.worldRadius).project(cam);
      const cx = (c.x + 1) / 2 * innerWidth, cy = (1 - c.y) / 2 * innerHeight;
      const rpx = Math.max(30, Math.abs((e.x - c.x) / 2 * innerWidth));
      const lim = rpx * C.grabMagnet + 15;
      const d = Math.hypot(sx - cx, sy - cy);
      const score = d / lim - o.group.position.z * 0.02;
      if (d < lim && score < bestScore) { best = o; bestScore = score; }
    }
    return best;
  }

  _buttonAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest('#dock button, #crumbs button, #cmdbar button') : null;
  }

  // ======================================================================
  // Per-frame update
  // ======================================================================
  update(dt, nowS) {
    for (const p of this.hands) {
      if (p.present && nowS - p.lastSeen > C.handLostGrace) {
        p.present = false;
        if (p.pinching) p.setPinch(false);
        p.open = p.fist = false;
      }
    }

    for (const p of this.pointers) {
      // palm velocity (for swipes); big jumps are tracking glitches, not swipes
      if (p.present) {
        if (p.prevPalmScreen && dt > 0) {
          const jx = p.palmScreen.x - p.prevPalmScreen.x, jy = p.palmScreen.y - p.prevPalmScreen.y;
          if (Math.hypot(jx, jy) > 220) p.palmVel.set(0, 0);
          else { p.palmVel.x += (jx / dt - p.palmVel.x) * 0.4; p.palmVel.y += (jy / dt - p.palmVel.y) * 0.4; }
        }
        p.prevPalmScreen = { ...p.palmScreen };
      } else { p.prevPalmScreen = null; p.palmVel.set(0, 0); }

      this.screenToNdc(p.screen.x, p.screen.y, p.ndc);
      if (this.mode === 'game') continue;          // the game reads the pointers itself

      if (p.present && p.state === 'idle') {
        const btn = this._buttonAt(p.screen.x, p.screen.y);
        if (btn !== p.hoverButton) { if (btn) this.sfx.hover(); p.hoverButton = btn; }
        const obj = btn ? null : this.pick(p.screen.x, p.screen.y);
        const part = obj && obj.pickPart ? obj.pickPart(p.screen.x, p.screen.y, this.camera) : null;
        if ((obj !== p.hoverObj || part !== p.hoverPart) && (obj || part)) this.sfx.hover();
        p.hoverObj = obj;
        p.hoverPart = part;
      } else if (!p.present) { p.hoverObj = null; p.hoverPart = null; p.hoverButton = null; }

      if (p.pinchStarted) this._onPinchStart(p);
      if (p.pinchEnded) this._onPinchEnd(p, nowS);
      p.pinchStarted = p.pinchEnded = false;

      if (p.state === 'grab') this._updateGrab(p, dt, nowS);
      if (p.state === 'pull') this._updatePull(p);
      if (p.state === 'draw') this._updateStroke(p);
      if (p.present && p.state === 'idle') { this._palmSpin(p, dt); this._fistDestroy(p, dt); }
    }

    if (this.mode === 'game') { this._updateCursors(); this._updateHandVisuals(); return; }

    // highlights + info card
    const active = this.pointers.filter((p) => p.present);
    const hovered = new Set(active.map((p) => p.hoverObj).filter(Boolean));
    for (const o of this.objects) o.setHover(o.pickable && (hovered.has(o) || o.held));
    if (this.focus) {
      const hp = active.find((p) => p.state === 'pull')?.pull?.part || active.find((p) => p.hoverPart)?.hoverPart || null;
      this.focus.setHoverPart(hp);
    }
    document.querySelectorAll('#dock button, #crumbs button, #cmdbar button').forEach((b) => b.classList.toggle('hover', this.pointers.some((p) => p.present && p.kind === 'hand' && p.hoverButton === b)));

    this._physics(dt);
    this._updateCursors();
    this._updateHandVisuals();
  }

  // ---------------- pinch start / end ----------------
  _onPinchStart(p) {
    if (p.hoverButton) { p.state = 'press'; this._press(p.hoverButton); return; }
    // second hand pinching while the other hand holds something -> two-hand mode on that object
    const other = this.pointers.find((q) => q !== p && q.state === 'grab' && q.grab && q.kind === 'hand' && p.kind === 'hand');
    if (other && (!p.hoverObj || p.hoverObj === other.grab.obj)) { this._startGrab(p, other.grab.obj); return; }
    // the other hand is pulling a part: switch both hands to holding the whole object (explode / collapse)
    const puller = this.pointers.find((q) => q !== p && q.state === 'pull' && q.pull && q.kind === 'hand' && p.kind === 'hand');
    if (puller && (!p.hoverObj || p.hoverObj === puller.pull.obj)) {
      const obj = puller.pull.obj;
      this._endPull(puller, false);
      this._startGrab(puller, obj);
      this._startGrab(p, obj);
      return;
    }
    if (p.hoverPart && p.hoverObj) { this._startPull(p, p.hoverObj, p.hoverPart); return; }
    if (p.hoverObj) { this._startGrab(p, p.hoverObj); return; }
    if (this.penMode) this._startStroke(p);
  }

  _onPinchEnd(p, nowS) {
    if (p.state === 'grab') this._endGrab(p, nowS);
    else if (p.state === 'pull') this._endPull(p, true);
    else if (p.state === 'draw') this._endStroke(p);
    p.state = 'idle';
  }

  _press(btn) {
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 180);
    this.sfx.press();
    if (btn.dataset.cmd !== undefined) { if (this.onCommand) this.onCommand(btn.dataset.cmd); return; }
    if (btn.dataset.level !== undefined) {
      if (!this.focus) return;
      if (btn.dataset.level === 'back') this.focus.back();
      else this.focus.backTo(Number(btn.dataset.level));
      return;
    }
    const a = btn.dataset.action;
    if (a === 'voice') { if (this.onCommand) this.onCommand('mic'); return; }
    if (a === 'pen') this.togglePen();
    else if (a === 'clear') this.onClear();
    else this.onSpawn(a);
  }

  togglePen(force) {
    this.penMode = force ?? !this.penMode;
    document.getElementById('btn-pen').classList.toggle('active', this.penMode);
    this.toast(this.penMode ? 'LIGHT PEN ON - pinch in empty space to draw' : 'LIGHT PEN OFF');
  }

  /** Drop anything any pointer is holding of this object (used before it flies away or is removed). */
  releaseObject(obj) {
    for (const p of this.pointers) {
      if (p.grab && p.grab.obj === obj) { p.grab = null; p.state = 'idle'; }
      if (p.pull && p.pull.obj === obj) { p.pull.part.pulling = false; p.pull = null; p.state = 'idle'; }
      if (p.hoverObj === obj) { p.hoverObj = null; p.hoverPart = null; }
    }
    obj.heldBy.clear();
    delete obj.two;
  }

  // ---------------- grab / move / throw ----------------
  _startGrab(p, obj) {
    p.state = 'grab';
    obj.heldBy.add(p.id);
    obj.velocity.set(0, 0, 0);
    obj.angVel.multiplyScalar(0.2);
    obj.flashNow(0.3);
    this.sfx.grab();
    this._initSingle(p, obj);
    if (obj.heldBy.size === 2) this._initTwoHand(obj);
  }

  _initSingle(p, obj) {
    const z0 = obj.group.position.z;
    const under = this.unprojectAtZ(this.screenToNdc(p.screen.x, p.screen.y), z0);
    p.grab = {
      obj, z0, depth0: p.depth, roll0: p.roll,
      offset: obj.group.position.clone().sub(under),
      quat0: obj.group.quaternion.clone(),
      hist: [],
    };
  }

  _holders(obj) { return this.pointers.filter((q) => q.state === 'grab' && q.grab && q.grab.obj === obj); }

  _initTwoHand(obj) {
    const [a, b] = this._holders(obj);
    if (!a || !b) return;
    const mid = this.unprojectAtZ(this.screenToNdc((a.screen.x + b.screen.x) / 2, (a.screen.y + b.screen.y) / 2), obj.group.position.z);
    obj.two = {
      dist0: Math.max(40, Math.hypot(b.screen.x - a.screen.x, b.screen.y - a.screen.y)),
      angle0: Math.atan2(-(b.screen.y - a.screen.y), b.screen.x - a.screen.x),
      scale0: obj.baseScale,
      explode0: obj.explodeTarget,
      quat0: obj.group.quaternion.clone(),
      offset: obj.group.position.clone().sub(mid),
    };
  }

  _updateGrab(p, dt, nowS) {
    const g = p.grab;
    if (!g || g.obj.dying || g.obj.fly) { p.state = 'idle'; p.grab = null; return; }
    const obj = g.obj;
    const holders = this._holders(obj);

    if (holders.length >= 2 && obj.two) {
      if (holders[0] !== p) return;                       // the first holder drives two-hand mode
      const [a, b] = holders;
      const t = obj.two;
      const d = Math.max(1, Math.hypot(b.screen.x - a.screen.x, b.screen.y - a.screen.y));
      const ratio = d / t.dist0;
      if (obj.explodable) {
        const before = obj.explodeTarget;
        obj.explodeTarget = clamp(t.explode0 + (ratio - 1) * 0.9, 0, 1);
        if (before < 0.5 && obj.explodeTarget >= 0.5) this.sfx.explode();
      } else {
        obj.baseScale = clamp(t.scale0 * ratio, 0.35, 3.5);
      }
      const ang = Math.atan2(-(b.screen.y - a.screen.y), b.screen.x - a.screen.x);
      const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, wrapAngle(ang - t.angle0));
      obj.group.quaternion.copy(t.quat0).premultiply(q);
      const mid = this.unprojectAtZ(this.screenToNdc((a.screen.x + b.screen.x) / 2, (a.screen.y + b.screen.y) / 2), obj.group.position.z);
      obj.group.position.lerp(mid.add(t.offset), 1 - Math.exp(-18 * dt));
      return;
    }

    // single hand: move (x, y from cursor; z from pushing/pulling the hand), twist to rotate
    const z = clamp(g.z0 + deadzone(p.depth - g.depth0, p.kind === 'hand' ? C.depthDeadzone : 0) * (p.kind === 'hand' ? C.depthGain : 1), -9, 3);
    const target = this.unprojectAtZ(this.screenToNdc(p.screen.x, p.screen.y), z).add(g.offset);
    obj.group.position.lerp(target, 1 - Math.exp(-30 * dt));
    if (p.kind === 'hand') {
      const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, deadzone(p.roll - g.roll0, C.twistDeadzone) * C.twistGain);
      obj.group.quaternion.copy(g.quat0).premultiply(q);
    }
    g.hist.push({ t: nowS, pos: obj.group.position.clone() });
    while (g.hist.length > 2 && nowS - g.hist[0].t > 0.12) g.hist.shift();
  }

  _endGrab(p, nowS) {
    const g = p.grab;
    p.grab = null;
    if (!g) return;
    const obj = g.obj;
    obj.heldBy.delete(p.id);
    const remaining = this._holders(obj).filter((q) => q !== p);
    if (remaining.length) {                    // other hand keeps holding: back to one-hand mode
      delete obj.two;
      this._initSingle(remaining[0], obj);
      this.sfx.release();
      return;
    }
    delete obj.two;
    const h = g.hist;
    if (h.length >= 2) {
      const span = h[h.length - 1].t - h[0].t;
      if (span > 0.02) {
        obj.velocity.copy(h[h.length - 1].pos).sub(h[0].pos).divideScalar(span);
        if (obj.velocity.length() > 22) obj.velocity.setLength(22);
      }
    }
    const speed = obj.velocity.length();
    if (speed > 3) {
      this.sfx.throw();
      obj.angVel.y += obj.velocity.x * 0.25;
      obj.angVel.x -= obj.velocity.y * 0.25;
    } else {
      obj.velocity.multiplyScalar(0.3);
      this.sfx.release();
    }
  }

  // ---------------- pull a part out of an exploded object ----------------
  _startPull(p, obj, part) {
    p.state = 'pull';
    part.pulling = true;
    const start = obj.partWorldCenter(part);
    const under = this.unprojectAtZ(this.screenToNdc(p.screen.x, p.screen.y), start.z);
    p.pull = { obj, part, z: start.z, offset: start.sub(under) };
    obj.flashNow(0.15);
    this.sfx.grab();
  }

  _updatePull(p) {
    const pl = p.pull;
    if (!pl || pl.obj.dying || !pl.obj.pickable) { if (pl) pl.part.pulling = false; p.pull = null; p.state = 'idle'; return; }
    const target = this.unprojectAtZ(this.screenToNdc(p.screen.x, p.screen.y), pl.z).add(pl.offset);
    pl.obj.setPartWorldCenter(pl.part, target);
  }

  _endPull(p, allowDrill) {
    const pl = p.pull;
    p.pull = null;
    if (!pl) return;
    const { obj, part } = pl;
    const dist = obj.partWorldCenter(part).distanceTo(obj.partSlotWorldCenter(part));
    part.pulling = false;
    if (allowDrill && this.focus && dist > C.pullDrillDist) this.focus.drill(obj, part);
    else this.sfx.release();                  // snaps back into its slot
  }

  // ---------------- open palm spin ----------------
  _palmSpin(p, dt) {
    if (!p.open) return;
    const obj = this.pick(p.palmScreen.x, p.palmScreen.y);
    if (!obj || obj.held) return;
    const vx = p.palmVel.x / innerWidth, vy = p.palmVel.y / innerHeight;   // screens per second
    if (Math.abs(vx) + Math.abs(vy) < 0.15) return;
    obj.angVel.y = clamp(obj.angVel.y + vx * 40 * dt, -14, 14);
    obj.angVel.x = clamp(obj.angVel.x + vy * 40 * dt, -14, 14);
  }

  // ---------------- fist hold = disintegrate ----------------
  _fistDestroy(p, dt) {
    const obj = p.fist ? this.pick(p.palmScreen.x, p.palmScreen.y) : null;
    if (!obj || obj.held) { p.fistObj = null; p.fistTime = 0; return; }
    if (obj !== p.fistObj) { p.fistObj = obj; p.fistTime = 0; }
    p.fistTime += dt;
    if (p.fistTime >= C.fistHold) { this.destroy(obj); p.fistObj = null; p.fistTime = 0; }
  }

  destroy(obj) {
    if (obj.dying) return;
    if (this.focus && this.focus.isFocusObject(obj)) { this.toast('USE BACK TO LEAVE THIS PART FIRST'); return; }
    obj.dying = true;
    this.releaseObject(obj);
    this.particles.burst(obj.group.position, OBJECT_COLOR[obj.type] || COLORS.cyan, 900, 6, obj.worldRadius * 2);
    this.sfx.destroy();
  }

  // ---------------- light pen ----------------
  _startStroke(p) {
    p.state = 'draw';
    const color = PEN_COLORS[this.penColor % PEN_COLORS.length];
    this.penColor++;
    p.stroke = { color, points: [this._penPoint(p)], mesh: null, mat: null };
    this.sfx.penStart();
  }

  _penPoint(p) {
    const z = p.kind === 'hand' ? clamp(p.depth, -4, 2.5) : 0;
    return this.unprojectAtZ(this.screenToNdc(p.screen.x, p.screen.y), z);
  }

  _updateStroke(p) {
    const s = p.stroke;
    if (!s) return;
    const pt = this._penPoint(p);
    if (pt.distanceTo(s.points[s.points.length - 1]) < 0.05 || s.points.length > 500) return;
    s.points.push(pt);
    if (s.mesh) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); }
    else s.mat = glowMaterial(s.color, 2.2);
    s.mesh = new THREE.Mesh(strokeGeometry(s.points, 0.035), s.mat);
    this.scene.add(s.mesh);
  }

  _endStroke(p) {
    const s = p.stroke;
    p.stroke = null;
    if (!s) return;
    if (s.mesh) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mat.dispose(); }
    if (s.points.length >= 4) {
      const obj = createSculpture(s.points, s.color);
      this.scene.add(obj.group);
      this.objects.push(obj);
      this.sfx.penEnd();
    }
  }

  // ---------------- physics for free objects ----------------
  _physics(dt) {
    const cam = this.camera;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const drag = Math.exp(-0.9 * dt), spinDrag = Math.exp(-0.45 * dt);
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const o of this.objects) {
      if (o.fly) continue;
      const pos = o.group.position;
      if (!o.held) {
        pos.addScaledVector(o.velocity, dt);
        o.velocity.multiplyScalar(drag);
        const halfH = tanHalf * (cam.position.z - pos.z), halfW = halfH * cam.aspect;
        const r = o.worldRadius * 0.7;
        const bounce = (axis, lim) => {
          if (Math.abs(pos[axis]) > lim - r) {
            pos[axis] = Math.sign(pos[axis]) * (lim - r);
            if (Math.sign(o.velocity[axis]) === Math.sign(pos[axis])) {
              if (Math.abs(o.velocity[axis]) > 1.5) { this.sfx.bounce(); o.flashNow(0.25); }
              o.velocity[axis] *= -0.65;
            }
          }
        };
        if (halfW > r) bounce('x', halfW);
        if (halfH > r) bounce('y', halfH);
        if (pos.z < -9) { pos.z = -9; o.velocity.z = Math.abs(o.velocity.z) * 0.6; }
        if (pos.z > 3) { pos.z = 3; o.velocity.z = -Math.abs(o.velocity.z) * 0.6; }
      }
      if (o.angVel.lengthSq() > 1e-6) {
        q.setFromEuler(e.set(o.angVel.x * dt, o.angVel.y * dt, o.angVel.z * dt));
        o.group.quaternion.premultiply(q);
        o.angVel.multiplyScalar(spinDrag);
      }
    }
  }

  // ---------------- cursors + hand skeletons ----------------
  _updateCursors() {
    for (const p of this.hands) {
      const el = p.cursorEl;
      if (!el) continue;
      el.style.display = p.present && this.mode !== 'game' ? 'block' : 'none';
      if (!p.present || this.mode === 'game') continue;
      el.style.transform = `translate(${p.screen.x}px, ${p.screen.y}px)`;
      let text = '';
      if (p.state === 'grab' && p.grab) text = p.grab.obj.two ? (p.grab.obj.explodable ? 'EXPLODE VIEW' : 'RESIZE / ROTATE') : p.grab.obj.name;
      else if (p.state === 'pull' && p.pull) text = `${p.pull.part.def.name.toUpperCase()} - PULL OUT`;
      else if (p.state === 'draw') text = 'SCULPTING';
      else if (p.fist && p.fistObj) text = 'DISINTEGRATE...';
      else if (p.hoverPart) text = p.hoverPart.def.name.toUpperCase();
      else if (p.hoverObj) text = p.hoverObj.name;
      else if (p.hoverButton) text = p.hoverButton.textContent.replace(/^\W+/, '').trim();
      el.classList.toggle('hover', !!(p.hoverObj || p.hoverButton || p.state === 'grab' || p.state === 'pull'));
      el.classList.toggle('pinch', p.pinching);
      el.classList.toggle('palm', p.open && !p.pinching);
      el.classList.toggle('fist', p.fist && !!p.fistObj);
      el.classList.toggle('pen', this.penMode && p.state !== 'grab' && !p.hoverObj);
      el.style.setProperty('--p', (p.fistTime / C.fistHold).toFixed(3));
      el.style.setProperty('--pen', `#${PEN_COLORS[this.penColor % PEN_COLORS.length].getHexString()}`);
      el.querySelector('.tag').textContent = text;
    }
  }

  _makeHandVisual() {
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
    const points = new THREE.Points(ptsGeo, new THREE.PointsMaterial({
      color: new THREE.Color(0.6, 1.6, 2.0), size: 0.13, map: dotTexture(), transparent: true,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HAND_CONNECTIONS.length * 6), 3));
    const lines = new THREE.LineSegments(lineGeo, glowLineMaterial(COLORS.cyan, 0.7, 1.3));
    lines.material.depthTest = false;
    points.renderOrder = lines.renderOrder = 20;
    points.frustumCulled = lines.frustumCulled = false;
    points.visible = lines.visible = false;
    this.scene.add(points, lines);
    return { points, lines };
  }

  _updateHandVisuals() {
    const ndc = new THREE.Vector2();
    this.hands.forEach((p, i) => {
      const v = this.visuals[i];
      const show = p.present && p.lmScreen;
      v.points.visible = v.lines.visible = !!show;
      if (!show) return;
      const zBase = clamp(p.depth, -4, 2.5);
      const world = p.lmScreen.map((l) => this.unprojectAtZ(this.screenToNdc(l.x, l.y, ndc), zBase - l.z * 6, new THREE.Vector3()));
      const pp = v.points.geometry.attributes.position.array;
      world.forEach((q, j) => pp.set([q.x, q.y, q.z], j * 3));
      const lp = v.lines.geometry.attributes.position.array;
      HAND_CONNECTIONS.forEach(([a, b], j) => { lp.set([world[a].x, world[a].y, world[a].z], j * 6); lp.set([world[b].x, world[b].y, world[b].z], j * 6 + 3); });
      v.points.geometry.attributes.position.needsUpdate = true;
      v.lines.geometry.attributes.position.needsUpdate = true;
      const c = p.pinching ? COLORS.gold : (this.penMode ? PEN_COLORS[this.penColor % PEN_COLORS.length] : COLORS.cyan);
      v.lines.material.color.copy(c).multiplyScalar(1.3);
    });
  }

  get handCount() { return this.hands.filter((p) => p.present).length; }
}
