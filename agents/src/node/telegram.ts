import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { Arrival, Attachment, Channel, ContactStatus, Delivery, Desk, Invite } from './contact.ts';
import { OWNER_LINES, Talk, type Wire } from './talk.ts';

export const BOT_API = 'https://api.telegram.org';
/** The largest file a bot may fetch from Telegram. */
export const MAX_BOT_FILE = 20 * 1024 * 1024;
export const CODE_MS = 10 * 60 * 1000;
const MAX_RETRY_MS = 60_000;

export interface BotOptions {
  token: string;
  log: (line: string) => void;
  /** The Bot API's address. Tests point it at a stand-in. */
  api?: string;
  /** How long one getUpdates waits for a message, in seconds. */
  pollSeconds?: number;
  /** The wait after Telegram says another program is reading this bot's messages. */
  conflictMs?: number;
  /** The first wait after any other failure. It doubles up to a minute. */
  retryMs?: number;
  /** Where the token is set, said when Telegram refuses it. */
  tokenFrom?: string;
}

export interface TelegramOptions extends BotOptions {
  desk: Desk;
  /** Where the pairing and the read position are kept. */
  file: string;
  /**
   * The account paired at start when the file holds none: the demo on Fly, which keeps no file between deploys, is paired so to the
   * account its owner paired on their Mac (`ownerSecret`).
   */
  owner?: Paired;
  now?: () => number;
}

/** Which bot a file's read position belongs to, and how far its messages have been read. */
export const Position = z.object({ bot: z.number().nullable().default(null), offset: z.number().int().default(0) });
type Position = z.infer<typeof Position>;

const Paired = z.object({ userId: z.number(), chatId: z.number(), name: z.string() });
export type Paired = z.infer<typeof Paired>;
/** The bot the read position and the pairing belong to. A new token for another bot starts both afresh. */
const Saved = Position.extend({ paired: Paired.nullable().default(null) });

const Me = z.object({ id: z.number(), username: z.string() });
const FileRef = z.object({
  file_id: z.string(),
  file_size: z.number().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
});
type FileRef = z.infer<typeof FileRef>;
const Message = z.object({
  message_id: z.number(),
  from: z.object({ id: z.number(), first_name: z.string().optional(), last_name: z.string().optional(), username: z.string().optional() }).optional(),
  chat: z.object({ id: z.number(), type: z.string() }),
  text: z.string().optional(),
  caption: z.string().optional(),
  photo: z.array(FileRef).optional(),
  video: FileRef.optional(),
  video_note: FileRef.optional(),
  audio: FileRef.optional(),
  voice: FileRef.optional(),
  document: FileRef.optional(),
});
export type Message = z.infer<typeof Message>;
const Update = z.object({ update_id: z.number(), message: Message.optional() });

/** The single-file kinds of message, the type each is taken to be when Telegram gives none, and the name it gets when it has none. */
const SINGLE: { field: 'video' | 'video_note' | 'audio' | 'document'; mime: string; stem: string; ext: string }[] = [
  { field: 'video', mime: 'video/mp4', stem: 'video', ext: '.mp4' },
  { field: 'video_note', mime: 'video/mp4', stem: 'video', ext: '.mp4' },
  { field: 'audio', mime: 'audio/mpeg', stem: 'audio', ext: '.mp3' },
  { field: 'document', mime: 'application/octet-stream', stem: 'file', ext: '' },
];

const PAIRED = 'We’re paired. I’m Momo, the voice of your Mind Palace. Tell me anything: a thought, a link, a photo, a video, a file or a voice note. I’ll keep it or talk it over, whichever fits, and I’ll always say what I kept. Add “start a tree on this” and I’ll grow a tree. “List my trees” names them and “hand off <a tree>” sends its handoff: one file to share with any agent. /handoff sends the latest again.';
const UNPAIRED = 'Okay, we’re unpaired. I won’t hear anything here until you pair me again on the web page.';
/** The one line a chat that is not the owner's gets. */
const STRANGER = 'Hi, I’m Momo, the voice of a Mind Palace. I only talk with the person this palace belongs to. If that’s you, pair me on the Mind Palace web page: Settings, then Pair under Telegram.';
/** Replies one unpaired chat gets in ten minutes, so the bot cannot be made to send without end. */
export const STRANGER_REPLIES = 6;
const FOR_AGENT = 'For your agent: this file is a Mind Palace handoff. It holds the goal, the outline, what to do next and the open questions, with each picture described in words. Read it and continue the work.';

class BotError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * The owner's bot token when this service is the one to read it. One program at a time may read a bot, and the user's own service
 * on their Mac reads it, so the offline stand-in never does, and the demo only when MIND_PALACE_DEMO_TELEGRAM is on: the demo on
 * Fly, while the Mac's service is started without the token.
 */
export function ownBot(env: Record<string, string | undefined>, run: { fake: boolean; demo: boolean }): string | undefined {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || run.fake) return undefined;
  return !run.demo || env.MIND_PALACE_DEMO_TELEGRAM === 'on' ? token : undefined;
}

/** The account a service's kept file is paired to, or null when it holds none or cannot be read. */
export function pairingIn(file: string): Paired | null {
  return new Kept(file, Saved).value.paired;
}

/**
 * A pairing as one secret value, for the demo's MIND_PALACE_TELEGRAM_OWNER: base64url of its JSON, so nothing in it needs quoting.
 * A value that does not decode to a pairing gives null, and the demo then hears no one.
 */
export const ownerSecret = {
  encode: (paired: Paired): string => Buffer.from(JSON.stringify(paired)).toString('base64url'),
  decode: (value: string | undefined): Paired | null => {
    try {
      return value?.trim() ? Paired.parse(JSON.parse(Buffer.from(value.trim(), 'base64url').toString('utf8'))) : null;
    } catch {
      return null;
    }
  },
};

/** A small record kept in one file, written whole each time it changes. A file that does not read starts afresh. */
export class Kept<T extends object> {
  value: T;

  constructor(
    private readonly file: string,
    schema: z.ZodType<T>,
  ) {
    let saved: unknown = {};
    try {
      if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      saved = {};
    }
    const read = schema.safeParse(saved);
    this.value = read.success ? read.data : schema.parse({});
  }

  patch(patch: Partial<T>): void {
    this.value = { ...this.value, ...patch };
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.value, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
  }
}

/**
 * One Telegram bot: its messages read by long polling, so the machine needs no public address, and its replies, files and handoffs
 * sent. Who is heard is its owner's to decide; every message comes to `heard`.
 */
export class Bot implements Wire {
  me: z.infer<typeof Me> | null = null;
  private readonly api: string;
  private readonly stop = new AbortController();
  private readonly working = new Set<Promise<void>>();
  private loop: Promise<void> | null = null;

  constructor(
    private readonly opts: BotOptions,
    /** The read position, kept by the owner beside its pairings. */
    private readonly position: { value: Position; patch(patch: Partial<Position>): void },
    private readonly heard: (message: Message) => Promise<void>,
    /** The token is for another bot than the kept position's: the owner forgets its pairings. */
    private readonly replaced: () => void,
  ) {
    this.api = (opts.api ?? BOT_API).replace(/\/+$/, '');
  }

  start(): void {
    this.loop ??= this.poll();
  }

  async close(): Promise<void> {
    this.stop.abort();
    await this.loop;
    await Promise.allSettled([...this.working]);
  }

  log(line: string): void {
    this.opts.log(`[telegram] ${this.hide(line)}`);
  }

  // ---- reading

  private async poll(): Promise<void> {
    let failures = 0;
    let conflicted = false;
    while (!this.stop.signal.aborted) {
      try {
        if (!this.me) await this.meet();
        const updates = await this.call<unknown[]>('getUpdates', { offset: this.position.value.offset, timeout: this.opts.pollSeconds ?? 30, allowed_updates: ['message'] });
        failures = 0;
        conflicted = false;
        const ids = updates.flatMap((u) => (typeof (u as { update_id?: unknown }).update_id === 'number' ? [(u as { update_id: number }).update_id] : []));
        // Saved before anything is acted on, so a restart never takes a message twice.
        if (ids.length > 0) this.position.patch({ offset: Math.max(...ids) + 1 });
        for (const raw of updates) {
          const update = Update.safeParse(raw);
          if (update.success && update.data.message) this.track(this.heard(update.data.message));
        }
      } catch (err) {
        if (this.stop.signal.aborted) return;
        if (err instanceof BotError && err.status === 409) {
          if (!conflicted) this.log(`another program is reading this bot's messages, or a webhook is set (${err.message}). Only one may. Trying again every ${Math.round((this.opts.conflictMs ?? 30_000) / 1000)} s.`);
          conflicted = true;
          await this.pause(this.opts.conflictMs ?? 30_000);
          continue;
        }
        const hint = err instanceof BotError && (err.status === 401 || err.status === 404) && this.opts.tokenFrom ? ` Check ${this.opts.tokenFrom}.` : '';
        if (failures === 0) this.log(`${this.hide(err)}.${hint} Trying again.`);
        await this.pause(Math.min(MAX_RETRY_MS, (this.opts.retryMs ?? 1000) * 2 ** failures++));
      }
    }
  }

  private async meet(): Promise<void> {
    const me = Me.parse(await this.call('getMe'));
    const kept = this.position.value.bot;
    if (kept !== null && kept !== me.id) {
      this.replaced();
      this.position.patch({ bot: me.id, offset: 0 });
    } else if (kept === null) this.position.patch({ bot: me.id });
    this.me = me;
    this.log(`reading messages for @${me.username}`);
  }

  /** A file's bytes, or null when it is larger than a bot may fetch. */
  async fetch(file: Attachment): Promise<Uint8Array | null> {
    if ((file.size ?? 0) > MAX_BOT_FILE) return null;
    let path: string | undefined;
    try {
      path = (await this.call<{ file_path?: string }>('getFile', { file_id: file.id })).file_path;
    } catch (err) {
      if (err instanceof BotError && err.status === 400 && /too big/i.test(err.message)) return null;
      throw err;
    }
    if (!path) throw new Error('Telegram gave no path for the file');
    const res = await this.request(`file/bot${this.opts.token}/${path}`, {});
    if (!res.ok) throw new BotError(res.status, `Telegram's file answered ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ---- sending

  async send(chat: number, handoff: Delivery): Promise<void> {
    await this.call('sendMessage', { chat_id: chat, text: `Handoff ready: ${handoff.title}\n${FOR_AGENT}` });
    const form = new FormData();
    form.append('chat_id', String(chat));
    form.append('document', new Blob([handoff.markdown], { type: 'text/markdown' }), handoff.file);
    await this.call('sendDocument', form);
  }

  /** A reply that never throws. A reply that fails is logged. */
  async say(chat: number, text: string): Promise<void> {
    await this.post(chat, text);
  }

  /** A plain message, true once Telegram took it, within `ms` when given. One that fails, or takes longer, is logged. */
  async post(chat: number, text: string, ms?: number): Promise<boolean> {
    try {
      await this.call('sendMessage', { chat_id: chat, text, link_preview_options: { is_disabled: true } }, ms);
      return true;
    } catch (err) {
      this.log(`a message could not be sent: ${this.hide(err)}`);
      return false;
    }
  }

  // ---- the Bot API

  private async call<T>(method: string, body?: Record<string, unknown> | FormData, ms?: number): Promise<T> {
    const init: RequestInit =
      body === undefined ? {} : body instanceof FormData ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await this.request(`bot${this.opts.token}/${method}`, init, ms);
    const reply = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !reply?.ok) throw new BotError(res.status, this.hide(`Telegram ${method} answered ${res.status}${reply?.description ? `: ${reply.description}` : ''}`));
    return reply.result as T;
  }

  /** The one place a request to Telegram is made. Every address holds the bot token, so no error leaves here with it. */
  private async request(path: string, init: RequestInit, ms?: number): Promise<Response> {
    try {
      return await fetch(`${this.api}/${path}`, { ...init, signal: ms ? AbortSignal.any([this.stop.signal, AbortSignal.timeout(ms)]) : this.stop.signal });
    } catch (err) {
      throw new BotError(0, this.hide(`Telegram could not be reached: ${reason(err)}`));
    }
  }

  hide(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err);
    return [this.opts.token, encodeURIComponent(this.opts.token)].reduce((out, secret) => out.split(secret).join('<bot token>'), text);
  }

  // ---- plumbing

  private track(work: Promise<void>): void {
    const done = work.catch((err) => this.log(this.hide(err))).finally(() => this.working.delete(done));
    this.working.add(done);
  }

  private pause(ms: number): Promise<void> {
    return new Promise((done) => {
      const timer = setTimeout(done, ms);
      this.stop.signal.addEventListener('abort', () => (clearTimeout(timer), done()), { once: true });
    });
  }
}

/**
 * Mind Palace as its owner's Telegram contact, on their Mac. Only the account paired from the web page is heard; anyone else gets
 * one fixed line that says so.
 */
export class Telegram implements Channel {
  private readonly now: () => number;
  private readonly kept: Kept<z.infer<typeof Saved>>;
  private readonly bot: Bot;
  private readonly talk: Talk;
  private code: { value: string; expires: number } | null = null;
  private readonly strangers = new Map<number, number[]>();

  constructor(private readonly opts: TelegramOptions) {
    this.now = opts.now ?? Date.now;
    this.kept = new Kept(opts.file, Saved);
    if (opts.owner && !this.kept.value.paired) this.kept.patch({ paired: opts.owner });
    this.bot = new Bot({ tokenFrom: 'TELEGRAM_BOT_TOKEN in ~/.muse-garden.env', ...opts }, this.kept, (message) => this.receive(message), () => {
      opts.log('[telegram] the bot token is for another bot now, so the old pairing is gone. Pair again on the web page.');
      this.kept.patch({ paired: null });
    });
    this.talk = new Talk(this.bot, OWNER_LINES, this.now);
  }

  start(): this {
    this.bot.start();
    return this;
  }

  status(): ContactStatus {
    return { ready: this.bot.me !== null, paired: this.kept.value.paired?.name ?? null };
  }

  pair(): Invite | null {
    const me = this.bot.me;
    if (!me) return null;
    this.code = { value: randomBytes(9).toString('base64url'), expires: this.now() + CODE_MS };
    return { link: `https://t.me/${me.username}?start=${this.code.value}`, bot: me.username };
  }

  unpair(): void {
    const paired = this.kept.value.paired;
    if (paired) this.talk.forget(paired.chatId);
    this.kept.patch({ paired: null });
  }

  async deliver(handoff: Delivery): Promise<void> {
    const paired = this.kept.value.paired;
    if (!paired) return;
    try {
      await this.bot.send(paired.chatId, handoff);
    } catch (err) {
      this.bot.log(`the handoff could not be sent: ${this.bot.hide(err)}`);
    }
  }

  async tell(text: string): Promise<boolean> {
    const paired = this.kept.value.paired;
    if (!paired) {
      this.bot.log('a message of the service was not sent: no account is paired');
      return false;
    }
    return this.bot.post(paired.chatId, text);
  }

  close(): Promise<void> {
    return this.bot.close();
  }

  private async receive(message: Message): Promise<void> {
    const arrival = read(message);
    if (arrival.kind === 'start' && this.redeem(arrival.code, message)) return this.bot.say(message.chat.id, PAIRED);
    const paired = this.kept.value.paired;
    if (!paired || message.from?.id !== paired.userId || message.chat.id !== paired.chatId) {
      // A stranger costs no model call: one fixed line, in a private chat only, a few times in ten minutes.
      if (message.chat.type === 'private' && allowed(this.strangers, message.chat.id, STRANGER_REPLIES, this.now())) await this.bot.say(message.chat.id, STRANGER);
      return;
    }
    if (arrival.kind === 'unpair') {
      this.unpair();
      return this.bot.say(message.chat.id, UNPAIRED);
    }
    await this.talk.take(message.chat.id, this.opts.desk, arrival);
  }

  private redeem(code: string, message: Message): boolean {
    const live = this.code;
    if (!live || !code || this.now() > live.expires || !equal(code, live.value)) return false;
    if (message.chat.type !== 'private' || !message.from) return false;
    this.code = null;
    this.kept.patch({ paired: { userId: message.from.id, chatId: message.chat.id, name: nameOf(message.from) } });
    return true;
  }
}

const WINDOW_MS = 10 * 60 * 1000;
/** Chats counted at once. Past this, counts that have run out are cleared; if none have, a new chat is not counted and gets no reply. */
const MAX_COUNTED = 2000;

/**
 * Counts one more for the chat now, and says whether it is still within `most` in the last ten minutes. A chat's count is never
 * dropped while it holds: with too many chats counted, a chat not yet counted is refused instead.
 */
export function allowed(counts: Map<number, number[]>, chat: number, most: number, now: number): boolean {
  const recent = (counts.get(chat) ?? []).filter((at) => at > now - WINDOW_MS);
  if (recent.length >= most) return false;
  if (!counts.has(chat) && counts.size >= MAX_COUNTED) {
    for (const [other, times] of counts) if (times.every((at) => at <= now - WINDOW_MS)) counts.delete(other);
    if (counts.size >= MAX_COUNTED) return false;
  }
  counts.set(chat, [...recent, now]);
  return true;
}

/** What a Telegram account is called: its names, or its username. */
export function nameOf(from: NonNullable<Message['from']>): string {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Telegram';
}

/** What one Telegram message is. */
export function read(m: Message): Arrival {
  if (m.text !== undefined) {
    const text = m.text.trim();
    const start = /^\/(?:start|help)(?:@\w+)?(?:\s+(\S+))?$/i.exec(text);
    if (start) return { kind: 'start', code: start[1] ?? '' };
    if (/^\/unpair(?:@\w+)?$/i.test(text)) return { kind: 'unpair' };
    return text ? { kind: 'text', text } : { kind: 'other' };
  }
  if (m.voice) return { kind: 'voice', file: { ...attach(m.voice, m.voice.mime_type ?? 'audio/ogg', `voice-${m.message_id}.ogg`), seconds: m.voice.duration } };
  const caption = m.caption ?? '';
  if (m.photo && m.photo.length > 0) {
    const largest = m.photo.reduce((a, b) => ((b.width ?? 0) * (b.height ?? 0) >= (a.width ?? 0) * (a.height ?? 0) ? b : a));
    return { kind: 'file', file: attach(largest, 'image/jpeg', `photo-${m.message_id}.jpg`), caption };
  }
  for (const kind of SINGLE) {
    const ref = m[kind.field];
    if (ref) return { kind: 'file', file: attach(ref, ref.mime_type ?? kind.mime, ref.file_name ?? `${kind.stem}-${m.message_id}${kind.ext}`), caption };
  }
  return { kind: 'other' };
}

function attach(ref: FileRef, mime: string, name: string): Attachment {
  return { id: ref.file_id, size: ref.file_size, mime, name };
}

function reason(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  return [err instanceof Error ? err.message : String(err), cause?.code ?? cause?.message].filter(Boolean).join(', ');
}

export function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
