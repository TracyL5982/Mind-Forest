import { spokenKind } from './announce.ts';
import { briefly } from './brief.ts';
import { inLibrary, type ChangeSet, type Id, type Item, type Node } from './domain.ts';
import type { Pipeline } from './pipeline.ts';
import { defaultScope, runFast, see, treeNamed, treeOf, type Fast, type Seen } from './roles/conductor.ts';
import type { Intent, RoleContext, Scene } from './roles/types.ts';
import type { Mindstorm } from './state.ts';

/**
 * Momo's tools in a live conversation: each a function the realtime model may call, run on the service and answered at once. Those
 * that act call the pipeline as the Conductor's intents do (`Pipeline.perform`); work that goes on (a Scout run, an organize, a
 * handoff) is started and told later. Why it is built this way is in agents/DECISIONS.md (58).
 */

/** What a call is answered with: told to the model as JSON. */
export type ToolOutput = Record<string, unknown>;

export interface ToolDeps {
  pipeline: Pipeline;
  scene: Scene;
  /** A spoken answer from the web for anything current, with no links in it. */
  webAnswer?: (question: string) => Promise<string>;
}

interface Tool {
  description: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
  /** A few words for the orb while the call runs, when it takes long enough to show. */
  label?: (args: Args) => string;
  run: (args: Args, deps: ToolDeps) => Promise<ToolOutput> | ToolOutput;
}

type Args = Record<string, unknown>;

const text = (args: Args, key: string): string => (typeof args[key] === 'string' ? (args[key] as string).trim() : '');
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });

const clip = (s: string, most: number) => (s.length > most ? `${s.slice(0, most).replace(/\s+\S*$/, '')}…` : s);
const LOOKUP_HITS = 5;

/** A card's name for the model: its title, or the start of its text. */
export function nameOf(item: Item): string {
  return briefly(item.title || item.summary || item.text || 'an untitled card', 12);
}

/** Where something the user has is: the tree and card it hangs under, the library, or loose in the knowledge base. */
function whereIs(ctx: RoleContext, item: Item, node: Node | undefined): string {
  const { mind } = ctx;
  if (node) {
    const tree = mind.tree(node.treeId).title;
    if (!node.parent) return `the root of the tree "${tree}"`;
    return `in the tree "${tree}", under "${nameOf(mind.itemOf(node.parent))}"${node.status === 'pick' ? ', a suggestion not yet kept' : ''}`;
  }
  return inLibrary(item) ? "in the headset's library" : 'saved, in no tree';
}

function performed(deps: ToolDeps, intent: Intent): void {
  deps.pipeline.carryOut(intent, deps.scene);
}

/** The card a few words name: an id from an earlier lookup, or the best match among the cards in trees, the open tree's first. */
function cardNamed(ctx: RoleContext, words: string, seen: Seen): Node | undefined {
  const { mind } = ctx;
  const byId = mind.nodes.get(words);
  if (byId) return byId;
  return mind
    .search(words, { limit: 12, placed: true })
    .filter((hit) => hit.coverage >= 0.5)
    .flatMap((hit) => mind.nodesOfItem(hit.id))
    .sort((a, b) => Number(b.treeId === seen.treeId) - Number(a.treeId === seen.treeId))[0];
}

/** An intent the Conductor's plain rules make, told as what came of it, or as why nothing could be done. */
function plain(deps: ToolDeps, fast: Fast): ToolOutput {
  const ctx = deps.pipeline.ctx;
  const { intent, say } = runFast(ctx, fast, see(ctx, deps.scene));
  if (intent.kind === 'reply') return { done: false, why: say };
  if (intent.kind === 'keep') {
    const titles = intent.nodeIds.map((id) => nameOf(ctx.mind.itemOf(id)));
    performed(deps, intent);
    return { done: true, kept: titles };
  }
  if (intent.kind === 'navigate' && intent.nodeId) {
    const title = nameOf(ctx.mind.itemOf(intent.nodeId));
    const top = ctx.mind.node(intent.nodeId).parent === null;
    performed(deps, intent);
    return { done: true, opened: title, ...(fast.kind === 'up' ? { moved: top ? 'up one level, to the tree\'s first card' : 'up one level' } : {}) };
  }
  performed(deps, intent);
  return { done: true };
}

/** What a new run will be about, for the model to say in its own words. Cards that land are told in notes as they do. */
const STARTED = 'Started. Cards will land over the next seconds and you will get a note as each does. Describe none until then.';

export const TOOLS: Record<string, Tool> = {
  web_answer: {
    description:
      'Look up what changes or is new on the web: news, this year\'s events and winners, what is on now, prices, opening hours, weather, schedules. ' +
      'Never for settled facts you know, such as who painted what or what something is. Takes about 3 seconds, so say a few natural words first. ' +
      'Answers with a short spoken answer to tell in your own words.',
    parameters: object({ question: str('The question in a few words, as the user asked it, with a place or date only when it needs one.') }, ['question']),
    label: (args) => `Searching the web for ${briefly(text(args, 'question'), 5)}`,
    run: async (args, deps) => {
      if (!deps.webAnswer) return { error: 'The web is not reachable now. Say so, and answer from what you know if you can, saying you are not sure.' };
      return { answer: await deps.webAnswer(text(args, 'question')) };
    },
  },

  look_up_mindstorm: {
    description:
      "Search what the user has saved: their cards, trees, notes and the headset's library. Use it for \"what did I save about…\", \"do I have anything on…\", " +
      '"what did that card say", or a question their cards may answer. Answers at once with the best matches.',
    parameters: object({ query: str('A few keywords to search for.') }, ['query']),
    run: (args, deps) => {
      const ctx = deps.pipeline.ctx;
      const { mind } = ctx;
      const query = text(args, 'query');
      const told = (item: Item, node: Node | undefined) => ({
        ...(node ? { card: node.id } : {}),
        title: item.title || nameOf(item),
        kind: item.kind,
        // A suggestion the Scout brought and the user has not kept is not something they saved.
        saved: !node || node.status === 'kept' || mind.known(item.id),
        where: whereIs(ctx, item, node),
        says: clip((item.summary || item.text).replace(/\s+/g, ' ').trim(), 280),
      });
      const note = 'Tell the user only what these say. Say "saved" only of those with saved true; the others are suggestions not yet kept. Name no other card. `card` is an id for go_to.';
      // "What's in my generative UI tree": the tree itself, its first card and what hangs from it, not whatever else shares its words.
      const tree = treeNamed(ctx, query);
      if (tree) {
        const nodes = mind.treeNodes(tree).slice(0, LOOKUP_HITS * 3);
        return { tree: mind.tree(tree).title, cards: nodes.map((n) => told(mind.itemOf(n.id), n)), note };
      }
      const hits = mind
        .search(query, { limit: LOOKUP_HITS * 3 })
        .filter((hit) => mind.known(hit.id) || mind.nodesOfItem(hit.id).length > 0)
        .slice(0, LOOKUP_HITS);
      if (hits.length === 0) return { found: [], note: 'Nothing the user saved matches. Say so plainly, and name no card.' };
      return { found: hits.map(({ item }) => told(item, mind.nodesOfItem(item.id)[0])), note };
    },
  },

  find_new: {
    description:
      'Bring new cards on a topic into the user\'s mindstorm: things to look at, examples, references, pictures, films. Use it when the user asks to find, show or ' +
      'explore something, or wants material rather than an answer. It works on the card the user has open. For a plain question, answer instead.',
    parameters: object(
      { subject: str('What to find, as a short self-contained phrase.'), angle: str('Optional: a narrower angle, such as "only paintings" or "less famous ones". Empty for none.') },
      ['subject', 'angle'],
    ),
    run: (args, deps) => {
      const ctx = deps.pipeline.ctx;
      const seen = see(ctx, deps.scene);
      const subject = text(args, 'subject');
      const angle = text(args, 'angle');
      const need = angle ? `${subject}, ${angle}` : subject;
      const named = treeNamed(ctx, subject);
      const anchor = seen.anchor ?? (named ? ctx.mind.tree(named).rootId : undefined);
      if (!anchor) {
        if (!subject) return { started: false, why: 'Nothing is open and no subject was given. Ask what to look for.' };
        performed(deps, { kind: 'tree', subject, itemIds: [] });
        return { started: true, newTree: subject, note: STARTED };
      }
      performed(deps, { kind: 'ask', anchor, need: need || nameOf(ctx.mind.itemOf(anchor)) });
      return { started: true, on: nameOf(ctx.mind.itemOf(anchor)), note: STARTED };
    },
  },

  start_tree: {
    description: 'Start a new tree, about a subject ("start a tree on Hitchcock") or grown from the card the user has open ("make a tree from this", subject empty).',
    parameters: object({ subject: str('What the tree is about, in the user\'s words. Empty for the card they have open.') }, ['subject']),
    run: (args, deps) => {
      const ctx = deps.pipeline.ctx;
      const intent = treeOf(ctx, text(args, 'subject'), see(ctx, deps.scene), []);
      if (!intent) return { started: false, why: 'Nothing is open to grow a tree from. Ask what the tree should be about.' };
      performed(deps, intent);
      const from = intent.kind === 'tree' && intent.itemIds[0] ? ctx.mind.items.get(intent.itemIds[0]) : undefined;
      return { started: true, tree: from ? nameOf(from) : text(args, 'subject'), note: STARTED };
    },
  },

  more_like_this: {
    description: 'More cards like the ones around the open card ("more", "more like this", "keep going"), optionally narrowed ("more, but older films").',
    parameters: object({ narrower: str('How to narrow it, or empty.') }, ['narrower']),
    run: (args, deps) => {
      const ctx = deps.pipeline.ctx;
      const seen = see(ctx, deps.scene);
      if (!seen.anchor) return { started: false, why: 'Nothing is open. Ask the user to look at a card.' };
      const narrower = text(args, 'narrower');
      performed(deps, { kind: 'more', anchor: seen.anchor, ...(narrower ? { need: narrower } : {}) });
      return { started: true, on: nameOf(ctx.mind.itemOf(seen.anchor)), note: STARTED };
    },
  },

  keep: {
    description: 'Keep suggestions (dashed cards) so they stay: "keep that", "keep them all", "keep the first two".',
    parameters: object({ which: { type: 'string', description: '"this" for the one open or selected, "all", or a number for the first that many.' } }, ['which']),
    run: (args, deps) => {
      const which = text(args, 'which').toLowerCase();
      const n = Number(which);
      return plain(deps, { kind: 'keep', which: which === 'all' ? 'all' : Number.isInteger(n) && n > 0 ? n : 'that' });
    },
  },

  undo: {
    description: 'Take back the last change ("undo", "put it back").',
    parameters: object({}),
    run: (_args, deps) => {
      const what = deps.pipeline.undoLabel();
      if (!what) return { done: false, why: 'There is nothing to undo.' };
      performed(deps, { kind: 'undo' });
      return { done: true, undid: what };
    },
  },

  go_to: {
    description:
      'Open a card or tree so the user sees it: "go up", "back to the top", "open the one about Jaws", "go to my lenses tree". It only opens; it never finds or starts anything.',
    parameters: object({ to: str('"up", "top", or words naming the card or tree, or a card id from look_up_mindstorm.') }, ['to']),
    run: (args, deps) => {
      const ctx = deps.pipeline.ctx;
      const to = text(args, 'to');
      if (/^(up|parent|back)$/i.test(to)) return plain(deps, { kind: 'up' });
      if (/^(top|root|start|beginning)$/i.test(to)) return plain(deps, { kind: 'start' });
      const seen = see(ctx, deps.scene);
      const tree = treeNamed(ctx, to);
      // "My lenses tree" names a tree; words that hold a tree's title among others name a card in it.
      const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\b(my|the|tree|one)\b/g, ' ').replace(/\s+/g, ' ').trim();
      const node = tree && bare(to) === bare(ctx.mind.tree(tree).title) ? undefined : cardNamed(ctx, to, seen);
      if (!node && tree) {
        performed(deps, { kind: 'navigate', treeId: tree });
        return { done: true, opened: `the tree "${ctx.mind.tree(tree).title}"` };
      }
      if (!node) return { done: false, why: `No card matches "${to}". Ask which one.` };
      performed(deps, { kind: 'navigate', nodeId: node.id });
      return { done: true, opened: nameOf(ctx.mind.itemOf(node.id)) };
    },
  },

  organize: {
    description: 'Change how cards are arranged: move, group, rename, merge, split, delete, tidy, or add a note. Works on the open card or tree.',
    parameters: object({ request: str('The instruction, complete in itself.') }, ['request']),
    run: (args, deps) => {
      const ctx = deps.pipeline.ctx;
      const scope = defaultScope(see(ctx, deps.scene));
      if (!scope) return { started: false, why: 'Nothing is open. Ask the user to look at the cards to organize.' };
      performed(deps, { kind: 'organize', request: text(args, 'request'), scope });
      return { started: true, note: 'You will get a note saying what was done.' };
    },
  },

  hand_off: {
    description: 'Package cards for another agent or app as one file: "hand this off", "export everything".',
    parameters: object({ everything: { type: 'boolean', description: 'True for the whole mindstorm, false for the open card or tree.' }, note: str('What the next agent should do, or empty.') }, ['everything', 'note']),
    run: (args, deps) => {
      const ctx = deps.pipeline.ctx;
      const scope = args.everything === true ? null : defaultScope(see(ctx, deps.scene));
      performed(deps, { kind: 'handoff', scope: scope ?? { treeIds: [], nodeIds: [] }, note: text(args, 'note') });
      return { started: true, note: 'You will get a note when the file is ready.' };
    },
  },

  save_note: {
    description: 'Save a thought the user dictates ("note that…", "remember…") into their knowledge base.',
    parameters: object({ text: str('The thought, without the words that asked to save it.') }, ['text']),
    run: (args, deps) => {
      const thought = text(args, 'text');
      if (!thought) return { done: false, why: 'Nothing to save. Ask what to note.' };
      performed(deps, { kind: 'capture', text: thought });
      return { done: true };
    },
  },
};

/** The tools as the realtime session declares them. */
export function toolSpecs(): { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }[] {
  return Object.entries(TOOLS).map(([name, tool]) => ({ type: 'function', name, description: tool.description, parameters: tool.parameters }));
}

/** Runs one call. An unknown tool or bad arguments are answered as such, so the model can say something. */
export async function runTool(name: string, rawArgs: string, deps: ToolDeps): Promise<ToolOutput> {
  const tool = TOOLS[name];
  if (!tool) return { error: `There is no tool called ${name}.` };
  let args: Args;
  try {
    const parsed: unknown = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Args) : {};
  } catch {
    return { error: 'The arguments were not JSON. Try again.' };
  }
  return tool.run(args, deps);
}

/** What the orb shows while a call runs, if anything. */
export function toolLabel(name: string, rawArgs: string): string | undefined {
  const tool = TOOLS[name];
  if (!tool?.label) return undefined;
  try {
    return tool.label(JSON.parse(rawArgs || '{}') as Args);
  } catch {
    return undefined;
  }
}

/** Where the user is, told to Momo when it changes: the open card, its tree and the suggestions round it. */
export function whereNote(ctx: RoleContext, scene: Scene): string {
  const { mind } = ctx;
  const seen = see(ctx, scene);
  if (!seen.focus) {
    if (seen.treeId) return `The user is in the tree "${mind.tree(seen.treeId).title}" with no card open.`;
    return 'The user has no tree or card open.';
  }
  const item = mind.itemOf(seen.focus.id);
  const lines = [`The user has open the card "${nameOf(item)}" (${spokenKind(item, seen.focus.origin.tool ?? '')}) in the tree "${mind.tree(seen.focus.treeId).title}".`];
  const says = clip((item.summary || item.text).replace(/\s+/g, ' ').trim(), 240);
  if (says && says !== item.title) lines.push(`It says: ${says}`);
  const picks = seen.picksOf ? mind.picks(seen.picksOf).slice(0, 6) : [];
  if (picks.length > 0) lines.push(`Suggestions round it, not yet kept: ${picks.map((n, i) => `${i + 1}. ${nameOf(mind.itemOf(n.id))}`).join('; ')}.`);
  const kept = mind.children(seen.focus.id).filter((n) => n.status === 'kept').slice(0, 6);
  if (kept.length > 0) lines.push(`Kept under it: ${kept.map((n) => nameOf(mind.itemOf(n.id))).join('; ')}.`);
  return lines.join('\n');
}

/** A card that landed, as Momo is told of it: only what the card states. */
export interface CardNote {
  /** The card it landed under. */
  anchor: Id;
  under: string;
  kind: string;
  title: string;
  by?: string;
  date?: string;
  from?: string;
  why?: string;
  says?: string;
}

/** The Scout's new cards in a change, each under the card it was found for. */
export function landedCards(mind: Mindstorm, set: ChangeSet): CardNote[] {
  if (set.origin.role !== 'scout') return [];
  return set.patches.flatMap((p) => {
    if (p.entity !== 'node' || p.before !== null || p.after === null) return [];
    const node = mind.nodes.get(p.id);
    if (!node?.parent || node.status !== 'pick') return [];
    const item = mind.itemOf(node.id);
    const data = item.data as Record<string, unknown>;
    const word = (key: string) => (typeof data[key] === 'string' && (data[key] as string).trim() ? clip((data[key] as string).trim(), 80) : undefined);
    const says = clip((item.summary || '').replace(/\s+/g, ' ').trim(), 200);
    return [{
      anchor: node.parent,
      under: nameOf(mind.itemOf(node.parent)),
      kind: spokenKind(item, node.origin.tool ?? ''),
      title: item.title || nameOf(item),
      ...(word('by') ? { by: word('by') } : {}),
      ...(word('date') ? { date: word('date') } : {}),
      ...(word('from') ? { from: word('from') } : node.origin.tool === 'library' ? { from: "the user's library" } : node.origin.tool === 'mindstorm' ? { from: "the user's own cards" } : {}),
      ...(node.why.trim() ? { why: clip(node.why.trim(), 200) } : {}),
      ...(says && says !== item.title ? { says } : {}),
    }];
  });
}
