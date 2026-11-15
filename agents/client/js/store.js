const ENTITIES = ['item', 'node', 'tree', 'link', 'group'];
const PLURAL = { item: 'items', node: 'nodes', tree: 'trees', link: 'links', group: 'groups' };

/** Soft, light hues for kept branches. Amber and teal are left free for picks and links. */
const BRANCH = ['#b9c8ff', '#dcc4ff', '#ffc4d6', '#a9dcff', '#d3e6a6', '#f1c9ff', '#c4d2e8', '#ffd2c2'];
export const TRUNK = '#e6efff';

function hash(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) n = (n * 31 + text.charCodeAt(i)) >>> 0;
  return n;
}

/** The client's copy of the mindstorm: five id-keyed maps, replaced on hello and patched on change. */
export class Store {
  constructor() {
    for (const entity of ENTITIES) this[entity] = new Map();
    this.settings = { picksMode: 'provisional', picksPerRun: 4 };
    this.undoLabel = null;
    this.view = this.derive();
  }

  replace(snapshot, undoLabel = null) {
    for (const entity of ENTITIES) {
      this[entity] = new Map((snapshot[PLURAL[entity]] ?? []).map((value) => [value.id, value]));
    }
    this.undoLabel = undoLabel;
    this.view = this.derive();
  }

  apply(set, undoLabel = null) {
    for (const patch of set.patches ?? []) {
      const map = this[patch.entity];
      if (!map) continue;
      if (patch.after === null) map.delete(patch.id);
      else map.set(patch.id, patch.after);
    }
    this.undoLabel = undoLabel;
    this.view = this.derive();
  }

  /** What drawing needs and the maps do not hold directly: children, depth, branch colour, groups. */
  derive() {
    const children = new Map();
    for (const node of this.node.values()) {
      if (!this.item.has(node.itemId)) continue;
      if (node.parent === null) continue;
      if (!children.has(node.parent)) children.set(node.parent, []);
      children.get(node.parent).push(node);
    }
    for (const list of children.values()) list.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

    const trees = [...this.tree.values()]
      .filter((tree) => this.node.has(tree.rootId))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));

    const depth = new Map();
    const colour = new Map();
    const order = [];
    for (const tree of trees) {
      const walk = (node, d, tint) => {
        depth.set(node.id, d);
        colour.set(node.id, tint);
        order.push(node);
        for (const child of children.get(node.id) ?? []) {
          walk(child, d + 1, d === 0 ? BRANCH[hash(child.id) % BRANCH.length] : tint);
        }
      };
      walk(this.node.get(tree.rootId), 0, TRUNK);
    }

    const groups = [];
    const groupOf = new Map();
    for (const group of this.group.values()) {
      if (!depth.has(group.anchor)) continue;
      const members = group.members.filter((id) => depth.has(id) && this.node.get(id).parent === group.anchor && !groupOf.has(id));
      if (members.length === 0) continue;
      const live = { ...group, members };
      groups.push(live);
      for (const id of members) groupOf.set(id, live);
    }
    // The knowledge base's loose part: what the user dropped that no node holds. The headset's library is not listed.
    const held = new Set([...this.node.values()].map((node) => node.itemId));
    const unplaced = [...this.item.values()]
      .filter((item) => !item.archived && item.source?.from !== 'library' && !held.has(item.id))
      .sort((a, b) => (a.source?.capturedAt < b.source?.capturedAt ? 1 : -1));
    return { trees, children, depth, colour, order, groups, groupOf, unplaced };
  }

  itemOf(nodeId) {
    const node = this.node.get(nodeId);
    return node ? this.item.get(node.itemId) : undefined;
  }

  isUnder(nodeId, ancestorId) {
    for (let node = this.node.get(nodeId); node; node = node.parent ? this.node.get(node.parent) : null) {
      if (node.id === ancestorId) return true;
    }
    return false;
  }
}
