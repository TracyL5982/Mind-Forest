import type { JsonRequest, ModelClient, Priority, WebResult } from '../../core/ports.ts';
import type { Usage } from '../model-meta.ts';

/**
 * OpenAI's models for the Scout while Meta's rate window is full. The main model writes the Scout's directions, where the quick and
 * smaller ones lost the concrete examples a request asked for (DECISIONS 47), so it is the full gpt-5.4. The quick model rates ties,
 * picks catalogues and curates in about a second; gpt-5.4-mini at no reasoning answered a small schema in 1.8 s (one probe,
 * 15 Nov 2026), and it refuses `minimal`, so `minimal` is sent as `none`.
 */
export const SPARE_MODEL = 'gpt-5.4';
export const SPARE_QUICK_MODEL = 'gpt-5.4-mini';
export const SPARE_EFFORTS = { minimal: 'none' };

/**
 * Dollars per million tokens, as third-party trackers listed OpenAI's prices on 15 Nov 2026 (gpt-5.4-mini's matches web-answer.ts).
 * Not read from OpenAI's own page.
 */
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.4': { input: 2.5, cached: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
};

/** What one OpenAI reply cost, in dollars; a model with no listed price counts at gpt-5.4's, the dearer. */
export function spareCost(model: string | undefined, usage: Usage | undefined): number {
  const p = PRICES[model ?? ''] ?? PRICES['gpt-5.4']!;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  return (((usage?.input_tokens ?? 0) - cached) * p.input + cached * p.cached + (usage?.output_tokens ?? 0) * p.output) / 1e6;
}

/** The Scout's calls: its own roles, and the web searches it runs through the tools. */
export const scoutsCall = (role: string): boolean => role === 'scout' || role.startsWith('scout.') || role === 'tool.web';

export interface OverflowOptions {
  /** Meta's model, shared by every space, with its rate window. */
  meta: ModelClient & { free(priority: Priority): boolean };
  /** OpenAI's models behind the same interface. */
  spare: ModelClient;
  /** A web search on OpenAI. */
  search: (req: { query: string; max?: number; prefer?: string }) => Promise<WebResult[]>;
  /** Told of each call sent to OpenAI. */
  overflowed: (role: string, kind: 'json' | 'search') => void;
}

/** Meta's model, except that a Scout call goes to OpenAI instead of waiting when Meta's minute is full. */
export class Overflow implements ModelClient {
  constructor(private readonly opts: OverflowOptions) {}

  json<T>(req: JsonRequest<T>): Promise<T> {
    if (!this.full(req.role, req.priority)) return this.opts.meta.json(req);
    this.opts.overflowed(req.role, 'json');
    return this.opts.spare.json(req);
  }

  search(req: { role: string; query: string; max?: number; prefer?: string }): Promise<WebResult[]> {
    if (!this.full(req.role, 'user')) return this.opts.meta.search(req);
    this.opts.overflowed(req.role, 'search');
    return this.opts.search(req);
  }

  image(req: { role: string; prompt: string }) {
    return this.opts.meta.image(req);
  }

  transcribe(req: { audio: Uint8Array; mime: string }) {
    return this.opts.meta.transcribe(req);
  }

  private full(role: string, priority: Priority = 'user'): boolean {
    return scoutsCall(role) && !this.opts.meta.free(priority);
  }
}

/** Every model call refused while the service is paused, so nothing costs while it is off or over the day's cap. */
export class Paused implements ModelClient {
  constructor(
    private readonly model: ModelClient,
    private readonly why: () => string | null,
  ) {}

  json<T>(req: JsonRequest<T>): Promise<T> {
    return this.guard(() => this.model.json(req));
  }

  search(req: { role: string; query: string; max?: number; prefer?: string }) {
    return this.guard(() => this.model.search(req));
  }

  image(req: { role: string; prompt: string }) {
    return this.guard(() => this.model.image(req));
  }

  transcribe(req: { audio: Uint8Array; mime: string }) {
    return this.guard(() => this.model.transcribe(req));
  }

  private guard<T>(call: () => Promise<T>): Promise<T> {
    const why = this.why();
    return why ? Promise.reject(new Error(why)) : call();
  }
}
