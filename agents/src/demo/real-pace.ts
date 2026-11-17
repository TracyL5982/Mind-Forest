import type { ScriptCard, ScriptPhase } from './script.ts';
import type { Drop, Schedule, Step } from './take.ts';

/**
 * A round at the pace of a real one: when each label shows and each card lands, drawn from eight real Scout runs measured on
 * 17 Nov 2026 (reports/ws61.md of the judging program; the runs are `ws61-rounds/A–H.jsonl` there). The pattern of a round is
 * fixed: it is drawn with a generator seeded from the round's name, so the same round plays the same every time.
 *
 * What the real runs showed, and so what is drawn here (seconds from the run's start; median, then the range seen):
 * - "Choosing where to look first" from 0 for 1.4 (1.1 to 2.2). "Checking what you already have" beside it from 0 for 1.7 (1.0 to
 *   3.0), only when the user has something that fits, which lands as it ends.
 * - "Thinking of directions for …" from 0 for 26 (19 to 36): the run is over about when it is.
 * - Three searches side by side as the choosing ends, each "Searching <source> for <words>" for 1.0 (0.2 to 10), then for a
 *   source of pictures "Fetching 8 pictures from <source>" for 0.9 (0.1 to 2.2), then "Reading N results from <source>" for 1.6
 *   (0.7 to 5.4), N mostly 8. Most readings land nothing. The first card lands at about 3.
 * - A second wave of one to four searches from 19 to 32, in seven runs of eight.
 * - What the Scout writes itself lands out of "Thinking of directions", the first at 16 (10 to 27), the next 2.2 (1.2 to 7.8) on.
 * - A picture is made once the directions are written, and takes 23 (22 to 26).
 * - The Renderer lays a found card out at once, and takes 5 to 23 over a written one.
 */

/**
 * Three choices that are the user's to make, each kept as one switch.
 *
 * `PICTURES`: how a round's made pictures come when it has more than one. A real run made one picture, so three were never
 * measured. `beside`: all are begun as the directions end, a few seconds apart, and the last lands near 60 s. `after`: each is
 * begun when the one before it lands, and the last of three lands near 100 s.
 */
export const PICTURES: 'beside' | 'after' = 'beside';
/**
 * `SMALL_ROUNDS_FULL`: whether a round that brings three cards or fewer still runs the span of a real run, about 25 s of thinking
 * with searches that bring nothing. The user chose off: nobody is made to watch labels with nothing arriving. Such a round's
 * cards come from the fast searches, at the times of a real run's first wave, and every agent's label has ended within about
 * 2 s of its last card.
 */
export const SMALL_ROUNDS_FULL: boolean = false;
/** In a small round that does not run the full span, how long after its last card the last label may end, in ms. */
const SOON = 1800;
/** A round with this many cards or fewer is a small one. */
export const SMALL_ROUND = 3;

/** The sources the service has, as its labels name them. */
const SOURCES = ['museum collections', 'Wikimedia Commons', 'Europeana', 'research papers', 'books', 'Internet Archive', 'Unsplash', 'Are.na', 'film and television', 'the web'] as const;
/** The sources whose results are pictures, fetched before they are read. */
const PICTURED = new Set<string>(['museum collections', 'Wikimedia Commons', 'Europeana', 'Unsplash', 'Are.na']);
const STOP = new Set('a an and are as at be by for from has have i in into is it its of on or so that the their this to was we what which who with you your how do does did can me my our us more some any one two'.split(' '));

/** A small generator of numbers from 0 to 1, the same run of them for the same seed. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The service's source a found card would come from. */
export function sourceOf(card: ScriptCard): string {
  const from = `${card.from ?? ''} ${card.holder ?? ''}`;
  if (card.kind === 'paper') return 'research papers';
  if (card.kind === 'film') return 'film and television';
  if (/wikimedia|commons/i.test(from)) return 'Wikimedia Commons';
  if (/internet archive/i.test(from)) return 'Internet Archive';
  if (/gutenberg/i.test(from)) return 'books';
  if (/europeana/i.test(from)) return 'Europeana';
  return card.kind === 'artwork' || card.kind === 'picture' || card.kind === 'facts' || card.kind === 'person' ? 'museum collections' : 'the web';
}

/** Two to four words a search for these words would be made with, as the Scout writes its own. */
export function queryOf(text: string, most = 3): string {
  const words = text.replace(/^\s*hey momo,?\s*/i, '').replace(/[’']s\b/g, '').replace(/[^\p{L}\p{N}\s-]+/gu, ' ').split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word.toLowerCase()));
  return words.slice(0, most).join(' ').toLowerCase() || 'ideas';
}

const short = (label: string) => label.split(' ').slice(0, 7).join(' ');

export function realSchedule(phase: ScriptPhase, under: string): Schedule {
  const steps: Step[] = [];
  const drops: Drop[] = [];
  if (phase.cards.length === 0) return { steps, drops, end: 0, settled: 0 };
  const rnd = seeded(`real:${phase.id}`);
  /** A time between two bounds, in ms, drawn nearer the low end the higher `lean` is. */
  const between = (low: number, high: number, lean = 1) => Math.round((low + (high - low) * rnd() ** lean) * 1000);
  const pick = <T,>(of: readonly T[]): T => of[Math.floor(rnd() * of.length)]!;

  const own = phase.cards.filter((card) => card.origin === 'ocean');
  const found = phase.cards.filter((card) => card.origin === 'external');
  const written = phase.cards.filter((card) => card.origin === 'generated' && !card.image);
  const pictures = phase.cards.filter((card) => card.origin === 'generated' && card.image);
  const about = phase.say || under;

  const began = between(0, 0.4);
  const chosen = began + between(1.1, 2.2);
  steps.push({ label: 'Choosing where to look first', at: began, end: chosen });
  if (own.length > 0) {
    // What the user already has that fits is found in one look, and lands together as the look ends.
    const checked = began + between(1.0, 3.0);
    steps.push({ label: 'Checking what you already have', at: began, end: checked });
    drops.push({ at: checked, cards: own.map((card) => card.id) });
  }

  // The found cards, by source, cut into the deliveries they come in: one, two or three at a time.
  const bySource = new Map<string, ScriptCard[]>();
  for (const card of found) bySource.set(sourceOf(card), [...(bySource.get(sourceOf(card)) ?? []), card]);
  const deliveries: { source: string; cards: ScriptCard[] }[] = [];
  for (const [source, cards] of bySource) {
    for (let at = 0; at < cards.length; ) {
      const size = Math.min(cards.length - at, 1 + Math.floor(rnd() * 3));
      deliveries.push({ source, cards: cards.slice(at, at + size) });
      at += size;
    }
  }

  /** One search of a source, with its fetch and its reading, and what lands when it has been read. */
  const search = (from: number, source: string, cards: ScriptCard[], words: string, quick = false): number => {
    // The search that brings the round's first find is a quick one, so that card lands near 3 s, as in a real run.
    const searched = from + between(0.2, quick ? 0.9 : cards.length > 0 ? 2.6 : 3.4, 2);
    steps.push({ label: short(`Searching ${source} for ${words}`), at: from, end: searched });
    let fetched = searched;
    if (PICTURED.has(source)) {
      fetched = searched + between(0.1, quick ? 0.6 : 2.2, 1.5);
      steps.push({ label: `Fetching 8 pictures from ${source}`, at: searched, end: fetched });
    }
    const results = rnd() < 0.65 ? 8 : 2 + Math.floor(rnd() * 6);
    const read = fetched + between(0.7, quick ? 1.6 : 4.2, 1.6);
    steps.push({ label: `Reading ${Math.max(results, cards.length)} results from ${source}`, at: fetched, end: read });
    if (cards.length > 0) drops.push({ at: read, cards: cards.map((card) => card.id) });
    return read;
  };
  const other = (not: Set<string>) => pick(SOURCES.filter((source) => !not.has(source)));

  // The first wave: three searches side by side as the choosing ends. A source of the round's brings its first delivery; one
  // searched besides brings nothing, as most real readings do.
  const first = [...new Map(deliveries.map((d): [string, typeof d] => [d.source, d])).values()].slice(0, 3);
  const searched = new Set(first.map((d) => d.source));
  for (const [n, delivery] of first.entries()) search(chosen, delivery.source, delivery.cards, queryOf(delivery.cards[0]!.title), n === 0);
  for (let n = first.length; n < 3; n++) {
    const source = other(searched);
    searched.add(source);
    search(chosen, source, [], queryOf(about, 2 + Math.floor(rnd() * 2)));
  }

  // The Scout thinks of directions throughout, and what it writes itself lands out of that thinking.
  const full = SMALL_ROUNDS_FULL || phase.cards.length > SMALL_ROUND;
  const thought = began + (full ? between(19, 36, 1.3) : between(7, 11));
  steps.push({ label: short(`Thinking of directions for ${under}`), at: began, end: thought });
  let wrote = began + (full ? between(10, 22, 1.2) : between(4, 6));
  for (const card of written) {
    drops.push({ at: Math.min(wrote, thought - 400), cards: [card.id] });
    wrote += between(1.2, 5.5, 2);
  }

  // The second wave: the deliveries the first did not bring, each from a search of its own, with one or two that bring nothing.
  const later = deliveries.filter((d) => !first.includes(d));
  const again = full ? later.length + 1 + Math.floor(rnd() * 2) : later.length;
  // A small round has one wave: every search starts as the choosing ends.
  let from = full ? Math.max(chosen + 9000, Math.min(thought - 9000, began + between(15, 24))) : chosen;
  let lastRead = 0;
  for (let n = 0; n < again; n++) {
    const delivery = later[n];
    const read = delivery
      ? search(from, delivery.source, delivery.cards, queryOf(delivery.cards.at(-1)!.title))
      : search(from, other(new Set<string>()), [], queryOf(about.split(' ').reverse().join(' '), 2));
    lastRead = Math.max(lastRead, read);
    if (full) from += between(0.6, 4.5, 1.4);
  }

  if (!full) {
    // Nothing is left on screen with nothing arriving: every label ends soon after the round's last card, the thinking with it.
    const lastCard = Math.max(...drops.map((drop) => drop.at));
    const done = lastCard + between(0.6, SOON / 1000);
    for (const step of steps) step.end = Math.min(step.end, step.label.startsWith('Thinking of directions') ? done : Math.max(step.at + 200, Math.min(step.end, done - 200)));
    for (let n = steps.length - 1; n >= 0; n--) if (steps[n]!.at >= done - 300) steps.splice(n, 1);
  }
  // The run is over when its thinking and its searches are: its own label goes then.
  const end = Math.max(...steps.map((step) => step.end), ...drops.map((drop) => drop.at)) + between(0.1, full ? 0.6 : 0.2);

  // A picture is made once the directions are written, and lands after the run is over.
  let making = thought + between(0.2, 1.5);
  const labels: Step[] = [];
  for (const card of pictures) {
    const made = making + between(22, 26);
    labels.push({ label: short(`Making a picture of ${card.title}`), at: making, end: made });
    drops.push({ at: made, cards: [card.id] });
    making = PICTURES === 'beside' ? making + between(3, 5) : made + between(0.2, 1);
  }
  steps.push(...labels);

  // The Renderer lays a found card out at once, and takes its time over one that was written.
  for (const drop of drops) {
    const slow = drop.cards.some((id) => written.some((card) => card.id === id));
    const laid = drop.at + (slow && full ? between(5, 23, 1.2) : between(0.05, 0.6));
    steps.push({ role: 'renderer', label: `Laying out ${drop.cards.length === 1 ? 'a card' : `${drop.cards.length} cards`}`, at: drop.at, end: laid });
  }
  drops.sort((a, b) => a.at - b.at);
  return { steps, drops, end, settled: Math.max(end, ...steps.map((step) => step.end)) + 300 };
}

/** How long the Renderer takes over the cards of one delivery in a real round, from the round's schedule. */
export function layingOut(sched: Schedule, cards: readonly string[]): number {
  const step = sched.steps.find((s) => s.role === 'renderer' && sched.drops.some((drop) => drop.at === s.at && drop.cards.some((id) => cards.includes(id))));
  return step ? step.end - step.at : 0;
}
