import type { CardNote } from '../core/voice-tools.ts';
import { Narration } from '../node/live.ts';
import type { ScriptCard, ScriptPhase } from './script.ts';

/**
 * A round as a take: one fixed timeline of what Momo says, which labels the agents show and which cards land, each at the moment
 * it would in a real round. Everything here is plain arithmetic on the script, so the same round gives the same take every time.
 */

/**
 * How long each part of a real round takes, in ms. From two real Scout rounds timed on a copy of the service on 17 Nov 2026
 * (reports/ws52.md has the runs), and the judging service's own figures: curating a source's results 1 to 2 s, a made picture
 * about 30 s, an idea written about 40 s.
 */
export const REAL = {
  /** From the user's last word to the run's own label: Momo has begun her answer and called the search. */
  begins: 600,
  /** Choosing where to look. */
  plan: 2800,
  /** Looking through what the user already has. */
  own: 2200,
  /** One source searched: the first to answer, and how much later each further one does. */
  search: 5200,
  searchApart: 2400,
  /** Papers take longer to come back than pictures. */
  papers: 3000,
  /** Reading a source's results and choosing among them. */
  read: 1600,
  /** A picture made, and how much later each further one lands. */
  picture: 30_000,
  pictureApart: 4000,
  /** An idea written down. */
  idea: 40_000,
  /** From the last card to the run's end. */
  settle: 800,
  /** The breath between two things Momo says. */
  breath: 350,
  /** What is left of the take after the last thing in it. */
  tail: 600,
} as const;

/** Momo gathers later cards into one remark at most this often, as the live voice does (`BATCH_MS` in live.ts). */
const BATCH_MS = 6000;

/** One of the agents' labels, from when it shows to when it goes. */
export interface Step {
  label: string;
  at: number;
  end: number;
}

/** Cards that land together, as one delivery of a run. */
export interface Drop {
  at: number;
  cards: string[];
}

/** When the agents work and the cards land in a round. */
export interface Schedule {
  steps: Step[];
  drops: Drop[];
  /** When the run is over: its own label goes, and Momo may wrap up. */
  end: number;
}

/**
 * The moments Momo speaks at in a round, as the live voice has them: her answer as the search starts, the first card the moment
 * it lands, later cards gathered into one remark, and a wrap-up when the run is over.
 */
export type LineKind = 'answer' | 'first' | 'more' | 'wrap';

/** One thing Momo says in a round, as it is written down: which cards it is about, and its words. */
export interface Line {
  id: string;
  kind: LineKind;
  /** The cards it tells of. A wrap-up's are those no remark told before it. */
  cards: string[];
  text: string;
}

export interface TimedLine extends Line {
  at: number;
  ms: number;
}

export interface Take {
  round: string;
  /** Its whole length. */
  ms: number;
  lines: TimedLine[];
  steps: Step[];
  drops: Drop[];
  /** When the run is over. */
  end: number;
}

/** The source's name as a step would say it: short, and a museum by its own name. */
function sourceName(card: ScriptCard): string | undefined {
  const from = (card.from ?? card.holder ?? '').replace(/,? via .*$/i, '').replace(/,.*$/, '').trim();
  if (!from) return undefined;
  if (/wikimedia|commons/i.test(from)) return 'Wikimedia Commons';
  return from.length <= 34 ? from : undefined;
}

/**
 * When a real round would show each label and land each card, from the kinds of cards the round brings: what the user already has
 * first, then each source outside as it answers, the sources searched side by side, then what the agents make, which takes longest.
 */
export function schedule(phase: ScriptPhase): Schedule {
  const steps: Step[] = [];
  const drops: Drop[] = [];
  if (phase.cards.length === 0) return { steps, drops, end: 0 };
  const own = phase.cards.filter((card) => card.origin === 'ocean');
  const outside = phase.cards.filter((card) => card.origin === 'external');
  const made = phase.cards.filter((card) => card.origin === 'generated');

  let start: number = REAL.begins;
  if (outside.length + made.length > 0) {
    steps.push({ label: 'Choosing where to look first', at: start, end: start + REAL.plan });
    start += REAL.plan;
  }
  if (own.length > 0) {
    steps.push({ label: 'Checking what you already have', at: start, end: start + REAL.own });
    drops.push({ at: start + REAL.own, cards: own.map((card) => card.id) });
  }

  const bySource = new Map<string, ScriptCard[]>();
  for (const card of outside) {
    const source = card.kind === 'paper' ? 'research papers' : (sourceName(card) ?? 'the web');
    bySource.set(source, [...(bySource.get(source) ?? []), card]);
  }
  // A run searches a few sources, not a dozen: the largest keep their names, and the rest are the web's.
  const named = [...bySource].sort((a, b) => b[1].length - a[1].length);
  const sources = named.slice(0, 2);
  const rest = named.slice(2).flatMap(([, cards]) => cards);
  if (rest.length > 0) sources.push(['the web', rest]);
  for (const [n, [source, cards]] of sources.entries()) {
    const found = start + REAL.search + n * REAL.searchApart + (source === 'research papers' ? REAL.papers : 0);
    steps.push({ label: `Searching ${source}`, at: start, end: found });
    steps.push({ label: `Reading ${cards.length} result${cards.length === 1 ? '' : 's'} from ${source}`, at: found, end: found + REAL.read });
    drops.push({ at: found + REAL.read, cards: outside.filter((card) => cards.includes(card)).map((card) => card.id) });
  }

  let pictures = 0;
  for (const card of made) {
    const lands = card.image ? start + REAL.picture + pictures++ * REAL.pictureApart : start + REAL.idea;
    steps.push({ label: card.image ? `Making a picture of ${card.title}`.slice(0, 60) : 'Writing an idea down', at: start, end: lands });
    drops.push({ at: lands, cards: [card.id] });
  }
  drops.sort((a, b) => a.at - b.at);
  return { steps, drops, end: drops.at(-1)!.at + REAL.settle };
}

/** A card as Momo is told of it when it lands, from the script's own words. */
export function noteOf(card: ScriptCard, under: string): CardNote {
  const kind = card.kind === 'artwork' ? 'an artwork' : card.kind === 'paper' ? 'a paper' : card.kind === 'film' ? 'a film' : card.kind === 'picture' ? 'a picture' : card.kind === 'note' ? 'a note' : card.kind === 'link' ? 'a page' : `a ${card.kind} card`;
  const from = card.origin === 'ocean' ? "the user's own cards" : card.origin === 'generated' ? 'made by the agents just now' : (card.from ?? card.holder);
  return { anchor: 'head', under, kind, title: card.title, ...(card.by ? { by: card.by } : {}), ...(card.date ? { date: card.date } : {}), ...(from ? { from } : {}), ...(card.text ? { says: card.text } : {}) };
}

/**
 * Walks a round as the live voice would, and asks `say` for each thing Momo says, in order: her answer, when the round is asked
 * for in words (a pinch or a tapped question gets none), then each note the real `Narration` gives as the round's cards land on
 * this schedule. `say` returns how long the line takes to speak, which decides
 * what has landed by the time she is free again, and so which cards the next remark gathers. Returns the lines with their cards.
 */
export async function planLines(
  phase: ScriptPhase,
  under: string,
  say: (line: { kind: LineKind; cards: ScriptCard[]; note: string | null }) => Promise<{ text: string; ms: number }>,
): Promise<Line[]> {
  const lines: Line[] = [];
  const told = async (kind: LineKind, cards: ScriptCard[], note: string | null): Promise<number> => {
    const { text, ms } = await say({ kind, cards, note });
    lines.push({ id: kind === 'more' ? `more-${lines.filter((l) => l.kind === 'more').length + 1}` : kind, kind, cards: cards.map((card) => card.id), text });
    return ms;
  };
  let free = phase.say ? (await told('answer', [], null)) + REAL.breath : 0;
  const sched = schedule(phase);
  if (sched.drops.length === 0) return lines;

  const byId = new Map(phase.cards.map((card): [string, ScriptCard] => [card.id, card]));
  const narration = new Narration(BATCH_MS);
  narration.began('run', 'head', under);
  const pending = [...sched.drops];
  const waiting: ScriptCard[] = [];
  let ended = false;
  let firstTold = false;
  for (let t = 0; ; ) {
    while (pending.length > 0 && pending[0]!.at <= t) {
      for (const id of pending.shift()!.cards) {
        waiting.push(byId.get(id)!);
        narration.landed(noteOf(byId.get(id)!, under));
      }
    }
    if (!ended && pending.length === 0 && t >= sched.end) {
      narration.ended('run');
      ended = true;
    }
    if (t >= free) {
      const note = narration.next(t);
      if (note) {
        const kind: LineKind = ended ? 'wrap' : firstTold ? 'more' : 'first';
        const cards = kind === 'first' ? waiting.splice(0, 1) : waiting.splice(0);
        firstTold = true;
        free = t + (await told(kind, cards, note)) + REAL.breath;
        if (kind === 'wrap') return lines;
      }
    }
    // The next moment anything can happen: a delivery, the run's end, or Momo free with something to tell.
    const due = narration.due();
    const moments = [pending[0]?.at, ended ? undefined : sched.end, due === null ? undefined : Math.max(free, due)].filter((at): at is number => at !== undefined && at > t);
    if (moments.length === 0) return lines;
    t = Math.min(...moments);
  }
}

/** How long a line takes to say when there is no recording of it to measure: about 15 characters a second, as Momo's voice reads. */
export const spokenFor = (text: string): number => (text.trim() ? Math.max(1200, Math.round(text.trim().length * 66)) : 0);

/**
 * The round's timeline. A remark starts as the last of its cards lands, or when the line before it is over if that is later, so
 * Momo never talks over herself; the wrap-up waits for the run's end too. A line with no words takes no time and is not said.
 */
export function takeOf(phase: ScriptPhase, lines: readonly Line[], lengthOf: (text: string) => number = spokenFor): Take {
  const sched = schedule(phase);
  const landsAt = new Map(sched.drops.flatMap((drop) => drop.cards.map((id): [string, number] => [id, drop.at])));
  const timed: TimedLine[] = [];
  let free = 0;
  for (const line of lines) {
    const ms = lengthOf(line.text);
    const landed = Math.max(0, ...line.cards.map((id) => landsAt.get(id) ?? 0));
    const at = Math.max(free, line.kind === 'answer' ? 0 : line.kind === 'wrap' ? sched.end : landed);
    timed.push({ ...line, at, ms });
    if (ms > 0) free = at + ms + REAL.breath;
  }
  const last = Math.max(sched.end, ...timed.map((line) => line.at + line.ms));
  return { round: phase.id, ms: last + REAL.tail, lines: timed, steps: sched.steps, drops: sched.drops, end: sched.end };
}

/** What stands at one moment of a take: the cards that have landed, the labels showing, and the line Momo is in with how far. */
export interface Moment {
  cards: string[];
  steps: Step[];
  line: { line: TimedLine; offset: number } | null;
}

export function momentAt(take: Take, ms: number): Moment {
  const line = take.lines.find((l) => l.ms > 0 && l.at <= ms && ms < l.at + l.ms);
  return {
    cards: take.drops.filter((drop) => drop.at <= ms).flatMap((drop) => drop.cards),
    steps: take.steps.filter((step) => step.at <= ms && ms < step.end),
    line: line ? { line, offset: ms - line.at } : null,
  };
}
