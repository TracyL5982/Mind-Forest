import { z } from 'zod';
import type { Command, Id, Item, Node, Tree } from '../domain.ts';
import { MINDSTORM } from '../round.ts';
import { tokenize } from '../search.ts';
import { AGENT, idFrom, makeNode, pickStatus, type RoleContext, type Roles, type TreeRequest } from './types.ts';

const ROLE = 'filer';
const MAX_TREES = 8;
const MAX_PARENTS = 12;
const MAX_ITEMS = 40;

const Answer = z.object({
  placements: z.array(
    z.object({
      itemId: z.string(),
      parentNodeId: z.string(),
      strength: z.number(),
      why: z.string(),
    }),
  ),
});
type Answer = z.infer<typeof Answer>;

/**
 * Where one dropped item goes: under a card already in a tree, under another item of the same drop, or as the root of the tree
 * the user asked for. An item with no placement stays in the knowledge base, and no tree holds it.
 */
type Placement =
  | { at: 'card'; parent: Id; why: string }
  | { at: 'item'; under: Id; why: string }
  | { at: 'root'; title: string };

interface Shortlisted {
  tree: Tree;
  parents: Node[];
}

export const filer: Roles['filer'] = async (ctx, items, request) => {
  if (items.length === 0) return [];
  const batch = new Map(items.map((i) => [i.id, i]));
  const placements = request ? grow(items, batch, request) : await place(ctx, items, batch);
  return emit(ctx, items, batch, placements, Boolean(request));
};

const SYSTEM =
  'You are the Filer of a spatial brainstorming app. Everything the user drops in joins their knowledge base. You decide whether a new item also belongs under one card of the trees they are growing.';

/** Asked for a tree: the first item that is not a chat's takeaway is its root, each takeaway hangs under its chat, the rest under the root. */
function grow(items: Item[], batch: ReadonlyMap<Id, Item>, request: TreeRequest): Map<Id, Placement> {
  const chatOf = (item: Item) => {
    const chat = item.data.fromChat;
    return typeof chat === 'string' && chat !== item.id && batch.has(chat) ? chat : null;
  };
  const root = items.find((i) => !chatOf(i)) ?? items[0]!;
  const out = new Map<Id, Placement>([[root.id, { at: 'root', title: treeTitle(request.title) || treeTitle(nameOf(root)) }]]);
  for (const item of items) {
    if (item === root) continue;
    const chat = chatOf(item);
    out.set(item.id, chat ? { at: 'item', under: chat, why: 'taken from this chat' } : { at: 'item', under: root.id, why: 'dropped with it' });
  }
  return out;
}

/** Not asked for a tree: only a strong fit under a card is placed, and the model is asked only when there are trees to place under. */
async function place(ctx: RoleContext, items: Item[], batch: ReadonlyMap<Id, Item>): Promise<Map<Id, Placement>> {
  const out = new Map<Id, Placement>();
  for (const item of items) {
    const fromChat = chatPlacement(ctx, item, batch);
    if (fromChat) out.set(item.id, fromChat);
  }
  const open = items.filter((i) => !out.has(i.id));
  if (open.length > MAX_ITEMS) ctx.note(ROLE, `${open.length - MAX_ITEMS} items were kept in the knowledge base unjudged, the drop was too large to judge at once`);
  const asked = open.slice(0, MAX_ITEMS);
  const trees = asked.length > 0 ? shortlist(ctx, asked) : [];
  if (trees.length > 0) {
    try {
      const answer = await ctx.model.json({ role: ROLE, system: SYSTEM, user: prompt(ctx, asked, trees), schema: Answer, effort: 'medium' });
      for (const [id, placement] of validate(ctx, answer, batch)) out.set(id, placement);
    } catch (err) {
      ctx.note(ROLE, `the model did not answer (${message(err)}), what was dropped stays in the knowledge base`);
    }
  }
  // A takeaway goes where its chat goes, and nowhere when its chat is placed nowhere.
  for (const [id, p] of out) if (p.at === 'item' && !out.has(p.under)) out.delete(id);
  return out;
}

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
    'Just dropped in:',
    itemLines.join('\n'),
    '',
    `The user's trees, each with the cards an item could hang under:\n${treeLines.join('\n')}`,
    '',
    'Everything dropped stays in the knowledge base on its own. Hang an item under a card only when it plainly belongs there: the same specific subject, a direct example, answer, cause or contradiction of what the card holds. A shared word or a broad topic is not enough. Most items belong under no card.',
    'Return one placement for every item, using the ids exactly as written.',
    '- parentNodeId: the card it belongs under, the most specific one that fits. Empty when none does.',
    '- strength: how strongly it belongs there, from 0 to 1. Be strict: 0.8 or above only when the user would be glad to find it there. 0 when parentNodeId is empty.',
    '- why: one short phrase saying why it sits there. Empty when parentNodeId is empty.',
  ].join('\n');
}

/** Chat takeaways hang under the chat they came from, without asking the model. */
function chatPlacement(ctx: RoleContext, item: Item, batch: ReadonlyMap<Id, Item>): Placement | null {
  const chatId = item.data.fromChat;
  if (typeof chatId !== 'string' || chatId === item.id) return null;
  const why = 'taken from this chat';
  if (batch.has(chatId)) return { at: 'item', under: chatId, why };
  const node = ctx.mind.nodesOfItem(chatId)[0];
  return node ? { at: 'card', parent: node.id, why } : null;
}

function shortlist(ctx: RoleContext, items: Item[]): Shortlisted[] {
  const treeScore = new Map<Id, number>();
  const nodeScore = new Map<Id, number>();
  const bump = (map: Map<Id, number>, id: Id, by: number) => map.set(id, (map.get(id) ?? 0) + by);

  for (const item of items) {
    const terms = new Set(tokenize(`${item.title} ${item.tags.join(' ')}`));
    for (const hit of ctx.mind.search(`${item.title} ${item.tags.join(' ')} ${oneLine(item.summary, 300)}`, { limit: 8, placed: true })) {
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
    const item = batch.get(idFrom(p.itemId));
    if (!item || out.has(item.id) || !(p.strength >= ctx.settings.strongTie)) continue;
    // The model sometimes names the tree where a node was asked for. Its root is what it meant.
    const named = idFrom(p.parentNodeId);
    const parent = ctx.mind.nodes.get(named) ?? ctx.mind.nodes.get(ctx.mind.trees.get(named)?.rootId ?? '');
    if (parent?.status === 'kept') out.set(item.id, { at: 'card', parent: parent.id, why: oneLine(p.why, 80) || 'belongs here' });
  }
  return out;
}

/**
 * The tree the user asked for is theirs, so its cards are kept. Anything else is the agent's suggestion: a pick, holding the item
 * the user dropped, that leaves it in the knowledge base when it is taken away.
 */
function emit(ctx: RoleContext, items: Item[], batch: ReadonlyMap<Id, Item>, placements: ReadonlyMap<Id, Placement>, asked: boolean): Command[] {
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
      node = makeNode(ctx, item, { treeId, parent: null, status: 'kept', why: 'starts this topic', origin: item.origin });
      commands.push({
        type: 'createTree',
        tree: { id: treeId, title: p.title, rootId: node.id, digest: oneLine(item.summary || item.title || item.text, 160), createdAt: ctx.now() },
        root: node,
      });
    } else {
      const parent = p.at === 'card' ? ctx.mind.node(p.parent) : place(batch.get(p.under)!);
      const offset = addedUnder.get(parent.id) ?? 0;
      addedUnder.set(parent.id, offset + 1);
      const status = asked ? 'kept' : pickStatus(ctx);
      node = makeNode(ctx, item, { treeId: parent.treeId, parent: parent.id, status, why: p.why, origin: asked ? item.origin : AGENT(ROLE, MINDSTORM), offset });
      commands.push({ type: 'addNode', node });
    }
    placed.set(item.id, node);
    return node;
  };

  for (const item of items) if (placements.has(item.id)) place(item);
  return commands;
}

function nameOf(item: Item): string {
  return item.title || item.summary || item.text || 'Untitled';
}

function treeTitle(raw: string): string {
  const title = raw
    .replace(/["“”]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ')
    .replace(/[.,;:!?]+$/, '');
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
