// "Make me a rocket": your local AI (Ollama, via run.py) describes the object as simple shapes
// and HOW THEY ATTACH ("Head on top of Torso", "Arm on the left of Torso, mirrored",
// "Leg under Seat, 4 at the corners"). This file turns that into exact positions, so the geometry
// is correct by construction even though small AI models are bad at coordinates.
//
// The JSON is validated and clamped first, so bad AI output can never crash the app.
// The attachment tree becomes the part tree: everything explodes along the direction it's
// attached in, and anything with parts attached to it can be drilled into.
import * as THREE from 'three';
import { COLORS, holoMesh } from './holo.js';

const SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'capsule'];
const SIDES = ['top', 'bottom', 'left', 'right', 'front', 'back', 'center'];
const ALIGNS = ['top', 'middle', 'bottom', 'center', 'front', 'back', 'left', 'right'];
const POINTING = ['up', 'down', 'left', 'right', 'front', 'back'];
const NORMAL = { top: [0, 1, 0], bottom: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], front: [0, 0, 1], back: [0, 0, -1], center: [0, 0, 0] };
const OPPOSITE = { left: 'right', right: 'left', front: 'back', back: 'front', top: 'bottom', bottom: 'top', center: 'center' };
const NAMED = {
  cyan: COLORS.cyan, blue: COLORS.blue, magenta: COLORS.magenta, pink: COLORS.magenta, purple: new THREE.Color(0.7, 0.4, 1),
  gold: COLORS.gold, yellow: new THREE.Color(1, 0.9, 0.3), orange: new THREE.Color(1, 0.55, 0.2), green: COLORS.green,
  red: COLORS.red, white: COLORS.white, silver: new THREE.Color(0.8, 0.9, 1), grey: new THREE.Color(0.7, 0.8, 0.9), gray: new THREE.Color(0.7, 0.8, 0.9),
  black: new THREE.Color(0.5, 0.6, 0.8), brown: new THREE.Color(0.85, 0.55, 0.3),
};
const MAX_INPUT_PARTS = 40;      // parts the AI may describe
const MAX_INSTANCES = 60;        // after mirroring / repeating
const CACHE_KEY = 'holo-lab-generated-v2';

const num = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const text = (v, max, dflt) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : dflt);
const pick = (v, list, dflt) => (typeof v === 'string' && list.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : dflt);

function colorOf(c) {
  if (typeof c !== 'string') return COLORS.cyan;
  const k = c.trim().toLowerCase();
  if (NAMED[k]) return NAMED[k];
  if (/^#?[0-9a-f]{6}$/.test(k)) {
    const col = new THREE.Color(`#${k.replace('#', '')}`);
    const hsl = {}; col.getHSL(hsl);
    return hsl.s < 0.15 ? COLORS.cyan : new THREE.Color().setHSL(hsl.h, Math.max(0.6, hsl.s), 0.62);
  }
  return COLORS.cyan;
}

/** size is always the bounding box [width, height, depth]; 1 or 2 numbers are expanded sensibly. */
function sizeOf(v) {
  const a = (Array.isArray(v) ? v : [v]).map((x) => num(x, 0.01, 20, NaN)).filter(Number.isFinite);
  if (!a.length) return [0.3, 0.3, 0.3];
  if (a.length === 1) return [a[0], a[0], a[0]];
  if (a.length === 2) return [a[0], a[1], a[0]];
  return a.slice(0, 3);
}

// ---------------- validation ----------------
function cleanPart(p) {
  if (!p || typeof p !== 'object') return null;
  const shape = pick(p.shape, SHAPES, null);
  if (!shape) return null;
  return {
    name: text(p.name, 40, 'Part'),
    what: text(p.what, 160, ''),
    shape,
    size: sizeOf(p.size),
    color: colorOf(p.color),
    attach: text(p.attach_to, 40, null),
    side: pick(p.side, SIDES, 'top'),
    align: pick(p.align, ALIGNS, 'middle'),
    mirror: p.mirror === true,
    repeat: Math.round(num(p.repeat, 1, 8, 1)),
    pattern: pick(p.pattern, ['ring', 'corners'], null),
    axis: pick(p.axis, ['x', 'y', 'z'], 'y'),
    pointing: pick(p.pointing, POINTING, 'up'),
    inset: num(p.inset, 0, 0.9, 0.05),
    rotation: [0, 1, 2].map((i) => num(Array.isArray(p.rotation) ? p.rotation[i] : 0, -360, 360, 0)),
  };
}

/** Validate an AI design. Throws a readable error when it's unusable. */
export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('AI did not return an object');
  const parts = (Array.isArray(spec.parts) ? spec.parts : []).slice(0, MAX_INPUT_PARTS).map(cleanPart).filter(Boolean);
  if (!parts.length) throw new Error('AI design had no usable parts');
  const seen = new Map();                                          // make names unique
  for (const p of parts) {
    const k = p.name.toLowerCase();
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n > 1) p.name = `${p.name} ${n}`;
  }
  return { name: text(spec.name, 40, 'Generated Object'), description: text(spec.description, 300, ''), parts };
}

// ---------------- layout: attachments -> exact positions ----------------
const mirrorName = (name, side) => {
  const word = { left: 'Left', right: 'Right', front: 'Front', back: 'Rear' }[side];
  return word && !/\b(left|right|front|back|rear)\b/i.test(name) ? `${word} ${name}` : name;
};

function placeOne(part, parent, side, align) {
  const pc = parent.center, ph = parent.size.map((v) => v / 2), h = part.size.map((v) => v / 2), ins = part.inset;
  const c = pc.slice();
  const out = (i, sign) => pc[i] + sign * (ph[i] + h[i] - 2 * h[i] * ins);
  if (side === 'top') c[1] = out(1, 1);
  else if (side === 'bottom') c[1] = out(1, -1);
  else if (side === 'left') c[0] = out(0, -1);
  else if (side === 'right') c[0] = out(0, 1);
  else if (side === 'front') c[2] = out(2, 1);
  else if (side === 'back') c[2] = out(2, -1);
  // slide along the face
  const edge = (i, sign) => pc[i] + sign * Math.max(0, ph[i] - h[i]);
  if (side === 'top' || side === 'bottom') {
    if (align === 'front') c[2] = edge(2, 1); else if (align === 'back') c[2] = edge(2, -1);
    else if (align === 'left') c[0] = edge(0, -1); else if (align === 'right') c[0] = edge(0, 1);
  } else if (side !== 'center') {
    if (align === 'top') c[1] = edge(1, 1); else if (align === 'bottom') c[1] = edge(1, -1);
    else if ((side === 'left' || side === 'right') && align === 'front') c[2] = edge(2, 1);
    else if ((side === 'left' || side === 'right') && align === 'back') c[2] = edge(2, -1);
  }
  return c;
}

export function layoutSpec(spec) {
  const parts = spec.parts;
  const byName = new Map(parts.map((p) => [p.name.toLowerCase(), p]));
  const root = parts[0];
  // parent links; unknown / self / cyclic attachments fall back to the root
  const parentOf = new Map();
  for (const p of parts.slice(1)) {
    let par = p.attach && byName.get(p.attach.toLowerCase());
    if (!par || par === p) par = root;
    parentOf.set(p, par);
  }
  for (const p of parts.slice(1)) {                     // break cycles
    let q = parentOf.get(p), hops = 0;
    while (q && q !== root && hops++ < parts.length) { if (q === p) { parentOf.set(p, root); break; } q = parentOf.get(q); }
  }
  const kids = new Map(parts.map((p) => [p, []]));
  for (const p of parts.slice(1)) kids.get(parentOf.get(p)).push(p);

  const instances = [];
  const rootInst = { part: root, name: root.name, center: [0, 0, 0], size: root.size.slice(), parent: null, dir: [0, 0, 0], rotY: 0, children: [] };
  instances.push(rootInst);

  const add = (part, parent, side, mirrored, depth) => {
    if (depth > 8 || instances.length >= MAX_INSTANCES) return;
    const made = [];
    const mk = (center, name, dir, rotY, isMirror) => {
      if (instances.length >= MAX_INSTANCES) return;
      const inst = { part, name, center, size: part.size.slice(), parent, dir, rotY, mirrored: isMirror, side, children: [] };
      instances.push(inst); parent.children.push(inst); made.push(inst);
    };
    if (part.pattern === 'ring' || (part.repeat > 1 && part.pattern !== 'corners' && !['top', 'bottom'].includes(side))) {
      // evenly around the parent's vertical axis (fins round a rocket, legs round a pole)
      const n = Math.max(2, part.repeat);
      const ph = parent.size.map((v) => v / 2), h = part.size.map((v) => v / 2);
      const y = placeOne(part, parent, 'left', part.align)[1];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const cx = parent.center[0] + Math.cos(a) * (ph[0] + h[0] - 2 * h[0] * part.inset);
        const cz = parent.center[2] + Math.sin(a) * (ph[2] + h[0] - 2 * h[0] * part.inset);
        mk([cx, y, cz], `${part.name} ${k + 1}`, [Math.cos(a), 0, Math.sin(a)], -a, false);
      }
    } else if (part.pattern === 'corners' || (part.repeat > 1 && ['top', 'bottom'].includes(side))) {
      // the corners of the parent's top/bottom face (table legs, wheels)
      const ph = parent.size.map((v) => v / 2), h = part.size.map((v) => v / 2);
      const y = placeOne(part, parent, side === 'top' ? 'top' : 'bottom', 'middle')[1];
      const n = Math.max(2, Math.min(8, part.repeat > 1 ? part.repeat : 4));
      const corners = n === 2 ? [[-1, 0], [1, 0]] : n === 3 ? [[-1, -1], [1, -1], [0, 1]]
        : [[-1, 1], [1, 1], [-1, -1], [1, -1], [0, 1], [0, -1], [-1, 0], [1, 0]].slice(0, n);
      corners.forEach(([sx, sz], k) => {
        mk([parent.center[0] + sx * Math.max(0, ph[0] - h[0]), y, parent.center[2] + sz * Math.max(0, ph[2] - h[2])],
          `${part.name} ${k + 1}`, [sx * 0.7, side === 'top' ? 0.7 : -0.7, sz * 0.7], 0, false);
      });
    } else {
      mk(placeOne(part, parent, side, part.align), part.mirror ? mirrorName(part.name, side) : part.name, NORMAL[side].slice(), 0, false);
      if (part.mirror && OPPOSITE[side] !== side) {
        const os = OPPOSITE[side];
        mk(placeOne(part, parent, os, part.align), mirrorName(part.name, os), NORMAL[os].slice(), 0, true);
      }
    }
    // whatever is attached to this part is attached to every copy of it (mirrored copies flip left/right)
    for (const inst of made) {
      for (const k of kids.get(part)) {
        const s = inst.mirrored && OPPOSITE[k.side] !== k.side && ['left', 'right', 'front', 'back'].includes(k.side) && ['left', 'right', 'front', 'back'].includes(inst.side) ? OPPOSITE[k.side] : k.side;
        add(k, inst, s, inst.mirrored, depth + 1);
      }
    }
  };
  for (const k of kids.get(root)) add(k, rootInst, k.side, false, 1);

  // normalise: centre the whole object and scale its longest side to ~2.6 units
  const box = new THREE.Box3();
  for (const i of instances) {
    box.expandByPoint(new THREE.Vector3(...i.center.map((c, j) => c - i.size[j] / 2)));
    box.expandByPoint(new THREE.Vector3(...i.center.map((c, j) => c + i.size[j] / 2)));
  }
  const center = box.getCenter(new THREE.Vector3()).toArray();
  const scale = 2.6 / Math.max(...box.getSize(new THREE.Vector3()).toArray(), 1e-3);
  for (const i of instances) {
    i.center = i.center.map((c, j) => (c - center[j]) * scale);
    i.size = i.size.map((s) => s * scale);
  }
  return { root: rootInst, instances };
}

// ---------------- geometry (every shape fills its [w, h, d] box exactly) ----------------
function geometryFor(part, size) {
  const [w, h, d] = size;
  let g;
  const along = (geo, axis) => (axis === 'x' ? geo.rotateZ(Math.PI / 2) : axis === 'z' ? geo.rotateX(Math.PI / 2) : geo);
  switch (part.shape) {
    case 'box': g = new THREE.BoxGeometry(1, 1, 1); break;
    case 'sphere': g = new THREE.SphereGeometry(0.5, 28, 18); break;
    case 'cylinder': g = along(new THREE.CylinderGeometry(0.5, 0.5, 1, 28), part.axis); break;
    case 'capsule': g = along(new THREE.CapsuleGeometry(0.25, 0.5, 6, 16).scale(2, 1, 2), part.axis); break;
    case 'torus': g = new THREE.TorusGeometry(0.4, 0.1, 12, 48); if (part.axis === 'y') g.rotateX(Math.PI / 2); else if (part.axis === 'x') g.rotateY(Math.PI / 2); break;
    case 'cone': {
      g = new THREE.ConeGeometry(0.5, 1, 28);
      const r = { up: null, down: ['x', Math.PI], right: ['z', -Math.PI / 2], left: ['z', Math.PI / 2], front: ['x', Math.PI / 2], back: ['x', -Math.PI / 2] }[part.pointing];
      if (r) g[r[0] === 'x' ? 'rotateX' : 'rotateZ'](r[1]);
      break;
    }
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  return g.scale(w, h, d);
}

const infoFor = (inst, objName) => ({
  what: inst.part.what || `${inst.name} of the ${objName}.`,
  material: 'Designed by your local AI',
  fact: inst.children.length ? `Has ${inst.children.length} attached part${inst.children.length > 1 ? 's' : ''} - pull it out to explore.` : `Part of the ${objName}.`,
});

/** Validated + laid-out spec -> part tree definition (the attachment tree becomes the part tree). */
export function specToDef(raw) {
  const spec = validateSpec(raw);
  const { root } = layoutSpec(spec);
  const build = (inst) => () => {
    const m = holoMesh(geometryFor(inst.part, inst.size), inst.part.color);
    m.rotation.set(...inst.part.rotation.map((r) => THREE.MathUtils.degToRad(r)));
    m.rotation.y += inst.rotY;
    return m;
  };
  const explodeOf = (inst) => {
    const dir = new THREE.Vector3(...inst.dir);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    return dir.normalize().multiplyScalar(0.35 + Math.max(...inst.size) * 0.55).toArray();
  };
  const defOf = (inst, parentCenter) => ({
    name: inst.name,
    info: infoFor(inst, spec.name),
    build: build(inst),
    pos: inst.center.map((c, j) => c - parentCenter[j]),
    explode: explodeOf(inst),
    children: inst.children.length ? inst.children.map((k) => defOf(k, inst.center)) : undefined,
  });

  // top level: the main body + everything attached directly to it
  const body = { name: root.name, info: infoFor({ ...root, children: [] }, spec.name), build: build(root), pos: root.center, explode: [0, 0, 0] };
  return {
    name: spec.name,
    info: { what: spec.description || `${spec.name}, designed by your local AI.`, material: 'Simple shapes (AI design)', fact: 'Two hands + spread to explode it into its parts.' },
    view: [0.25, -0.5, 0],
    children: [body, ...root.children.map((k) => defOf(k, [0, 0, 0]))],
  };
}

// ---------------- talking to the local AI (through run.py) ----------------
/** The local AI only exists when Holo Lab runs on your own computer through run.py. */
export const AI_AVAILABLE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
export const HOSTED_AI_MSG = 'Designing new objects with AI only works in the Mac version (run.py)';

export async function aiStatus() {
  if (!AI_AVAILABLE) return { ok: false, error: HOSTED_AI_MSG };
  try {
    const r = await fetch('/api/ai-status', { cache: 'no-store' });
    return await r.json();
  } catch { return { ok: false, error: 'run.py is not running (start Holo Lab with run.py to use the AI)' }; }
}

function cacheGet(key) { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')[key] || null; } catch { return null; } }
function cachePut(key, spec) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    all[key] = spec;
    const keys = Object.keys(all);
    if (keys.length > 40) delete all[keys[0]];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

/** Ask the local AI to design `request`. Retries once on bad output. Returns a part-tree definition. */
export async function generate(request, { onStatus, cacheKey } = {}) {
  if (!AI_AVAILABLE) throw new Error(HOSTED_AI_MSG);
  const key = cacheKey || request.toLowerCase();
  const cached = cacheGet(key);
  if (cached) { onStatus && onStatus('Loaded your earlier design'); return specToDef(cached); }
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    onStatus && onStatus(attempt === 1 ? 'Designing with your local AI...' : 'That design was broken - trying again...');
    let r;
    try {
      r = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request }) });
    } catch { throw new Error('run.py is not running - start Holo Lab with run.py to use the AI'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `AI request failed (${r.status})`);
    try {
      const def = specToDef(data.spec);
      cachePut(key, data.spec);
      return def;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('AI design failed');
}
