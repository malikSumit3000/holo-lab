// Holographic objects you can grab, throw, spin, resize and explode.
import * as THREE from 'three';
import {
  COLORS, holoMaterial, holoMesh, glowLineMaterial, glowMaterial, makeLabel, fbm3, hash01, clamp, damp,
} from './holo.js';

const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };

export class HoloObject {
  constructor(type, name, radius) {
    this.type = type;
    this.name = name;
    this.radius = radius;          // picking / collision radius at scale 1
    this.group = new THREE.Group();
    this.velocity = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.heldBy = new Set();       // hand ids currently holding it
    this.baseScale = 1;
    this.explodable = false;
    this.explode = 0;
    this.explodeTarget = 0;
    this.spawnT = 0;
    this.dying = false;
    this.dieT = 0;
    this.hover = 0;
    this.hoverTarget = 0;
    this.flash = 1;
    this._holoMats = [];
    this.interactive = true;       // false while ghosted in the background or flying
    this.dim = 1;                  // 1 = normal, ~0.1 = ghost
    this.dimTarget = 1;
    this._dimMats = null;
    this.fly = null;               // scripted move: { fromPos, toPos, fromScale, toScale, fromQuat, toQuat, t, dur, onDone }
  }

  get held() { return this.heldBy.size > 0; }
  get worldRadius() { return this.radius * this.group.scale.x; }
  get pickable() { return this.interactive && !this.dying && !this.fly && this.dimTarget >= 1; }

  flyTo(toPos, toScale, toQuat = null, dur = 0.7, onDone = null) {
    this.fly = {
      fromPos: this.group.position.clone(), toPos: toPos.clone(),
      fromScale: this.baseScale, toScale,
      fromQuat: this.group.quaternion.clone(), toQuat: toQuat ? toQuat.clone() : null,
      t: 0, dur, onDone,
    };
    this.velocity.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
  }

  _applyDim() {
    if (!this._dimMats) {
      this._dimMats = [];
      const seen = new Set();
      this.group.traverse((o) => {
        if (!o.material || o.isSprite) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (seen.has(m)) continue;
          seen.add(m);
          if (m.uniforms && m.uniforms.uOpacity) this._dimMats.push({ m, base: m.uniforms.uOpacity.value, shader: true });
          else { this._dimMats.push({ m, base: m.opacity, shader: false, wasTransparent: m.transparent }); }
        }
      });
    }
    for (const d of this._dimMats) {
      if (d.shader) d.m.uniforms.uOpacity.value = d.base * this.dim;
      else {
        d.m.transparent = d.wasTransparent || this.dim < 0.999;
        d.m.opacity = d.base * this.dim;
      }
    }
  }

  finish() {
    this.group.traverse((o) => {
      if (o.material && o.material.uniforms && o.material.uniforms.uHover) this._holoMats.push(o.material);
    });
    this.group.userData.holo = this;
    return this;
  }

  setHover(on) { this.hoverTarget = on ? 1 : 0; }
  flashNow(v = 0.6) { this.flash = Math.max(this.flash, v); }

  update(dt, t) {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - (-2 * f.t + 2) ** 2 / 2;   // ease in-out
      this.group.position.lerpVectors(f.fromPos, f.toPos, e);
      this.baseScale = f.fromScale + (f.toScale - f.fromScale) * e;
      if (f.toQuat) this.group.quaternion.slerpQuaternions(f.fromQuat, f.toQuat, e);
      if (f.t >= 1) { this.fly = null; if (f.onDone) f.onDone(); }
    }
    if (Math.abs(this.dim - this.dimTarget) > 0.002) {
      this.dim = Math.abs(this.dimTarget - this.dim) < 0.01 ? this.dimTarget : damp(this.dim, this.dimTarget, 6, dt);
      this._applyDim();
    }
    this.spawnT = Math.min(1, this.spawnT + dt / 0.7);
    let s = this.baseScale * Math.max(0.001, easeOutBack(this.spawnT));
    if (this.dying) {
      this.dieT = Math.min(1, this.dieT + dt / 0.35);
      s *= 1 - this.dieT;
    }
    this.group.scale.setScalar(s);
    this.hover = damp(this.hover, this.hoverTarget, 12, dt);
    this.flash = damp(this.flash, 0, 4, dt);
    for (const m of this._holoMats) {
      m.uniforms.uHover.value = this.hover;
      m.uniforms.uFlash.value = this.flash * 0.35;
    }
    this.animate(dt, t);
  }

  animate() {}

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();   // 'keep' = shared with a cached model
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

// ======================================================================================
// PLANET
// ======================================================================================
let planetTex = null;
function planetTexture() {
  if (planetTex) return planetTex;
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - y / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      const px = Math.cos(lat) * Math.cos(lon), py = Math.sin(lat), pz = Math.cos(lat) * Math.sin(lon);
      const n = fbm3(px * 2.1 + 11, py * 2.1 + 3, pz * 2.1 + 7);
      let r = 2, g = 16, b = 38;                                     // ocean
      const coast = Math.abs(n - 0.52) < 0.008;
      if (n > 0.52) {                                               // land
        const k = 0.45 + (n - 0.52) * 5;
        r = 30 * k; g = 190 * k; b = 255 * k;
        if (hash01(x, y) > 0.985) { r = 255; g = 230; b = 160; }     // city lights
      }
      if (coast) { r = 170; g = 255; b = 255; }
      if (Math.abs(lat) > 1.25) { r = 200; g = 245; b = 255; }       // ice caps
      const i = (y * W + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  planetTex = new THREE.CanvasTexture(c);
  planetTex.colorSpace = THREE.SRGBColorSpace;
  return planetTex;
}

function latLongLines(radius, color) {
  const pts = [];
  const seg = 72;
  for (let lat = -60; lat <= 60; lat += 30) {
    const la = THREE.MathUtils.degToRad(lat), r = Math.cos(la) * radius, y = Math.sin(la) * radius;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      pts.push(r * Math.cos(a0), y, r * Math.sin(a0), r * Math.cos(a1), y, r * Math.sin(a1));
    }
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const lo = THREE.MathUtils.degToRad(lon);
    for (let i = 0; i < seg / 2; i++) {
      const b0 = -Math.PI / 2 + (i / (seg / 2)) * Math.PI, b1 = -Math.PI / 2 + ((i + 1) / (seg / 2)) * Math.PI;
      pts.push(Math.cos(b0) * Math.cos(lo) * radius, Math.sin(b0) * radius, Math.cos(b0) * Math.sin(lo) * radius,
        Math.cos(b1) * Math.cos(lo) * radius, Math.sin(b1) * radius, Math.cos(b1) * Math.sin(lo) * radius);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, glowLineMaterial(color, 0.22, 1.2));
}

let dotTex = null;
export function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

export function createPlanet() {
  const o = new HoloObject('planet', 'PLANET', 1.25);
  const tilt = new THREE.Group();
  tilt.rotation.z = THREE.MathUtils.degToRad(23);
  const spinner = new THREE.Group();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshBasicMaterial({
    map: planetTexture(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  spinner.add(globe, latLongLines(1.012, COLORS.cyan));
  tilt.add(spinner);

  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 32), holoMaterial(COLORS.cyan, 0.9));

  // particle ring
  const ringN = 1800, ringPos = new Float32Array(ringN * 3);
  for (let i = 0; i < ringN; i++) {
    const a = Math.random() * Math.PI * 2, r = 1.45 + Math.random() * 0.5 + (Math.random() < 0.2 ? 0.15 : 0);
    ringPos.set([Math.cos(a) * r, (Math.random() - 0.5) * 0.03, Math.sin(a) * r], i * 3);
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
  const ring = new THREE.Points(ringGeo, new THREE.PointsMaterial({
    color: COLORS.cyan.clone().multiplyScalar(1.4), size: 0.035, map: dotTexture(), transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const ringTilt = new THREE.Group();
  ringTilt.rotation.set(0.45, 0, 0.25);
  ringTilt.add(ring);

  // moon + orbit
  const orbit = new THREE.Group();
  orbit.rotation.set(-0.3, 0, 0.15);
  const moon = holoMesh(new THREE.SphereGeometry(0.15, 24, 16), COLORS.gold, { edges: false });
  moon.position.set(2.35, 0, 0);
  const orbitLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, 2.35, 2.35).getPoints(128).map((p) => new THREE.Vector3(p.x, 0, p.y))),
    glowLineMaterial(COLORS.gold, 0.25, 1));
  orbit.add(moon, orbitLine);

  o.group.add(tilt, atmosphere, ringTilt, orbit);
  o.animate = (dt) => {
    spinner.rotation.y += dt * 0.18;
    ring.rotation.y += dt * 0.05;
    orbit.rotation.y += dt * 0.35;
  };
  return o.finish();
}

// ======================================================================================
// ARC REACTOR
// ======================================================================================
export function createReactor() {
  const o = new HoloObject('reactor', 'ARC REACTOR', 1.2);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 24), glowMaterial(new THREE.Color(0.7, 1, 1), 3));
  const coreHalo = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 24), holoMaterial(COLORS.cyan, 1.2));
  const inner = holoMesh(new THREE.TorusGeometry(0.45, 0.05, 16, 64), COLORS.cyan, { edges: false });

  const tri = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([0, 1, 2].map((i) => {
    const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.02);
  })), glowLineMaterial(COLORS.white, 0.9, 2));

  const coils = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const seg = holoMesh(new THREE.BoxGeometry(0.17, 0.3, 0.14), COLORS.cyan);
    seg.position.set(Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0);
    seg.rotation.z = a + Math.PI / 2;
    coils.add(seg);
  }
  const outer = holoMesh(new THREE.TorusGeometry(1.0, 0.07, 16, 96), COLORS.cyan, { edges: false });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.14, 0.012, 8, 128), glowMaterial(COLORS.cyan, 2));

  const dashes = new THREE.Group();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.02), glowMaterial(COLORS.cyan, 1.8));
    d.position.set(Math.cos(a) * 1.28, Math.sin(a) * 1.28, 0);
    d.rotation.z = a + Math.PI / 2;
    dashes.add(d);
  }
  o.group.add(core, coreHalo, inner, tri, coils, outer, rim, dashes);
  o.animate = (dt, t) => {
    const pulse = 1 + Math.sin(t * 4) * 0.08;
    core.scale.setScalar(pulse);
    core.material.color.setRGB(0.7 * 1.7 * pulse, 1.7 * pulse, 1.8 * pulse);
    coils.rotation.z += dt * 0.25;
    dashes.rotation.z -= dt * 0.5;
    tri.rotation.z -= dt * 0.8;
  };
  return o.finish();
}

// ======================================================================================
// ENGINE (explodable)
// ======================================================================================
export function gearGeometry(rOuter, rInner, teeth, depth) {
  const s = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let k = 0; k < teeth; k++) {
    const a = k * step;
    const pts = [[a, rInner], [a + step * 0.18, rOuter], [a + step * 0.5, rOuter], [a + step * 0.68, rInner]];
    pts.forEach(([ang, r], j) => {
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
      if (k === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y);
    });
  }
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, rInner * 0.35, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// ======================================================================================
// DNA
// ======================================================================================
export function createDNA() {
  const o = new HoloObject('dna', 'DNA HELIX', 1.4);
  const spin = new THREE.Group();
  const n = 30, a1 = [], a2 = [], rods = [];
  const sGeo = new THREE.SphereGeometry(0.055, 12, 8);
  const matA = glowMaterial(COLORS.cyan, 1.6), matB = glowMaterial(COLORS.magenta, 1.6);
  for (let i = 0; i < n; i++) {
    const y = (i - (n - 1) / 2) * 0.1, a = i * 0.42;
    const p1 = new THREE.Vector3(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5);
    const p2 = new THREE.Vector3(-p1.x, y, -p1.z);
    a1.push(p1); a2.push(p2);
    const s1 = new THREE.Mesh(sGeo, matA); s1.position.copy(p1);
    const s2 = new THREE.Mesh(sGeo, matB); s2.position.copy(p2);
    spin.add(s1, s2);
    rods.push(p1.x, y, p1.z, p2.x, y, p2.z);
  }
  const tube = (pts, color) => new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.03, 8), holoMaterial(color, 1.3));
  spin.add(tube(a1, COLORS.cyan), tube(a2, COLORS.magenta));
  const rodGeo = new THREE.BufferGeometry();
  rodGeo.setAttribute('position', new THREE.Float32BufferAttribute(rods, 3));
  spin.add(new THREE.LineSegments(rodGeo, glowLineMaterial(COLORS.white, 0.5, 1.2)));
  o.group.add(spin);
  o.group.rotation.z = 0.25;
  o.animate = (dt) => { spin.rotation.y += dt * 0.7; };
  return o.finish();
}

// ======================================================================================
// 4-D HYPERCUBE (tesseract) - rotates in the 4th dimension, projected to 3-D
// ======================================================================================
export function createHypercube() {
  const o = new HoloObject('hypercube', 'TESSERACT 4D', 1.3);
  const verts4 = [];
  for (let i = 0; i < 16; i++) verts4.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1, (i & 8) ? 1 : -1]);
  const edges = [];
  for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) {
    const diff = verts4[i].reduce((s, v, k) => s + (v !== verts4[j][k] ? 1 : 0), 0);
    if (diff === 1) edges.push([i, j]);
  }
  const linePos = new Float32Array(edges.length * 6), lineCol = new Float32Array(edges.length * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const ptPos = new Float32Array(16 * 3);
  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
  const points = new THREE.Points(ptGeo, new THREE.PointsMaterial({
    color: new THREE.Color(1.6, 1.6, 1.6), size: 0.16, map: dotTexture(), transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 3), holoMaterial(COLORS.magenta, 0.35));
  o.group.add(lines, points, shell);

  const proj = new Array(16);
  const cA = COLORS.cyan, cB = COLORS.magenta;
  o.animate = (dt, t) => {
    const a = t * 0.55, b = t * 0.31, c = t * 0.17;
    for (let i = 0; i < 16; i++) {
      let [x, y, z, w] = verts4[i];
      let nx = x * Math.cos(a) - w * Math.sin(a); w = x * Math.sin(a) + w * Math.cos(a); x = nx;   // XW
      let ny = y * Math.cos(b) - w * Math.sin(b); w = y * Math.sin(b) + w * Math.cos(b); y = ny;   // YW
      let nz = z * Math.cos(c) - x * Math.sin(c); x = z * Math.sin(c) + x * Math.cos(c); z = nz;   // XZ
      const k = 1.5 / (2.8 - w);
      proj[i] = [x * k * 0.75, y * k * 0.75, z * k * 0.75, w];
      ptPos.set(proj[i].slice(0, 3), i * 3);
    }
    edges.forEach(([i, j], e) => {
      linePos.set(proj[i].slice(0, 3), e * 6);
      linePos.set(proj[j].slice(0, 3), e * 6 + 3);
      for (const [idx, off] of [[i, 0], [j, 3]]) {
        const m = (proj[idx][3] + 1) / 2;   // colour by 4th-dimension depth
        lineCol[e * 6 + off] = (cA.r + (cB.r - cA.r) * m) * 1.5;
        lineCol[e * 6 + off + 1] = (cA.g + (cB.g - cA.g) * m) * 1.5;
        lineCol[e * 6 + off + 2] = (cA.b + (cB.b - cA.b) * m) * 1.5;
      }
    });
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;
    ptGeo.attributes.position.needsUpdate = true;
    shell.rotation.y += dt * 0.1;
  };
  o.animate(0, 0);
  return o.finish();
}

// ======================================================================================
// LIGHT SCULPTURE (made with the light pen)
// ======================================================================================
export function strokeGeometry(points, radius = 0.045) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, Math.min(600, points.length * 4), radius, 8, false);
}

export function createSculpture(points, color) {
  const o = new HoloObject('sculpture', 'LIGHT SCULPTURE', 0.5);
  const center = new THREE.Vector3();
  points.forEach((p) => center.add(p));
  center.divideScalar(points.length);
  const local = points.map((p) => p.clone().sub(center));
  const r = local.reduce((m, p) => Math.max(m, p.length()), 0);
  o.radius = Math.max(0.35, r + 0.1);
  const core = new THREE.Mesh(strokeGeometry(local, 0.03), glowMaterial(color, 2.2));
  const glow = new THREE.Mesh(strokeGeometry(local, 0.07), holoMaterial(color, 1.2));
  o.group.add(core, glow);
  o.group.position.copy(center);
  o.spawnT = 1;   // already "built" by the user, no pop-in
  return o.finish();
}

export const FACTORIES = {
  planet: createPlanet,
  reactor: createReactor,
  dna: createDNA,
  hypercube: createHypercube,
};
