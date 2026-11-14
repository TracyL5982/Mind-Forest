import { h, put, s, clamp, ease } from './dom.js';
import { componentOf, drawCard, sizeOf } from './components/index.js';
import { arrange } from './composites/index.js';
import { Layout } from './layout.js';

const PICK_SCALE = 0.86;
const ROOT_SCALE = 1.12;
/** Every card is given at least this much room, so one that changes shape does not crowd its neighbours. */
const MIN_ROOM = [250, 165];
const MOVE_MS = 520;
const GLIDE_MS = 650;

/** The point where the line from a box's centre toward (tx, ty) leaves the box. */
function edge(box, tx, ty, pad = 6) {
  const dx = tx - box.x;
  const dy = ty - box.y;
  if (dx === 0 && dy === 0) return { x: box.x, y: box.y };
  const t = Math.min((box.w / 2 + pad) / Math.abs(dx || 1e-9), (box.h / 2 + pad) / Math.abs(dy || 1e-9), 1);
  return { x: box.x + dx * t, y: box.y + dy * t };
}

/** The pannable, zoomable field: cards, the threads between them, group panes and links. */
export class Field {
  constructor({ root, store, asset }) {
    this.root = root;
    this.store = store;
    this.asset = asset;
    this.layout = new Layout();
    this.cards = new Map();
    this.panes = new Map();
    this.threads = new Map();
    this.links = new Map();
    this.selection = new Set();
    this.thinking = new Map();
    this.openPiles = new Set();
    this.dropTarget = null;
    this.view = { x: 0, y: 0, k: 1 };
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.glide = null;
    this.frame = 0;

    this.paneLayer = h('div', { class: 'panes' });
    this.threadLayer = s('g');
    this.linkLayer = s('g');
    this.labelLayer = s('g');
    this.cardLayer = h('div', { class: 'cards' });
    this.world = h('div', { class: 'world' },
      this.paneLayer,
      s('svg', { class: 'lines', width: 1, height: 1 }, this.threadLayer, this.linkLayer, this.labelLayer),
      this.cardLayer);
    root.append(this.world);
    this.applyView();
  }

  // ---- drawing the state

  render({ instant = false } = {}) {
    const { store } = this;
    const view = store.view;
    const now = performance.now();

    const shape = new Map();
    for (const node of view.order) {
      const item = store.item.get(node.itemId);
      const [w, hgt] = sizeOf(node, item);
      const scale = node.status === 'pick' ? PICK_SCALE : node.parent === null ? ROOT_SCALE : 1;
      shape.set(node.id, { w, h: hgt, scale, item });
    }
    const drawn = new Map([...shape].map(([id, sh]) => [id, [sh.w * sh.scale, sh.h * sh.scale]]));
    const arrangements = new Map();
    const arrangeGroup = (group) => {
      if (!arrangements.has(group.id)) {
        const open = this.openPiles.has(group.id);
        arrangements.set(group.id, { ...arrange(group, group.members, drawn, open), open });
      }
      return arrangements.get(group.id);
    };
    const footprint = (id) => {
      const { scale } = shape.get(id);
      const [w, hgt] = drawn.get(id);
      return [Math.max(w, MIN_ROOM[0] * scale), Math.max(hgt, MIN_ROOM[1] * scale)];
    };
    this.layout.update(view, (id) => store.node.get(id)?.parent ?? null, footprint, arrangeGroup);

    const seen = new Set();
    for (const node of view.order) {
      const sh = shape.get(node.id);
      const target = this.layout.pos.get(node.id);
      const group = view.groupOf.get(node.id);
      const arr = group ? arrangements.get(group.id) : null;
      seen.add(node.id);

      let card = this.cards.get(node.id);
      if (!card) {
        const from = (node.parent && this.cards.get(node.parent)?.cur) || target;
        const face = h('div', { class: 'card-face' });
        const el = h('div', { class: 'card', data: { id: node.id } }, face,
          h('div', { class: 'think', 'aria-label': 'Working on this' }, h('i'), h('i'), h('i')));
        card = { el, face, sig: '', cur: instant ? { ...target } : { ...from }, tween: null, target: null };
        this.cards.set(node.id, card);
        this.cardLayer.append(el);
        if (!instant) {
          face.classList.add('is-arriving');
          face.addEventListener('animationend', () => face.classList.remove('is-arriving'), { once: true });
        }
      }
      Object.assign(card, { w: sh.w, h: sh.h, scale: sh.scale, treeId: node.treeId });

      if (!card.target || card.target.x !== target.x || card.target.y !== target.y) {
        card.target = { x: target.x, y: target.y };
        const far = Math.hypot(card.cur.x - target.x, card.cur.y - target.y) > 0.5;
        card.tween = far && !instant && !card.dragging ? { fx: card.cur.x, fy: card.cur.y, t0: now } : null;
        if (!card.tween && !card.dragging) card.cur = { ...card.target };
      }

      const component = componentOf(node);
      const sig = `${sh.item.revision}|${JSON.stringify(node.view)}|${sh.w}x${sh.h}`;
      if (sig !== card.sig) {
        card.sig = sig;
        card.el.style.width = `${sh.w}px`;
        card.el.style.height = `${sh.h}px`;
        card.el.dataset.component = component;
        put(card.face, drawCard(node, sh.item, { asset: this.asset }));
      }
      card.el.setAttribute('aria-label', `${node.status === 'pick' ? 'Pick' : 'Card'}: ${sh.item.title}`);
      card.el.style.setProperty('--tint', view.colour.get(node.id));
      const flags = {
        'is-pick': node.status === 'pick',
        'is-kept': node.status === 'kept',
        'is-root': node.parent === null,
        'is-selected': this.selection.has(node.id),
        'is-thinking': (this.thinking.get(node.id) ?? 0) > 0,
        'is-under': Boolean(arr?.under.has(node.id)),
        'is-buried': Boolean(arr?.buried.has(node.id)),
        'is-drop-target': this.dropTarget === node.id,
      };
      for (const [name, on] of Object.entries(flags)) card.el.classList.toggle(name, on);
      this.placeCard(card);
    }
    for (const [id, card] of this.cards) {
      if (seen.has(id)) continue;
      this.cards.delete(id);
      card.el.classList.add('is-leaving');
      card.el.removeAttribute('data-id');
      setTimeout(() => card.el.remove(), 260);
    }

    this.renderPanes(view, arrangements);
    this.renderLines(view);
    this.drawLines();
    this.kick();
  }

  renderPanes(view, arrangements) {
    const seen = new Set();
    for (const group of view.groups) {
      const block = this.layout.blocks.get(group.id);
      if (!block) continue;
      seen.add(group.id);
      let pane = this.panes.get(group.id);
      if (!pane) {
        pane = { el: h('div', { class: 'pane', data: { group: group.id } }), sig: '' };
        this.panes.set(group.id, pane);
        this.paneLayer.append(pane.el);
      }
      const arr = arrangements.get(group.id);
      const sig = JSON.stringify([group, block.w, block.h, arr.open]);
      Object.assign(pane.el.style, { left: `${block.x}px`, top: `${block.y}px`, width: `${block.w}px`, height: `${block.h}px` });
      pane.el.style.setProperty('--tint', view.colour.get(group.members[0]));
      pane.el.classList.toggle('is-pick', this.store.node.get(group.members[0])?.status === 'pick');
      if (sig === pane.sig) continue;
      pane.sig = sig;
      pane.el.dataset.composite = group.composite;
      put(pane.el,
        h('div', { class: 'pane-head' },
          h('span', { class: 'kind', text: arr.label }),
          arr.title !== arr.label && h('span', { class: 'pane-title clamp-1', text: arr.title }),
          arr.canOpen && h('button', {
            class: 'pane-open', type: 'button', text: arr.open ? 'Close' : `Open ${group.members.length}`,
            onclick: () => {
              if (arr.open) this.openPiles.delete(group.id);
              else this.openPiles.add(group.id);
              this.render();
            },
          })),
        arr.marks);
    }
    for (const [id, pane] of this.panes) {
      if (seen.has(id)) continue;
      this.panes.delete(id);
      pane.el.remove();
    }
  }

  /** One thread per card, or one per group. A group's thread runs to its pane. */
  renderLines(view) {
    const { store } = this;
    const want = new Map();
    for (const node of view.order) {
      if (node.parent === null) continue;
      const group = view.groupOf.get(node.id);
      if (group) want.set(group.id, { from: node.parent, block: group.id, pick: node.status === 'pick', why: '', tint: view.colour.get(node.id) });
      else want.set(node.id, { from: node.parent, to: node.id, pick: node.status === 'pick', why: node.why, tint: view.colour.get(node.id) });
    }
    this.sync(this.threads, want, this.threadLayer, (key, spec, line) => {
      line.path.setAttribute('class', `thread ${spec.pick ? 'is-pick' : 'is-kept'}`);
      line.path.dataset.id = key;
      line.path.style.stroke = spec.pick ? '' : spec.tint;
      line.label.setAttribute('class', `line-label ${spec.pick ? 'is-pick' : ''}`);
      line.label.textContent = spec.why.length > 34 ? `${spec.why.slice(0, 33)}…` : spec.why;
    });

    const ties = new Map();
    for (const link of store.link.values()) {
      if (this.cards.has(link.a) && this.cards.has(link.b)) ties.set(link.id, { from: link.a, to: link.b, why: link.why, bow: true });
    }
    this.sync(this.links, ties, this.linkLayer, (key, spec, line) => {
      line.path.setAttribute('class', 'link');
      line.path.dataset.link = key;
      line.label.setAttribute('class', 'line-label is-link');
      line.label.textContent = spec.why.length > 40 ? `${spec.why.slice(0, 39)}…` : spec.why;
    });
  }

  sync(have, want, layer, dress) {
    for (const [key, spec] of want) {
      let line = have.get(key);
      if (!line) {
        line = { path: s('path'), label: s('text', { 'text-anchor': 'middle' }) };
        have.set(key, line);
        layer.append(line.path);
        this.labelLayer.append(line.label);
      }
      line.spec = spec;
      dress(key, spec, line);
    }
    for (const [key, line] of have) {
      if (want.has(key)) continue;
      have.delete(key);
      line.path.remove();
      line.label.remove();
    }
  }

  boxOf(spec, end) {
    if (end === 'to' && spec.block) {
      const block = this.layout.blocks.get(spec.block);
      return block ? { x: block.x + block.w / 2, y: block.y + block.h / 2, w: block.w, h: block.h } : null;
    }
    const card = this.cards.get(spec[end]);
    return card ? { x: card.cur.x, y: card.cur.y, w: card.w * card.scale, h: card.h * card.scale } : null;
  }

  drawLines() {
    for (const lines of [this.threads, this.links]) {
      for (const line of lines.values()) {
        const a = this.boxOf(line.spec, 'from');
        const b = this.boxOf(line.spec, 'to');
        if (!a || !b) continue;
        const p = edge(a, b.x, b.y);
        const q = edge(b, a.x, a.y);
        let mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        if (line.spec.bow) {
          const bow = 0.18;
          const c = { x: mid.x - (q.y - p.y) * bow, y: mid.y + (q.x - p.x) * bow };
          line.path.setAttribute('d', `M${p.x.toFixed(1)} ${p.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
          mid = { x: (p.x + 2 * c.x + q.x) / 4, y: (p.y + 2 * c.y + q.y) / 4 };
        } else {
          line.path.setAttribute('d', `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
        }
        const room = Math.hypot(q.x - p.x, q.y - p.y);
        line.label.style.display = room < 46 && !line.spec.bow ? 'none' : '';
        line.label.setAttribute('x', mid.x.toFixed(1));
        line.label.setAttribute('y', (mid.y + 4).toFixed(1));
      }
    }
  }

  placeCard(card) {
    card.el.style.transform = `translate(${(card.cur.x - card.w / 2).toFixed(1)}px, ${(card.cur.y - card.h / 2).toFixed(1)}px) scale(${card.scale})`;
  }

  // ---- motion

  kick() {
    if (!this.frame) this.frame = requestAnimationFrame((t) => this.step(t));
  }

  step(now) {
    this.frame = 0;
    let busy = false;
    for (const card of this.cards.values()) {
      if (!card.tween) continue;
      const u = (now - card.tween.t0) / MOVE_MS;
      const e = ease(u);
      card.cur = { x: card.tween.fx + (card.target.x - card.tween.fx) * e, y: card.tween.fy + (card.target.y - card.tween.fy) * e };
      if (u >= 1) card.tween = null;
      this.placeCard(card);
      busy = true;
    }
    if (busy) this.drawLines();
    if (this.glide) {
      const u = (now - this.glide.t0) / GLIDE_MS;
      const e = ease(u);
      const { from, to } = this.glide;
      this.view = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      if (u >= 1) this.glide = null;
      this.applyView();
      busy = true;
    }
    if (busy) this.kick();
  }

  // ---- the view

  applyView() {
    const { x, y, k } = this.view;
    this.world.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${k.toFixed(4)})`;
    const grid = 48 * k;
    this.root.style.backgroundSize = `${grid}px ${grid}px`;
    this.root.style.backgroundPosition = `${x}px ${y}px`;
    this.root.classList.toggle('is-far', k < 0.45);
  }

  panBy(dx, dy) {
    this.glide = null;
    this.view.x += dx;
    this.view.y += dy;
    this.applyView();
  }

  zoomAt(clientX, clientY, factor) {
    this.glide = null;
    const rect = this.root.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const k = clamp(this.view.k * factor, 0.12, 2.5);
    this.view.x = cx - ((cx - this.view.x) * k) / this.view.k;
    this.view.y = cy - ((cy - this.view.y) * k) / this.view.k;
    this.view.k = k;
    this.applyView();
  }

  toWorld(clientX, clientY) {
    const rect = this.root.getBoundingClientRect();
    return { x: (clientX - rect.left - this.view.x) / this.view.k, y: (clientY - rect.top - this.view.y) / this.view.k };
  }

  boundsOf(ids) {
    let box = null;
    for (const id of ids) {
      const card = this.cards.get(id);
      if (!card?.target) continue;
      const w = (card.w * card.scale) / 2;
      const hgt = (card.h * card.scale) / 2;
      const { x, y } = card.target;
      box = box
        ? { x0: Math.min(box.x0, x - w), x1: Math.max(box.x1, x + w), y0: Math.min(box.y0, y - hgt), y1: Math.max(box.y1, y + hgt) }
        : { x0: x - w, x1: x + w, y0: y - hgt, y1: y + hgt };
    }
    return box;
  }

  /** Glide so the given cards fill the part of the page the panels leave free. */
  show(ids, { maxZoom = 1, margin = 70, instant = false } = {}) {
    const box = this.boundsOf(ids);
    if (!box) return;
    const rect = this.root.getBoundingClientRect();
    const { top, right, bottom, left } = this.insets;
    const w = Math.max(120, rect.width - left - right);
    const hgt = Math.max(120, rect.height - top - bottom);
    const k = clamp(Math.min(w / (box.x1 - box.x0 + margin * 2), hgt / (box.y1 - box.y0 + margin * 2)), 0.12, maxZoom);
    const to = { k, x: left + w / 2 - ((box.x0 + box.x1) / 2) * k, y: top + hgt / 2 - ((box.y0 + box.y1) / 2) * k };
    if (instant) {
      this.glide = null;
      this.view = to;
      this.applyView();
      return;
    }
    this.glide = { from: { ...this.view }, to, t0: performance.now() };
    this.kick();
  }

  treeCards(treeId) {
    return [...this.cards].filter(([, card]) => card.treeId === treeId).map(([id]) => id);
  }

  /** The tree whose root is nearest the middle of the page. */
  treeInView() {
    const rect = this.root.getBoundingClientRect();
    const centre = this.toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    let best = null;
    for (const tree of this.store.view.trees) {
      const at = this.layout.pos.get(tree.rootId);
      if (!at) continue;
      const d = Math.hypot(at.x - centre.x, at.y - centre.y);
      if (!best || d < best.d) best = { id: tree.id, d };
    }
    return best?.id;
  }

  // ---- what the input layer drives

  cardAt(clientX, clientY, except) {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const id = el.closest?.('.card')?.dataset.id;
      if (id && id !== except) return id;
    }
    return null;
  }

  dragCard(id, x, y) {
    const card = this.cards.get(id);
    if (!card) return;
    card.dragging = true;
    card.tween = null;
    card.cur = { x, y };
    card.el.classList.add('is-dragging');
    this.placeCard(card);
    this.drawLines();
  }

  releaseCard(id) {
    const card = this.cards.get(id);
    if (!card) return;
    card.dragging = false;
    card.el.classList.remove('is-dragging');
    card.tween = { fx: card.cur.x, fy: card.cur.y, t0: performance.now() };
    this.kick();
  }

  setDropTarget(id) {
    if (this.dropTarget === id) return;
    this.cards.get(this.dropTarget)?.el.classList.remove('is-drop-target');
    this.dropTarget = id;
    this.cards.get(id)?.el.classList.add('is-drop-target');
  }

  setThinking(nodeId, delta) {
    const n = Math.max(0, (this.thinking.get(nodeId) ?? 0) + delta);
    this.thinking.set(nodeId, n);
    this.cards.get(nodeId)?.el.classList.toggle('is-thinking', n > 0);
  }

  select(ids) {
    this.selection = new Set(ids);
    for (const [id, card] of this.cards) card.el.classList.toggle('is-selected', this.selection.has(id));
  }
}
