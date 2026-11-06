// All tuning numbers in one place. Values marked "tunable" appear in the tuning panel (key T)
// and are saved in this browser.

const DEFAULTS = {
  // --- tracking feel (tunable) ---
  smoothing: 1.2,          // One Euro min cutoff (Hz). Lower = steadier when still, but laggier
  responsiveness: 0.012,   // One Euro beta. Higher = less lag on fast moves (more jitter)
  pinchOn: 0.33,           // thumb-index distance / palm size that starts a pinch
  pinchOff: 0.48,          // ... and that ends it
  pinchReleaseMs: 80,      // pinch must stay open this long before it counts as released (sticky grab)
  depthGain: 1.3,          // how far objects move in depth when you push/pull your hand
  twistGain: 1.0,          // rotation per radian of hand twist
  grabMagnet: 1.25,        // grab zone size relative to the object

  // --- fixed ---
  depthDeadzone: 0.15,     // ignore depth changes smaller than this while holding
  twistDeadzone: 0.05,     // ~3 degrees
  minIndexReach: 0.9,      // a curled fist can look like a pinch; require the index to reach out
  handLostGrace: 0.3,      // seconds a hand may vanish before it counts as gone
  fistHold: 1.0,           // seconds of fist to disintegrate
  depthNear: 0.32, depthFar: 0.10,   // palm size (fraction of frame height) -> depth range
  zNear: 2.5, zFar: -4.5,
  pullDrillDist: 0.9,      // release a pulled-out part this far from its slot to drill into it
};

export const TUNABLES = [
  { key: 'smoothing', label: 'Smoothing (steadiness)', min: 0.2, max: 4, step: 0.05, invert: true },
  { key: 'responsiveness', label: 'Responsiveness (less lag)', min: 0, max: 0.05, step: 0.001 },
  { key: 'pinchOn', label: 'Pinch sensitivity', min: 0.2, max: 0.5, step: 0.01 },
  { key: 'pinchReleaseMs', label: 'Sticky grab (ms)', min: 0, max: 250, step: 10 },
  { key: 'depthGain', label: 'Depth sensitivity', min: 0, max: 3, step: 0.05 },
  { key: 'twistGain', label: 'Twist sensitivity', min: 0, max: 3, step: 0.05 },
  { key: 'grabMagnet', label: 'Grab zone size', min: 1, max: 2, step: 0.05 },
];

const STORE_KEY = 'holo-lab-config-v1';

function load() {
  const cfg = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    for (const t of TUNABLES) if (typeof saved[t.key] === 'number') cfg[t.key] = saved[t.key];
  } catch { /* private mode etc. - defaults are fine */ }
  cfg.pinchOff = Math.max(cfg.pinchOff, cfg.pinchOn + 0.1);
  return cfg;
}

export const CONFIG = load();

export function saveConfig() {
  CONFIG.pinchOff = Math.max(DEFAULTS.pinchOff, CONFIG.pinchOn + 0.1);
  try {
    const out = {};
    for (const t of TUNABLES) out[t.key] = CONFIG[t.key];
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch { /* ignore */ }
}

export function resetConfig() {
  for (const t of TUNABLES) CONFIG[t.key] = DEFAULTS[t.key];
  saveConfig();
}
