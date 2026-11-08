// Object library: built-in holograms + downloaded 3-D models (library/index.json),
// plus fuzzy matching from spoken / typed words to an object.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { gltfToDef } from './gltfparts.js';

export const BUILTINS = [
  { id: 'planet', kind: 'builtin', name: 'Planet', aliases: ['earth', 'globe', 'world', 'planet earth', 'moon', 'solar system'], tags: ['space'] },
  { id: 'reactor', kind: 'builtin', name: 'Arc Reactor', aliases: ['reactor', 'arc reactor', 'power core', 'energy core', 'iron man reactor'], tags: ['energy'] },
  { id: 'engine', kind: 'builtin', name: 'V4 Engine', aliases: ['engine', 'car engine', 'motor', 'inline four', 'four cylinder engine', 'combustion engine', 'petrol engine'], tags: ['mechanical', 'car'] },
  { id: 'dna', kind: 'builtin', name: 'DNA Helix', aliases: ['dna', 'helix', 'double helix', 'gene', 'genome', 'dna strand'], tags: ['biology'] },
  { id: 'hypercube', kind: 'builtin', name: 'Tesseract', aliases: ['hypercube', 'tesseract', '4d cube', 'four dimensional cube'], tags: ['math'] },
];

// ---------------- text matching ----------------
const FILLER = /\b(please|can you|could you|would you|i want|i'd like|i would like|show me|show|spawn|create|make|build|give me|bring up|bring|display|open|load|generate|draw|design|let me see|let's see|a|an|the|some|me|of|hologram|holographic|model|3d|object|now|for me)\b/g;

export function normalise(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
}

const singular = (w) => (w.length > 3 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokens = (s) => s.split(' ').filter(Boolean).map(singular);

function lev(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
const wordSim = (a, b) => (a === b ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length));

/** 0..1 how well a query matches one phrase (name or alias). */
function phraseScore(qTokens, phrase) {
  const p = tokens(normalise(phrase) || phrase.toLowerCase());
  if (!p.length || !qTokens.length) return 0;
  if (qTokens.join(' ') === p.join(' ')) return 1;
  // each phrase word must be found (fuzzily) in the query; extra query words cost a little
  let sum = 0;
  for (const w of p) sum += Math.max(...qTokens.map((q) => { const s = wordSim(q, w); return s >= 0.75 ? s : 0; }));
  const coverage = sum / p.length;
  const extra = Math.max(0, qTokens.length - p.length) / (qTokens.length + 2);
  return Math.max(0, coverage * (1 - extra * 0.5));
}

// ---------------- library ----------------
export class Library {
  constructor() {
    this.entries = [...BUILTINS];
    this.defCache = new Map();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/');
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(draco);
  }

  async load() {
    // your downloaded library (Mac version) first; the hosted site has none, so it uses the online
    // list, whose models load straight from the Khronos sample-assets repository
    for (const url of ['library/index.json', 'web-library.json']) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const data = await r.json();
        for (const e of data.models || []) this.entries.push({ kind: 'glb', aliases: [], tags: [], ...e });
        this.source = url;
        break;
      } catch { /* try the next list */ }
    }
    return this.entries;
  }

  get downloadedCount() { return this.entries.filter((e) => e.kind === 'glb').length; }

  /** Best matches for a spoken/typed request, highest score first. */
  match(text, limit = 3) {
    const q = tokens(normalise(text));
    if (!q.length) return [];
    return this.entries
      // tags ("car" on the engine) only ever SUGGEST (max 0.5); names and aliases can auto-spawn
      .map((e) => ({ entry: e, score: Math.max(phraseScore(q, e.name), ...(e.aliases || []).map((a) => phraseScore(q, a)), ...(e.tags || []).map((t) => phraseScore(q, t) * 0.5)) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Part-tree definition for a downloaded model (cached after the first load). */
  async defFor(entry) {
    if (this.defCache.has(entry.id)) return this.defCache.get(entry.id);
    const gltf = await this.loader.loadAsync(entry.file);
    const def = gltfToDef(gltf.scene, entry);
    this.defCache.set(entry.id, def);
    return def;
  }

  /** Parse GLB bytes directly (used for drag-and-drop and tests). */
  async defFromBuffer(buffer, meta) {
    const gltf = await this.loader.parseAsync(buffer, '');
    return gltfToDef(gltf.scene, meta);
  }
}

export { THREE };
