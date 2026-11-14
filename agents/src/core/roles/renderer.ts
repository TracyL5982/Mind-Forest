import { z } from 'zod';
import type { Command, Group, Id, Item, Node, View } from '../domain.ts';
import { grounding, type Grounding } from '../grounding.ts';
import { cardsOf, collapse, JOINS, KINDS, LIMITS, parseFlat, ROLES, type Box, type Part as LayoutPart } from '../layout.ts';
import { CHECKS, isValidGroup, isValidView, ROOM, roomOf, SECTION, siteOf, type Check, type ComponentId, type CompositeId, type Section, type Stated } from '../views.ts';
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
/** The least share of an item's title and text that a card drawn from its extracted structure must show. */
const COVERAGE_FLOOR = 0.2;
/** The cards that lead with a picture, which a gallery sets side by side. */
const PICTURE_LED = new Set(['image', 'video', 'artwork']);

// ---- reply schemas. Structured output wants every key present, so an empty string or list means "none".

/** The cards that can be built from an item's own words, which the model chooses among. */
export const CHOSEN = [
  'note', 'idea', 'quote', 'fact', 'facts', 'steps', 'list', 'chart', 'breakdown', 'table', 'qa', 'definition', 'proscons', 'callout', 'excerpt', 'sheet',
] as const satisfies readonly ComponentId[];
export type Chosen = (typeof CHOSEN)[number];

const SECTION_KINDS = ['heading', 'text', 'figures', 'list', 'table', 'picture', 'excerpt'] as const satisfies readonly Section['kind'][];

/**
 * One entry for each item, in a few slots that every card shares, so a new card adds a row to `BUILT` and no key here.
 * `subject` is a term, a question or what a value measures. `passage` is words of the item: a quotation, an answer, a meaning, a value.
 * Neither is named after a part of an item, because the model copied every item's title and whole text into slots called `title` and `body`.
 * `lines` are steps, list entries, "label | value" pairs, or table rows with "|" between their cells and the heads row first.
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
    }),
  ),
});
export type ComponentsReply = z.infer<typeof ComponentsReply>;

export const CompositesReply = z.object({
  groups: z.array(
    z.object({
      parent: z.string(),
      composite: z.enum(['timeline', 'comparison', 'sequence', 'cluster', 'layout']),
      title: z.string(),
      members: z.array(z.string()),
      labels: z.array(z.string()),
      criteria: z.array(z.string()),
      cells: z.array(z.object({ member: z.string(), values: z.array(z.string()) })),
      theme: z.string(),
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
  /** The item's text opens with these words. */
  opens(passage: string): boolean;
}

/**
 * The series a source's record carried, as rows of a table after the item's words. A record is no guess, so each of its numbers
 * stands beside its label as surely as if the text wrote them so. What a role read off a user's text is not a record.
 */
function recordOf(item: Item): string {
  const chart = item.origin.by === 'agent' ? read(ChartData, item.data.chart) : undefined;
  return chart ? `\n\n${chart.labels.map((label, n) => `${label} | ${chart.values[n] ?? ''}${chart.unit ?? ''}`).join('\n')}` : '';
}

/** `wordsOnly` leaves the data out, for a check that reads nothing but how the item's words stand together. */
function contentOf(item: Item, assetUrl: (id: string) => string, wordsOnly = false): Content {
  const { url, asset, from } = item.source;
  let owned: string[] | undefined;
  let opening: Grounding | undefined;
  return {
    text: grounding(`${item.title}\n\n${item.text}${recordOf(item)}`, wordsOnly ? [] : held(item.data, false)),
    own(value) {
      const whole = value.trim();
      const cut = whole.endsWith('…') ? whole.slice(0, -1).trimEnd() : '';
      owned ??= [item.text, item.summary, url, url && siteOf(url), asset && assetUrl(asset), from.replace(/^chat-export:/, ''), ...held(item.data, true)].flatMap((value) => value?.trim() || []);
      return owned.some((one) => one === whole || (cut !== '' && one.startsWith(cut)));
    },
    opens: (passage) => (opening ??= grounding(item.text)).begins(passage),
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
type Rule = Row & ({ reads: 'catalogue' | 'kind' | 'text' } | { reads: 'structure'; /** The strings the card would show. */ shown(item: Item): string[] });

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

/**
 * A row that draws one piece of structure Intake extracted: it holds when the item has the piece, and its props are made from the piece.
 * The card shows every string and number of the piece, unless `shows` names the part of it that the card shows.
 */
function extracted<T>(component: ComponentId, of: (item: Item) => T | undefined, props: (piece: T, item: Item) => Props, shows: (piece: T) => unknown = (piece) => piece): Rule {
  return {
    component,
    reads: 'structure',
    when: (item) => of(item) !== undefined,
    props: (item) => props(of(item)!, item),
    shown: (item) => held(shows(of(item)!), false),
  };
}

/**
 * The row for the same piece when a source's record carried it. Such a piece is the record and no guess, so the row has no floor:
 * a dataset's chart draws however long the words beside it are.
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
    (facts) => facts.slice(0, FACTS_SHOWN),
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

/** A conversation's data is its messages, so no rule that reads structure may take one. */
const CHAT_RULES = RULES.filter((rule) => rule.component === 'chat' || rule.component === 'note');

/**
 * How much an item says, which a structure is measured against. The model wrote the title of a text the user made,
 * so the same two lines must not be a list under a short title and a note under a long one: there the text alone counts.
 */
const wholeOf = (item: Item): number => (item.kind === 'text' && !byAgent(item) && item.text.trim() ? sizeOf(item.text) : sizeOf(item.title) + sizeOf(item.text));

/**
 * The first row that holds draws the item. A row that reads extracted structure holds only when what its card would show
 * is at least `COVERAGE_FLOOR` of what the item says, so a small structure never stands in for a long item. A card that names
 * a value, or shows a passage or a meaning, is also held to the item's own words: the role that extracted the piece checked that
 * the item states each value, and not how the values stand together. A figure the words do not name so is dropped from the card.
 */
export function byRule(item: Item, assetUrl: (id: string) => string): Draw {
  const asked = { assetUrl };
  let whole: number | undefined;
  let content: Content | undefined;
  for (const rule of item.kind === 'chat' ? CHAT_RULES : RULES) {
    if (!rule.when(item, asked)) continue;
    let draw: Draw = { component: rule.component, props: rule.props(item, asked) };
    if (rule.reads === 'structure') {
      whole ??= wholeOf(item);
      if (rule.shown(item).reduce((sum, value) => sum + sizeOf(value), 0) < COVERAGE_FLOOR * whole) continue;
      if (READS_WORDS.has(rule.component)) {
        const mend = mended(draw, (content ??= contentOf(item, assetUrl, true)), 'rule');
        if ('fault' in mend || (mend.dropped.length > 0 && sizeShown(mend.draw) < COVERAGE_FLOOR * whole)) continue;
        draw = mend.draw;
      }
    }
    if (isValidView(draw)) return draw;
  }
  return { component: 'note', props: {} };
}

// ---- components by model

/**
 * How each kind of check reads one value. `beside` is the object the value sits in and `at` the value's place in its list,
 * for a check that reads a value against its neighbours.
 */
const STANDS: Record<Stated, (value: unknown, content: Content, beside: Props, at: number) => boolean> = {
  says: (value, { text }) => typeof value === 'string' && text.says(value),
  cell: (value, { text }) => typeof value === 'string' && (value.trim() === '' || (!/[|\t]/.test(value) && text.says(value))),
  quotes: (value, { text }) => typeof value === 'string' && text.quotes(value),
  whole: (value, { text }) => typeof value === 'string' && text.whole(value),
  lead: (value, { text }) => typeof value === 'string' && (text.whole(value) || (value.trimEnd().endsWith('…') && text.leads(value.trimEnd().slice(0, -1)))),
  meaning: (value, { text }, { term }) => typeof value === 'string' && typeof term === 'string' && text.defines(term, value),
  writes: (value, { text }, { unit }) => typeof value === 'number' && text.writes(value, typeof unit === 'string' ? unit : undefined),
  unit: (value, { text }, { values }) => typeof value === 'string' && unitStands(value, values, text),
  paints: (value, { text }) => typeof value === 'string' && (value.trim().startsWith('#') ? text.paints(value) : text.says(value)),
  own: (value, content) => typeof value === 'string' && content.own(value),
  // A value the content does not state fails its own check, and its label has then nothing to stand beside.
  label: (value, { text }, { value: named }) => typeof value === 'string' && value.trim() !== '' && typeof named === 'string' && (text.names(value, named) || !text.says(named)),
  // A label with no number at its place is a chart of unequal lists, which the chart's own check refuses.
  point: (value, { text }, { values, unit: given }, at) => {
    const named: unknown = Array.isArray(values) ? values[at] : undefined;
    const unit = typeof given === 'string' ? given : undefined;
    return typeof value === 'string' && value.trim() !== '' && (typeof named !== 'number' || text.names(value, named, unit) || !text.writes(named, unit));
  },
  choice: () => true,
};

interface Leaf {
  value: unknown;
  /** How the value must stand, or nothing when no check describes it. */
  how: Stated | undefined;
  /** The object the value sits in. */
  beside: Props;
  /** The value's place in the list that holds it, or -1. */
  at: number;
  path: string;
}

/** Each plain value a view's props hold, with the check that reads it. */
function* leaves(value: unknown, check: Check | undefined, beside: Props = {}, path = '', at = -1): Generator<Leaf> {
  if (Array.isArray(value)) {
    for (const [n, one] of value.entries()) yield* leaves(one, check, beside, `${path}[${n}]`, n);
    return;
  }
  if (check === undefined || typeof check === 'string' || typeof value !== 'object' || value === null) {
    yield { value, how: typeof check === 'string' ? check : undefined, beside, at, path };
    return;
  }
  let [fields, of] = [value as Props, check as { readonly [key: string]: Check }];
  if (typeof of.byKind === 'object') {
    const { kind, ...rest } = fields;
    [fields, of] = [rest, (of.byKind[String(kind)] as { readonly [key: string]: Check } | undefined) ?? {}];
  }
  for (const [key, inner] of Object.entries(fields)) yield* leaves(inner, of[key], fields, path ? `${path}.${key}` : key);
}

const checksOf = (component: string) => CHECKS[component as ComponentId] as { props: Check; also?: (props: never, item: Item, text: Grounding) => boolean };

/**
 * Why a card may not show a value.
 * - `unstated`: the content does not state it.
 * - `label`: it names a value in words the content does not set beside that value.
 * - `cut`: it is a passage cut out of a sentence of the content.
 * - `apart`: it is a meaning the content does not give the term.
 * - `long`: it is longer than a card has room for. Only a card built from a model's reply is held to this.
 */
export type Why = 'unstated' | 'label' | 'cut' | 'apart' | 'long';
/** One value a card may not show, by its path in the props. */
export interface Fault {
  prop: string;
  why: Why;
}

/** The kinds of check that read how words stand together in the item, with what a value that fails one is. */
const TOGETHER: Partial<Record<Stated, Why>> = { label: 'label', point: 'label', whole: 'cut', lead: 'cut', meaning: 'apart' };

const kindsIn = (check: Check): Stated[] => (typeof check === 'string' ? [check] : Object.values(check).flatMap(kindsIn));
/** The cards with a value that such a check reads. */
const READS_WORDS = new Set<string>(Object.entries(CHECKS).flatMap(([component, { props }]) => (kindsIn(props).some((kind) => kind in TOGETHER) ? [component] : [])));

const tooLong = (how: Stated, value: string): boolean => (how === 'label' ? value.trim().length > ROOM.label : how === 'whole' && value.trim().length > roomOf(ROOM.passage, value));

/**
 * Every value of a view that may not be shown. For a view built from a model's reply, each value is read, and held to its length.
 * For one a rule built from a piece a role extracted, only the values are read that say how words stand together.
 */
function* faults(view: Draw, content: Content, by: 'model' | 'rule'): Generator<Fault> {
  const chosen = by === 'model';
  for (const { value, how, beside, at, path } of leaves(view.props, checksOf(view.component).props)) {
    if (!chosen && !(how && how in TOGETHER)) continue;
    if (!how) yield { prop: path, why: 'unstated' };
    else if (chosen && typeof value === 'string' && tooLong(how, value)) yield { prop: path, why: 'long' };
    else if (!STANDS[how](value, content, beside, at)) {
      // A passage the content does not hold at all is unstated, whatever else it would have had to be.
      const held = how === 'label' || how === 'point' || (typeof value === 'string' && content.text.quotes(value.replace(/…\s*$/, '')));
      yield { prop: path, why: (held && TOGETHER[how]) || 'unstated' };
    }
  }
}

/** A figure, a list entry or a table row, by its path in the props: a part of a card that may be dropped alone. */
const ENTRY = /^((?:sections\[\d+\]\.)?(?:facts|items|rows))\[(\d+)\]/;

/**
 * The view without each figure, list entry and table row that holds a fault, with the first fault of each one dropped.
 * A fault anywhere else is one no dropping mends, and it is returned alone. What is left may no longer be a valid card.
 */
function mended(view: Draw, content: Content, by: 'model' | 'rule'): { draw: Draw; dropped: Fault[] } | { fault: Fault } {
  const dropped: Fault[] = [];
  const gone = new Map<string, Set<number>>();
  for (const fault of faults(view, content, by)) {
    const entry = ENTRY.exec(fault.prop);
    if (!entry) return { fault };
    const [, list, n] = entry as unknown as [string, string, string];
    if (gone.get(list)?.has(Number(n))) continue;
    gone.set(list, (gone.get(list) ?? new Set()).add(Number(n)));
    dropped.push(fault);
  }
  if (dropped.length === 0) return { draw: view, dropped };
  const props = structuredClone(view.props);
  for (const [list, indexes] of gone) {
    const [, section, key] = /^(?:sections\[(\d+)\]\.)?(\w+)$/.exec(list) as unknown as [string, string | undefined, string];
    const holder = section === undefined ? props : (props.sections as Props[])[Number(section)]!;
    const stays = (_entry: unknown, n: number) => !indexes.has(n);
    holder[key] = (holder[key] as unknown[]).filter(stays);
    // A list's marks go with their entries, and a fact left out is one more that the card does not show.
    if (key === 'items' && Array.isArray(holder.checked)) holder.checked = holder.checked.filter(stays);
    if (key === 'facts' && typeof holder.more === 'number') holder.more += indexes.size;
  }
  return { draw: { component: view.component, props }, dropped };
}

/** The first prop of a view that does not stand in the content, by its path in the props. */
function unstated(view: Draw, content: Content): string | undefined {
  for (const { value, how, beside, at, path } of leaves(view.props, checksOf(view.component).props)) if (!how || !STANDS[how](value, content, beside, at)) return path;
  return undefined;
}

function stated(view: { component: string; props: unknown }, item: Item, content: Content): boolean {
  if (!isValidView(view)) return false;
  const draw = view as Draw;
  return unstated(draw, content) === undefined && (checksOf(draw.component).also?.(draw.props as never, item, content.text) ?? true);
}

/** Whether everything the view shows really stands in its item: each prop the way `CHECKS` says it must. */
export function grounded(view: { component: string; props: unknown }, item: Item, assetUrl: (id: string) => string): boolean {
  return stated(view, item, contentOf(item, assetUrl));
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
  for (const { value, how } of leaves(view.props, checksOf(view.component).props)) if (how && how !== 'choice' && how !== 'own') shown.add(folded(String(value)));
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

/** How each kind of section is built from its part of a reply, whole. `fitted` cuts it to the room a sheet has. */
const SECTIONS: Record<Section['kind'], (part: Part, reading: Reading) => Props> = {
  heading: ({ text }) => ({ text: text.trim() }),
  text: ({ text }) => ({ text: text.trim() }),
  figures: ({ lines }) => ({ facts: pairsOf(lines) }),
  list: ({ lines }) => ({ items: entriesIn(lines) }),
  table: ({ lines }) => tableIn(lines),
  picture: (_part, { item, asked }) => ({ src: pictureOf(item, asked) ?? '' }),
  excerpt: ({ text, by }, { kept }) => compact({ text: unquoted(text), by: kept(by) }),
};

/** A passage cut to a length at the end of a word, so what is left is still a run of the text's own words. */
function lead(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const inWord = /[\p{L}\p{N}]$/u.test(cut) && /^[\p{L}\p{N}]/u.test(t.slice(max - 1)) && !SPACELESS.test(cut.slice(-1));
  return `${(inWord ? cut.replace(/\s*\S+$/, '') : cut).trimEnd()}…`;
}

/** A section cut to the room a sheet has. The opened card shows the item whole. */
function fitted(section: Section): Section {
  switch (section.kind) {
    case 'heading':
      return { ...section, text: lead(section.text, ROOM.heading) };
    case 'text':
      return { ...section, text: lead(section.text, ROOM.text) };
    case 'figures':
      return { ...section, facts: section.facts.slice(0, ROOM.figures) };
    case 'list':
      return { ...section, items: section.items.slice(0, ROOM.list) };
    case 'table':
      return { ...section, rows: section.rows.slice(0, ROOM.rows) };
    default:
      return section;
  }
}

/** The card of its own that a section could be, when its kind has one. */
function dedicated(section: Section): Draw | undefined {
  const { kind, ...props } = section;
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
  note: ({ emphasis }, { kept }) => compact({ emphasis: emphasis.trim().length <= 120 ? kept(emphasis) : undefined }),
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
};

/**
 * What became of one reply: the card it draws, or why it draws none and the rule's card stays.
 * - `invalid`: the library has no such card with such props.
 * - a `Why`: `prop` may not be shown, and the card does not stand without it.
 * - `small`: the card would show less than `COVERAGE_FLOOR` of the item.
 * `left` are the figures, list entries, table rows and sections the card was drawn without, or lost before it was refused, and why.
 */
export type Verdict = { draw: Draw; left?: Fault[] } | { refused: 'invalid' | 'small' | Why; component: Chosen; prop?: string; left?: Fault[] };

/** The cards that draw the item itself, so they have no share of it to fall short of, and nothing that an edit could leave standing. */
const WHOLE = new Set<string>(['note', 'idea']);

function judged(draw: Draw, component: Chosen, item: Item, content: Content): Verdict {
  if (!isValidView(draw) || (draw.component === 'idea' && !isIdea(item, true))) return { refused: 'invalid', component };
  const mend = mended(draw, content, 'model');
  if ('fault' in mend) return { refused: mend.fault.why, component, prop: mend.fault.prop };
  const { draw: card, dropped } = mend;
  // Without the parts that failed, the card must still be one: a list of one entry is no list.
  const left = dropped.length > 0 ? { left: dropped } : {};
  if (dropped.length > 0 && !isValidView(card)) return { refused: dropped[0]!.why, component, prop: dropped[0]!.prop, ...left };
  if (!(checksOf(card.component).also?.(card.props as never, item, content.text) ?? true)) return { refused: 'invalid', component, ...left };
  if (!WHOLE.has(card.component) && sizeShown(card) < COVERAGE_FLOOR * wholeOf(item)) return { refused: 'small', component, ...left };
  return { draw: card, ...left };
}

/**
 * The least share of its item a section must show for its own card to be drawn in place of the sheet. It is not the floor:
 * measured live, a list of about three tenths of its item, drawn alone, dropped the sentence the list hung from in three sheets of three.
 */
const ALONE_FROM = 0.5;

/** A sheet's text section that is the opening of its item and long enough to stand for it, as a note's first lines do. */
const opensItem = (section: Section, content: Content): boolean =>
  section.kind === 'text' && section.text.length >= roomOf(ROOM.opening, section.text) && content.opens(section.text.replace(/…$/, ''));

/**
 * A sheet from the sections a reply gave. More than `ROOM.sections` of them, two headings, or a heading that is not first, is no sheet.
 * When one section alone is at least `ALONE_FROM` of the item and stands as its own card, that card is drawn: a dedicated type always wins.
 * Otherwise a figure, a list entry or a table row that may not be shown is dropped, each section is cut to its room, and a section
 * that does not stand is left out. The sheet must show `COVERAGE_FLOOR` of the item, a heading not counted. Under it, a sheet is
 * drawn only for what it exists for, a key figure or line of a long item: it opens with the item's own opening, as a note would.
 */
function assembled(sections: Section[], item: Item, content: Content): Verdict {
  const given = distinct(sections, (section) => folded(stable(section)));
  const headings = given.filter((section) => section.kind === 'heading').length;
  if (given.length > ROOM.sections || headings > 1 || (headings === 1 && given[0]!.kind !== 'heading')) return { refused: 'invalid', component: 'sheet' };

  const alone = given
    .flatMap((section) => dedicated(section) ?? [])
    .filter((draw) => sizeShown(draw) >= ALONE_FROM * wholeOf(item))
    .sort((a, b) => sizeShown(b) - sizeShown(a))
    .map((draw) => judged(draw, 'sheet', item, content))
    .find((verdict) => 'draw' in verdict);
  if (alone) return alone;

  const left: Fault[] = [];
  const stand = given.flatMap((section, n) => {
    const here = ({ prop, why }: Fault): Fault => ({ prop: prop.replace('sections[0]', `sections[${n}]`), why });
    const mend = mended({ component: 'sheet', props: { sections: [section] } }, content, 'model');
    if ('fault' in mend) {
      left.push(here(mend.fault));
      return [];
    }
    left.push(...mend.dropped.map(here));
    const parsed = SECTION.safeParse(fitted((mend.draw.props.sections as Section[])[0]!));
    if (!parsed.success && mend.dropped.length === 0) left.push({ prop: `sections[${n}]`, why: 'unstated' });
    return parsed.success ? [parsed.data] : [];
  });
  const sheet: Draw = { component: 'sheet', props: { sections: stand } };
  const lost = left.length > 0 ? { left } : {};
  if (!isValidView(sheet)) return left.length === 0 ? { refused: 'invalid', component: 'sheet' } : { refused: left[0]!.why, component: 'sheet', prop: left[0]!.prop, ...lost };
  const parts = stand.filter((section) => section.kind !== 'heading');
  const small = sizeShown({ component: 'sheet', props: { sections: parts } }) < COVERAGE_FLOOR * wholeOf(item);
  if (small && !parts.some((section) => opensItem(section, content))) return { refused: 'small', component: 'sheet', ...lost };
  return { draw: sheet, ...lost };
}

/** The card one reply of the model draws for its item, after every check a card must pass, or why it draws none. */
export function byModel(reply: Entry, item: Item, assetUrl: (id: string) => string): Verdict {
  const content = contentOf(item, assetUrl);
  const reading: Reading = { item, asked: { assetUrl }, text: content.text, kept: (value) => (value.trim() && content.text.says(value) ? value.trim() : undefined) };
  const props = BUILT[reply.component](reply, reading);
  return reply.component === 'sheet' ? assembled(props.sections as Section[], item, content) : judged({ component: reply.component, props }, reply.component, item, content);
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
- note: prose that holds nothing a reader would want to see at a glance, such as a reflection, an argument, a description or a story. You may give emphasis: one short phrase copied from the text that deserves to stand out.
- idea: the item is one short thought or what-if of the user's own, in a phrase or a sentence. A chore, a name, a caution or a definition is not an idea.
- quote: the item is mainly someone's words. passage is the words, whole and at most ${ROOM.passage.spaced} characters (${ROOM.passage.spaceless} in Chinese or Japanese), and by the speaker when the text names one.
- fact: the item is mainly one number or short value. passage is the value as the text writes it, and subject its label: a few words of the same sentence that say what it measures.
- facts: the item is mainly two to six figures or attributes. lines has one "label | value" for each, the value as the text writes it.
- steps: the item is an ordered procedure. lines has one step each, without its number.
- list: the item is mainly a list of things in no particular order. lines has one entry each, without its bullet.
- chart: the item is mainly several numbers of the same kind that are worth comparing. labels and numbers have equal length, and unit is given when the text states one.
- breakdown: the item is mainly the shares of one whole, in percent, adding up to a hundred. labels, numbers and unit, as for chart.
- table: the item is mainly rows and columns. lines has the row of column heads first and then one row each, with " | " between cells.
- qa: the item asks one question and answers it. subject is the question and passage the answer.
- definition: the item says what one term means. subject is the term and passage the meaning, from the sentence that holds the term or the one next to it, up to the end of a sentence.
- proscons: the item weighs one choice. left has the points for and right the points against.
- callout: the item is mainly a warning, a caveat or a reminder the reader must not miss. passage is that sentence, whole, and tone is "caution" for a warning or "note" for a remark.
- excerpt: the item is mainly a passage copied out of a longer source. passage is the passage, whole and no longer than a quote, and by where it sits in the source when the text says.
- sheet: an assembled card, for an item with two or more kinds of part worth showing that no card above covers. sections has two to four parts in reading order, a heading counted. Each has a kind:
  - heading: text is a few words from the item that name it. At most one, and first.
  - text: text is the item's opening, copied from its first word: one or two whole sentences, and at least ${ROOM.opening.spaced} characters of a long item (${ROOM.opening.spaceless} in Chinese or Japanese).
  - figures: lines has one to four "label | value", the value as the text writes it.
  - list: lines has two to eight entries.
  - table: lines has the row of heads first, then up to five rows of up to four cells, with " | " between cells.
  - excerpt: text is words the item quotes, and by who said them when the text names them.
  - picture: the item's own picture. Only for an item marked "picture: yes".

How to choose:
- Prefer a dedicated card. Choose one when its structure is what the item mainly is: at least a fifth of the text.
- Choose sheet only when the item has two or more kinds of part worth showing and no dedicated card covers at least a fifth of it. For a longer item, ask what a reader coming back to it would want to see at a glance: the figures it reports, the things it lists such as decisions, next steps or open questions, a line someone said. When it holds at least one of these among its prose, choose sheet, with a text part for the sentence that says what the item is about and a part for each of them. A sheet needs at least one part that is not text.
- Choose note when nothing fits. Do not force a structure onto prose, and do not pick out a passing number, date or name: a year or an age in a story is not a figure.
- Copy every value from the item's own text, word for word and in its language: a passage with its punctuation, a number as it is written. Never add, estimate, convert, translate or round.
- A passage is whole sentences or whole lines: it begins where one begins and ends where one ends. Never cut words off a sentence.
- The label of a figure, and of a number in a chart or a breakdown, is made only of words that stand in the same sentence, line or table row as its value: pick a few of them, at most ${ROOM.label} characters, and add no word of your own.
- Write each figure, list entry and table row once.
- Return one entry per item, with the id exactly as given. Fill only the fields named for the chosen card, and leave every other field as an empty string or an empty list. The card already has the item's title and text: never copy either into a field. An idea fills nothing, and a note nothing but emphasis.

Items:

${items}`;
}

const REFUSED: Record<Extract<Verdict, { refused: string }>['refused'], (prop?: string) => string> = {
  invalid: () => 'is not one the library accepts',
  unstated: (prop) => `shows ${prop}, which the content does not state`,
  label: (prop) => `names a value at ${prop} in words the content does not set beside it`,
  cut: (prop) => `shows ${prop}, which is not a whole passage of the content`,
  apart: (prop) => `gives its term a meaning at ${prop} that the content does not give it`,
  long: (prop) => `shows ${prop}, which is longer than a card has room for`,
  small: () => 'would show under a fifth of it',
};
const LEFT: Record<Why, string> = {
  unstated: 'the content does not state it',
  label: 'the content does not set its label beside its value',
  cut: 'it is not a whole passage of the content',
  apart: 'the content does not give the term this meaning',
  long: 'it is longer than a card has room for',
};

/** The card a reply draws for its item, or nothing, with a line in the run log that names the item and the prop that failed. */
export function drawn(ctx: RoleContext, reply: Entry, item: Item): Draw | undefined {
  const verdict = byModel(reply, item, (id) => ctx.assets.url(id));
  const name = `"${clip(item.title, 40)}"`;
  const card = 'refused' in verdict ? verdict.component : verdict.draw.component;
  // What a refusal names needs no second line.
  for (const { prop, why } of verdict.left ?? []) if (!('refused' in verdict) || prop !== verdict.prop) ctx.note(ROLE, `Left ${prop} out of the ${card} for ${name}: ${LEFT[why]}.`);
  if ('refused' in verdict) {
    ctx.note(ROLE, `Kept ${name} as the rules drew it: the model's ${verdict.component} ${REFUSED[verdict.refused](verdict.prop)}.`);
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
 * An item with no entry here got no answer, because its call failed, the reply left it out, or the pass was full.
 */
async function askComponents(ctx: RoleContext, open: Open[]): Promise<Map<Id, Draw | undefined>> {
  const out = new Map<Id, Draw | undefined>();
  const asked = open.slice(0, MAX_ASKED_ITEMS);
  const asset = { assetUrl: (id: string) => ctx.assets.url(id) };

  /** One call. A call that fails or times out is tried once more as two halves, since a smaller call is a faster one. */
  const ask = async (part: Open[], again: boolean): Promise<void> => {
    let reply: ComponentsReply;
    try {
      reply = await ctx.model.json({ role: `${ROLE}.components`, system: COMPONENTS_SYSTEM, user: componentsPrompt(part, asset), schema: ComponentsReply, effort: 'low' });
    } catch (err) {
      const items = `${part.length} ${part.length === 1 ? 'item' : 'items'}`;
      ctx.note(ROLE, `A call to choose components for ${items} failed (${message(err)}). ${again ? 'Asking once more.' : `Kept the rule-based views of ${part.length === 1 ? 'it' : 'them'}.`}`);
      if (!again) return;
      const half = Math.ceil(part.length / 2);
      await Promise.all([part.slice(0, half), part.slice(half)].filter((some) => some.length > 0).map((some) => ask(some, false)));
      return;
    }
    // An entry counts once, and only for an item this call asked about.
    const waiting = new Map(part.map(({ node, item }) => [node.id, item]));
    for (const entry of reply.items) {
      const item = waiting.get(entry.id);
      if (item && waiting.delete(entry.id)) out.set(entry.id, drawn(ctx, entry, item));
    }
  };

  const calls = Math.ceil(asked.length / ASKED_PER_CALL);
  const each = Math.ceil(asked.length / calls);
  await Promise.all(Array.from({ length: calls }, (_v, n) => ask(asked.slice(n * each, (n + 1) * each), true)));
  return out;
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

/**
 * Brings one rule-made composite up to date. The pool's own group of that kind is left alone when
 * nothing changed, and replaced when its membership would. Groups of other kinds keep their members.
 */
function settle(
  ctx: RoleContext,
  pool: Pool,
  out: Command[],
  composite: CompositeId,
  fits: (node: Node) => boolean,
  build: (candidates: Node[]) => GroupDraft | null,
): void {
  const byId = new Map(pool.nodes.map((n) => [n.id, n]));
  const own = pool.standing.find((g) => g.composite === composite && g.members.every((id) => fits(byId.get(id)!)));
  const draft = build(pool.nodes.filter((n) => fits(n) && (!pool.taken.has(n.id) || own?.members.includes(n.id))));
  if (!draft || (own && sameGroup(own, draft))) return;
  if (own) {
    out.push({ type: 'removeGroup', id: own.id });
    pool.standing = pool.standing.filter((g) => g !== own);
    for (const id of own.members) pool.taken.delete(id);
  }
  add(ctx, pool, draft, out);
}

/** Splits each parent's children into pools, clears groups that no longer hold, and applies the gallery and timeline rules. */
function survey(ctx: RoleContext, parents: Node[], componentOf: (node: Node) => string, out: Command[]): Pool[] {
  const pools: Pool[] = [];
  const when = (node: Node) => str(ctx.mind.items.get(node.itemId)?.data.when);
  for (const parent of parents) {
    const children = ctx.mind.children(parent.id);
    const statusOf = new Map(children.map((n) => [n.id, n.status]));
    const anchored = [...ctx.mind.groups.values()].filter((g) => g.anchor === parent.id);
    for (const status of ['kept', 'pick'] as const) {
      const standing = anchored.filter((g) => g.members.every((id) => statusOf.get(id) === status));
      const pool: Pool = {
        parent,
        nodes: children.filter((n) => n.status === status),
        standing,
        taken: new Set(standing.flatMap((g) => g.members)),
        asked: [],
      };
      settle(
        ctx,
        pool,
        out,
        'gallery',
        (n) => PICTURE_LED.has(componentOf(n)),
        (nodes) => (nodes.length >= 3 ? { composite: 'gallery', title: '', members: nodes.map((n) => n.id), props: {} } : null),
      );
      settle(
        ctx,
        pool,
        out,
        'timeline',
        (n) => when(n) !== undefined,
        (nodes) => {
          if (nodes.length < 3) return null;
          const times = new Map(nodes.map((n) => [n.id, timeOf(when(n)!)]));
          const ordered = [...times.values()].every((t) => t !== null) ? [...nodes].sort((a, b) => times.get(a.id)! - times.get(b.id)!) : nodes;
          return {
            composite: 'timeline',
            title: '',
            members: ordered.map((n) => n.id),
            props: { labels: Object.fromEntries(ordered.map((n) => [n.id, clip(when(n)!, 40)])) },
          };
        },
      );
      pools.push(pool);
    }
    // A group that now mixes kept nodes with picks, or names a node that moved away, no longer holds.
    for (const g of anchored) {
      const status = statusOf.get(g.members[0]!);
      if (!status || g.members.some((id) => statusOf.get(id) !== status)) out.push({ type: 'removeGroup', id: g.id });
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
${LAYOUT_OPTION}

Rules:
- A timeline, sequence or cluster needs at least 3 members. A comparison needs 2 to 4.
- A node belongs to at most one group.
- Never put a kept sibling and a suggested sibling in the same group.
- Use the parent and member ids exactly as given.
- title is a few words: the theme, or what is being compared.
- Fill only the fields of the chosen arrangement. Leave the others as an empty string or an empty list.
- Choose layout only when no other arrangement fits.

${blocks.join('\n\n')}`;
}

function draftFrom(ctx: RoleContext, g: CompositesReply['groups'][number], ids: Id[]): GroupDraft | null {
  const read = new Map<Id, Grounding>();
  const content = (id: Id) => {
    const item = ctx.mind.itemOf(id);
    if (!read.has(id)) read.set(id, grounding(`${item.title}\n${item.text}\n${item.summary}\n${str(item.data.when) ?? ''}`));
    return read.get(id)!;
  };
  const title = clip(g.title, 40);
  switch (g.composite) {
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
  const said = new Map(cardsOf(parsed.tree).map((id) => {
    const item = ctx.mind.itemOf(id);
    return [id, grounding(`${item.title}\n${item.text}\n${item.summary}\n${str(item.data.when) ?? ''}`)];
  }));
  const stands = (label: string, under: string[]) =>
    label.length <= LIMITS.label && (under.some((id) => said.get(id)!.says(label)) || label.split(/\s+/).every((word) => under.every((id) => said.get(id)!.says(word))));
  const grounded = (part: LayoutPart): LayoutPart => {
    if (part.kind === 'card') return part;
    const { label, ...rest } = part;
    const children = part.children.map(grounded);
    return label && stands(label, cardsOf(part)) ? { ...rest, label, children } : { ...rest, children };
  };
  const tree = collapse(grounded(parsed.tree) as Box);
  return { composite: 'layout', title: clip(g.title, 40), members: cardsOf(tree), props: { tree } };
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
    });
  } catch (err) {
    ctx.note(ROLE, `The model could not look for composites (${message(err)}). Kept the rule-based groups.`);
    return;
  }
  for (const g of reply.groups) {
    const members = [...new Set(g.composite === 'layout' ? g.parts.filter((part) => part.kind === 'card').map((part) => part.id) : g.members)];
    const pool = asked.find((p) => p.parent.id === g.parent && members.length > 0 && members.every((id) => p.asked.includes(id)));
    if (!pool) continue;
    const draft = draftFrom(
      ctx,
      g,
      members.filter((id) => !pool.taken.has(id)),
    );
    if (draft) add(ctx, pool, draft, out);
  }
}

function stack(ctx: RoleContext, pool: Pool, componentOf: (node: Node) => string, out: Command[]): void {
  for (const component of new Set(pool.nodes.map(componentOf))) {
    settle(
      ctx,
      pool,
      out,
      'stack',
      (n) => componentOf(n) === component,
      (nodes) => {
        if (nodes.length <= STACK_ABOVE) return null;
        const under = [...nodes].sort((a, b) => b.importance - a.importance || a.order - b.order).slice(STACK_KEEPS);
        return { composite: 'stack', title: `${under.length} more`, members: under.map((n) => n.id), props: {} };
      },
    );
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
 * An unsure item the pass got no answer for keeps `by: 'default'`, and `later` is told of it.
 */
export const renderer: Roles['renderer'] = async (ctx, { nodeIds, edited = [], again = false, later }) => {
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
  const pools = survey(ctx, parents, componentOf, groups);

  const [answers] = await Promise.all([askComponents(ctx, open), again ? undefined : askComposites(ctx, pools, new Set(nodes.map((n) => n.id)), groups)]);
  for (const [id, draw] of answers) if (draw) draws.set(id, draw);
  for (const pool of pools) stack(ctx, pool, componentOf, groups);

  const asked = new Set(open.map(({ node }) => node.id));
  const views: Command[] = [];
  for (const node of nodes) {
    const draw = draws.get(node.id);
    if (!draw) continue;
    // An unsure item the model did not answer for keeps the rule's card as a default, so the next pass asks again.
    const by = asked.has(node.id) && !answers.has(node.id) ? 'default' : 'renderer';
    if (sameView(draw, node.view) && (!asked.has(node.id) || node.view.by === by)) continue;
    const view: View = { ...draw, by };
    views.push({ type: 'setView', id: node.id, view });
  }
  const owed = open.flatMap(({ node }) => (answers.has(node.id) ? [] : [node.id]));
  if (owed.length > 0) later?.(owed);
  const removals = groups.filter((c) => c.type === 'removeGroup');
  return [...views, ...removals, ...groups.filter((c) => c.type !== 'removeGroup')];
};
