import { z } from 'zod';
import type { Id, Node } from '../domain.ts';
import { treeRequest } from '../tree-request.ts';
import type { Conducted, Intent, RoleContext, Roles, Scene, Scope, Turn } from './types.ts';

const ROLE = 'conductor';

const HISTORY_TURNS = 6;
const SHORTLIST = 8;
const MAX_TREES = 30;
const MAX_CHILDREN = 12;
const MAX_SAY_WORDS = 15;

const SAY_POINT = 'What should I look at? Point at a note or a tree.';
const SAY_TREE_ABOUT = 'What should the tree be about?';

const DEFAULT_SAY: Record<Intent['kind'], string> = {
  ask: 'Looking into that.',
  more: 'Bringing more.',
  navigate: 'Going there.',
  organize: 'On it.',
  handoff: 'Packaging that up.',
  capture: 'Got it, noted.',
  tree: 'Starting a tree on that.',
  keep: 'Kept.',
  undo: 'Undone.',
  reply: "I'm here. What should we look at?",
};

// ---- fast path

/** A command plain code recognises. Anything else needs the model. */
type Fast =
  | { kind: 'more' }
  | { kind: 'undo' }
  | { kind: 'keep'; which: 'that' | 'all' | number }
  | { kind: 'up' }
  | { kind: 'start' };

const COUNT: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function normalize(utterance: string): string {
  return utterance
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(ok|okay|please|now|and) /, '')
    .replace(/ (please|thanks|thank you)$/, '');
}

function matchFast(utterance: string): Fast | null {
  const t = normalize(utterance);
  if (/^((show|give) me )?(some )?more( of (this|that|these|those)| like (this|that))?$/.test(t) || t === 'keep going') return { kind: 'more' };
  if (/^(no )?(undo|revert)( that| it| this)?$/.test(t) || /^put (it|that|them) back$/.test(t)) return { kind: 'undo' };
  if (/^keep (that|it|this)( one)?$/.test(t)) return { kind: 'keep', which: 'that' };
  if (/^keep (all|them|these|those|them all|everything|all of (them|these|those))$/.test(t)) return { kind: 'keep', which: 'all' };
  const first = /^keep (?:the )?first(?: (\w+))?$/.exec(t);
  if (first) {
    const word = first[1] ?? 'one';
    const n = COUNT[word] ?? (/^\d+$/.test(word) ? Number(word) : 0);
    return n > 0 ? { kind: 'keep', which: n } : null;
  }
  if (/^(go )?(back )?up( one| a level| one level)?$/.test(t)) return { kind: 'up' };
  if (/^(go |take me )?(back )?to the (start|beginning|top|root)$/.test(t)) return { kind: 'start' };
  return null;
}

/** True when the utterance is an instant command that needs no model call. */
export function isFastPath(utterance: string): boolean {
  return matchFast(utterance) !== null;
}

// ---- scene

interface Seen {
  focus?: Node;
  selection: Node[];
  treeId?: Id;
  /** What an utterance is about when it names nothing. */
  anchor?: Id;
  /** The node whose unkept picks "keep" refers to. */
  picksOf?: Id;
}

function see(ctx: RoleContext, scene: Scene): Seen {
  const { mind } = ctx;
  const focus = scene.focus ? mind.nodes.get(scene.focus) : undefined;
  const selection = scene.selection.flatMap((id) => mind.nodes.get(id) ?? []);
  const treeId = scene.treeId && mind.trees.has(scene.treeId) ? scene.treeId : (focus?.treeId ?? selection[0]?.treeId);
  const anchor = selection[0]?.id ?? focus?.id ?? (treeId ? mind.tree(treeId).rootId : undefined);
  // Looking at a pick, "keep all" means it and its siblings.
  const picksOf = focus && focus.status === 'pick' && focus.parent && mind.picks(focus.id).length === 0 ? focus.parent : (focus?.id ?? anchor);
  return { focus, selection, treeId, anchor, picksOf };
}

function defaultScope(seen: Seen): Scope | null {
  if (seen.selection.length > 0) return { treeIds: [], nodeIds: seen.selection.map((n) => n.id) };
  if (seen.focus) return { treeIds: [], nodeIds: [seen.focus.id] };
  if (seen.treeId) return { treeIds: [seen.treeId], nodeIds: [] };
  return null;
}

const point = (): Conducted => ({ intent: { kind: 'reply' }, say: SAY_POINT });

/**
 * A new tree about `subject`. With no subject the user means "this": what they just dropped, or else the card they have open.
 * Null when there is nothing it could mean.
 */
function treeOf(ctx: RoleContext, subject: string, seen: Seen, dropped: Id[]): Intent | null {
  if (subject) return { kind: 'tree', subject, itemIds: [] };
  const items = dropped.filter((id) => ctx.mind.items.has(id));
  if (items.length > 0) return { kind: 'tree', subject: '', itemIds: items };
  return seen.focus ? { kind: 'tree', subject: '', itemIds: [seen.focus.itemId] } : null;
}

/** "Make a tree about …" and "start a tree on this", heard by plain rules. Null when the utterance asks for no tree. */
export function treeIntent(ctx: RoleContext, utterance: string, scene: Scene, dropped: Id[] = []): Conducted | null {
  const asked = treeRequest(utterance);
  if (!asked) return null;
  const intent = treeOf(ctx, asked.subject || asked.rest, see(ctx, scene), dropped);
  return intent ? { intent, say: DEFAULT_SAY.tree } : { intent: { kind: 'reply' }, say: SAY_TREE_ABOUT };
}

function runFast(ctx: RoleContext, fast: Fast, seen: Seen): Conducted {
  const { mind } = ctx;
  switch (fast.kind) {
    case 'more':
      return seen.anchor ? { intent: { kind: 'more', anchor: seen.anchor }, say: 'Bringing more.' } : point();
    case 'undo':
      return { intent: { kind: 'undo' }, say: 'Undone.' };
    case 'up': {
      if (!seen.focus) return point();
      if (!seen.focus.parent) return { intent: { kind: 'reply' }, say: "We're already at the top." };
      return { intent: { kind: 'navigate', nodeId: seen.focus.parent }, say: 'Going up.' };
    }
    case 'start':
      return seen.treeId ? { intent: { kind: 'navigate', nodeId: mind.tree(seen.treeId).rootId }, say: 'Back to the start.' } : point();
    case 'keep': {
      const picks = seen.picksOf ? mind.picks(seen.picksOf) : [];
      let chosen: Node[];
      if (fast.which === 'all') chosen = picks;
      else if (fast.which === 'that') {
        const selected = seen.selection.filter((n) => n.status === 'pick');
        if (selected.length > 0) chosen = selected;
        else if (seen.focus?.status === 'pick') chosen = [seen.focus];
        else if (picks.length === 1) chosen = picks;
        else if (picks.length > 1) return { intent: { kind: 'reply' }, say: 'Which one should I keep?' };
        else chosen = [];
      } else chosen = picks.slice(0, fast.which);
      if (chosen.length === 0) return { intent: { kind: 'reply' }, say: "There's nothing new here to keep." };
      return { intent: { kind: 'keep', nodeIds: chosen.map((n) => n.id) }, say: chosen.length === 1 ? 'Kept it.' : `Kept ${chosen.length}.` };
    }
  }
}

// ---- model

const Reply = z.object({
  kind: z.enum(['ask', 'more', 'navigate', 'organize', 'handoff', 'capture', 'tree', 'keep', 'undo', 'reply']),
  anchorId: z.string(),
  need: z.string(),
  nodeId: z.string(),
  treeId: z.string(),
  request: z.string(),
  scopeNodeIds: z.array(z.string()),
  scopeTreeIds: z.array(z.string()),
  note: z.string(),
  text: z.string(),
  keepNodeIds: z.array(z.string()),
  say: z.string(),
});
type Reply = z.infer<typeof Reply>;

const SYSTEM = `You are the Conductor of Mind Palace, a spatial brainstorming app. You are the one voice the user talks to.

You are given what the user just said, the recent conversation, the scene (what the user is looking at), the titles of their trees, and a shortlist of nodes whose content matches words in the utterance. Decide what the utterance means and return one intent and one short line to say back. You do not do the work yourself. Other roles act on the intent.

Choose "kind":
- "ask": a question or a stated need about something ("why does this feel like dread?", "I need examples from horror films"). Set anchorId to the node it is about and need to the need restated as a self-contained search phrase. Replace "this", "it" and "that one" with what they refer to, using the scene and the conversation.
- "more": the user wants more of what is already around a node ("more like the second one"). Set anchorId. Set need only when the user narrowed it ("more, but older films"), otherwise leave it empty.
- "navigate": the user wants to go somewhere ("go to my lenses tree", "open the one about Jaws"). Set nodeId for a node or treeId for a tree.
- "organize": any request to move, group, rename, merge, split, delete, tidy or add a note. Set request to the instruction made self-contained. Set scopeNodeIds or scopeTreeIds to what it is about. Leave both empty when it is about the selection or the focus.
- "handoff": the user wants this packaged or exported for another agent or app. Set scopeTreeIds to the focus tree for "this tree" or "everything here". Leave both scope lists empty for "everything" or for the selection or focus. Set note to what the next agent should do, or leave it empty.
- "capture": the user is dictating a thought to keep ("note to self", "remember that", or an idea stated with no question or command). Set text to the thought without the trigger words.
- "tree": the user wants a new tree started, about a subject ("build me a tree around Hitchcock's films") or from what they just dropped or are looking at ("grow a tree out of this"). Set text to the subject in their words, or leave it empty when they mean this. Only when they ask for a tree; a topic alone is not a tree.
- "keep": the user wants to keep picks ("keep the second one"). Set keepNodeIds to ids from the unkept picks listed in the scene.
- "undo": the user wants the last change reverted.
- "reply": a greeting, thanks, or something that cannot be acted on.

What the user is looking at decides what they mean:
- When there is a focus node or a selection, what the user says is about that node unless they clearly name something else. A stated want or topic ("I want to brainstorm world building", "let's think about the soundtrack", "characters") is an "ask" anchored on that node. It is never a "capture" and never a new thought of its own.
- For "ask", write need as what the user wants for that node, in their own words made complete: "world building for this aerial illustration of a car on a winding road", not just "world building".
- Use "capture" only when nothing is in focus and nothing is selected, or when the user says outright to add, note or remember something.

Rules:
- Use ids exactly as given. Never invent an id. When the utterance names nothing, leave anchorId empty and the focus is used.
- Prefer nodes in the focus tree when several match.
- Fill only the fields your kind uses. Leave every other string empty and every other list empty.
- "say" is one spoken line under 15 words, natural, in the first person, saying what is happening ("Looking for horror examples."). For "organize" say "On it." or similar, because the result is reported afterwards. Ask a question only when kind is "reply".`;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function describe(ctx: RoleContext, input: { utterance: string; history: Turn[] }, seen: Seen): string {
  const { mind } = ctx;
  const title = (n: Node) => {
    const item = mind.itemOf(n.id);
    return clip(item.title || item.text, 80) || '(untitled)';
  };
  const line = (n: Node) => `- ${n.id}: ${title(n)}`;
  const list = (rows: string[]) => (rows.length > 0 ? rows.join('\n') : '(none)');
  const out: string[] = [];

  const turns = input.history.slice(-HISTORY_TURNS);
  out.push(`Recent conversation:\n${list(turns.map((t) => `${t.who}: ${clip(t.text, 200)}`))}`);

  if (seen.focus) {
    const item = mind.itemOf(seen.focus.id);
    const path = mind.path(seen.focus.id).map(title).join(' > ');
    const children = mind.children(seen.focus.id);
    const kept = children.filter((n) => n.status === 'kept').slice(0, MAX_CHILDREN);
    out.push(
      `Focus node: ${seen.focus.id}: ${title(seen.focus)}` +
        `\nTree: ${seen.focus.treeId}: ${mind.tree(seen.focus.treeId).title}` +
        `\nPath from the root: ${path}` +
        `\nKind: ${item.kind}, ${item.origin.by === 'user' ? 'dropped in by the user' : 'brought by an agent'}` +
        `\nSummary: ${clip(item.summary || item.text, 400) || '(none)'}` +
        `\nKept children:\n${list(kept.map(line))}`,
    );
  } else if (seen.treeId) {
    out.push(`Focus node: none. The user is in tree ${seen.treeId}: ${mind.tree(seen.treeId).title}`);
  } else {
    out.push('Focus node: none.');
  }

  const picks = seen.picksOf ? mind.picks(seen.picksOf).slice(0, MAX_CHILDREN) : [];
  out.push(`Unkept picks, in order:\n${list(picks.map((n, i) => `${i + 1}. ${n.id}: ${title(n)}`))}`);
  out.push(`Selected nodes:\n${list(seen.selection.slice(0, MAX_CHILDREN).map(line))}`);
  out.push(`Trees:\n${list([...mind.trees.values()].slice(0, MAX_TREES).map((t) => `- ${t.id}: ${t.title}`))}`);

  const matches = mind
    .search(input.utterance, { limit: SHORTLIST * 2, placed: true })
    .flatMap((hit) => mind.nodesOfItem(hit.id))
    .sort((a, b) => Number(b.treeId === seen.treeId) - Number(a.treeId === seen.treeId))
    .slice(0, SHORTLIST);
  out.push(`Nodes matching words in the utterance:\n${list(matches.map((n) => `${line(n)} (tree ${n.treeId}: ${mind.tree(n.treeId).title})`))}`);

  out.push(`The user just said: "${clip(input.utterance, 600)}"`);
  return out.join('\n\n');
}

/** The tree whose title the utterance says, longest title first. */
function treeNamed(ctx: RoleContext, utterance: string): Id | undefined {
  const said = ` ${normalize(utterance)} `;
  return [...ctx.mind.trees.values()]
    .map((t) => ({ id: t.id, title: normalize(t.title) }))
    .filter((t) => t.title && said.includes(` ${t.title} `))
    .sort((a, b) => b.title.length - a.title.length)[0]?.id;
}

function toIntent(ctx: RoleContext, reply: Reply, utterance: string, seen: Seen, dropped: Id[]): Intent {
  const { mind } = ctx;
  const nodes = (ids: string[]) => [...new Set(ids)].filter((id) => mind.nodes.has(id));
  const trees = (ids: string[]) => [...new Set(ids)].filter((id) => mind.trees.has(id));
  const anchor = mind.nodes.has(reply.anchorId) ? reply.anchorId : seen.anchor;
  const none: Intent = { kind: 'reply' };

  switch (reply.kind) {
    case 'ask':
      return anchor ? { kind: 'ask', anchor, need: reply.need.trim() || utterance.trim() } : none;
    case 'more': {
      const need = reply.need.trim();
      return anchor ? { kind: 'more', anchor, ...(need ? { need } : {}) } : none;
    }
    case 'navigate': {
      if (mind.nodes.has(reply.nodeId)) return { kind: 'navigate', nodeId: reply.nodeId };
      const treeId = mind.trees.has(reply.treeId) ? reply.treeId : treeNamed(ctx, utterance);
      return treeId ? { kind: 'navigate', treeId } : none;
    }
    case 'organize': {
      const named: Scope = { treeIds: trees(reply.scopeTreeIds), nodeIds: nodes(reply.scopeNodeIds) };
      const scope = named.treeIds.length + named.nodeIds.length > 0 ? named : defaultScope(seen);
      return scope ? { kind: 'organize', request: reply.request.trim() || utterance.trim(), scope } : none;
    }
    case 'handoff': {
      const named: Scope = { treeIds: trees(reply.scopeTreeIds), nodeIds: nodes(reply.scopeNodeIds) };
      const everything: Scope = { treeIds: [], nodeIds: [] };
      // An empty scope from the model means either "everything" or "what I am pointing at". Only the words tell them apart.
      const all = /\b(everything|all)\b/i.test(utterance);
      const scope = named.treeIds.length + named.nodeIds.length > 0 ? named : all ? everything : (defaultScope(seen) ?? everything);
      return { kind: 'handoff', scope, note: reply.note.trim() };
    }
    case 'capture':
      return { kind: 'capture', text: reply.text.trim() || utterance.trim() };
    case 'tree':
      return treeOf(ctx, reply.text.trim(), seen, dropped) ?? none;
    case 'keep': {
      const wanted = new Set(reply.keepNodeIds);
      const ofFocus = (seen.picksOf ? mind.picks(seen.picksOf) : []).filter((n) => wanted.has(n.id)).map((n) => n.id);
      const nodeIds = ofFocus.length > 0 ? ofFocus : nodes(reply.keepNodeIds).filter((id) => mind.node(id).status === 'pick');
      return nodeIds.length > 0 ? { kind: 'keep', nodeIds } : none;
    }
    case 'undo':
      return { kind: 'undo' };
    case 'reply':
      return none;
  }
}

function sayFor(reply: Reply, intent: Intent, seen: Seen): string {
  if (intent.kind !== reply.kind) {
    if (reply.kind === 'navigate') return "I couldn't find that one. Which do you mean?";
    if (reply.kind === 'keep') return 'Which one should I keep?';
    if (reply.kind === 'tree') return SAY_TREE_ABOUT;
    return seen.anchor ? DEFAULT_SAY.reply : SAY_POINT;
  }
  const say = reply.say.trim();
  const words = say.split(/\s+/).filter(Boolean).length;
  const fits = words > 0 && words < MAX_SAY_WORDS && (intent.kind === 'reply' || !say.includes('?'));
  return fits ? say : DEFAULT_SAY[intent.kind];
}

const QUESTION = /^(who|what|when|where|why|how|which|whose|is|are|do|does|did|can|could|would|should|will)\b/i;

function withoutModel(utterance: string, seen: Seen): Conducted {
  const text = utterance.trim();
  const question = text.endsWith('?') || QUESTION.test(text);
  if (seen.anchor) return { intent: { kind: 'ask', anchor: seen.anchor, need: text }, say: DEFAULT_SAY.ask };
  return question ? point() : { intent: { kind: 'capture', text }, say: DEFAULT_SAY.capture };
}

export const conductor: Roles['conductor'] = async (ctx, { utterance, scene, history, dropped = [] }) => {
  if (!utterance.trim()) return { intent: { kind: 'reply' }, say: "I didn't catch that." };
  const seen = see(ctx, scene);

  const fast = matchFast(utterance);
  if (fast) return runFast(ctx, fast, seen);
  const tree = treeIntent(ctx, utterance, scene, dropped);
  if (tree) return tree;

  let reply: Reply;
  try {
    reply = await ctx.model.json({
      role: ROLE,
      system: SYSTEM,
      user: describe(ctx, { utterance, history }, seen),
      schema: Reply,
      effort: 'low',
    });
  } catch (err) {
    ctx.note(ROLE, `model failed (${err instanceof Error ? err.message : String(err)}); routed by plain rules`);
    return withoutModel(utterance, seen);
  }

  const intent = toIntent(ctx, reply, utterance, seen, dropped);
  return { intent, say: sayFor(reply, intent, seen) };
};
