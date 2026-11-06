// Shared holographic look: materials, labels, noise and small helpers.
import * as THREE from 'three';

export const COLORS = {
  cyan: new THREE.Color(0.25, 0.9, 1.0),
  blue: new THREE.Color(0.2, 0.5, 1.0),
  magenta: new THREE.Color(1.0, 0.3, 1.0),
  gold: new THREE.Color(1.0, 0.7, 0.25),
  green: new THREE.Color(0.35, 1.0, 0.6),
  red: new THREE.Color(1.0, 0.3, 0.4),
  white: new THREE.Color(1, 1, 1),
};

// One time uniform shared by every holo material (updated once per frame).
export const sharedTime = { value: 0 };

const HOLO_VERT = /* glsl */`
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vNormalV = normalize(normalMatrix * normal);
    vViewV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const HOLO_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uFlash;
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying vec3 vWorld;
  void main() {
    // fresnel: edges glow, faces facing you are see-through
    float f = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewV))), 2.2);
    // moving horizontal scan bands
    float scan = smoothstep(0.85, 1.0, sin(vWorld.y * 18.0 - uTime * 3.0));
    float fine = 0.5 + 0.5 * sin(vWorld.y * 140.0);
    vec3 col = uColor * (0.25 + f * 1.25 + scan * 0.35) + vec3(1.0, 0.7, 0.3) * uHover * (0.15 + f * 0.8);
    col += vec3(uFlash);
    float a = (0.04 + f * 0.6 + scan * 0.12) * (0.8 + 0.2 * fine) * uOpacity;
    gl_FragColor = vec4(col, clamp(a + uFlash, 0.0, 1.0));
  }
`;

/** See-through glowing hologram surface. */
export function holoMaterial(color = COLORS.cyan, opacity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uTime: sharedTime,
      uOpacity: { value: opacity },
      uHover: { value: 0 },
      uFlash: { value: 0 },
    },
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/** Bright glowing lines (bloom makes them shine). */
export function glowLineMaterial(color = COLORS.cyan, opacity = 0.9, boost = 1.6) {
  return new THREE.LineBasicMaterial({
    color: color.clone().multiplyScalar(boost),
    transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** Solid emissive-looking material (values > 1 bloom). */
export function glowMaterial(color = COLORS.cyan, boost = 2, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color: color.clone().multiplyScalar(boost),
    transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Mesh + glowing edge outline, the basic hologram building block. */
export function holoMesh(geometry, color = COLORS.cyan, { opacity = 1, edges = true, edgeAngle = 25, edgeOpacity = 0.8 } = {}) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, holoMaterial(color, opacity));
  group.add(mesh);
  if (edges) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, edgeAngle), glowLineMaterial(color, edgeOpacity));
    group.add(e);
  }
  return group;
}

/** Floating text label as a sprite. */
export function makeLabel(text, color = '#3ee8ff', size = 0.32) {
  const pad = 16;
  const font = '600 44px "SF Mono", Menlo, monospace';
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w; c.height = 72;
  ctx.font = font;
  ctx.fillStyle = 'rgba(2, 20, 30, 0.55)';
  ctx.fillRect(0, 0, w, 72);
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, w - 3, 69);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size * (w / 72), size, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// ---------- tiny 3-D value noise (for the procedural planet) ----------
function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 1274126177;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}
export const hash01 = (x, y) => hash3(x, y, 7);
const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf);
}

export function fbm3(x, y, z, octaves = 5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq);
    norm += amp; amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
