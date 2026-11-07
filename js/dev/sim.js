// Regression tests: synthetic hands are fed through the REAL hand-tracking code path
// (analyzeHand -> filters -> gestures), so these test what a real camera would do.
// Run by opening the app with ?test in the URL.

const VW = 1280, VH = 720;
const OPEN = { 0: [0, 0], 1: [-40, -30], 2: [-70, -60], 3: [-90, -90], 4: [-100, -120], 5: [-35, -130], 6: [-40, -180], 7: [-42, -215], 8: [-44, -245], 9: [0, -144], 10: [0, -200], 11: [0, -240], 12: [0, -270], 13: [30, -135], 14: [32, -185], 15: [33, -220], 16: [34, -248], 17: [58, -120], 18: [62, -160], 19: [64, -188], 20: [66, -210] };

function pose(name) {
  const P = JSON.parse(JSON.stringify(OPEN));
  if (name === 'pinch') P[4] = [P[8][0] + 4, P[8][1] + 4];
  if (name === 'fist') Object.assign(P, { 4: [-20, -100], 7: [-38, -150], 8: [-35, -110], 11: [0, -160], 12: [0, -120], 15: [30, -150], 16: [30, -115], 19: [58, -140], 20: [55, -105] });
  // finger gun POINTING AT THE CAMERA: the index looks short in 2-D (foreshortened) but is extended in 3-D.
  // Thumb up = cocked, thumb down against the index = fire; 'gunflick' = finger snapped upward (recoil).
  const curled = { 11: [0, -160], 12: [0, -120], 15: [30, -150], 16: [30, -115], 19: [58, -140], 20: [55, -105] };
  const towardCam = { 6: [-38, -150], 7: [-40, -160], 8: [-41, -168] };
  if (name === 'gun') Object.assign(P, curled, towardCam, { 2: [-70, -60], 3: [-100, -80], 4: [-130, -95] });
  if (name === 'gunfire') Object.assign(P, curled, towardCam, { 2: [-60, -70], 3: [-55, -120], 4: [-42, -148] });
  if (name === 'gunflick') Object.assign(P, curled, { 6: [-38, -175], 7: [-40, -200], 8: [-41, -222], 2: [-70, -60], 3: [-100, -80], 4: [-130, -95] });
  return P;
}

// depth (metres, negative = toward the camera) for the 3-D "world" landmarks of each pose
const DEPTH = {
  gun: { 6: -0.025, 7: -0.045, 8: -0.065 },
  gunfire: { 6: -0.025, 7: -0.045, 8: -0.065, 3: -0.01, 4: -0.02 },
  gunflick: { 6: -0.02, 7: -0.03, 8: -0.035 },
};
const M_PER_PX = 0.0006;   // ~8.6 cm palm

// Simulated clock: once the tests start, the harness drives the app frame by frame at exactly 60 fps,
// so results don't depend on the browser throttling a background window.
const FRAME = 1000 / 60;
let APP = null, manual = false, vnow = 0;
function step() { vnow += FRAME; APP.tick(vnow, FRAME / 1000); }
async function vsleep(ms) {
  const n = Math.ceil(ms / FRAME);
  for (let i = 0; i < n; i++) { step(); if (i % 30 === 29) await Promise.resolve(); }
}
const sleep = (ms) => (manual ? vsleep(ms) : new Promise((r) => setTimeout(r, ms)));

export async function runTests(H) {
  const I = H.interaction, V = H.THREE.Vector3;
  const results = [];
  const panel = document.createElement('div');
  panel.id = 'testpanel';
  panel.className = 'panel';
  panel.innerHTML = '<div class="title">REGRESSION TESTS <span>// running...</span></div>';
  document.body.appendChild(panel);
  await sleep(2000);   // (real time) let the boot sequence finish spawning its demo objects
  APP = H;
  vnow = performance.now();
  H.clock.manual = manual = true;

  /** landmarks whose pinch point (avg of thumb + index tips) lands on screen (sx, sy) */
  function handAt(sx, sy, p = 'open', jitter = 0) {
    const P = pose(p);
    const { sx: kx, sy: ky } = I.mapping;
    const jx = (Math.random() * 2 - 1) * jitter, jy = (Math.random() * 2 - 1) * jitter;
    const rx = 1 - ((((sx + jx) / innerWidth) - 0.5) * kx + 0.5), ry = ((((sy + jy) / innerHeight) - 0.5) * ky + 0.5);
    // anchor: pinch point normally; index tip for the gun (so the thumb moving doesn't move the aim);
    // palm centre for 'palm'
    const ids = p.startsWith('gun') ? [5] : p === 'palm' ? [0, 5, 9, 13, 17] : [4, 8];
    const ax = ids.reduce((s, i) => s + P[i][0], 0) / ids.length, ay = ids.reduce((s, i) => s + P[i][1], 0) / ids.length;
    // hand shape offsets are in camera pixels; x is mirrored on screen
    const lm = Object.keys(P).map((k) => ({ x: rx - (P[k][0] - ax) / VW, y: ry + (P[k][1] - ay) / VH, z: 0 }));
    const dz = DEPTH[p] || {};
    const world = Object.keys(P).map((k) => ({ x: P[k][0] * M_PER_PX, y: P[k][1] * M_PER_PX, z: dz[k] || 0 }));
    return { lm, world };
  }

  /** steps: [{ dur, hands: [{ from:[x,y], to:[x,y], pose, jitter }], each(now) }] - runs on the simulated clock */
  async function drive(steps) {
    let frames = 0;
    for (const s of steps) {
      const n = Math.max(1, Math.round(s.dur / FRAME));
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const hands = s.hands.map((h) => {
          const to = h.to || h.from;
          return handAt(h.from[0] + (to[0] - h.from[0]) * k, h.from[1] + (to[1] - h.from[1]) * k, h.pose || 'open', h.jitter || 0);
        });
        vnow += FRAME;
        I.setHandResults({ landmarks: hands.map((h) => h.lm), worldLandmarks: hands.map((h) => h.world) }, VW, VH, vnow / 1000);
        H.tick(vnow, FRAME / 1000);
        if (s.each) s.each(vnow);
        if (++frames % 30 === 0) await Promise.resolve();
      }
    }
  }
  const hold = (x, y, p, dur = 150) => ({ dur, hands: [{ from: [x, y], pose: p }] });
  const move = (a, b, p, dur) => ({ dur, hands: [{ from: a, to: b, pose: p }] });

  function screenOf(world) {
    const v = world.clone().project(H.camera);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
  }
  const partNamed = (obj, name) => obj.parts.find((p) => p.def.name === name);

  async function reset() {
    if (H.shooter.active) H.shooter.stop();
    H.focus.reset();
    I.resetPointers();
    H.clearAll();
    await sleep(700);
    I.resetPointers();
  }

  async function test(name, fn) {
    try {
      await reset();
      const detail = await fn();
      results.push({ name, ok: true, detail });
    } catch (e) {
      results.push({ name, ok: false, detail: e.message || String(e) });
      console.error(name, e);
    }
    render();
  }
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

  function render(done = false) {
    const pass = results.filter((r) => r.ok).length;
    panel.innerHTML = `<div class="title">REGRESSION TESTS <span>// ${done ? `${pass}/${results.length} passed` : 'running...'}</span></div>` +
      results.map((r) => `<div class="${r.ok ? 'pass' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'} &nbsp;${r.name}${r.detail ? ` <span style="opacity:.6">- ${r.detail}</span>` : ''}</div>`).join('');
  }

  // =====================================================================================
  await test('grab, drag & throw (bounces, stays on screen)', async () => {
    const o = H.spawn('planet', new V(-2, 0, 0));
    await sleep(800);
    const [x, y] = screenOf(o.group.position);
    let grabbed = false;
    await drive([hold(x, y, 'open', 200), hold(x, y, 'pinch', 150),
      { ...move([x, y], [x + 200, y - 40], 'pinch', 600), each: () => { grabbed ||= I.hands[0].state === 'grab'; } },
      move([x + 200, y - 40], [x + 440, y - 170], 'pinch', 110), hold(x + 445, y - 172, 'open', 150)]);
    const speed = o.velocity.length();
    expect(grabbed, 'never entered grab state');
    expect(speed > 3, `throw too slow (${speed.toFixed(1)})`);
    await sleep(1800);
    const halfW = Math.tan(H.THREE.MathUtils.degToRad(H.camera.fov / 2)) * (H.camera.position.z - o.group.position.z) * H.camera.aspect;
    expect(Math.abs(o.group.position.x) <= halfW, 'object left the screen');
    return `throw speed ${speed.toFixed(1)}`;
  });

  await test('sticky pinch: 2-frame dropout does not drop the object', async () => {
    const o = H.spawn('planet', new V(0, 0, 0));
    await sleep(800);
    const [x, y] = screenOf(o.group.position);
    let dropped = false;
    await drive([hold(x, y, 'open', 200), hold(x, y, 'pinch', 300),
      { dur: 33, hands: [{ from: [x, y], pose: 'open' }], each: () => { dropped ||= !o.held; } },
      { dur: 300, hands: [{ from: [x, y], pose: 'pinch' }], each: () => { dropped ||= !o.held; } }]);
    expect(!dropped, 'object was dropped during a 33 ms flicker');
    await drive([hold(x, y, 'open', 250)]);
    expect(!o.held, 'object not released after a real release');
  });

  await test('jitter: +-3 px hand noise -> under 1 px cursor wobble', async () => {
    const x = innerWidth * 0.3, y = innerHeight * 0.3, samples = [];
    await drive([{ dur: 1500, hands: [{ from: [x, y], pose: 'open', jitter: 3 }], each: (now) => { samples.push(I.hands[0].screen.x); } }]);
    const tail = samples.slice(Math.floor(samples.length / 3));
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const sd = Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
    expect(sd < 1, `cursor std dev ${sd.toFixed(2)} px`);
    return `std dev ${sd.toFixed(2)} px`;
  });

  await test('fast move: cursor catches up within 120 ms', async () => {
    const a = [innerWidth * 0.2, innerHeight * 0.4], b = [innerWidth * 0.75, innerHeight * 0.4];
    let errAfter = 0;
    await drive([hold(...a, 'open', 300), move(a, b, 'open', 250), hold(...b, 'open', 120)]);
    errAfter = Math.abs(I.hands[0].screen.x - b[0]);
    expect(errAfter < 15, `still ${errAfter.toFixed(0)} px behind`);
    return `${errAfter.toFixed(1)} px behind after 120 ms`;
  });

  await test('open-palm swipe spins both directions', async () => {
    const o = H.spawn('dna', new V(0, 0, 0));
    await sleep(800);
    const [x, y] = screenOf(o.group.position);
    await drive([hold(x - 150, y - 70, 'open', 150), move([x - 150, y - 70], [x + 150, y - 70], 'open', 450)]);
    const right = o.angVel.y;
    o.angVel.set(0, 0, 0);
    await drive([hold(x + 150, y - 70, 'open', 150), move([x + 150, y - 70], [x - 150, y - 70], 'open', 450)]);
    const left = o.angVel.y;
    expect(right > 1 && left < -1, `spin right ${right.toFixed(2)}, left ${left.toFixed(2)}`);
    return `+${right.toFixed(1)} / ${left.toFixed(1)}`;
  });

  await test('fist held 1 s disintegrates', async () => {
    const o = H.spawn('reactor', new V(0, 0, 0));
    await sleep(800);
    const [x, y] = screenOf(o.group.position);
    await drive([hold(x, y + 60, 'fist', 1300)]);
    expect(o.dying, 'object not disintegrated');
  });

  await test('two-hand spread explodes the engine', async () => {
    const o = H.spawn('engine', new V(0, 0, 0));
    await sleep(800);
    const [x, y] = screenOf(o.group.position);
    await drive([
      { dur: 200, hands: [{ from: [x - 40, y], pose: 'open' }, { from: [x + 40, y + 10], pose: 'open' }] },
      { dur: 200, hands: [{ from: [x - 40, y], pose: 'pinch' }, { from: [x + 40, y + 10], pose: 'pinch' }] },
      { dur: 700, hands: [{ from: [x - 40, y], to: [x - 220, y], pose: 'pinch' }, { from: [x + 40, y + 10], to: [x + 220, y + 10], pose: 'pinch' }] },
      { dur: 200, hands: [{ from: [x - 220, y], pose: 'open' }, { from: [x + 220, y + 10], pose: 'open' }] },
    ]);
    expect(o.explodeTarget > 0.9, `explode only ${o.explodeTarget.toFixed(2)}`);
    expect(!o.held, 'still held after release');
  });

  async function explodedEngine() {
    const o = H.spawn('engine', new V(0, -0.2, 0));
    o.explodeTarget = 1;
    await sleep(1500);
    return o;
  }

  async function pullOut(obj, partName, dx = 0, dy = -320) {
    const part = partNamed(obj, partName);
    expect(part, `no part "${partName}" in ${obj.name}`);
    const [x, y] = screenOf(obj.partWorldCenter(part));
    let pulled = false;
    await drive([hold(x, y, 'open', 200), hold(x, y, 'pinch', 150),
      { ...move([x, y], [x + dx, y + dy], 'pinch', 450), each: () => { pulled ||= I.hands[0].state === 'pull'; } },
      hold(x + dx, y + dy, 'open', 200)]);
    expect(pulled, `pinching "${partName}" did not start a pull (hover: ${I.hands[0].hoverPart?.def.name || 'none'})`);
    return part;
  }

  await test('pulled part released near its slot snaps back', async () => {
    const o = await explodedEngine();
    const part = await pullOut(o, 'Oil Pan', 25, 20);
    await sleep(600);
    expect(H.focus.depth === 0, 'drilled in by accident');
    expect(part.pullOffset.length() < 0.05, 'part did not return to its slot');
  });

  await test('drill chain: engine > pistons > piston 2 > rod, then back x3', async () => {
    const o = await explodedEngine();
    await pullOut(o, 'Pistons & Connecting Rods', 0, -300);
    expect(H.focus.depth === 1, `depth ${H.focus.depth} after first drill`);
    await sleep(1000);
    // ghosts can't be grabbed
    const [ex, ey] = screenOf(o.group.position);
    expect(I.pick(ex, ey) !== o, 'ghosted engine is still pickable');
    let top = H.focus.top;
    top.explodeTarget = 1; await sleep(1300);
    await pullOut(top, 'Piston Assembly 2', 0, -280);
    expect(H.focus.depth === 2, `depth ${H.focus.depth} after second drill`);
    await sleep(1000);
    top = H.focus.top;
    top.explodeTarget = 1; await sleep(1300);
    await pullOut(top, 'Connecting Rod Assembly', 260, 0);
    expect(H.focus.depth === 3, `depth ${H.focus.depth} after third drill`);
    await sleep(1000);
    const crumbs = [...document.querySelectorAll('#crumbs button:not(.crumb-back)')].map((b) => b.textContent);
    expect(crumbs.join(' > ') === 'V4 ENGINE > PISTONS & CONNECTING RODS > PISTON ASSEMBLY 2 > CONNECTING ROD ASSEMBLY', `crumbs: ${crumbs.join(' > ')}`);
    H.focus.back(); await sleep(800);
    H.focus.back(); await sleep(800);
    H.focus.back(); await sleep(900);
    expect(H.focus.depth === 0, 'did not return to top level');
    expect(o.parts.every((p) => !p.hidden && p.holder.visible), 'a part is still hidden');
    expect(H.objects.filter((x) => !x.dying).length === 1, `objects: ${H.objects.length}`);
    expect(o.pickable, 'engine not interactive again');
    return 'crumbs + ghosting + back OK';
  });

  await test('10 drill/back cycles: nothing lost or duplicated', async () => {
    const o = await explodedEngine();
    for (let i = 0; i < 10; i++) {
      const part = o.parts[i % o.parts.length];
      H.focus.drill(o, part);
      await sleep(250);
      H.focus.back();
      await sleep(700);
    }
    expect(H.focus.depth === 0, 'stack not empty');
    expect(H.objects.length === 1, `objects: ${H.objects.length}`);
    expect(o.parts.every((p) => !p.hidden && p.holder.visible), 'a part is still hidden');
  });

  await test('second hand turns a part-pull into a two-hand grab', async () => {
    const o = await explodedEngine();
    const part = partNamed(o, 'Oil Pan');
    const [x, y] = screenOf(o.partWorldCenter(part));
    const [cx, cy] = screenOf(o.group.position);
    await drive([
      { dur: 200, hands: [{ from: [x, y], pose: 'open' }] },
      { dur: 200, hands: [{ from: [x, y], pose: 'pinch' }] },
      { dur: 200, hands: [{ from: [x, y], pose: 'pinch' }, { from: [cx + 330, cy - 200], pose: 'open' }] },
      { dur: 200, hands: [{ from: [x, y], pose: 'pinch' }, { from: [cx + 330, cy - 200], pose: 'pinch' }] },
      { dur: 500, hands: [{ from: [x, y], to: [x - 60, y + 60], pose: 'pinch' }, { from: [cx + 330, cy - 200], to: [cx + 140, cy - 80], pose: 'pinch' }] },
    ]);
    expect(o.heldBy.size === 2, `held by ${o.heldBy.size} hands`);
    expect(o.explodeTarget < 0.9, 'squeezing did not collapse the explode');
    await drive([{ dur: 200, hands: [{ from: [x - 60, y + 60], pose: 'open' }, { from: [cx + 140, cy - 80], pose: 'open' }] }]);
  });

  await test('pinching a dock button spawns', async () => {
    const btn = document.querySelector('#dock button[data-action="hypercube"]');
    const r = btn.getBoundingClientRect();
    const n0 = H.objects.length;
    await drive([hold(r.x + r.width / 2, r.y + r.height / 2, 'open', 250), hold(r.x + r.width / 2, r.y + r.height / 2, 'pinch', 150), hold(r.x + r.width / 2, r.y + r.height / 2, 'open', 200)]);
    expect(H.objects.length === n0 + 1, 'no object spawned');
  });

  await test('light pen draws a grabbable sculpture', async () => {
    I.togglePen(true);
    const cx = innerWidth / 2, cy = innerHeight * 0.3;
    const steps = [hold(cx + 80, cy, 'open', 150)];
    for (let k = 0; k < 24; k++) {
      const a0 = (k / 24) * Math.PI * 2, a1 = ((k + 1) / 24) * Math.PI * 2;
      steps.push(move([cx + Math.cos(a0) * 80, cy + Math.sin(a0) * 60], [cx + Math.cos(a1) * 80, cy + Math.sin(a1) * 60], 'pinch', 30));
    }
    steps.push(hold(cx + 80, cy, 'open', 200));
    await drive(steps);
    I.togglePen(false);
    expect(H.objects.some((o) => o.type === 'sculpture'), 'no sculpture created');
  });

  // =================================== HOLO SHOOTER ===================================
  const G = H.shooter;
  async function startGame() {
    G.start();
    G.setState('playing');      // skip the intro countdown
    G.wave = 1;
    G.bannerUntil = 0;
    G.queue = [{ at: Infinity }];   // placeholder: stops the empty wave from counting as "cleared"
    await sleep(300);
  }
  const gunHold = (x, y, p, dur) => ({ dur, hands: [{ from: [x, y], pose: p }] });

  await test('finger gun pointed at the camera is recognised (3-D)', async () => {
    await startGame();
    let seen = 0, frames = 0;
    await drive([{ dur: 500, hands: [{ from: [innerWidth * 0.4, innerHeight * 0.5], pose: 'gun' }], each: () => { frames++; if (I.hands[0].gunPose) seen++; } }]);
    expect(seen / frames > 0.8, `gun pose seen in ${seen}/${frames} frames`);
  });

  await test('recoil flick fires exactly one shot', async () => {
    await startGame();
    const x = innerWidth * 0.3, y = innerHeight * 0.55;
    await drive([gunHold(x, y, 'gun', 400), gunHold(x, y, 'gunflick', 40), gunHold(x, y, 'gun', 400)]);
    expect(G.shots === 1, `flick fired ${G.shots} shots`);
    expect(G.lastWhy === 'recoil flick', `fired by ${G.lastWhy}`);
  });

  await test('finger gun: one shot per trigger pull, no auto-fire, debounce', async () => {
    await startGame();
    const x = innerWidth * 0.3, y = innerHeight * 0.55;
    await drive([gunHold(x, y, 'gun', 300), gunHold(x, y, 'gunfire', 400)]);
    expect(G.shots === 1, `holding the trigger fired ${G.shots} shots (expected 1)`);
    await drive([gunHold(x, y, 'gun', 200), gunHold(x, y, 'gunfire', 200)]);
    expect(G.shots === 2, `second pull: ${G.shots} shots`);
    // re-pull faster than the debounce: must NOT fire
    await drive([gunHold(x, y, 'gun', 200), gunHold(x, y, 'gunfire', 40), gunHold(x, y, 'gun', 30), gunHold(x, y, 'gunfire', 200)]);
    expect(G.shots === 3, `fast double pull gave ${G.shots - 2} shots (expected 1)`);
    return `${G.shots} shots`;
  });

  await test('aiming the finger gun at a drone destroys it', async () => {
    await startGame();
    G.difficulty = 0.0001;                       // freeze its movement
    const d = G.spawnDrone('basic', new V(-1.5, 0.5, -3));
    d.fireIn = 999;
    await sleep(800);
    const [tx, ty] = screenOf(d.group.position);
    // find where the crosshair lands for a given hand position, then shift the hand onto the target
    const hx = innerWidth * 0.5, hy = innerHeight * 0.6;
    await drive([gunHold(hx, hy, 'gun', 350)]);
    const a = I.hands[0].aim;
    const nx = hx + (tx - a.x) / H.CONFIG.aimGain, ny = hy + (ty - a.y) / H.CONFIG.aimGain;   // aim is amplified
    await drive([move([hx, hy], [nx, ny], 'gun', 300), gunHold(nx, ny, 'gun', 300), gunHold(nx, ny, 'gunfire', 200)]);
    expect(!d.alive, `drone survived (shots ${G.shots}, hits ${G.hits})`);
    expect(G.score > 0, 'no score');
    return `score ${G.score}`;
  });

  await test('open palm shield blocks shots only where it is', async () => {
    await startGame();
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const h0 = G.health;
    // palm right over the incoming shot
    G.spawnPlasma(new V(0, 0, 7.6), new V(0, 0, 10), 3);
    await drive([{ dur: 900, hands: [{ from: [cx, cy], pose: 'palm' }] }]);
    expect(G.health === h0, `shield did not block (health ${G.health})`);
    // palm far away: the shot gets through
    G.spawnPlasma(new V(0, 0, 7.6), new V(0, 0, 10), 3);
    await drive([{ dur: 900, hands: [{ from: [innerWidth * 0.12, innerHeight * 0.2], pose: 'palm' }] }]);
    expect(G.health === h0 - 10, `unblocked shot did ${h0 - G.health} damage (expected 10)`);
  });

  await test('fist reloads an empty magazine', async () => {
    await startGame();
    G.ammo = 0;
    await drive([{ dur: 1100, hands: [{ from: [innerWidth * 0.4, innerHeight * 0.5], pose: 'fist' }] }]);
    expect(G.ammo === H.CONFIG.magazine, `ammo ${G.ammo} after reload`);
  });

  await test('game over, then restart', async () => {
    await startGame();
    G.health = 5;
    G.spawnPlasma(new V(0, 0, 7.6), new V(0, 0, 10), 4);
    await sleep(900);
    expect(G.state === 'over', `state ${G.state}`);
    G.stateT = 2;
    const x = innerWidth * 0.2, y = innerHeight * 0.7;
    await drive([gunHold(x, y, 'gun', 250), gunHold(x, y, 'gunfire', 200)]);
    expect(G.state === 'intro' && G.health === H.CONFIG.maxHealth, `after restart: ${G.state}, health ${G.health}`);
  });

  await test('lab -> game -> lab keeps every lab object', async () => {
    const a = H.spawn('planet', new V(-2, 0, 0));
    const b = H.spawn('engine', new V(2, 0, 0));
    await sleep(700);
    G.start();
    await sleep(300);
    expect(!a.group.visible && !b.group.visible, 'lab objects visible during the game');
    expect(I.mode === 'game', 'interaction not in game mode');
    G.stop();
    await sleep(200);
    expect(a.group.visible && b.group.visible && H.objects.length === 2, 'lab not restored');
    expect(I.mode === 'lab' && !G.root.children.length, 'game leftovers');
  });

  // =================================== VOICE -> OBJECT ===================================
  await test('matcher: everyday phrases find the right built-in object', async () => {
    const cases = [
      ['show me a planet', 'planet'], ['spawn the car engine please', 'engine'], ['can you make a tesseract', 'hypercube'],
      ['give me a dna strand', 'dna'], ['arc reactor', 'reactor'], ['show me the earth', 'planet'], ['motor', 'engine'],
    ];
    const bad = cases.filter(([q, id]) => { const m = H.library.match(q)[0]; return !m || m.entry.id !== id || m.score < 0.6; })
      .map(([q]) => `"${q}" -> ${H.library.match(q)[0]?.entry.id || 'nothing'} ${H.library.match(q)[0]?.score.toFixed(2) || ''}`);
    expect(!bad.length, bad.join('; '));
    const giraffe = H.library.match('a giraffe')[0];
    expect(!giraffe || giraffe.score < 0.35, `"a giraffe" wrongly matched ${giraffe?.entry.id} (${giraffe?.score.toFixed(2)})`);
    return `${cases.length} phrases OK, unknown objects go to the AI`;
  });

  await test('typed request spawns from the library; vague request offers choices', async () => {
    const o = await H.handleRequest('show me the car engine please');
    expect(o && o.name === 'V4 ENGINE' && H.objects.includes(o), 'engine not spawned');
    await H.handleRequest('a cube');
    const chips = [...document.querySelectorAll('#cmd-chips button')].map((b) => b.textContent);
    expect(chips.some((c) => c.includes('TESSERACT')) && chips.some((c) => c.includes('WITH AI')), `chips: ${chips.join(' | ')}`);
    document.getElementById('cmd-chips').innerHTML = '';
  });

  await test('a .glb model becomes an explodable, drillable part tree', async () => {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const src = H.spawn('engine', new V(0, 0, 0));
    await sleep(800);
    const glb = await new GLTFExporter().parseAsync(src.content, { binary: true });
    H.clearAll(); await sleep(600);
    const meta = { id: 'test_engine', name: 'Exported Engine', source: 'test', license: 'test' };
    const def = await H.library.defFromBuffer(glb, meta);
    expect(!def.solid && def.children.length >= 5, `only ${def.children?.length || 0} parts found`);
    const { AssemblyObject } = await import('../parts.js');
    const a = H.addObject(new AssemblyObject(def), new V(-1.5, 0, 0));
    const b = H.addObject(new AssemblyObject(def), new V(1.5, 0, 0));
    a.explodeTarget = 1; await sleep(1200);
    const piston = a.parts.find((p) => /piston/i.test(p.def.name)) || a.parts[0];
    H.focus.drill(a, piston); await sleep(1000);
    expect(H.focus.depth === 1, 'could not drill into a part of the model');
    H.focus.back(); await sleep(900);
    I.destroy(b); await sleep(600);       // destroying one copy must not break the other (shared geometry)
    let ok = true;
    a.group.traverse((o) => { if (o.isMesh && !o.geometry.attributes.position) ok = false; });
    expect(ok, 'geometry of the remaining copy was disposed');
    return `${def.children.length} top-level parts`;
  });

  await test('AI designs are validated: garbage never crashes, good ones explode', async () => {
    const { validateSpec, specToDef } = await import('../generate.js');
    const bads = [null, 42, {}, { parts: [] }, { parts: [{ shape: 'blob', size: 'big' }] }];
    for (const b of bads) { let threw = false; try { validateSpec(b); } catch { threw = true; } expect(threw, `accepted garbage: ${JSON.stringify(b)}`); }
    // 200 parts with broken numbers + a mirrored, repeated part: limits must hold
    const huge = { name: 'x', parts: Array.from({ length: 200 }, (_, i) => ({ name: `p${i}`, shape: 'box', size: [NaN, 1e9, -5], attach_to: 'p0', mirror: true, repeat: 8, pattern: 'ring' })) };
    const v = validateSpec(huge);
    expect(v.parts.length <= 40 && v.parts.every((p) => p.size.every((s) => Number.isFinite(s) && s > 0 && s <= 20)), 'input limits not enforced');
    const { layoutSpec } = await import('../generate.js');
    expect(layoutSpec(v).instances.length <= 60, 'instance limit not enforced');
    // cyclic / unknown attachments must not hang or crash
    specToDef({ name: 'loop', parts: [{ name: 'A', shape: 'box', size: [1, 1, 1] }, { name: 'B', shape: 'box', size: [1, 1, 1], attach_to: 'C' }, { name: 'C', shape: 'box', size: [1, 1, 1], attach_to: 'B' }, { name: 'D', shape: 'sphere', size: [1], attach_to: 'nobody' }] });

    const robot = {
      name: 'Robot', description: 'test robot',
      parts: [
        { name: 'Torso', shape: 'box', size: [1, 1.2, 0.6] },
        { name: 'Head', shape: 'box', size: [0.7, 0.6, 0.6], attach_to: 'Torso', side: 'top' },
        { name: 'Eye', shape: 'sphere', size: [0.15, 0.15, 0.1], attach_to: 'Head', side: 'front', inset: 0.3 },
        { name: 'Arm', shape: 'capsule', size: [0.22, 1, 0.22], attach_to: 'Torso', side: 'left', align: 'top', mirror: true },
        { name: 'Hand', shape: 'sphere', size: [0.26], attach_to: 'Arm', side: 'bottom' },
        { name: 'Leg', shape: 'capsule', size: [0.3, 1.1, 0.3], attach_to: 'Torso', side: 'bottom', repeat: 2, pattern: 'corners' },
      ],
    };
    const lay = layoutSpec(validateSpec(robot)).instances;
    const get = (n) => lay.find((i) => i.name === n);
    const torso = get('Torso'), head = get('Head'), la = get('Left Arm'), ra = get('Right Arm');
    expect(head && head.center[1] > torso.center[1] + 0.3, 'head is not on top of the torso');
    expect(la && ra && la.center[0] < torso.center[0] - torso.size[0] / 2 && ra.center[0] > torso.center[0] + torso.size[0] / 2, 'arms are not outside the torso');
    expect(lay.filter((i) => i.part.name === 'Hand').length === 2, 'each arm should get its own hand');
    const legs = lay.filter((i) => i.part.name === 'Leg');
    expect(legs.length === 2 && legs[0].center[0] !== legs[1].center[0], 'legs overlap');

    const { AssemblyObject } = await import('../parts.js');
    const r = H.addObject(new AssemblyObject(specToDef(robot)), new V(0, 0, 0));
    r.explodeTarget = 1; await sleep(1200);
    expect(r.explodable && r.parts.length === 6, `robot top level has ${r.parts.length} parts (body, head, 2 arms, 2 legs)`);
    const arm = r.parts.find((p) => p.def.name === 'Left Arm');
    H.focus.drill(r, arm); await sleep(1000);
    expect(H.focus.top && H.focus.top.parts.length === 1 && H.focus.top.parts[0].def.name === 'Hand', 'arm should drill down to its hand');
    H.focus.back(); await sleep(900);
    return 'robot laid out correctly; arm drills down to its hand';
  });

  await reset();
  H.clock.manual = manual = false;
  render(true);
  window.__testResults = results;
  console.log('[tests]', results.filter((r) => r.ok).length, '/', results.length, 'passed', results);
  return results;
}
