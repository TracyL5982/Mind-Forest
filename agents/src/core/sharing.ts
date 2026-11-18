/**
 * A tree shared from one person's forest into a friend's: a copy taken when it is shared, and the planting it becomes in the
 * friend's forest (`growing.ts` grows it), under ids of its own, with its files' references pointing at the friend's copies of them.
 * Only the cards the sharer kept go, with the first card: suggestions they never kept stay behind.
 */
import type { Command, Id, Item, Node } from './domain.ts';
import type { Planting } from './growing.ts';
import type { Mindstorm } from './state.ts';

/** The most cards one shared tree may hold. */
export const SHARE_CARDS = 400;
/** The most bytes of files one shared tree may take with it. */
export const SHARE_BYTES = 25e6;

/** A file a shared tree's cards show: its bytes, or where it is linked from (a film on the host, an address). */
export interface SharedFile {
  id: Id;
  mime: string;
  name?: string;
  bytes?: Uint8Array;
  link?: string;
}

/**
 * What a headset is told of a tree it shared (`{t: 'shared'}`): the link went to the person's chat, or why not, with a line it may
 * show. `unpaired`: no Telegram is paired with this headset. `limit`: the day's shares are used. `too-big`: past the caps.
 * `unavailable`: the bot or the copy failed.
 */
export type ShareAnswer = { ok: true } | { ok: false; reason: 'unpaired' | 'limit' | 'too-big' | 'unavailable'; text: string };

/** A tree as it was shared: its title, its first card and then its kept cards a layer at a time, their items, and their files. */
export interface TreeCopy {
  version: 1;
  title: string;
  /** Each card after its parent: the first card, then the kept cards under it, a layer at a time, each layer in order. */
  nodes: Node[];
  items: Item[];
  /** The files the cards show, by their ids in the sharer's store. */
  assets: Id[];
}

/** A file's place in a card: its id, and the address a client loads it from, `/assets/<id>`. */
const ASSET_URL = /\/assets\/([0-9a-f]{16}\.[a-z0-9]{1,5})/g;

/** The copy of a tree as it stands now, or null when there is no such tree. */
export function copyOf(mind: Mindstorm, treeId: Id): TreeCopy | null {
  const tree = mind.trees.get(treeId);
  if (!tree || !mind.nodes.has(tree.rootId)) return null;
  const nodes: Node[] = [mind.node(tree.rootId)];
  for (let layer = [tree.rootId]; layer.length > 0; ) {
    const next = layer.flatMap((id) => mind.children(id).filter((node) => node.status === 'kept'));
    nodes.push(...next);
    layer = next.map((node) => node.id);
  }
  const items = [...new Map(nodes.map((node) => [node.itemId, mind.item(node.itemId)])).values()];
  const assets = new Set<Id>();
  for (const item of items) if (item.source.asset) assets.add(item.source.asset);
  for (const match of JSON.stringify({ nodes, items }).matchAll(ASSET_URL)) assets.add(match[1]!);
  return { version: 1, title: tree.title, nodes, items, assets: [...assets] };
}

/**
 * The planting a copy becomes: every card, item and the tree under a new id, each file's reference pointing at its copy here
 * (`files`: old id to new), every card kept, the tree made `at`. Its first card comes with the tree, then the layers.
 */
export function plantingOf(copy: TreeCopy, files: Map<Id, Id>, newId: () => Id, at: string): Planting & { treeId: Id } {
  const ids = new Map<Id, Id>();
  const idOf = (old: Id) => {
    let made = ids.get(old);
    if (!made) ids.set(old, (made = newId()));
    return made;
  };
  /** A value with each file's address and id moved to its copy here. */
  const moved = <T>(value: T): T => JSON.parse(JSON.stringify(value).replace(ASSET_URL, (whole, id: string) => (files.has(id) ? `/assets/${files.get(id)}` : whole))) as T;
  const treeId = newId();
  const items = new Map(copy.items.map((item): [Id, Item] => {
    const source = item.source.asset && files.has(item.source.asset) ? { ...item.source, asset: files.get(item.source.asset)! } : item.source;
    return [item.id, moved({ ...item, id: idOf(item.id), source, archived: false })];
  }));
  const added = new Set<Id>();
  const itemFor = (node: Node): Command[] => (added.has(node.itemId) ? [] : (added.add(node.itemId), [{ type: 'addItem', item: items.get(node.itemId)! }]));
  const [root, ...rest] = copy.nodes;
  if (!root) throw new Error('a shared tree with no first card');
  const nodeOf = (node: Node): Node => moved({ ...node, id: idOf(node.id), treeId, itemId: items.get(node.itemId)!.id, parent: node.parent === null || node.id === root.id ? null : idOf(node.parent), status: 'kept' });
  const rootNode = nodeOf(root);
  const first: Command[] = [...itemFor(root), { type: 'createTree', tree: { id: treeId, title: copy.title, rootId: rootNode.id, digest: '', createdAt: at }, root: rootNode }];
  // The cards a layer at a time: those under the first card, then those under them.
  const depth = new Map<Id, number>([[root.id, 0]]);
  const layers: Command[][] = [];
  for (const node of rest) {
    const d = (depth.get(node.parent ?? '') ?? 0) + 1;
    depth.set(node.id, d);
    (layers[d - 1] ??= []).push(...itemFor(node), { type: 'addNode', node: nodeOf(node) });
  }
  return { treeId, title: copy.title, rootId: rootNode.id, first, layers: layers.filter(Boolean) };
}
