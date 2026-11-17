import { z } from 'zod';
import type { Item, Node } from '../core/domain.ts';
import { MOMO } from '../core/momo.ts';
import type { ModelClient } from '../core/ports.ts';
import { tokenize } from '../core/search.ts';
import type { Mindstorm } from '../core/state.ts';
import { treeLines } from './tree-asks.ts';

const ROLE = 'momo.chat';
/** The most of one message Momo reads, as the most a headset's user may say at once (`WORDS_CHARS`). */
const MAX_MESSAGE = 4000;
const TREES_TOLD = 12;
const CARDS_TOLD = 6;
const NAMED_TREES = 3;
const NAMED_CARDS = 10;

/** One thing said in the chat, kept so a follow-up is read with what came before. */
export interface Said {
  who: 'user' | 'momo';
  text: string;
}

/** Something this message brought that is already kept: a link, a photo, a file. */
export interface KeptThing {
  title: string;
  says: string;
}

export interface Heard {
  text: string;
  /** The last few things said, oldest first. */
  said: readonly Said[];
  /** The earlier message Momo asked about keeping, when this message may be the answer. */
  waiting?: string;
  /** What came with this message and is kept whatever Momo decides. The words are then only answered. */
  kept?: readonly KeptThing[];
}

/**
 * What Momo does with one message.
 * - `answer`: only talks. Nothing is kept.
 * - `save`: keeps the message, with a word of Momo's own.
 * - `both`: answers, and the question is kept with its answer.
 * - `ask`: cannot tell whether to keep it, so asks. The next message settles it.
 * - `tree`: starts a new tree about `words`.
 * - `list`, `find`, `handoff`, `latest`: what the message asks of the trees the person has (`tree-asks.ts`).
 */
export const Reading = z.object({
  does: z.enum(['answer', 'save', 'both', 'ask', 'tree', 'list', 'find', 'handoff', 'latest']),
  /** What Momo says. It never says that something was kept: the service says what was kept and where. */
  reply: z.string(),
  /** What a tree is to be about, or what names the tree asked for. */
  words: z.string(),
  /** True when this message answers Momo's question about the earlier one, so that one is what is kept or let go. */
  earlier: z.boolean(),
});
export type Reading = z.infer<typeof Reading>;

function system(name: string, today: string): string {
  return `# Role and objective
You are ${name}, the voice of Mind Palace, a space in VR where the user's ideas hang as cards in trees. You are ${MOMO.friend}. Today is ${today}.
Here the user writes to you in a Telegram chat, away from the headset. What they send can go into their mind palace, and you decide what each message is for.

# Personality and tone
${MOMO.warm}
${MOMO.person}
- Short, as a chat message is: one to three sentences. Go longer only when asked to explain. Plain text, with no markdown and no emoji.
${MOMO.varied}
${MOMO.followUp}
- Asked who or what you are, say you're ${name}, in a line of your own, and what they can do here: tell you things to keep, ask you things, ask about their trees.

# Language
Write in the language the user wrote. Card and tree names stay as written.

# What the message is for: choose one, as "does"
- "answer": they are talking to you. A greeting, thanks, small talk, a question about you or about Mind Palace, a question about what they have saved, an opinion they ask for. "reply" is your answer. Nothing is kept.
- "save": they are telling you something to keep: a thought, a fact, an idea, a plan, a quote, something they noticed. "reply" is a few words of your own about it, as a friend who is interested would say. Do not say it is saved or kept: Mind Palace adds a line that says what was kept and where.
- "both": a real question about the world that is worth keeping with its answer: how something works, why something happens, what something is. "reply" is your answer. Do not say it is saved: Mind Palace adds that line.
- "ask": you cannot tell whether they want it kept. "reply" is one short question, such as "Want me to keep that, or were you just telling me?". Only when you are really unsure, and never when "Waiting on" is given below.
- "tree": they ask you to start, make or grow a new tree. "words" is what it is about. "reply" is one short, lively line.
- "list": they want to see their trees. "find": they want to know which tree of theirs is about something, and "words" is that something. "handoff": they want the handoff file of one tree, to export it or give it to another agent, and "words" is what names the tree. "latest": they want the last handoff sent again. For these four "reply" is empty.

# Rules
- ${MOMO.knows}
- A question about what they have saved is answered only from "Their trees" and "From their mind palace" below. Call a card saved only when it says saved. If nothing there answers it, say so. Never invent a card or a tree.
- You cannot look at the web from here. For news, prices, weather or anything that changes, say so and tell what you do know.
- When "Waiting on" is given, you asked whether to keep that earlier message. If this message answers that question, set "earlier" to true: "save" when they want it kept, "answer" with a short friendly line when they do not. If this message is about something else, read it for itself and leave "earlier" false.
- When "Already kept" is given, what came with this message is kept whatever you choose. Choose "answer": if their words ask something, answer it from what "Already kept" says and what you know; otherwise say a few words of your own about it. Say only what "Already kept" says about a link, picture or file.
- "words" is empty unless a line above says what it holds. It never holds "tree", "handoff" or the words that asked. "earlier" is false unless the rule above sets it.`;
}

/** What Momo is told with a message: the trees, the cards the message's words find, and the cards of any tree it names. */
export function chatContext(mind: Mindstorm, text: string): string {
  const trees = treeLines(mind);
  if (trees.length === 0) return '[Their trees]\nNone yet.';
  const parts = [`[Their trees, newest first]\n${trees.slice(0, TREES_TOLD).map((tree) => `- ${tree.title}: ${tree.line}`).join('\n')}${trees.length > TREES_TOLD ? `\nAnd ${trees.length - TREES_TOLD} more.` : ''}`];

  const asked = new Set(tokenize(text).filter((term) => term !== 'tree'));
  const named = trees.filter((tree) => tokenize(tree.title).some((term) => asked.has(term))).slice(0, NAMED_TREES);
  for (const tree of named) {
    const cards = mind.treeNodes(tree.id).slice(0, NAMED_CARDS).map((node) => `- ${told(mind, mind.item(node.itemId), node)}`);
    parts.push(`[In the tree "${tree.title}"]\n${cards.join('\n')}`);
  }
  const hits = mind
    .search(text, { limit: CARDS_TOLD })
    .filter((hit) => hit.coverage >= 0.5)
    .map((hit) => `- ${told(mind, hit.item, mind.nodesOfItem(hit.id)[0])}`);
  if (hits.length > 0) parts.push(`[From their mind palace, matching this message]\n${hits.join('\n')}`);
  return parts.join('\n\n');
}

function told(mind: Mindstorm, item: Item, node: Node | undefined): string {
  const saved = !node || node.status === 'kept' || mind.known(item.id);
  const where = node ? `in "${mind.tree(node.treeId).title}"` : 'in no tree';
  const says = clip((item.summary || item.text).replace(/\s+/g, ' ').trim(), 240);
  return `"${clip(item.title, 80) || 'Untitled'}" (${saved ? 'saved' : 'a suggestion, not saved'}, ${where})${says ? `: ${says}` : ''}`;
}

/** Momo's reading of one chat message. Rejects when the model does not answer. */
export function readMessage(model: ModelClient, about: { name: string; today: string; context: string }, heard: Heard): Promise<Reading> {
  const parts = [about.context];
  if (heard.said.length > 0) parts.push(`[The chat so far]\n${heard.said.map((s) => `${s.who === 'user' ? 'User' : about.name}: ${clip(s.text, 500)}`).join('\n')}`);
  if (heard.waiting) parts.push(`[Waiting on]\nYou asked whether to keep this earlier message: """${clip(heard.waiting, 1000)}"""`);
  if (heard.kept?.length) parts.push(`[Already kept]\n${heard.kept.map((k) => `- "${clip(k.title, 80)}"${k.says ? `: ${clip(k.says, 600)}` : ''}`).join('\n')}`);
  parts.push(`Message: """\n${heard.text.trim().slice(0, MAX_MESSAGE)}\n"""`);
  return model.json({ role: ROLE, system: system(about.name, about.today), user: parts.join('\n\n'), schema: Reading, quick: true });
}

function clip(text: string, most: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > most ? `${flat.slice(0, most - 1).replace(/\s+\S*$/, '')}…` : flat;
}
