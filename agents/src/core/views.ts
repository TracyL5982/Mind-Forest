import { z } from 'zod';
import type { Item, View } from './domain.ts';
import type { Grounding } from './grounding.ts';

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
} as const;
export type ComponentId = keyof typeof COMPONENTS;
export const COMPONENT_IDS = Object.keys(COMPONENTS) as ComponentId[];
export type PropsOf<C extends ComponentId> = z.infer<(typeof COMPONENTS)[C]>;

/**
 * How one value in a view's props must stand in its item before a card may show it.
 * The content is the item's title and text and the values of its `data`.
 * - `says`: the content states these words. `cell` is the same, and may be empty.
 * - `quotes`: the content holds this passage as one stretch.
 * - `writes`: the content writes this number.
 * - `paints`: the content writes this colour, a hex value as a whole or a colour name as words.
 * - `own`: one of the item's own values, whole or cut short with an ellipsis: an address, its site, its source, its summary, its text, a value in its `data`.
 * - `label`: words that name a value beside them. Not checked against the content, and never empty.
 * - `choice`: how to draw, not what to show.
 */
export type Stated = 'says' | 'cell' | 'quotes' | 'writes' | 'paints' | 'own' | 'label' | 'choice';

/** One way of standing for a plain value, the same shape as the props for an object, and the element's shape for a list. */
export type Check<T = unknown> = unknown extends T
  ? Stated | { readonly [key: string]: Check }
  : T extends readonly (infer E)[]
    ? Check<E>
    : T extends object
      ? { readonly [K in keyof T]-?: Check<NonNullable<T[K]>> }
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
  quote: { props: { text: 'quotes', by: 'says' } },
  fact: { props: { value: 'says', label: 'label' }, also: (p) => p.value.length <= 32 },
  image: { props: { src: 'own', caption: 'own', aspect: 'choice' } },
  video: { props: { src: 'own', poster: 'own', caption: 'own' } },
  link: { props: { url: 'own', site: 'own', description: 'own', image: 'own' } },
  chart: {
    props: { chart: 'choice', labels: 'says', values: 'writes', unit: 'says', mark: 'choice' },
    also: (p) => p.labels.length >= 2 && p.labels.length === p.values.length,
  },
  person: { props: { name: 'says', role: 'says', image: 'own' } },
  chat: { props: { messages: { role: 'own', text: 'own' }, source: 'own' } },
  code: { props: { language: 'choice', source: 'own' } },
  steps: { props: { steps: 'says' }, also: (p) => p.steps.length >= 2 },
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
