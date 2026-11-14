import { z } from 'zod';
import type { Command, Group, Id, Item, Node, View } from '../domain.ts';
import { grounding, type Grounding } from '../grounding.ts';
import { CHECKS, isValidGroup, isValidView, siteOf, type Check, type ComponentId, type CompositeId, type Stated } from '../views.ts';
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
const AMBIGUOUS_FROM = 40;
const MAX_ASKED_ITEMS = 24;
const MAX_ASKED_POOLS = 8;
const MAX_ASKED_SIBLINGS = 12;
const STACK_ABOVE = 9;
const STACK_KEEPS = 6;
const FACTS_SHOWN = 6;
/** The least share of an item's title and text that a card drawn from its extracted structure must show. */
const COVERAGE_FLOOR = 0.2;
/** The cards that lead with a picture, which a gallery sets side by side. */
const PICTURE_LED = new Set(['image', 'video', 'artwork']);

// ---- reply schemas. Structured output wants every key present, so an empty string or list means "none".

export const ComponentsReply = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      component: z.enum(['note', 'quote', 'fact', 'steps', 'chart']),
      quoteText: z.string(),
      quoteBy: z.string(),
      factValue: z.string(),
      factLabel: z.string(),
      steps: z.array(z.string()),
      chartLabels: z.array(z.string()),
      chartValues: z.array(z.number()),
      chartUnit: z.string(),
      emphasis: z.string(),
    }),
  ),
});
export type ComponentsReply = z.infer<typeof ComponentsReply>;

export const CompositesReply = z.object({
  groups: z.array(
    z.object({
      parent: z.string(),
      composite: z.enum(['timeline', 'comparison', 'sequence', 'cluster']),
      title: z.string(),
      members: z.array(z.string()),
      labels: z.array(z.string()),
      criteria: z.array(z.string()),
      cells: z.array(z.object({ member: z.string(), values: z.array(z.string()) })),
      theme: z.string(),
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

/** The words a claim about an item is checked against. The summary is left out: a model wrote it. */
function body(item: Item): string {
  return `${item.title}\n${item.text}`;
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
  /** The title, the text and each value of the data that is no address. A data value is a list item, so no claim runs from one into the next. */
  text: Grounding;
  /** The value is one the item holds outside its words, whole or cut short with an ellipsis. */
  own(value: string): boolean;
}

function contentOf(item: Item, assetUrl: (id: string) => string): Content {
  const { url, asset, from } = item.source;
  const owned = [item.text, item.summary, url, url && siteOf(url), asset && assetUrl(asset), from.replace(/^chat-export:/, ''), ...held(item.data, true)].flatMap((value) => value?.trim() || []);
  return {
    text: grounding([body(item), ...held(item.data, false).map((value) => `• ${value}`)].join('\n')),
    own(value) {
      const whole = value.trim();
      const cut = whole.endsWith('…') ? whole.slice(0, -1).trimEnd() : '';
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

function factOf(item: Item) {
  const facts = factsIn(item);
  return facts.length === 1 ? { value: facts[0]!.value, label: facts[0]!.label } : factInText(item);
}

function factsOf(item: Item) {
  const facts = factsIn(item);
  return facts.length > 1 ? facts : undefined;
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

const IDEA_BELOW = 60;
const IDEA_WORDS = 3;
/** In a script written without spaces a word cannot be counted, so the thought is measured in characters. */
const IDEA_CHARACTERS = 6;
const SPACELESS = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]/u;
const ADDRESS = /^(?:[a-z][a-z\d+.-]*:\/\/)?(?:[^\s/.]+\.)+[^\s/.\d]{2,}(?:[/?#]\S*)?$/iu;

/** A phrase as it is compared: one written form and one case, with no white space and no punctuation at its end. */
const phraseKey = (phrase: string): string => uniform(phrase).toLowerCase().replace(/\s+/g, '').replace(/\p{P}+$/u, '');

/** A thought the user wrote out as a phrase, and not a label: a chore, a name, a room number, an address. */
function isIdea(item: Item): boolean {
  const [title, text] = [uniform(item.title), uniform(item.text)];
  const phrase = text || title;
  if (item.kind !== 'text' || item.origin.by !== 'user' || phrase === '' || (title !== '' && text !== '' && phraseKey(title) !== phraseKey(text))) return false;
  if ([...phrase].length >= IDEA_BELOW || /\p{Nd}/u.test(phrase) || ADDRESS.test(phrase.replace(/\p{P}+$/u, ''))) return false;
  if (SPACELESS.test(phrase)) return (phrase.match(/\p{L}/gu)?.length ?? 0) >= IDEA_CHARACTERS;
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
  { component: 'idea', reads: 'text', when: isIdea, props: () => ({}) },
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
 * is at least `COVERAGE_FLOOR` of what the item says, so a small structure never stands in for a long item.
 */
export function byRule(item: Item, assetUrl: (id: string) => string): Draw {
  const asked = { assetUrl };
  let whole: number | undefined;
  for (const rule of item.kind === 'chat' ? CHAT_RULES : RULES) {
    if (!rule.when(item, asked)) continue;
    if (rule.reads === 'structure') {
      whole ??= wholeOf(item);
      if (rule.shown(item).reduce((sum, value) => sum + sizeOf(value), 0) < COVERAGE_FLOOR * whole) continue;
    }
    const draw = { component: rule.component, props: rule.props(item, asked) };
    if (isValidView(draw)) return draw;
  }
  return { component: 'note', props: {} };
}

// ---- components by model

/** How each kind of check reads one value. `beside` is the object the value sits in, for a check that reads a value against its neighbours. */
const STANDS: Record<Stated, (value: unknown, content: Content, beside: Props) => boolean> = {
  says: (value, { text }) => typeof value === 'string' && text.says(value),
  cell: (value, { text }) => typeof value === 'string' && (value.trim() === '' || (!/[|\t]/.test(value) && text.says(value))),
  quotes: (value, { text }) => typeof value === 'string' && text.quotes(value),
  writes: (value, { text }, { unit }) => typeof value === 'number' && text.writes(value, typeof unit === 'string' ? unit : undefined),
  unit: (value, { text }, { values }) => typeof value === 'string' && unitStands(value, values, text),
  paints: (value, { text }) => typeof value === 'string' && (value.trim().startsWith('#') ? text.paints(value) : text.says(value)),
  own: (value, content) => typeof value === 'string' && content.own(value),
  label: (value) => typeof value === 'string' && value.trim() !== '',
  choice: () => true,
};

function stands(value: unknown, check: Check, content: Content, beside: Props = {}): boolean {
  if (Array.isArray(value)) return value.every((one) => stands(one, check, content, beside));
  if (typeof check === 'string') return STANDS[check](value, content, beside);
  return typeof value === 'object' && value !== null && Object.entries(value).every(([key, inner]) => key in check && stands(inner, check[key]!, content, value as Props));
}

function shown(view: { component: string; props: unknown }, item: Item, content: Content): boolean {
  if (!isValidView(view)) return false;
  const { props, also } = CHECKS[view.component as ComponentId] as { props: Check; also?: (props: never, item: Item, text: Grounding) => boolean };
  return stands(view.props, props, content) && (also?.(view.props as never, item, content.text) ?? true);
}

/** Whether everything the view shows really stands in its item: each prop the way `CHECKS` says it must. */
export function grounded(view: { component: string; props: unknown }, item: Item, assetUrl: (id: string) => string): boolean {
  return shown(view, item, contentOf(item, assetUrl));
}

function claimed(reply: ComponentsReply['items'][number], text: Grounding): Draw {
  const kept = (value: string) => (text.says(value) ? value.trim() : undefined);
  switch (reply.component) {
    case 'quote':
      return {
        component: 'quote',
        props: compact({ text: reply.quoteText.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''), by: kept(reply.quoteBy) }),
      };
    case 'fact':
      return { component: 'fact', props: { value: reply.factValue.trim(), label: clip(reply.factLabel, 80) } };
    case 'steps':
      return { component: 'steps', props: { steps: reply.steps.map((s) => s.trim()).filter(Boolean) } };
    case 'chart': {
      const unit = reply.chartUnit.trim();
      return { component: 'chart', props: chartProps(reply.chartLabels.map((l) => l.trim()), reply.chartValues, unit && unitStands(unit, reply.chartValues, text) ? unit : undefined) };
    }
    case 'note':
      return { component: 'note', props: compact({ emphasis: reply.emphasis.trim().length <= 120 ? kept(reply.emphasis) : undefined }) };
  }
}

const COMPONENTS_SYSTEM =
  'You are the Renderer of Mind Palace, a spatial brainstorming app. You choose the visual component that presents each piece of text most accurately.';

function componentsPrompt(open: { node: Node; item: Item }[]): string {
  const items = open.map(({ node, item }) => `id: ${node.id}\ntitle: ${item.title}\ntext: ${clip(item.text, TEXT_SENT)}`).join('\n\n');
  return `Below are text items from a user's brainstorm. Each is currently drawn as a plain note. For each item, decide whether another component is its truer form.

Components:
- note: a title and a few lines of text. The right answer for most items.
- quote: the item is mainly someone's words. Give quoteText, and quoteBy when the text names the speaker.
- fact: the item is mainly one number or short value. Give factValue as it is written in the text, and a factLabel of a few words saying what it measures.
- steps: the item is an ordered procedure of two or more steps. Give each step in steps.
- chart: the item gives several numbers of the same kind that are worth comparing. Give chartLabels and chartValues of equal length, and chartUnit when the text states one.

Rules:
- Take every value from the item's own text. Copy quoteText, factValue, each step, each chart label and the unit word for word. Leave out step numbers and bullets. Chart values must be numbers that appear in the text.
- Never add, estimate, convert or round a value. When the text does not hold what a component needs, choose note.
- For a note you may give emphasis: one short phrase copied from the text that deserves to stand out. Otherwise leave it empty.
- Return one entry per item, with the id exactly as given. Fill only the fields of the chosen component. Leave every other field as an empty string or an empty list.

Items:

${items}`;
}

async function askComponents(ctx: RoleContext, open: { node: Node; item: Item }[]): Promise<Map<Id, Draw>> {
  const out = new Map<Id, Draw>();
  const asked = open.slice(0, MAX_ASKED_ITEMS);
  if (asked.length === 0) return out;
  const byId = new Map(asked.map((o) => [o.node.id, o.item]));
  try {
    const reply = await ctx.model.json({
      role: `${ROLE}.components`,
      system: COMPONENTS_SYSTEM,
      user: componentsPrompt(asked),
      schema: ComponentsReply,
      effort: 'low',
    });
    for (const entry of reply.items) {
      const item = byId.get(entry.id);
      if (!item || out.has(entry.id)) continue;
      const content = contentOf(item, (id) => ctx.assets.url(id));
      const draw = claimed(entry, content.text);
      if (shown(draw, item, content)) out.set(entry.id, draw);
    }
  } catch (err) {
    ctx.note(ROLE, `The model could not choose components (${message(err)}). Kept the rule-based views.`);
  }
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

Rules:
- A timeline, sequence or cluster needs at least 3 members. A comparison needs 2 to 4.
- A node belongs to at most one group.
- Never put a kept sibling and a suggested sibling in the same group.
- Use the parent and member ids exactly as given.
- title is a few words: the theme, or what is being compared.
- Fill only the fields of the chosen arrangement. Leave the others as an empty string or an empty list.

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
  }
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
    const members = [...new Set(g.members)];
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

/** Chooses a component for each given node and composites for their siblings. Rules first, the model only where rules cannot tell. */
export const renderer: Roles['renderer'] = async (ctx, { nodeIds }) => {
  const nodes = [...new Set(nodeIds)].flatMap((id) => ctx.mind.nodes.get(id) ?? []);
  const draws = new Map<Id, Draw>();
  const open: { node: Node; item: Item }[] = [];
  const assetUrl = (id: string) => ctx.assets.url(id);
  for (const node of nodes) {
    const item = ctx.mind.items.get(node.itemId);
    if (!item) continue;
    const draw = byRule(item, assetUrl);
    const ambiguous = draw.component === 'note' && item.kind === 'text' && item.text.trim().length >= AMBIGUOUS_FROM;
    // An earlier choice that still stands in the text is kept, so a second pass costs no model call and cannot lose it.
    if (ambiguous && node.view.by === 'renderer' && grounded(node.view, item, assetUrl)) continue;
    draws.set(node.id, draw);
    if (ambiguous) open.push({ node, item });
  }
  const componentOf = (node: Node) => draws.get(node.id)?.component ?? node.view.component;

  const parentIds = new Set(nodes.flatMap((n) => n.parent ?? []));
  const parents = [...parentIds].flatMap((id) => ctx.mind.nodes.get(id) ?? []);
  const groups: Command[] = [];
  const pools = survey(ctx, parents, componentOf, groups);

  const [chosen] = await Promise.all([askComponents(ctx, open), askComposites(ctx, pools, new Set(nodes.map((n) => n.id)), groups)]);
  for (const [id, draw] of chosen) draws.set(id, draw);
  for (const pool of pools) stack(ctx, pool, componentOf, groups);

  const views: Command[] = [];
  for (const node of nodes) {
    const draw = draws.get(node.id);
    if (!draw || sameView(draw, node.view)) continue;
    const view: View = { ...draw, by: 'renderer' };
    views.push({ type: 'setView', id: node.id, view });
  }
  const removals = groups.filter((c) => c.type === 'removeGroup');
  return [...views, ...removals, ...groups.filter((c) => c.type !== 'removeGroup')];
};
