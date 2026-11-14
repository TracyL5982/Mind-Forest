import { z } from 'zod';
import type { Item, View } from './domain.ts';
import type { Grounding } from './grounding.ts';

/** A string a card shows as words: at least one character that is not white space. */
const words = z.string().regex(/\S/);

const SPACELESS = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]/u;

/**
 * Every bound on how much a card built from a model's reply may show. A length is in characters. A pair is one bound for a script
 * written with spaces and one for a script written without, which says as much in half the room.
 */
export const ROOM = {
  /** A sheet's heading. Whoever builds the sheet cuts a longer one to this, with an ellipsis. */
  heading: 80,
  /** A sheet's passage of text, cut the same way. */
  text: 280,
  /** The label of a figure. A longer one does not read at a glance beside its value. */
  label: 40,
  /** A quote, an excerpt or a callout. A longer passage is the item itself, which a note shows better. */
  passage: { spaced: 400, spaceless: 200 },
  /** The least opening text with which a sheet may show under a fifth of its item. */
  opening: { spaced: 120, spaceless: 60 },
  /** The most figures, list entries, table rows and table columns in one section of a sheet, and the most sections, a heading counted. */
  figures: 4,
  list: 8,
  rows: 5,
  columns: 4,
  sections: 4,
} as const;

/** The bound of a pair that holds for this text. */
export const roomOf = (bound: { spaced: number; spaceless: number }, text: string): number => (SPACELESS.test(text) ? bound.spaceless : bound.spaced);

/** One section of a `sheet`. A list or a table past its size is cut by whoever builds the sheet; the opened card shows the item whole. */
export const SECTION = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('heading'), text: words.max(ROOM.heading) }),
  /** A passage of the item, whole, or its opening words cut short with an ellipsis. */
  z.strictObject({ kind: z.literal('text'), text: words.max(ROOM.text) }),
  z.strictObject({ kind: z.literal('figures'), facts: z.array(z.strictObject({ label: words.max(ROOM.label), value: words })).min(1).max(ROOM.figures) }),
  z.strictObject({ kind: z.literal('list'), items: z.array(words).min(2).max(ROOM.list) }),
  z
    .strictObject({ kind: z.literal('table'), heads: z.array(z.string()).min(2).max(ROOM.columns), rows: z.array(z.array(z.string())).min(1).max(ROOM.rows) })
    .refine((table) => table.rows.every((row) => row.length === table.heads.length)),
  /** The item's own picture. */
  z.strictObject({ kind: z.literal('picture'), src: z.string().min(1) }),
  /** Words quoted in the item, and who said them or where they stand. */
  z.strictObject({ kind: z.literal('excerpt'), text: words.refine((text) => text.length <= roomOf(ROOM.passage, text)), by: z.string().optional() }),
]);
export type Section = z.infer<typeof SECTION>;

/**
 * The component library: every way one item can be drawn.
 * Props carry only what the item itself does not already hold. A client draws from the item plus these props.
 */
export const COMPONENTS = {
  /** Title and a few lines of text. The fallback for anything. */
  note: z.object({ emphasis: z.string().optional() }),
  /** Someone's words, set large. */
  quote: z.object({ text: z.string(), by: z.string().optional() }),
  /** One number or short value with its label. */
  fact: z.object({ value: z.string(), label: z.string() }),
  image: z.object({ src: z.string(), caption: z.string().optional(), aspect: z.number().optional() }),
  video: z.object({ src: z.string(), poster: z.string().optional(), caption: z.string().optional() }),
  /** A web page: site, title, description, optional picture. */
  link: z.object({ url: z.string(), site: z.string(), description: z.string().optional(), image: z.string().optional() }),
  chart: z.object({
    chart: z.enum(['bar', 'line']),
    labels: z.array(z.string()),
    values: z.array(z.number()),
    unit: z.string().optional(),
    /** Index of the bar or point to call out. */
    mark: z.number().int().optional(),
  }),
  person: z.object({ name: z.string(), role: z.string().optional(), image: z.string().optional() }),
  /** A short excerpt of a conversation. */
  chat: z.object({
    messages: z.array(z.object({ role: z.string(), text: z.string() })).max(8),
    source: z.string().optional(),
  }),
  code: z.object({ language: z.string(), source: z.string() }),
  /** An ordered list of short steps. */
  steps: z.object({ steps: z.array(z.string()) }),
  /** Two to six figures with their labels. `more` counts the further facts the item holds. */
  facts: z.strictObject({
    facts: z.array(z.strictObject({ label: words, value: words })).min(2).max(6),
    more: z.number().int().positive().optional(),
  }),
  /** A table: every row has one cell for each head, and a cell may be empty. All rows are here; a client shows what fits. */
  table: z
    .strictObject({ heads: z.array(z.string()).min(2), rows: z.array(z.array(z.string())).min(1) })
    .refine((p) => p.rows.every((row) => row.length === p.heads.length)),
  /** A list in no particular order. With `checked`, a checklist: one mark for each item. */
  list: z
    .strictObject({ items: z.array(words).min(2), checked: z.array(z.boolean()).optional() })
    .refine((p) => p.checked === undefined || p.checked.length === p.items.length),
  /** Parts of a whole: two to eight shares, one value for each label. */
  breakdown: z
    .strictObject({ labels: z.array(z.string()).min(2).max(8), values: z.array(z.number().nonnegative()), unit: z.string().optional() })
    .refine((p) => p.labels.length === p.values.length),
  /** One question and its answer. */
  qa: z.strictObject({ question: z.string().min(1), answer: z.string().min(1) }),
  /** A caveat or a remark set apart from the rest. */
  callout: z.strictObject({ text: z.string().min(1), tone: z.enum(['caution', 'note']) }),
  /** A passage of a longer source, where it sits there, and the source's name. */
  excerpt: z.strictObject({ text: z.string().min(1), at: z.string().optional(), source: z.string().optional() }),
  /** One term and what it means. */
  definition: z.strictObject({ term: z.string().min(1), definition: z.string().min(1) }),
  /** A short thought. The client draws the item's title large. */
  idea: z.strictObject({}),
  /** The points for and the points against, side by side. */
  proscons: z.strictObject({ pros: z.array(words).min(1), cons: z.array(words).min(1) }),
  /** Colours with their names. `value` is a hex colour of 3, 4, 6 or 8 digits or a CSS colour name, so nothing else can reach a style. */
  swatch: z.strictObject({ colours: z.array(z.strictObject({ name: words, value: z.string().regex(/^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{1,30})$/i) })).min(2) }),
  /** A work to look at, with what its collection records. `src` is its picture. */
  artwork: z.strictObject({
    src: z.string().min(1),
    maker: z.string().optional(),
    date: z.string().optional(),
    medium: z.string().optional(),
    holder: z.string().optional(),
  }),
  /** A paper or a book. `more` is true when it has further authors than the list names. */
  reference: z.strictObject({
    kind: z.enum(['paper', 'book']),
    authors: z.array(z.string()),
    more: z.literal(true).optional(),
    year: z.string().optional(),
    venue: z.string().optional(),
    url: z.string().optional(),
  }),
  /** A place by name. `src` is the item's picture, when it has one. */
  place: z.strictObject({ name: z.string().min(1), src: z.string().optional() }),
  /**
   * A card assembled from sections, for content no single type covers: four at most, a heading counted. A heading, when there is one,
   * comes first. Two sections at least are no heading, and a sheet of nothing but passages of text is a note, so one of them is of another kind.
   */
  sheet: z.strictObject({ sections: z.array(SECTION).min(1).max(ROOM.sections) }).refine(({ sections }) => {
    const parts = sections.filter((section) => section.kind !== 'heading');
    return sections.length - parts.length <= 1 && sections.slice(1).every((section) => section.kind !== 'heading') && parts.length >= 2 && parts.some((section) => section.kind !== 'text');
  }),
} as const;
export type ComponentId = keyof typeof COMPONENTS;
export const COMPONENT_IDS = Object.keys(COMPONENTS) as ComponentId[];
export type PropsOf<C extends ComponentId> = z.infer<(typeof COMPONENTS)[C]>;

/**
 * How one value in a view's props must stand in its item before a card may show it.
 * The content is the item's title and text and the values of its `data`, without the addresses `data` holds.
 * - `says`: the content states these words. `cell` is the same, may be empty, and holds no "|" or tab, which would make it two cells.
 * - `quotes`: the content holds this passage as one stretch.
 * - `whole`: the same, and the passage begins where a sentence, a line or quoted words begin and ends where one ends: nothing is cut off it.
 * - `lead`: a whole passage, or the opening of one cut short with an ellipsis.
 * - `meaning`: the passage the content gives as the meaning of the `term` beside it in the props, in the term's sentence or the next one over.
 * - `writes`: the content writes this number. When the `unit` beside it in the props scales it, as 万 and k do, the content writes it with that unit: "2189万" for 2189 in 万.
 * - `unit`: the content states these words, or writes them against one of the `values` beside them in the props, as "45%" writes "%".
 * - `paints`: the content writes this colour, a hex value as a whole or a colour name as words.
 * - `own`: one of the item's own values, whole or cut short with an ellipsis: an address, its site, its source, its summary, its text, a value in its `data`.
 * - `label`: words of the content that name the `value` beside them in the props: every one stands in the sentence, line or table row that holds the value.
 * - `point`: the same for the number at the same place in the `values` beside them, as a chart's labels are.
 * - `choice`: how to draw, not what to show.
 */
export type Stated = 'says' | 'cell' | 'quotes' | 'whole' | 'lead' | 'meaning' | 'writes' | 'unit' | 'paints' | 'own' | 'label' | 'point' | 'choice';

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
type Fields<T> = { readonly [K in keyof T]-?: Check<NonNullable<T[K]>> };

/**
 * One way of standing for a plain value, the same shape as the props for an object, and the element's shape for a list.
 * An object that is one of several shapes told apart by `kind` has a check for each kind under `byKind`, over its other keys.
 */
export type Check<T = unknown> = unknown extends T
  ? Stated | { readonly [key: string]: Check }
  : [T] extends [readonly (infer E)[]]
    ? Check<E>
    : [T] extends [object]
      ? IsUnion<T> extends true
        ? [T] extends [{ kind: string }]
          ? { readonly byKind: { readonly [K in T['kind']]: Fields<Omit<Extract<T, { kind: K }>, 'kind'>> } }
          : never
        : Fields<T>
      : Stated;

type ContentChecks = {
  readonly [C in ComponentId]: {
    readonly props: Check<PropsOf<C>>;
    /** What the props must also satisfy as a whole, where one value's check cannot say it. */
    readonly also?: (props: PropsOf<C>, item: Item, text: Grounding) => boolean;
  };
};

/** The content check of every component. The type refuses a component, or a prop of one, that has no entry here. */
export const CHECKS: ContentChecks = {
  note: { props: { emphasis: 'says' } },
  quote: { props: { text: 'whole', by: 'says' } },
  fact: { props: { value: 'says', label: 'label' }, also: (p) => p.value.length <= 32 },
  image: { props: { src: 'own', caption: 'own', aspect: 'choice' } },
  video: { props: { src: 'own', poster: 'own', caption: 'own' } },
  link: { props: { url: 'own', site: 'own', description: 'own', image: 'own' } },
  chart: {
    props: { chart: 'choice', labels: 'point', values: 'writes', unit: 'unit', mark: 'choice' },
    also: (p) => p.labels.length >= 2 && p.labels.length === p.values.length,
  },
  person: { props: { name: 'says', role: 'says', image: 'own' } },
  chat: { props: { messages: { role: 'own', text: 'own' }, source: 'own' } },
  code: { props: { language: 'choice', source: 'own' } },
  steps: { props: { steps: 'says' }, also: (p) => p.steps.length >= 2 },
  facts: {
    props: { facts: { label: 'label', value: 'says' }, more: 'choice' },
    also: (p, item) => p.more === undefined || (Array.isArray(item.data.facts) && p.more === item.data.facts.length - p.facts.length),
  },
  table: { props: { heads: 'cell', rows: 'cell' } },
  list: {
    props: { items: 'says', checked: 'choice' },
    // A mark stands when the text carries it on the item's own line, or the data holds it for that item.
    also: (p, item, text) => {
      const [items, marks] = [item.data.items, item.data.checklist];
      const kept = (entry: string) => (Array.isArray(items) && Array.isArray(marks) && items.includes(entry) ? marks[items.indexOf(entry)] : undefined);
      return p.checked === undefined || p.checked.every((mark, n) => text.ticks(p.items[n]!) === mark || kept(p.items[n]!) === mark);
    },
  },
  // Shares of one whole add up to it. A percent that the text rounded may leave the sum one off.
  breakdown: { props: { labels: 'point', values: 'writes', unit: 'unit' }, also: (p) => Math.abs(p.values.reduce((sum, value) => sum + value, 0) - 100) <= 1 },
  qa: { props: { question: 'says', answer: 'says' } },
  callout: { props: { text: 'whole', tone: 'choice' } },
  excerpt: { props: { text: 'whole', at: 'says', source: 'own' } },
  definition: { props: { term: 'says', definition: 'meaning' } },
  idea: { props: {} },
  proscons: { props: { pros: 'says', cons: 'says' } },
  swatch: { props: { colours: { name: 'says', value: 'paints' } } },
  artwork: { props: { src: 'own', maker: 'says', date: 'says', medium: 'says', holder: 'says' } },
  reference: {
    props: { kind: 'own', authors: 'says', more: 'choice', year: 'says', venue: 'says', url: 'own' },
    also: (p, item) => p.more === undefined || item.data.authorsCut === true,
  },
  place: { props: { name: 'says', src: 'own' } },
  sheet: {
    props: {
      sections: {
        byKind: {
          heading: { text: 'says' },
          text: { text: 'lead' },
          figures: { facts: { label: 'label', value: 'says' } },
          list: { items: 'says' },
          table: { heads: 'cell', rows: 'cell' },
          picture: { src: 'own' },
          excerpt: { text: 'whole', by: 'says' },
        },
      },
    },
  },
};

/**
 * The composite library: every way several sibling nodes can be drawn as one arrangement.
 * Member ids in props are node ids.
 */
export const COMPOSITES = {
  /** Pictures and clips side by side. */
  gallery: z.object({ columns: z.number().int().min(1).max(6).optional() }),
  /** Members along a time axis. `labels` gives each member its date or period. */
  timeline: z.object({ labels: z.record(z.string(), z.string()) }),
  /** Members as columns, criteria as rows. `cells[memberId][i]` answers `criteria[i]`. */
  comparison: z.object({ criteria: z.array(z.string()), cells: z.record(z.string(), z.array(z.string())) }),
  /** Members in a meaningful order: steps, an argument, a walkthrough. */
  sequence: z.object({}),
  /** Members that share a theme, drawn close together under a label. */
  cluster: z.object({ theme: z.string().optional() }),
  /** Many similar members, piled so only the top shows until opened. */
  stack: z.object({}),
} as const;
export type CompositeId = keyof typeof COMPOSITES;
export const COMPOSITE_IDS = Object.keys(COMPOSITES) as CompositeId[];

export function isValidView(view: { component: string; props: unknown }): boolean {
  const schema = COMPONENTS[view.component as ComponentId];
  return schema !== undefined && schema.safeParse(view.props).success;
}

export function isValidGroup(group: { composite: string; props: unknown }): boolean {
  const schema = COMPOSITES[group.composite as CompositeId];
  return schema !== undefined && schema.safeParse(group.props).success;
}

/** The view a node gets the moment it exists, before the Renderer has looked at it. */
export function defaultView(item: Item, assetUrl: (id: string) => string): View {
  const src = item.source.asset ? assetUrl(item.source.asset) : (item.source.url ?? '');
  const view = (component: ComponentId, props: Record<string, unknown>): View => ({ component, props, by: 'default' });
  switch (item.kind) {
    case 'image':
      return src ? view('image', { src }) : view('note', {});
    case 'video':
      return src ? view('video', { src }) : view('note', {});
    case 'link':
      return item.source.url
        ? view('link', { url: item.source.url, site: siteOf(item.source.url), description: item.summary || undefined })
        : view('note', {});
    case 'chat': {
      const messages = Array.isArray(item.data.messages) ? (item.data.messages as { role: string; text: string }[]) : [];
      return messages.length > 0
        ? view('chat', { messages: messages.slice(0, 4).map((m) => ({ role: m.role, text: m.text.slice(0, 280) })) })
        : view('note', {});
    }
    case 'code': {
      const code = item.data.code as { language?: string; source?: string } | undefined;
      return view('code', { language: code?.language ?? 'text', source: code?.source ?? item.text });
    }
    case 'text':
    case 'file':
      return view('note', {});
  }
}

export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
