import { z } from 'zod';
import type { Id } from '../domain.ts';
import type { Mindstorm } from '../state.ts';
import type { CardBrief, Roles, Turn } from './types.ts';

const ROLE = 'questions';
const MOST = 4;
const MAX_WORDS = 10;
const MAX_CHARS = 64;
const MAX_UNDER = 10;
const MAX_BESIDE = 6;

/** What a client shows when the service has nothing better. A suggestion that only says this again is no suggestion. */
const GENERIC = new Set(['tell me more', 'tell me more about this', 'tell me more about it', 'what else is like this', 'more like this', 'show me more', 'go deeper', 'go further', 'learn more']);

const Reply = z.object({ questions: z.array(z.string()) });

const SYSTEM = `You write the suggestions shown under a card the user has just opened in Mind Palace, a spatial brainstorming app. Pressing one asks the agent, which then brings content for the card: written ideas, steps, generated pictures, videos, or real material from the web, papers, books, museums and other sources.

Write 2 to 4 things the user is likely to want to ask next about this card.
- Each is under 8 words, in the user's own voice: a question ("How did Hitchcock use the dolly zoom?") or a short request ("Show me a dolly zoom on film").
- Each only makes sense for this card. Name a person, a work, a place, a part or an idea from it.
- Each goes a different way: deeper into one part, a comparison with something else, how to apply it to what the user seems to be doing, a picture or a video of it, who made or studied it.
- Follow the conversation. Build on what the user said last. Never repeat what was already asked, or what the cards under it already cover.
- Write in the language the user writes in. With no conversation, use the language of the card.
- Never write filler that fits any card, such as "Tell me more" or "What else is like this?".`;

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The card as the questions are written from it. The same brief in the same conversation gets the same questions. */
export function brief(mind: Mindstorm, nodeId: Id): CardBrief {
  const node = mind.node(nodeId);
  const item = mind.itemOf(nodeId);
  const name = (id: Id) => {
    const of = mind.itemOf(id);
    return oneLine(of.title || of.text, 60);
  };
  const summary = oneLine(item.summary, 300);
  const text = item.text.trim() === item.title.trim() || item.text.trim() === item.summary.trim() ? '' : oneLine(item.text, 400);
  const by = item.origin.by === 'user' ? 'the user' : `the ${item.origin.role ?? 'agent'}`;
  return {
    title: oneLine(item.title || item.text, 100),
    kind: item.kind,
    from: `${by}, ${item.origin.tool ?? item.source.from}`,
    why: oneLine(node.why, 160),
    summary,
    text,
    path: mind.path(nodeId).slice(0, -1).map((n) => name(n.id)),
    under: mind.children(nodeId).slice(0, MAX_UNDER).map((n) => name(n.id)),
    beside: node.parent ? mind.children(node.parent).filter((n) => n.id !== nodeId).slice(0, MAX_BESIDE).map((n) => name(n.id)) : [],
  };
}

function describe(card: CardBrief, history: Turn[]): string {
  const list = (titles: string[]) => titles.map((t) => `- ${t}`).join('\n');
  return [
    `The open card: "${card.title}" (${card.kind}, put here by ${card.from}).`,
    card.why && `Why it is here: ${card.why}`,
    card.summary && `What it is: ${card.summary}`,
    card.text && `Its text: ${card.text}`,
    card.path.length > 0 ? `Above it, from the root down: ${card.path.join(' > ')}` : 'It is the root of its tree.',
    card.under.length > 0 ? `Already under it:\n${list(card.under)}` : 'Nothing is under it yet.',
    card.beside.length > 0 && `Beside it:\n${list(card.beside)}`,
    history.length > 0 ? `The recent conversation:\n${history.map((t) => `${t.who}: ${oneLine(t.text, 200)}`).join('\n')}` : 'There is no conversation yet.',
  ]
    .filter(Boolean)
    .join('\n');
}

const normal = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The model's suggestions as a client can show them: short, distinct, never filler. */
export function cleaned(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw) {
    const text = line
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s*/, '')
      .replace(/^["“'‘](.*)["”'’]$/, '$1')
      .trim();
    const key = normal(text);
    if (!key || seen.has(key) || GENERIC.has(key)) continue;
    if (text.length > MAX_CHARS || text.split(' ').length > MAX_WORDS) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, MOST);
}

export const questions: Roles['questions'] = async (ctx, { card, history }) => {
  const reply = await ctx.model.json({ role: ROLE, system: SYSTEM, user: describe(card, history), schema: Reply, quick: true });
  return cleaned(reply.questions);
};
