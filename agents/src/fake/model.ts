import type { JsonRequest, ModelClient, WebResult } from '../core/ports.ts';

type JsonHandler = (req: JsonRequest<unknown>) => unknown;

/**
 * A scripted model for tests. Register a handler per role; a request for a role with none throws.
 * Every reply is checked against the request's schema, as the real model's is.
 */
export class FakeModel implements ModelClient {
  readonly calls: { kind: 'json' | 'search' | 'image' | 'transcribe'; role: string; detail: string }[] = [];
  private readonly json_ = new Map<string, JsonHandler>();
  private search_: (query: string, max: number) => WebResult[] = () => [];
  private transcript = '';

  on(role: string, handler: JsonHandler): this {
    this.json_.set(role, handler);
    return this;
  }
  onSearch(handler: (query: string, max: number) => WebResult[]): this {
    this.search_ = handler;
    return this;
  }
  onTranscribe(text: string): this {
    this.transcript = text;
    return this;
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    this.calls.push({ kind: 'json', role: req.role, detail: req.user });
    const handler = this.json_.get(req.role);
    if (!handler) throw new Error(`FakeModel has no script for role "${req.role}"`);
    return req.schema.parse(handler(req as JsonRequest<unknown>));
  }
  async search(req: { role: string; query: string; max?: number }): Promise<WebResult[]> {
    this.calls.push({ kind: 'search', role: req.role, detail: req.query });
    return this.search_(req.query, req.max ?? 5).slice(0, req.max ?? 5);
  }
  async image(req: { role: string; prompt: string }): Promise<{ bytes: Uint8Array; mime: string }> {
    this.calls.push({ kind: 'image', role: req.role, detail: req.prompt });
    return { bytes: PIXEL, mime: 'image/png' };
  }
  async transcribe(): Promise<string> {
    this.calls.push({ kind: 'transcribe', role: 'voice', detail: '' });
    return this.transcript;
  }
}

/** A 1×1 transparent PNG. */
const PIXEL = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);
