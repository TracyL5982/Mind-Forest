import {
  Command,
  CommandError,
  inLibrary,
  MAX_EDITS,
  type ChangeSet,
  type EntityName,
  type EntityOf,
  type Group,
  type Id,
  type Item,
  type Link,
  type Node,
  type Origin,
  type Patch,
  type Snapshot,
  type Tree,
} from './domain.ts';
import { withShortTitle } from './roles/types.ts';
import { SearchIndex, type Hit } from './search.ts';
import { isValidGroup, MEMBERS, type CompositeId } from './views.ts';

export interface Draft {
  origin: Origin;
  label: string;
  commands: Command[];
  /** See `ChangeSet.part`. */
  part?: Id;
}

export interface MindstormOptions {
  now: () => string;
  newId: () => Id;
}

type Maps = { [E in EntityName]: Map<Id, EntityOf<E>> };

/**
 * Everything the user has dumped: items, trees of nodes, links, groups.
 * The only way to change it is `apply`, which is atomic and returns the patches it made.
 */
export class Mindstorm {
  private readonly maps: Maps = {
    item: new Map(),
    node: new Map(),
    tree: new Map(),
    link: new Map(),
    group: new Map(),
  };
  private readonly childIndex = new Map<Id, Set<Id>>();
  private readonly itemNodes = new Map<Id, Set<Id>>();
  private readonly index = new SearchIndex();
  private readonly history: ChangeSet[] = [];
  private readonly undone = new Set<Id>();
  private working: Patch[] | null = null;
  seq = 0;

  constructor(private readonly opts: MindstormOptions) {}

  get items(): ReadonlyMap<Id, Item> {
    return this.maps.item;
  }
  get nodes(): ReadonlyMap<Id, Node> {
    return this.maps.node;
  }
  get trees(): ReadonlyMap<Id, Tree> {
    return this.maps.tree;
  }
  get links(): ReadonlyMap<Id, Link> {
    return this.maps.link;
  }
  get groups(): ReadonlyMap<Id, Group> {
    return this.maps.group;
  }

  /**
   * A draft that changes nothing comes back with no patches and is not numbered or kept: it takes no seq and can never be undone.
   * So `seq` rises by exactly one for every set a client is sent.
   */
  apply(draft: Draft): ChangeSet {
    return this.commit(draft, {}, () => {
      for (const raw of draft.commands) this.run(Command.parse(raw));
    });
  }

  /**
   * Undoes one change set: the most recent one still standing, unless `id` names another.
   * `housekeeping` marks sets that only follow from others (formats, digests). They are never the target,
   * and the ones made after the target are undone with it, so one press takes back one real change.
   */
  undo(id?: Id, origin: Origin = { by: 'user' }, housekeeping: (set: ChangeSet) => boolean = () => false): ChangeSet {
    const target = id ? this.history.find((c) => c.id === id) : this.undoTarget(housekeeping);
    if (!target) throw new CommandError('missing', id ? `no change set ${id}` : 'nothing to undo');
    if (this.undone.has(target.id)) throw new CommandError('conflict', `${target.id} is already undone`);
    const standing = (c: ChangeSet) => !c.undoes && !this.undone.has(c.id);
    const whole = target.part ? this.history.filter((c) => c.part === target.part && standing(c)) : [target];
    try {
      return this.revert(target, whole, origin, housekeeping);
    } catch (err) {
      // An earlier part of the same work may have been changed since, for example a pick that was kept. The latest part still comes back.
      if (whole.length === 1 || !(err instanceof CommandError) || err.code !== 'conflict') throw err;
      return this.revert(target, [target], origin, housekeeping);
    }
  }

  private revert(target: ChangeSet, whole: ChangeSet[], origin: Origin, housekeeping: (set: ChangeSet) => boolean): ChangeSet {
    const first = Math.min(...whole.map((c) => c.seq));
    const followers = this.history.filter((c) => c.seq > first && !c.undoes && !this.undone.has(c.id) && !whole.includes(c) && housekeeping(c));
    const reverting = [...followers, ...whole].sort((x, y) => y.seq - x.seq);
    const undoing = { undoes: target.id, alsoUndoes: reverting.filter((c) => c !== target).map((c) => c.id) };
    const set = this.commit({ origin, label: `Undo: ${target.label}`, commands: [] }, undoing, () => {
      for (const one of reverting) {
        for (const p of [...one.patches].reverse()) {
          const current = this.maps[p.entity].get(p.id) ?? null;
          if (!same(current, p.after)) {
            throw new CommandError('conflict', `${p.entity} ${p.id} changed since "${target.label}"`);
          }
          this.write(p.entity, p.id, p.before);
        }
      }
    });
    for (const one of reverting) this.undone.add(one.id);
    return set;
  }

  /** The change set a plain undo would take back now. */
  undoTarget(housekeeping: (set: ChangeSet) => boolean = () => false): ChangeSet | undefined {
    return [...this.history].reverse().find((c) => !c.undoes && !this.undone.has(c.id) && !housekeeping(c));
  }

  /** Rebuilds the state from stored change sets. */
  load(sets: readonly ChangeSet[]): void {
    for (const set of sets) {
      this.working = [];
      for (const p of set.patches) this.write(p.entity, p.id, p.after);
      this.working = null;
      this.history.push(set);
      if (set.undoes) this.undone.add(set.undoes);
      for (const id of set.alsoUndoes ?? []) this.undone.add(id);
      this.seq = set.seq;
    }
  }

  snapshot(): Snapshot {
    const sorted = <T extends { id: Id }>(map: ReadonlyMap<Id, T>) =>
      [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    return {
      seq: this.seq,
      items: sorted(this.maps.item),
      nodes: sorted(this.maps.node),
      trees: sorted(this.maps.tree),
      links: sorted(this.maps.link),
      groups: sorted(this.maps.group),
    };
  }

  changes(sinceSeq = 0): ChangeSet[] {
    return this.history.filter((c) => c.seq > sinceSeq);
  }

  // ---- queries

  item(id: Id): Item {
    return this.need('item', id);
  }
  node(id: Id): Node {
    return this.need('node', id);
  }
  tree(id: Id): Tree {
    return this.need('tree', id);
  }
  itemOf(nodeId: Id): Item {
    return this.item(this.node(nodeId).itemId);
  }

  children(nodeId: Id): Node[] {
    return [...(this.childIndex.get(nodeId) ?? [])]
      .map((id) => this.maps.node.get(id)!)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  }
  picks(nodeId: Id): Node[] {
    return this.children(nodeId).filter((n) => n.status === 'pick');
  }
  /** The node, then everything under it, parents before children. */
  subtree(nodeId: Id): Node[] {
    const out: Node[] = [];
    const stack = [this.node(nodeId)];
    while (stack.length > 0) {
      const n = stack.pop()!;
      out.push(n);
      stack.push(...this.children(n.id).reverse());
    }
    return out;
  }
  /** From the tree's root down to the node. */
  path(nodeId: Id): Node[] {
    const out: Node[] = [];
    for (let n: Node | undefined = this.node(nodeId); n; n = n.parent ? this.maps.node.get(n.parent) : undefined) {
      out.unshift(n);
    }
    return out;
  }
  depth(nodeId: Id): number {
    return this.path(nodeId).length - 1;
  }
  treeNodes(treeId: Id): Node[] {
    return this.subtree(this.tree(treeId).rootId);
  }
  nodesOfItem(itemId: Id): Node[] {
    return [...(this.itemNodes.get(itemId) ?? [])].map((id) => this.maps.node.get(id)!);
  }
  /** What the user dropped that no tree holds: the loose part of their knowledge base. The library is not listed. */
  unplaced(): Item[] {
    return [...this.maps.item.values()].filter((i) => !i.archived && !inLibrary(i) && !this.itemNodes.get(i.id)?.size);
  }
  /**
   * Whether the item is something the user knows, to draw on when a tree is grown: what they dropped, the library, and anything
   * they kept. An agent's unkept pick is a suggestion, not knowledge yet.
   */
  known(itemId: Id): boolean {
    const item = this.maps.item.get(itemId);
    if (!item || item.archived) return false;
    return inLibrary(item) || item.origin.by === 'user' || [...(this.itemNodes.get(itemId) ?? [])].some((id) => this.maps.node.get(id)!.status === 'kept');
  }
  linksOf(nodeId: Id): Link[] {
    return [...this.maps.link.values()].filter((l) => l.a === nodeId || l.b === nodeId);
  }
  nextOrder(parent: Id): number {
    return this.children(parent).reduce((max, n) => Math.max(max, n.order), -1) + 1;
  }

  /** Full-text search over items that are not archived. `placed` leaves out items that no tree holds, such as most of the library. */
  search(query: string, opts: { limit?: number; exclude?: ReadonlySet<Id>; placed?: boolean } = {}): (Hit & { item: Item })[] {
    const skip = (id: Id) => Boolean(opts.exclude?.has(id)) || (Boolean(opts.placed) && !this.itemNodes.get(id)?.size);
    return this.index.search(query, { limit: opts.limit, skip }).map((h) => ({ ...h, item: this.item(h.id) }));
  }

  // ---- internals

  private commit(draft: Draft, undoing: Pick<ChangeSet, 'undoes' | 'alsoUndoes'>, body: () => void): ChangeSet {
    if (this.working) throw new CommandError('invalid', 'apply is not re-entrant');
    this.working = [];
    try {
      body();
    } catch (err) {
      const made = this.working;
      this.working = [];
      for (const p of made.reverse()) this.write(p.entity, p.id, p.before);
      this.working = null;
      throw err;
    }
    const patches = squash(this.working);
    this.working = null;
    const counts = patches.length > 0 || undoing.undoes !== undefined;
    const set: ChangeSet = {
      id: this.opts.newId(),
      seq: counts ? ++this.seq : this.seq,
      at: this.opts.now(),
      origin: draft.origin,
      label: draft.label,
      commands: draft.commands,
      ...(draft.part ? { part: draft.part } : {}),
      patches,
      ...undoing,
    };
    if (counts) this.history.push(set);
    return set;
  }

  private need<E extends EntityName>(entity: E, id: Id): EntityOf<E> {
    const value = this.maps[entity].get(id);
    if (!value) throw new CommandError('missing', `no ${entity} ${id}`);
    return value;
  }

  private absent(entity: EntityName, id: Id): void {
    if (this.maps[entity].has(id)) throw new CommandError('conflict', `${entity} ${id} already exists`);
  }

  private put<E extends EntityName>(entity: E, value: EntityOf<E>): void {
    this.write(entity, value.id, value);
  }

  private del(entity: EntityName, id: Id): void {
    this.write(entity, id, null);
  }

  private write<E extends EntityName>(entity: E, id: Id, after: EntityOf<E> | null): void {
    const map = this.maps[entity] as Map<Id, EntityOf<E>>;
    const before = map.get(id) ?? null;
    if (before === null && after === null) return;
    if (entity === 'node') this.reindexNode(before as Node | null, after as Node | null);
    if (entity === 'item') this.reindexItem(id, after as Item | null);
    if (after === null) map.delete(id);
    else map.set(id, after);
    this.working!.push({ entity, id, before, after } as Patch);
  }

  private reindexNode(before: Node | null, after: Node | null): void {
    if (before) {
      if (before.parent) this.childIndex.get(before.parent)?.delete(before.id);
      this.itemNodes.get(before.itemId)?.delete(before.id);
    }
    if (after) {
      if (after.parent) bucket(this.childIndex, after.parent).add(after.id);
      bucket(this.itemNodes, after.itemId).add(after.id);
    }
  }

  private reindexItem(id: Id, after: Item | null): void {
    if (!after || after.archived) this.index.remove(id);
    else this.index.set(id, { title: after.title, body: `${after.summary}\n${after.text}`, tags: after.tags });
  }

  private run(c: Command): void {
    switch (c.type) {
      case 'addItem':
        this.absent('item', c.item.id);
        this.put('item', c.item);
        return;
      case 'editItem': {
        const item = this.item(c.id);
        if (c.expectRevision !== undefined && c.expectRevision !== item.revision) {
          throw new CommandError('conflict', `item ${c.id} is at revision ${item.revision}, not ${c.expectRevision}`);
        }
        const { data, ...rest } = c.patch;
        const merged = data ? { ...item.data, ...data } : item.data;
        this.put('item', {
          ...item,
          ...defined(rest),
          // A new title brings its own short title for a small face, or none when it fits whole.
          data: rest.title === undefined ? merged : withShortTitle(merged, rest.title),
          revision: item.revision + 1,
        });
        return;
      }
      case 'createTree': {
        this.absent('tree', c.tree.id);
        if (c.tree.rootId !== c.root.id || c.root.treeId !== c.tree.id || c.root.parent !== null) {
          throw new CommandError('invalid', 'a tree and its root must name each other, and a root has no parent');
        }
        this.put('tree', c.tree);
        this.addNode(c.root);
        return;
      }
      case 'renameTree':
        this.put('tree', { ...this.tree(c.id), title: c.title });
        return;
      case 'setDigest':
        this.put('tree', { ...this.tree(c.id), digest: c.digest });
        return;
      case 'deleteTree':
        this.removeSubtree(this.tree(c.id).rootId);
        return;
      case 'addNode':
        if (c.node.parent === null) throw new CommandError('invalid', 'only createTree adds a root');
        if (this.node(c.node.parent).treeId !== c.node.treeId) {
          throw new CommandError('invalid', `parent ${c.node.parent} is in another tree`);
        }
        this.tree(c.node.treeId);
        this.addNode(c.node);
        return;
      case 'moveNode':
        this.moveNode(c.id, c.parent, c.treeId, c.order);
        return;
      case 'deleteNode':
        this.removeSubtree(c.id);
        return;
      case 'keepPick':
        for (const n of this.path(c.id)) if (n.status === 'pick') this.put('node', { ...n, status: 'kept' });
        return;
      case 'setWhy': {
        const n = this.node(c.id);
        this.put('node', { ...n, why: c.why, importance: c.importance ?? n.importance });
        return;
      }
      case 'setView':
        this.put('node', { ...this.node(c.id), view: c.view });
        return;
      case 'addEdit': {
        const n = this.node(c.id);
        const edits = [...(n.edits ?? []).filter((e) => e.id !== c.edit.id), c.edit];
        if (edits.length > MAX_EDITS) throw new CommandError('invalid', `a card keeps at most ${MAX_EDITS} edits`);
        this.put('node', { ...n, edits });
        return;
      }
      case 'removeEdit': {
        const { edits = [], ...n } = this.node(c.id);
        const left = edits.filter((e) => e.id !== c.editId);
        this.put('node', left.length > 0 ? { ...n, edits: left } : n);
        return;
      }
      case 'setGroup': {
        const members = [...new Set(c.group.members)];
        for (const id of [c.group.anchor, ...members]) {
          if (this.node(id).treeId !== c.group.treeId) {
            throw new CommandError('invalid', `node ${id} is not in tree ${c.group.treeId}`);
          }
        }
        const composite = c.group.composite as CompositeId;
        if (!Object.hasOwn(MEMBERS, composite)) throw new CommandError('invalid', `no composite is called ${c.group.composite}`);
        const [fewest, most] = MEMBERS[composite];
        if (members.length < fewest || members.length > most) {
          throw new CommandError('invalid', `a ${composite} holds ${most === Infinity ? `at least ${fewest}` : fewest === most ? fewest : `${fewest} to ${most}`} members, not ${members.length}`);
        }
        if (!isValidGroup(c.group)) throw new CommandError('invalid', `the props of a ${composite} are not what it takes`);
        if (new Set(members.map((id) => this.node(id).status)).size > 1) throw new CommandError('invalid', 'a group holds picks or kept cards, never both');
        for (const group of this.maps.group.values()) {
          const shared = group.id !== c.group.id && members.find((id) => group.members.includes(id));
          if (shared) throw new CommandError('invalid', `node ${shared} is already in group ${group.id}`);
        }
        this.put('group', { ...c.group, members });
        return;
      }
      case 'removeGroup':
        this.need('group', c.id);
        this.del('group', c.id);
        return;
      case 'link':
        this.absent('link', c.link.id);
        if (c.link.a === c.link.b) throw new CommandError('invalid', 'a link needs two different nodes');
        this.node(c.link.a);
        this.node(c.link.b);
        this.put('link', c.link);
        return;
      case 'unlink':
        this.need('link', c.id);
        this.del('link', c.id);
        return;
    }
  }

  private addNode(node: Node): void {
    this.absent('node', node.id);
    const item = this.item(node.itemId);
    if (item.archived) this.put('item', { ...item, archived: false });
    this.put('node', node);
  }

  private moveNode(id: Id, parent: Id, treeId?: Id, order?: number): void {
    const node = this.node(id);
    const target = this.node(parent);
    const moved = this.subtree(id);
    if (moved.some((n) => n.id === parent)) throw new CommandError('invalid', 'a node cannot move under itself');
    if (treeId !== undefined && treeId !== target.treeId) {
      throw new CommandError('invalid', `parent ${parent} is not in tree ${treeId}`);
    }
    const from = node.treeId;
    const to = target.treeId;
    const wasRoot = node.parent === null;
    if (wasRoot && from === to) throw new CommandError('invalid', 'a root cannot move inside its own tree');
    const place = order ?? this.nextOrder(parent);
    for (const n of moved) {
      this.put('node', n.id === id ? { ...n, treeId: to, parent, order: place } : { ...n, treeId: to });
    }
    if (from !== to) {
      this.dropFromGroups(new Set(moved.map((n) => n.id)), from);
      if (wasRoot) this.del('tree', from);
    }
  }

  private removeSubtree(id: Id): void {
    const root = this.node(id);
    const gone = this.subtree(id);
    const ids = new Set(gone.map((n) => n.id));
    for (const link of [...this.maps.link.values()]) {
      if (ids.has(link.a) || ids.has(link.b)) this.del('link', link.id);
    }
    this.dropFromGroups(ids, root.treeId);
    for (const n of [...gone].reverse()) this.del('node', n.id);
    for (const itemId of new Set(gone.map((n) => n.itemId))) {
      const item = this.item(itemId);
      // Taking away an agent's suggestion of something the user dropped leaves it in their knowledge base.
      const suggested = item.origin.by === 'user' && gone.every((n) => n.itemId !== itemId || (n.status === 'pick' && n.origin.by === 'agent'));
      if (!this.itemNodes.get(itemId)?.size && !item.archived && !inLibrary(item) && !suggested) this.put('item', { ...item, archived: true });
    }
    if (root.parent === null) this.del('tree', root.treeId);
  }

  private dropFromGroups(nodeIds: ReadonlySet<Id>, treeId: Id): void {
    for (const group of [...this.maps.group.values()]) {
      if (group.treeId !== treeId) continue;
      const members = group.members.filter((m) => !nodeIds.has(m));
      if (members.length === group.members.length && !nodeIds.has(group.anchor)) continue;
      if (nodeIds.has(group.anchor) || members.length < 2) this.del('group', group.id);
      else this.put('group', { ...group, members });
    }
  }
}

function bucket(map: Map<Id, Set<Id>>, key: Id): Set<Id> {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  return set;
}

function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** One patch per entity, from its first `before` to its last `after`, in first-touched order. */
function squash(patches: Patch[]): Patch[] {
  const byKey = new Map<string, Patch>();
  for (const p of patches) {
    const key = `${p.entity}:${p.id}`;
    const first = byKey.get(key);
    if (first) first.after = p.after;
    else byKey.set(key, { ...p });
  }
  return [...byKey.values()].filter((p) => !same(p.before, p.after));
}

function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([x], [y]) => (x < y ? -1 : 1)))
      : v,
  );
}
