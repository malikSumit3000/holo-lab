// Drill-down navigation: pulling a part out of an exploded object makes it the "focus",
// ghosts everything else, and keeps a breadcrumb trail so you can go back up.
import * as THREE from 'three';
import { AssemblyObject, countParts } from './parts.js';
import { COLORS } from './holo.js';

const GHOST = 0.05;
const FOCUS_POS = new THREE.Vector3(0, 0.45, 1.0);
const FOCUS_SIZE = 1.7;   // world radius the focused part is scaled to (kept as it explodes)

export class FocusManager {
  constructor({ scene, objects, sfx, toast, particles }) {
    this.scene = scene;
    this.objects = objects;
    this.sfx = sfx;
    this.toast = toast;
    this.particles = particles;
    this.stack = [];          // [{ focus, source, part }]
    this.interaction = null;  // set by main
    this.crumbsEl = document.getElementById('crumbs');
    this.cardEl = document.getElementById('infocard');
    this.hoverPart = null;
    this.render();
  }

  get depth() { return this.stack.length; }
  get top() { return this.stack.length ? this.stack[this.stack.length - 1].focus : null; }
  isFocusObject(obj) { return this.stack.some((s) => s.focus === obj || s.source === obj); }

  /** Pull `part` out of `source` and make it the new focus. */
  drill(source, part) {
    const startPos = source.partWorldCenter(part);
    const startQuat = part.holder.getWorldQuaternion(new THREE.Quaternion());
    const focus = new AssemblyObject(part.def);
    focus.spawnT = 1;
    // the re-centred focus object starts exactly where the part was, at the same size
    focus.baseScale = source.group.scale.x;
    focus.group.position.copy(startPos);
    focus.group.quaternion.copy(startQuat);
    const toScale = THREE.MathUtils.clamp(FOCUS_SIZE / focus.baseRadius, 0.2, 8);
    const toQuat = part.def.view ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.def.view)) : startQuat;
    focus.flyTo(FOCUS_POS, toScale, toQuat, 0.8, () => {
      focus.autoFit = FOCUS_SIZE;          // keep it fitting the screen as it explodes
      this.toast(`${focus.name}${part.def.children ? ' - two hands to explode' : ''}`);
    });

    part.hidden = true;
    part.holder.visible = false;
    part.pulling = false;
    part.pullOffset.set(0, 0, 0);

    for (const o of this.objects) { o.dimTarget = GHOST; o.interactive = false; }
    this.scene.add(focus.group);
    this.objects.push(focus);
    this.stack.push({ focus, source, part });
    this.particles.burst(startPos, COLORS.gold, 160, 2.5, 0.3);
    this.sfx.spawn();
    this.render();
    return focus;
  }

  /** Go up `levels` levels; each focused part flies back into its slot. */
  back(levels = 1) {
    for (let i = 0; i < levels && this.stack.length; i++) {
      const { focus, source, part } = this.stack.pop();
      if (this.interaction) this.interaction.releaseObject(focus);
      focus.interactive = false;
      focus.autoFit = null;
      focus.explodeTarget = 0;
      const toPos = source.partSlotWorldCenter(part);
      const toQuat = part.holder.getWorldQuaternion(new THREE.Quaternion());
      focus.flyTo(toPos, source.group.scale.x, toQuat, 0.55, () => {
        this._remove(focus);
        part.hidden = false;
        part.holder.visible = true;
      });
      focus.dimTarget = 1;
    }
    // restore the new top level (or everything)
    const top = this.top;
    if (top) { top.interactive = true; top.dimTarget = 1; }
    else for (const o of this.objects) { if (!o.fly) { o.interactive = true; o.dimTarget = 1; } }
    this.sfx.release();
    this.render();
  }

  backTo(level) { if (level < this.stack.length) this.back(this.stack.length - level); }

  /** Leave drill-down instantly (used by CLEAR / spawning). */
  reset() {
    while (this.stack.length) {
      const { focus, part } = this.stack.pop();
      if (this.interaction) this.interaction.releaseObject(focus);
      this._remove(focus);
      part.hidden = false;
      part.holder.visible = true;
    }
    for (const o of this.objects) { o.interactive = true; o.dimTarget = 1; }
    this.render();
  }

  _remove(obj) {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    this.scene.remove(obj.group);
    obj.dispose();
    // objects that finished flying back become interactive again if we're at the top level
    if (!this.stack.length) for (const o of this.objects) { o.interactive = true; o.dimTarget = 1; }
  }

  setHoverPart(part) {
    if (part === this.hoverPart) return;
    this.hoverPart = part;
    this.renderCard();
  }

  // ---------------- UI ----------------
  render() {
    this.renderCrumbs();
    this.renderCard();
  }

  renderCrumbs() {
    const el = this.crumbsEl;
    if (!this.stack.length) { el.classList.remove('show'); el.innerHTML = ''; return; }
    const names = [this.stack[0].source.name, ...this.stack.map((s) => s.focus.name)];
    el.innerHTML = '<button data-level="back" class="crumb-back">&#9664; BACK</button>' + names.map((n, i) =>
      `<span class="sep">&#8250;</span><button data-level="${i}" class="${i === names.length - 1 ? 'current' : ''}">${n}</button>`).join('');
    el.classList.add('show');
  }

  renderCard() {
    const el = this.cardEl;
    const def = this.hoverPart ? this.hoverPart.def : (this.top ? this.top.def : null);
    if (!def || !def.info) { el.classList.remove('show'); return; }
    const n = countParts(def);
    const hint = this.hoverPart
      ? 'Pinch it and pull it out to explore'
      : (def.children ? 'Two hands + spread to explode · pull a part out to go deeper' : 'Smallest part - grab, twist and resize it');
    el.innerHTML = `
      <div class="title">${def.name.toUpperCase()}</div>
      <div class="what">${def.info.what}</div>
      <div class="row"><span>MATERIAL</span><b>${def.info.material}</b></div>
      <div class="row"><span>SUB-PARTS</span><b>${n || 'none'}</b></div>
      <div class="fact">${def.info.fact}</div>
      <div class="hint">${hint}</div>`;
    el.classList.add('show');
  }
}
