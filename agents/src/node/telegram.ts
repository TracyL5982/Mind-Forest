import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { asUrl } from '../core/roles/intake/plain.ts';
import type { RawDump } from '../core/roles/types.ts';
import type { Channel, ContactStatus, Delivery, Desk } from './contact.ts';

export const BOT_API = 'https://api.telegram.org';
/** The largest file a bot may fetch from Telegram. */
export const MAX_BOT_FILE = 20 * 1024 * 1024;
const CODE_MS = 10 * 60 * 1000;
const MAX_RETRY_MS = 60_000;

export interface TelegramOptions {
  token: string;
  desk: Desk;
  /** Where the pairing and the read position are kept. */
  file: string;
  log: (line: string) => void;
  /** The Bot API's address. Tests point it at a stand-in. */
  api?: string;
  now?: () => number;
  /** How long one getUpdates waits for a message, in seconds. */
  pollSeconds?: number;
  /** The wait after Telegram says another program is reading this bot's messages. */
  conflictMs?: number;
  /** The first wait after any other failure. It doubles up to a minute. */
  retryMs?: number;
}

const Paired = z.object({ userId: z.number(), chatId: z.number(), name: z.string() });
const Saved = z.object({
  /** The bot the read position and the pairing belong to. A new token for another bot starts both afresh. */
  bot: z.number().nullable().default(null),
  offset: z.number().int().default(0),
  paired: Paired.nullable().default(null),
});
type Saved = z.infer<typeof Saved>;

const Me = z.object({ id: z.number(), username: z.string() });
const FileRef = z.object({
  file_id: z.string(),
  file_size: z.number().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
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
type Message = z.infer<typeof Message>;
const Update = z.object({ update_id: z.number(), message: Message.optional() });

/** A file a message carries, before it is fetched. */
interface Attachment {
  id: string;
  size?: number;
  mime: string;
  name: string;
}

/** What one message asks for. */
type Arrival =
  | { kind: 'start'; code: string }
  | { kind: 'handoff' }
  | { kind: 'text'; text: string }
  | { kind: 'file'; file: Attachment; caption: string }
  | { kind: 'voice'; file: Attachment }
  | { kind: 'other' };

/** The single-file kinds of message, the type each is taken to be when Telegram gives none, and the name it gets when it has none. */
const SINGLE: { field: 'video' | 'video_note' | 'audio' | 'document'; mime: string; stem: string; ext: string }[] = [
  { field: 'video', mime: 'video/mp4', stem: 'video', ext: '.mp4' },
  { field: 'video_note', mime: 'video/mp4', stem: 'video', ext: '.mp4' },
  { field: 'audio', mime: 'audio/mpeg', stem: 'audio', ext: '.mp3' },
  { field: 'document', mime: 'application/octet-stream', stem: 'file', ext: '' },
];

const HANDOFF = /^(?:\/handoff(?:@\w+)?|(?:please\s+)?(?:re)?send\s+me\s+the\s+(?:latest\s+|last\s+)?handoff(?:\s+again)?(?:,?\s+please)?[.!]*)$/i;

const PAIRED = 'Paired. Anything you send here goes into your mindstorm: a thought, a link, a photo, a video, a file or a voice note. Add “start a tree on this” to grow a tree. Each handoff comes back here as one file to share with any agent, and /handoff sends the latest again.';
const HELLO = 'You are paired. Send anything to add it to your mindstorm, or /handoff for the latest handoff.';
const OTHER = 'Mind Palace takes text, links, photos, videos, files and voice notes.';
const TOO_BIG = 'That file is over 20 MB, more than a Telegram bot can take. Drop it on the Mind Palace web page instead.';
const FAILED = 'That could not be added. Try again, or drop it on the Mind Palace web page.';
const NO_HANDOFF = 'No handoff yet. Make one on the web page, or clap on the headset.';
const NOT_HEARD = 'Voice notes are written out only with OPENAI_API_KEY in ~/.muse-garden.env, so the recording was added as it is.';
const HEARD_FAILED = 'The words could not be written out, so the recording was added as it is.';
const FOR_AGENT = 'For your agent: this file is a Mind Palace handoff. It holds the goal, the outline, what to do next and the open questions, with each picture described in words. Read it and continue the work.';

class BotError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Mind Palace as a Telegram contact. It reads the bot's messages by long polling, so the Mac needs no public address.
 * Only the account paired from the web page is heard; anyone else gets no reply at all.
 */
export class Telegram implements Channel {
  private readonly api: string;
  private readonly now: () => number;
  private readonly stop = new AbortController();
  private readonly working = new Set<Promise<void>>();
  private saved: Saved;
  private me: z.infer<typeof Me> | null = null;
  private code: { value: string; expires: number } | null = null;
  private loop: Promise<void> | null = null;

  constructor(private readonly opts: TelegramOptions) {
    this.api = (opts.api ?? BOT_API).replace(/\/+$/, '');
    this.now = opts.now ?? Date.now;
    this.saved = load(opts.file);
  }

  start(): this {
    this.loop ??= this.poll();
    return this;
  }

  status(): ContactStatus {
    return { ready: this.me !== null, paired: this.saved.paired?.name ?? null };
  }

  pair(): string | null {
    if (!this.me) return null;
    this.code = { value: randomBytes(9).toString('base64url'), expires: this.now() + CODE_MS };
    return `https://t.me/${this.me.username}?start=${this.code.value}`;
  }

  unpair(): void {
    this.save({ paired: null });
  }

  async deliver(handoff: Delivery): Promise<void> {
    const paired = this.saved.paired;
    if (!paired) return;
    try {
      await this.send(paired.chatId, handoff);
    } catch (err) {
      this.opts.log(`[telegram] the handoff could not be sent: ${this.hide(err)}`);
    }
  }

  async close(): Promise<void> {
    this.stop.abort();
    await this.loop;
    await Promise.allSettled([...this.working]);
  }

  // ---- reading

  private async poll(): Promise<void> {
    let failures = 0;
    let conflicted = false;
    while (!this.stop.signal.aborted) {
      try {
        if (!this.me) await this.meet();
        const updates = await this.call<unknown[]>('getUpdates', { offset: this.saved.offset, timeout: this.opts.pollSeconds ?? 30, allowed_updates: ['message'] });
        failures = 0;
        conflicted = false;
        const ids = updates.flatMap((u) => (typeof (u as { update_id?: unknown }).update_id === 'number' ? [(u as { update_id: number }).update_id] : []));
        // Saved before anything is acted on, so a restart never takes a message twice.
        if (ids.length > 0) this.save({ offset: Math.max(...ids) + 1 });
        for (const raw of updates) {
          const update = Update.safeParse(raw);
          if (update.success && update.data.message) this.track(this.receive(update.data.message));
        }
      } catch (err) {
        if (this.stop.signal.aborted) return;
        if (err instanceof BotError && err.status === 409) {
          if (!conflicted) this.opts.log(`[telegram] another program is reading this bot's messages (Telegram answered 409). Only one may. Trying again every ${Math.round((this.opts.conflictMs ?? 30_000) / 1000)} s.`);
          conflicted = true;
          await this.pause(this.opts.conflictMs ?? 30_000);
          continue;
        }
        const hint = err instanceof BotError && (err.status === 401 || err.status === 404) ? ' Check TELEGRAM_BOT_TOKEN in ~/.muse-garden.env.' : '';
        if (failures === 0) this.opts.log(`[telegram] ${this.hide(err)}.${hint} Trying again.`);
        await this.pause(Math.min(MAX_RETRY_MS, (this.opts.retryMs ?? 1000) * 2 ** failures++));
      }
    }
  }

  private async meet(): Promise<void> {
    const me = Me.parse(await this.call('getMe'));
    if (this.saved.bot !== null && this.saved.bot !== me.id) {
      this.opts.log('[telegram] the bot token is for another bot now, so the old pairing is gone. Pair again on the web page.');
      this.save({ bot: me.id, offset: 0, paired: null });
    } else if (this.saved.bot === null) this.save({ bot: me.id });
    this.me = me;
    this.opts.log(`[telegram] reading messages for @${me.username}`);
  }

  private async receive(message: Message): Promise<void> {
    const arrival = read(message);
    if (arrival.kind === 'start' && this.redeem(arrival.code, message)) return this.say(message.chat.id, PAIRED);
    const paired = this.saved.paired;
    if (!paired || message.from?.id !== paired.userId || message.chat.id !== paired.chatId) return;
    try {
      await this.take(message.chat.id, arrival);
    } catch (err) {
      this.opts.log(`[telegram] a message could not be added: ${this.hide(err)}`);
      await this.say(message.chat.id, FAILED);
    }
  }

  private redeem(code: string, message: Message): boolean {
    const live = this.code;
    if (!live || !code || this.now() > live.expires || !equal(code, live.value)) return false;
    if (message.chat.type !== 'private' || !message.from) return false;
    this.code = null;
    const { id, first_name, last_name, username } = message.from;
    this.save({ paired: { userId: id, chatId: message.chat.id, name: [first_name, last_name].filter(Boolean).join(' ') || username || 'Telegram' } });
    return true;
  }

  private async take(chat: number, arrival: Arrival): Promise<void> {
    switch (arrival.kind) {
      case 'start':
        return this.say(chat, HELLO);
      case 'other':
        return this.say(chat, OTHER);
      case 'handoff':
        return this.resend(chat);
      case 'text':
        return this.say(chat, await this.opts.desk.dump(dumpsOf(arrival.text)));
      case 'file': {
        const bytes = await this.download(arrival.file);
        if (!bytes) return this.say(chat, TOO_BIG);
        const asset = await this.opts.desk.keep(bytes, arrival.file.mime, arrival.file.name);
        return this.say(chat, await this.opts.desk.dump([{ kind: 'asset', asset, mime: arrival.file.mime, name: arrival.file.name }, ...dumpsOf(arrival.caption)]));
      }
      case 'voice': {
        const bytes = await this.download(arrival.file);
        if (!bytes) return this.say(chat, TOO_BIG);
        const words = await this.hear(bytes, arrival.file.mime);
        if (words.text && HANDOFF.test(words.text)) return this.resend(chat);
        const dumps: RawDump[] = words.text
          ? dumpsOf(words.text)
          : [{ kind: 'asset', asset: await this.opts.desk.keep(bytes, arrival.file.mime, arrival.file.name), mime: arrival.file.mime, name: arrival.file.name }];
        const filed = await this.opts.desk.dump(dumps);
        return this.say(chat, words.note ? `${filed}\n${words.note}` : filed);
      }
    }
  }

  private async hear(audio: Uint8Array, mime: string): Promise<{ text: string; note?: string }> {
    if (!this.opts.desk.transcribe) return { text: '', note: NOT_HEARD };
    try {
      const text = (await this.opts.desk.transcribe(audio, mime)).trim();
      return text ? { text } : { text, note: HEARD_FAILED };
    } catch (err) {
      this.opts.log(`[telegram] a voice note could not be written out: ${this.hide(err)}`);
      return { text: '', note: HEARD_FAILED };
    }
  }

  /** A file's bytes, or null when it is larger than a bot may fetch. */
  private async download(file: Attachment): Promise<Uint8Array | null> {
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

  private async resend(chat: number): Promise<void> {
    const latest = this.opts.desk.latest();
    if (!latest) return this.say(chat, NO_HANDOFF);
    await this.send(chat, latest);
  }

  private async send(chat: number, handoff: Delivery): Promise<void> {
    await this.call('sendMessage', { chat_id: chat, text: `Handoff ready: ${handoff.title}\n${FOR_AGENT}` });
    const form = new FormData();
    form.append('chat_id', String(chat));
    form.append('document', new Blob([handoff.markdown], { type: 'text/markdown' }), handoff.file);
    await this.call('sendDocument', form);
  }

  /** A reply that never throws. A reply that fails is logged. */
  private async say(chat: number, text: string): Promise<void> {
    try {
      await this.call('sendMessage', { chat_id: chat, text, link_preview_options: { is_disabled: true } });
    } catch (err) {
      this.opts.log(`[telegram] a reply could not be sent: ${this.hide(err)}`);
    }
  }

  // ---- the Bot API

  private async call<T>(method: string, body?: Record<string, unknown> | FormData): Promise<T> {
    const init: RequestInit =
      body === undefined ? {} : body instanceof FormData ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const res = await this.request(`bot${this.opts.token}/${method}`, init);
    const reply = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !reply?.ok) throw new BotError(res.status, this.hide(`Telegram ${method} answered ${res.status}${reply?.description ? `: ${reply.description}` : ''}`));
    return reply.result as T;
  }

  /** The one place a request to Telegram is made. Every address holds the bot token, so no error leaves here with it. */
  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.api}/${path}`, { ...init, signal: this.stop.signal });
    } catch (err) {
      throw new BotError(0, this.hide(`Telegram could not be reached: ${reason(err)}`));
    }
  }

  private hide(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err);
    return [this.opts.token, encodeURIComponent(this.opts.token)].reduce((out, secret) => out.split(secret).join('<bot token>'), text);
  }

  // ---- plumbing

  private save(patch: Partial<Saved>): void {
    this.saved = { ...this.saved, ...patch };
    const temporary = `${this.opts.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    renameSync(temporary, this.opts.file);
  }

  private track(work: Promise<void>): void {
    const done = work.catch((err) => this.opts.log(`[telegram] ${this.hide(err)}`)).finally(() => this.working.delete(done));
    this.working.add(done);
  }

  private pause(ms: number): Promise<void> {
    return new Promise((done) => {
      const timer = setTimeout(done, ms);
      this.stop.signal.addEventListener('abort', () => (clearTimeout(timer), done()), { once: true });
    });
  }
}

function read(m: Message): Arrival {
  if (m.text !== undefined) {
    const text = m.text.trim();
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/i.exec(text);
    if (start) return { kind: 'start', code: start[1] ?? '' };
    if (HANDOFF.test(text)) return { kind: 'handoff' };
    return text ? { kind: 'text', text } : { kind: 'other' };
  }
  if (m.voice) return { kind: 'voice', file: attach(m.voice, m.voice.mime_type ?? 'audio/ogg', `voice-${m.message_id}.ogg`) };
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

/** What a text becomes when dropped, as the web page sends it: a link when it is one web address and nothing else, otherwise a text. */
function dumpsOf(text: string): RawDump[] {
  const clean = text.trim();
  if (!clean) return [];
  const url = asUrl(clean);
  return url ? [{ kind: 'link', url }] : [{ kind: 'text', text: clean }];
}

function load(file: string): Saved {
  if (!existsSync(file)) return Saved.parse({});
  try {
    return Saved.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return Saved.parse({});
  }
}

function reason(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  return [err instanceof Error ? err.message : String(err), cause?.code ?? cause?.message].filter(Boolean).join(', ');
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
