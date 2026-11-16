import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Metered } from '../server.ts';

/** What one device may do in a day, and what the whole service may spend in one. */
export interface Limits {
  voiceMinutes: number;
  searches: number;
  webAnswers: number;
  dollarsPerDay: number;
}

export const DEFAULT_LIMITS: Limits = { voiceMinutes: 60, searches: 30, webAnswers: 30, dollarsPerDay: 30 };

/** Why work is refused, in the order it is checked: the off switch, the day's spend, then the device's own limit. */
export type Refusal = 'off' | 'cap' | Metered;

/** What Momo says for each refusal. */
export const LINES: Record<Refusal, string> = {
  off: 'Mind Palace is paused for a little while. Your trees are safe, so try again soon.',
  cap: "Mind Palace has done all it can for today. Your trees are safe; come back tomorrow.",
  voiceMs: "That's all the talking I can do today. Your trees are still here to browse.",
  searches: "That's today's searches used up. I can still talk, and your trees are all here.",
  webAnswers: "I can't look things up on the web any more today, but I can tell you what I know.",
};

/** Spend alerts, as shares of the day's cap. */
const ALERTS = [0.5, 1];

const Usage = z.object({ voiceMs: z.number().default(0), searches: z.number().default(0), webAnswers: z.number().default(0), dollars: z.number().default(0) });
type Usage = z.infer<typeof Usage>;

const Saved = z.object({
  /** The day, in the judges' time zone, that everything but `off` counts. */
  day: z.string(),
  off: z.boolean().default(false),
  dollars: z.number().default(0),
  /** Meta's tokens, which have no listed price; counted at `metaDollarsPerMillion`. */
  metaTokens: z.number().default(0),
  overflows: z.number().default(0),
  alerted: z.array(z.number()).default([]),
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
  /** Told when the day's spend passes half the cap and the whole of it. */
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
    const day = this.today();
    if (day.off) return 'off';
    if (day.dollars >= this.opts.limits.dollarsPerDay) return 'cap';
    const used = day.devices[device]?.[kind] ?? 0;
    const limit = { voiceMs: this.opts.limits.voiceMinutes * 60_000, searches: this.opts.limits.searches, webAnswers: this.opts.limits.webAnswers }[kind];
    return used >= limit ? kind : null;
  }

  /** Whether the service does no costly work at all now: switched off, or the day's cap is spent. */
  paused(): Refusal | null {
    const day = this.today();
    return day.off ? 'off' : day.dollars >= this.opts.limits.dollarsPerDay ? 'cap' : null;
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
    const cap = this.opts.limits.dollarsPerDay;
    for (const share of ALERTS) {
      if (day.dollars < share * cap || day.alerted.includes(share)) continue;
      day.alerted.push(share);
      this.opts.alert?.(
        `Mind Palace judging: today's spend passed ${share * 100}% of the $${cap} cap ($${day.dollars.toFixed(2)}).` +
          (share >= 1 ? ' Costly work is refused until midnight Pacific; raise MIND_PALACE_CAP_DOLLARS and redeploy to lift it.' : ''),
      );
    }
  }

  metaTokens(tokens: number): void {
    this.today().metaTokens += tokens;
    this.spend((tokens * (this.opts.metaDollarsPerMillion ?? 0)) / 1e6);
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
      cap: this.opts.limits.dollarsPerDay,
      metaTokens: day.metaTokens,
      overflows: day.overflows,
      limits: this.opts.limits,
      devices: Object.fromEntries(
        Object.entries(day.devices).map(([id, u]) => [id, { voiceMinutes: Number((u.voiceMs / 60_000).toFixed(3)), searches: u.searches, webAnswers: u.webAnswers, dollars: Number(u.dollars.toFixed(4)) }]),
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
