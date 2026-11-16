import { z } from 'zod';
import type { Id } from '../core/domain.ts';
import type { ModelClient } from '../core/ports.ts';
import { tokenize } from '../core/search.ts';
import type { Mindstorm } from '../core/state.ts';
import { treeRequest } from '../core/tree-request.ts';

/** What a chat message asks of the trees the person has. Anything else they send is a drop. */
export type Ask =
  | { kind: 'list' }
  /** The handoff made last, sent again. */
  | { kind: 'latest' }
  /** A new handoff of the tree these words mean. */
  | { kind: 'handoff'; words: string }
  | { kind: 'find'; words: string };

/** A tree as a chat lists it. */
export interface TreeLine {
  id: Id;
  title: string;
  /** How many cards it holds and what it is about, in a few words. */
  line: string;
}

const ASK_ROLE = 'contact.ask';
const MATCH_ROLE = 'contact.match';
/** The most trees the model is shown to match words against, the newest first. */
const MAX_SHOWN = 40;
const CARDS_SHOWN = 8;
/** The most trees a question of "which one?" offers. */
export const MAX_OFFERED = 5;

const POLITE = String.raw`(?:(?:please|pls|ok|okay|hey|hi|now)[,\s]+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?`;
const TAIL = String.raw`(?:,?\s*(?:please|pls|thanks|thank you))?\s*[.!?]*`;
const LATEST = new RegExp(String.raw`^(?:\/handoff(?:@\w+)?|${POLITE}(?:re)?send\s+me\s+the\s+(?:latest\s+|last\s+)?hand-?\s?off(?:\s+again)?${TAIL})$`, 'i');
const LIST = new RegExp(
  String.raw`^(?:\/(?:trees|list)(?:@\w+)?|${POLITE}(?:(?:list|show|name)(?:\s+me)?\s+(?:all\s+)?(?:of\s+)?(?:my|the)?\s*trees|(?:what|which)\s+trees\s+(?:do\s+i\s+have|have\s+i\s+got|are\s+there)|what\s+are\s+my\s+trees|my\s+trees)${TAIL})$`,
  'i',
);
const HANDOFF: RegExp[] = [
  /^\/handoff(?:@\w+)?\s+(.+)$/i,
  new RegExp(String.raw`^${POLITE}(?:(?:re)?send|give|get|make)\s+(?:me\s+)?(?:the|a)\s+hand-?\s?off\s+(?:for|of|on|about|to)\s+(.+?)${TAIL}$`, 'i'),
  new RegExp(String.raw`^${POLITE}hand(?:\s+|-)?off\s+(?:for\s+|of\s+)?(.+?)${TAIL}$`, 'i'),
  new RegExp(String.raw`^${POLITE}hand\s+over\s+(.+?)${TAIL}$`, 'i'),
];
const FIND: RegExp[] = [
  /^\/find(?:@\w+)?\s+(.+)$/i,
  new RegExp(String.raw`^${POLITE}(?:find|search\s+for|look\s+for|look\s+up)\s+(?:me\s+)?(?:the|my|a|any)?\s*trees?\s+(?:about|on|for|named|called|with|that\s+(?:has|have|mentions?|covers?))\s+(.+?)${TAIL}$`, 'i'),
  new RegExp(String.raw`^${POLITE}(?:which|what)\s+trees?\s+(?:is|are|has|have|covers?|mentions?)\s+(?:about\s+)?(.+?)${TAIL}$`, 'i'),
  new RegExp(String.raw`^${POLITE}do\s+i\s+have\s+(?:a|any)\s+trees?\s+(?:about|on|for|with)\s+(.+?)${TAIL}$`, 'i'),
];
/** A message with none of these words asks nothing of the trees, so it is a drop and the model is never asked. */
const CUE = /\b(?:trees?|hand(?:ing|ed)?[\s-]?offs?|hand\s+\w+\s+over|export|package)\b/i;
const MAX_ASK_CHARS = 200;

/** What a message asks by plain rules, at no model call, or null when the rules do not say. */
export function plainAsk(text: string): Ask | null {
  const clean = text.trim();
  if (LATEST.test(clean)) return { kind: 'latest' };
  if (LIST.test(clean)) return { kind: 'list' };
  for (const [kind, rules] of [['handoff', HANDOFF], ['find', FIND]] as const) {
    for (const rule of rules) {
      const words = named(rule.exec(clean)?.[1] ?? '');
      if (words) return { kind, words };
    }
  }
  return null;
}

/** Whether a message the rules did not read could still ask something of the trees, so the model is worth asking. */
export function mayAsk(text: string): boolean {
  const clean = text.trim();
  return clean.length <= MAX_ASK_CHARS && !clean.includes('\n') && !/https?:\/\//i.test(clean) && CUE.test(clean) && !treeRequest(clean);
}

const AskReply = z.object({ kind: z.enum(['list', 'latest', 'handoff', 'find', 'none']), words: z.string() });

const ASK_SYSTEM = `A person sent one message to the chat bot of Mind Palace, a brainstorming app where their material lives in trees of cards. Most messages are things to save. A few ask about the trees they already have. Decide which this one is.

Return "kind" and "words".
- "list": they want to see their trees.
- "handoff": they want the handoff file of one tree they have: to hand it off, export it, package it or send it to another agent. "words" is what names the tree, in their words.
- "find": they want to know which tree they have is about something. "words" is that something.
- "latest": they want the last handoff sent again and name no tree.
- "none": anything else: a thought, a note, a link, a question about the world, or a request to grow a new tree.

"words" never holds "tree", "handoff" or the words that asked. It is empty for "list", "latest" and "none". When unsure, answer "none".`;

/** What a message asks, read by the model. Null when it asks nothing of the trees. Rejects when the model does not answer. */
export async function modelAsk(model: ModelClient, text: string): Promise<Ask | null> {
  const reply = await model.json({ role: ASK_ROLE, system: ASK_SYSTEM, user: `Message: """\n${text.trim()}\n"""`, schema: AskReply, quick: true });
  if (reply.kind === 'list' || reply.kind === 'latest') return { kind: reply.kind };
  const words = named(reply.words);
  return reply.kind === 'none' || !words ? null : { kind: reply.kind, words };
}

/** The trees, the newest first. */
export function treeLines(mind: Mindstorm): TreeLine[] {
  return [...mind.trees.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((tree) => {
      const cards = mind.treeNodes(tree.id).length;
      const root = mind.item(mind.node(tree.rootId).itemId);
      const about = clip(tree.digest || root.summary || root.text, 110);
      return { id: tree.id, title: tree.title.trim() || 'Untitled', line: `${cards} ${cards === 1 ? 'card' : 'cards'}${about ? `. ${about}` : ''}` };
    });
}

const MatchReply = z.object({ matches: z.array(z.number().int()) });

const MATCH_SYSTEM = `You match a person's words to the trees they have in Mind Palace, a brainstorming app. Each tree is listed with a number, its name, what it is about and some of its cards.

Return "matches": the numbers of the trees the words mean, best first. Judge by the name first, then by what is in the tree. Give one number when one tree is clearly meant, several only when the words fit several about equally, and none when no tree fits. Use only the numbers listed.`;

/**
 * The trees a few words mean, best first. A name the words give in full, or the one name that holds every word, is matched with
 * no model call; several such names are all returned, for the person to choose. Otherwise the model matches the words against each
 * tree's name and what is in it, and when it does not answer, the trees whose cards hold the words are returned.
 */
export async function matchTrees(mind: Mindstorm, model: ModelClient, words: string): Promise<TreeLine[]> {
  const trees = treeLines(mind);
  const asked = tokenize(named(words));
  if (trees.length === 0 || asked.length === 0) return [];
  const names = trees.map((tree) => ({ tree, terms: tokenize(tree.title) }));
  const exact = names.filter((n) => n.terms.join(' ') === asked.join(' '));
  if (exact.length > 0) return exact.map((n) => n.tree);
  const holding = names.filter((n) => asked.every((term) => n.terms.includes(term)));
  if (holding.length > 0) return holding.map((n) => n.tree);

  const byCards = byContents(mind, trees, words);
  const shown = [...new Set([...byCards, ...trees])].slice(0, MAX_SHOWN);
  try {
    const reply = await model.json({ role: MATCH_ROLE, system: MATCH_SYSTEM, user: `Words: "${named(words)}"\n\nTrees:\n${shown.map((tree, i) => describe(mind, tree, i + 1)).join('\n')}`, schema: MatchReply, quick: true });
    return [...new Set(reply.matches)].flatMap((n) => shown[n - 1] ?? []);
  } catch {
    return byCards.slice(0, MAX_OFFERED);
  }
}

/** The trees whose cards hold at least half the words, the tree holding the most first. */
function byContents(mind: Mindstorm, trees: TreeLine[], words: string): TreeLine[] {
  const score = new Map<Id, number>();
  for (const hit of mind.search(words, { limit: 40, placed: true })) {
    if (hit.coverage < 0.5) continue;
    for (const treeId of new Set(mind.nodesOfItem(hit.id).map((node) => node.treeId))) score.set(treeId, (score.get(treeId) ?? 0) + hit.score);
  }
  return trees.filter((tree) => score.has(tree.id)).sort((a, b) => score.get(b.id)! - score.get(a.id)!);
}

function describe(mind: Mindstorm, tree: TreeLine, n: number): string {
  const cards = mind
    .treeNodes(tree.id)
    .slice(0, CARDS_SHOWN)
    .map((node) => clip(mind.item(node.itemId).title, 60))
    .filter(Boolean);
  return `${n}. ${tree.title} (${tree.line})${cards.length ? ` Cards: ${cards.join('; ')}` : ''}`;
}

/** The words that name a tree, without the quotes, the article and the word "tree" round them. */
function named(words: string): string {
  return words
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’.!?]+$/g, '')
    .replace(/^(?:the|my|our|that|this)\s+/i, '')
    .replace(/^trees?\s+(?:about|on|for|named|called)\s+/i, '')
    .replace(/^(?:one|ones)\s+(?:about|on|for|named|called)\s+/i, '')
    .replace(/\s+trees?$/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

function clip(text: string, most: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > most ? `${flat.slice(0, most - 1).replace(/\s+\S*$/, '')}…` : flat;
}
