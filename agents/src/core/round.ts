import type { Command, Id, Item, Node } from './domain.ts';
import type { Mindstorm } from './state.ts';

/**
 * The round of a card is the unkept picks hanging off it. These rules hold for every round, whoever brings the picks:
 * at most ROUND_MOST picks, at most KNOWN_MOST of them things the user already had, and nothing inside a tree repeats.
 */
export const ROUND_MOST = 10;
/** The rest of a round stays open to new content. */
export const KNOWN_MOST = 8;

/** `origin.tool` of a pick that holds an item from the user's own mindstorm: a dump, or a card of another tree. */
export const MINDSTORM = 'mindstorm';
/** `origin.tool` of a pick that holds an item from the headset's library. */
export const LIBRARY_TOOL = 'library';

/** A pick that holds something the user already had, rather than something new the agent brought. */
export function isKnown(node: Node): boolean {
  return node.origin.tool === MINDSTORM || node.origin.tool === LIBRARY_TOOL;
}

/** An unkept pick of new content an agent brought, which gives way to the same thing the user already had. */
export function givesWay(node: Node): boolean {
  return node.status === 'pick' && node.origin.by === 'agent' && !isKnown(node);
}

/** How many new things a run asks for beside `known` things the user already had: what the user set, never past the round, and never fewer than the room kept open. */
export function newSlots(known: number, wanted: number): number {
  return Math.max(ROUND_MOST - KNOWN_MOST, Math.min(wanted, ROUND_MOST - known));
}

/**
 * The keys two items share when they are the same content: the same item, the same address (where it was found, the file
 * it plays, the stored picture), or the same title once case, punctuation and a leading article are set aside.
 */
export function sameness(item: Item): string[] {
  const keys = [`id:${item.id}`];
  if (item.source.url) keys.push(`url:${urlKey(item.source.url)}`);
  if (item.source.asset) keys.push(`asset:${item.source.asset}`);
  const media = item.data.mediaUrl;
  if (typeof media === 'string') {
    const asset = /^\/assets\/([^/?#]+)/.exec(media)?.[1];
    keys.push(asset ? `asset:${asset}` : `url:${urlKey(media)}`);
  }
  const title = plainTitle(item.title);
  if (title) keys.push(`title:${title}`);
  return keys;
}

export function plainTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Every key of what a tree holds, each with the node that holds it. Nodes in `without` are left out, as if already gone. */
export function treeKeys(mind: Mindstorm, treeId: Id, without: ReadonlySet<Id> = new Set()): Map<string, Id> {
  const keys = new Map<string, Id>();
  if (!mind.trees.has(treeId)) return keys;
  for (const node of mind.treeNodes(treeId)) {
    if (without.has(node.id)) continue;
    for (const key of sameness(mind.item(node.itemId))) if (!keys.has(key)) keys.set(key, node.id);
  }
  return keys;
}

/**
 * Holds what an agent wants to add to the rules of the round, against the mindstorm as it is at the moment of applying:
 * - A node whose item repeats something already in its tree is left out, with the item it would have brought. A known pick
 *   that repeats only unkept new picks takes their place instead, since what the user already has wins.
 * - Around each card, the oldest unkept picks from before make room, so at most ROUND_MOST stay and at most KNOWN_MOST of them known.
 *   When the commands alone bring more than that, the last of them are left out, new ones before known ones.
 * Kept cards never count and are never taken away. Returns the commands to apply.
 */
export function admit(mind: Mindstorm, commands: Command[]): Command[] {
  const added = new Map<Id, Item>();
  for (const c of commands) if (c.type === 'addItem') added.set(c.item.id, c.item);
  const itemOf = (node: Node) => added.get(node.itemId) ?? mind.item(node.itemId);

  const gone = new Set<Id>();
  for (const c of commands) if (c.type === 'deleteNode' && mind.nodes.has(c.id)) for (const n of mind.subtree(c.id)) gone.add(n.id);
  const keysByTree = new Map<Id, Map<string, Id>>();
  const keysOf = (treeId: Id) => {
    let keys = keysByTree.get(treeId);
    if (!keys) keysByTree.set(treeId, (keys = treeKeys(mind, treeId, gone)));
    return keys;
  };

  const incoming: Node[] = [];
  const left = new Set<Id>();
  const displaced: Id[] = [];
  const displace = (id: Id) => {
    displaced.push(id);
    gone.add(id);
  };
  for (const c of commands) {
    const node = c.type === 'addNode' ? c.node : c.type === 'createTree' ? c.root : null;
    if (!node) continue;
    incoming.push(node);
    if (node.parent && left.has(node.parent)) {
      left.add(node.id);
      continue;
    }
    const keys = keysOf(node.treeId);
    const own = sameness(itemOf(node));
    const holders = [...new Set(own.flatMap((key) => keys.get(key) ?? []))];
    const gives = (id: Id) => mind.nodes.has(id) && givesWay(mind.node(id));
    if (holders.length > 0 && !(isKnown(node) && holders.every(gives))) {
      left.add(node.id);
      continue;
    }
    for (const id of holders) {
      displace(id);
      for (const [key, holder] of keys) if (holder === id) keys.delete(key);
    }
    for (const key of own) keys.set(key, node.id);
  }

  const anchors = new Set(incoming.filter((n) => n.status === 'pick' && n.parent !== null && !left.has(n.id)).map((n) => n.parent!));
  for (const anchor of anchors) {
    const old = (mind.nodes.has(anchor) ? mind.picks(anchor) : []).filter((n) => !gone.has(n.id)).sort((a, b) => a.order - b.order);
    const fresh = incoming.filter((n) => n.parent === anchor && n.status === 'pick' && !left.has(n.id));
    const fit = (counts: (n: Node) => boolean, most: number) => {
      let over = old.filter((n) => !gone.has(n.id) && counts(n)).length + fresh.filter((n) => !left.has(n.id) && counts(n)).length - most;
      for (const n of old) {
        if (over <= 0) return;
        if (gone.has(n.id) || !counts(n)) continue;
        displace(n.id);
        over--;
      }
      // What the commands bring beyond the round is left out: the last to come, and new content before what the user already had.
      for (const n of [...fresh].reverse().sort((a, b) => Number(isKnown(a)) - Number(isKnown(b)))) {
        if (over <= 0) return;
        if (left.has(n.id) || !counts(n)) continue;
        left.add(n.id);
        over--;
      }
    };
    fit(isKnown, KNOWN_MOST);
    fit(() => true, ROUND_MOST);
  }
  for (const n of incoming) if (n.parent && left.has(n.parent)) left.add(n.id);

  // Something an agent made only to show here goes with its node. What the user dropped stays, in their knowledge base.
  const shown = new Set(incoming.filter((n) => !left.has(n.id)).map((n) => n.itemId));
  const unshown = new Set(incoming.filter((n) => left.has(n.id) && !shown.has(n.itemId)).map((n) => n.itemId));
  const out: Command[] = displaced.map((id): Command => ({ type: 'deleteNode', id }));
  for (const c of commands) {
    if (c.type === 'addItem' && unshown.has(c.item.id) && c.item.origin.by === 'agent') continue;
    if (c.type === 'addNode' && left.has(c.node.id)) continue;
    if (c.type === 'createTree' && left.has(c.root.id)) continue;
    out.push(c);
  }
  return out;
}
