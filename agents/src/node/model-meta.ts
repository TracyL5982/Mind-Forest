import { z } from 'zod';
import type { JsonRequest, ModelClient, WebResult } from '../core/ports.ts';

export interface MetaModelOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  imageModel?: string;
  voiceModel?: string;
  fetch?: typeof fetch;
  /** Called after every request, for the run log and the cost tally. */
  /** Total tokens this client may spend before it refuses further requests. Guards against a runaway loop. */
  tokenBudget?: number;
  onCall?: (call: { kind: string; role: string; ms: number; ok: boolean; tokens?: number }) => void;
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
  /** Tokens spent so far by this client. */
  spent = 0;

  constructor(private readonly opts: MetaModelOptions) {
    this.base = (opts.baseUrl ?? 'https://api.meta.ai/v1').replace(/\/+$/, '');
    this.model = opts.model ?? 'muse-spark-1.3';
    this.send = opts.fetch ?? fetch.bind(globalThis);
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const content: unknown[] = [{ type: 'input_text', text: req.user }];
    for (const url of req.images ?? []) content.push({ type: 'input_image', image_url: url });
    for (const url of req.videos ?? []) content.push({ type: 'input_video', video_url: url });
    const body = {
      model: this.model,
      input: [
        { role: 'system', content: req.system },
        { role: 'user', content },
      ],
      reasoning: { effort: req.effort ?? 'low' },
      text: {
        format: {
          type: 'json_schema',
          name: req.role.replace(/[^a-zA-Z0-9_-]/g, '_'),
          schema: z.toJSONSchema(req.schema, { io: 'input' }),
        },
      },
    };
    const output = await this.responses('json', req.role, body);
    const text = finalText(output);
    if (!text) throw new Error(`${req.role}: the model returned no text`);
    return req.schema.parse(JSON.parse(text));
  }

  async search(req: { role: string; query: string; max?: number }): Promise<WebResult[]> {
    const max = req.max ?? 5;
    const output = await this.responses('search', req.role, {
      model: this.model,
      input:
        `Search the web for: ${req.query}\n` +
        `Return the ${max} most useful and varied results. For each give the page's exact URL, its title, ` +
        `and a snippet of one or two sentences.\n` +
        // Left free, the model opens every page it finds: measured at 50 s and about 350,000 tokens a search.
        `Run exactly one search. Do not open any page. Write each snippet only from what the search result itself shows.`,
      tools: [{ type: 'web_search' }],
      include: ['web_search_call.results'],
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'search_results', schema: z.toJSONSchema(SearchReply) } },
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
    return transcriptOf(await res.json());
  }

  private async responses(kind: string, role: string, body: unknown): Promise<OutputItem[]> {
    const json = (await this.post(kind, role, '/responses', body)) as { output?: OutputItem[]; status?: string };
    if (!Array.isArray(json.output)) throw new Error(`${role}: malformed response`);
    return json.output;
  }

  private async post(kind: string, role: string, path: string, body: unknown): Promise<unknown> {
    const budget = this.opts.tokenBudget ?? 5_000_000;
    if (this.spent >= budget) throw new Error(`${role}: token budget of ${budget} is used up; restart the service to reset it`);
    const started = Date.now();
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      let res: Response;
      try {
        res = await this.send(`${this.base}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (err) {
        lastError = String(err);
        continue;
      }
      if (res.ok) {
        const json = (await res.json()) as { usage?: { total_tokens?: number } };
        this.spent += json.usage?.total_tokens ?? 0;
        this.opts.onCall?.({ kind, role, ms: Date.now() - started, ok: true, tokens: json.usage?.total_tokens });
        return json;
      }
      lastError = `${res.status} ${(await res.text()).slice(0, 400)}`;
      if (res.status !== 429 && res.status < 500) break;
    }
    this.opts.onCall?.({ kind, role, ms: Date.now() - started, ok: false });
    throw new Error(`${role}: model request failed: ${lastError}`);
  }
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
