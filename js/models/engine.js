// A detailed inline-4 engine as a part tree (4 levels deep). Every part can be pulled out,
// exploded and drilled into. Geometry is procedural - no model files needed.
import * as THREE from 'three';
import { COLORS, holoMesh } from '../holo.js';
import { gearGeometry } from '../objects.js';

const X4 = [-0.66, -0.22, 0.22, 0.66];   // cylinder positions along the crankshaft

// ---------------- geometry helpers ----------------
const group = (...items) => { const g = new THREE.Group(); items.forEach((i) => g.add(i)); return g; };
const at = (obj, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { obj.position.set(x, y, z); obj.rotation.set(rx, ry, rz); return obj; };
const m = (geo, color = COLORS.cyan, opts) => holoMesh(geo, color, opts);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylY = (r, len, seg = 24) => new THREE.CylinderGeometry(r, r, len, seg);
const cylX = (r, len, seg = 24) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
const cylZ = (r, len, seg = 24) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
const ringX = (r, tube) => new THREE.TorusGeometry(r, tube, 10, 48).rotateY(Math.PI / 2);   // ring around the x axis
const ringY = (r, tube) => new THREE.TorusGeometry(r, tube, 10, 48).rotateX(Math.PI / 2);   // horizontal ring

function halfRingX(rIn, rOut, width, upper = true) {
  // half of a thick ring, axis along x (like the big end of a connecting rod)
  const s = new THREE.Shape();
  const a0 = upper ? 0 : Math.PI, a1 = upper ? Math.PI : Math.PI * 2;
  s.absarc(0, 0, rOut, a0, a1, false);
  s.absarc(0, 0, rIn, a1, a0, true);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, -width / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function profileX(radiusFn, width, steps = 48) {
  // extruded 2-D profile (cam lobe, counterweight...) facing the x axis
  const s = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2, r = radiusFn(a);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function helix(r, h, turns, tube) {
  const pts = [];
  for (let i = 0; i <= turns * 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, (i / (turns * 24)) * h - h / 2, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 24, tube, 6, false);
}

const tube = (points, r, closed = false) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed), 64, r, 8, closed);

function hexBolt(len, color = COLORS.white) {
  return group(
    at(m(cylY(0.026, 0.024, 6), color, { edgeAngle: 20 }), 0, len / 2 + 0.012),
    m(cylY(0.013, len, 10), color, { edges: false }),
  );
}

function valve(color) {
  return group(
    m(cylY(0.011, 0.3, 8), color, { edges: false }),
    at(m(new THREE.CylinderGeometry(0.012, 0.05, 0.025, 20), color), 0, -0.16),
  );
}

function sparkPlug() {
  return group(
    at(m(cylY(0.012, 0.04, 8), COLORS.white, { edges: false }), 0, 0.15),            // terminal
    at(m(new THREE.CylinderGeometry(0.018, 0.024, 0.13, 16), COLORS.white), 0, 0.07),  // ceramic insulator
    at(m(cylY(0.032, 0.035, 6), COLORS.gold), 0, -0.02),                              // hex
    at(m(cylY(0.02, 0.07, 12), COLORS.gold, { edges: false }), 0, -0.07),             // thread
    at(m(box(0.006, 0.02, 0.006), COLORS.gold, { edges: false }), 0, -0.115),         // electrode
  );
}

// ---------------- piston assembly (used 4 times) ----------------
function pistonAssembly(i) {
  return {
    name: `Piston Assembly ${i + 1}`,
    info: {
      what: 'Converts the force of burning fuel into motion. The piston is pushed down, the rod turns the crankshaft.',
      material: 'Aluminium piston, forged steel rod',
      fact: 'At 6,000 rpm each piston stops and reverses direction 200 times per second.',
    },
    pos: [X4[i], 0, 0],
    explode: [(i - 1.5) * 0.45, 0, 0],
    view: [0.25, -0.5, 0],
    children: [
      {
        name: 'Piston',
        info: { what: 'Slides up and down inside the cylinder, sealing in the explosion.', material: 'Forged aluminium alloy', fact: 'Its crown can reach about 300 °C.' },
        build: () => group(m(cylY(0.16, 0.2, 32), COLORS.cyan), at(m(new THREE.CylinderGeometry(0.15, 0.16, 0.02, 32), COLORS.cyan, { edges: false }), 0, 0.11)),
        pos: [0, 0.28, 0], explode: [0, 0.5, 0],
      },
      {
        name: 'Compression Rings',
        info: { what: 'Seal the gap between piston and cylinder wall so combustion pressure can\'t leak past.', material: 'Cast iron or steel', fact: 'They press outward like springs; the gap is only ~0.3 mm.' },
        build: () => group(at(m(ringY(0.162, 0.008), COLORS.gold, { edges: false }), 0, 0.345), at(m(ringY(0.162, 0.008), COLORS.gold, { edges: false }), 0, 0.315)),
        pos: [0, 0, 0], explode: [0, 1.0, 0],
      },
      {
        name: 'Oil Control Ring',
        info: { what: 'Scrapes excess oil off the cylinder wall so it doesn\'t get burned.', material: 'Steel rails with an expander spring', fact: 'Blue exhaust smoke often means this ring is worn.' },
        build: () => at(m(ringY(0.162, 0.012), COLORS.magenta, { edges: false }), 0, 0.27),
        pos: [0, 0, 0], explode: [0, 0.78, 0],
      },
      {
        name: 'Wrist Pin',
        info: { what: 'Hinge that connects the piston to the connecting rod.', material: 'Hardened steel tube', fact: 'Also called a gudgeon pin.' },
        build: () => at(m(cylX(0.034, 0.26, 16), COLORS.white), 0, 0.24),
        pos: [0, 0, 0], explode: [0, 0.05, 0.55],
      },
      {
        name: 'Connecting Rod Assembly',
        info: { what: 'Links the piston to the crankshaft, turning up-and-down motion into rotation.', material: 'Forged steel', fact: 'It is stretched and squashed by several tonnes every revolution.' },
        pos: [0, -0.02, 0], explode: [0, -0.5, 0],
        view: [0.1, -0.9, 0],
        children: [
          {
            name: 'Rod Beam',
            info: { what: 'The I-shaped body of the rod with the small end (wrist pin) and upper big end.', material: 'Forged steel', fact: 'The I-beam shape is strong but light.' },
            build: () => group(
              at(m(ringX(0.045, 0.016), COLORS.gold, { edges: false }), 0, 0.26),
              at(m(box(0.04, 0.3, 0.05), COLORS.gold), 0, 0.07),
              at(m(halfRingX(0.07, 0.1, 0.05, true), COLORS.gold), 0, -0.12),
            ),
            pos: [0, 0, 0], explode: [0, 0, 0],
          },
          {
            name: 'Rod Cap',
            info: { what: 'Lower half of the big end. Bolted on around the crank pin.', material: 'Forged steel (machined as a pair with the rod)', fact: 'Caps are never swapped between rods - each is matched to its own.' },
            build: () => at(m(halfRingX(0.07, 0.1, 0.05, false), COLORS.gold), 0, -0.12),
            pos: [0, 0, 0], explode: [0, -0.32, 0],
          },
          {
            name: 'Rod Bolts',
            info: { what: 'Clamp the cap to the rod with enormous force.', material: 'High-strength alloy steel', fact: 'They are tightened until they stretch slightly, like a spring.' },
            build: () => group(at(hexBolt(0.12), 0, -0.16, 0.085, Math.PI), at(hexBolt(0.12), 0, -0.16, -0.085, Math.PI)),
            pos: [0, 0, 0], explode: [0, -0.62, 0],
          },
          {
            name: 'Bearing Shells',
            info: { what: 'Thin slippery liners between rod and crank pin. They float on a film of oil.', material: 'Steel backing with soft bearing alloy', fact: 'The oil film is thinner than a human hair.' },
            build: () => group(at(m(halfRingX(0.064, 0.07, 0.048, true), COLORS.magenta, { edges: false }), 0, -0.12), at(m(halfRingX(0.064, 0.07, 0.048, false), COLORS.magenta, { edges: false }), 0, -0.12)),
            pos: [0, 0, 0], explode: [0, 0, 0.42],
          },
        ],
      },
    ],
  };
}

// ---------------- the engine ----------------
export const ENGINE_DEF = {
  name: 'V4 Engine',
  info: {
    what: 'A four-cylinder petrol engine. Fuel and air burn in the cylinders, pushing pistons that spin the crankshaft.',
    material: 'Aluminium, cast iron and steel',
    fact: 'Two hands + spread to explode it, then pinch a part and pull it out to explore inside.',
  },
  view: [0.35, -0.6, 0],
  onAnimate: (obj, t, running, dt) => {
    const crank = obj.find('Crankshaft Assembly');
    if (!crank) return;
    const angle = t * 9;
    crank.rotation.x = running > 0.01 ? angle : crank.rotation.x;
    const fly = obj.find('Flywheel');
    if (fly) fly.rotation.x = crank.rotation.x;
    for (let i = 0; i < 4; i++) {
      const p = obj.find(`Piston Assembly ${i + 1}`);
      if (p && p.userData.basePos) p.position.y = p.userData.basePos.y + Math.cos(crank.rotation.x + (i === 1 || i === 2 ? Math.PI : 0)) * 0.06 * running;
    }
    const cam = obj.find('Camshaft Assembly');
    if (cam) cam.rotation.x = crank.rotation.x / 2;
  },
  children: [
    {
      name: 'Engine Block',
      info: { what: 'The main body. Contains the four cylinders the pistons slide in, plus passages for coolant and oil.', material: 'Cast aluminium alloy with iron cylinder liners', fact: 'Coolant flows through hollow "water jackets" around each cylinder.' },
      build: () => group(m(box(1.9, 0.8, 0.9), COLORS.cyan), ...X4.map((x) => at(m(ringY(0.17, 0.012), COLORS.cyan, { edges: false }), x, 0.4))),
      pos: [0, 0, 0], explode: [0, 0, 0],
    },
    {
      name: 'Cylinder Head Assembly',
      info: { what: 'Sits on top of the block and controls breathing: valves let air in and exhaust out, spark plugs ignite the fuel.', material: 'Aluminium alloy', fact: 'Each cylinder has 2 valves here (8 in total).' },
      pos: [0, 0.52, 0], explode: [0, 1.75, 0],
      view: [0.5, -0.5, 0],
      children: [
        {
          name: 'Head Casting',
          info: { what: 'The aluminium body of the head with the combustion chambers and ports.', material: 'Cast aluminium', fact: 'The combustion chamber shape strongly affects power and emissions.' },
          build: () => m(box(1.9, 0.24, 0.9), COLORS.blue),
          pos: [0, 0, 0], explode: [0, -0.25, 0],
        },
        {
          name: 'Camshaft Assembly',
          info: { what: 'A rotating shaft with egg-shaped lobes that push the valves open at exactly the right moment.', material: 'Hardened cast iron or steel', fact: 'It spins at exactly half the crankshaft speed.' },
          pos: [0, 0.24, 0.2], explode: [0, 0.6, 0.8],
          view: [0.3, -0.7, 0],
          children: [
            {
              name: 'Camshaft',
              info: { what: 'The shaft that carries the cam lobes.', material: 'Steel', fact: 'Driven by the timing belt from the crankshaft.' },
              build: () => m(cylX(0.035, 2.0, 16), COLORS.gold, { edges: false }),
              pos: [0, 0, 0], explode: [0, 0, 0],
            },
            {
              name: 'Cam Lobes',
              info: { what: 'Egg-shaped bumps. As they rotate, the nose pushes a valve open.', material: 'Hardened steel', fact: 'Lobe shape ("cam profile") decides how long and how far valves open.' },
              build: () => group(...X4.flatMap((x, i) => [-0.07, 0.07].map((dx, j) =>
                at(m(profileX((a) => 0.06 + 0.04 * Math.max(0, Math.cos(a)) ** 3, 0.04), COLORS.gold), x + dx, 0, 0, (i * 2 + j) * 0.8)))),
              pos: [0, 0, 0], explode: [0, 0.4, 0],
            },
            {
              name: 'Cam Gear',
              info: { what: 'Gear the timing belt turns to drive the camshaft.', material: 'Steel or sintered metal', fact: 'Has twice as many teeth as the crank gear - that\'s how it turns at half speed.' },
              build: () => m(gearGeometry(0.17, 0.14, 24, 0.04), COLORS.green),
              pos: [1.02, 0, 0], explode: [0.6, 0, 0],
            },
          ],
        },
        {
          name: 'Valve Train',
          info: { what: 'The valves and springs that open and close the cylinder\'s breathing holes.', material: 'Steel alloys', fact: 'Exhaust valves glow red-hot in hard use.' },
          pos: [0, 0.05, -0.12], explode: [0, 0.55, -0.95],
          children: [
            {
              name: 'Intake Valves',
              info: { what: 'Open to let the fuel-air mixture into the cylinder.', material: 'Chrome-silicon steel', fact: 'Usually bigger than exhaust valves - it\'s harder to suck air in than push it out.' },
              build: () => group(...X4.map((x) => at(valve(COLORS.cyan), x - 0.06, 0, 0.08))),
              pos: [0, 0, 0], explode: [0, 0, 0.45],
            },
            {
              name: 'Exhaust Valves',
              info: { what: 'Open to let burned gases escape to the exhaust.', material: 'Heat-resistant nickel steel', fact: 'Some racing engines fill them with sodium to carry heat away.' },
              build: () => group(...X4.map((x) => at(valve(COLORS.red), x + 0.06, 0, -0.08))),
              pos: [0, 0, 0], explode: [0, 0, -0.45],
            },
            {
              name: 'Valve Springs',
              info: { what: 'Snap the valves shut after the cam lobe passes.', material: 'Spring steel wire', fact: 'Weak springs cause "valve float" at high rpm, costing power.' },
              build: () => group(...X4.flatMap((x) => [[x - 0.06, 0.08], [x + 0.06, -0.08]].map(([vx, vz]) => at(m(helix(0.026, 0.12, 6, 0.005), COLORS.magenta, { edges: false }), vx, 0.09, vz)))),
              pos: [0, 0, 0], explode: [0, 0.45, 0],
            },
          ],
        },
        {
          name: 'Spark Plugs',
          info: { what: 'Create a tiny lightning bolt that ignites the fuel-air mixture.', material: 'Ceramic insulator, steel shell, iridium tip', fact: 'The spark is around 20,000-40,000 volts.' },
          build: () => group(...X4.map((x) => at(sparkPlug(), x, 0, -0.02))),
          pos: [0, 0.3, 0], explode: [0, 1.05, 0],
        },
        {
          name: 'Valve Cover',
          info: { what: 'Lid that keeps oil in and dirt out of the valve train.', material: 'Aluminium or plastic', fact: 'Also called a rocker cover or cam cover.' },
          build: () => group(m(box(1.8, 0.1, 0.7), COLORS.blue), ...[-0.6, -0.2, 0.2, 0.6].map((x) => at(m(box(0.03, 0.03, 0.6), COLORS.blue, { edges: false }), x, 0.06))),
          pos: [0, 0.46, 0], explode: [0, 1.6, 0],
        },
      ],
    },
    {
      name: 'Pistons & Connecting Rods',
      info: { what: 'The four piston assemblies - the parts that actually do the work.', material: 'Aluminium and forged steel', fact: 'They fire in the order 1-3-4-2 for smooth running.' },
      pos: [0, -0.15, 0], explode: [0, -0.05, 1.8],
      view: [0.2, -0.3, 0],
      children: [0, 1, 2, 3].map(pistonAssembly),
    },
    {
      name: 'Crankshaft Assembly',
      info: { what: 'Turns the pistons\' up-and-down push into rotation that drives the wheels.', material: 'Forged or cast steel', fact: 'Its offset crank pins work like the pedals on a bicycle.' },
      pos: [0, -0.38, 0], explode: [0, -1.35, 0.7],
      view: [0.3, -0.6, 0],
      children: [
        {
          name: 'Main Shaft',
          info: { what: 'The backbone of the crankshaft; spins in the main bearings.', material: 'Forged steel', fact: 'Its main journals are polished to a mirror finish.' },
          build: () => m(cylX(0.05, 2.1, 20), COLORS.gold, { edges: false }),
          pos: [0, 0, 0], explode: [0, 0, 0],
        },
        {
          name: 'Crank Pins',
          info: { what: 'Offset journals where the connecting rods attach.', material: 'Forged steel', fact: 'Pins 1 & 4 and 2 & 3 are paired 180° apart.' },
          build: () => group(...X4.map((x, i) => at(m(cylX(0.045, 0.12, 16), COLORS.white), x, (i === 1 || i === 2 ? -1 : 1) * 0.09))),
          pos: [0, 0, 0], explode: [0, 0, 0.5],
        },
        {
          name: 'Counterweights',
          info: { what: 'Heavy lobes that balance the swinging pistons and rods, reducing vibration.', material: 'Forged steel', fact: 'Without them the engine would shake itself apart.' },
          build: () => group(...X4.flatMap((x, i) => [-0.075, 0.075].map((dx) =>
            at(m(profileX((a) => (Math.sin(a) < 0 ? 0.15 : 0.06), 0.035, 40), COLORS.gold), x + dx, 0, 0, i === 1 || i === 2 ? Math.PI : 0)))),
          pos: [0, 0, 0], explode: [0, -0.45, 0],
        },
        {
          name: 'Main Bearings',
          info: { what: 'Support the crankshaft in the block on a film of oil.', material: 'Steel shells with bearing alloy', fact: 'An inline-4 usually has 5 main bearings.' },
          build: () => group(...[-0.88, -0.44, 0, 0.44, 0.88].map((x) => at(m(ringX(0.062, 0.013), COLORS.magenta, { edges: false }), x))),
          pos: [0, 0, 0], explode: [0, 0.45, 0],
        },
      ],
    },
    {
      name: 'Flywheel',
      info: { what: 'Heavy wheel that smooths out the pulses from each power stroke. The starter motor turns its teeth.', material: 'Cast iron or steel', fact: 'Lighter flywheels let an engine rev up faster but idle rougher.' },
      build: () => m(gearGeometry(0.42, 0.36, 36, 0.06), COLORS.green),
      pos: [1.06, -0.38, 0], explode: [1.6, 0, 0],
    },
    {
      name: 'Timing System',
      info: { what: 'Keeps the camshaft perfectly in step with the crankshaft so valves open at the right time.', material: 'Steel gears, reinforced rubber belt', fact: 'If the belt snaps, pistons can hit the valves ("interference engine").' },
      pos: [-1.02, 0, 0], explode: [-1.4, 0, 0],
      view: [0, -1.2, 0],
      children: [
        {
          name: 'Crank Timing Gear',
          info: { what: 'Small gear on the crankshaft that drives the belt.', material: 'Sintered steel', fact: 'Half the teeth of the cam gear.' },
          build: () => m(gearGeometry(0.12, 0.1, 16, 0.05), COLORS.green),
          pos: [0, -0.38, 0], explode: [-0.35, -0.25, 0],
        },
        {
          name: 'Cam Drive Gear',
          info: { what: 'Large gear that turns the camshaft.', material: 'Steel', fact: 'Marks on it are lined up with the crank gear during assembly.' },
          build: () => m(gearGeometry(0.21, 0.18, 32, 0.05), COLORS.green),
          pos: [0, 0.76, 0.2], explode: [-0.35, 0.25, 0],
        },
        {
          name: 'Timing Belt',
          info: { what: 'Toothed belt linking the two gears.', material: 'Rubber reinforced with fibreglass cords', fact: 'Typically replaced every 100,000 km or so.' },
          build: () => m(tube([[0, -0.52, 0], [0, -0.38, 0.14], [0, -0.2, 0.18], [0, 0.4, 0.42], [0, 0.76, 0.42], [0, 0.97, 0.2], [0, 0.76, -0.02], [0, 0.3, -0.06], [0, -0.38, -0.13]], 0.012, true), COLORS.magenta, { edges: false }),
          pos: [0, 0, 0], explode: [-0.75, 0, 0],
        },
      ],
    },
    {
      name: 'Oil Pan',
      info: { what: 'Reservoir under the engine that holds the oil.', material: 'Pressed steel or cast aluminium', fact: 'Also called the sump.' },
      build: () => group(m(box(1.7, 0.22, 0.8), COLORS.cyan), at(m(cylY(0.03, 0.04, 6), COLORS.white), 0.6, -0.13)),
      pos: [0, -0.53, 0], explode: [0, -2.25, 0],
    },
    {
      name: 'Intake Manifold',
      info: { what: 'Pipes that share incoming air evenly between the four cylinders.', material: 'Aluminium or reinforced plastic', fact: 'Runner length is tuned like an organ pipe to boost airflow.' },
      pos: [0, 0.55, 0.62], explode: [0, 0.75, 1.55],
      view: [0.4, -0.3, 0],
      children: [
        {
          name: 'Plenum',
          info: { what: 'Air chamber that feeds all the runners.', material: 'Aluminium', fact: 'A bigger plenum helps at high rpm.' },
          build: () => m(cylX(0.09, 1.7, 24), COLORS.magenta),
          pos: [0, 0.1, 0.18], explode: [0, 0, 0.4],
        },
        {
          name: 'Intake Runners',
          info: { what: 'Individual pipes from the plenum to each cylinder\'s intake port.', material: 'Aluminium', fact: 'Some engines change runner length on the fly.' },
          build: () => group(...X4.map((x) => m(tube([[x, -0.08, -0.08], [x, 0.0, 0.0], [x, 0.08, 0.12], [x, 0.1, 0.18]], 0.035), COLORS.magenta, { edges: false }))),
          pos: [0, 0, 0], explode: [0, 0.3, -0.1],
        },
        {
          name: 'Throttle Body',
          info: { what: 'Butterfly valve controlled by the accelerator pedal - it decides how much air gets in.', material: 'Aluminium', fact: 'Modern ones are electronic ("drive-by-wire").' },
          build: () => group(m(cylX(0.075, 0.14, 24), COLORS.white), at(m(new THREE.CircleGeometry(0.07, 24).rotateY(Math.PI / 2), COLORS.white, { edges: false }), 0, 0, 0, 0.6)),
          pos: [-0.95, 0.1, 0.18], explode: [-0.45, 0, 0],
        },
      ],
    },
    {
      name: 'Exhaust Manifold',
      info: { what: 'Collects hot exhaust gases from each cylinder into one pipe.', material: 'Cast iron or stainless steel', fact: 'Can glow red-hot under full load.' },
      pos: [0, 0.4, -0.6], explode: [0, 0.15, -1.65],
      view: [0.3, -2.4, 0],
      children: [
        {
          name: 'Exhaust Runners',
          info: { what: 'Pipes from each exhaust port down to the collector.', material: 'Stainless steel', fact: 'Equal-length runners ("headers") improve power.' },
          build: () => group(...X4.map((x) => m(tube([[x, 0, 0.05], [x, -0.05, -0.08], [x * 0.6 + 0.12, -0.25, -0.15], [0.35, -0.38, -0.15]], 0.032), COLORS.red, { edges: false }))),
          pos: [0, 0, 0], explode: [0, 0.25, 0],
        },
        {
          name: 'Collector',
          info: { what: 'Merges the runners into the exhaust pipe.', material: 'Stainless steel', fact: 'Its shape helps one cylinder\'s pulse pull gas out of the next.' },
          build: () => m(new THREE.CylinderGeometry(0.07, 0.05, 0.22, 20), COLORS.red),
          pos: [0.35, -0.48, -0.15], explode: [0, -0.4, 0],
        },
        {
          name: 'Heat Shield',
          info: { what: 'Metal sheet that protects nearby parts from exhaust heat.', material: 'Aluminised steel', fact: 'A loose one causes the classic rattle at idle.' },
          build: () => m(box(1.5, 0.36, 0.015), COLORS.white),
          pos: [0, -0.15, -0.24], explode: [0, 0, -0.45],
        },
      ],
    },
  ],
};
