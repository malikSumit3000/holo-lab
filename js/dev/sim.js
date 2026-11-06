// Regression tests: synthetic hands are fed through the REAL hand-tracking code path
// (analyzeHand -> filters -> gestures), so these test what a real camera would do.
// Run by opening the app with ?test in the URL.

const VW = 1280, VH = 720;
const OPEN = { 0: [0, 0], 1: [-40, -30], 2: [-70, -60], 3: [-90, -90], 4: [-100, -120], 5: [-35, -130], 6: [-40, -180], 7: [-42, -215], 8: [-44, -245], 9: [0, -144], 10: [0, -200], 11: [0, -240], 12: [0, -270], 13: [30, -135], 14: [32, -185], 15: [33, -220], 16: [34, -248], 17: [58, -120], 18: [62, -160], 19: [64, -188], 20: [66, -210] };

function pose(name) {
  const P = JSON.parse(JSON.stringify(OPEN));
  if (name === 'pinch') P[4] = [P[8][0] + 4, P[8][1] + 4];
  if (name === 'fist') Object.assign(P, { 4: [-20, -100], 7: [-38, -150], 8: [-35, -110], 11: [0, -160], 12: [0, -120], 15: [30, -150], 16: [30, -115], 19: [58, -140], 20: [55, -105] });
  // finger gun: index out, other fingers curled; thumb up (cocked) or down against the index (fire)
  const curled = { 11: [0, -160], 12: [0, -120], 15: [30, -150], 16: [30, -115], 19: [58, -140], 20: [55, -105] };
  if (name === 'gun') Object.assign(P, curled, { 2: [-70, -60], 3: [-100, -80], 4: [-130, -95] });
  if (name === 'gunfire') Object.assign(P, curled, { 2: [-60, -70], 3: [-60, -115], 4: [-48, -150] });
  return P;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runTests(H) {
  const I = H.interaction, V = H.THREE.Vector3;
  const results = [];
  const panel = document.createElement('div');
  panel.id = 'testpanel';
  panel.className = 'panel';
  panel.innerHTML = '<div class="title">REGRESSION TESTS <span>// running...</span></div>';
  document.body.appendChild(panel);
  await sleep(2000);   // let the boot sequence finish spawning its demo objects

  /** landmarks whose pinch point (avg of thumb + index tips) lands on screen (sx, sy) */
  function handAt(sx, sy, p = 'open', jitter = 0) {
    const P = pose(p);
    const { sx: kx, sy: ky } = I.mapping;
    const jx = (Math.random() * 2 - 1) * jitter, jy = (Math.random() * 2 - 1) * jitter;
    const rx = 1 - ((((sx + jx) / innerWidth) - 0.5) * kx + 0.5), ry = ((((sy + jy) / innerHeight) - 0.5) * ky + 0.5);
    // anchor: pinch point normally; index tip for the gun (so the thumb moving doesn't move the aim);
    // palm centre for 'palm'
    const ids = p.startsWith('gun') ? [8] : p === 'palm' ? [0, 5, 9, 13, 17] : [4, 8];
    const ax = ids.reduce((s, i) => s + P[i][0], 0) / ids.length, ay = ids.reduce((s, i) => s + P[i][1], 0) / ids.length;
    // hand shape offsets are in camera pixels; x is mirrored on screen
    return Object.keys(P).map((k) => ({ x: rx - (P[k][0] - ax) / VW, y: ry + (P[k][1] - ay) / VH, z: 0 }));
  }

  /** steps: [{ dur, hands: [{ from:[x,y], to:[x,y], pose, jitter }], each(now) }] */
  function drive(steps) {
    return new Promise((res) => {
      let i = 0, t0 = performance.now();
      const tick = (now) => {
        const s = steps[i];
        if (!s) return res();
        const k = Math.min(1, (now - t0) / s.dur);
        const lms = s.hands.map((h) => {
          const to = h.to || h.from;
          return handAt(h.from[0] + (to[0] - h.from[0]) * k, h.from[1] + (to[1] - h.from[1]) * k, h.pose || 'open', h.jitter || 0);
        });
        I.setHandResults({ landmarks: lms }, VW, VH, now / 1000);
        if (s.each) s.each(now);
        if (k >= 1) { i++; t0 = now; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
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
    const nx = hx + (tx - a.x), ny = hy + (ty - a.y);
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

  await reset();
  render(true);
  window.__testResults = results;
  console.log('[tests]', results.filter((r) => r.ok).length, '/', results.length, 'passed', results);
  return results;
}
