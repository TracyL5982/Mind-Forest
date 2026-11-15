import type { Id, Item } from './domain.ts';
import type { Mindstorm } from './state.ts';

/** About six seconds of speech. */
const MOST_WORDS = 20;
const NAME_WORDS = 6;
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const SPACELESS = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]/u;
/** Words a cut title must not end on. */
const DANGLING = new Set(['a', 'an', 'the', 'of', 'for', 'about', 'and', 'or', 'to', 'in', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'vs']);

/** A pick named aloud by the source it came from, when that says what it is. A film's poster or a book's cover is still a film or a book. */
const FROM: Record<string, string> = {
  films: 'a film',
  books: 'a book',
  papers: 'a paper',
  podcasts: 'a podcast',
  museums: 'an artwork',
};

/** A text pick named aloud by where it came from. */
const TEXT_FROM: Record<string, string> = {
  idea: 'an idea',
  discussions: 'a discussion',
  code: 'a code project',
  answers: 'an answer',
  news: 'an article',
  recipes: 'a recipe',
  data: 'a dataset',
  web: 'a page',
};

function spokenKind(item: Item, tool: string): string {
  if (item.data.kind === 'paper') return 'a paper';
  if (item.data.kind === 'book') return 'a book';
  if (item.data.kind === 'artwork') return 'an artwork';
  if (FROM[tool]) return FROM[tool];
  if (item.kind === 'video') return 'a video';
  if (item.kind === 'image') return 'a picture';
  if (Array.isArray(item.data.steps)) return 'a how-to';
  return TEXT_FROM[tool] ?? 'a note';
}

/** A word of a spaced language counts once, each character of a spaceless one once, since each is about a syllable. */
function wordCount(text: string): number {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .reduce((n, word) => n + Math.max(1, [...word].filter((c) => SPACELESS.test(c)).length), 0);
}

function clipWords(text: string, most: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (wordCount(text) <= most) return text;
  const kept: string[] = [];
  for (const word of words) {
    if (wordCount([...kept, word].join(' ')) > most) {
      if (kept.length === 0) kept.push([...word].slice(0, most).join(''));
      break;
    }
    kept.push(word);
  }
  while (kept.length > 1 && DANGLING.has(kept.at(-1)!.toLowerCase())) kept.pop();
  return kept.join(' ').replace(/[\s,;:.!?—–-]+$/u, '');
}

/** A title as it is said: without its subtitle when it has one, and never longer than `most` words. */
function said(title: string, most: number): string {
  const flat = title.replace(/\s+/g, ' ').trim().replace(/"/g, '');
  const main = flat.split(/\s*(?::|\(|\|)\s*/)[0]!;
  return clipWords(wordCount(main) >= 2 ? main : flat, most);
}

/**
 * What the agent says when a run the user asked for has delivered: how many picks came, under which card, and one or two of them by
 * what they are and their title, real material before written ideas. Plainly that nothing came, when nothing did.
 */
export function announcement(mind: Mindstorm, anchor: Id, brought: Id[]): string {
  const card = mind.itemOf(anchor);
  const name = said(card.title || card.summary || card.text || 'this card', NAME_WORDS);
  if (brought.length === 0) return `I found nothing new for ${name}.`;
  const head = brought.length === 1 ? `One new thing under ${name}` : `${COUNT[brought.length] ?? brought.length} new things under ${name}`;

  const picks = brought.map((id) => ({ item: mind.itemOf(id), tool: mind.node(id).origin.tool ?? '' }));
  const named: { kind: string; title: string }[] = [];
  for (const { item, tool } of [...picks.filter((p) => p.tool !== 'idea'), ...picks.filter((p) => p.tool === 'idea')]) {
    const kind = spokenKind(item, tool);
    if (item.title.trim() && !named.some((n) => n.kind === kind)) named.push({ kind, title: item.title });
    if (named.length === 2) break;
  }
  const [first, second] = named;
  if (!first) return `${head}.`;
  const room = MOST_WORDS - wordCount(head);
  const quote = (n: { kind: string; title: string }, most: number) => `${n.kind} "${said(n.title, Math.max(2, most - wordCount(n.kind)))}"`;
  if (second) {
    const both = `${quote(first, room)} and ${quote(second, room)}`;
    if (wordCount(both) <= room) return `${head}: ${both}.`;
  }
  return brought.length === 1 ? `${head}: ${quote(first, room)}.` : `${head}, including ${quote(first, room - 1)}.`;
}
