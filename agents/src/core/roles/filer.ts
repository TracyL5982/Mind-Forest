import { z } from 'zod';
import type { Command, Id, Item, Node, Tree } from '../domain.ts';
import { tokenize } from '../search.ts';
import { makeNode, type RoleContext, type Roles } from './types.ts';

const ROLE = 'filer';
const MAX_TREES = 8;
const MAX_PARENTS = 12;
const MAX_ITEMS = 40;
const FIT = 0.5;

const Answer = z.object({
  placements: z.array(
    z.object({
      itemId: z.string(),
      place: z.enum(['existing', 'new']),
      parentNodeId: z.string(),
      treeTitle: z.string(),
      joinsItemId: z.string(),
      why: z.string(),
    }),
  ),
});
type Answer = z.infer<typeof Answer>;

/** Where one new item goes: under a node already in the mindstorm, under another item of the same batch, or as the root of a new tree. */
type Placement =
  | { at: 'node'; parent: Id; why: string }
  | { at: 'item'; under: Id; why: string }
  | { at: 'root'; title: string; why: string };

interface Shortlisted {
  tree: Tree;
  parents: Node[];
}

export const filer: Roles['filer'] = async (ctx, items) => {
  if (items.length === 0) return [];
  const batch = new Map(items.map((i) => [i.id, i]));
  const placements = new Map<Id, Placement>();

  for (const item of items) {
    const fromChat = chatPlacement(ctx, item, batch);
    if (fromChat) placements.set(item.id, fromChat);
  }

  const open = items.filter((i) => !placements.has(i.id));
  if (open.length > MAX_ITEMS) ctx.note(ROLE, `${open.length - MAX_ITEMS} items were filed by search alone, the batch was too large to judge at once`);
  const asked = open.slice(0, MAX_ITEMS);
  if (asked.length > 0) {
    const trees = shortlist(ctx, asked);
    try {
      const answer = await ctx.model.json({
        role: ROLE,
        system: SYSTEM,
        user: prompt(ctx, asked, trees),
        schema: Answer,
        effort: 'medium',
      });
      for (const [id, placement] of validate(ctx, answer, batch)) placements.set(id, placement);
    } catch (err) {
      ctx.note(ROLE, `the model did not answer (${message(err)}), filing by search instead`);
    }
  }

  for (const item of items) {
    if (!placements.has(item.id)) placements.set(item.id, fallback(ctx, item));
  }
  for (const item of items) {
    if (loops(item.id, placements)) placements.set(item.id, fallback(ctx, item));
  }
  return emit(ctx, items, batch, placements);
};

const SYSTEM =
  'You are the Filer of a spatial brainstorming app. The user drops things in, and you decide where each new item belongs among their trees of ideas.';

function prompt(ctx: RoleContext, items: Item[], trees: Shortlisted[]): string {
  const itemLines = items.map((i) => {
    const tags = i.tags.length > 0 ? ` Tags: ${i.tags.slice(0, 8).join(', ')}.` : '';
    return `- item ${i.id} (${i.kind}) "${oneLine(i.title, 100)}".${tags} ${oneLine(i.summary || i.text, 240)}`;
  });
  const treeLines = trees.map(({ tree, parents }) =>
    [
      `- tree ${tree.id} "${oneLine(tree.title, 80)}": ${oneLine(tree.digest, 200)}`,
      ...parents.map((n) => {
        const item = ctx.mind.itemOf(n.id);
        return `    node ${n.id} (depth ${ctx.mind.depth(n.id)}) "${oneLine(item.title, 80)}": ${oneLine(item.summary || item.text, 120)}`;
      }),
    ].join('\n'),
  );
  return [
    'New items to place:',
    itemLines.join('\n'),
    '',
    trees.length > 0 ? `Existing trees, each with the nodes an item could hang under:\n${treeLines.join('\n')}` : 'There are no existing trees yet.',
    '',
    'Return one placement for every item, using the ids exactly as written.',
    '- place "existing": the item really belongs to the topic of an existing tree. Set parentNodeId to the node it should hang under, the most specific one that fits. Leave treeTitle and joinsItemId empty.',
    '- place "new": the item is about something none of the trees cover. A weak or surface match is not enough to join a tree, so start a new one.',
    '  When several new items share one new topic, they form one tree together: one of them is the root (joinsItemId empty, treeTitle set to a short human title of 2 to 5 words), and each of the others sets joinsItemId to the id of the item it hangs under and leaves treeTitle empty.',
    '- why: one short phrase saying why the item sits there.',
    'Set every field you do not use to an empty string.',
  ].join('\n');
}

/** Chat takeaways hang under the chat they came from, without asking the model. */
function chatPlacement(ctx: RoleContext, item: Item, batch: ReadonlyMap<Id, Item>): Placement | null {
  const chatId = item.data.fromChat;
  if (typeof chatId !== 'string' || chatId === item.id) return null;
  const why = 'taken from this chat';
  if (batch.has(chatId)) return { at: 'item', under: chatId, why };
  const node = ctx.mind.nodesOfItem(chatId)[0];
  return node ? { at: 'node', parent: node.id, why } : null;
}

function shortlist(ctx: RoleContext, items: Item[]): Shortlisted[] {
  const treeScore = new Map<Id, number>();
  const nodeScore = new Map<Id, number>();
  const bump = (map: Map<Id, number>, id: Id, by: number) => map.set(id, (map.get(id) ?? 0) + by);

  for (const item of items) {
    const terms = new Set(tokenize(`${item.title} ${item.tags.join(' ')}`));
    for (const hit of ctx.mind.search(`${item.title} ${item.tags.join(' ')} ${oneLine(item.summary, 300)}`, { limit: 8 })) {
      for (const node of ctx.mind.nodesOfItem(hit.id)) {
        if (node.status !== 'kept') continue;
        bump(treeScore, node.treeId, hit.coverage);
        bump(nodeScore, node.id, hit.coverage);
      }
    }
    if (terms.size === 0) continue;
    for (const tree of ctx.mind.trees.values()) {
      const shared = [...new Set(tokenize(`${tree.title} ${tree.digest}`))].filter((t) => terms.has(t)).length;
      if (shared > 0) bump(treeScore, tree.id, shared / terms.size);
    }
  }

  return [...ctx.mind.trees.values()]
    .sort((a, b) => (treeScore.get(b.id) ?? 0) - (treeScore.get(a.id) ?? 0) || (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, MAX_TREES)
    .map((tree) => {
      const kept = ctx.mind.treeNodes(tree.id).filter((n) => n.status === 'kept');
      const depth = new Map(kept.map((n) => [n.id, ctx.mind.depth(n.id)]));
      const parents = kept
        .sort((a, b) => {
          if (a.parent === null || b.parent === null) return a.parent === null ? -1 : 1;
          return (nodeScore.get(b.id) ?? 0) - (nodeScore.get(a.id) ?? 0) || depth.get(a.id)! - depth.get(b.id)!;
        })
        .slice(0, MAX_PARENTS);
      return { tree, parents };
    });
}

function validate(ctx: RoleContext, answer: Answer, batch: ReadonlyMap<Id, Item>): Map<Id, Placement> {
  const out = new Map<Id, Placement>();
  for (const p of answer.placements) {
    const item = batch.get(p.itemId);
    if (!item || out.has(item.id)) continue;
    const why = oneLine(p.why, 80);
    if (p.place === 'existing') {
      // The model sometimes names the tree where a node was asked for. Its root is what it meant.
      const parent = ctx.mind.nodes.get(p.parentNodeId) ?? ctx.mind.nodes.get(ctx.mind.trees.get(p.parentNodeId)?.rootId ?? '');
      if (parent && ctx.mind.trees.has(parent.treeId)) out.set(item.id, { at: 'node', parent: parent.id, why: why || 'belongs to this topic' });
      continue;
    }
    if (p.joinsItemId === '') {
      out.set(item.id, { at: 'root', title: treeTitle(p.treeTitle) || treeTitle(nameOf(item)), why: why || 'starts this topic' });
    } else if (batch.has(p.joinsItemId) && p.joinsItemId !== item.id) {
      out.set(item.id, { at: 'item', under: p.joinsItemId, why: why || 'part of the same idea' });
    }
  }
  return out;
}

function fallback(ctx: RoleContext, item: Item): Placement {
  for (const hit of ctx.mind.search(`${item.title} ${item.tags.join(' ')}`, { limit: 5 })) {
    if (hit.coverage <= FIT) continue;
    const parent = ctx.mind.nodesOfItem(hit.id).find((n) => n.status === 'kept');
    if (parent) return { at: 'node', parent: parent.id, why: `close to "${oneLine(hit.item.title, 40)}"` };
  }
  return { at: 'root', title: treeTitle(nameOf(item)), why: 'starts this topic' };
}

function loops(start: Id, placements: ReadonlyMap<Id, Placement>): boolean {
  const seen = new Set<Id>();
  for (let p = placements.get(start); p?.at === 'item'; p = placements.get(p.under)) {
    if (p.under === start) return true;
    // A loop further along that does not include `start` is broken when its own members are checked.
    if (seen.has(p.under)) return false;
    seen.add(p.under);
  }
  return false;
}

function emit(ctx: RoleContext, items: Item[], batch: ReadonlyMap<Id, Item>, placements: ReadonlyMap<Id, Placement>): Command[] {
  const commands: Command[] = [];
  const placed = new Map<Id, Node>();
  const addedUnder = new Map<Id, number>();

  const place = (item: Item): Node => {
    const done = placed.get(item.id);
    if (done) return done;
    const p = placements.get(item.id)!;
    let node: Node;
    if (p.at === 'root') {
      const treeId = ctx.newId();
      node = makeNode(ctx, item, { treeId, parent: null, status: 'kept', why: p.why, origin: item.origin });
      commands.push({
        type: 'createTree',
        tree: { id: treeId, title: p.title, rootId: node.id, digest: oneLine(item.summary || item.title || item.text, 160), createdAt: ctx.now() },
        root: node,
      });
    } else {
      const parent = p.at === 'node' ? ctx.mind.node(p.parent) : place(batch.get(p.under)!);
      const offset = addedUnder.get(parent.id) ?? 0;
      addedUnder.set(parent.id, offset + 1);
      node = makeNode(ctx, item, { treeId: parent.treeId, parent: parent.id, status: 'kept', why: p.why, origin: item.origin, offset });
      commands.push({ type: 'addNode', node });
    }
    placed.set(item.id, node);
    return node;
  };

  for (const item of items) place(item);
  return commands;
}

function nameOf(item: Item): string {
  return item.title || item.summary || item.text || 'Untitled';
}

function treeTitle(raw: string): string {
  return raw
    .replace(/["“”]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ')
    .replace(/[.,;:!?]+$/, '');
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
