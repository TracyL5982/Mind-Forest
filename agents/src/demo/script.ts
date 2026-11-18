import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * The demo's script: one prepared tree, as the rounds of asking that grow it. `agents/demo/script.json` holds it, with the pictures
 * beside it in `agents/demo/media`. See agents/demo/README.md.
 */

/** One card of a round, in words. `cards.ts` makes the item and the node the service keeps from it. */
export const ScriptCard = z.object({
  id: z.string().min(1),
  /**
   * What it is, which decides its card: a picture; an artwork (a picture with what its collection records); a paper; a film (a link
   * with its still, or a file that plays); a note of the user's; a link; and three written cards: facts, a person, a list.
   */
  kind: z.enum(['picture', 'artwork', 'paper', 'film', 'note', 'link', 'facts', 'person', 'list']),
  /** Where it comes from: the user's own things, a source outside, or made by the agents. */
  origin: z.enum(['ocean', 'external', 'generated']),
  title: z.string().min(1),
  /** One or two sentences: what it is and why it is here. Momo tells the user this, and a picture's caption is this. */
  text: z.string().default(''),
  /**
   * The words on its thread: why it hangs from the card it does, under eight words, as the Scout writes a pick's ("what the studies
   * found"). A reason, never a caption. Without it the words come from its text.
   */
  why: z.string().optional(),
  date: z.string().optional(),
  by: z.string().optional(),
  holder: z.string().optional(),
  /** The source's name, as the card names it. */
  from: z.string().optional(),
  credit: z.string().optional(),
  licence: z.string().optional(),
  href: z.string().optional(),
  /** A file in the media folder, and its size in pixels. */
  image: z.string().optional(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  /** A file in the media folder that plays, and the second it was cut from in its source. */
  video: z.string().optional(),
  start: z.number().optional(),
  authors: z.array(z.string()).optional(),
  venue: z.string().optional(),
  site: z.string().optional(),
  facts: z.array(z.tuple([z.string(), z.string()])).optional(),
  person: z.object({ name: z.string(), role: z.string().optional() }).optional(),
  items: z.array(z.string()).optional(),
  /** Lines the user drew on the card: each a run of x then y, 0 to 1 across and down the opened card. */
  mark: z.array(z.array(z.number().min(0).max(1))).optional(),
  /**
   * A made diagram the user steps through: the pills offered under the card, each showing its picture of the media folder in the
   * card's place (`scripts/demo-diagrams.ts` draws them). The card lands showing `image`, its first state.
   */
  states: z.array(z.object({ pill: z.string().min(1), image: z.string().min(1) })).min(1).max(3).optional(),
});
export type ScriptCard = z.infer<typeof ScriptCard>;

/** One round: what the user says or does, the card it is asked from, and what it brings. */
export const ScriptPhase = z.object({
  id: z.string().min(1),
  /** Its block in the chart. */
  chart: z.string().optional(),
  title: z.string(),
  /** The round whose cards hold `head`. Null for the round that starts the tree. */
  parent: z.string().nullable(),
  /** The card the round is asked from: a card of an earlier round, or `root` for the tree's first card. */
  head: z.string().min(1),
  /** The line as written for the walkthrough, and other wordings of it. Momo is not held to them: any request plays the round. */
  say: z.string().default(''),
  sayAlso: z.array(z.string()).default([]),
  /** What the user does without speaking, in order. */
  do: z.array(z.string()).default([]),
  /** What Momo might answer, as a stand-in on the board. Never spoken from here: the live voice finds its own words. */
  momo: z.string().default(''),
  /** The questions offered under the round's card. */
  offers: z.array(z.string()).default([]),
  note: z.string().default(''),
  /** A question offered under the round's card that plays this round when it is picked, whatever its place in the order. */
  ask: z.string().optional(),
  /**
   * Cards of the round that land before any other in a fast take, together, as soon as the user's own things would, as found
   * cards land: those Momo's opening line tells of, which she says once they stand (the user's ask, 2026-11-18).
   */
  first: z.array(z.string()).default([]),
  cards: z.array(ScriptCard),
});
export type ScriptPhase = z.infer<typeof ScriptPhase>;

export const ScriptChart = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    /** The round this block stands for. */
    phase: z.string().nullable().optional(),
    text: z.string(),
    kind: z.string(),
    x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  })),
  edges: z.array(z.tuple([z.string(), z.string()])),
  w: z.number(),
  h: z.number(),
});

export const DemoScript = z.object({
  version: z.literal(1),
  /** The tree's name. */
  title: z.string().min(1),
  /** The words of the tree's first card. */
  topic: z.string().min(1),
  /** The rounds in the order they are recorded. Going to a round shows the tree with every round before it built. */
  phases: z.array(ScriptPhase).min(1),
  chart: ScriptChart.optional(),
}).superRefine((script, ctx) => {
  const known = new Set<string>();
  const ids = new Set<string>();
  for (const [n, phase] of script.phases.entries()) {
    if (ids.has(phase.id)) ctx.addIssue({ code: 'custom', message: `two rounds are called ${phase.id}` });
    ids.add(phase.id);
    if (n === 0 ? phase.head !== 'root' : phase.head !== 'root' && !known.has(phase.head)) {
      ctx.addIssue({ code: 'custom', message: n === 0 ? 'the first round starts the tree: its head is "root"' : `round ${phase.id} is asked from "${phase.head}", which no earlier round brings` });
    }
    for (const card of phase.cards) {
      if (known.has(card.id)) ctx.addIssue({ code: 'custom', message: `the card ${card.id} is in two rounds` });
      known.add(card.id);
    }
    for (const id of phase.first) if (!phase.cards.some((card) => card.id === id)) ctx.addIssue({ code: 'custom', message: `round ${phase.id} lands ${id} first, which it does not bring` });
  }
});
export type DemoScript = z.infer<typeof DemoScript>;

export function loadScript(file: string): DemoScript {
  return DemoScript.parse(JSON.parse(readFileSync(file, 'utf8')));
}
