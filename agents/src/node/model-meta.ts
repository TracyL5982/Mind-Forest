import { z } from 'zod';
import { Unreadable, type JsonRequest, type ModelClient, type Priority, type WebResult } from '../core/ports.ts';
import { RateWindow } from './rate-window.ts';

export interface MetaModelOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** The model for a request marked quick. */
  quickModel?: string;
  /**
   * How long a quick request may go unanswered before it is tried again. The quick model answers in 0.5 to 4 s. In three runs in a row
   * one of its requests went unanswered until the 120 s limit, and the same request tried again answered in 1 to 2 s.
   */
  quickWaitMs?: number;
  imageModel?: string;
  voiceModel?: string;
  fetch?: typeof fetch;
  /** Total tokens this client may spend before it refuses further requests. Guards against a runaway loop. */
  tokenBudget?: number;
  /** How long a request counts against the key's rate limit after it arrives. Measured, a minute. */
  rateWindowMs?: number;
  /**
   * Called after every request, for the run log and the cost tally, with the model and effort asked for, the tries it took and how
   * long it was held for the rate window.
   */
  onCall?: (call: { kind: string; role: string; ms: number; ok: boolean; tokens?: number; model?: string; effort?: string; tries?: number; heldMs?: number }) => void;
}

interface OutputItem {
  type: string;
  phase?: string;
  content?: { type: string; text?: string; annotations?: { url?: string; title?: string }[] }[];
  results?: { title?: string; url?: string; snippet?: string }[];
}

/** Meta Model API over the Responses protocol. Wire format: https://dev.meta.ai/docs/protocols/responses */
export class MetaModel implements ModelClient {
  private readonly base: string;
  private readonly model: string;
  private readonly send: typeof fetch;
  private readonly window: RateWindow;
  /** Tokens spent so far by this client. */
  spent = 0;

  constructor(private readonly opts: MetaModelOptions) {
    this.base = (opts.baseUrl ?? 'https://api.meta.ai/v1').replace(/\/+$/, '');
    this.model = opts.model ?? 'muse-spark-1.3';
    this.send = opts.fetch ?? fetch.bind(globalThis);
    this.window = new RateWindow(opts.rateWindowMs);
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const content: unknown[] = [{ type: 'input_text', text: req.user }];
    for (const url of req.images ?? []) content.push({ type: 'input_image', image_url: url });
    for (const url of req.videos ?? []) content.push({ type: 'input_video', video_url: url });
    // Measured on the suggested questions: muse-spark-1.3 reasons for 700 to 1,500 tokens at any effort and answers in 7 to 15 s;
    // muse-ember-1.0 at minimal effort reasons for about 40 and answers in about a second.
    const body = {
      model: req.quick ? (this.opts.quickModel ?? 'muse-ember-1.0') : this.model,
      input: [
        { role: 'system', content: req.system },
        { role: 'user', content },
      ],
      reasoning: { effort: req.effort ?? (req.quick ? 'minimal' : 'low') },
      text: {
        format: {
          type: 'json_schema',
          name: req.role.replace(/[^a-zA-Z0-9_-]/g, '_'),
          schema: strictSchema(z.toJSONSchema(req.schema, { io: 'input' })),
          strict: true,
        },
      },
    };
    const waitMs = req.quick ? (this.opts.quickWaitMs ?? 20_000) : undefined;
    const priority = req.priority ?? 'user';
    const text = req.onText
      ? await this.streamed(req.role, body, req.onText, waitMs, priority)
      : finalText(await this.responses('json', req.role, body, waitMs, priority));
    if (!text) throw new Unreadable(req.role, 'no text');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Unreadable(req.role, err instanceof Error ? err.message : String(err));
    }
    const parsed = req.schema.safeParse(dropNulls(json));
    if (!parsed.success) throw new Unreadable(req.role, parsed.error.issues);
    return parsed.data;
  }

  async search(req: { role: string; query: string; max?: number; prefer?: string }): Promise<WebResult[]> {
    const max = req.max ?? 5;
    const output = await this.responses('search', req.role, {
      model: this.model,
      input:
        `Search the web for: ${req.query}\n` +
        `Return the ${max} most useful and varied results. For each give the page's exact URL, its title, ` +
        `and a snippet of one or two sentences.\n` +
        (req.prefer ? `${req.prefer}\n` : '') +
        // Left free, the model opens every page it finds: measured at 50 s and about 350,000 tokens a search.
        `Run exactly one search. Do not open any page. Write each snippet only from what the search result itself shows.`,
      tools: [{ type: 'web_search' }],
      include: ['web_search_call.results'],
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'search_results', schema: strictSchema(z.toJSONSchema(SearchReply)), strict: true } },
    });
    // The API's own hits carry no snippet, so the model writes one. Its URLs are only trusted when the search really returned them.
    const found = new Map<string, WebResult>();
    for (const item of output) {
      if (item.type === 'web_search_call') {
        for (const r of item.results ?? []) {
          if (r.url && !found.has(key(r.url))) found.set(key(r.url), { title: r.title ?? r.url, url: r.url, snippet: r.snippet ?? '' });
        }
      }
      for (const c of item.content ?? []) {
        for (const a of c.annotations ?? []) {
          if (a.url && !found.has(key(a.url))) found.set(key(a.url), { title: a.title ?? a.url, url: a.url, snippet: '' });
        }
      }
    }
    const hits: WebResult[] = [];
    const used = new Set<string>();
    try {
      for (const r of SearchReply.parse(JSON.parse(finalText(output))).results) {
        const real = found.get(key(r.url));
        if (!real || used.has(key(r.url))) continue;
        used.add(key(r.url));
        hits.push({ title: r.title || real.title, url: real.url, snippet: r.snippet });
      }
    } catch {
      // Fall through to the raw hits.
    }
    for (const [k, r] of found) {
      if (hits.length >= max) break;
      if (!used.has(k)) hits.push(r);
    }
    return hits.slice(0, max);
  }

  async image(req: { role: string; prompt: string }): Promise<{ bytes: Uint8Array; mime: string }> {
    const json = (await this.post('image', req.role, '/images/generations', {
      model: this.opts.imageModel ?? 'muse-image-1.0',
      prompt: req.prompt,
      n: 1,
    })) as { data?: { b64_json?: string; url?: string }[] };
    const first = json.data?.[0];
    if (first?.b64_json) return { bytes: Uint8Array.from(Buffer.from(first.b64_json, 'base64')), mime: 'image/png' };
    if (first?.url) {
      const res = await this.send(first.url);
      if (!res.ok) throw new Error(`image download failed: ${res.status}`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        mime: res.headers.get('content-type') ?? 'image/png',
      };
    }
    throw new Error('the image model returned no image');
  }

  async transcribe(req: { audio: Uint8Array; mime: string }): Promise<string> {
    const encoding = ENCODINGS[req.mime.split(';')[0]!.trim()];
    if (!encoding) throw new Error(`unsupported audio type ${req.mime}`);
    const form = new FormData();
    form.append(
      'request',
      new Blob(
        [JSON.stringify({ model: this.opts.voiceModel ?? 'muse-voice-transcribe-1.0', audioEncoding: encoding, mode: 'PUSH_TO_TALK' })],
        { type: 'application/json' },
      ),
    );
    form.append('audio', new Blob([req.audio as BlobPart], { type: req.mime }), 'audio');
    const started = Date.now();
    const res = await this.send(`${this.base}/asr/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: 'application/json' },
      body: form,
    });
    this.opts.onCall?.({ kind: 'transcribe', role: 'voice', ms: Date.now() - started, ok: res.ok });
    if (!res.ok) throw new Error(`transcribe failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return transcriptOf(await res.json()).replace(/([.?!])\1+$/, '$1').trim();
  }

  /**
   * One reply read as it is written, over server-sent events, its text handed to `onText` after each piece.
   * It is tried again only while nothing has been handed on, since a second answer could differ from what was already acted on.
   */
  private async streamed(role: string, body: object, onText: (soFar: string) => void, waitMs = 120_000, priority: Priority = 'user'): Promise<string> {
    const budget = this.opts.tokenBudget ?? 5_000_000;
    if (this.spent >= budget) throw new Error(`${role}: token budget of ${budget} is used up; restart the service to reset it`);
    const started = Date.now();
    const asked = askedFor(body);
    const call = { tries: 0, heldMs: 0 };
    let lastError = '';
    let handedOn = false;
    for (let attempt = 0; attempt < 3 && !handedOn; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      try {
        const got = await this.limited(priority, '/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ ...body, stream: true }),
        }, waitMs, call, async (res): Promise<{ status: number; error: string } | { text: string; tokens?: number }> => {
          if (!res.ok || !res.body) return { status: res.status, error: `${res.status} ${(await res.text()).slice(0, 400)}` };
          let text = '';
          let tokens: number | undefined;
          for await (const event of serverEvents(res.body)) {
            // A message the model writes before its answer is replaced by the answer.
            if (event.type === 'response.output_item.added' && event.item?.type === 'message') text = '';
            if (event.type === 'response.output_text.delta' && event.delta) {
              text += event.delta;
              handedOn = true;
              onText(text);
            }
            if (event.type === 'response.completed') tokens = event.response?.usage?.total_tokens;
            if (event.type === 'response.failed' || event.type === 'error') throw new Error(`${role}: the reply failed: ${JSON.stringify(event).slice(0, 300)}`);
          }
          return { text, tokens };
        });
        if ('error' in got) {
          lastError = got.error;
          if (got.status < 500) break;
          continue;
        }
        this.spent += got.tokens ?? 0;
        this.opts.onCall?.({ kind: 'json', role, ms: Date.now() - started, ok: true, tokens: got.tokens, ...asked, ...call });
        return got.text;
      } catch (err) {
        lastError = String(err);
      }
    }
    this.opts.onCall?.({ kind: 'json', role, ms: Date.now() - started, ok: false, ...asked, ...call });
    throw new Error(`${role}: model request failed: ${lastError}`);
  }

  private async responses(kind: string, role: string, body: unknown, waitMs?: number, priority?: Priority): Promise<OutputItem[]> {
    const json = (await this.post(kind, role, '/responses', body, waitMs, priority)) as { output?: OutputItem[]; status?: string };
    if (!Array.isArray(json.output)) throw new Error(`${role}: malformed response`);
    return json.output;
  }

  private async post(kind: string, role: string, path: string, body: unknown, waitMs = 120_000, priority: Priority = 'user'): Promise<unknown> {
    const budget = this.opts.tokenBudget ?? 5_000_000;
    if (this.spent >= budget) throw new Error(`${role}: token budget of ${budget} is used up; restart the service to reset it`);
    const started = Date.now();
    const asked = askedFor(body);
    const call = { tries: 0, heldMs: 0 };
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      let got: { ok: boolean; status: number; text: string };
      try {
        got = await this.limited(priority, path, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }, waitMs, call, async (res) => ({ ok: res.ok, status: res.status, text: await res.text() }));
      } catch (err) {
        lastError = String(err);
        continue;
      }
      if (got.ok) {
        const json = JSON.parse(got.text) as { usage?: { total_tokens?: number } };
        this.spent += json.usage?.total_tokens ?? 0;
        this.opts.onCall?.({ kind, role, ms: Date.now() - started, ok: true, tokens: json.usage?.total_tokens, ...asked, ...call });
        return json;
      }
      lastError = `${got.status} ${got.text.slice(0, 400)}`;
      if (got.status < 500) break;
    }
    this.opts.onCall?.({ kind, role, ms: Date.now() - started, ok: false, ...asked, ...call });
    throw new Error(`${role}: model request failed: ${lastError}`);
  }

  /**
   * One request, sent once the rate window has room for it and its answer read by `use`, since the API counts a request from when its
   * answer ends. Refused for the rate, it is sent again once the window has room, until it has been held a window and a half.
   * Retried on a fixed backoff instead, it gave up after 5 s, long before the window had room.
   */
  private async limited<T>(
    priority: Priority,
    path: string,
    init: RequestInit,
    waitMs: number,
    call: { tries: number; heldMs: number },
    use: (res: Response) => Promise<T>,
  ): Promise<T> {
    for (;;) {
      const slot = await this.window.take(priority);
      call.heldMs += slot.heldMs;
      call.tries++;
      try {
        const res = await this.send(`${this.base}${path}`, { ...init, signal: AbortSignal.timeout(waitMs) });
        this.window.read(res);
        if (res.status !== 429 || call.heldMs >= this.window.ms * 1.5) return await use(res);
        await res.body?.cancel();
      } finally {
        slot.done();
      }
    }
  }
}

function askedFor(body: unknown): { model?: string; effort?: string } {
  const { model, reasoning } = body as { model?: string; reasoning?: { effort?: string } };
  return { model, effort: reasoning?.effort };
}

type Json = Record<string, unknown>;

interface StreamEvent {
  type?: string;
  delta?: string;
  item?: { type?: string };
  response?: { usage?: { total_tokens?: number } };
}

/** The events of a server-sent event stream, each its `data` parsed as JSON. */
async function* serverEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    // A line may end in \r\n, and a read may end between the two.
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const data = buffer.slice(0, cut).split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
      buffer = buffer.slice(cut + 2);
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data) as StreamEvent;
      } catch {
        // A line that is not JSON carries nothing to read.
      }
    }
  }
}

/**
 * Rewrites a JSON Schema into the API's strict subset: every object closed, every key required, optional keys nullable.
 * Measured on the live model: with an open object and optional keys, constrained decoding invents dozens of junk keys
 * and leaves the real ones out. With the strict form it does not.
 */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const node: Json = { ...(schema as Json) };
  delete node.$schema;
  for (const key of ['items', 'anyOf', 'prefixItems']) if (key in node) node[key] = strictSchema(node[key]);
  for (const key of ['$defs', 'definitions']) {
    if (node[key] && typeof node[key] === 'object') {
      node[key] = Object.fromEntries(Object.entries(node[key] as Json).map(([k, v]) => [k, strictSchema(v)]));
    }
  }
  if (node.properties && typeof node.properties === 'object') {
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    node.properties = Object.fromEntries(
      Object.entries(node.properties as Json).map(([k, v]) => [k, required.has(k) ? strictSchema(v) : nullable(strictSchema(v))]),
    );
    node.required = Object.keys(node.properties as Json);
    node.additionalProperties = false;
  } else if (node.type === 'object' && node.additionalProperties && typeof node.additionalProperties === 'object') {
    node.additionalProperties = strictSchema(node.additionalProperties);
  }
  return node;
}

function nullable(schema: unknown): unknown {
  const node = schema as Json;
  if (Array.isArray(node.type)) return node.type.includes('null') ? node : { ...node, type: [...node.type, 'null'] };
  if (typeof node.type === 'string') return node.type === 'null' ? node : { ...node, type: [node.type, 'null'] };
  if (Array.isArray(node.anyOf)) return { ...node, anyOf: [...node.anyOf, { type: 'null' }] };
  return { anyOf: [node, { type: 'null' }] };
}

/** Optional keys come back as null under the strict schema. Zod's optional wants them absent. */
function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Json)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, dropNulls(v)]),
  );
}

const SearchReply = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })),
});

function key(url: string): string {
  return url.replace(/^https?:\/\/(www\.|m\.)?/, '').replace(/[/#?]+$/, '').toLowerCase();
}

const ENCODINGS: Record<string, string> = {
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/wave': 'WAV',
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/ogg': 'OGG_OPUS',
  'audio/webm': 'WEBM_OPUS',
  'audio/flac': 'FLAC',
  'audio/mp4': 'MP4',
  'audio/m4a': 'MP4',
};

/** The model's answer, not the commentary it writes while working. */
function finalText(output: OutputItem[]): string {
  const messages = output.filter((o) => o.type === 'message');
  const final = messages.filter((m) => m.phase !== 'commentary').at(-1) ?? messages.at(-1);
  return (final?.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('');
}

function transcriptOf(json: unknown): string {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    for (const key of ['text', 'transcript']) if (typeof o[key] === 'string') return o[key] as string;
    if (Array.isArray(o.segments)) {
      return o.segments.map((s) => (s && typeof s === 'object' ? String((s as { text?: unknown }).text ?? '') : '')).join(' ').trim();
    }
  }
  throw new Error('transcribe: unrecognised response shape');
}
