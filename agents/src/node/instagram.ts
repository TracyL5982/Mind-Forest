import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Assets, Found } from '../core/ports.ts';
import { SearchIndex, tokenize } from '../core/search.ts';
import { sipsPictures } from './library.ts';

/**
 * The user's chosen Instagram accounts as a library on this machine. The service reads each account's newest posts in the background,
 * paced by what Instagram reports of its limit, and keeps a small copy of each picture, so a search is a lookup here and waits on nothing.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Each account is read again about this long after its last read. */
export const REREAD = 48 * HOUR;
/** An account whose read failed for a reason of the moment, or kept fewer pictures than it found posts, is tried again after this. */
const RETRY = HOUR;
const POSTS = 25;
/**
 * The longest side of a kept picture, near the 420 to 620 texture px a card's picture takes on the headset; 512 would draw a 4:5 post
 * 410 px wide. Its JPEG quality: on 675 posts, 60 kept 49 KB a picture against 75 KB at 82, with no difference seen at card size.
 */
const PICTURE_SIDE = 640;
const PICTURE_QUALITY = 60;
const MAX_PICTURE_BYTES = 8_000_000;
/** Pictures fetched at once. All 25 at once, with the network at 136 KB/s, all ran past their 30 s. */
const PICTURE_FETCHES = 4;
/** How many records a search hands the Scout, and how many of them one account may be. */
const SHOWN = 8;
const PER_ACCOUNT = 2;
const CAPTION_SHOWN = 1500;

// ---- the user's list, read at the boundary

/** One account on the user's list, under every category it is listed in. */
export interface Account {
  /** Its Instagram username, as Business Discovery is asked for it. */
  handle: string;
  name: string;
  /** What the list says the account is. */
  about: string;
  categories: string[];
}

export interface Listed {
  accounts: Account[];
  /** In the list's order. */
  categories: string[];
}

const HANDLE = /^(?!\.+$)[a-z0-9._]{1,30}$/;

/**
 * The accounts of a list such as `- @handle — Name — what it is — https://www.instagram.com/handle/ (12k followers) ★`, each under the
 * heading above it, `### Ceramics (12)`. Underscores may be escaped as `\_`. An account listed under two headings is one account with both.
 */
export function parseList(markdown: string): Listed {
  const accounts = new Map<string, Account>();
  const categories: string[] = [];
  let category = '';
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.replace(/\\_/g, '_').trim();
    const heading = /^(#{1,6})\s+(.+?)(?:\s+\(\d+\))?$/.exec(line);
    if (heading) {
      category = heading[1]!.length >= 2 ? heading[2]!.trim() : '';
      continue;
    }
    const entry = /^[-*]\s+@(\S+)\s+[—–]\s+(.*)$/.exec(line);
    const handle = entry?.[1]!.toLowerCase() ?? '';
    if (!entry || !category || !HANDLE.test(handle)) continue;
    // The address and the follower count end the line. The name comes first and what the account is follows it.
    const parts = entry[2]!.split(/\s+[—–]\s+/);
    const address = parts.findIndex((part) => /^https?:\/\//.test(part));
    const [name, ...about] = (address >= 0 ? parts.slice(0, address) : parts).map((part) => part.trim());
    const account = accounts.get(handle) ?? { handle, name: name || handle, about: about.join(' — '), categories: [] };
    if (!account.categories.includes(category)) account.categories.push(category);
    if (!categories.includes(category)) categories.push(category);
    accounts.set(handle, account);
  }
  return { accounts: [...accounts.values()], categories };
}

// ---- the library on disk

const KeptPost = z.object({
  id: z.string(),
  caption: z.string(),
  type: z.enum(['image', 'video', 'album']),
  /** When it was posted, as an ISO time. */
  at: z.string(),
  /** The post on Instagram. */
  url: z.string(),
});
/** One post as the library keeps it. Its picture is `pictures/<id>.jpg`; a post whose picture could not be kept is not kept either. */
export type Post = z.infer<typeof KeptPost>;

/** What the last read of an account found, as its file `accounts/<handle>.json` keeps it. */
const Kept = z.discriminatedUnion('state', [
  // `missing` counts the posts left out because their picture could not be fetched or made.
  z.object({ state: z.literal('read'), at: z.string(), posts: z.array(KeptPost), missing: z.number().optional() }),
  z.object({ state: z.literal('unreadable'), at: z.string(), why: z.string() }),
]);
export type Reading = z.infer<typeof Kept>;

interface Entry {
  post: Post;
  account: Account;
}

/** The library: what each listed account's last read found, its pictures, and an index of their words. */
export class InstagramLibrary {
  readonly accounts: Account[];
  readonly categories: string[];
  private readonly readings = new Map<string, Reading>();
  private readonly entries = new Map<string, Entry>();
  private readonly index = new SearchIndex();
  /** Searches into the assets the library was opened with, when it was opened with some. */
  private readonly own: { search(query: string): Promise<Found[]> } | null;

  constructor(
    readonly dir: string,
    listed: Listed,
    assets?: Assets,
  ) {
    this.accounts = listed.accounts;
    this.categories = listed.categories;
    mkdirSync(join(dir, 'accounts'), { recursive: true });
    mkdirSync(join(dir, 'pictures'), { recursive: true });
    for (const account of this.accounts) {
      try {
        this.take(account, Kept.parse(JSON.parse(readFileSync(this.file(account.handle), 'utf8'))));
      } catch {
        // Never read, or its file is not one this library wrote: the account is read again.
      }
    }
    this.own = assets ? followingIn(this, assets) : null;
  }

  /** How many posts it holds. */
  size(): number {
    return this.entries.size;
  }

  reading(handle: string): Reading | undefined {
    return this.readings.get(handle);
  }

  /** When the account is due to be read again, or undefined when it has never been read. */
  dueAt(handle: string): number | undefined {
    const reading = this.readings.get(handle);
    if (!reading) return undefined;
    return Date.parse(reading.at) + (reading.state === 'read' && reading.missing ? RETRY : REREAD);
  }

  picture(id: string): string {
    return join(this.dir, 'pictures', `${id}.jpg`);
  }

  /** Keeps what a read of an account found, and lets go of the pictures of the posts it no longer holds. */
  keep(account: Account, reading: Reading): void {
    const before = this.readings.get(account.handle);
    const file = this.file(account.handle);
    writeFileSync(`${file}.part`, JSON.stringify(reading));
    renameSync(`${file}.part`, file);
    this.take(account, reading);
    const kept = new Set(reading.state === 'read' ? reading.posts.map((p) => p.id) : []);
    for (const post of before?.state === 'read' ? before.posts : []) if (!kept.has(post.id)) rmSync(this.picture(post.id), { force: true });
  }

  /**
   * The posts that match the words, best first, each with its picture already stored as an asset. When the words name some of the
   * list's categories, posts of accounts in those categories come first.
   */
  async search(query: string): Promise<Found[]> {
    return this.own ? this.own.search(query) : [];
  }

  rank(query: string): Entry[] {
    const words = new Set(tokenize(query));
    const fits = new Set(this.categories.filter((category) => tokenize(category).some((word) => words.has(word))));
    const fit = (entry: Entry) => (entry.account.categories.some((category) => fits.has(category)) ? 1 : 0);
    const ranked = this.index
      .search(query, { limit: this.entries.size })
      .map((hit) => ({ hit, entry: this.entries.get(hit.id)! }))
      .sort((a, b) => fit(b.entry) - fit(a.entry) || b.hit.score - a.hit.score || b.entry.post.at.localeCompare(a.entry.post.at));
    const shown: Entry[] = [];
    const per = new Map<string, number>();
    for (const { entry } of ranked) {
      const n = per.get(entry.account.handle) ?? 0;
      if (n >= PER_ACCOUNT) continue;
      per.set(entry.account.handle, n + 1);
      shown.push(entry);
      if (shown.length >= SHOWN) break;
    }
    return shown;
  }

  private take(account: Account, reading: Reading): void {
    const before = this.readings.get(account.handle);
    for (const post of before?.state === 'read' ? before.posts : []) {
      this.index.remove(post.id);
      this.entries.delete(post.id);
    }
    this.readings.set(account.handle, reading);
    for (const post of reading.state === 'read' ? reading.posts : []) {
      this.entries.set(post.id, { post, account });
      this.index.set(post.id, { title: `${account.name} ${account.handle}`, tags: [...hashtags(post.caption), ...account.categories], body: `${post.caption}\n${account.about}` });
    }
  }

  private file(handle: string): string {
    return join(this.dir, 'accounts', `${handle}.json`);
  }
}

/**
 * One space's view of a library: its posts, each picture copied into that space's own assets the first time a search there hands it
 * out, and not copied again. A hosted service opens one library and reads Instagram in that one place; every space searches it
 * through a view of its own.
 */
export function followingIn(library: InstagramLibrary, assets: Assets): { categories: readonly string[]; size(): number; search(query: string): Promise<Found[]> } {
  const copies = new Map<string, string>();
  const copy = async (post: Post): Promise<string | null> => {
    const known = copies.get(post.id);
    if (known) return known;
    try {
      const { id } = await assets.put(new Uint8Array(readFileSync(library.picture(post.id))), 'image/jpeg', `instagram-${post.id}.jpg`);
      copies.set(post.id, id);
      return id;
    } catch {
      return null;
    }
  };
  return {
    categories: library.categories,
    size: () => library.size(),
    async search(query) {
      const found: Found[] = [];
      for (const { post, account } of library.rank(query)) {
        const asset = await copy(post);
        if (!asset) continue;
        found.push({ title: account.name, by: `@${account.handle}`, date: post.at.slice(0, 10), text: post.caption.slice(0, CAPTION_SHOWN), from: 'Instagram', url: post.url, asset });
      }
      return found;
    },
  };
}

const hashtags = (caption: string): string[] => [...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]!.toLowerCase());

/** Whether a caption says something a search can find: five words or more besides its hashtags and mentions. */
export function captionUseful(caption: string): boolean {
  return (caption.replace(/[#@][\p{L}\p{N}_.]+/gu, ' ').match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).length >= 5;
}

// ---- reading Instagram

export interface Connection {
  token: string;
  userId: string;
}

/** How much of Instagram's limit the app has used: the highest share any usage header reports, and how long until it is let back in. */
export interface Usage {
  percent: number;
  regainMs: number;
}

/**
 * Read from `X-App-Usage`, `{"call_count":3,"total_cputime":1,"total_time":4}`, and `X-Business-Use-Case-Usage`, which gives the same
 * shares for each business with `estimated_time_to_regain_access` in minutes. Measured, Business Discovery answers with the first alone.
 */
export function usageOf(headers: Headers): Usage {
  const shares: number[] = [];
  let regainMs = 0;
  const parse = (name: string): unknown => {
    try {
      return JSON.parse(headers.get(name) ?? 'null');
    } catch {
      return null;
    }
  };
  const take = (usage: unknown) => {
    if (!usage || typeof usage !== 'object') return;
    const u = usage as Record<string, unknown>;
    for (const key of ['call_count', 'total_cputime', 'total_time']) if (typeof u[key] === 'number') shares.push(u[key]);
    if (typeof u.estimated_time_to_regain_access === 'number') regainMs = Math.max(regainMs, u.estimated_time_to_regain_access * MINUTE);
  };
  take(parse('x-app-usage'));
  const business = parse('x-business-use-case-usage');
  if (business && typeof business === 'object') for (const each of Object.values(business)) for (const usage of Array.isArray(each) ? each : []) take(usage);
  return { percent: Math.max(0, ...shares), regainMs };
}

/**
 * The wait after each answer, by the share of the limit used: one call every 15 s while under half, 240 an hour, above the guess of 200
 * an hour, and slower as the hour fills, so the user's other uses of the connection always have room.
 */
const PACE: readonly { below: number; ms: number }[] = [
  { below: 50, ms: 15_000 },
  { below: 75, ms: 40_000 },
  { below: 90, ms: 2 * MINUTE },
  { below: Infinity, ms: 15 * MINUTE },
];

export function paceAfter(usage: Usage): number {
  return Math.max(PACE.find((step) => usage.percent < step.below)!.ms, usage.regainMs);
}

/** A post as Business Discovery gave it, with the address of the picture to keep: a video's thumbnail, an album's first picture. */
interface Seen extends Post {
  picture: string;
}

/**
 * What one Business Discovery call found. `held` is Instagram asking for a wait, or refusing the connection itself, so no account is read
 * until then. `failed` is this call going wrong, so the account is tried again later and what it had is kept.
 */
export type Answer =
  | { kind: 'read'; posts: Seen[] }
  | { kind: 'unreadable'; why: string }
  | { kind: 'held'; why: string; ms: number }
  | { kind: 'failed'; why: string };

const GRAPH = 'https://graph.facebook.com/v21.0';
const FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
/** Graph API errors that mean the app or the user has used up its limit. */
const LIMITED = new Set([4, 17, 32, 613, 80002]);
/** Errors about the connection itself: an expired token, a missing permission. */
const REFUSED = new Set([10, 190, 200]);
const TYPES: Record<string, Post['type']> = { IMAGE: 'image', VIDEO: 'video', CAROUSEL_ALBUM: 'album' };

export async function discover(send: typeof fetch, connection: Connection, handle: string): Promise<{ answer: Answer; usage: Usage; ms: number }> {
  const started = Date.now();
  let res: Response;
  try {
    res = await send(`${GRAPH}/${connection.userId}?fields=business_discovery.username(${handle}){media.limit(${POSTS}){${FIELDS}}}`, {
      headers: { Authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { answer: { kind: 'failed', why: err instanceof Error ? err.message : String(err) }, usage: { percent: 0, regainMs: 0 }, ms: Date.now() - started };
  }
  const usage = usageOf(res.headers);
  const json = (await res.json().catch(() => null)) as Record<string, any> | null;
  const ms = Date.now() - started;
  const error = json?.error as Record<string, any> | undefined;
  const why = String(error?.error_user_title || error?.message || `answered ${res.status}`);
  if (res.ok && json?.business_discovery) return { answer: { kind: 'read', posts: seen(json.business_discovery.media?.data) }, usage, ms };
  if (LIMITED.has(error?.code)) return { answer: { kind: 'held', why, ms: Math.max(15 * MINUTE, usage.regainMs) }, usage, ms };
  if (REFUSED.has(error?.code)) return { answer: { kind: 'held', why, ms: HOUR }, usage, ms };
  if (!error || error.is_transient === true || res.status >= 500) return { answer: { kind: 'failed', why }, usage, ms };
  // Instagram said this account cannot be read, as it says of a personal account ("Cannot find User").
  return { answer: { kind: 'unreadable', why }, usage, ms };
}

function seen(data: unknown): Seen[] {
  return (Array.isArray(data) ? data : []).flatMap((m: Record<string, unknown>): Seen[] => {
    const type = TYPES[String(m.media_type)];
    const picture = String((type === 'video' ? m.thumbnail_url : m.media_url) ?? '');
    const at = new Date(String(m.timestamp ?? '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
    const url = String(m.permalink ?? '');
    if (!type || typeof m.id !== 'string' || !/^https:\/\//.test(picture) || !/^https:\/\/www\.instagram\.com\//.test(url) || Number.isNaN(at.getTime())) return [];
    return [{ id: m.id, caption: typeof m.caption === 'string' ? m.caption : '', type, at: at.toISOString(), url, picture }];
  });
}

/** Small copies of pictures, sized for cards. Null for one that could not be made. */
export type Shrink = (pictures: Uint8Array[]) => Promise<(Uint8Array | null)[]>;

/** Made with macOS's `sips`, as the headset's library makes its pictures. */
export const sipsShrink: Shrink = async (pictures) => {
  const dir = mkdtempSync(join(tmpdir(), 'instagram-'));
  try {
    const paths = pictures.map((bytes, n) => {
      const path = join(dir, `${n}.jpg`);
      writeFileSync(path, bytes);
      return path;
    });
    const made = await sipsPictures.jpeg(paths, PICTURE_SIDE, PICTURE_QUALITY);
    return paths.map((path) => made.get(path) ?? null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** What reading one account did, for the log. */
export interface Outcome {
  answer: Answer;
  usage: Usage;
  ms: number;
  /** Posts kept, and how many of their pictures were fetched now and their bytes. */
  posts?: number;
  fetched?: number;
  bytes?: number;
}

/**
 * The account to read next and when. Accounts never read come first, in `order`; then the one due soonest, as `dueAt` says. An account
 * whose read just failed waits an hour.
 */
export function nextRead(order: Account[], dueAt: (handle: string) => number | undefined, failedAt: ReadonlyMap<string, number>, now: number): { account: Account; at: number } | undefined {
  let next: { account: Account; at: number; due: number } | undefined;
  for (const account of order) {
    const due = Math.max(dueAt(account.handle) ?? -Infinity, (failedAt.get(account.handle) ?? -Infinity) + RETRY);
    if (!next || due < next.due) next = { account, at: Math.max(now, due), due };
  }
  return next && { account: next.account, at: next.at };
}

/** The accounts taking the list's categories in turn, so the first of the library's posts already span them. */
export function inTurn(listed: Listed): Account[] {
  const lists = listed.categories.map((category) => listed.accounts.filter((a) => a.categories[0] === category));
  const order: Account[] = [];
  for (let n = 0; order.length < listed.accounts.length; n++) for (const list of lists) if (list[n]) order.push(list[n]!);
  return order;
}

export interface ReaderOptions {
  library: InstagramLibrary;
  connection: Connection;
  send?: typeof fetch;
  shrink?: Shrink;
  log?: (line: string) => void;
}

/** Reads the library's accounts one call at a time, for as long as the service runs. */
export class InstagramReader {
  private readonly order: Account[];
  private readonly failedAt = new Map<string, number>();
  private readonly send: typeof fetch;
  private readonly shrink: Shrink;
  private readonly log: (line: string) => void;
  private stopped = false;
  private notBefore = 0;
  private wake: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly o: ReaderOptions) {
    this.order = inTurn({ accounts: o.library.accounts, categories: o.library.categories });
    this.send = o.send ?? fetch.bind(globalThis);
    this.shrink = o.shrink ?? sipsShrink;
    this.log = o.log ?? (() => {});
  }

  start(): void {
    void this.loop().catch((err) => this.log(`[instagram] reading stopped: ${err instanceof Error ? err.message : String(err)}`));
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.wake?.();
  }

  /** Reads one account now and keeps what it found. */
  async read(account: Account): Promise<Outcome> {
    const { answer, usage, ms } = await discover(this.send, this.o.connection, account.handle);
    const now = new Date().toISOString();
    if (answer.kind === 'unreadable') this.o.library.keep(account, { state: 'unreadable', at: now, why: answer.why });
    if (answer.kind !== 'read') return { answer, usage, ms };
    const { posts, fetched, bytes } = await this.pictures(answer.posts);
    const missing = answer.posts.length - posts.length;
    this.o.library.keep(account, { state: 'read', at: now, posts, ...(missing > 0 ? { missing } : {}) });
    return { answer, usage, ms, posts: posts.length, fetched, bytes };
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const library = this.o.library;
      const next = nextRead(this.order, (handle) => library.dueAt(handle), this.failedAt, Date.now());
      if (!next) return;
      // Once every account has been read, reads again are spread over the two days, whatever the first fill bunched together.
      const spread = library.reading(next.account.handle) === undefined ? 0 : REREAD / this.order.length;
      await this.sleep(Math.max(next.at, this.notBefore + spread) - Date.now());
      if (this.stopped) return;
      const outcome = await this.read(next.account).catch((err): Outcome => ({ answer: { kind: 'failed', why: err instanceof Error ? err.message : String(err) }, usage: { percent: 0, regainMs: 0 }, ms: 0 }));
      const { answer, usage } = outcome;
      if (answer.kind === 'failed') this.failedAt.set(next.account.handle, Date.now());
      else this.failedAt.delete(next.account.handle);
      this.notBefore = Date.now() + Math.max(paceAfter(usage), answer.kind === 'held' ? answer.ms : 0);
      this.log(`[instagram] @${next.account.handle}: ${said(outcome)}`);
    }
  }

  /** The posts whose pictures are kept, fetching and shrinking only the ones not kept yet. */
  private async pictures(posts: Seen[]): Promise<{ posts: Post[]; fetched: number; bytes: number }> {
    const library = this.o.library;
    const missing = posts.filter((p) => !existsSync(library.picture(p.id)));
    const fetched: (Uint8Array | null)[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(PICTURE_FETCHES, missing.length) }, async () => {
        for (let n = next++; n < missing.length; n = next++) fetched[n] = await this.fetchPicture(missing[n]!.picture);
      }),
    );
    const got = missing.flatMap((p, n) => (fetched[n] ? [{ post: p, bytes: fetched[n]! }] : []));
    const small = got.length > 0 ? await this.shrink(got.map((g) => g.bytes)) : [];
    let bytes = 0;
    got.forEach(({ post }, n) => {
      const made = small[n];
      if (!made) return;
      const file = library.picture(post.id);
      writeFileSync(`${file}.part`, made);
      renameSync(`${file}.part`, file);
      bytes += made.length;
    });
    const kept = posts.filter((p) => existsSync(library.picture(p.id))).map(({ picture: _picture, ...post }) => post);
    return { posts: kept, fetched: got.length, bytes };
  }

  private async fetchPicture(url: string): Promise<Uint8Array | null> {
    try {
      const res = await this.send(url, { signal: AbortSignal.timeout(30_000) });
      const bytes = new Uint8Array(await res.arrayBuffer());
      return res.ok && /^image\//.test(res.headers.get('content-type') ?? '') && bytes.length > 0 && bytes.length <= MAX_PICTURE_BYTES ? bytes : null;
    } catch {
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(resolve, ms);
      this.timer.unref?.();
    });
  }
}

export function said({ answer, usage, ms, posts, fetched, bytes }: Outcome): string {
  const tail = `${ms} ms, ${usage.percent}% of the limit used`;
  if (answer.kind === 'read') {
    const lost = answer.posts.length - (posts ?? 0);
    return `${posts} posts kept, ${fetched} pictures fetched (${Math.round((bytes ?? 0) / 1024)} KB)${lost > 0 ? `, ${lost} left out for want of a picture, read again in an hour` : ''}, ${tail}`;
  }
  if (answer.kind === 'held') return `Instagram asks for a wait (${answer.why}), next read in ${Math.round(answer.ms / MINUTE)} min, ${tail}`;
  return `${answer.kind === 'unreadable' ? 'cannot be read' : 'failed, tried again in an hour'} (${answer.why}), ${tail}`;
}

/**
 * The library, and its reader when reading is on and there is a connection. Without one, the library is searched as it is kept and
 * Instagram is never called. Null without a list, which leaves Instagram out of the Scout's sources.
 */
export function openInstagram(o: { connection?: Connection; list: string; dir: string; assets?: Assets; read: boolean; log: (line: string) => void }): { library: InstagramLibrary; reader?: InstagramReader } | null {
  let listed: Listed;
  try {
    listed = parseList(readFileSync(o.list, 'utf8'));
  } catch {
    o.log(`[instagram] no list of accounts at ${o.list}, so Instagram is not searched`);
    return null;
  }
  if (listed.accounts.length === 0) {
    o.log(`[instagram] the list at ${o.list} names no accounts, so Instagram is not searched`);
    return null;
  }
  const library = new InstagramLibrary(o.dir, listed, o.assets);
  const reader = o.read && o.connection ? new InstagramReader({ library, connection: o.connection, log: o.log }) : undefined;
  reader?.start();
  const reading = reader ? 'reading in the background' : o.read ? 'reading asked for but there is no META_IG_TOKEN and META_IG_USER_ID, so nothing is read' : 'reading off';
  o.log(`[instagram] ${listed.accounts.length} accounts in ${listed.categories.length} categories, ${library.size()} posts kept, ${reading}`);
  return { library, ...(reader ? { reader } : {}) };
}
