// Holo Lab - bootstraps the 3-D scene, camera feed, hand tracking and the render loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { sharedTime, COLORS, glowLineMaterial } from './holo.js';
import { FACTORIES } from './objects.js';
import { Particles, createDust, Sfx } from './fx.js';
import { HandTracker } from './hands.js';
import { Interaction } from './interaction.js';
import { AssemblyObject } from './parts.js';
import { ENGINE_DEF } from './models/engine.js';
import { FocusManager } from './focus.js';
import { CONFIG, TUNABLES, saveConfig, resetConfig } from './config.js';

const MAX_OBJECTS = 10;
FACTORIES.engine = () => new AssemblyObject(ENGINE_DEF);   // detailed, drillable engine
const $ = (id) => document.getElementById(id);

// ---------------- renderer / scenes ----------------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 10);

// background: the webcam, tinted like a hologram projector room (or a dark gradient without camera)
const video = $('video');
const videoTex = new THREE.VideoTexture(video);
videoTex.colorSpace = THREE.SRGBColorSpace;
const bgMat = new THREE.ShaderMaterial({
  uniforms: {
    uVideo: { value: videoTex }, uScale: { value: new THREE.Vector2(1, 1) },
    uHas: { value: 0 }, uShow: { value: 1 }, uTime: sharedTime,
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D uVideo; uniform vec2 uScale; uniform float uHas; uniform float uShow; uniform float uTime;
    varying vec2 vUv;
    void main() {
      float vig = 1.0 - length(vUv - 0.5) * 1.2;
      vec3 room = mix(vec3(0.002, 0.012, 0.022), vec3(0.01, 0.05, 0.08), clamp(vig, 0.0, 1.0));
      vec2 uv = (vUv - 0.5) * uScale + 0.5;
      uv.x = 1.0 - uv.x;                                    // mirror
      vec3 v = texture2D(uVideo, uv).rgb;
      float l = dot(v, vec3(0.299, 0.587, 0.114));
      vec3 tint = mix(vec3(0.0, 0.02, 0.04), vec3(0.16, 0.5, 0.65), l) * 0.6;
      tint *= 0.92 + 0.08 * sin(vUv.y * 900.0 + uTime * 8.0);   // faint scan flicker
      vec3 col = mix(room, room * 0.4 + tint, uHas * uShow);
      gl_FragColor = vec4(col, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const bgScene = new THREE.Scene();
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));
const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// floor grid + projector ring
const grid = new THREE.GridHelper(60, 60, COLORS.cyan.clone().multiplyScalar(0.5), COLORS.cyan.clone().multiplyScalar(0.25));
grid.position.y = -4.6;
grid.material.transparent = true; grid.material.opacity = 0.35; grid.material.depthWrite = false;
scene.add(grid);
const projector = new THREE.Group();
projector.position.y = -4.55;
for (const [r, o] of [[3.2, 0.7], [3.5, 0.3], [2.4, 0.4]]) {
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    new THREE.EllipseCurve(0, 0, r, r).getPoints(128).map((p) => new THREE.Vector3(p.x, 0, p.y))), glowLineMaterial(COLORS.cyan, o, 1.5));
  projector.add(ring);
}
scene.add(projector);

const particles = new Particles(scene);
const updateDust = createDust(scene);

// ---------------- post-processing (the glow) ----------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(bgScene, bgCam));
const mainPass = new RenderPass(scene, camera);
mainPass.clear = false;
composer.addPass(mainPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.45, 0.7);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------- app state ----------------
const objects = [];
const sfx = new Sfx();
const tracker = new HandTracker(video);
let toastTimer = null;
function toast(text, ms = 1800) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function spawn(type, at = null) {
  const make = FACTORIES[type];
  if (!make) return null;
  if (focus.depth) focus.reset();
  if (objects.filter((o) => !o.dying).length >= MAX_OBJECTS) { toast('MAX OBJECTS - disintegrate some first (fist hold)'); return null; }
  const o = make();
  if (at) o.group.position.copy(at);
  else {
    // find a free spot so new objects don't spawn inside existing ones
    let best = null, bestGap = -Infinity;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const spanX = Math.max(1, halfH * camera.aspect - 1.6), spanY = Math.max(0.5, halfH - 2.0);
    for (let i = 0; i < 40; i++) {
      const c = new THREE.Vector3((Math.random() * 2 - 1) * spanX, (Math.random() * 2 - 0.8) * spanY, (Math.random() - 0.5) * 2);
      const gap = Math.min(99, ...objects.filter((x) => !x.dying).map((x) => c.distanceTo(x.group.position) - x.worldRadius));
      if (gap > bestGap) { bestGap = gap; best = c; }
    }
    o.group.position.copy(best);
  }
  scene.add(o.group);
  objects.push(o);
  particles.burst(o.group.position, COLORS.cyan, 250, 3, 0.4);
  sfx.spawn();
  toast(`${o.name} MATERIALIZED`);
  return o;
}

function clearAll() {
  focus.reset();
  for (const o of objects) interaction.destroy(o);
  toast('ALL CLEAR');
}

const interaction = new Interaction({ scene, camera, objects, particles, sfx, toast, onSpawn: spawn, onClear: clearAll });
const focus = new FocusManager({ scene, objects, sfx, toast, particles });
focus.interaction = interaction;
interaction.focus = focus;

// ---------------- layout ----------------
function updateCover() {
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  if (!innerWidth || !innerHeight) return;            // hidden / zero-size window: keep the last mapping
  const va = vw / vh, sa = innerWidth / innerHeight;
  const s = sa > va ? { sx: 1, sy: va / sa } : { sx: sa / va, sy: 1 };
  bgMat.uniforms.uScale.value.set(s.sx, s.sy);
  interaction.mapping = s;
}
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
  updateCover();
}
addEventListener('resize', onResize);
video.addEventListener('loadedmetadata', updateCover);

// ---------------- keyboard ----------------
addEventListener('keydown', async (e) => {
  if (e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  const types = ['planet', 'reactor', 'engine', 'dna', 'hypercube'];
  if (k >= '1' && k <= '5') spawn(types[Number(k) - 1]);
  else if (k === 'p') interaction.togglePen();
  else if (k === 'x') clearAll();
  else if (k === 'h') $('help').classList.toggle('off');
  else if (k === 't') toggleTuning();
  else if ((k === 'b' || k === 'escape') && focus.depth) focus.back();
  else if (k === 'm') toast(sfx.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
  else if (k === 'v') { bgMat.uniforms.uShow.value = bgMat.uniforms.uShow.value ? 0 : 1; toast(bgMat.uniforms.uShow.value ? 'CAMERA BACKGROUND ON' : 'CAMERA BACKGROUND OFF'); }
  else if (k === 'f') { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }
  else if (k === 'c') {
    if (!tracker.cameraOk) return toast('NO CAMERA');
    try { const label = await tracker.nextCamera(); toast(label ? `CAMERA: ${label.toUpperCase()}` : 'ONLY ONE CAMERA FOUND'); updateCover(); }
    catch { toast('COULD NOT SWITCH CAMERA'); }
  } else if ((k === 'delete') && interaction.mouse.hoverObj) interaction.destroy(interaction.mouse.hoverObj);
});

// ---------------- tuning panel (key T) ----------------
function buildTuning() {
  const el = $('tuning');
  el.innerHTML = '<div class="title">TRACKING TUNING <span>// T to close</span></div>' + TUNABLES.map((t) => `
    <label><span>${t.label}</span><b id="tv-${t.key}"></b>
    <input type="range" min="${t.min}" max="${t.max}" step="${t.step}" data-key="${t.key}"></label>`).join('') +
    '<div class="tune-hint">Slow + steady: lower smoothing. Laggy on fast moves: raise responsiveness.</div>' +
    '<button id="tune-reset">RESET DEFAULTS</button>';
  const sync = () => TUNABLES.forEach((t) => {
    el.querySelector(`input[data-key="${t.key}"]`).value = CONFIG[t.key];
    $(`tv-${t.key}`).textContent = (+CONFIG[t.key]).toFixed(t.step < 0.01 ? 3 : t.step < 1 ? 2 : 0);
  });
  el.addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    CONFIG[key] = parseFloat(e.target.value);
    saveConfig();
    sync();
  });
  $('tune-reset').addEventListener('click', () => { resetConfig(); sync(); toast('TUNING RESET'); });
  sync();
}
function toggleTuning() { $('tuning').classList.toggle('show'); }
buildTuning();

// ---------------- boot sequence ----------------
const log = (text, cls = '') => {
  const d = document.createElement('div');
  d.innerHTML = `&gt; ${text}`;
  if (cls) d.className = cls;
  $('boot-log').appendChild(d);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TESTING = new URLSearchParams(location.search).has('test');
async function boot() {
  if ($('start').disabled) return;
  $('start').disabled = true;
  sfx.init();
  sfx.boot();
  log('Initializing holographic projector...');
  await wait(350);
  log('Loading neural hand-tracking model...');
  let trackingOk = true;
  try {
    await tracker.initModel();
    log(`Hand tracking online (${tracker.delegate})`, 'ok');
  } catch (e) {
    trackingOk = false;
    log('Hand model failed to load - mouse mode', 'err');
    console.error(e);
  }
  if (trackingOk && !TESTING) {
    log('Requesting camera...');
    try {
      await tracker.startCamera();
      bgMat.uniforms.uHas.value = 1;
      updateCover();
      log(`Camera online: ${tracker.currentLabel}`, 'ok');
    } catch (e) {
      log('No camera access - using mouse instead', 'err');
      console.error(e);
    }
  }
  $('st-tracking').textContent = tracker.cameraOk ? `HANDS/${tracker.delegate}` : 'MOUSE';
  await wait(500);
  log('All systems nominal.', 'ok');
  await wait(400);
  $('boot').classList.add('gone');
  $('hud').classList.remove('hidden');
  spawn('planet', new THREE.Vector3(-2.4, 0.2, 0));
  setTimeout(() => spawn('reactor', new THREE.Vector3(2.6, 0.3, 0)), 500);
  setTimeout(() => toast(tracker.cameraOk ? 'PINCH AN OBJECT TO GRAB IT' : 'NO CAMERA: CLICK + DRAG OBJECTS, RIGHT-DRAG TO SPIN, WHEEL TO RESIZE', 3500), 1300);
}
$('start').addEventListener('click', boot);
if (new URLSearchParams(location.search).has('test')) {
  (async () => {
    await boot();
    const { runTests } = await import('./dev/sim.js');
    await runTests(window.holo);
  })();
}

// ---------------- render loop ----------------
let last = performance.now(), t = 0, fps = 60, hudTimer = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  sharedTime.value = t;

  const res = tracker.detect(now);
  if (res) interaction.setHandResults(res, video.videoWidth, video.videoHeight, now / 1000);
  interaction.update(dt, now / 1000);

  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    o.update(dt, t);
    if (o.dying && o.dieT >= 1) { scene.remove(o.group); o.dispose(); objects.splice(i, 1); }
  }
  particles.update(dt);
  updateDust(dt);
  projector.rotation.y += dt * 0.2;

  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  hudTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    $('st-hands').textContent = interaction.handCount;
    $('st-objects').textContent = objects.filter((o) => !o.dying).length;
    $('st-mode').textContent = interaction.penMode ? 'LIGHT PEN' : 'MANIPULATE';
    $('st-fps').textContent = Math.round(fps);
  }
  composer.render(dt);
}
requestAnimationFrame(frame);
onResize();

// handy for debugging in the browser console
window.holo = { scene, camera, objects, interaction, focus, spawn, clearAll, tracker, bloom, CONFIG, THREE };
