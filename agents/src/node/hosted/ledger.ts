import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Metered } from '../server.ts';

/**
 * What one device may do in a day, and what the whole service may spend in one. A per-device limit of null is off: the testing
 * mode, while the team tests (deploy/testing.env). The token budget is always on.
 */
export interface Limits {
  voiceMinutes: number | null;
  searches: number | null;
  webAnswers: number | null;
  /** What the whole service may spend in a day, or null for no cap: the user's choice for judging, bounded by the shares instead. */
  dollarsPerDay: number | null;
  /** One device's share of the day's spend, so one judge cannot spend the cap for everyone. */
  deviceDollars: number | null;
  /** One device's share of Meta's tokens in a day, which have no price and so would never reach the cap. */
  deviceTokens: number | null;
  /** Meta's tokens the whole service may use in a day, a guard against a runaway loop, counted again each day as the shares are. */
  tokensPerDay: number;
}

/**
 * A device's shares stop only a device past its own limits. $23 is the most one device can spend in a day inside them, rounded up:
 * 60 voice minutes on the full realtime model ($8.06), 30 Scout runs with their pictures, OpenAI web searches and the whole run
 * overflowed to OpenAI ($13.12), and 30 web answers ($1.44): $22.62. 9M tokens is about twice the most a device uses on Meta's model inside
 * them: 30 Scout runs at 120,000 tokens, with typical turns, organizing, questions and drops besides (4.5M), and under a quarter of
 * fly.toml's 60M token budget. The working is in reports/ws37.md of the judging program.
 */
export const DEFAULT_LIMITS: Limits = { voiceMinutes: 60, searches: 30, webAnswers: 30, dollarsPerDay: null, deviceDollars: 23, deviceTokens: 9_000_000, tokensPerDay: 180_000_000 };

/**
 * The limits as the service's environment sets them. A per-device limit set to 0 is off; one not set keeps its judging value, so a
 * setting left out never switches a limit off. The cap is off unset or at 0 (the user's decision), and a value that is no number
 * stops the service at start rather than switching anything off.
 */
export function limitsFrom(env: Record<string, string | undefined>): Limits {
  const given = (name: string): number | undefined => {
    const raw = env[name]?.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} is "${raw}", not a number of 0 or more`);
    return value;
  };
  const limit = (name: string, judging: number | null): number | null => {
    const value = given(name);
    return value === undefined ? judging : value > 0 ? value : null;
  };
  return {
    voiceMinutes: limit('MIND_PALACE_LIMIT_VOICE_MINUTES', DEFAULT_LIMITS.voiceMinutes),
    searches: limit('MIND_PALACE_LIMIT_SEARCHES', DEFAULT_LIMITS.searches),
    webAnswers: limit('MIND_PALACE_LIMIT_WEB_ANSWERS', DEFAULT_LIMITS.webAnswers),
    dollarsPerDay: given('MIND_PALACE_CAP_DOLLARS') || null,
    deviceDollars: limit('MIND_PALACE_LIMIT_DEVICE_DOLLARS', DEFAULT_LIMITS.deviceDollars),
    deviceTokens: limit('MIND_PALACE_LIMIT_DEVICE_TOKENS', DEFAULT_LIMITS.deviceTokens),
    tokensPerDay: given('MIND_PALACE_TOKEN_BUDGET') || DEFAULT_LIMITS.tokensPerDay,
  };
}

/** The device whose work this is, for the model's calls, which the whole service shares: its tokens and spend are counted to it. */
export const forDevice = new AsyncLocalStorage<string>();

/**
 * Why work is refused, in the order it is checked: the off switch, the day's spend, the day's tokens, the device's share of them,
 * then its own limit.
 */
export type Refusal = 'off' | 'cap' | 'budget' | 'share' | Metered;

/** What Momo says for each refusal. */
export const LINES: Record<Refusal, string> = {
  off: 'Mind Palace is paused for a little while. Your trees are safe, so try again soon.',
  cap: "Mind Palace has done all it can for today. Your trees are safe; come back tomorrow.",
  budget: "Mind Palace has done all the thinking it can for today. Your trees are safe; come back tomorrow.",
  share: "This headset has reached today's limit, so I can't do more for it until tomorrow. Your trees are all here to browse.",
  voiceMs: "That's all the talking I can do today. Your trees are still here to browse.",
  searches: "That's today's searches used up. I can still talk, and your trees are all here.",
  webAnswers: "I can't look things up on the web any more today, but I can tell you what I know.",
};

/** The day's spend at which the user's Telegram chat hears of it, with or without a cap: $25, $50, $100, then every $100. */
export function alertsPassed(dollars: number): number[] {
  return [25, 50, ...Array.from({ length: Math.floor(dollars / 100) }, (_v, n) => (n + 1) * 100)].filter((at) => at <= dollars);
}

const Usage = z.object({ voiceMs: z.number().default(0), searches: z.number().default(0), webAnswers: z.number().default(0), dollars: z.number().default(0), tokens: z.number().default(0) });
type Usage = z.infer<typeof Usage>;

const Saved = z.object({
  /** The day, in the judges' time zone, that everything but `off` counts. */
  day: z.string(),
  off: z.boolean().default(false),
  dollars: z.number().default(0),
  /** Meta's tokens, which have no listed price; counted at `metaDollarsPerMillion`. */
  metaTokens: z.number().default(0),
  overflows: z.number().default(0),
  /** The amounts the chat has heard of today, and whether it heard that the cap was reached. */
  alerted: z.array(z.number()).default([]),
  capAlerted: z.boolean().default(false),
  devices: z.record(z.string(), Usage).default({}),
});
type Saved = z.infer<typeof Saved>;

export interface LedgerOptions {
  /** Where the day is kept, so a redeploy in the middle of it keeps its counts. */
  file: string;
  limits: Limits;
  /** The time zone a day is counted in. */
  zone?: string;
  /** What Meta's tokens cost, in dollars per million. Unlisted, so 0 unless told. */
  metaDollarsPerMillion?: number;
  now?: () => Date;
  /** Told when the day's spend passes each amount of `alertsPassed`, and when it reaches the cap, if there is one. */
  alert?: (text: string) => void;
}

/**
 * The service's day: each device's voice, searches and web answers, the day's spend against its cap, and the off switch.
 * Counts start again at midnight in `zone`; the off switch stays until it is flipped back.
 */
export class Ledger {
  private saved: Saved;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The day in the judges' time zone, as YYYY-MM-DD. Made once: it is asked for on every piece of audio. */
  private readonly dayOf: Intl.DateTimeFormat;
  private readonly now: () => Date;

  constructor(private readonly opts: LedgerOptions) {
    this.dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: opts.zone ?? 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
    this.now = opts.now ?? (() => new Date());
    this.saved = this.load();
  }

  get limits(): Limits {
    return this.opts.limits;
  }

  /** Why this device may not do this kind of work now, or null. */
  refusal(device: string, kind: Metered): Refusal | null {
    const held = this.held(device);
    if (held) return held;
    const used = this.today().devices[device]?.[kind] ?? 0;
    const { voiceMinutes, searches, webAnswers } = this.opts.limits;
    const limit = { voiceMs: voiceMinutes === null ? null : voiceMinutes * 60_000, searches, webAnswers }[kind];
    return limit !== null && used >= limit ? kind : null;
  }

  /** Why this device's model calls are refused now, or null: the off switch, the day's cap, or the device's share of it. */
  held(device: string): Refusal | null {
    return this.paused() ?? (this.shareUsed(device) ? 'share' : null);
  }

  private shareUsed(device: string): boolean {
    const usage = this.today().devices[device];
    const { deviceDollars, deviceTokens } = this.opts.limits;
    return Boolean(usage && ((deviceDollars !== null && usage.dollars >= deviceDollars) || (deviceTokens !== null && usage.tokens >= deviceTokens)));
  }

  /** Whether the service does no costly work at all now: switched off, the day's cap spent, or the day's tokens used. */
  paused(): Refusal | null {
    const day = this.today();
    if (day.off) return 'off';
    const cap = this.opts.limits.dollarsPerDay;
    if (cap !== null && day.dollars >= cap) return 'cap';
    return day.metaTokens >= this.opts.limits.tokensPerDay ? 'budget' : null;
  }

  used(device: string, kind: Metered, amount: number): void {
    const usage = (this.today().devices[device] ??= Usage.parse({}));
    usage[kind] += amount;
    this.changed();
  }

  spend(dollars: number, device?: string): void {
    if (!(dollars > 0)) return;
    const day = this.today();
    day.dollars += dollars;
    if (device) (day.devices[device] ??= Usage.parse({})).dollars += dollars;
    this.changed();
    const fresh = alertsPassed(day.dollars).filter((at) => !day.alerted.includes(at));
    if (fresh.length > 0) {
      day.alerted.push(...fresh);
      this.opts.alert?.(`Mind Palace judging: today's spend passed $${fresh.at(-1)} ($${day.dollars.toFixed(2)}).`);
    }
    const cap = this.opts.limits.dollarsPerDay;
    if (cap !== null && day.dollars >= cap && !day.capAlerted) {
      day.capAlerted = true;
      this.opts.alert?.(`Mind Palace judging: today's spend reached the $${cap} cap. Costly work is refused until midnight Pacific; raise MIND_PALACE_CAP_DOLLARS, or set it to 0 for no cap, and redeploy to lift it.`);
    }
  }

  metaTokens(tokens: number, device?: string): void {
    const day = this.today();
    day.metaTokens += tokens;
    if (device) (day.devices[device] ??= Usage.parse({})).tokens += tokens;
    this.spend((tokens * (this.opts.metaDollarsPerMillion ?? 0)) / 1e6, device);
    this.changed();
  }

  overflowed(): void {
    this.today().overflows += 1;
    this.changed();
  }

  setOff(off: boolean): void {
    this.today().off = off;
    this.changed();
    this.flush();
  }

  status() {
    const day = this.today();
    return {
      day: day.day,
      off: day.off,
      paused: this.paused(),
      spentToday: Number(day.dollars.toFixed(4)),
      cap: this.opts.limits.dollarsPerDay ?? 'none',
      metaTokens: day.metaTokens,
      overflows: day.overflows,
      limits: Object.fromEntries(Object.entries(this.opts.limits).map(([name, value]) => [name, value ?? 'none'])),
      devices: Object.fromEntries(
        Object.entries(day.devices).map(([id, u]) => [id, { voiceMinutes: Number((u.voiceMs / 60_000).toFixed(3)), searches: u.searches, webAnswers: u.webAnswers, dollars: Number(u.dollars.toFixed(4)), tokens: u.tokens }]),
      ),
    };
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(dirname(this.opts.file), { recursive: true });
    writeFileSync(`${this.opts.file}.tmp`, JSON.stringify(this.saved, null, 2));
    renameSync(`${this.opts.file}.tmp`, this.opts.file);
  }

  private today(): Saved {
    const day = this.dayOf.format(this.now());
    if (this.saved.day !== day) {
      this.saved = Saved.parse({ day, off: this.saved.off });
      this.changed();
    }
    return this.saved;
  }

  private load(): Saved {
    if (existsSync(this.opts.file)) {
      try {
        return Saved.parse(JSON.parse(readFileSync(this.opts.file, 'utf8')));
      } catch {
        // A file that does not parse starts the day afresh, off switch included.
      }
    }
    return Saved.parse({ day: '' });
  }

  /** Voice is counted every tenth of a second, so the file is written at most every two. */
  private changed(): void {
    this.timer ??= setTimeout(() => this.flush(), 2000);
    this.timer.unref?.();
  }
}
