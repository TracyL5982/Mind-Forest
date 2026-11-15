import { z } from 'zod';
import { Sound, type Item, type View } from './domain.ts';
import { evaluate, reserved, wellFormed } from './formula.ts';
import { ABOVE, type Grounding, type Piece, type Shown, type Way } from './grounding.ts';
import { JOINS, KINDS, LIMITS, ROLES, withinLimits, type Box, type Part } from './layout.ts';
import { MAP } from './map.ts';

/** A string a card shows as words: at least one character that is not white space. */
const words = z.string().regex(/\S/);

const SPACELESS = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]/u;

/**
 * Every bound on how much a card built from a model's reply may show. A length is in characters. A pair is one bound for a script
 * written with spaces and one for a script written without, which says as much in half the room.
 */
export const ROOM = {
  /** A sheet's heading. A longer one is no sheet's. */
  heading: 80,
  /** A sheet's passage of text. A longer one is no sheet's. */
  text: 280,
  /** The label of a figure. A longer one does not read at a glance beside its value. */
  label: 40,
  /** A quote, an excerpt or a callout. A longer passage is the item itself, which a note shows better. */
  passage: { spaced: 400, spaceless: 200 },
  /** The most figures, list entries, table rows and table columns in one section of a sheet, and the most sections, a heading counted. */
  figures: 4,
  list: 8,
  rows: 5,
  columns: 4,
  sections: 4,
  /** A line an arrangement sets beside a member: a ranked member's reason, or the change that led to a state. */
  reason: { spaced: 140, spaceless: 70 },
  /** The name of a matrix's axis. */
  axis: 32,
  /** How far into its item's text the words a note sets apart may end, so the note draws them where they stand among its first lines. */
  emphasis: { spaced: 180, spaceless: 90 },
  /** The most values an item may state for a slider, and the most stops a slider has between its ends. */
  stated: 8,
  stops: 1000,
} as const;

/** The bound of a pair that holds for this text. */
export const roomOf = (bound: { spaced: number; spaceless: number }, text: string): number => (SPACELESS.test(text) ? bound.spaceless : bound.spaced);

/**
 * The item's own headings, labels and opening prose that a structured card draws over its structure, each as its line writes it,
 * so the card shows its whole item. The Renderer sets them; no model writes them.
 */
const above = z.array(words).min(1).max(ABOVE.lines).optional();
/** The heads row of a table of two columns that a facts grid or a chart stands on, drawn over it. */
const heads = z.tuple([z.string(), z.string()]).optional();

/** One section of a `sheet`. A section past its size is no sheet's, since a sheet shows its item whole. */
export const SECTION = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('heading'), text: words.max(ROOM.heading) }),
  /** Whole sentences of the item. */
  z.strictObject({ kind: z.literal('text'), text: words.max(ROOM.text) }),
  /** Figures, a list or a table may stand under the item's own label for them, as a list does under "Best:", which the section draws over itself. */
  z.strictObject({ kind: z.literal('figures'), label: words.max(ROOM.heading).optional(), facts: z.array(z.strictObject({ label: words.max(ROOM.label), value: words })).min(1).max(ROOM.figures) }),
  z.strictObject({ kind: z.literal('list'), label: words.max(ROOM.heading).optional(), items: z.array(words).min(2).max(ROOM.list) }),
  z
    .strictObject({ kind: z.literal('table'), label: words.max(ROOM.heading).optional(), heads: z.array(z.string()).min(2).max(ROOM.columns), rows: z.array(z.array(z.string())).min(1).max(ROOM.rows) })
    .refine((table) => table.rows.every((row) => row.length === table.heads.length)),
  /** The item's own picture. */
  z.strictObject({ kind: z.literal('picture'), src: z.string().min(1) }),
  /** Words quoted in the item, and who said them or where they stand. */
  z.strictObject({ kind: z.literal('excerpt'), text: words.refine((text) => text.length <= roomOf(ROOM.passage, text)), by: z.string().optional() }),
]);
export type Section = z.infer<typeof SECTION>;

/** One state of a toggle or a segmented control: its name, and the item's own sentences that say what holds in it. */
const STATE = z.strictObject({ name: words.max(ROOM.label), text: words.refine((text) => text.length <= roomOf(ROOM.passage, text)) });

/** A quantity's name in a formula: a letter, then letters, digits or "_", and no name the language gives a step. */
const QUANTITY = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,15}$/).refine((name) => !reserved(name));

/**
 * One control of an `explorable`. A toggle switches between two named states and a segmented control among two to four. A slider sets
 * one quantity of the formula from `min` to `max` in steps of `step`, and `values` are the values the item states for it, each on a step.
 */
export const CONTROL = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('toggle'), label: words.max(ROOM.label), states: z.array(STATE).length(2) }),
  z.strictObject({ kind: z.literal('segmented'), label: words.max(ROOM.label), states: z.array(STATE).min(2).max(4) }),
  z.strictObject({
    kind: z.literal('slider'),
    name: QUANTITY,
    label: words.max(ROOM.label),
    unit: z.string().optional(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    values: z.array(z.number()).min(2).max(ROOM.stated),
  }),
]);
export type Control = z.infer<typeof CONTROL>;
type Slider = Extract<Control, { kind: 'slider' }>;

/** What a formula gives, with its label and unit. `values` are the results the item states, the nth at each slider's nth value. */
const RESULT = { label: words.max(ROOM.label), unit: z.string().optional(), formula: z.array(z.union([z.number(), z.string()])), values: z.array(z.number()).min(2).max(ROOM.stated) };

/** What an `explorable` shows: the text of each control's state, or what its formula gives as a figure or as a curve across the first slider. */
export const OUTPUT = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text') }),
  z.strictObject({ kind: z.literal('figure'), ...RESULT }),
  z.strictObject({ kind: z.literal('chart'), ...RESULT }),
]);

/** How many steps a slider has from end to end. */
export const stopsOf = ({ min, max, step }: Slider): number => Math.round((max - min) / step);
/** The value at a slider's nth step, to twelve significant digits, so that steps of 0.1 land on 0.3 and not beside it. */
export const stopAt = ({ min, step }: Slider, n: number): number => Number((min + n * step).toPrecision(12));
const onStop = (slider: Slider, value: number): boolean => Math.abs(stopAt(slider, Math.round((value - slider.min) / slider.step)) - value) <= slider.step * 1e-6;

/** How near a formula must come to each value the item states, as a share of that value. */
export const WITHIN = 0.01;

/**
 * Text that switches with each toggle or segmented control, or one result of sliders: never both. A slider's ends lie on its steps,
 * and so does each value it states, between them. Every slider states as many values as the result, and the formula reads only sliders.
 */
function explores({ controls, output }: { controls: Control[]; output: z.infer<typeof OUTPUT> }): boolean {
  const sliders = controls.filter((control): control is Slider => control.kind === 'slider');
  if (output.kind === 'text') return sliders.length === 0 && controls.every((control) => 'states' in control && new Set(control.states.map((state) => state.name)).size === control.states.length);
  const names = sliders.map((slider) => slider.name);
  return (
    sliders.length === controls.length &&
    new Set(names).size === names.length &&
    sliders.every((slider) => {
      const steps = (slider.max - slider.min) / slider.step;
      return slider.min < slider.max && Math.abs(steps - stopsOf(slider)) < 1e-6 && stopsOf(slider) <= ROOM.stops && slider.values.length === output.values.length &&
        slider.values.every((value) => value >= slider.min && value <= slider.max && onStop(slider, value));
    }) &&
    wellFormed(output.formula, names)
  );
}

/**
 * Where an explorable's formula fails its item, or nothing. At each set of values the item states, it must give the result the item
 * states there, within `WITHIN` of it, and it must have a value at every step of each slider, the others at their first stated values.
 */
export function misses({ controls, output }: PropsOf<'explorable'>): string | undefined {
  if (output.kind === 'text') return undefined;
  const sliders = controls as Slider[];
  const at = (n: number) => Object.fromEntries(sliders.map((slider) => [slider.name, slider.values[n]!]));
  const named = (values: Record<string, number>) => sliders.map((slider) => `${slider.label} ${values[slider.name]}`).join(', ');
  for (const [n, stated] of output.values.entries()) {
    const got = evaluate(output.formula, at(n));
    if (got === undefined || Math.abs(got - stated) > Math.max(WITHIN * Math.abs(stated), 1e-9)) return `gives ${got === undefined ? 'no value' : Number(got.toPrecision(4))} at ${named(at(n))}, where the item states ${stated}`;
  }
  for (const slider of sliders) {
    for (let n = 0; n <= stopsOf(slider); n++) {
      const values = { ...at(0), [slider.name]: stopAt(slider, n) };
      if (evaluate(output.formula, values) === undefined) return `has no value at ${named(values)}`;
    }
  }
  return undefined;
}

/**
 * The component library: every way one item can be drawn.
 * Props carry only what the item itself does not already hold. A client draws from the item plus these props.
 */
export const COMPONENTS = {
  /** Title and a few lines of text. The fallback for anything. */
  note: z.object({ emphasis: z.string().optional() }),
  /** Someone's words, set large. */
  quote: z.object({ text: z.string(), by: z.string().optional(), above }),
  /** One number or short value with its label. */
  fact: z.object({ value: z.string(), label: z.string(), above, heads }),
  image: z.object({ src: z.string(), caption: z.string().optional(), aspect: z.number().optional() }),
  video: z.object({ src: z.string(), poster: z.string().optional(), caption: z.string().optional() }),
  /** A recording: where it plays from, and its length and loudness when they are known. The item's text is its transcript. */
  audio: z.strictObject({ src: z.string().min(1), seconds: Sound.shape.seconds.optional(), peaks: Sound.shape.peaks }),
  /** A web page: site, title, description, optional picture. */
  link: z.object({ url: z.string(), site: z.string(), description: z.string().optional(), image: z.string().optional() }),
  chart: z.object({
    chart: z.enum(['bar', 'line']),
    labels: z.array(z.string()),
    values: z.array(z.number()),
    unit: z.string().optional(),
    /** Index of the bar or point to call out. */
    mark: z.number().int().optional(),
    above,
    heads,
  }),
  person: z.object({ name: z.string(), role: z.string().optional(), image: z.string().optional() }),
  /** A short excerpt of a conversation. */
  chat: z.object({
    messages: z.array(z.object({ role: z.string(), text: z.string() })).max(8),
    source: z.string().optional(),
  }),
  code: z.object({ language: z.string(), source: z.string() }),
  /** An ordered list of short steps. */
  steps: z.object({ steps: z.array(z.string()), above }),
  /** Two to six figures with their labels. `more` counts the further facts the item holds. */
  facts: z.strictObject({
    facts: z.array(z.strictObject({ label: words, value: words })).min(2).max(6),
    more: z.number().int().positive().optional(),
    above,
    heads,
  }),
  /** A table: every row has one cell for each head, and a cell may be empty. All rows are here; a client shows what fits. */
  table: z
    .strictObject({ heads: z.array(z.string()).min(2), rows: z.array(z.array(z.string())).min(1), above })
    .refine((p) => p.rows.every((row) => row.length === p.heads.length)),
  /** A list in no particular order. With `checked`, a checklist: one mark for each item, read off the check box on its line. */
  list: z
    .strictObject({ items: z.array(words).min(2), checked: z.array(z.boolean()).optional(), above })
    .refine((p) => p.checked === undefined || p.checked.length === p.items.length),
  /** Parts of a whole: two to eight shares, one value for each label. */
  breakdown: z
    .strictObject({ labels: z.array(z.string()).min(2).max(8), values: z.array(z.number().nonnegative()), unit: z.string().optional(), above, heads })
    .refine((p) => p.labels.length === p.values.length),
  /** One question and its answer. */
  qa: z.strictObject({ question: z.string().min(1), answer: z.string().min(1), above }),
  /** A caveat or a remark set apart from the rest. */
  callout: z.strictObject({ text: z.string().min(1), tone: z.enum(['caution', 'note']), above }),
  /** A passage of a longer source, where it sits there, and the source's name. */
  excerpt: z.strictObject({ text: z.string().min(1), at: z.string().optional(), source: z.string().optional(), above }),
  /** One term and what it means. */
  definition: z.strictObject({ term: z.string().min(1), definition: z.string().min(1), above }),
  /** A short thought. The client draws the item's title large. */
  idea: z.strictObject({}),
  /**
   * The points for and the points against, side by side, each side under the heading or label the item gives it. A model's reply gives
   * the points and the frame finds the heads, so a card that is drawn always has them.
   */
  proscons: z.strictObject({ pros: z.array(words).min(1), cons: z.array(words).min(1), heads: z.tuple([words, words]).optional(), above }),
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
  sheet: z.strictObject({ sections: z.array(SECTION).min(1).max(ROOM.sections), above }).refine(({ sections }) => {
    const parts = sections.filter((section) => section.kind !== 'heading');
    return sections.length - parts.length <= 1 && sections.slice(1).every((section) => section.kind !== 'heading') && parts.length >= 2 && parts.some((section) => section.kind !== 'text');
  }),
  /**
   * A card a reader changes to see how a concept works: one to three controls and what they change. A toggle or a segmented control
   * shows the text of its state. Sliders set the quantities of a formula, whose result is shown as a figure or as a curve.
   */
  explorable: z.strictObject({ controls: z.array(CONTROL).min(1).max(3), output: OUTPUT, above }).refine(explores),
} as const;
export type ComponentId = keyof typeof COMPONENTS;
export const COMPONENT_IDS = Object.keys(COMPONENTS) as ComponentId[];
export type PropsOf<C extends ComponentId> = z.infer<(typeof COMPONENTS)[C]>;

/**
 * How one value in a view's props must stand in its item before a card may show it.
 * The content is the item's title and text and the values of its `data`, without the addresses `data` holds.
 * - `says`: the content states these words: a name, a date, a value an arrangement or a control sets beside its words.
 * - `shown`: words the card's frame holds to the whole item, as `Grounding.shows` reads it: a structured card's text, every piece in the
 *   item's order and every mark as written, with the lines it draws over them.
 * - `line`: one or more whole sentences, lines or cells of the item, which a note sets apart where they stand or a person card names as a role.
 * - `writes`: the content writes this number. When the `unit` beside it in the props scales it, as 万 and k do, the content writes it with that unit: "2189万" for 2189 in 万.
 * - `unit`: the content states these words, or writes them against one of the `values` beside them in the props, as "45%" writes "%".
 * - `paints`: the content writes this colour, a hex value as a whole or a colour name as words.
 * - `own`: one of the item's own values, whole or cut short with an ellipsis: an address, its site, its source, its summary, its text, a value in its `data`,
 *   which may be a number, as a recording's length is.
 * - `choice`: how to draw, not what to show.
 * - `computes`: a token of a formula, which is held to the item by what it gives, in its component's `also`.
 */
export type Stated = 'says' | 'shown' | 'line' | 'writes' | 'unit' | 'paints' | 'own' | 'choice' | 'computes';

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
    /**
     * The props the card is drawn with when its words are its whole item, with the lines it draws over them and without a part no way
     * reads, or nothing when they are not. A card is grounded when its frame is its props as they are.
     */
    readonly frame?: (props: PropsOf<C>, text: Grounding) => PropsOf<C> | undefined;
  };
};

const entry = (text: string): Piece => ({ text, entry: true });
const loose = (text: string): Piece => ({ text, entry: false });
const SIDE: Piece = { slot: 'heading' };
/** The words, folded for a comparison of how one passage opens another. */
const fold = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const alike = (a: readonly string[] | undefined, b: readonly string[] | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The props drawn as the whole item when one of the ways reads so: without what that way drops, with the lines the item sets over the
 * card, and as `fit` leaves them once it has read what the item shows.
 */
function framed<P extends { above?: string[] }>(props: P, text: Grounding, ways: Way[], fit: (props: P, shown: Shown) => P | undefined = (same) => same): P | undefined {
  const shown = text.shows(ways, props.above);
  if (!shown) return undefined;
  const way = ways[shown.way]!;
  const drops = new Set(['above', ...(way.drops ?? [])]);
  const kept = Object.fromEntries(Object.entries(props).filter(([key]) => !drops.has(key))) as P;
  return fit(written(shown.above.length > 0 ? { ...kept, above: shown.above } : kept, way, shown), shown);
}

/** A mark a piece adds for the card's slot, which the slot draws in its place: "Q:", "A:", "问：", "答：", "At:" and ">". */
const SLOT_MARK = /^\s*(?:(?:q|a|问|答|at)\s*[:：]\s*|>\s*)/iu;

/**
 * The props with each string the card was given for a piece of its item replaced by that piece as the item writes it: the item's own
 * characters, its case, its punctuation and its quotation marks, though the words were matched in their plain form.
 */
function written<P>(props: P, way: Way, shown: Shown): P {
  const queue = new Map<string, string[]>();
  let n = 0;
  for (const piece of way.pieces) {
    if ('slot' in piece) continue;
    const own = shown.texts[n++] ?? piece.text;
    const given = piece.for ?? piece.text;
    queue.set(given, [...(queue.get(given) ?? []), piece.for === undefined ? own : own.replace(SLOT_MARK, '')]);
  }
  const swap = (value: unknown, key: string): unknown => {
    if (key === 'above' || key === 'heads') return value;
    if (typeof value === 'string') return queue.get(value)?.shift() ?? value;
    if (Array.isArray(value)) return value.map((one) => swap(one, ''));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([inner, one]) => [inner, swap(one, inner)]));
    return value;
  };
  return swap(props, '') as P;
}

/** A facts grid or a chart drawn from a table of two columns carries that table's heads row, and one drawn from other lines none. */
const headed = <P extends { heads?: [string, string] }>(props: P, shown: Shown): P => {
  const { heads: _drawn, ...rest } = props;
  return (shown.heads ? { ...rest, heads: shown.heads } : rest) as P;
};

/** A chart's points as pieces: each label beside its value, the unit after the value, before it, or not written there. */
function points(labels: string[], values: number[], unit: string | undefined): Way[] {
  const sign = unit?.trim() ?? '';
  // A unit led by a currency sign stands around its number: "$120k" writes 120 in "$k".
  const around = /^\p{Sc}./u.test(sign) ? [(v: number) => `${sign[0]}${v}${sign.slice(1)}`] : [];
  const forms = sign ? [(v: number) => `${v}${sign}`, (v: number) => `${sign}${v}`, ...around, String] : [String];
  return forms.flatMap((form) => [
    { pieces: labels.flatMap((label, n) => [loose(label), loose(form(values[n]!))]), headless: true },
    { pieces: labels.flatMap((label, n) => [loose(form(values[n]!)), loose(label)]), headless: true },
  ]);
}

/** A sheet's sections as pieces, in order. An excerpt's speaker may stand before its words or after them. */
function sheetWays(sections: Section[]): Way[] {
  let ways: Piece[][] = [[]];
  for (const section of sections) {
    const label = 'label' in section && section.label ? [entry(section.label)] : [];
    const next: Piece[][] =
      section.kind === 'heading' || section.kind === 'text' ? [[entry(section.text)]]
      : section.kind === 'figures' ? [[...label, ...section.facts.flatMap((fact) => [loose(fact.label), loose(fact.value)])]]
      : section.kind === 'list' ? [[...label, ...section.items.map(entry)]]
      : section.kind === 'table' ? [[...label, ...[...section.heads, ...section.rows.flat()].map(entry)]]
      : section.kind === 'excerpt' ? (section.by ? [[loose(section.text), loose(section.by)], [loose(section.by), loose(section.text)]] : [[loose(section.text)]])
      : [[]];
    ways = ways.flatMap((way) => next.map((more) => [...way, ...more]));
  }
  return ways.map((pieces) => ({ pieces }));
}

/** The content check of every component. The type refuses a component, or a prop of one, that has no entry here. */
export const CHECKS: ContentChecks = {
  note: {
    props: { emphasis: 'line' },
    // Words set apart are drawn where they stand, so they must stand among the note's first lines.
    frame: (p, text) => {
      if (!p.emphasis) return p;
      const end = text.units(p.emphasis);
      const { emphasis: _apart, ...rest } = p;
      return end !== undefined && end <= roomOf(ROOM.emphasis, p.emphasis) ? p : rest;
    },
  },
  quote: {
    props: { text: 'shown', by: 'shown', above: 'shown' },
    // Who said the words is shown as the item writes it, or not at all.
    frame: (p, text) =>
      framed(p, text, p.by ? [{ pieces: [loose(p.text), loose(p.by)] }, { pieces: [loose(p.by), loose(p.text)] }, { pieces: [loose(p.text)], drops: ['by'] }] : [{ pieces: [loose(p.text)] }]),
  },
  fact: {
    props: { value: 'shown', label: 'shown', above: 'shown', heads: 'shown' },
    also: (p) => p.value.length <= 32,
    frame: (p, text) => framed(p, text, [{ pieces: [loose(p.label), loose(p.value)], headless: true }, { pieces: [loose(p.value), loose(p.label)], headless: true }], headed),
  },
  image: { props: { src: 'own', caption: 'own', aspect: 'choice' } },
  video: { props: { src: 'own', poster: 'own', caption: 'own' } },
  audio: { props: { src: 'own', seconds: 'own', peaks: 'own' } },
  link: { props: { url: 'own', site: 'own', description: 'own', image: 'own' } },
  chart: {
    props: { chart: 'choice', labels: 'shown', values: 'shown', unit: 'unit', mark: 'choice', above: 'shown', heads: 'shown' },
    also: (p) => p.labels.length >= 2 && p.labels.length === p.values.length,
    frame: (p, text) => framed(p, text, points(p.labels, p.values, p.unit), headed),
  },
  person: {
    props: { name: 'says', role: 'line', image: 'own' },
    frame: (p, text) => {
      const { role: _named, ...rest } = p;
      return !p.role || text.units(p.role) !== undefined ? p : rest;
    },
  },
  chat: { props: { messages: { role: 'own', text: 'own' }, source: 'own' } },
  code: { props: { language: 'choice', source: 'own' } },
  steps: {
    props: { steps: 'shown', above: 'shown' },
    also: (p) => p.steps.length >= 2,
    frame: (p, text) => framed(p, text, [{ pieces: p.steps.map(entry) }]),
  },
  facts: {
    props: { facts: { label: 'shown', value: 'shown' }, more: 'choice', above: 'shown', heads: 'shown' },
    // A grid that leaves figures out is a part of its item.
    frame: (p, text) =>
      p.more !== undefined
        ? undefined
        : framed(p, text, [{ pieces: p.facts.flatMap((f) => [loose(f.label), loose(f.value)]), headless: true }, { pieces: p.facts.flatMap((f) => [loose(f.value), loose(f.label)]), headless: true }], headed),
  },
  table: {
    props: { heads: 'shown', rows: 'shown', above: 'shown' },
    // Every row and every cell of one table, each row as the item writes it.
    frame: (p, text) =>
      framed(p, text, [{ pieces: [...p.heads, ...p.rows.flat()].map(entry) }], (q, shown) =>
        shown.rows?.length === q.rows.length + 1 && shown.rows.every((cells) => cells === q.heads.length) ? q : undefined,
      ),
  },
  list: {
    props: { items: 'shown', checked: 'shown', above: 'shown' },
    // A mark is the check box on the entry's own line. A tick or a cross the line writes is a word of the entry, and no check box.
    frame: (p, text) =>
      framed(p, text, [{ pieces: p.items.map(entry) }], (q, shown) =>
        (q.checked ? q.checked.every((mark, n) => shown.boxes[n] === mark) : shown.boxes.every((box) => box === undefined)) ? q : undefined,
      ),
  },
  // Shares of one whole add up to it. A percent that the text rounded may leave the sum one off.
  breakdown: {
    props: { labels: 'shown', values: 'shown', unit: 'unit', above: 'shown', heads: 'shown' },
    also: (p) => Math.abs(p.values.reduce((sum, value) => sum + value, 0) - 100) <= 1,
    frame: (p, text) => framed(p, text, points(p.labels, p.values, p.unit), headed),
  },
  qa: {
    props: { question: 'shown', answer: 'shown', above: 'shown' },
    // The card's two slots say what "Q:" and "A:" say, so it may draw them in place of the marks.
    frame: (p, text) =>
      framed(p, text, [
        { pieces: [entry(p.question), entry(p.answer)] },
        { pieces: [{ ...entry(`Q: ${p.question}`), for: p.question }, { ...entry(`A: ${p.answer}`), for: p.answer }] },
        { pieces: [{ ...entry(`问：${p.question}`), for: p.question }, { ...entry(`答：${p.answer}`), for: p.answer }] },
      ]),
  },
  callout: { props: { text: 'shown', tone: 'choice', above: 'shown' }, frame: (p, text) => framed(p, text, [{ pieces: [entry(p.text)] }]) },
  excerpt: {
    props: { text: 'shown', at: 'says', source: 'own', above: 'shown' },
    // The card draws a passage as quoted and where it sits, so it may stand for a ">" that marks the passage and a line that says "At:".
    frame: (p, text) => {
      const quoted = [entry(p.text), { ...entry(`> ${p.text}`), for: p.text }];
      const where = p.at ? [{ ...entry(`At: ${p.at}`), for: p.at }] : [];
      return framed(p, text, quoted.flatMap((passage) => [{ pieces: [passage] }, ...where.map((at) => ({ pieces: [passage, at] }))]));
    },
  },
  definition: {
    props: { term: 'says', definition: 'shown', above: 'shown' },
    // The item says what the term means only where its meaning opens with the term, "Parallax is the shift…", or the term labels the
    // line it opens, "Parallax: the shift…". A term on a line of its own may head the meaning of another: "Weather⏎Climate is…".
    frame: (p, text) =>
      fold(p.definition).startsWith(fold(p.term))
        ? framed(p, text, [{ pieces: [entry(p.definition)] }])
        : framed(p, text, [{ pieces: [{ slot: 'label', says: p.term }, entry(p.definition)] }]),
  },
  idea: { props: {} },
  proscons: {
    props: { pros: 'shown', cons: 'shown', heads: 'shown', above: 'shown' },
    // Each side stands under the heading or label the item gives it, which the card draws over it in place of a label of its own.
    frame: (p, text) =>
      framed({ ...p }, text, [{ pieces: [SIDE, ...p.pros.map(entry), SIDE, ...p.cons.map(entry)] }], (q, shown) => {
        const sides: [string, string] = [shown.slots[0]!, shown.slots[1]!];
        return q.heads === undefined || alike(q.heads, sides) ? { ...q, heads: sides } : undefined;
      }),
  },
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
          heading: { text: 'shown' },
          text: { text: 'shown' },
          figures: { label: 'shown', facts: { label: 'shown', value: 'shown' } },
          list: { label: 'shown', items: 'shown' },
          table: { label: 'shown', heads: 'shown', rows: 'shown' },
          picture: { src: 'own' },
          excerpt: { text: 'shown', by: 'shown' },
        },
      },
      above: 'shown',
    },
    frame: (p, text) => framed(p, text, sheetWays(p.sections)),
  },
  explorable: {
    props: {
      controls: {
        byKind: {
          toggle: { label: 'says', states: { name: 'says', text: 'shown' } },
          segmented: { label: 'says', states: { name: 'says', text: 'shown' } },
          slider: { name: 'choice', label: 'says', unit: 'unit', min: 'choice', max: 'choice', step: 'choice', values: 'writes' },
        },
      },
      output: {
        byKind: {
          text: {},
          figure: { label: 'says', unit: 'unit', formula: 'computes', values: 'writes' },
          chart: { label: 'says', unit: 'unit', formula: 'computes', values: 'writes' },
        },
      },
      above: 'shown',
    },
    also: (p) => misses(p) === undefined,
    // What the states say, every one in the item's order, is the whole item. A formula's result is held to it by `also`.
    frame: (p, text) => (p.output.kind !== 'text' ? p : framed(p, text, [{ pieces: p.controls.flatMap((control) => ('states' in control ? control.states.map((state) => entry(state.text)) : [])) }])),
  },
};

/** A point on the earth in degrees, north and east positive, as an item's `data.at` holds it. */
export const POINT = z.strictObject({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

/** A part of an assembled arrangement: a member, or a row, column or grid of parts. */
const LAYOUT_PART: z.ZodType<Part> = z.lazy(() =>
  z.union([
    z.strictObject({ kind: z.literal('card'), id: z.string().min(1), role: z.enum(ROLES) }),
    z.strictObject({ kind: z.enum(KINDS), label: words.max(LIMITS.label).optional(), join: z.enum(JOINS).optional(), children: z.array(LAYOUT_PART).min(1) }),
  ]),
);

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
  /** Members best first. `reasons[memberId]` is one line of why it stands there, a whole sentence or line of its content, or empty. */
  ranked: z.object({ reasons: z.record(z.string(), z.string().refine((text) => text.length <= roomOf(ROOM.reason, text))) }),
  /** One thing in two to four states, in order. `changes[memberId]` names the change that led to that member, for each member after the first. */
  beforeafter: z.object({ changes: z.record(z.string(), z.string().refine((text) => text.length <= roomOf(ROOM.reason, text))) }),
  /** The first member leads, alone on a row of its own. The others support it in a row beneath. */
  lead: z.object({}),
  /** Figures in a row above one chart. The last member is the chart or breakdown, and the others are facts. */
  overview: z.object({}),
  /** Pictures, swatches and ideas packed in columns, each at its own footprint. */
  moodboard: z.object({}),
  /**
   * Four members on a 2 by 2, in the order top left, top right, bottom left, bottom right. `x` grows to the right and `y` grows upwards.
   * `reasons[memberId]` is one line of why it sits in its corner, a whole sentence or line of its content, or empty.
   */
  matrix: z.object({ x: words.max(ROOM.axis), y: words.max(ROOM.axis), reasons: z.record(z.string(), z.string().refine((text) => text.length <= roomOf(ROOM.reason, text))) }),
  /**
   * Members at two or more places on a map, beside it in pin order. `centre` and `zoom` are fitted to the members' points for a map
   * of the size `MAP` in map.ts gives, and `pins[n].members` are the members at the place of pin n + 1, in the order the group lists them.
   */
  map: z.strictObject({
    centre: POINT,
    zoom: z.number().int().min(0).max(MAP.most),
    pins: z.array(POINT.extend({ members: z.array(z.string().min(1)).min(1) })).min(2),
  }),
  /** Members set out by a structure the model describes when no arrangement above fits: rows, columns and grids, nested up to four deep. */
  layout: z.strictObject({ tree: LAYOUT_PART }).refine(({ tree }) => tree.kind !== 'card' && withinLimits(tree as Box)),
} as const;
export type CompositeId = keyof typeof COMPOSITES;
export const COMPOSITE_IDS = Object.keys(COMPOSITES) as CompositeId[];

/** The fewest and the most members of each composite. */
export const MEMBERS: { readonly [C in CompositeId]: readonly [number, number] } = {
  gallery: [3, Infinity],
  timeline: [3, Infinity],
  comparison: [2, 4],
  sequence: [3, Infinity],
  cluster: [3, Infinity],
  stack: [3, Infinity],
  ranked: [3, Infinity],
  beforeafter: [2, 4],
  lead: [3, Infinity],
  overview: [3, Infinity],
  moodboard: [3, Infinity],
  matrix: [4, 4],
  map: [3, Infinity],
  layout: [LIMITS.least, LIMITS.cards],
};

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
    case 'audio': {
      const props = recording(item, assetUrl);
      return props ? view('audio', props) : view('note', {});
    }
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

/**
 * The card of a recording: its stored file, else the address a source gave it to play from, with what is known of its sound.
 * Nothing when it has neither, so a recording with nothing to play is a note.
 */
export function recording(item: Item, assetUrl: (id: string) => string): PropsOf<'audio'> | undefined {
  const src = item.source.asset ? assetUrl(item.source.asset) : typeof item.data.mediaUrl === 'string' ? item.data.mediaUrl.trim() : '';
  if (item.kind !== 'audio' || !src) return undefined;
  const sound = Sound.safeParse(item.data.sound);
  return { src, ...(sound.success && { seconds: sound.data.seconds, ...(sound.data.peaks && { peaks: sound.data.peaks }) }) };
}

export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
