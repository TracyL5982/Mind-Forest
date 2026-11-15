import { z } from 'zod';
import type { Assets, Geocoder, ModelClient, Page, Playable, SocialPost, Tools } from '../core/ports.ts';
import { siteOf } from '../core/views.ts';
import { makeSources, plain } from './sources.ts';

export interface ToolOptions {
  model: ModelClient;
  assets: Assets;
  instagram?: { token: string; userId: string };
  /** Keys for sources that need one, by the name they have in the env file. A source without its key is left out. */
  keys?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Given only when maps are on. */
  geocoder?: Geocoder;
  log?: (line: string) => void;
}

/**
 * The fal picture models this service can ask, by endpoint, each with the body it takes for a 4:3 picture returned inside the reply.
 * FLUX.3 Klein is fal's fast one at $0.009 a 1K picture, FLUX 3 its quality one at $0.048, and Muse Image the model the Meta API
 * makes today, at $0.01 (fal's model pages, read 15 November 2026).
 */
export const FAL_MODELS: Record<string, (prompt: string) => Record<string, unknown>> = {
  // The Scout writes a whole prompt already, so the model's own expansion of it is turned off.
  'blackforestlabs/flux-3/klein/text-to-image': (prompt) => ({ prompt, image_size: 'landscape_4_3', enable_prompt_expansion: false, output_format: 'jpeg', sync_mode: true }),
  'blackforestlabs/flux-3/text-to-image': (prompt) => ({ prompt, aspect_ratio: '4:3', resolution: '1k', output_format: 'jpeg', sync_mode: true }),
  'meta/muse-image/text-to-image': (prompt) => ({ prompt, aspect_ratio: '4:3', output_format: 'jpeg', sync_mode: true }),
};

/** One picture from fal's direct endpoint, which answers on the same connection with the picture inside the reply. */
export async function falPicture(send: typeof fetch, key: string, model: string, prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const body = FAL_MODELS[model];
  if (!body) throw new Error(`no fal model "${model}" is known; known: ${Object.keys(FAL_MODELS).join(', ')}`);
  const res = await send(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body(prompt)),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`fal answered ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { images?: { url?: string; content_type?: string }[] };
  const url = json.images?.[0]?.url ?? '';
  const inline = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (inline) return { mime: inline[1]!, bytes: Uint8Array.from(Buffer.from(inline[2]!, 'base64')) };
  if (!/^https:\/\//.test(url)) throw new Error('fal returned no picture');
  const picture = await send(url, { signal: AbortSignal.timeout(20_000) });
  if (!picture.ok) throw new Error(`fal's picture could not be fetched: ${picture.status}`);
  return { mime: picture.headers.get('content-type') ?? json.images?.[0]?.content_type ?? 'image/jpeg', bytes: new Uint8Array(await picture.arrayBuffer()) };
}

const CodeReply = z.object({ title: z.string(), language: z.string(), source: z.string() });

export function makeTools(opts: ToolOptions): Tools {
  const send = opts.fetch ?? fetch.bind(globalThis);
  return {
    web: {
      search: (query, max) => opts.model.search({ role: 'tool.web', query, max }),
      read: (url) => readPage(send, url),
      picture: (url) => storePicture(send, opts.assets, url),
      async videos(query) {
        if (opts.keys?.YOUTUBE_API_KEY) return youtube(send, opts.keys.YOUTUBE_API_KEY, query);
        // Without a YouTube key the model's web search finds addresses, and each is confirmed with YouTube before it is used.
        const hits = await opts.model.search({ role: 'tool.web', query: `${query} youtube`, max: 6 });
        return (await Promise.all(hits.map((hit) => playable(send, hit.url)))).flatMap((v) => v ?? []);
      },
    },
    sources: makeSources({ send, model: opts.model, read: (url) => readPage(send, url), keys: opts.keys }),
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
        const fal = opts.keys?.FAL_KEY && opts.keys.MIND_PALACE_FAL_MODEL ? { key: opts.keys.FAL_KEY, model: opts.keys.MIND_PALACE_FAL_MODEL } : null;
        let made: { bytes: Uint8Array; mime: string } | undefined;
        if (fal) {
          const started = Date.now();
          try {
            made = await falPicture(send, fal.key, fal.model, prompt);
            opts.log?.(`  model image tool.image ok ${Date.now() - started}ms, fal ${fal.model}`);
          } catch (err) {
            opts.log?.(`  model image tool.image FAILED ${Date.now() - started}ms, fal ${fal.model} (${err instanceof Error ? err.message : String(err)}), made with the Meta model instead`);
          }
        }
        made ??= await opts.model.image({ role: 'tool.image', prompt });
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
    geocoder: opts.geocoder,
  };
}

const AGENT_NAME = 'MindPalace/0.1 (local prototype)';

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

async function youtube(send: typeof fetch, apiKey: string, query: string): Promise<Playable[]> {
  const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', safeSearch: 'moderate', maxResults: '6', q: query, key: apiKey });
  const res = await send(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(8_000) });
  // The address holds the key, so only the status is reported.
  if (!res.ok) throw new Error(`YouTube search answered ${res.status}`);
  const json = (await res.json()) as { items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } } }[] };
  return (json.items ?? []).flatMap((v) => {
    const id = v.id?.videoId;
    if (!id || !/^[\w-]{11}$/.test(id)) return [];
    const poster = v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url;
    return [{ title: plain(v.snippet?.title ?? ''), url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube.com/embed/${id}`, ...(poster ? { poster } : {}) }];
  });
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
      signal: AbortSignal.timeout(7_000),
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
    const image = webAddress(meta('og:image'), res.url || url);
    return {
      url: res.url || url,
      title: title.slice(0, 300),
      text: `${description ? `${description}\n\n` : ''}${body}`.slice(0, MAX_TEXT),
      site: meta('og:site_name') || siteOf(res.url || url),
      ...(image ? { image } : {}),
    };
  } catch {
    return null;
  }
}

/** `address` read against the page at `base`, or undefined when it is no web address. A picture is only ever fetched from the web. */
function webAddress(address: string, base: string): string | undefined {
  const parsed = address.trim() ? URL.parse(address, base) : null;
  return parsed && /^https?:$/.test(parsed.protocol) ? parsed.href : undefined;
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
