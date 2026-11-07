// Turns a loaded glTF/GLB model into a Holo Lab part tree, so library models can be exploded,
// pulled apart and drilled into like the procedural engine.
//
// - the model is normalised to a standard size and centred
// - empty wrapper nodes are collapsed (their transforms are baked into the child)
// - each node that contains geometry becomes a part; huge flat lists are split into "sections"
// - explode directions are computed from where each part sits relative to its parent
import * as THREE from 'three';
import { COLORS, holoMaterial, glowLineMaterial } from './holo.js';

const TARGET_SIZE = 2.4;          // longest side after normalising (world units)
const MAX_CHILDREN = 16;          // more than this per level -> grouped into sections
const MAX_EDGE_TRIS = 40000;      // skip glowing edge outlines on very dense meshes (performance)

const edgeCache = new WeakMap();

function hasMesh(o) {
  let found = false;
  o.traverse((x) => { if (x.isMesh) found = true; });
  return found;
}

const contentChildren = (node) => node.children.filter(hasMesh);

function cleanName(name, fallback) {
  const n = (name || '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n || /^(node|mesh|object|group|primitive|scene|root|gltf|polysurface|part)?\s*\d*$/i.test(n)) return fallback;
  return n.length > 40 ? `${n.slice(0, 38)}…` : n;
}

/** Hologram tint from the model's own material colour (falls back to cyan for white/grey/textured). */
function tintOf(material) {
  const m = Array.isArray(material) ? material[0] : material;
  if (!m || !m.color) return COLORS.cyan;
  const hsl = {};
  m.color.getHSL(hsl);
  if (hsl.s < 0.18) return COLORS.cyan;
  return new THREE.Color().setHSL(hsl.h, Math.max(0.65, hsl.s), 0.62);
}

function holoFromMesh(mesh) {
  const geo = mesh.geometry;
  geo.userData.keep = true;                 // shared by every copy of this model - never dispose
  const color = tintOf(mesh.material);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, holoMaterial(color, 1)));
  const tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  if (tris <= MAX_EDGE_TRIS) {
    let edges = edgeCache.get(geo);
    if (!edges) { edges = new THREE.EdgesGeometry(geo, 30); edges.userData.keep = true; edgeCache.set(geo, edges); }
    g.add(new THREE.LineSegments(edges, glowLineMaterial(color, 0.55)));
  }
  return g;
}

/** Union of world-space boxes of some nodes, then mapped into the normalised frame. */
function normBox(nodes, norm) {
  const box = new THREE.Box3();
  for (const n of nodes) box.union(new THREE.Box3().setFromObject(n));
  return box.isEmpty() ? box : box.applyMatrix4(norm);
}

export function gltfToDef(gltfScene, meta) {
  const scene = gltfScene;
  scene.updateMatrixWorld(true);
  const world = new THREE.Box3().setFromObject(scene);
  const size = world.getSize(new THREE.Vector3());
  const center = world.getCenter(new THREE.Vector3());
  const s = TARGET_SIZE / Math.max(size.x, size.y, size.z, 1e-6);
  // normalised frame = scaled + centred world space
  const norm = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
  const ctx = { count: 0, model: meta.name, meta };

  // the root's frame in the normalised world is `norm` applied to the scene root's world transform
  const rootDef = buildDef(scene, norm.clone().multiply(scene.matrixWorld), norm, ctx, 0, true);
  computeExplode(rootDef, norm);

  // Holo Lab's root content frame is the identity, so bake the root transform into its children
  const R = rootDef.matrix;
  const R3 = new THREE.Matrix3().setFromMatrix4(R);
  for (const c of rootDef.children || []) {
    c.matrix = R.clone().multiply(c.matrix);
    c.explode = new THREE.Vector3().fromArray(c.explode).applyMatrix3(R3).toArray();
  }
  const ownBuild = rootDef.build;
  return {
    name: meta.name,
    info: {
      what: meta.description || `${meta.name} - a 3-D model from your object library.`,
      material: 'Scanned / modelled 3-D object',
      fact: `Source: ${meta.source || 'unknown'} · Licence: ${meta.license || 'unknown'}${meta.attribution ? ` · ${meta.attribution}` : ''}`,
    },
    build: ownBuild ? () => { const g = new THREE.Group(); g.add(ownBuild()); R.decompose(g.position, g.quaternion, g.scale); return g; } : null,
    children: rootDef.children && rootDef.children.length ? rootDef.children : undefined,
    solid: !rootDef.children || !rootDef.children.length,
  };
}

/**
 * node: glTF object; local: its transform relative to the parent part's frame;
 * parentFrame: parent part's frame in normalised world space.
 */
function buildDef(node, local, parentFrame, ctx, depth, isRoot = false) {
  // collapse chains of empty wrapper nodes into one part
  let n = node, m = local.clone();
  while (!n.isMesh) {
    const kids = contentChildren(n);
    if (kids.length !== 1) break;
    n = kids[0];
    m = m.multiply(n.matrix);
  }
  // for the root, `local` already is the frame in normalised space
  const frame = isRoot ? m.clone() : parentFrame.clone().multiply(m);
  const def = {
    name: cleanName(n.name, `Part ${++ctx.count}`),
    matrix: m,
    _nodes: [n],
    _frame: frame,
    info: {
      what: `Part of the ${ctx.model}.`,
      material: (Array.isArray(n.material) ? n.material[0] : n.material)?.name || 'From the model file',
      fact: `Source: ${ctx.meta.source || 'unknown'} · Licence: ${ctx.meta.license || 'unknown'}`,
    },
  };
  if (n.isMesh) { const mesh = n; def.build = () => holoFromMesh(mesh); }

  const kids = depth < 6 ? contentChildren(n) : [];
  if (kids.length) {
    let children = kids.map((k) => buildDef(k, k.matrix, frame, ctx, depth + 1));
    if (children.length > MAX_CHILDREN) children = groupIntoSections(children, ctx);
    def.children = children;
  }
  return def;
}

/** Split a long flat list of parts into spatial "sections" so each level stays manageable. */
function groupIntoSections(children, ctx) {
  const centers = children.map((c) => new THREE.Vector3().setFromMatrixPosition(c.matrix));
  const box = new THREE.Box3().setFromPoints(centers);
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  const order = children.map((c, i) => [c, centers[i][axis]]).sort((a, b) => a[1] - b[1]).map((a) => a[0]);
  const nGroups = Math.min(MAX_CHILDREN, Math.ceil(order.length / MAX_CHILDREN));
  const per = Math.ceil(order.length / nGroups);
  const groups = [];
  for (let g = 0; g < nGroups; g++) {
    const members = order.slice(g * per, (g + 1) * per);
    if (!members.length) continue;
    groups.push({
      name: `Section ${g + 1}`,
      matrix: new THREE.Matrix4(),                 // same frame as the parent
      _nodes: members.flatMap((mm) => mm._nodes),
      _frame: members[0]._frame.clone().multiply(members[0].matrix.clone().invert()),
      info: { what: `A group of ${members.length} parts of the ${ctx.model}.`, material: 'Mixed', fact: 'Pull it out to see the individual parts.' },
      children: members.length > MAX_CHILDREN ? groupIntoSections(members, ctx) : members,
    });
  }
  return groups;
}

/** Explode offsets: each child moves away from its parent's centre, in the parent's frame. */
function computeExplode(def, norm) {
  if (!def.children) return;
  const pBox = normBox(def._nodes, norm);
  const pCenter = pBox.getCenter(new THREE.Vector3());
  const pSize = pBox.getSize(new THREE.Vector3()).length() / 2;
  const inv = def._frame.clone().invert();
  const frameScale = def._frame.getMaxScaleOnAxis() || 1;
  const golden = Math.PI * (3 - Math.sqrt(5));
  def.children.forEach((c, i) => {
    const cBox = normBox(c._nodes, norm);
    const cCenter = cBox.getCenter(new THREE.Vector3());
    const cSize = cBox.getSize(new THREE.Vector3()).length() / 2;
    const dW = cCenter.clone().sub(pCenter);
    const L = dW.length();
    let dirLocal;
    if (L > pSize * 0.05) {
      dirLocal = cCenter.clone().applyMatrix4(inv).sub(pCenter.clone().applyMatrix4(inv)).normalize();
    } else {                                            // part sits at the centre: spread on a spiral
      const a = i * golden, y = 1 - (i / Math.max(1, def.children.length - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      dirLocal = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).transformDirection(inv);
    }
    const distWorld = L * 0.8 + cSize * 0.6 + pSize * 0.15;
    c.explode = dirLocal.multiplyScalar(distWorld / frameScale).toArray();
    computeExplode(c, norm);
  });
}
