import { z } from 'zod';
import type { Assets, ModelClient, Page, Playable, Reference, SocialPost, Tools } from '../core/ports.ts';
import { siteOf } from '../core/views.ts';

export interface ToolOptions {
  model: ModelClient;
  assets: Assets;
  instagram?: { token: string; userId: string };
  fetch?: typeof fetch;
}

const CodeReply = z.object({ title: z.string(), language: z.string(), source: z.string() });

export function makeTools(opts: ToolOptions): Tools {
  const send = opts.fetch ?? fetch.bind(globalThis);
  return {
    web: {
      search: (query, max) => opts.model.search({ role: 'tool.web', query, max }),
      read: (url) => readPage(send, url),
      lookup: (name) => lookup(send, name),
      picture: (url) => storePicture(send, opts.assets, url),
      video: (url) => playable(send, url),
    },
    instagram: {
      async recent(limit = 12): Promise<SocialPost[]> {
        if (!opts.instagram) return [];
        const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
        const res = await send(
          `https://graph.facebook.com/v21.0/${opts.instagram.userId}/media?fields=${fields}&limit=${Math.min(limit, 50)}`,
          { headers: { Authorization: `Bearer ${opts.instagram.token}` }, signal: AbortSignal.timeout(20_000) },
        );
        if (!res.ok) throw new Error(`instagram: ${res.status} ${(await res.text()).slice(0, 200)}`);
        const json = (await res.json()) as { data?: Record<string, string>[] };
        return (json.data ?? []).map((m) => ({
          id: m.id ?? '',
          url: m.permalink ?? '',
          caption: m.caption ?? '',
          mediaType: m.media_type === 'VIDEO' ? 'video' : m.media_type === 'CAROUSEL_ALBUM' ? 'album' : 'image',
          mediaUrl: m.media_url,
          thumbnailUrl: m.thumbnail_url,
          postedAt: m.timestamp ?? '',
        }));
      },
    },
    images: {
      async generate(prompt) {
        const made = await opts.model.image({ role: 'tool.image', prompt });
        return { asset: (await opts.assets.put(made.bytes, made.mime, 'generated')).id };
      },
    },
    code: {
      // Muse Code itself is a terminal agent with no request API, so code sketches come from the same Muse model.
      generate: (prompt) =>
        opts.model.json({
          role: 'tool.code',
          system:
            'You write one small, self-contained code sketch that a person can read in a minute and run as is. ' +
            'Prefer plain JavaScript or Python with no dependencies. Return a short title, the language, and the source.',
          user: prompt,
          schema: CodeReply,
          effort: 'medium',
        }),
    },
  };
}

const AGENT_NAME = 'MindPalace/0.1 (local prototype)';

async function lookup(send: typeof fetch, name: string): Promise<Reference | null> {
  try {
    const query = new URLSearchParams({
      action: 'query', format: 'json', generator: 'search', gsrsearch: name, gsrlimit: '1',
      prop: 'pageimages|extracts|info', piprop: 'thumbnail', pithumbsize: '960',
      exintro: '1', explaintext: '1', exsentences: '4', inprop: 'url', redirects: '1',
    });
    const res = await send(`https://en.wikipedia.org/w/api.php?${query}`, { headers: { 'User-Agent': AGENT_NAME }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string; thumbnail?: { source?: string } }> } };
    const page = Object.values(json.query?.pages ?? {})[0];
    if (!page?.title || !page.fullurl) return null;
    // The search always returns its nearest page, so a result that shares no real word with the name is a different thing.
    const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    const asked = words(name);
    const shared = [...words(page.title)].filter((w) => asked.has(w)).length;
    if (asked.size > 0 && shared === 0) return null;
    return { title: page.title, url: page.fullurl, extract: (page.extract ?? '').trim(), ...(page.thumbnail?.source ? { image: page.thumbnail.source } : {}) };
  } catch {
    return null;
  }
}

const MIN_PICTURE_BYTES = 4_000;
const MAX_PICTURE_BYTES = 8_000_000;

async function storePicture(send: typeof fetch, assets: Assets, url: string): Promise<{ asset: string } | null> {
  try {
    const res = await send(url, { headers: { 'User-Agent': AGENT_NAME, Accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(12_000) });
    const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(mime)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < MIN_PICTURE_BYTES || bytes.length > MAX_PICTURE_BYTES) return null;
    return { asset: (await assets.put(bytes, mime, 'found')).id };
  } catch {
    return null;
  }
}

async function playable(send: typeof fetch, url: string): Promise<Playable | null> {
  const id = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url)?.[1];
  if (!id) return null;
  try {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const res = await send(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string; thumbnail_url?: string };
    return { title: json.title ?? '', url: watch, embed: `https://www.youtube.com/embed/${id}`, ...(json.thumbnail_url ? { poster: json.thumbnail_url } : {}) };
  } catch {
    return null;
  }
}

const MAX_PAGE_BYTES = 2_000_000;
const MAX_TEXT = 20_000;

async function readPage(send: typeof fetch, url: string): Promise<Page | null> {
  try {
    const res = await send(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MindPalace/0.1)', Accept: 'text/html,application/xhtml+xml,text/plain' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/text\/|xml|json/.test(type)) return null;
    const html = new TextDecoder().decode((await res.arrayBuffer()).slice(0, MAX_PAGE_BYTES));
    const meta = (name: string) =>
      decode(
        new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)?.[1] ??
          new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i').exec(html)?.[1] ??
          '',
      );
    const title = meta('og:title') || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim() || url;
    const body = /text\/html|xml/.test(type) ? textOf(html) : html;
    const description = meta('og:description') || meta('description');
    const image = meta('og:image');
    return {
      url: res.url || url,
      title: title.slice(0, 300),
      text: `${description ? `${description}\n\n` : ''}${body}`.slice(0, MAX_TEXT),
      site: meta('og:site_name') || siteOf(res.url || url),
      ...(image ? { image: new URL(image, res.url || url).href } : {}),
    };
  } catch {
    return null;
  }
}

function textOf(html: string): string {
  const main = /<(article|main)[\s>][\s\S]*<\/\1>/i.exec(html)?.[0] ?? html;
  return decode(
    main
      .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s>][\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|blockquote)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1]!.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
  });
}
