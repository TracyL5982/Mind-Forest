import { z } from 'zod';
import type { Item, View } from './domain.ts';

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

/**
 * A picture's or a video's file and still. The item's own stored file comes first, then a file the service streams (`mediaUrl`),
 * and only then the page it came from, for a video that only plays embedded. The still is always a service asset.
 */
export function mediaOf(item: Item, assetUrl: (id: string) => string): { src: string; poster?: string } | null {
  const named = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
  const src = item.source.asset ? assetUrl(item.source.asset) : (named(item.data.mediaUrl) ?? named(item.source.url));
  if (!src) return null;
  const poster = item.kind === 'video' ? named(item.data.thumbnailUrl) : undefined;
  return poster ? { src, poster } : { src };
}

/** The view a node gets the moment it exists, before the Renderer has looked at it. */
export function defaultView(item: Item, assetUrl: (id: string) => string): View {
  const media = mediaOf(item, assetUrl);
  const view = (component: ComponentId, props: Record<string, unknown>): View => ({ component, props, by: 'default' });
  switch (item.kind) {
    case 'image':
      return media ? view('image', { src: media.src }) : view('note', {});
    case 'video':
      return media ? view('video', media) : view('note', {});
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
