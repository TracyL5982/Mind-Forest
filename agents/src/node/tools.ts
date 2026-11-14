import { z } from 'zod';
import type { Assets, ModelClient, Page, Artwork, Playable, SocialPost, Tools } from '../core/ports.ts';
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
      picture: (url) => storePicture(send, opts.assets, url),
      video: (url) => playable(send, url),
    },
    art: { search: (query, max = 10) => museums(send, query, max) },
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

type Museum = (send: typeof fetch, query: string, max: number) => Promise<Artwork[]>;

async function ask<T>(send: typeof fetch, url: string): Promise<T> {
  const res = await send(url, { headers: { 'User-Agent': AGENT_NAME, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const chicago: Museum = async (send, query, max) => {
  const fields = 'id,title,artist_title,date_display,medium_display,image_id';
  const json = await ask<{ data?: Record<string, unknown>[] }>(send, `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&limit=${max}&fields=${fields}`);
  return (json.data ?? []).filter((w) => text(w.image_id)).map((w) => ({
    title: text(w.title), maker: text(w.artist_title), date: text(w.date_display), medium: text(w.medium_display),
    museum: 'Art Institute of Chicago', url: `https://www.artic.edu/artworks/${w.id}`,
    image: `https://www.artic.edu/iiif/2/${text(w.image_id)}/full/843,/0/default.jpg`,
  }));
};

const met: Museum = async (send, query, max) => {
  const base = 'https://collectionapi.metmuseum.org/public/collection';
  const found = await ask<{ objectIDs?: number[] | null }>(send, `${base}/v1.1/search?hasImages=true&q=${encodeURIComponent(query)}&limit=${max * 2}`);
  // The search answers with ids only, and works still in copyright come back without a picture.
  const works = await Promise.all((found.objectIDs ?? []).slice(0, max * 2).map((id) => ask<Record<string, unknown>>(send, `${base}/v1/objects/${id}`).catch(() => null)));
  return works.flatMap((w) => (w && text(w.primaryImageSmall) ? [{
    title: text(w.title), maker: text(w.artistDisplayName), date: text(w.objectDate), medium: text(w.medium),
    museum: 'The Metropolitan Museum of Art', url: text(w.objectURL), image: text(w.primaryImageSmall),
  }] : [])).slice(0, max);
};

const cleveland: Museum = async (send, query, max) => {
  const json = await ask<{ data?: Record<string, any>[] }>(send, `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(query)}&has_image=1&limit=${max}`);
  return (json.data ?? []).filter((w) => text(w.images?.web?.url)).map((w) => ({
    title: text(w.title), maker: text(w.creators?.[0]?.description), date: text(w.creation_date), medium: text(w.technique) || text(w.type),
    museum: 'Cleveland Museum of Art', url: text(w.url), image: text(w.images.web.url),
  }));
};

const victoriaAndAlbert: Museum = async (send, query, max) => {
  const json = await ask<{ records?: Record<string, any>[] }>(send, `https://api.vam.ac.uk/v2/objects/search?q=${encodeURIComponent(query)}&images_exist=1&page_size=${max}`);
  return (json.records ?? []).filter((w) => text(w._images?._iiif_image_base_url)).map((w) => ({
    title: text(w._primaryTitle) || text(w.objectType), maker: text(w._primaryMaker?.name), date: text(w._primaryDate), medium: text(w.objectType),
    museum: 'Victoria and Albert Museum', url: `https://collections.vam.ac.uk/item/${w.systemNumber}`,
    image: `${text(w._images._iiif_image_base_url)}full/!960,960/0/default.jpg`,
  }));
};

const MUSEUMS: Museum[] = [chicago, met, cleveland, victoriaAndAlbert];
const PER_MUSEUM = 4;

/** Asks every museum at once and deals the answers out in turn, so no single collection fills the list. */
async function museums(send: typeof fetch, query: string, max: number): Promise<Artwork[]> {
  const answers = await Promise.all(MUSEUMS.map((museum) => museum(send, query, PER_MUSEUM).catch(() => [] as Artwork[])));
  const dealt: Artwork[] = [];
  for (let round = 0; round < PER_MUSEUM; round++) {
    for (const works of answers) {
      const work = works[round];
      if (work && work.title && work.url && work.image) dealt.push(work);
    }
  }
  return dealt.slice(0, max);
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
