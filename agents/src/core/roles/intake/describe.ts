import { z } from 'zod';
import type { ItemData } from '../../domain.ts';
import { asColour } from './colours.ts';
import { clip, squash, tidyTags, TITLE_MAX, type Described } from './plain.ts';

type Shape = Record<string, z.ZodType>;
type Reply<S extends Shape> = { [K in keyof S]: z.infer<S[K]> };

/** The text the model read, asked whether it states a value. With no text to check against, every value stands. */
interface Read {
  says(words: string): boolean;
  writes(value: number): boolean;
}

interface Field<S extends Shape> {
  /** The reply keys the model fills. Flat, every key required, empty meaning absent: the model API rejects recursive schemas and optional keys. */
  reply: S;
  /** The `item.data` keys this field writes, or nothing when the reply leaves it empty or the text does not state it. */
  keep(reply: Reply<S>, text: Read): ItemData | undefined;
}

const field = <S extends Shape>(f: Field<S>): Field<S> => f;

/** A list the content states entry by entry. An entry the text does not hold is dropped. */
const listed = <K extends string>(key: K, max: number) =>
  field({
    reply: { [key]: z.array(z.string()) } as Record<K, z.ZodArray<z.ZodString>>,
    keep(r, text) {
      const entries = [...new Set((r[key] as string[]).map(squash))].filter((entry) => entry && text.says(entry)).slice(0, max);
      return entries.length > 0 ? { [key]: entries } : undefined;
    },
  });

/** Two strings that mean something only together, such as a question and its answer. */
const pair = <A extends string, B extends string>(first: A, second: B) =>
  field({
    reply: { [first]: z.string(), [second]: z.string() } as Record<A | B, z.ZodString>,
    keep(r, text) {
      const [a, b] = [squash(r[first]), (r[second] as string).trim()];
      return a && b && text.says(a) && text.says(b) ? { [first]: a, [second]: b } : undefined;
    },
  });

const MAX_COLUMNS = 8;
const MAX_ROWS = 40;
const MAX_ITEMS = 30;

/** Every piece of structure Intake extracts. The reply schema and `structure()` are both built from this table. */
const EXTRACTED = [
  field({
    reply: { steps: z.array(z.string()) },
    keep(r) {
      const steps = r.steps.map(squash).filter(Boolean).slice(0, 12);
      return steps.length >= 2 ? { steps } : undefined;
    },
  }),
  field({
    reply: { facts: z.array(z.object({ label: z.string(), value: z.string() })) },
    keep(r) {
      const facts = r.facts.map((f) => ({ label: squash(f.label), value: squash(f.value) })).filter((f) => f.label && f.value);
      return facts.length > 0 ? { facts: facts.slice(0, 12) } : undefined;
    },
  }),
  field({
    reply: { quoteText: z.string(), quoteBy: z.string() },
    keep(r, text) {
      const quote = r.quoteText.trim();
      return quote && text.says(quote) ? { quote: { text: quote, ...(r.quoteBy.trim() ? { by: r.quoteBy.trim() } : {}) } } : undefined;
    },
  }),
  field({
    reply: { chartLabels: z.array(z.string()), chartValues: z.array(z.number()), chartUnit: z.string() },
    keep(r, text) {
      const stated = r.chartValues.every((v) => Number.isFinite(v) && text.writes(v));
      if (r.chartLabels.length < 2 || r.chartLabels.length !== r.chartValues.length || !stated) return undefined;
      return { chart: { labels: r.chartLabels.map(squash), values: r.chartValues, ...(r.chartUnit.trim() ? { unit: r.chartUnit.trim() } : {}) } };
    },
  }),
  field({
    reply: { personName: z.string(), personRole: z.string() },
    keep: (r) => (r.personName.trim() ? { person: { name: r.personName.trim(), ...(r.personRole.trim() ? { role: r.personRole.trim() } : {}) } } : undefined),
  }),
  field({
    reply: { when: z.string() },
    keep: (r) => (r.when.trim() ? { when: r.when.trim() } : undefined),
  }),
  field({
    reply: { where: z.string() },
    keep(r, text) {
      const where = squash(r.where);
      return where && text.says(where) ? { where } : undefined;
    },
  }),
  listed('people', 12),
  listed('pros', 12),
  listed('cons', 12),
  field({
    // A row is one string with its cells separated by "|", so the schema nests no deeper than a list of strings.
    reply: { tableHeads: z.array(z.string()), tableRows: z.array(z.string()) },
    keep(r, text) {
      const heads = r.tableHeads.map(squash);
      if (heads.length < 2 || heads.length > MAX_COLUMNS || heads.some((head) => !head || !text.says(head))) return undefined;
      const rows = r.tableRows
        .map((row) => {
          const cells = row.split('|').map(squash);
          const fenced = cells.length === heads.length + 2 && !cells[0] && !cells.at(-1);
          return fenced ? cells.slice(1, -1) : cells;
        })
        .filter((cells) => cells.length === heads.length && cells.some(Boolean) && cells.every((cell) => !cell || text.says(cell)))
        .slice(0, MAX_ROWS);
      return rows.length > 0 ? { table: { heads, rows } } : undefined;
    },
  }),
  pair('question', 'answer'),
  pair('term', 'definition'),
  field({
    reply: { items: z.array(z.string()), checklist: z.array(z.boolean()) },
    keep(r, text) {
      const ticked = r.checklist.length === r.items.length;
      const kept = r.items
        .map((item, n) => ({ item: squash(item), done: r.checklist[n] }))
        .filter((entry) => entry.item && text.says(entry.item))
        .slice(0, MAX_ITEMS);
      if (kept.length < 2) return undefined;
      return { items: kept.map((entry) => entry.item), ...(ticked ? { checklist: kept.map((entry) => entry.done) } : {}) };
    },
  }),
  field({
    reply: { colours: z.array(z.object({ name: z.string(), value: z.string() })) },
    keep(r, text) {
      const colours = new Map<string, { name: string; value: string }>();
      for (const colour of r.colours) {
        const value = asColour(colour.value);
        if (!value || !text.says(colour.value) || colours.has(value.toLowerCase())) continue;
        const name = squash(colour.name);
        colours.set(value.toLowerCase(), { name: name && text.says(name) ? name : value, value });
      }
      return colours.size > 0 ? { colours: [...colours.values()].slice(0, 12) } : undefined;
    },
  }),
  field({
    reply: { excerptText: z.string(), excerptAt: z.string() },
    keep(r, text) {
      const passage = r.excerptText.trim();
      const at = squash(r.excerptAt);
      return passage && text.says(passage) ? { excerpt: { text: passage, ...(at && text.says(at) ? { at } : {}) } } : undefined;
    },
  }),
];

type Merged<U> = (U extends unknown ? (u: U) => void : never) extends (u: infer I) => void ? { [K in keyof I]: I[K] } : never;

const description = {
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  ...(Object.assign({}, ...EXTRACTED.map((f) => f.reply)) as Merged<(typeof EXTRACTED)[number]['reply']>),
};

export const LinkReply = z.object(description);
export const MediaReply = z.object({ ...description, description: z.string() });
export const TextReply = z.object({
  entries: z.array(z.object({ dump: z.number(), text: z.string(), ...description })),
});
export const ChatReply = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  takeaways: z.array(z.object({ title: z.string(), text: z.string() })),
});

export type Description = z.infer<typeof LinkReply>;

const FIELDS = `For each thing you describe, return:
- title: under 70 characters, specific to this content, no trailing period.
- summary: one or two sentences saying what it is and why it might matter.
- tags: 2 to 6 short lowercase topic words.
Write in the language of the content.

The remaining fields hold structure a card can draw. Fill one only when the content itself states it, and leave it empty (an empty string or an empty list) otherwise. Never invent structure.
- steps: the ordered steps, when the content is a procedure or a sequence.
- facts: label and value pairs, when the content lists figures or attributes.
- quoteText and quoteBy: a quotation the content contains, word for word, and who said it.
- chartLabels, chartValues, chartUnit: a numeric series the content states, one value per label.
- personName and personRole: when the content is about one named person.
- when: a date or time the content is about, as written.

The fields below are checked against the content. Copy its own words into them: a value that is not written in the content is thrown away.
- where: the place the content is about, as written.
- people: every person the content names.
- pros and cons: the points for and the points against, when the content weighs a choice.
- tableHeads and tableRows: a table the content holds. tableHeads has the column heads. Each entry of tableRows is one row, with its cells in column order separated by " | ".
- question and answer: when the content asks one question and answers it.
- term and definition: when the content defines one term.
- items and checklist: a list in no particular order. Leave checklist empty unless the content marks items as done or not done. Then give true or false for each item, in the same order.
- colours: each colour the content gives as a hex value or a plain colour name, with the name the content calls it, or an empty name.
- excerptText and excerptAt: one passage of a longer source that is worth quoting, word for word, and where it sits as the source itself says (a heading, a chapter, a page).`;

export const TEXT_SYSTEM = `You are the intake clerk of a brainstorming app. You label what the user drops in so it can be filed and found later.

You are given one or more dumps of text the user wrote or pasted, each with a number.

Return one entry per dump, with "dump" set to its number and "text" left empty. The one exception: a long dump that holds clearly separate ideas may be returned as 2 to 6 entries with the same "dump" number, one per idea. Then each entry's "text" holds that idea written out so it stands on its own, keeping the user's wording where you can. Do not split a dump that is one line of thought.

${FIELDS}`;

export const LINK_SYSTEM = `You are the intake clerk of a brainstorming app. You label what the user drops in so it can be filed and found later.

You are given the readable text of a web page the user saved. Describe the page.

${FIELDS}`;

export const MEDIA_SYSTEM = `You are the intake clerk of a brainstorming app. You label what the user drops in so it can be filed and found later.

You are given one image or one video the user dropped in, and its file name. Describe what it shows.

Also return "description": a few sentences on what is visible, including any text you can read in it, so the item can be found by searching.

${FIELDS}`;

export const CHAT_SYSTEM = `You are the intake clerk of a brainstorming app. The user has brought in a conversation they had with an AI assistant, and you record what came out of it.

You are given the conversation. Long messages are shortened and the middle of a long conversation may be left out.

Return:
- title: under 70 characters, naming what the conversation was about. No trailing period.
- summary: one or two sentences on what was worked out or decided.
- tags: 2 to 6 short lowercase topic words.
- takeaways: up to 5 ideas, conclusions or decisions from the conversation that are worth keeping on their own. Each has a title under 70 characters and a text of one to three sentences that makes sense without the conversation. Return fewer, or none, when the conversation holds fewer.
Write in the language of the conversation.`;

const loose = (text: string): string => squash(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ''));

function reader(grounding?: string): Read {
  if (grounding === undefined) return { says: () => true, writes: () => true };
  let words: string | undefined;
  let digits: string | undefined;
  return {
    says: (claim) => (words ??= loose(grounding)).includes(loose(claim)),
    writes: (value) => (digits ??= grounding.replace(/,/g, '')).includes(String(value)),
  };
}

/**
 * The parts of the model's description worth keeping as drawable data.
 * With `grounding` (the text the model read), a value that is not in it is dropped.
 */
export function structure(d: Description, grounding?: string): ItemData {
  const text = reader(grounding);
  const data: ItemData = {};
  for (const extracted of EXTRACTED) Object.assign(data, (extracted as Field<Shape>).keep(d, text));
  return data;
}

/** The model's title, summary and tags, with `plain` standing in for anything it left empty. */
export function labels(d: Described, plain: Described): Described {
  return {
    title: clip(squash(d.title) || plain.title, TITLE_MAX),
    summary: clip(squash(d.summary) || plain.summary, 320),
    tags: tidyTags(d.tags, plain.tags),
  };
}
