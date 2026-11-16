import type { Priority } from '../core/ports.ts';

/**
 * The share of the limit each kind of request leaves untouched. Background work leaves a tenth for the user's turns: 6 of the key's
 * 60 requests, about what a reply and its first card take.
 */
const KEEP: Record<Priority, number> = { user: 0, background: 0.1 };
const ORDER: Priority[] = ['user', 'background'];

/** A request let out, with what to call once its answer has ended, or one given up when it could not be let out in time. */
export type Slot = { heldMs: number; done: () => void } | { heldMs: number; done?: undefined };

/**
 * The key's rate limit as the API's replies show it: so many requests and tokens in any window, shared by every program on the key.
 * Measured, a request counts from when its answer ends, refused or not, for a minute, and a reply's count of what is left leaves out
 * the requests still being answered.
 */
export class RateWindow {
  /** This program's requests still in the window, each until a window after its answer ended, or for as long as it is answered. */
  private readonly sent = new Set<{ until: number }>();
  private readonly limit = { requests: Infinity, tokens: Infinity };
  /** Other programs' requests, as many as a reply counted beyond this program's, until those have surely left the window. */
  private others = { count: 0, until: 0 };
  private tokens = { left: Infinity, until: 0 };
  private refusedUntil = 0;
  private readonly held: Record<Priority, { asked: number; until: number; go: (slot: Slot) => void }[]> = { user: [], background: [] };
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** A sixtieth of the window, a second of the API's minute: for the clocks' difference, and the shortest a refusal holds. */
  private readonly margin: number;
  /** How long a request stays in the window after its answer ends. */
  private readonly span: number;

  constructor(readonly ms = 60_000) {
    this.margin = ms / 60;
    this.span = ms + this.margin;
  }

  /**
   * Resolves once the window has room for a request of this kind, the user's first. A request it cannot let out within `waitMs` is
   * given up then, or at once when a refusal holds every request for longer.
   */
  take(priority: Priority, waitMs: number): Promise<Slot> {
    return new Promise((go) => {
      const now = Date.now();
      this.held[priority].push({ asked: now, until: now + waitMs, go });
      this.release(now);
    });
  }

  /** Whether a request of this kind would be let out now, with none held before it. */
  free(priority: Priority): boolean {
    const now = Date.now();
    this.prune(now);
    return ORDER.slice(0, ORDER.indexOf(priority) + 1).every((p) => this.held[p].length === 0) && this.room(priority, now);
  }

  /** What a reply says is left of the window. */
  read(res: { status: number; headers: Headers }): void {
    const now = Date.now();
    this.limit.requests = count(res.headers, 'x-ratelimit-limit-requests') ?? this.limit.requests;
    this.limit.tokens = count(res.headers, 'x-ratelimit-limit-tokens') ?? this.limit.tokens;
    const requests = count(res.headers, 'x-ratelimit-remaining-requests');
    const tokens = count(res.headers, 'x-ratelimit-remaining-tokens');
    this.prune(now);
    if (tokens !== undefined) this.tokens = { left: tokens, until: now + this.span };
    if (requests !== undefined && Number.isFinite(this.limit.requests)) {
      // Any request this program has sent may be in the count, so only what is beyond all of them is surely other programs'.
      const theirs = Math.max(0, this.limit.requests - requests - this.sent.size);
      if (theirs > this.others.count || now >= this.others.until) this.others = { count: theirs, until: now + this.span };
    }
    // A refusal the counts do not explain, as of a request larger than the tokens left, holds every request as long as it asks,
    // and long enough that a shorter ask does not turn into a request sent again and again.
    if (res.status === 429 && this.room('user', now)) {
      const after = count(res.headers, 'retry-after');
      this.refusedUntil = Math.max(this.refusedUntil, now + Math.max(this.margin, after ? after * 1000 : this.ms));
    }
    this.release(now);
  }

  private prune(now: number): void {
    for (const request of this.sent) if (request.until <= now) this.sent.delete(request);
  }

  private room(priority: Priority, now: number): boolean {
    if (now < this.refusedUntil) return false;
    const others = now < this.others.until ? this.others.count : 0;
    const tokens = now < this.tokens.until ? this.tokens.left : Infinity;
    const left = (have: number, limit: number) => have > (Number.isFinite(limit) ? KEEP[priority] * limit : 0);
    return left(this.limit.requests - this.sent.size - others, this.limit.requests) && left(tokens, this.limit.tokens);
  }

  private release(now = Date.now()): void {
    this.prune(now);
    for (const priority of ORDER) {
      const queue = this.held[priority];
      while (queue.length > 0 && this.room(priority, now)) {
        const { asked, go } = queue.shift()!;
        const request = { until: Infinity };
        this.sent.add(request);
        go({
          heldMs: now - asked,
          done: () => {
            request.until = Date.now() + this.span;
            this.release();
          },
        });
      }
      if (queue.length > 0) break;
    }
    for (const priority of ORDER) {
      this.held[priority] = this.held[priority].filter(({ asked, until, go }) => {
        if (until > Math.max(now, this.refusedUntil)) return true;
        go({ heldMs: now - asked });
        return false;
      });
    }
    clearTimeout(this.timer);
    if (ORDER.every((priority) => this.held[priority].length === 0)) return;
    // Room comes back when a request leaves the window, or when what was said of other programs, or a refusal, runs out. While
    // every request in the way is still being answered, the end of an answer releases instead.
    const times = [
      this.refusedUntil,
      this.others.until,
      this.tokens.until,
      ...[...this.sent].map((r) => r.until),
      ...ORDER.flatMap((priority) => this.held[priority].map((h) => h.until)),
    ].filter((t) => t > now && t < Infinity);
    if (times.length > 0) this.timer = setTimeout(() => this.release(), Math.min(...times) - now);
  }
}

function count(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : undefined;
}
