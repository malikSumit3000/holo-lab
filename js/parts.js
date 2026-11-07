// Part trees: any object made of parts, which can be exploded, pulled apart and drilled into.
//
// A part definition looks like:
//   {
//     name: 'Piston Assembly',
//     info: { what: '...', material: '...', fact: '...' },
//     build: () => THREE.Object3D,        // this part's own geometry (optional for pure groups)
//     pos: [x, y, z],                     // position inside its parent
//     rot: [x, y, z],                     // optional rotation (radians)
//     matrix: THREE.Matrix4,              // optional full transform instead of pos/rot (3-D model files)
//     explode: [x, y, z],                 // offset applied when the PARENT is exploded
//     children: [ ...part definitions ],
//     view: [x, y, z],                    // optional nice viewing angle when this part is the focus
//     onAnimate: (obj, t, running, dt) => {}   // optional idle animation (only on the focused object)
//   }
import * as THREE from 'three';
import { HoloObject } from './objects.js';
import { makeLabel, clamp, damp } from './holo.js';

/** Builds the full (assembled) 3-D subtree for a part definition. */
export function buildNode(def) {
  const g = new THREE.Group();
  g.name = def.name;
  if (def.build) g.add(def.build());
  for (const c of def.children || []) {
    const h = buildNode(c);
    placeNode(h, c);
    h.userData.basePos = h.position.clone();
    g.add(h);
  }
  return g;
}

export function placeNode(obj, def) {
  if (def.matrix) def.matrix.decompose(obj.position, obj.quaternion, obj.scale);
  else {
    obj.position.fromArray(def.pos || [0, 0, 0]);
    if (def.rot) obj.rotation.fromArray(def.rot);
  }
}

export function countParts(def) {
  return (def.children || []).reduce((n, c) => n + 1 + countParts(c), 0);
}

export class AssemblyObject extends HoloObject {
  constructor(def) {
    super('assembly', def.name.toUpperCase(), 1);
    this.def = def;
    this.content = new THREE.Group();
    this.group.add(this.content);
    if (def.build) this.content.add(def.build());

    this.parts = [];
    for (const c of def.children || []) {
      const holder = buildNode(c);
      placeNode(holder, c);
      this.content.add(holder);
      this.parts.push({
        def: c, holder,
        base: holder.position.clone(),
        explodeVec: new THREE.Vector3().fromArray(c.explode || [0, 0, 0]),
        pullOffset: new THREE.Vector3(),
        pulling: false,
        hidden: false,
        localCenter: new THREE.Vector3(),
        radius: 0.2,
        sprite: null,
      });
    }
    this.explodable = this.parts.length > 0;

    // re-centre so the object rotates around its visual centre
    this.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.content);
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    const center = box.getCenter(new THREE.Vector3());
    this.content.position.sub(center);
    this.baseRadius = Math.max(0.25, box.getSize(new THREE.Vector3()).length() / 2 * 0.8);
    this.radius = this.baseRadius;

    // per-part bounds (centre in the part's own space) + floating labels
    this.group.updateMatrixWorld(true);
    for (const p of this.parts) {
      const pb = new THREE.Box3().setFromObject(p.holder);
      if (pb.isEmpty()) continue;
      p.localCenter.copy(p.holder.worldToLocal(pb.getCenter(new THREE.Vector3())));
      p.radius = Math.max(0.06, pb.getSize(new THREE.Vector3()).length() / 2);
      p.sprite = makeLabel(p.def.name.toUpperCase(), '#ffcf7a', 0.14);
      p.sprite.userData.baseScale = p.sprite.scale.clone();
      p.sprite.position.copy(p.localCenter).add(new THREE.Vector3(0, p.radius * 0.55 + 0.06, 0));
      p.sprite.material.opacity = 0;
      p.holder.add(p.sprite);
    }

    if (def.view) this.group.quaternion.setFromEuler(new THREE.Euler(...def.view));
    this.finish();
  }

  /** Where a part's centre is right now, in world space. */
  partWorldCenter(p, out = new THREE.Vector3()) {
    return p.holder.localToWorld(out.copy(p.localCenter));
  }

  /** Where a part's centre sits when it's in its (exploded) slot, in world space. */
  partSlotWorldCenter(p, out = new THREE.Vector3()) {
    const slot = p.base.clone().addScaledVector(p.explodeVec, this.explode);
    out.copy(p.localCenter).applyQuaternion(p.holder.quaternion).add(slot);
    return this.content.localToWorld(out);
  }

  /** Move a pulled part so its centre is at a world position. */
  setPartWorldCenter(p, world) {
    const local = this.content.worldToLocal(world.clone());
    local.sub(p.localCenter.clone().applyQuaternion(p.holder.quaternion));
    p.pullOffset.copy(local).sub(p.base).addScaledVector(p.explodeVec, -this.explode);
  }

  /** Part under a screen point - only while the object is exploded. */
  pickPart(sx, sy, camera) {
    if (this.explode < 0.45 || !this.pickable) return null;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const scale = this.group.scale.x;
    let best = null, bestScore = Infinity;
    for (const p of this.parts) {
      if (p.hidden) continue;
      const wc = this.partWorldCenter(p);
      const c = wc.clone().project(camera);
      if (c.z > 1) continue;
      const e = wc.clone().addScaledVector(right, p.radius * scale).project(camera);
      const cx = (c.x + 1) / 2 * innerWidth, cy = (1 - c.y) / 2 * innerHeight;
      const rpx = Math.max(22, Math.abs((e.x - c.x) / 2 * innerWidth)) * 1.1;
      const d = Math.hypot(sx - cx, sy - cy);
      const score = d / rpx;
      if (d < rpx && score < bestScore) { best = p; bestScore = score; }
    }
    return best;
  }

  animate(dt, t) {
    this.explode = damp(this.explode, this.explodeTarget, 6, dt);
    const running = clamp(1 - this.explode * 6, 0, 1);
    // labels: hidden on ghosts, and kept the same size on screen however much the object is zoomed
    const labelAlpha = clamp((this.explode - 0.25) / 0.35, 0, 1) * (this.dim > 0.5 ? this.dim : 0);
    const inv = 1 / Math.max(0.05, this.group.scale.x);
    const tmp = this._tmp || (this._tmp = new THREE.Vector3());
    let extent = 0;
    for (const p of this.parts) {
      if (!p.pulling) p.pullOffset.multiplyScalar(Math.exp(-10 * dt));
      p.holder.position.copy(p.base).addScaledVector(p.explodeVec, this.explode).add(p.pullOffset);
      if (p.sprite) {
        p.sprite.material.opacity = p.hidden ? 0 : labelAlpha;
        p.sprite.scale.copy(p.sprite.userData.baseScale).multiplyScalar(inv);
      }
      if (!p.hidden) {
        tmp.copy(p.localCenter).applyQuaternion(p.holder.quaternion).add(p.base).addScaledVector(p.explodeVec, this.explode).add(this.content.position);
        extent = Math.max(extent, tmp.length() + p.radius);
      }
    }
    // real size of the (exploded) object, used for picking and auto-zoom
    this.radius = Math.max(this.baseRadius, extent * 0.85);
    if (this.autoFit && this.explodable && !this.fly) {
      this.baseScale = damp(this.baseScale, this.autoFit / this.radius, 4, dt);
    }
    if (this.def.onAnimate) this.def.onAnimate(this, t, running * this.dim, dt);
  }

  /** Find a sub-group anywhere in this object by part name. */
  find(name) {
    this._cache = this._cache || {};
    if (!(name in this._cache)) this._cache[name] = this.content.getObjectByName(name) || null;
    return this._cache[name];
  }
}
