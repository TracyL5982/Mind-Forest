import { z } from 'zod';
import type { Command, Group, Id, Item, Node, View } from '../domain.ts';
import { parse } from '../formula.ts';
import { grounding, type Grounding, type Way } from '../grounding.ts';
import { cardsOf, collapse, JOINS, KINDS, LIMITS, parseFlat, ROLES, type Box, type Part as LayoutPart } from '../layout.ts';
import { fittedTitle } from '../fitted.ts';
import { fit } from '../map.ts';
import { Unreadable, type LatLon } from '../ports.ts';
import { CHECKS, isValidGroup, isValidView, misses, POINT, recording, ROOM, roomOf, SECTION, siteOf, type Check, type ComponentId, type CompositeId, type PropsOf, type Section, type Stated } from '../views.ts';
import type { RoleContext, Roles } from './types.ts';

const ROLE = 'renderer';

type Props = Record<string, unknown>;
interface Draw {
  component: ComponentId;
  props: Props;
}
interface GroupDraft {
  composite: CompositeId;
  title: string;
  members: Id[];
  props: Props;
}
/** The siblings of one status under one parent. A composite never reaches outside its pool. */
interface Pool {
  parent: Node;
  nodes: Node[];
  standing: Group[];
  /** Members of a group that stands or was just made. */
  taken: Set<Id>;
  /** The ungrouped siblings the model was shown. */
  asked: Id[];
}

const TEXT_SENT = 1200;
const EXCERPT = 280;
const CAPTION = 140;
/**
 * The least a text must say for the model to be asked about it, in characters. A script written without spaces says in 16 characters
 * about what a spaced one says in 40.
 */
const AMBIGUOUS_FROM = { spaced: 40, spaceless: 16 };
const MAX_ASKED_ITEMS = 24;
/**
 * The most items one call asks about. Measured live, a call for 12 long samples took up to 70 seconds against the model client's
 * limit of 120, and one run lost a call to three timeouts in a row.
 */
const ASKED_PER_CALL = 8;
const MAX_ASKED_POOLS = 8;
const MAX_ASKED_SIBLINGS = 12;
const STACK_ABOVE = 9;
const STACK_KEEPS = 6;
const FACTS_SHOWN = 6;
/** The longest value a fact card sets as a figure. A longer one is a sentence, and is left to the item's other rows. */
const FACT_VALUE_MOST = 60;
/** The cards that lead with a picture, which a gallery sets side by side. */
const PICTURE_LED = new Set(['image', 'video', 'artwork']);

// ---- reply schemas. Structured output wants every key present, so an empty string or list means "none".

/** The cards that can be built from an item's own words, which the model chooses among. */
export const CHOSEN = [
  'note', 'idea', 'quote', 'fact', 'facts', 'steps', 'list', 'chart', 'breakdown', 'table', 'qa', 'definition', 'proscons', 'callout', 'excerpt', 'sheet', 'explorable',
] as const satisfies readonly ComponentId[];
export type Chosen = (typeof CHOSEN)[number];

const SECTION_KINDS = ['heading', 'text', 'figures', 'list', 'table', 'picture', 'excerpt'] as const satisfies readonly Section['kind'][];

/**
 * One entry for each item, in a few slots that every card shares, so a new card adds a row to `BUILT` and no key here.
 * `subject` is a term, a question or what a value measures. `passage` is words of the item: a quotation, an answer, a meaning, a value.
 * Neither is named after a part of an item, because the model copied every item's title and whole text into slots called `title` and `body`.
 * `lines` are steps, list entries, "label | value" pairs, or table rows with "|" between their cells and the heads row first.
 * `controls` and `formula` are an explorable's: its controls, each slider with the values the item states for it, and the formula they drive.
 */
export const ComponentsReply = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      component: z.enum(CHOSEN),
      subject: z.string(),
      passage: z.string(),
      by: z.string(),
      tone: z.string(),
      lines: z.array(z.string()),
      labels: z.array(z.string()),
      numbers: z.array(z.number()),
      left: z.array(z.string()),
      right: z.array(z.string()),
      unit: z.string(),
      emphasis: z.string(),
      sections: z.array(z.object({ kind: z.enum(SECTION_KINDS), text: z.string(), by: z.string(), lines: z.array(z.string()) })),
      controls: z.array(
        z.object({
          kind: z.enum(['toggle', 'segmented', 'slider']),
          label: z.string(),
          states: z.array(z.string()),
          texts: z.array(z.string()),
          name: z.string(),
          unit: z.string(),
          min: z.number(),
          max: z.number(),
          values: z.array(z.number()),
        }),
      ),
      formula: z.string(),
    }),
  ),
});
export type ComponentsReply = z.infer<typeof ComponentsReply>;

/** The arrangements the model may propose. */
const ASKED = ['timeline', 'comparison', 'sequence', 'cluster', 'ranked', 'beforeafter', 'lead', 'matrix', 'layout'] as const satisfies readonly CompositeId[];

export const CompositesReply = z.object({
  groups: z.array(
    z.object({
      parent: z.string(),
      composite: z.enum(ASKED),
      title: z.string(),
      members: z.array(z.string()),
      labels: z.array(z.string()),
      criteria: z.array(z.string()),
      cells: z.array(z.object({ member: z.string(), values: z.array(z.string()) })),
      theme: z.string(),
      reasons: z.array(z.string()),
      changes: z.array(z.string()),
      axes: z.array(z.string()),
      parts: z.array(z.object({ id: z.string(), parent: z.string(), kind: z.enum(['card', ...KINDS]), role: z.enum(ROLES), label: z.string(), join: z.enum(['none', ...JOINS]) })),
    }),
  ),
});
export type CompositesReply = z.infer<typeof CompositesReply>;

// ---- what an item's data may hold. Content roles fill it, so it is parsed, not trusted.

const Label = z.union([z.string(), z.number()]).transform(String);
const ChartData = z.object({ labels: z.array(Label), values: z.array(z.number()), unit: z.string().optional() });
const StepsData = z.array(z.string());
const QuoteData = z.object({ text: z.string().min(1), by: z.string().optional() });
const PersonData = z.object({ name: z.string().min(1), role: z.string().optional(), image: z.string().optional() });
const CodeData = z.object({ language: z.string().optional(), source: z.string().optional() });
const FactsData = z.array(z.object({ label: z.string().min(1), value: Label }));
const MessagesData = z.array(z.object({ role: z.string(), text: z.string() }));
const TableData = z.object({ heads: z.array(z.string()), rows: z.array(z.array(z.string())) });
const ColoursData = z.array(z.object({ name: z.string(), value: z.string().min(1) }));
const ExcerptData = z.object({ text: z.string().min(1), at: z.string().optional() });
const MarksData = z.array(z.boolean());
const AtData = z.object(POINT.shape);

function read<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  if (value === undefined) return undefined;
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// ---- text

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function compact(props: Props): Props {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined && v !== ''));
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([x], [y]) => (x < y ? -1 : 1)))
      : v,
  );
}

function timeOf(label: string): number | null {
  const s = label.trim();
  const year = /^(\d{4})s?$/.exec(s);
  if (year) return Date.UTC(Number(year[1]), 0);
  // Without a four-digit year, Date.parse reads a bare "12" as a month.
  if (!/\b\d{4}\b/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function inTimeOrder(labels: string[]): boolean {
  const times = labels.map(timeOf);
  return times.every((t, i) => t !== null && (i === 0 || t > times[i - 1]!));
}

/** The `data` keys that hold an address, at any depth. An address is the item's own, and holds no words to check a claim against. */
const ADDRESSES = new Set(['image', 'mediaUrl', 'thumbnailUrl', 'embed', 'url', 'src']);

/** Every string and number a value holds, at any depth, with or without the addresses. */
function held(value: unknown, addresses: boolean, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number') out.push(String(value));
  else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) if (addresses || !ADDRESSES.has(key)) held(inner, addresses, out);
  return out;
}

/** What a view of one item is checked against. */
interface Content {
  /**
   * The item's words, which are its title and its text, and each value of its data that is no address. The title is a paragraph of its own
   * and a data value a list item, so no claim runs from one into the next. The summary is left out: a model wrote it.
   */
  text: Grounding;
  /** The value is one the item holds outside its words, whole or cut short with an ellipsis. */
  own(value: string): boolean;
}

/** `wordsOnly` leaves the data out, for a check that reads nothing but how the item's words stand together. */
function contentOf(item: Item, assetUrl: (id: string) => string, wordsOnly = false): Content {
  const { url, asset, from } = item.source;
  let owned: string[] | undefined;
  return {
    text: grounding(item.text, { title: item.title, held: wordsOnly ? [] : held(item.data, false) }),
    own(value) {
      const whole = value.trim();
      const cut = whole.endsWith('…') ? whole.slice(0, -1).trimEnd() : '';
      owned ??= [item.text, item.summary, url, url && siteOf(url), asset && assetUrl(asset), from.replace(/^chat-export:/, ''), ...held(item.data, true)].flatMap((value) => value?.trim() || []);
      return owned.some((one) => one === whole || (cut !== '' && one.startsWith(cut)));
    },
  };
}

// ---- components by rule

interface Asked {
  assetUrl: (id: string) => string;
}
interface Row {
  component: ComponentId;
  when(item: Item, asked: Asked): boolean;
  props(item: Item, asked: Asked): Props;
}
/**
 * A row of the rule table, with what it reads: `catalogue` is what the Scout copied from a source's record, `kind` the item's own kind,
 * `structure` what Intake extracted from the content, and `text` the item's own words.
 */
type Rule = Row & { reads: 'catalogue' | 'kind' | 'structure' | 'text' };

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);

/** One written form, with each run of white space as one space. */
const uniform = (text: string): string => text.normalize('NFKC').replace(/\s+/g, ' ').trim();

/** How many characters a text has in that form. */
const sizeOf = (text: string): number => {
  const written = uniform(text);
  let size = written.length;
  // A character outside the basic plane takes two code units and is one character.
  for (let at = 0; at < written.length; at++) if (written.charCodeAt(at) >= 0xd800 && written.charCodeAt(at) <= 0xdbff) size--;
  return size;
};

function chartProps(labels: string[], values: number[], unit?: string): Props {
  return compact({ chart: inTimeOrder(labels) ? 'line' : 'bar', labels, values, unit });
}

/** A unit stands when the text states it in words, or writes it against one of the values it measures: "%" in "45%", "万" in "2189万". */
const unitStands = (unit: string, values: unknown, text: Grounding): boolean =>
  text.says(unit) || (Array.isArray(values) && values.some((value) => typeof value === 'number' && text.measures(value, unit)));

const VALUE_FIRST =
  /^((?:[$€£¥]\d[\d,.]*(?:k|m|b|bn)?(?: (?:thousand|million|billion))?)|(?:\d[\d,.]*(?:%|x|k|m|b|bn))|(?:\d[\d,.]* (?:percent|thousand|million|billion)))\s+(\S.{1,60})$/i;
const LABEL_FIRST = /^([^:=\n]{2,60})[:=]\s*([$€£¥]?\d[\d,.]*\s?[%\w/°]{0,12})$/;
/** A clock time or a calendar date, which is no figure: "3pm", "15 March", "3/15/2024". */
const TIME_OR_DATE = /^\d{1,2}\s?(?:[ap]\.?m\.?|(?:st|nd|rd|th)?\s?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)$|^\d{1,4}\/\d{1,2}\/\d{1,4}$/i;

function factInText(item: Item): { value: string; label: string } | undefined {
  if (item.kind !== 'text') return undefined;
  const text = (item.text.trim() || item.title).trim();
  if (text.length > 80 || text.includes('\n')) return undefined;
  const valueFirst = VALUE_FIRST.exec(text);
  // "42% of users leave" labels its value "of users leave": the rest of the line, as the card shows the whole item.
  if (valueFirst) return { value: valueFirst[1]!, label: valueFirst[2]!.replace(/[.\s]+$/, '') };
  const labelFirst = LABEL_FIRST.exec(text);
  if (!labelFirst) return undefined;
  const [label, value] = [labelFirst[1]!.trim(), labelFirst[2]!.trim()];
  // A label that ends in a digit is the first half of a time or a date the colon split, as in "Flight home at 10:45".
  return /\d$/.test(label) || TIME_OR_DATE.test(value) ? undefined : { value, label };
}

function excerpt(messages: { role: string; text: string }[]): { role: string; text: string }[] {
  const spoken = messages.filter((m) => m.text.trim() && m.role !== 'system');
  const fromUser = (m: { role: string }) => /^(user|human)$/i.test(m.role);
  const firstUser = spoken.findIndex(fromUser);
  let best = -1;
  spoken.forEach((m, i) => {
    if (!fromUser(m) && (best < 0 || m.text.length > spoken[best]!.text.length)) best = i;
  });
  const chosen = new Set<number>();
  if (firstUser >= 0) chosen.add(firstUser);
  if (best >= 0) {
    // The question that drew the best reply, when it is not the opening one.
    if (best > 0 && fromUser(spoken[best - 1]!)) chosen.add(best - 1);
    chosen.add(best);
  }
  return [...chosen]
    .sort((a, b) => a - b)
    .slice(0, 4)
    .map((i) => ({ role: spoken[i]!.role, text: clip(spoken[i]!.text, EXCERPT) }));
}

// ---- what each rule reads off an item, or undefined when the item does not hold it

function chartOf(item: Item) {
  const chart = read(ChartData, item.data.chart);
  return chart && chart.labels.length >= 2 && chart.labels.length === chart.values.length ? chart : undefined;
}

function stepsOf(item: Item) {
  const steps = read(StepsData, item.data.steps)?.filter((s) => s.trim());
  return steps && steps.length >= 2 ? steps : undefined;
}

function codeOf(item: Item) {
  const code = read(CodeData, item.data.code);
  const source = code?.source || (item.kind === 'code' ? item.text : '');
  return source ? { language: code?.language || 'text', source } : undefined;
}

/** The facts that have both a label and a value. */
const factsIn = (item: Item) => read(FactsData, item.data.facts)?.filter((fact) => fact.label.trim() && fact.value.trim()) ?? [];

const isFigure = (fact: { value: string }): boolean => sizeOf(fact.value) <= FACT_VALUE_MOST;

function factOf(item: Item) {
  const facts = factsIn(item);
  const fact = facts.length === 1 ? { value: facts[0]!.value, label: facts[0]!.label } : factInText(item);
  return fact && isFigure(fact) ? fact : undefined;
}

function factsOf(item: Item) {
  const facts = factsIn(item);
  return facts.length > 1 && facts.every(isFigure) ? facts : undefined;
}

/** Where a picture or a recording plays from. A stored asset outlives a social network's media address, which expires. */
function mediaOf(item: Item, kind: 'image' | 'video', { assetUrl }: Asked): string | undefined {
  if (item.kind !== kind) return undefined;
  return (item.source.asset ? assetUrl(item.source.asset) : (str(item.data.mediaUrl) ?? item.source.url)) || undefined;
}

const PERCENT = new Set(['%', '％', 'percent', 'pct', '百分比']);

/** A chart whose values are shares of one whole: a percent unit, and a sum of about a hundred. */
function breakdownOf(item: Item) {
  const chart = chartOf(item);
  if (!chart || chart.values.length > 8 || !PERCENT.has(chart.unit?.trim().toLowerCase() ?? '') || chart.values.some((v) => v < 0)) return undefined;
  const sum = chart.values.reduce((a, b) => a + b, 0);
  return sum >= 99 && sum <= 101 ? chart : undefined;
}

function tableOf(item: Item) {
  const table = read(TableData, item.data.table);
  return table && table.rows.length > 0 ? table : undefined;
}

/** The entries of a list of strings that say something. */
const entriesOf = (value: unknown) => read(StepsData, value)?.filter((entry) => entry.trim()) ?? [];

function sidesOf(item: Item) {
  const [pros, cons] = [entriesOf(item.data.pros), entriesOf(item.data.cons)];
  return pros.length > 0 && cons.length > 0 ? { pros, cons } : undefined;
}

/** Two strings the data holds only together, under the names the card gives them. */
const pairOf = <A extends string, B extends string>(first: A, second: B) => (item: Item) => {
  const [a, b] = [str(item.data[first]), str(item.data[second])];
  return a !== undefined && b !== undefined ? ({ [first]: a, [second]: b } as Record<A | B, string>) : undefined;
};

function listOf(item: Item) {
  const items = read(StepsData, item.data.items);
  if (!items || items.length < 2 || items.some((entry) => !entry.trim())) return undefined;
  const checked = read(MarksData, item.data.checklist);
  return { items, checked: checked?.length === items.length ? checked : undefined };
}

function coloursOf(item: Item) {
  const colours = read(ColoursData, item.data.colours);
  return colours && colours.length >= 2 ? colours : undefined;
}

/** The still picture an item has: itself when it is one, a recording's poster, a page's own picture. */
function pictureOf(item: Item, asked: Asked): string | undefined {
  if (item.kind === 'image') return mediaOf(item, 'image', asked);
  return str(item.kind === 'video' ? item.data.thumbnailUrl : item.data.image);
}

const referenceKind = (item: Item) => (item.data.kind === 'paper' || item.data.kind === 'book' ? item.data.kind : undefined);

/** A place name as it is compared: one written form and one case, without the region after its last comma. */
const placeName = (name: string): string => uniform(name).toLowerCase().replace(/\s*,[^,]*$/, '');

/** A note longer than this is read as a note, and its place is a chip on it. */
const PLACE_TEXT_BELOW = 280;
/** The longest region written in front of a place, as 杭州 is in 杭州西湖, and the shortest: one character in front makes another name, as 东 does of 京都. */
const REGION = { min: 2, max: 6 };
/** What a name takes at its end to say which kind of district it is: 北京 and 北京市 are one place. */
const DISTRICT = /^[市区县省都镇乡村州府道町시도구]$/u;
const SPACELESS_ONLY = /^[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]+$/u;

/**
 * Whether a title names a place. The two are equal, or, in a script written without spaces, where a region stands in front of
 * a place with no comma, the title is the place after its region, or one is the other with its kind of district at the end.
 */
function namesPlace(title: string, place: string): boolean {
  if (title === place) return true;
  const [named, sought] = [[...title], [...place]];
  if (Math.min(named.length, sought.length) < 2 || !SPACELESS_ONLY.test(title) || !SPACELESS_ONLY.test(place)) return false;
  const region = named.length - sought.length;
  if (title.endsWith(place) && region >= REGION.min && region <= REGION.max) return true;
  const [short, long] = region > 0 ? [place, title] : [title, place];
  return Math.abs(region) === 1 && long.startsWith(short) && DISTRICT.test(long.slice(short.length));
}

/** The place a short note is, when its title is that place's name and nothing more. */
function placeOf(item: Item): string | undefined {
  const where = str(item.data.where)?.trim();
  if (item.kind !== 'text' || !where || !item.title.trim() || sizeOf(item.text) >= PLACE_TEXT_BELOW) return undefined;
  return namesPlace(placeName(item.title), placeName(where)) ? where : undefined;
}

/**
 * An idea is shorter than this, in characters. A rule cannot tell a thought from a caution or a definition, and in a script written
 * without spaces 24 characters are already room for either, so there the rule stops at 24 and the model may call a text up to 60 an idea.
 */
const IDEA_BELOW = { spaced: 60, spaceless: 24 };
const IDEA_WORDS = 3;
/** In a script written without spaces a word cannot be counted, so the thought is measured in characters. */
const IDEA_CHARACTERS = 6;
const SPACELESS = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]/u;
const ADDRESS = /^(?:[a-z][a-z\d+.-]*:\/\/)?(?:[^\s/.]+\.)+[^\s/.\d]{2,}(?:[/?#]\S*)?$/iu;

/** A phrase as it is compared: one written form and one case, with no white space and no punctuation at its end. */
const phraseKey = (phrase: string): string => uniform(phrase).toLowerCase().replace(/\s+/g, '').replace(/\p{P}+$/u, '');

/**
 * A thought the user wrote out as a phrase, and not a label: a chore, a name, a room number, an address.
 * `chosen` is for a text the model called an idea, which may be as long in a script without spaces as in one with.
 */
function isIdea(item: Item, chosen = false): boolean {
  const [title, text] = [uniform(item.title), uniform(item.text)];
  const phrase = text || title;
  if (item.kind !== 'text' || item.origin.by !== 'user' || phrase === '' || (title !== '' && text !== '' && phraseKey(title) !== phraseKey(text))) return false;
  const spaceless = SPACELESS.test(phrase);
  if ([...phrase].length >= (spaceless && !chosen ? IDEA_BELOW.spaceless : IDEA_BELOW.spaced) || /\p{Nd}/u.test(phrase) || ADDRESS.test(phrase.replace(/\p{P}+$/u, ''))) return false;
  if (spaceless) return (phrase.match(/\p{L}/gu)?.length ?? 0) >= IDEA_CHARACTERS;
  return phrase.split(' ').filter((word) => /\p{L}/u.test(word)).length >= IDEA_WORDS;
}

const byAgent = (item: Item) => item.origin.by === 'agent';

/**
 * The passage of a page the Scout picked: the text of a pick that has an address and is no picture, when it holds more than
 * the line that says who made the page and when.
 */
function passageOf(item: Item): string | undefined {
  if (item.kind !== 'text' || !byAgent(item) || !item.source.url) return undefined;
  const label = [...new Set([item.data.by, item.data.date, item.data.from].flatMap((part) => str(part) ?? []))].join(', ');
  const text = item.text.trim();
  return text && uniform(text) !== uniform(label) ? text : undefined;
}

const captionOf = (item: Item) => (item.summary.trim() && item.summary.trim().length <= CAPTION ? item.summary.trim() : undefined);

const spokenOf = (item: Item) => (item.kind === 'chat' ? excerpt(read(MessagesData, item.data.messages) ?? []) : []);

/** A row that draws one piece of structure Intake extracted: it holds when the item has the piece, and its props are made from the piece. */
function extracted<T>(component: ComponentId, of: (item: Item) => T | undefined, props: (piece: T, item: Item) => Props): Rule {
  return { component, reads: 'structure', when: (item) => of(item) !== undefined, props: (item) => props(of(item)!, item) };
}

/**
 * The row for the same piece when a source's record carried it. Such a piece is the record and no guess, and the item's words are no
 * more than a line about it, so the card is not held to them: a dataset's chart draws however its words describe it.
 */
const carried = (rule: Rule): Rule => ({ component: rule.component, reads: 'catalogue', when: (item, asked) => byAgent(item) && rule.when(item, asked), props: rule.props });

/**
 * First match wins. What a source catalogued comes first, because it is a record and no guess. A picture, a recording or a piece of code
 * stays one, whatever was read off it. Then the structure Intake extracted, the most particular shape first, and then the item's kind and its own words.
 */
const RULES: Rule[] = [
  {
    component: 'artwork',
    reads: 'catalogue',
    when: (item, asked) => item.data.kind === 'artwork' && pictureOf(item, asked) !== undefined,
    props: (item, asked) =>
      compact({ src: pictureOf(item, asked), maker: str(item.data.by), date: str(item.data.date), medium: str(item.data.medium), holder: str(item.data.holder) }),
  },
  {
    component: 'reference',
    reads: 'catalogue',
    when: (item) => referenceKind(item) !== undefined,
    props: (item) => {
      const listed = entriesOf(item.data.authors);
      const by = str(item.data.by);
      return compact({
        kind: referenceKind(item),
        authors: listed.length > 0 ? listed : by ? [by] : [],
        more: listed.length > 0 && item.data.authorsCut === true ? true : undefined,
        year: /(?<!\d)\d{4}(?!\d)/.exec(str(item.data.date) ?? '')?.[0],
        venue: str(item.data.venue),
        url: item.source.url,
      });
    },
  },
  {
    component: 'image',
    reads: 'kind',
    when: (item, asked) => mediaOf(item, 'image', asked) !== undefined,
    props: (item, asked) => compact({ src: mediaOf(item, 'image', asked), caption: captionOf(item) }),
  },
  {
    component: 'video',
    reads: 'kind',
    when: (item, asked) => mediaOf(item, 'video', asked) !== undefined,
    props: (item, asked) => compact({ src: mediaOf(item, 'video', asked), poster: str(item.data.thumbnailUrl), caption: captionOf(item) }),
  },
  { component: 'audio', reads: 'kind', when: (item, { assetUrl }) => recording(item, assetUrl) !== undefined, props: (item, { assetUrl }) => recording(item, assetUrl)! },
  { component: 'code', reads: 'kind', when: (item) => codeOf(item) !== undefined, props: (item) => codeOf(item)! },
  ...[
    extracted('breakdown', breakdownOf, ({ labels, values, unit }) => ({ labels, values, unit })),
    extracted('chart', chartOf, ({ labels, values, unit }) => chartProps(labels, values, unit)),
  ].flatMap((rule) => [carried(rule), rule]),
  extracted('table', tableOf, (table) => table),
  extracted('proscons', sidesOf, (sides) => sides),
  extracted('qa', pairOf('question', 'answer'), (pair) => pair),
  extracted('definition', pairOf('term', 'definition'), (pair) => pair),
  extracted('steps', stepsOf, (steps) => ({ steps })),
  extracted('list', listOf, (list) => compact(list)),
  extracted('quote', (item) => read(QuoteData, item.data.quote), ({ text, by }) => compact({ text, by })),
  extracted('person', (item) => read(PersonData, item.data.person), ({ name, role, image }, item) => compact({ name, role, image: image ?? str(item.data.image) })),
  extracted('swatch', coloursOf, (colours) => ({ colours })),
  extracted(
    'facts',
    factsOf,
    (facts) => compact({ facts: facts.slice(0, FACTS_SHOWN), more: facts.length - FACTS_SHOWN > 0 ? facts.length - FACTS_SHOWN : undefined }),
  ),
  extracted('fact', factOf, (fact) => fact),
  {
    component: 'link',
    reads: 'kind',
    when: (item) => item.kind === 'link' && Boolean(item.source.url),
    props: (item) => {
      const url = item.source.url!;
      return compact({ url, site: str(item.data.site) ?? siteOf(url), description: item.summary.trim(), image: str(item.data.image) });
    },
  },
  extracted('excerpt', (item) => read(ExcerptData, item.data.excerpt), ({ text, at }, item) => compact({ text, at, source: str(item.data.site) ?? str(item.data.from) })),
  {
    component: 'excerpt',
    reads: 'catalogue',
    when: (item) => passageOf(item) !== undefined,
    props: (item) => compact({ text: passageOf(item), source: str(item.data.site) ?? str(item.data.from) }),
  },
  {
    component: 'place',
    reads: 'text',
    when: (item) => placeOf(item) !== undefined,
    props: (item, asked) => compact({ name: placeOf(item), src: pictureOf(item, asked) }),
  },
  {
    component: 'chat',
    reads: 'kind',
    when: (item) => spokenOf(item).length > 0,
    props: (item) => compact({ messages: spokenOf(item), source: item.source.from.replace(/^chat-export:/, '') }),
  },
  { component: 'idea', reads: 'text', when: (item) => isIdea(item), props: () => ({}) },
  { component: 'note', reads: 'text', when: () => true, props: () => ({}) },
];

/**
 * A conversation's data is its messages, so no rule that reads structure may take one. A recording is its sound, and the structure
 * read off its transcript is for its chips and for search, so one with nothing to play is a note.
 */
const RULES_OF: Partial<Record<Item['kind'], Rule[]>> = {
  chat: RULES.filter((rule) => rule.component === 'chat' || rule.component === 'note'),
  audio: RULES.filter((rule) => rule.component === 'audio' || rule.component === 'note'),
};

/**
 * The least share of an item's text that a card drawn from what Intake extracted must show when its words are no structure of the item's
 * own, as a palette's colours are: a small piece never stands in for a long item.
 */
const COVERAGE_FLOOR = 0.2;
/** The cards drawn from extracted structure that show a piece of their item and not the whole of it: a palette. */
const PIECES = new Set<string>(['swatch']);

/**
 * How much an item says, which such a piece is measured against. The model wrote the title of a text the user made, so the same lines
 * must not be a palette under a short title and a note under a long one: there the text alone counts.
 */
const wholeOf = (item: Item): number => (item.kind === 'text' && !byAgent(item) && item.text.trim() ? sizeOf(item.text) : sizeOf(item.title) + sizeOf(item.text));

/**
 * The first row that holds draws the item. A row that reads extracted structure holds only when its card shows the whole item, as its
 * frame reads it against the item's own words: the role that extracted the piece checked each value, and the card is held to how they
 * stand together. A card with no frame, which shows colours, holds when it shows at least `COVERAGE_FLOOR` of the item. A row that does
 * not hold leaves the item to the next.
 */
export function byRule(item: Item, assetUrl: (id: string) => string): Draw {
  const asked = { assetUrl };
  let content: Content | undefined;
  for (const rule of RULES_OF[item.kind] ?? RULES) {
    if (!rule.when(item, asked)) continue;
    let draw: Draw | undefined = { component: rule.component, props: rule.props(item, asked) };
    if (rule.reads === 'structure') {
      const result = checked(draw, (content ??= contentOf(item, assetUrl, true)), 'rule');
      draw = 'draw' in result ? result.draw : undefined;
      // The share is of what the card shows once its frame has read it.
      if (draw && PIECES.has(rule.component) && held(draw.props, false).reduce((sum, value) => sum + sizeOf(value), 0) < COVERAGE_FLOOR * wholeOf(item)) draw = undefined;
    }
    if (draw && isValidView(draw)) return draw;
  }
  return { component: 'note', props: {} };
}

// ---- components by model

const fails = (stands: boolean, why: Why = 'unstated'): Why | undefined => (stands ? undefined : why);

/**
 * How each kind of check reads one value, and why the value may not be shown when it fails. `beside` is the object the value sits in,
 * for a check that reads a value against its neighbours. A value the card's frame holds to the whole item needs no check of its own.
 */
const STANDS: Record<Stated, (value: unknown, content: Content, beside: Props) => Why | undefined> = {
  says: (value, { text }) => fails(typeof value === 'string' && text.says(value)),
  shown: () => undefined,
  line: (value, { text }) => fails(typeof value === 'string' && text.units(value) !== undefined, 'part'),
  writes: (value, { text }, { unit }) => fails(typeof value === 'number' && text.writes(value, typeof unit === 'string' ? unit : undefined)),
  unit: (value, { text }, { values }) => fails(typeof value === 'string' && unitStands(value, values, text)),
  paints: (value, { text }) => fails(typeof value === 'string' && (value.trim().startsWith('#') ? text.paints(value) : text.says(value))),
  own: (value, content) => fails((typeof value === 'string' || typeof value === 'number') && content.own(String(value))),
  choice: () => undefined,
  computes: () => undefined,
};

interface Leaf {
  value: unknown;
  /** How the value must stand, or nothing when no check describes it. */
  how: Stated | undefined;
  /** The object the value sits in. */
  beside: Props;
  path: string;
}

/** Each plain value a view's props hold, with the check that reads it. */
function* leaves(value: unknown, check: Check | undefined, beside: Props = {}, path = ''): Generator<Leaf> {
  if (Array.isArray(value)) {
    for (const [n, one] of value.entries()) yield* leaves(one, check, beside, `${path}[${n}]`);
    return;
  }
  if (check === undefined || typeof check === 'string' || typeof value !== 'object' || value === null) {
    yield { value, how: typeof check === 'string' ? check : undefined, beside, path };
    return;
  }
  let [fields, of] = [value as Props, check as { readonly [key: string]: Check }];
  if (typeof of.byKind === 'object') {
    const { kind, ...rest } = fields;
    [fields, of] = [rest, (of.byKind[String(kind)] as { readonly [key: string]: Check } | undefined) ?? {}];
  }
  for (const [key, inner] of Object.entries(fields)) yield* leaves(inner, of[key], fields, path ? `${path}.${key}` : key);
}

type Checks = { props: Check; also?: (props: never, item: Item, text: Grounding) => boolean; frame?: (props: never, text: Grounding) => Props | undefined };
const checksOf = (component: string) => CHECKS[component as ComponentId] as Checks;

/**
 * Why a card may not show a value.
 * - `unstated`: the content does not state it.
 * - `part`: it is no whole item: the card's words, in its order, leave out something its item says, add to it or move it, or a line it
 *   sets apart is no whole sentence, line or cell.
 * - `long`: it is longer than a card has room for. Only a card built from a model's reply is held to this.
 */
export type Why = 'unstated' | 'part' | 'long';
/** One value a card may not show, by its path in the props, or the card's words as a whole, by an empty path. */
export interface Fault {
  prop: string;
  why: Why;
}

/** A label longer than a figure's room, or a passage longer than a card's, which a model's card may not show. */
const tooLong = (path: string, value: string): boolean => value.trim().length > (/label$/.test(path) ? ROOM.label : roomOf(ROOM.passage, value));

/** Every value of a view that may not be shown. For a view built from a model's reply, each value it shows is held to its length too. */
function* faults(view: Draw, content: Content, by: 'model' | 'rule'): Generator<Fault> {
  for (const { value, how, beside, path } of leaves(view.props, checksOf(view.component).props)) {
    if (!how) yield { prop: path, why: 'unstated' };
    else if (by === 'model' && how === 'shown' && typeof value === 'string' && !path.startsWith('above') && tooLong(path, value)) yield { prop: path, why: 'long' };
    else {
      const why = STANDS[how](value, content, beside);
      if (why) yield { prop: path, why };
    }
  }
}

/**
 * The view as it is drawn when it shows its whole item, as its frame reads it, and every value stands; or the first fault when not.
 * `left` names what the frame left out: a speaker, a role or words set apart that the item does not write so.
 */
function checked(view: Draw, content: Content, by: 'model' | 'rule', whole = true): { draw: Draw; left: Fault[] } | { fault: Fault } {
  const frame = whole ? checksOf(view.component).frame : undefined;
  const props = frame ? frame(view.props as never, content.text) : view.props;
  if (!props) return { fault: { prop: '', why: 'part' } };
  const draw = { component: view.component, props };
  for (const fault of faults(draw, content, by)) return { fault };
  const left = Object.keys(view.props).filter((key) => !(key in props)).map((prop): Fault => ({ prop, why: 'part' }));
  return { draw, left };
}

/** A chart or a breakdown of the very series a source's record carried, which the item's words only describe. */
function recorded(view: Draw, item: Item): boolean {
  const chart = byAgent(item) ? read(ChartData, item.data.chart) : undefined;
  return (view.component === 'chart' || view.component === 'breakdown') && chart !== undefined && stable([chart.labels, chart.values]) === stable([view.props.labels, view.props.values]);
}

/** Whether everything the view shows really stands in its item: it is its whole item as it is, and each prop stands as `CHECKS` says it must. */
export function grounded(view: { component: string; props: unknown }, item: Item, assetUrl: (id: string) => string): boolean {
  if (!isValidView(view)) return false;
  const draw = view as Draw;
  const content = contentOf(item, assetUrl);
  const result = checked(draw, content, 'rule', !recorded(draw, item));
  return 'draw' in result && stable(result.draw.props) === stable(draw.props) && (checksOf(draw.component).also?.(draw.props as never, item, content.text) ?? true);
}

/** A text as it is compared with another: one written form and one case. */
const folded = (text: string): string => uniform(text).toLowerCase();

/** The entries without those that repeat an earlier one. */
function distinct<T>(entries: T[], key: (entry: T) => string = (entry) => folded(String(entry))): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(key(entry)) && seen.add(key(entry)));
}

/**
 * How much of its item a view shows, counted as a rule counts a structure: every value but a choice of how to draw and what the item
 * owns outside its words. A value shown twice is counted once.
 */
function sizeShown(view: Draw): number {
  const shown = new Set<string>();
  for (const { value, how } of leaves(view.props, checksOf(view.component).props)) if (how && how !== 'choice' && how !== 'own' && how !== 'computes') shown.add(folded(String(value)));
  let size = 0;
  for (const value of shown) size += sizeOf(value);
  return size;
}

export type Entry = ComponentsReply['items'][number];
type Part = Entry['sections'][number];

/** What building a card from a reply may read beside the reply. */
interface Reading {
  item: Item;
  asked: Asked;
  text: Grounding;
  /** The value when the content states it. A card is not refused for a speaker, a position or a unit the model added: it is drawn without. */
  kept(value: string): string | undefined;
}

const each = (lines: string[]): string[] => lines.map((line) => line.trim()).filter(Boolean);
const unquoted = (passage: string): string => passage.trim().replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '');

/** The cells of one row. A fence of "|" at both ends is taken off, as Intake takes it off. */
const cellsOf = (row: string): string[] => (/^\s*[|｜].*[|｜]\s*$/s.test(row) ? row.trim().slice(1, -1) : row).split(/[|｜]/).map((cell) => cell.trim());

/** The figures a reply wrote as "label | value" lines. A figure written twice is one figure. */
function pairsOf(lines: string[]): { label: string; value: string }[] {
  const pairs = each(lines).flatMap((line) => {
    const [label, ...value] = cellsOf(line);
    return value.length > 0 ? [{ label: label!, value: value.join(' ') }] : [];
  });
  return distinct(pairs, ({ label, value }) => `${folded(label)}|${folded(value)}`);
}

/** The table a reply wrote as lines of cells, the heads first. A row written twice is one row. */
function tableIn(lines: string[]): { heads: string[]; rows: string[][] } {
  const [heads = [], ...rows] = each(lines).map(cellsOf).filter((cells) => !cells.every((cell) => /^[-:\s]*$/.test(cell)));
  return { heads, rows: distinct(rows, (row) => row.map(folded).join('|')) };
}

/** The entries of a list a reply wrote one to a line. An entry written twice is one entry. */
const entriesIn = (lines: string[]): string[] => distinct(each(lines));

/** How each kind of section is built from its part of a reply, whole. A sheet shows its item whole, so no section is cut to fit. */
const SECTIONS: Record<Section['kind'], (part: Part, reading: Reading) => Props> = {
  heading: ({ text }) => ({ text: text.trim() }),
  text: ({ text }) => ({ text: text.trim() }),
  figures: ({ text, lines }) => compact({ label: text.trim(), facts: pairsOf(lines) }),
  list: ({ text, lines }) => compact({ label: text.trim(), items: entriesIn(lines) }),
  table: ({ text, lines }) => compact({ label: text.trim(), ...tableIn(lines) }),
  picture: (_part, { item, asked }) => ({ src: pictureOf(item, asked) ?? '' }),
  excerpt: ({ text, by }, { kept }) => compact({ text: unquoted(text), by: kept(by) }),
};

/** The card of its own that a section could be, when its kind has one. */
function dedicated(section: Section): Draw | undefined {
  // A section's label is a line of the item over it, which the card of its own draws over itself as the frame finds it.
  const { kind, label: _label, ...props } = section as Section & { label?: string };
  switch (kind) {
    case 'figures': {
      const { facts } = props as Extract<Section, { kind: 'figures' }>;
      return facts.length === 1 ? { component: 'fact', props: { value: facts[0]!.value, label: facts[0]!.label } } : { component: 'facts', props: { facts: facts.slice(0, FACTS_SHOWN) } };
    }
    case 'list':
    case 'table':
      return { component: kind, props };
    case 'excerpt':
      return { component: 'by' in props ? 'quote' : 'excerpt', props };
    default:
      return undefined;
  }
}

/**
 * How each card the model may choose is built from the slots of its reply. Adding a card the model may choose is one row here.
 * A row copies and tidies; whether the card is valid, stated and large enough is judged afterwards, the same way for every row.
 */
const BUILT: Record<Chosen, (reply: Entry, reading: Reading) => Props> = {
  // Words a note sets apart are whole units among its first lines, or the note is drawn without them: its frame reads which.
  note: ({ emphasis }) => compact({ emphasis: emphasis.trim() }),
  idea: () => ({}),
  quote: ({ passage, by }, { kept }) => compact({ text: unquoted(passage), by: kept(by) }),
  fact: ({ subject, passage }) => ({ value: passage.trim(), label: subject.trim() }),
  facts: ({ lines }) => ({ facts: pairsOf(lines).slice(0, FACTS_SHOWN) }),
  steps: ({ lines }) => ({ steps: each(lines) }),
  list: ({ lines }) => ({ items: entriesIn(lines) }),
  chart: ({ labels, numbers, unit }, { text }) => chartProps(each(labels), numbers, unit.trim() && unitStands(unit.trim(), numbers, text) ? unit.trim() : undefined),
  breakdown: ({ labels, numbers, unit }, { text }) => compact({ labels: each(labels), values: numbers, unit: unit.trim() && unitStands(unit.trim(), numbers, text) ? unit.trim() : undefined }),
  table: ({ lines }) => tableIn(lines),
  qa: ({ subject, passage }) => ({ question: subject.trim(), answer: passage.trim() }),
  definition: ({ subject, passage }) => ({ term: subject.trim(), definition: passage.trim() }),
  proscons: ({ left, right }) => ({ pros: entriesIn(left), cons: entriesIn(right) }),
  callout: ({ passage, tone }) => ({ text: passage.trim(), tone: tone.trim().toLowerCase() === 'note' ? 'note' : 'caution' }),
  excerpt: ({ passage, by }, { kept, item }) => compact({ text: unquoted(passage), at: kept(by), source: str(item.data.site) ?? str(item.data.from) }),
  sheet: ({ sections }, reading) => ({ sections: sections.map((part) => ({ kind: part.kind, ...SECTIONS[part.kind](part, reading) })) }),
  explorable: (reply, { text }) => {
    const stated = (unit: string, values: number[]) => (unit.trim() && unitStands(unit.trim(), values, text) ? unit.trim() : undefined);
    const controls = reply.controls.map((control, n) => {
      if (control.kind !== 'slider') return { kind: control.kind, label: control.label.trim(), states: control.states.map((name, at) => ({ name: name.trim(), text: unquoted(control.texts[at] ?? '') })) };
      const { values } = control;
      const [min, max] = [Math.min(control.min, ...values), Math.max(control.max, ...values)];
      return compact({ kind: 'slider', name: control.name.trim(), label: control.label.trim(), unit: stated(control.unit, values), min, max, step: stepFor(min, max, values), values });
    });
    const sliders = reply.controls.filter((control) => control.kind === 'slider');
    if (sliders.length === 0) return { controls, output: { kind: 'text' } };
    const read = parse(reply.formula, sliders.map((slider) => slider.name.trim()));
    const values = reply.numbers;
    // A result the item states at three or more values is drawn as the curve through them.
    const output = compact({ kind: values.length >= 3 ? 'chart' : 'figure', label: reply.subject.trim(), unit: stated(reply.unit, values), formula: 'program' in read ? read.program : [], values });
    return { controls, output, ...('error' in read && { unread: read.error }) };
  },
};

/**
 * The coarsest step of 1, 2 or 5 times a power of ten that gives a slider at least 40 steps and lands on its ends and on every value
 * it states, or NaN when only one finer than `ROOM.stops` steps would.
 */
function stepFor(min: number, max: number, values: number[]): number {
  for (let power = 6; power >= -6; power--) {
    for (const times of [5, 2, 1]) {
      const step = Number((times * 10 ** power).toPrecision(1));
      const steps = (max - min) / step;
      if (steps < 40) continue;
      if (steps > ROOM.stops) return Number.NaN;
      if ([min, max, ...values].every((value) => Math.abs(value / step - Math.round(value / step)) < 1e-6)) return step;
    }
  }
  return Number.NaN;
}

/**
 * What became of one reply: the card it draws, or why it draws none and the rule's card stays.
 * - `invalid`: the library has no such card with such props.
 * - a `Why`: `prop` may not be shown, or with no `prop` the card's words are no whole item, and the card does not stand.
 * `left` are the props the card was drawn without, because its item does not write them where the card would show them.
 */
export type Verdict =
  | { draw: Draw; left?: Fault[] }
  | { refused: 'invalid' | Why; component: Chosen; prop?: string; left?: Fault[] }
  | { refused: 'formula'; component: 'explorable'; prop: 'formula'; because: string; left?: Fault[] };

/** The cards that draw the item itself, which the rules leave the model to look at again. */
const WHOLE = new Set<string>(['note', 'idea']);

function judged(draw: Draw, component: Chosen, item: Item, content: Content): Verdict {
  if (!isValidView(draw) || (draw.component === 'idea' && !isIdea(item, true))) return { refused: 'invalid', component };
  const result = checked(draw, content, 'model');
  if ('fault' in result) return { refused: result.fault.why, component, ...(result.fault.prop && { prop: result.fault.prop }) };
  const { draw: card, left } = result;
  const lost = left.length > 0 ? { left } : {};
  if (!isValidView(card) || !(checksOf(card.component).also?.(card.props as never, item, content.text) ?? true)) return { refused: 'invalid', component, ...lost };
  return { draw: card, ...lost };
}

/**
 * A sheet from the sections a reply gave. More than `ROOM.sections` of them, two headings, or a heading that is not first, is no sheet.
 * When all of it but one section is its heading and opening text, and that section is a card of its own that shows the whole item with
 * them drawn over it, that card is drawn: a dedicated type always wins. Otherwise the sheet is judged as any card is, every section
 * whole and in order.
 */
function assembled(sections: Section[], item: Item, content: Content): Verdict {
  const given = distinct(sections, (section) => folded(stable(section)));
  const headings = given.filter((section) => section.kind === 'heading').length;
  if (given.length > ROOM.sections || headings > 1 || (headings === 1 && given[0]!.kind !== 'heading')) return { refused: 'invalid', component: 'sheet' };
  // A sheet whose other sections are only its heading and its opening is that one section's card, which draws them over it.
  const parts = given.filter((section) => section.kind !== 'heading' && section.kind !== 'text');
  const own = parts.length === 1 ? dedicated(parts[0]!) : undefined;
  const alone = own && judged(own, 'sheet', item, content);
  return alone && 'draw' in alone ? alone : judged({ component: 'sheet', props: { sections: given } }, 'sheet', item, content);
}

/** The card one reply of the model draws for its item, after every check a card must pass, or why it draws none. */
export function byModel(reply: Entry, item: Item, assetUrl: (id: string) => string): Verdict {
  const content = contentOf(item, assetUrl);
  const reading: Reading = { item, asked: { assetUrl }, text: content.text, kept: (value) => (value.trim() && content.text.says(value) ? value.trim() : undefined) };
  const props = BUILT[reply.component](reply, reading);
  if (reply.component === 'sheet') return assembled(props.sections as Section[], item, content);
  if (reply.component === 'explorable') {
    const { unread, ...explorable } = props;
    if (typeof unread === 'string') return { refused: 'formula', component: 'explorable', prop: 'formula', because: `cannot be read: ${unread}` };
    const draw = { component: 'explorable' as const, props: explorable };
    const miss = isValidView(draw) ? misses(explorable as PropsOf<'explorable'>) : undefined;
    if (miss) return { refused: 'formula', component: 'explorable', prop: 'formula', because: miss };
  }
  return judged({ component: reply.component, props }, reply.component, item, content);
}

/** An item the rules are unsure of, with the card they drew it as `now`. */
interface Open {
  node: Node;
  item: Item;
  now: ComponentId;
}

const COMPONENTS_SYSTEM =
  'You are the Renderer of Mind Palace, a canvas for research, brainstorming and memories. You choose the card that presents each piece of text most accurately.';

function componentsPrompt(open: Open[], asked: Asked): string {
  const items = open
    .map(({ node, item, now }) => {
      const cut = item.text.trim().length > TEXT_SENT ? `\nlength: ${item.text.trim().length} characters, of which the first ${TEXT_SENT} are below` : '';
      return `id: ${node.id}\ntitle: ${item.title}${now === 'idea' ? '\nnow: idea' : ''}${cut}${pictureOf(item, asked) ? '\npicture: yes' : ''}\ntext: ${clip(item.text, TEXT_SENT)}`;
    })
    .join('\n\n');
  return `Below are items from a user's canvas. Each is currently drawn as a plain note: its title and the first lines of its text. One marked "now: idea" is drawn as an idea instead: its words alone, set large. For each item, choose the card that presents it best.

Cards, and the fields each one uses:
- note: prose that holds nothing a reader would want to see at a glance, such as a reflection, an argument, a description or a story. You may give emphasis: one short sentence or line among the first lines of the text, copied whole, that deserves to stand out where it stands.
- idea: the item is one short thought or what-if of the user's own, in a phrase or a sentence. A chore, a name, a caution or a definition is not an idea.
- quote: the item is someone's words. passage is the words, whole and at most ${ROOM.passage.spaced} characters (${ROOM.passage.spaceless} in Chinese or Japanese), and by the text's own words that say who said them, as they are written, or nothing.
- fact: the item is one number or short value with its label. passage is the value as the text writes it, and subject its label: the rest of the item, as it is written.
- facts: the item is two to six figures or attributes, one to a line or a row. lines has one "label | value" for each, the label as its line or row writes it before the value, and the value after.
- steps: the item is an ordered procedure. lines has one step each, a whole line or sentence of the item, without its number. The card numbers its steps 1, 2, 3, so the item's own numbers must count its numbered lines so: a countdown, years or a line left unnumbered after numbered ones is a list.
- list: the item is a list of things in no particular order. lines has one entry each, a whole line or sentence of the item, without its bullet and with any tick or cross it writes, and with its number when the item's numbers are not 1, 2, 3 in order.
- chart: the item is several numbers of the same kind that are worth comparing. labels and numbers have equal length, each label as the text writes it beside its number, and unit is given when the text states one.
- breakdown: the item is mainly the shares of one whole, in percent, adding up to a hundred. labels, numbers and unit, as for chart.
- table: the item is mainly rows and columns. lines has the row of column heads first and then one row each, with " | " between cells.
- qa: the item asks one question and answers it. subject is the question and passage the answer: everything the item says after the question.
- definition: the item says what one term means. subject is the term and passage the meaning: the whole item, the term included.
- proscons: the item weighs one choice and gives each side its own heading or label, such as "Pros:" and "Cons:". left has the points under the first and right the points under the second, each a whole line or sentence.
- callout: the item is a warning, a caveat or a reminder the reader must not miss. passage is the whole item, with any word before a colon that opens it, such as "Note:", and tone is "caution" for a warning or "note" for a remark.
- excerpt: the item is a passage copied out of a longer source. passage is the whole passage, no longer than a quote, and by where it sits in the source when the text says.
- explorable: the item explains how something works by relating quantities or by contrasting states, so a reader learns more by changing it. To contrast two to four states of one thing, controls has one control of kind "segmented", or "toggle" for two, with label naming what changes, states the name of each state, which is the label that opens the state's own line or the heading over it, and texts the whole line or sentences that say each state, copied whole with any name and colon that opens them, and in the same order. To relate quantities, controls has one control of kind "slider", with label and unit, name (a short name for the quantity, used in formula), min and max (the range worth exploring), and values (each value of it the item states); formula gives the result from name, written with numbers, + - * / ^, brackets and min, max, round, sqrt, exp, ln and atan (in radians), and nothing else; subject is the result's label, unit its unit, and numbers the result the item states at each of those values, in the same order.
- sheet: an assembled card, for a short item made of two or more kinds of part that no card above covers, such as a sentence and a list. sections has two to four parts, a heading counted, that together are the whole item in its order. Each has a kind:
  - heading: text is a heading line of the item. At most one, and first.
  - text: text is whole sentences of the item.
  - figures: lines has one to four "label | value", each the whole of a line or row of the item.
  - list: lines has two to eight entries, each a whole line of the item.
  - table: lines has the row of heads first, then up to five rows of up to four cells, with " | " between cells, the whole of a table of the item.
  For figures, a list or a table, text is the line of the item that heads them, such as "Best:", or empty when none does.
  - excerpt: text is words the item quotes, and by the item's own words that say who said them.
  - picture: the item's own picture. Only for an item marked "picture: yes".

How to choose:
- A card shows the whole item. Its structure changes only how the item is laid out: choose a card whose fields hold every sentence, line, entry, step, figure and row of the item, in the item's order. The item's headings and labels, and a sentence or two that open it before its structure, are drawn above the card and need not be copied into a field.
- Never leave out a line, never cut one, and never pick some lines of a longer item: a card of part of an item may say something the item does not. When no card holds the whole item, choose note.
- Keep every mark as the item writes it: a tick or a cross, an arrow, a minus sign, brackets, "Q:", "A:" or a speaker's name before a colon.
- Choose note when nothing fits. Do not force a structure onto prose.
- Copy every value from the item's own text, word for word and in its language: a passage with its punctuation, a number as it is written. Never add, estimate, convert, translate or round.
- Every passage, answer, meaning, list entry, step and point is whole sentences or whole lines of the item: it begins where one begins and ends where one ends, with any word before a colon that opens it.
- A label is the item's own words beside its value, as its line or row writes them, at most ${ROOM.label} characters. Add no word of your own.
- Write each figure, list entry and table row once.
- Return one entry per item, with the id exactly as given. Fill only the fields named for the chosen card, and leave every other field as an empty string or an empty list. The card already has the item's title and text: never copy either into a field. An idea fills nothing, and a note nothing but emphasis.

Items:

${items}`;
}

const REFUSED: Record<Extract<Verdict, { refused: string }>['refused'], (prop?: string, because?: string) => string> = {
  invalid: () => 'is not one the library accepts',
  formula: (_prop, because) => `has a formula that ${because}`,
  unstated: (prop) => `shows ${prop}, which the content does not state`,
  part: (prop) => (prop ? `sets ${prop} apart, which is not whole sentences or lines among the content's first` : 'is not the whole content, every line in order and every mark as it is written'),
  long: (prop) => `shows ${prop}, which is longer than a card has room for`,
};
const LEFT: Record<Why, string> = {
  unstated: 'the content does not state it',
  part: 'the content does not write it where the card would show it',
  long: 'it is longer than a card has room for',
};

/** The card a reply draws for its item, or nothing, with a line in the run log that names the item and the prop that failed. */
export function drawn(ctx: RoleContext, reply: Entry, item: Item): Draw | undefined {
  let verdict: Verdict;
  try {
    verdict = byModel(reply, item, (id) => ctx.assets.url(id));
  } catch (err) {
    // One reply the checks cannot read leaves its item as the rules drew it, and never the rest of the pass.
    ctx.note(ROLE, `Kept "${clip(item.title, 40)}" as the rules drew it: the model's ${reply.component} could not be checked (${err instanceof Error ? err.message : String(err)}).`);
    return undefined;
  }
  const name = `"${clip(item.title, 40)}"`;
  const card = 'refused' in verdict ? verdict.component : verdict.draw.component;
  // What a refusal names needs no second line.
  for (const { prop, why } of verdict.left ?? []) if (!('refused' in verdict) || prop !== verdict.prop) ctx.note(ROLE, `Left ${prop} out of the ${card} for ${name}: ${LEFT[why]}.`);
  if ('refused' in verdict) {
    ctx.note(ROLE, `Kept ${name} as the rules drew it: the model's ${verdict.component} ${REFUSED[verdict.refused](verdict.prop, 'because' in verdict ? verdict.because : undefined)}.`);
    return undefined;
  }
  return verdict.draw;
}

/**
 * Whether the rules are unsure of an item, so the model is asked: text of some length that is no link, picture, recording, conversation
 * or code, which the rules drew as a note, or as an idea, where the model can tell a thought from a chore, a caution or a definition.
 */
export const unsure = (item: Item, draw: Draw): boolean => {
  if (!WHOLE.has(draw.component) || (item.kind !== 'text' && item.kind !== 'file')) return false;
  const said = item.text.trim() || (draw.component === 'idea' ? item.title : '');
  return sizeOf(said) >= (SPACELESS.test(said) ? AMBIGUOUS_FROM.spaceless : AMBIGUOUS_FROM.spaced);
};


/**
 * What the model answered for the unsure items of one pass, by node: the card that stands, or nothing when its answer was refused.
 * An item with no entry here got no answer, because its call failed, the reply left it out, or the pass was full. `replied` is
 * whether any call of the pass got an answer back.
 */
async function askComponents(ctx: RoleContext, open: Open[]): Promise<{ answers: Map<Id, Draw | undefined>; replied: boolean }> {
  const answers = new Map<Id, Draw | undefined>();
  const asked = open.slice(0, MAX_ASKED_ITEMS);
  const asset = { assetUrl: (id: string) => ctx.assets.url(id) };
  let replied = false;

  /**
   * One call. A call whose answer came back unreadable is asked once more as two halves, one after the other, since a smaller
   * question is answered more often. A call that got no answer is not: the model is slow or down, and two calls wait on it as one does.
   */
  const ask = async (part: Open[], again: boolean): Promise<void> => {
    let reply: ComponentsReply;
    try {
      reply = await ctx.model.json({ role: `${ROLE}.components`, system: COMPONENTS_SYSTEM, user: componentsPrompt(part, asset), schema: ComponentsReply, effort: 'low' });
    } catch (err) {
      const halves = again && err instanceof Unreadable;
      const items = `${part.length} ${part.length === 1 ? 'item' : 'items'}`;
      ctx.note(ROLE, `A call to choose components for ${items} failed (${message(err)}). ${halves ? 'Asking once more, in two halves.' : `Kept the rule-based views of ${part.length === 1 ? 'it' : 'them'}.`}`);
      if (!halves) return;
      const half = Math.ceil(part.length / 2);
      for (const some of [part.slice(0, half), part.slice(half)]) if (some.length > 0) await ask(some, false);
      return;
    }
    replied = true;
    // An entry counts once, and only for an item this call asked about.
    const waiting = new Map(part.map(({ node, item }) => [node.id, item]));
    for (const entry of reply.items) {
      const item = waiting.get(entry.id);
      if (item && waiting.delete(entry.id)) answers.set(entry.id, drawn(ctx, entry, item));
    }
  };

  const calls = Math.ceil(asked.length / ASKED_PER_CALL);
  const each = Math.ceil(asked.length / calls);
  await Promise.all(Array.from({ length: calls }, (_v, n) => ask(asked.slice(n * each, (n + 1) * each), true)));
  return { answers, replied };
}

// ---- composites

const STRUCTURE_IN_WHY =
  /\b(vs\.?|versus|alternatives?|options?|compar\w+|instead of|rather than|step \d+|timeline|phase|stage|precursor|successor|followed by|led to)\b/i;

function sameGroup(group: Group, draft: GroupDraft): boolean {
  return (
    group.composite === draft.composite &&
    group.members.length === draft.members.length &&
    draft.members.every((id) => group.members.includes(id)) &&
    stable(group.props) === stable(draft.props)
  );
}

function free(pool: Pool): Node[] {
  return pool.nodes.filter((n) => !pool.taken.has(n.id));
}

function add(ctx: RoleContext, pool: Pool, draft: GroupDraft, out: Command[]): void {
  if (!isValidGroup(draft)) return;
  out.push({ type: 'setGroup', group: { id: ctx.newId(), treeId: pool.parent.treeId, anchor: pool.parent.id, ...draft } });
  for (const id of draft.members) pool.taken.add(id);
}

function drop(pool: Pool, group: Group, out: Command[]): void {
  out.push({ type: 'removeGroup', id: group.id });
  pool.standing = pool.standing.filter((g) => g !== group);
  for (const id of group.members) pool.taken.delete(id);
}

/** What the plain-code arrangements read of a sibling: the card it is drawn as, and the date and the point on the earth its data gives. */
interface Look {
  component: (node: Node) => string;
  when: (node: Node) => string | undefined;
  at: (node: Node) => LatLon | undefined;
}

/**
 * One arrangement that plain code makes. `sort` names the group of this kind a sibling may join, or is null when it may join none:
 * most make one group of a pool, and the stack makes one of each card type. `build` makes the group of the siblings of one name, or none.
 */
interface Arranging {
  composite: CompositeId;
  sort: (node: Node, look: Look) => string | null;
  build: (nodes: Node[], look: Look) => GroupDraft | null;
  /** Runs after the model's groups are made, so it takes only what no group took. */
  late?: true;
}

const FIGURES = new Set(['fact', 'facts']);
const PLOTS = new Set(['chart', 'breakdown']);
const MOOD = new Set([...PICTURE_LED, 'swatch', 'idea']);

const plain = (composite: CompositeId, members: Node[], props: Props = {}): GroupDraft => ({ composite, title: '', members: members.map((n) => n.id), props });
const among = (kinds: ReadonlySet<string>) => (node: Node, look: Look) => (kinds.has(look.component(node)) ? '' : null);

/** The siblings in time order when the date of every one of them can be read, and as they come otherwise. */
function byDate(nodes: Node[], look: Look): Node[] {
  const times = new Map(nodes.map((n) => [n.id, timeOf(look.when(n) ?? '')]));
  return [...times.values()].every((t) => t !== null) ? [...nodes].sort((a, b) => times.get(a.id)! - times.get(b.id)!) : nodes;
}

/**
 * The arrangements plain code makes, in the order they take siblings. An earlier one may take a sibling from the group a later one
 * made, and that group is made again from what is left. The model's groups keep their members.
 */
const ARRANGED: readonly Arranging[] = [
  {
    composite: 'map',
    sort: (n, look) => (look.at(n) ? '' : null),
    build: (nodes, look) => {
      if (nodes.length < 3) return null;
      const { centre, zoom, pins } = fit(byDate(nodes, look).map((n) => [n.id, look.at(n)!] as const));
      return pins.length >= 2 ? { composite: 'map', title: '', members: pins.flatMap((pin) => pin.members), props: { centre, zoom, pins } } : null;
    },
  },
  {
    composite: 'overview',
    sort: among(new Set([...FIGURES, ...PLOTS])),
    build: (nodes, look) => {
      const plots = nodes.filter((n) => PLOTS.has(look.component(n)));
      const figures = nodes.filter((n) => FIGURES.has(look.component(n)));
      return plots.length === 1 && figures.length >= 2 && figures.length <= 5 ? plain('overview', [...figures, plots[0]!]) : null;
    },
  },
  {
    composite: 'moodboard',
    sort: among(MOOD),
    build: (nodes, look) => {
      const pictures = nodes.filter((n) => PICTURE_LED.has(look.component(n))).length;
      return nodes.length >= 4 && pictures >= 2 && pictures < nodes.length ? plain('moodboard', nodes) : null;
    },
  },
  { composite: 'gallery', sort: among(PICTURE_LED), build: (nodes) => (nodes.length >= 3 ? plain('gallery', nodes) : null) },
  {
    composite: 'timeline',
    sort: (n, look) => (look.when(n) !== undefined ? '' : null),
    build: (nodes, look) => {
      if (nodes.length < 3) return null;
      const ordered = byDate(nodes, look);
      return plain('timeline', ordered, { labels: Object.fromEntries(ordered.map((n) => [n.id, clip(look.when(n)!, 40)])) });
    },
  },
  {
    composite: 'stack',
    sort: (n, look) => look.component(n),
    build: (nodes) => (nodes.length > STACK_ABOVE ? { ...plain('stack', [...nodes].sort((a, b) => b.importance - a.importance || a.order - b.order).slice(STACK_KEEPS)), title: `${nodes.length - STACK_KEEPS} more` } : null),
    late: true,
  },
];

/** The arrangement that made this group: one of its kind whose members all join one group of that kind. */
function madeBy(group: Group, byId: ReadonlyMap<Id, Node>, look: Look): number | undefined {
  const row = ARRANGED.findIndex((rule) => rule.composite === group.composite);
  if (row < 0) return undefined;
  const names = new Set(group.members.map((id) => (byId.has(id) ? ARRANGED[row]!.sort(byId.get(id)!, look) : null)));
  return names.size === 1 && !names.has(null) ? row : undefined;
}

/**
 * Brings the groups of one plain-code arrangement up to date in one pool. Its group of each name is left alone when nothing changed,
 * made again when its membership would change, and removed when the rule no longer holds.
 */
function settle(ctx: RoleContext, pool: Pool, out: Command[], row: number, look: Look): void {
  const rule = ARRANGED[row]!;
  const byId = new Map(pool.nodes.map((n) => [n.id, n]));
  const names = new Set(pool.nodes.map((n) => rule.sort(n, look)));
  names.delete(null);
  for (const name of names) {
    const own = pool.standing.find((g) => g.composite === rule.composite && g.members.every((id) => rule.sort(byId.get(id)!, look) === name));
    const later = pool.standing.filter((g) => g !== own && (madeBy(g, byId, look) ?? -1) > row);
    const open = (n: Node) => !pool.taken.has(n.id) || own?.members.includes(n.id) || later.some((g) => g.members.includes(n.id));
    const draft = rule.build(pool.nodes.filter((n) => rule.sort(n, look) === name && open(n)), look);
    if (own && draft && sameGroup(own, draft)) continue;
    if (own) drop(pool, own, out);
    for (const g of later) if (draft?.members.some((id) => g.members.includes(id))) drop(pool, g, out);
    if (draft) add(ctx, pool, draft, out);
  }
}

/** The composites only plain code makes. A group of one of these that its rule would not make now is left over from an earlier state. */
const RULED_ONLY: ReadonlySet<string> = new Set(ARRANGED.map((rule) => rule.composite).filter((composite) => !(ASKED as readonly string[]).includes(composite)));

/** Splits each parent's children into pools, clears groups that no longer hold, and applies the plain-code arrangements that run first. */
function survey(ctx: RoleContext, parents: Node[], look: Look, out: Command[]): Pool[] {
  const pools: Pool[] = [];
  for (const parent of parents) {
    const children = ctx.mind.children(parent.id);
    const statusOf = new Map(children.map((n) => [n.id, n.status]));
    const byId = new Map(children.map((n) => [n.id, n]));
    const groups = [...ctx.mind.groups.values()];
    const anchored = groups.filter((g) => g.anchor === parent.id);
    // A group that now mixes kept nodes with picks, or names a node that moved away, no longer holds.
    const broken = new Set(anchored.filter((g) => {
      const status = statusOf.get(g.members[0]!);
      return !status || g.members.some((id) => statusOf.get(id) !== status);
    }));
    for (const g of groups) if (g.anchor !== parent.id && g.members.some((id) => statusOf.has(id))) broken.add(g);
    for (const g of broken) out.push({ type: 'removeGroup', id: g.id });
    for (const status of ['kept', 'pick'] as const) {
      const standing = anchored.filter((g) => !broken.has(g) && g.members.every((id) => statusOf.get(id) === status));
      const pool: Pool = {
        parent,
        nodes: children.filter((n) => n.status === status),
        standing,
        taken: new Set(standing.flatMap((g) => g.members)),
        asked: [],
      };
      for (const g of standing) if (RULED_ONLY.has(g.composite) && madeBy(g, byId, look) === undefined) drop(pool, g, out);
      ARRANGED.forEach((rule, row) => rule.late || settle(ctx, pool, out, row, look));
      pools.push(pool);
    }
  }
  return pools;
}

const COMPOSITES_SYSTEM =
  'You are the Renderer of Mind Palace, a spatial brainstorming app. You decide whether sibling notes in a tree should be drawn together as one arrangement.';

function compositesPrompt(ctx: RoleContext, pools: Pool[]): string {
  const line = (node: Node) => {
    const item = ctx.mind.items.get(node.itemId);
    const about = clip(item?.summary.trim() || item?.text || '', 200).replace(/\s+/g, ' ');
    const why = node.why.trim() ? ` | why it is here: ${clip(node.why, 120)}` : '';
    return `  - ${node.id} | ${clip(item?.title ?? '', 80)} | ${about}${why}`;
  };
  const byParent = new Map<Id, Pool[]>();
  for (const pool of pools) byParent.set(pool.parent.id, [...(byParent.get(pool.parent.id) ?? []), pool]);
  const blocks = [...byParent.values()].map((sets) => {
    const parent = sets[0]!.parent;
    const lists = sets.map((pool) => {
      const byId = new Map(pool.nodes.map((n) => [n.id, n]));
      const heading = pool.nodes[0]?.status === 'pick' ? 'Suggested siblings (not yet kept by the user)' : 'Kept siblings';
      return `${heading}:\n${pool.asked.map((id) => line(byId.get(id)!)).join('\n')}`;
    });
    return `Parent ${parent.id}: ${clip(ctx.mind.items.get(parent.itemId)?.title ?? '', 80)}\n${lists.join('\n')}`;
  });
  return `Below are parents in a user's brainstorm tree, each with sibling notes that hang from it. Propose groups of siblings only where drawing them as one arrangement shows something the separate notes do not.

No group is the right answer most of the time. Return an empty list unless the structure is plainly there in the content.

Arrangements:
- timeline: members that each belong to a date or period stated in their content. Give members in time order and one entry in labels per member, in the same order, copied from the content.
- comparison: 2 to 4 alternatives the user would weigh against each other. Give 2 to 4 criteria, and in cells one entry per member with one short value per criterion, in the order of criteria. Draw each value from that member's summary. Leave a value empty when the summary does not say.
- sequence: members whose order means something, such as steps or an argument. Give members in that order.
- cluster: members that share one theme the others do not. Give theme, a label of 1 to 3 words.
- ranked: suggested siblings that each answer the same question, from the best answer to the least. Give members best first, and in reasons one entry per member, in the same order: a sentence or line copied whole from that member's content that says why it stands there, or an empty string.
- beforeafter: 2 to 4 members that are one thing at different times or in different states. Give members in order, and in changes one entry for each step from one member to the next, so one fewer than the members: a sentence or line copied whole from the content of either member that names what changed, or an empty string.
- lead: one member that the others support, explain or give evidence for. Give that member first.
- matrix: exactly 4 members that differ along two measures, one member in each corner. Give axes as two names of 1 to 3 words, the horizontal measure first, each in words the members' content uses. Give members in the order top left, top right, bottom left, bottom right, where the horizontal measure grows to the right and the vertical one grows upwards, and in reasons one entry per member, in the same order: a sentence or line copied whole from that member's content that says why it sits in its corner, or an empty string.
${LAYOUT_OPTION}

Rules:
- A comparison or a beforeafter needs 2 to 4 members, a matrix exactly 4, and every other arrangement at least 3.
- ranked is only for suggested siblings.
- A node belongs to at most one group.
- Never put a kept sibling and a suggested sibling in the same group.
- Use the parent and member ids exactly as given.
- title is a few words, about 26 characters in English or 18 in Chinese: the theme, or what is being compared.
- Fill only the fields of the chosen arrangement. Leave the others as an empty string or an empty list.
- Choose layout only when no other arrangement fits.

${blocks.join('\n\n')}`;
}

/**
 * What a member of a proposed group states, read once for each member: its title and text, and its summary and date beside them. Every
 * label the model sets beside members stands in this, and every line it sets beside one is that member's whole text.
 */
function membersContent(ctx: RoleContext): (id: Id) => Grounding {
  const read = new Map<Id, Grounding>();
  return (id) => {
    if (!read.has(id)) {
      const item = ctx.mind.itemOf(id);
      read.set(id, grounding(item.text, { title: item.title, held: [item.summary, str(item.data.when) ?? ''].filter(Boolean) }));
    }
    return read.get(id)!;
  };
}

/** A line set beside a member is the member's whole text under its title, with nothing over it: what it says beside its card is all it says. */
const wholeLine = (text: string): Way[] => [{ pieces: [{ text, entry: true }] }];

/**
 * The group the model proposed, as far as the members' content holds it up. `members` are the proposed ones, without repeats, and
 * `ids` those of them no other group took.
 */
function draftFrom(ctx: RoleContext, g: CompositesReply['groups'][number], members: Id[], ids: Id[], status: Node['status']): GroupDraft | null {
  const content = membersContent(ctx);
  const title = fittedTitle(g.title.replace(/\s+/g, ' ').trim());
  /** A line set beside a member stands when it is the whole text of one of these members, and short enough. It is drawn as that member writes it. */
  const line = (said: string | undefined, ...of: Id[]) => {
    const text = (said ?? '').trim();
    if (text === '' || text.length > roomOf(ROOM.reason, text)) return '';
    const shown = of.map((id) => content(id).shows(wholeLine(text))).find((one) => one?.above.length === 0);
    return shown?.texts[0] ?? '';
  };
  const whole = ids.length === members.length;
  switch (g.composite) {
    case 'ranked': {
      if (status !== 'pick' || ids.length < 3) return null;
      return { composite: 'ranked', title, members: ids, props: { reasons: Object.fromEntries(ids.map((id) => [id, line(g.reasons[g.members.indexOf(id)], id)])) } };
    }
    case 'beforeafter':
      if (!whole || g.members.length !== ids.length || ids.length < 2 || ids.length > 4) return null;
      return { composite: 'beforeafter', title, members: ids, props: { changes: Object.fromEntries(ids.slice(1).map((id, i) => [id, line(g.changes[i], ids[i]!, id)])) } };
    case 'lead':
      return ids.length >= 3 ? { composite: 'lead', title, members: ids, props: {} } : null;
    case 'matrix': {
      // An axis is named in words that at least two of the members use. A name no member uses was made up.
      const [x, y] = g.axes.map((axis) => axis.trim());
      const named = (axis: string | undefined) => axis !== undefined && axis !== '' && axis.length <= ROOM.axis && ids.filter((id) => content(id).says(axis)).length >= 2;
      if (!whole || ids.length !== 4 || !named(x) || !named(y)) return null;
      return { composite: 'matrix', title, members: ids, props: { x, y, reasons: Object.fromEntries(ids.map((id) => [id, line(g.reasons[g.members.indexOf(id)], id)])) } };
    }
    case 'timeline': {
      const label = new Map(g.members.map((id, i) => [id, (g.labels[i] ?? '').trim()]));
      const dated = ids.filter((id) => {
        const l = label.get(id)!;
        return l !== '' && (/\d/.test(l) ? content(id).tallies(l) : content(id).says(l));
      });
      if (dated.length < 3) return null;
      return { composite: 'timeline', title, members: dated, props: { labels: Object.fromEntries(dated.map((id) => [id, clip(label.get(id)!, 40)])) } };
    }
    case 'comparison': {
      const criteria = g.criteria.slice(0, 4).map((c) => clip(c, 40));
      if (criteria.length < 2 || criteria.some((c) => c === '')) return null;
      const rows = new Map(g.cells.map((row) => [row.member, row.values]));
      const members = ids.filter((id) => rows.has(id)).slice(0, 4);
      if (members.length < 2) return null;
      const cells = Object.fromEntries(
        members.map((id) => [
          id,
          criteria.map((_c, i) => {
            const cell = clip(rows.get(id)![i] ?? '', 80);
            // A number the member's own content does not hold was made up.
            return content(id).tallies(cell) ? cell : '';
          }),
        ]),
      );
      return { composite: 'comparison', title, members, props: { criteria, cells } };
    }
    case 'sequence':
      return ids.length >= 3 ? { composite: 'sequence', title, members: ids, props: {} } : null;
    case 'cluster': {
      const theme = (g.theme.trim() || g.title.trim()).split(/\s+/).slice(0, 3).join(' ');
      return ids.length >= 3 && theme ? { composite: 'cluster', title: title || theme, members: ids, props: { theme } } : null;
    }
    case 'layout':
      return layoutDraft(ctx, g, ids);
  }
}

const LAYOUT_OPTION = `- layout: only when none of the arrangements above fits, members that fall into a structure of their own, such as two or three labelled sets side by side, or one member the others serve. Describe it in parts, one for each container and one for each member, each naming the id of the container it sits in. A container is a row, a column or a grid, with an id you make up; the outermost one has parent "". A member's part has kind card and its node id as id. Give each member a role: lead for the one member the others serve, minor for an aside, otherwise normal. A container may carry a label of 1 to 4 words taken from its members' content. Set join to arrow when a row's or a column's members follow one another, line when they only belong together, otherwise none. At most ${LIMITS.cards} members, ${LIMITS.boxes} containers, and containers ${LIMITS.depth} deep. Leave members empty; the parts name them.`;

/**
 * The structure the model gave for a layout, as a tree whose labels stand in its members' content, or null with a note that says why
 * it was set aside. A label stands when one member under it states it, or when every member under it states each of its words.
 */
export function layoutDraft(ctx: RoleContext, g: Pick<CompositesReply['groups'][number], 'parent' | 'title' | 'parts'>, ids: Id[]): GroupDraft | null {
  const parsed = parseFlat(g.parts, new Set(ids));
  if ('why' in parsed) {
    ctx.note(ROLE, `Set aside the layout the model gave under ${g.parent}: ${parsed.why}.`);
    return null;
  }
  const content = membersContent(ctx);
  const stands = (label: string, under: string[]) =>
    label.length <= LIMITS.label && (under.some((id) => content(id).says(label)) || label.split(/\s+/).every((word) => under.every((id) => content(id).says(word))));
  const grounded = (part: LayoutPart): LayoutPart => {
    if (part.kind === 'card') return part;
    const { label, ...rest } = part;
    const children = part.children.map(grounded);
    return label && stands(label, cardsOf(part)) ? { ...rest, label, children } : { ...rest, children };
  };
  const tree = collapse(grounded(parsed.tree) as Box);
  return { composite: 'layout', title: fittedTitle(g.title.replace(/\s+/g, ' ').trim()), members: cardsOf(tree), props: { tree } };
}

async function askComposites(ctx: RoleContext, pools: Pool[], changed: ReadonlySet<Id>, out: Command[]): Promise<void> {
  const asked = pools
    .filter((pool) => {
      const open = free(pool);
      // Siblings that were already looked at and have not changed are not worth a second question.
      if (!open.some((n) => changed.has(n.id))) return false;
      return open.length >= 4 || (open.length >= 2 && open.some((n) => STRUCTURE_IN_WHY.test(n.why)));
    })
    .slice(0, MAX_ASKED_POOLS);
  if (asked.length === 0) return;
  for (const pool of asked) pool.asked = free(pool).slice(0, MAX_ASKED_SIBLINGS).map((n) => n.id);
  let reply: CompositesReply;
  try {
    reply = await ctx.model.json({
      role: `${ROLE}.composites`,
      system: COMPOSITES_SYSTEM,
      user: compositesPrompt(ctx, asked),
      schema: CompositesReply,
      effort: 'low',
      // The groups come after the cards' own looks, off the path to the card (44).
      priority: 'background',
    });
  } catch (err) {
    ctx.note(ROLE, `The model could not look for composites (${message(err)}). Kept the rule-based groups.`);
    return;
  }
  for (const g of reply.groups) {
    const members = [...new Set(g.composite === 'layout' ? g.parts.filter((part) => part.kind === 'card').map((part) => part.id) : g.members)];
    const pool = asked.find((p) => p.parent.id === g.parent && members.length > 0 && members.every((id) => p.asked.includes(id)));
    if (!pool) continue;
    // A sibling that gave way to a fuller round while the model was asked is not read.
    const stayed = members.filter((id) => ctx.mind.nodes.has(id));
    const draft = draftFrom(ctx, g, stayed, stayed.filter((id) => !pool.taken.has(id)), pool.nodes[0]!.status);
    if (draft) add(ctx, pool, draft, out);
  }
}

// ---- the role

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sameView(a: { component: string; props: unknown }, b: { component: string; props: unknown }): boolean {
  return a.component === b.component && stable(a.props) === stable(b.props);
}

/**
 * Chooses a component for each given node and composites for their siblings. Rules first, the model only where rules cannot tell.
 * On an unsure item, `by: 'renderer'` says the model answered for the item as it is, so it is not asked again until the item changes.
 * An unsure item the pass got no answer for keeps `by: 'default'`, and `later` is told of it, unless no call of the pass got an
 * answer back: then the model is down, and the item waits for its next change. The views go to `deliver` as soon as they are
 * chosen, so a card takes its look without waiting on the main model's answer on how its siblings group, which takes 3 to 25 s.
 */
export const renderer: Roles['renderer'] = async (ctx, { nodeIds, edited = [], again = false, later, deliver }) => {
  const nodes = [...new Set(nodeIds)].flatMap((id) => ctx.mind.nodes.get(id) ?? []);
  const changed = new Set(edited);
  const draws = new Map<Id, Draw>();
  const open: Open[] = [];
  const assetUrl = (id: string) => ctx.assets.url(id);
  for (const node of nodes) {
    const item = ctx.mind.items.get(node.itemId);
    if (!item) continue;
    const draw = byRule(item, assetUrl);
    const ambiguous = unsure(item, draw);
    // An earlier answer that still stands in the text is kept, so a second pass costs no model call and cannot lose it.
    // A note or an idea shows nothing an edit could contradict, so after an edit the model is asked about it again.
    if (ambiguous && node.view.by === 'renderer' && grounded(node.view, item, assetUrl) && !(WHOLE.has(node.view.component) && changed.has(node.id))) continue;
    draws.set(node.id, draw);
    if (ambiguous) open.push({ node, item, now: draw.component });
  }
  const componentOf = (node: Node) => draws.get(node.id)?.component ?? node.view.component;

  const parentIds = new Set(nodes.flatMap((n) => n.parent ?? []));
  const parents = [...parentIds].flatMap((id) => ctx.mind.nodes.get(id) ?? []);
  const groups: Command[] = [];
  const look: Look = {
    component: componentOf,
    when: (node) => str(ctx.mind.items.get(node.itemId)?.data.when),
    at: (node) => read(AtData, ctx.mind.items.get(node.itemId)?.data.at),
  };
  const pools = survey(ctx, parents, look, groups);

  const composites = again ? undefined : askComposites(ctx, pools, new Set(nodes.map((n) => n.id)), groups);
  const { answers, replied } = await askComponents(ctx, open);
  for (const [id, draw] of answers) if (draw) draws.set(id, draw);
  // The mind may have changed while the model was asked: a card that gave way to a fuller round is not drawn.
  const there = (id: Id) => ctx.mind.nodes.has(id);

  const asked = new Set(open.map(({ node }) => node.id));
  let views: Command[] = [];
  for (const node of nodes) {
    const draw = draws.get(node.id);
    if (!draw || !there(node.id)) continue;
    // An unsure item the model did not answer for keeps the rule's card as a default, so the next pass asks again.
    const by = asked.has(node.id) && !answers.has(node.id) ? 'default' : 'renderer';
    if (sameView(draw, node.view) && (!asked.has(node.id) || node.view.by === by)) continue;
    const view: View = { ...draw, by };
    views.push({ type: 'setView', id: node.id, view });
  }
  const owed = open.flatMap(({ node }) => (answers.has(node.id) ? [] : [node.id]));
  if (owed.length > 0 && replied) later?.(owed);
  if (deliver && views.length > 0) {
    deliver(views);
    views = [];
  }
  await composites;
  for (const pool of pools) ARRANGED.forEach((rule, row) => rule.late && settle(ctx, pool, groups, row, look));
  // Another pass may have grouped a card, or the user kept one, while the model was asked: such a group no longer holds.
  const removing = new Set(groups.flatMap((c) => (c.type === 'removeGroup' ? [c.id] : [])));
  const holds = ({ id, anchor, members }: Group) =>
    there(anchor) &&
    members.every(there) &&
    new Set(members.map((m) => ctx.mind.node(m).status)).size === 1 &&
    ![...ctx.mind.groups.values()].some((g) => g.id !== id && !removing.has(g.id) && g.members.some((m) => members.includes(m)));
  const standing = groups.filter((c) => (c.type === 'setGroup' ? holds(c.group) : c.type !== 'removeGroup' || ctx.mind.groups.has(c.id)));
  // Two parents of one pass may each find that a group no longer holds.
  const removals = [...new Map(standing.flatMap((c) => (c.type === 'removeGroup' ? [[c.id, c] as const] : []))).values()];
  return [...views, ...removals, ...standing.filter((c) => c.type !== 'removeGroup')];
};
