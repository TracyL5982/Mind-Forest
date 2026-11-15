import type { Id, Item } from './domain.ts';
import { briefly, wordCount } from './brief.ts';
import type { Mindstorm } from './state.ts';

/** About six seconds of speech. */
const MOST_WORDS = 20;
const NAME_WORDS = 6;
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

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

/**
 * What the agent says when a run the user asked for has delivered: how many picks came, under which card, and one or two of them by
 * what they are and their title, real material before written ideas. Plainly that nothing came, when nothing did.
 */
export function announcement(mind: Mindstorm, anchor: Id, brought: Id[]): string {
  const card = mind.itemOf(anchor);
  const name = briefly(card.title || card.summary || card.text || 'this card', NAME_WORDS);
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
  const quote = (n: { kind: string; title: string }, most: number) => `${n.kind} "${briefly(n.title, Math.max(2, most - wordCount(n.kind)))}"`;
  if (second) {
    const both = `${quote(first, room)} and ${quote(second, room)}`;
    if (wordCount(both) <= room) return `${head}: ${both}.`;
  }
  return brought.length === 1 ? `${head}: ${quote(first, room)}.` : `${head}, including ${quote(first, room - 1)}.`;
}
