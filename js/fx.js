// Particle bursts, ambient dust, and synthesized UI sounds (no audio files needed).
import * as THREE from 'three';
import { dotTexture } from './objects.js';

export class Particles {
  constructor(scene, max = 5000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.next = 0;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
      size: 0.07, map: dotTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(center, color, count = 500, speed = 4, spread = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const dir = new THREE.Vector3().randomDirection();
      const r = Math.random() * spread * 0.5;
      this.pos.set([center.x + dir.x * r, center.y + dir.y * r, center.z + dir.z * r], i * 3);
      const s = speed * (0.3 + Math.random());
      this.vel.set([dir.x * s, dir.y * s, dir.z * s], i * 3);
      const c = color.clone().lerp(new THREE.Color(1, 1, 1), Math.random() * 0.5).multiplyScalar(2);
      this.base.set([c.r, c.g, c.b], i * 3);
      this.life[i] = 0.6 + Math.random() * 0.8;
    }
  }

  update(dt) {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j] *= drag; this.vel[j + 1] = this.vel[j + 1] * drag - dt * 0.6; this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = Math.max(0, Math.min(1, this.life[i]));
      this.col[j] = this.base[j] * f; this.col[j + 1] = this.base[j + 1] * f; this.col[j + 2] = this.base[j + 2] * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

export function createDust(scene, n = 700) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 18, -12 + Math.random() * 16], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: new THREE.Color(0.25, 0.8, 1.0), size: 0.05, map: dotTexture(), transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(pts);
  return (dt) => {
    for (let i = 0; i < n; i++) {
      pos[i * 3 + 1] += dt * 0.08;
      if (pos[i * 3 + 1] > 9) pos[i * 3 + 1] = -9;
    }
    geo.attributes.position.needsUpdate = true;
  };
}

export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.lastHover = 0; }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }

  toggleMute() { this.muted = !this.muted; return this.muted; }

  tone(f0, f1, dur, type = 'sine', vol = 1, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  noise(dur, vol = 0.5, freq = 1500) {
    if (!this.ctx || this.muted) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  }

  hover() {
    const now = performance.now();
    if (now - this.lastHover < 90) return;
    this.lastHover = now;
    this.tone(1500, 1500, 0.035, 'sine', 0.2);
  }
  grab() { this.tone(420, 880, 0.09, 'triangle', 0.7); }
  release() { this.tone(760, 380, 0.1, 'triangle', 0.5); }
  throw() { this.noise(0.22, 0.5, 2600); this.tone(900, 300, 0.2, 'sine', 0.3); }
  bounce() { this.tone(300, 200, 0.06, 'sine', 0.35); }
  spawn() { this.tone(180, 1400, 0.4, 'sawtooth', 0.25); this.tone(360, 2600, 0.4, 'sine', 0.3, 0.05); }
  press() { this.tone(900, 1300, 0.06, 'square', 0.2); }
  destroy() { this.noise(0.6, 0.9, 900); this.tone(700, 50, 0.55, 'sawtooth', 0.35); }
  explode() { this.tone(200, 90, 0.3, 'triangle', 0.4); this.noise(0.25, 0.3, 600); }
  penStart() { this.tone(600, 1200, 0.12, 'sine', 0.35); }
  penEnd() { this.tone(1200, 1800, 0.12, 'sine', 0.35); }
  // ---- Holo Shooter ----
  shoot() { this.tone(1800, 220, 0.16, 'sawtooth', 0.35); this.noise(0.08, 0.35, 4000); }
  hit() { this.tone(900, 1400, 0.07, 'square', 0.3); }
  kill() { this.noise(0.45, 0.8, 700); this.tone(500, 60, 0.4, 'sawtooth', 0.35); }
  empty() { this.tone(2400, 2300, 0.03, 'square', 0.25); }
  reload() { this.tone(700, 500, 0.05, 'square', 0.3); this.tone(900, 1200, 0.06, 'square', 0.3, 0.35); }
  enemyShot() { this.tone(300, 520, 0.25, 'sine', 0.15); }
  block() { this.tone(1200, 1900, 0.12, 'triangle', 0.5); this.noise(0.1, 0.3, 5000); }
  playerHit() { this.tone(160, 50, 0.35, 'sawtooth', 0.6); this.noise(0.3, 0.7, 300); }
  wave() { [0, 0.1, 0.2].forEach((d, i) => this.tone(400 + i * 200, 800 + i * 300, 0.18, 'triangle', 0.35, d)); }
  gameOver() { [0, 0.25, 0.5].forEach((d, i) => this.tone(500 - i * 120, 200 - i * 50, 0.4, 'sawtooth', 0.35, d)); }

  boot() {
    [0, 0.12, 0.24].forEach((d, i) => this.tone(300 + i * 250, 600 + i * 400, 0.25, 'sine', 0.35, d));
    this.tone(80, 1600, 1.0, 'sawtooth', 0.15, 0.35);
  }
}
