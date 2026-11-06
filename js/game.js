// Holo Shooter: finger-gun shooting gallery against holographic drones.
//   aim  = index finger            fire   = drop your thumb (like a hammer)
//   open palm (other hand) = shield        fist = reload
// Mouse: move = aim, click = fire, right button = shield, R = reload.
import * as THREE from 'three';
import { holoMesh, holoMaterial, glowMaterial, glowLineMaterial, COLORS, clamp, damp } from './holo.js';
import { CONFIG as C } from './config.js';

const ENEMY = {
  basic: new THREE.Color(1.0, 0.32, 0.25),
  armored: new THREE.Color(1.0, 0.62, 0.15),
  boss: new THREE.Color(1.0, 0.25, 0.65),
};
const POINTS = { basic: 100, armored: 250, boss: 2500 };
const SIZE = { basic: 1, armored: 1.2, boss: 2.3 };
const PLAYER_Z = 8.5;            // where enemy shots "reach" you (camera is at z = 10)
const HS_KEY = 'holo-lab-shooter-best';

const rand = (a, b) => a + Math.random() * (b - a);
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };

class Drone {
  constructor(type, home, wave) {
    this.type = type;
    this.color = ENEMY[type];
    this.s = SIZE[type];
    this.hp = this.maxHp = type === 'boss' ? 14 + wave * 2 : type === 'armored' ? 3 : 1;
    this.home = home.clone();
    this.phase = Math.random() * Math.PI * 2;
    this.pattern = type === 'boss' ? 'boss' : ['hover', 'strafe', 'dive'][Math.floor(Math.random() * (wave >= 2 ? 3 : 2))];
    this.t = 0;
    this.spawnT = 0;
    this.hitFlash = 0;
    this.fireIn = rand(1.6, 3.4);
    this.alive = true;

    const g = this.group = new THREE.Group();
    const s = this.s, color = this.color;
    this.coreMat = glowMaterial(color, 1.5);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 24, 16), this.coreMat));
    this.shell = holoMesh(new THREE.IcosahedronGeometry(0.42 * s, type === 'boss' ? 2 : 1), color, { edgeAngle: 5, edgeOpacity: 0.6 });
    this.ring = new THREE.Group();
    this.ring.add(holoMesh(new THREE.TorusGeometry(0.62 * s, 0.03 * s, 8, 48), color, { edges: false }));
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const fin = holoMesh(new THREE.BoxGeometry(0.08 * s, 0.3 * s, 0.05 * s), color);
      fin.position.set(Math.cos(a) * 0.62 * s, Math.sin(a) * 0.62 * s, 0);
      fin.rotation.z = a;
      this.ring.add(fin);
    }
    this.ring2 = holoMesh(new THREE.TorusGeometry(0.78 * s, 0.012 * s, 6, 64), color, { edges: false });
    this.ring2.rotation.x = Math.PI / 2;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07 * s, 16, 12), glowMaterial(COLORS.white, 2));
    eye.position.z = 0.42 * s;
    g.add(this.shell, this.ring, this.ring2, eye);
    if (type === 'boss') {
      this.bar = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.08), glowMaterial(color, 2));
      this.bar.position.y = 1.3 * s;
      g.add(this.bar);
    }
    g.position.copy(home);
    g.scale.setScalar(0.001);
  }

  get radius() { return 0.7 * this.s * this.group.scale.x; }

  update(dt, game) {
    this.t += dt;
    this.spawnT = Math.min(1, this.spawnT + dt / 0.6);
    const t = this.t * game.difficulty, p = this.phase, h = this.home;
    let x = h.x, y = h.y, z = h.z;
    if (this.pattern === 'hover') { x += Math.sin(t * 0.9 + p) * 0.9; y += Math.sin(t * 1.3 + p) * 0.5; }
    else if (this.pattern === 'strafe') { x = Math.sin(t * 0.55 + p) * game.extents(z).halfW * 0.7; y += Math.sin(t * 1.7 + p) * 0.3; }
    else if (this.pattern === 'dive') {
      const c = Math.max(0, Math.sin(t * 0.45 + p)) ** 2;
      x += Math.sin(t * 1.1 + p) * 0.6; y *= 1 - c * 0.5; z += c * (3 - h.z);
    } else { x = Math.sin(t * 0.35 + p) * 3; y += Math.sin(t * 0.8) * 0.6; }
    const { halfW, halfH } = game.extents(z);
    const r = 0.7 * this.s;
    this.group.position.set(clamp(x, -halfW + r, halfW - r), clamp(y, -halfH + r + 0.6, halfH - r), z);

    this.ring.rotation.z += dt * 2.2;
    this.ring2.rotation.z -= dt * 1.2;
    this.shell.rotation.y += dt * 0.8;
    this.shell.rotation.x += dt * 0.4;
    this.hitFlash = damp(this.hitFlash, 0, 10, dt);
    this.group.scale.setScalar(Math.max(0.001, easeOutBack(this.spawnT)) * (1 + this.hitFlash * 0.25));
    this.group.lookAt(game.camera.position);
    if (this.bar) this.bar.scale.x = Math.max(0.001, this.hp / this.maxHp);

    // shooting: the core glows brighter while charging (a warning to raise your shield)
    if (game.state === 'playing' && this.spawnT >= 1) this.fireIn -= dt;
    const charge = clamp(1 - this.fireIn / 0.7, 0, 1);
    this.coreMat.color.copy(this.color).multiplyScalar(1.5 + charge * 3 + this.hitFlash * 3);
    if (this.fireIn <= 0) {
      game.enemyFire(this);
      this.fireIn = (this.type === 'boss' ? rand(0.9, 1.6) : rand(2.2, 4.2)) / game.difficulty;
    }
  }
}

class Plasma {
  constructor(from, to, speed, color) {
    this.group = new THREE.Group();
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), glowMaterial(color, 2.6)));
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), holoMaterial(color, 1.4));
    this.group.add(this.halo);
    this.group.position.copy(from);
    this.velocity = to.clone().sub(from).setLength(speed);
    this.alive = true;
    this.color = color;
    this.t = 0;
  }
  get radius() { return 0.3; }
  update(dt) {
    this.t += dt;
    this.group.position.addScaledVector(this.velocity, dt);
    this.halo.scale.setScalar(1 + Math.sin(this.t * 25) * 0.15);
  }
}

export class Shooter {
  constructor({ scene, camera, interaction, particles, sfx, objects, focus, onExit }) {
    Object.assign(this, { scene, camera, interaction, particles, sfx, objects, focus, onExit });
    this.root = new THREE.Group();
    scene.add(this.root);
    this.active = false;
    this.debug = true;            // diagnostics readout (D)
    this.state = 'off';
    this.drones = [];
    this.plasma = [];
    this.beams = [];
    this.queue = [];
    this.shake = 0;
    this.best = 0;
    try { this.best = Number(localStorage.getItem(HS_KEY)) || 0; } catch { /* ignore */ }
    this.el = document.getElementById('game');
    this.$ = (id) => document.getElementById(id);
    this.xhairs = [0, 1, 2].map((i) => this.$(`xhair${i}`));
    this.shields = [0, 1, 2].map((i) => this.$(`shield${i}`));
    this.reset();
  }

  // ---------------- lifecycle ----------------
  start() {
    if (this.active) return;
    this.focus.reset();
    this.interaction.resetPointers();
    if (this.interaction.penMode) this.interaction.togglePen(false);
    this.hiddenLab = this.objects.map((o) => [o, o.group.visible]);
    for (const o of this.objects) o.group.visible = false;
    this.interaction.mode = 'game';
    document.body.classList.add('game');
    this.el.classList.remove('hidden');
    this.active = true;
    this.reset();
    this.setState('intro');
    this.banner('HOLO SHOOTER', 'FINGER GUN TO AIM &middot; FIRE: DROP YOUR THUMB or FLICK YOUR FINGER UP<br>OPEN PALM = SHIELD &middot; FIST = RELOAD &middot; D = DIAGNOSTICS', 4.2);
  }

  stop() {
    if (!this.active) return;
    this.clearEntities();
    for (const [o, vis] of this.hiddenLab || []) o.group.visible = vis;
    this.hiddenLab = null;
    this.interaction.mode = 'lab';
    this.interaction.resetPointers();
    document.body.classList.remove('game');
    this.el.classList.add('hidden');
    this.xhairs.concat(this.shields).forEach((e) => { e.style.display = 'none'; });
    this.active = false;
    this.state = 'off';
    this.shake = 0;
  }

  reset() {
    this.clearEntities();
    Object.assign(this, {
      score: 0, wave: 0, health: C.maxHealth, ammo: C.magazine, reloading: 0,
      streak: 0, shots: 0, hits: 0, time: 0, stateT: 0, difficulty: 1, bannerUntil: 0, lastWhy: '',
    });
  }

  clearEntities() {
    for (const e of [...this.drones, ...this.plasma]) this._dispose(e.group);
    for (const b of this.beams) this._dispose(b.line);
    this.drones = []; this.plasma = []; this.beams = []; this.queue = [];
  }

  _dispose(obj) {
    this.root.remove(obj);
    obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  setState(s) { this.state = s; this.stateT = 0; }

  // ---------------- helpers ----------------
  extents(z) {
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (10 - z);
    return { halfH, halfW: halfH * this.camera.aspect };
  }

  toScreen(world) {
    const v = world.clone().project(this.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, behind: v.z > 1 };
  }

  radiusPx(world, r) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const a = this.toScreen(world), b = this.toScreen(world.clone().addScaledVector(right, r));
    return Math.max(14, Math.hypot(b.x - a.x, b.y - a.y));
  }

  unprojectAtZ(x, y, z) {
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    return this.interaction.unprojectAtZ(ndc, z);
  }

  targets() {
    return [...this.drones.filter((d) => d.alive && d.spawnT > 0.3), ...this.plasma.filter((p) => p.alive)];
  }

  /** Crosshair gently pulled toward the nearest target (aim assist). */
  assist(aim) {
    let best = null, bestD = C.aimAssistPx;
    for (const t of this.targets()) {
      const s = this.toScreen(t.group.position);
      if (s.behind) continue;
      const d = Math.hypot(s.x - aim.x, s.y - aim.y) - this.radiusPx(t.group.position, t.radius) * 0.5;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return { x: aim.x, y: aim.y, lock: false };
    return { x: aim.x + (best.x - aim.x) * C.aimAssist, y: aim.y + (best.y - aim.y) * C.aimAssist, lock: true };
  }

  pickTarget(x, y) {
    let best = null, bestScore = Infinity;
    for (const t of this.targets()) {
      const s = this.toScreen(t.group.position);
      if (s.behind) continue;
      const rpx = Math.max(40, this.radiusPx(t.group.position, t.radius) * 1.35) + 12;   // forgiving
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < rpx && d / rpx < bestScore) { best = t; bestScore = d / rpx; }
    }
    return best;
  }

  get multiplier() { return Math.min(5, 1 + Math.floor(this.streak / 3)); }

  // ---------------- player actions ----------------
  fire(p, aim) {
    // shooting (or clicking) the HUD buttons
    const el = document.elementFromPoint(aim.x, aim.y);
    const btn = el && el.closest ? el.closest('#g-exit, #g-restart') : null;
    if (btn) { this.sfx.press(); if (btn.id === 'g-exit') this.onExit(); else this.restart(); return; }
    if (this.state === 'over') { if (this.stateT > 1.2) this.restart(); return; }
    if (this.reloading > 0) return;
    if (this.ammo <= 0) { this.sfx.empty(); this.hint('OUT OF AMMO - MAKE A FIST TO RELOAD', 1.5); return; }

    this.ammo--;
    this.shots++;
    this.sfx.shoot();
    const a = this.assist(aim);
    const target = this.pickTarget(a.x, a.y);
    const muzzle = p.kind === 'hand' && p.lmScreen ? p.lmScreen[8] : { x: innerWidth / 2, y: innerHeight + 40 };
    const from = this.unprojectAtZ(muzzle.x, muzzle.y, 7);
    const to = target ? target.group.position.clone() : this.unprojectAtZ(a.x, a.y, -12);
    this.beam(from, to, target ? COLORS.cyan : COLORS.white);

    if (!target) { this.streak = 0; if (this.ammo === 0) this.hint('MAKE A FIST TO RELOAD', 2); return; }
    this.hits++;
    this.streak++;
    if (target instanceof Plasma) {
      target.alive = false;
      this.particles.burst(target.group.position, target.color, 120, 3, 0.2);
      this.addScore(50, target.group.position, 'SHOT DOWN');
      this.sfx.hit();
    } else this.damage(target);
    if (this.ammo === 0) this.hint('MAKE A FIST TO RELOAD', 2);
  }

  damage(d) {
    d.hp--;
    d.hitFlash = 1;
    this.particles.burst(d.group.position, d.color, 60, 2.5, 0.2);
    if (d.hp > 0) { this.sfx.hit(); return; }
    d.alive = false;
    this.particles.burst(d.group.position, d.color, d.type === 'boss' ? 1500 : 600, d.type === 'boss' ? 8 : 5, d.radius * 2);
    this.sfx.kill();
    if (d.type === 'boss') this.shake = Math.max(this.shake, 0.8);
    this.addScore(POINTS[d.type], d.group.position);
  }

  addScore(base, world, label = '') {
    const pts = base * this.multiplier;
    this.score += pts;
    const s = this.toScreen(world);
    this.popup(`+${pts}${this.multiplier > 1 ? ` x${this.multiplier}` : ''}${label ? ` ${label}` : ''}`, s.x, s.y);
  }

  startReload() {
    if (this.reloading > 0 || this.ammo === C.magazine || this.state === 'over') return;
    this.reloading = C.reloadTime;
    this.sfx.reload();
  }

  restart() {
    this.reset();
    this.setState('intro');
    this.banner('GET READY', '', 2.2);
    this.stateT = 2;
  }

  enemyFire(d) {
    if (this.state !== 'playing') return;
    const from = d.group.position.clone().add(new THREE.Vector3(0, 0, 0.5 * d.s));
    const to = new THREE.Vector3(rand(-1.4, 1.4), rand(-0.9, 0.9), PLAYER_Z + 1);
    const speed = (d.type === 'boss' ? 7 : 5.2) + this.wave * 0.3;
    this.spawnPlasma(from, to, speed, d.color);
    this.sfx.enemyShot();
  }

  spawnPlasma(from, to, speed, color = ENEMY.basic) {
    const p = new Plasma(from, to, speed, color);
    this.plasma.push(p);
    this.root.add(p.group);
    return p;
  }

  spawnDrone(type, pos) {
    const d = new Drone(type, pos, Math.max(1, this.wave));
    this.drones.push(d);
    this.root.add(d.group);
    return d;
  }

  shotArrives(p, shields) {
    p.alive = false;
    const s = this.toScreen(p.group.position);
    const blocked = shields.some((sh) => Math.hypot(sh.x - s.x, sh.y - s.y) < C.shieldRadius);
    if (blocked) {
      this.sfx.block();
      this.particles.burst(p.group.position, COLORS.cyan, 200, 3, 0.3);
      this.addScore(25, p.group.position, 'BLOCKED');
      return;
    }
    this.health = Math.max(0, this.health - (p.color === ENEMY.boss ? 18 : 10));
    this.streak = 0;
    this.shake = 1;
    this.sfx.playerHit();
    const dmg = this.$('g-dmg');
    dmg.classList.remove('flash'); void dmg.offsetWidth; dmg.classList.add('flash');
    if (this.health <= 0) this.gameOver();
  }

  gameOver() {
    this.setState('over');
    const newBest = this.score > this.best;
    if (newBest) { this.best = this.score; try { localStorage.setItem(HS_KEY, String(this.best)); } catch { /* ignore */ } }
    this.sfx.gameOver();
    const acc = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    this.banner('GAME OVER', `SCORE ${this.score}${newBest ? ' &middot; NEW BEST!' : ''}<br>WAVE ${this.wave} &middot; ACCURACY ${acc}%<br><button id="g-restart">&#8635; RESTART</button><div class="g-small">shoot or click RESTART &middot; ESC = back to lab</div>`, Infinity);
  }

  // ---------------- waves ----------------
  startWave(n) {
    this.wave = n;
    this.difficulty = 1 + (n - 1) * 0.12;
    this.setState('playing');
    const boss = n % 5 === 0;
    const types = boss ? ['boss', 'basic', 'basic']
      : Array.from({ length: Math.min(2 + n, 7) }, () => (Math.random() < Math.min(0.45, 0.09 * (n - 1)) ? 'armored' : 'basic'));
    types.forEach((type, i) => {
      const z = type === 'boss' ? -5 : rand(-6.5, -1.5);
      const { halfW } = this.extents(z);
      const x = type === 'boss' ? 0 : ((i + 0.5) / types.length * 2 - 1) * (halfW - 1.2);
      const pos = new THREE.Vector3(x, type === 'boss' ? 1.2 : rand(-0.6, 1.8), z);
      this.queue.push({ at: this.time + 0.8 + i * 0.45, type, pos });
    });
    this.banner(`WAVE ${n}`, boss ? 'BOSS INCOMING - AIM FOR THE CORE' : `${types.length} DRONES`, 1.8);
    this.sfx.wave();
  }

  // ---------------- per frame ----------------
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.stateT += dt;
    const I = this.interaction;
    const anyHandGun = I.hands.some((p) => p.present && p.gunPose);

    // input
    for (const p of I.hands) {
      if (p.fire) { p.fire = false; if (p.present) { this.lastWhy = p.fireWhy === 'flick' ? 'recoil flick' : 'thumb trigger'; this.fire(p, p.fireAim || p.aim); } }
      if (p.present && p.fist) this.startReload();
    }
    const m = I.mouse;
    if (m.pinchStarted) this.fire(m, m.screen);
    for (const p of I.pointers) p.pinchStarted = p.pinchEnded = false;
    const shields = [];
    I.hands.forEach((p) => { if (p.present && p.open && !p.gunPose) shields.push(p.palmScreen); });
    if (m.present && m.open) shields.push(m.screen);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.reloading = 0; this.ammo = C.magazine; }
    }

    // state machine
    if (this.state === 'intro' && this.stateT > 4.2) this.startWave(1);
    if (this.state === 'between' && this.stateT > 2.2) this.startWave(this.wave + 1);
    while (this.queue.length && this.queue[0].at <= this.time) {
      const q = this.queue.shift();
      const d = new Drone(q.type, q.pos, this.wave);
      this.drones.push(d);
      this.root.add(d.group);
    }

    for (const d of this.drones) if (d.alive) d.update(dt, this);
    for (const p of this.plasma) {
      if (!p.alive) continue;
      p.update(dt);
      if (p.group.position.z >= PLAYER_Z) this.shotArrives(p, shields);
    }
    this.drones = this.drones.filter((d) => d.alive || (this._dispose(d.group), false));
    this.plasma = this.plasma.filter((p) => p.alive || (this._dispose(p.group), false));

    if (this.state === 'playing' && !this.drones.length && !this.queue.length && !this.plasma.length) {
      this.setState('between');
      this.health = Math.min(C.maxHealth, this.health + 10);
      this.banner(`WAVE ${this.wave} CLEAR`, `+${this.wave * 200} BONUS &middot; HULL +10`, 2);
      this.score += this.wave * 200;
    }

    for (const b of this.beams) { b.life -= dt; b.line.material.opacity = Math.max(0, b.life / 0.15); }
    this.beams = this.beams.filter((b) => b.life > 0 || (this._dispose(b.line), false));
    this.shake = damp(this.shake, 0, 6, dt);

    this._drawHud(shields, anyHandGun);
  }

  beam(from, to, color) {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(g, glowLineMaterial(color, 1, 2.5));
    this.root.add(line);
    this.beams.push({ line, life: 0.15 });
  }

  // ---------------- HUD ----------------
  /** Live diagnostics (key D in the game): what the tracker sees, so problems can be pinned down. */
  _drawDebug() {
    const el = this.$('g-debug');
    if (!this.debug) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const tr = this.tracker || {};
    const rows = [`TRACKING ${tr.trackRate ?? '--'} fps &middot; ${tr.detectMs ? tr.detectMs.toFixed(1) : '--'} ms/frame`];
    this.interaction.hands.forEach((p, i) => {
      if (!p.present) { rows.push(`HAND ${i + 1}: not seen`); return; }
      const th = p.thumbRatio ?? 0;
      rows.push(`HAND ${i + 1}: ${p.gunPose ? '<b class="ok">FINGER GUN</b>' : (p.open ? 'open palm (shield)' : p.fist ? 'fist (reload)' : '<b class="bad">no gun pose</b>')}`
        + ` &middot; thumb ${th.toFixed(2)} <span class="dim">(fires &lt; ${C.thumbDownT.toFixed(2)})</span> ${p.thumbDown ? 'DOWN' : 'up'}`
        + ` &middot; flick ${(p.pitchVel || 0).toFixed(1)} <span class="dim">(fires &gt; ${C.flickSpeed})</span>`);
    });
    rows.push(`LAST SHOT: ${this.lastWhy || '-'} &middot; shots ${this.shots} &middot; hits ${this.hits}`);
    el.innerHTML = rows.join('<br>');
  }

  banner(title, sub, seconds) {
    const el = this.$('g-banner');
    el.innerHTML = `<div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`;
    el.classList.add('show');
    this.bannerUntil = this.time + seconds;
  }

  hint(text, seconds) {
    const el = this.$('g-hint');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => el.classList.remove('show'), seconds * 1000);
  }

  popup(text, x, y) {
    const el = document.createElement('div');
    el.className = 'g-pop';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  _drawHud(shields, anyHandGun) {
    const I = this.interaction;
    if (this.time > this.bannerUntil) this.$('g-banner').classList.remove('show');
    if (this.state === 'intro' && this.stateT > 1.2 && this.stateT < 4.2) {
      this.$('g-banner').querySelector('.t').textContent = String(Math.ceil(4.2 - this.stateT));
    }
    // crosshairs: one per finger-gun hand, or the mouse when no hand is aiming
    const aims = [I.hands[0].present && I.hands[0].gunPose ? I.hands[0] : null,
      I.hands[1].present && I.hands[1].gunPose ? I.hands[1] : null,
      !anyHandGun && I.mouse.present ? I.mouse : null];
    aims.forEach((p, i) => {
      const el = this.xhairs[i];
      if (!p) { el.style.display = 'none'; return; }
      const a = this.assist(p.kind === 'mouse' ? p.screen : p.aim);
      el.style.display = 'block';
      el.style.transform = `translate(${a.x}px, ${a.y}px)`;
      el.classList.toggle('lock', a.lock);
      el.classList.toggle('down', !!p.thumbDown);
    });
    this.shields.forEach((el, i) => {
      const s = shields[i];
      el.style.display = s ? 'block' : 'none';
      if (s) { el.style.transform = `translate(${s.x}px, ${s.y}px)`; el.style.width = el.style.height = `${C.shieldRadius * 2}px`; }
    });

    this._hudT = (this._hudT || 0) + 1;
    if (this._hudT % 6) return;
    this._drawDebug();
    this.$('g-score').textContent = this.score;
    this.$('g-wave').textContent = this.wave || '-';
    this.$('g-combo').textContent = `x${this.multiplier}`;
    this.$('g-acc').textContent = this.shots ? `${Math.round((this.hits / this.shots) * 100)}%` : '--';
    this.$('g-best').textContent = Math.max(this.best, this.score);
    const hp = this.health / C.maxHealth;
    const bar = this.$('g-health-bar');
    bar.style.width = `${hp * 100}%`;
    bar.classList.toggle('low', hp < 0.3);
    const ammo = this.$('g-ammo');
    if (this.reloading > 0) ammo.innerHTML = `<span class="reload">RELOADING ${Math.round((1 - this.reloading / C.reloadTime) * 100)}%</span>`;
    else ammo.innerHTML = Array.from({ length: C.magazine }, (_, i) => `<i class="${i < this.ammo ? 'full' : ''}"></i>`).join('');
  }
}
