const SAME_TREE_GAP = 26;
const OTHER_TREE_GAP = 120;
const FIRST_RADIUS = 120;
const RADIUS_STEP = 34;
const ANGLE_STEP = 0.2;
/** A new tree needs this much clear room, so it can grow before it meets a neighbour. */
const TREE_ROOM = [1250, 860];
const TREE_PITCH = [1560, 1080];

/** Places to try for a new card, nearest and straightest first. Worked out once. */
const TRIES = [];
for (let ring = 0; ring < 110; ring++) {
  for (let turn = -16; turn <= 16; turn++) {
    TRIES.push({ radius: FIRST_RADIUS + ring * RADIUS_STEP, off: turn * ANGLE_STEP, cost: ring * RADIUS_STEP + 250 * Math.abs(turn * ANGLE_STEP) });
  }
}
TRIES.sort((a, b) => a.cost - b.cost);

const CELLS = [];
for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) CELLS.push({ i, j, cost: i * i + 1.3 * j * j - 0.1 * i - 0.05 * j });
CELLS.sort((a, b) => a.cost - b.cost);

const box = (x, y, w, h, tree) => ({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, tree });
const touches = (a, b, gap) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;

/**
 * Where every card sits. A card keeps its place once it has one: new cards fan out from their
 * parent, away from the start of the tree, into the nearest free room. So each generation lies
 * further out, and adding to one card never moves the others. A card never settles nearer to
 * another tree's start than to its own, which keeps trees from growing into each other.
 * A card is placed again only when its parent, its group, or a card above it changes.
 */
export class Layout {
  constructor() {
    this.pos = new Map();
    this.blocks = new Map();
  }

  /**
   * view: the store's derived view. parentOf(id) is a card's parent id, or null for a root.
   * footprint(id) is the room one card takes, [w, h].
   * arrangeGroup(group) gives a composite's arrangement from ./composites.js.
   */
  update(view, parentOf, footprint, arrangeGroup) {
    const pos = new Map();
    const blocks = new Map();
    const taken = [];
    const kept = new Set();

    const unitsOf = (parentId) => {
      const units = [];
      const seen = new Set();
      for (const child of view.children.get(parentId) ?? []) {
        const group = view.groupOf.get(child.id);
        if (!group) units.push({ key: child.id, sig: `card|${parentId}`, ids: [child.id] });
        else if (!seen.has(group.id)) {
          seen.add(group.id);
          const arr = arrangeGroup(group);
          units.push({ key: group.id, sig: `group|${parentId}|${group.members.join(',')}|${arr.open ? 'open' : ''}`, ids: group.members, group, arr });
        }
      }
      return units;
    };

    const seat = (unit, tree, at) => {
      if (!unit.group) {
        const [w, h] = footprint(unit.key);
        pos.set(unit.key, { x: at.x, y: at.y, sig: unit.sig });
        taken.push(box(at.x, at.y, w, h, tree));
        return;
      }
      const { arr } = unit;
      const left = at.x - arr.w / 2;
      const top = at.y - arr.h / 2;
      blocks.set(unit.key, { x: left, y: top, w: arr.w, h: arr.h, sig: unit.sig, arr });
      for (const id of unit.ids) pos.set(id, { x: left + arr.at.get(id).x, y: top + arr.at.get(id).y, sig: unit.sig });
      taken.push(box(at.x, at.y, arr.w, arr.h, tree));
    };

    const remembered = (unit) => {
      if (!unit.group) {
        const old = this.pos.get(unit.key);
        return old?.sig === unit.sig ? old : null;
      }
      const old = this.blocks.get(unit.key);
      return old?.sig === unit.sig ? { x: old.x + unit.arr.w / 2, y: old.y + unit.arr.h / 2 } : null;
    };

    const keepFrom = (parentId, tree, stale) => {
      for (const unit of unitsOf(parentId)) {
        const old = stale ? null : remembered(unit);
        if (old) {
          seat(unit, tree, old);
          kept.add(unit.key);
        }
        for (const id of unit.ids) keepFrom(id, tree, !old);
      }
    };
    for (const tree of view.trees) {
      const old = this.pos.get(tree.rootId)?.sig === 'root' ? this.pos.get(tree.rootId) : null;
      if (old) {
        const [w, h] = footprint(tree.rootId);
        pos.set(tree.rootId, old);
        taken.push(box(old.x, old.y, w, h, tree.id));
      }
      keepFrom(tree.rootId, tree.id, !old);
    }

    const roots = () => view.trees.filter((tree) => pos.has(tree.rootId)).map((tree) => ({ tree: tree.id, ...pos.get(tree.rootId) }));
    let starts = [];
    const home = (at, tree) => {
      let own = Infinity;
      let other = Infinity;
      for (const start of starts) {
        const d = Math.hypot(at.x - start.x, at.y - start.y);
        if (start.tree === tree) own = d;
        else other = Math.min(other, d);
      }
      return own <= other;
    };
    const free = (candidate) => taken.every((other) => !touches(candidate, other, other.tree === candidate.tree ? SAME_TREE_GAP : OTHER_TREE_GAP));

    const placeRoot = (tree) => {
      const [w, h] = footprint(tree.rootId);
      const room = (cell) => box(cell.i * TREE_PITCH[0], cell.j * TREE_PITCH[1], TREE_ROOM[0], TREE_ROOM[1], tree.id);
      const cell = CELLS.find((c) => taken.every((other) => !touches(room(c), other, 0))) ?? CELLS[CELLS.length - 1];
      pos.set(tree.rootId, { x: cell.i * TREE_PITCH[0], y: cell.j * TREE_PITCH[1], sig: 'root' });
      taken.push(box(cell.i * TREE_PITCH[0], cell.j * TREE_PITCH[1], w, h, tree.id));
    };

    const place = (unit, tree, origin, prefer, reach) => {
      const [w, h] = unit.group ? [unit.arr.w, unit.arr.h] : footprint(unit.key);
      // Hemmed in, a card may turn further round its parent, and at the last leave its tree's side.
      for (const [turn, stayHome] of [[reach, true], [Math.PI, true], [Math.PI, false]]) {
        for (const tryAt of TRIES) {
          if (Math.abs(tryAt.off) > turn) continue;
          const angle = prefer + tryAt.off;
          const at = { x: origin.x + tryAt.radius * 1.2 * Math.cos(angle), y: origin.y + tryAt.radius * 0.92 * Math.sin(angle) };
          if ((!stayHome || home(at, tree)) && free(box(at.x, at.y, w, h, tree))) return seat(unit, tree, at);
        }
      }
      seat(unit, tree, origin);
    };

    for (const tree of view.trees) if (!pos.has(tree.rootId)) placeRoot(tree);
    starts = roots();
    for (const tree of view.trees) {
      const queue = [tree.rootId];
      while (queue.length > 0) {
        const parentId = queue.shift();
        const origin = pos.get(parentId);
        const units = unitsOf(parentId);
        const fresh = units.filter((unit) => !kept.has(unit.key));
        const from = parentOf(parentId) ? pos.get(tree.rootId) : null;
        const base = from ? Math.atan2(origin.y - from.y, origin.x - from.x) : Math.PI / 2;
        const alone = fresh.length === units.length;
        const k = fresh.length;
        fresh.forEach((unit, j) => {
          let prefer = base;
          if (alone && !from) prefer = Math.PI / 2 + (2 * Math.PI * (j + (k % 2 === 0 ? 0.5 : 0))) / k;
          else if (alone && k > 1) {
            const arc = Math.min(4.2, 0.85 * (k - 1));
            prefer = base - arc / 2 + (arc * j) / (k - 1);
          }
          place(unit, tree.id, origin, prefer, from ? 1.8 : Math.PI);
        });
        for (const unit of units) queue.push(...unit.ids);
      }
    }

    this.pos = pos;
    this.blocks = blocks;
  }
}
