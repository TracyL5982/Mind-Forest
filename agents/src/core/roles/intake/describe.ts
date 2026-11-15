import { z } from 'zod';
import type { ItemData } from '../../domain.ts';
import { fittedSummary, fittedTitle } from '../../fitted.ts';
import { grounding, type Grounding } from '../../grounding.ts';
import { CHECKS, type ComponentId, type PropsOf } from '../../views.ts';
import { asColour } from './colours.ts';
import { clip, squash, tidyTags, TITLE_MAX, type Described } from './plain.ts';

export { fittedSummary, fittedTitle };

type Shape = Record<string, z.ZodType>;
type Reply<S extends Shape> = { [K in keyof S]: z.infer<S[K]> };

interface Field<S extends Shape> {
  /** The reply keys the model fills. Flat, every key required, empty meaning absent: the model API rejects recursive schemas and optional keys. */
  reply: S;
  /** The `item.data` keys this field writes, or nothing when the reply leaves it empty or the text does not state it. */
  keep(reply: Reply<S>, text: Grounding): ItemData | undefined;
}

const field = <S extends Shape>(f: Field<S>): Field<S> => f;

/** Each entry once, whatever its case, in the order given. */
function distinct(entries: string[]): string[] {
  const seen = new Set<string>();
  return entries.map(squash).filter((entry) => entry && !seen.has(entry.toLowerCase()) && seen.add(entry.toLowerCase()));
}

/** The props a card is drawn with from these, when they show the whole text as `CHECKS` frames them, or nothing. */
const framed = <C extends ComponentId>(component: C, props: PropsOf<C>, text: Grounding): PropsOf<C> | undefined =>
  (CHECKS[component].frame as unknown as (props: PropsOf<C>, text: Grounding) => PropsOf<C> | undefined)(props, text);

/** Two strings that mean something only together, such as a question and its answer, kept when the card they make shows the whole text. */
const pair = <A extends string, B extends string>(first: A, second: B, stands: (a: string, b: string, text: Grounding) => boolean) =>
  field({
    reply: { [first]: z.string(), [second]: z.string() } as Record<A | B, z.ZodString>,
    keep(r, text) {
      const [a, b] = [squash(r[first]), (r[second] as string).trim()];
      return a && b && stands(a, b, text) ? { [first]: a, [second]: b } : undefined;
    },
  });

const MAX_COLUMNS = 8;
const MAX_ROWS = 40;
const MAX_ITEMS = 30;
/** The most figures a facts card shows, and so the most a text may have to be one. */
const MAX_FACTS = 6;

/**
 * Every piece of structure Intake extracts. The reply schema and `structure()` are both built from this table. A piece that a card
 * draws is kept only when that card shows the whole text, every line in order and every mark as written, as the Renderer will hold it.
 */
const EXTRACTED = [
  field({
    reply: { steps: z.array(z.string()) },
    keep(r, text) {
      const steps = r.steps.map(squash).filter(Boolean).slice(0, 12);
      return steps.length >= 2 && framed('steps', { steps }, text) ? { steps } : undefined;
    },
  }),
  field({
    reply: { facts: z.array(z.object({ label: z.string(), value: z.string() })) },
    keep(r, text) {
      const facts = r.facts.map((f) => ({ label: squash(f.label), value: squash(f.value) })).filter((f) => f.label && f.value && text.says(f.value));
      if (facts.length === 0 || facts.length > MAX_FACTS) return undefined;
      const card = facts.length === 1 ? framed('fact', facts[0]!, text) : framed('facts', { facts }, text);
      return card ? { facts } : undefined;
    },
  }),
  field({
    reply: { quoteText: z.string(), quoteBy: z.string() },
    keep(r, text) {
      const [quote, by] = [r.quoteText.trim(), r.quoteBy.trim()];
      // A speaker the text does not write where the card would show it is left out, and the words must then be the whole text.
      const card = quote ? framed('quote', { text: quote, ...(by && { by }) }, text) : undefined;
      return card ? { quote: { text: card.text, ...(card.by && { by: card.by }) } } : undefined;
    },
  }),
  field({
    reply: { chartLabels: z.array(z.string()), chartValues: z.array(z.number()), chartUnit: z.string() },
    keep(r, text) {
      const [labels, values, unit] = [r.chartLabels.map(squash), r.chartValues, r.chartUnit.trim()];
      if (labels.length < 2 || labels.length !== values.length || !framed('chart', { chart: 'bar', labels, values, ...(unit && { unit }) }, text)) return undefined;
      return { chart: { labels, values, ...(unit ? { unit } : {}) } };
    },
  }),
  field({
    reply: { personName: z.string(), personRole: z.string() },
    keep(r, text) {
      const [name, role] = [r.personName.trim(), r.personRole.trim()];
      // A role is whole words of the text, a line or a sentence of it, and never a name for it the model gave.
      return name && text.says(name) ? { person: { name, ...(role && text.units(role) !== undefined ? { role } : {}) } } : undefined;
    },
  }),
  field({
    reply: { when: z.string() },
    keep(r, text) {
      const when = r.when.trim();
      return when && text.says(when) ? { when } : undefined;
    },
  }),
  field({
    reply: { where: z.string() },
    keep(r, text) {
      const where = squash(r.where);
      return where && text.says(where) ? { where } : undefined;
    },
  }),
  field({
    reply: { people: z.array(z.string()) },
    keep(r, text) {
      const people = distinct(r.people).filter((name) => text.says(name)).slice(0, 12);
      return people.length > 0 ? { people } : undefined;
    },
  }),
  field({
    reply: { pros: z.array(z.string()), cons: z.array(z.string()) },
    keep(r, text) {
      const [pros, cons] = [distinct(r.pros).slice(0, 12), distinct(r.cons).slice(0, 12)];
      // Each side stands under the item's own heading or label for it, which the card draws over it.
      return pros.length > 0 && cons.length > 0 && framed('proscons', { pros, cons } as PropsOf<'proscons'>, text) ? { pros, cons } : undefined;
    },
  }),
  field({
    // A row is one string with its cells separated by "|", so the schema nests no deeper than a list of strings.
    reply: { tableHeads: z.array(z.string()), tableRows: z.array(z.string()) },
    keep(r, text) {
      const heads = r.tableHeads.map(squash);
      if (heads.length < 2 || heads.length > MAX_COLUMNS) return undefined;
      const rows = r.tableRows
        .map((row) => {
          // A leading "|" with no trailing one, or the reverse, may be an empty cell, so the two are only taken off together.
          const fenced = /^\s*\|.*\|\s*$/s.test(row) ? row.trim().slice(1, -1) : row;
          // A dash the text does not write is the model's way of showing an empty cell.
          return fenced.split('|').map((cell) => (/^\s*[-–—]\s*$/.test(cell) && !text.says(cell) ? '' : squash(cell)));
        })
        // A divider and a row that repeats the heads are no rows.
        .filter((cells) => !cells.every((cell) => /^[-:\s]*$/.test(cell)) && !cells.every((cell, n) => cell.toLowerCase() === heads[n]?.toLowerCase()))
        .slice(0, MAX_ROWS);
      return rows.length > 0 && rows.every((cells) => cells.length === heads.length) && framed('table', { heads, rows }, text) ? { table: { heads, rows } } : undefined;
    },
  }),
  pair('question', 'answer', (question, answer, text) => framed('qa', { question, answer }, text) !== undefined),
  pair('term', 'definition', (term, definition, text) => text.says(term) && framed('definition', { term, definition }, text) !== undefined),
  field({
    reply: { items: z.array(z.string()), checklist: z.array(z.boolean()) },
    keep(r, text) {
      const items = distinct(r.items).slice(0, MAX_ITEMS);
      if (items.length < 2) return undefined;
      // A mark is the check box on the item's own line, whatever the model says of it. A tick or a cross the line writes is a word of the item.
      const shown = text.shows([{ pieces: items.map((item) => ({ text: item, entry: true })) }]);
      if (!shown) return undefined;
      if (shown.boxes.every((box) => box === undefined)) return { items };
      return shown.boxes.every((box) => box !== undefined) ? { items, checklist: shown.boxes as boolean[] } : undefined;
    },
  }),
  field({
    reply: { colours: z.array(z.object({ name: z.string(), value: z.string() })) },
    keep(r, text) {
      const colours = new Map<string, { name: string; value: string }>();
      for (const colour of r.colours) {
        const value = asColour(colour.value);
        if (!value || !(value.startsWith('#') ? text.paints(value) : text.says(colour.value)) || colours.has(value.toLowerCase())) continue;
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
      const where = at && text.says(at) ? { at } : {};
      return passage && framed('excerpt', { text: passage, ...where }, text) ? { excerpt: { text: passage, ...where } } : undefined;
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
- title: about 26 characters in English or 18 in Chinese, so it stands whole on the two lines a small card gives a title; specific to this content, no trailing period.
- summary: one short sentence saying what it is, about 30 to 45 characters in English or 22 to 33 in Chinese, so it stands whole under the title on a small card. Never end it with an ellipsis.
- tags: 2 to 6 short lowercase topic words.
Write in the language of the content.

The remaining fields hold structure a card can draw. Fill one only when the content itself states it, and leave it empty (an empty string or an empty list) otherwise. Never invent structure.

They are checked against the content. Copy its own words and numbers into them: a value that is not written in the content is thrown away. A card that draws one of these shows the whole content, so a structure is kept only when it is all of it: every step, entry, point, figure or row the content holds, in the content's order, each a whole sentence or line copied word for word with every mark it writes, such as ✗, ✓, ▼, a minus sign or brackets. Never leave a line out and never cut one. The content's headings and labels, and a sentence or two that open it before its structure, are drawn above the structure and need not be copied into a field.
- steps: the ordered steps, when the content is a procedure or a sequence.
- facts: label and value pairs, when the content is two to six figures or attributes and nothing more, one to a line or a row. Each label is what its line or row writes before the value, and each value what it writes after: add no word of your own.
- quoteText and quoteBy: when the content is a quotation, its words word for word with their punctuation, and in quoteBy the content's own words that say who said it, as they are written, or nothing. Never name a speaker the content does not write.
- chartLabels, chartValues, chartUnit: a numeric series the content states, one value per label. Each value is a number the content writes, and each label the words the content writes beside it.
- personName and personRole: when the content is about one named person, the name as written, and in personRole a whole line or sentence of the content that says who they are, or nothing.
- when: a date or time the content is about, as written.
- where: the place the content is about, as written.
- people: every person the content names.
- pros and cons: the points for and the points against, when the content weighs a choice and gives each side its own heading or label, such as "Pros:" and "Cons:".
- tableHeads and tableRows: a table the content holds. tableHeads has the column heads. Each entry of tableRows is one row, with its cells in column order separated by " | ". Leave out the heads row and any divider line of dashes.
- question and answer: when the content asks one question and answers it. The answer is everything the content says after the question.
- term and definition: when the content defines one term. The definition is the whole content, the term included.
- items and checklist: a list in no particular order, every line of it, with any tick or cross the line writes. Leave checklist empty unless each line opens with a check box, as "[ ]" or "[x]". Then give true or false for each item, in the same order. A tick or a cross written on a line is a word of it, and no check box.
- colours: each colour the content presents as a colour (a palette entry, a swatch, the colour of something), as a hex value or a plain colour name, with the name the content calls it, or an empty name. A colour word used for something else, such as the fruit in "an orange", is not a colour.
- excerptText and excerptAt: when the content is one passage of a longer source, the passage word for word with its punctuation, and where it sits as the source itself says (a heading, a chapter, a page).`;

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

For an image or a video, the content the fields are checked against is your own description and the file name. A place, a name, a number or any other value you put in a field must be written in your description in the same words, or it is thrown away.

${FIELDS}`;

export const CHAT_SYSTEM = `You are the intake clerk of a brainstorming app. The user has brought in a conversation they had with an AI assistant, and you record what came out of it.

You are given the conversation. Long messages are shortened and the middle of a long conversation may be left out.

Return:
- title: about 26 characters in English or 18 in Chinese, naming what the conversation was about, so it stands whole on the two lines a small card gives a title. No trailing period.
- summary: one short sentence on what was worked out or decided, about 30 to 45 characters in English or 22 to 33 in Chinese, so it stands whole under the title on a small card. Never end it with an ellipsis.
- tags: 2 to 6 short lowercase topic words.
- takeaways: up to 5 ideas, conclusions or decisions from the conversation that are worth keeping on their own. Each has a title of about 26 characters in English or 18 in Chinese and a text of one to three sentences that makes sense without the conversation. Return fewer, or none, when the conversation holds fewer.
Write in the language of the conversation.`;

/** The parts of the model's description worth keeping as drawable data: those that `source`, the text the model described, states. */
export function structure(d: Description, source: string): ItemData {
  // The card that draws a piece draws the item's title too, which the model gave, so a line that is the title is no part of the text it shows.
  const text = grounding(source, { title: clip(squash(d.title), TITLE_MAX) });
  const data: ItemData = {};
  for (const extracted of EXTRACTED) Object.assign(data, (extracted as Field<Shape>).keep(d, text));
  return data;
}

/**
 * The model's title, summary and tags, with `plain` standing in for anything it left empty. The model's title is held to a small
 * face's two lines; `plain`'s, a file's name or the item's own first line, is kept whole. The summary is as a note's face holds it.
 */
export function labels(d: Described, plain: Described): Described {
  const title = squash(d.title) ? fittedTitle(clip(squash(d.title), TITLE_MAX)) : plain.title;
  return { title, summary: fittedSummary(squash(d.summary) || plain.summary, title), tags: tidyTags(d.tags, plain.tags) };
}
