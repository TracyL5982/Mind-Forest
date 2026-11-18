import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Channel, Delivery, Desk } from '../contact.ts';
import { JUDGE_LINES, Talk } from '../talk.ts';
import { allowed, Bot, CODE_MS, Kept, nameOf, Position, read, STRANGER_REPLIES, type BotOptions, type Message } from '../telegram.ts';
import type { Shares } from './shares.ts';

export interface JudgeBotOptions extends BotOptions {
  now?: () => number;
}

interface Options extends JudgeBotOptions {
  /** Where the pairings and the read position are kept: on the volume, so a restart keeps them. */
  file: string;
  /** Opens a device's space, so its desk is here to take a message. False when the device has no space or it cannot open. */
  open: (device: string) => Promise<boolean>;
  /** The trees shared from the headsets, waiting under their codes. Absent, nothing is shared. */
  shares?: Shares;
  /** Gives a device's space the tree shared under a live code, to hold until the headset is next put on; or why it could not take it. */
  gift?: (device: string, code: string) => Promise<{ ok: true } | { ok: false; why: string }>;
}

/** What a shared tree's link is: `start=share-<code>`. */
const SHARE_START = 'share-';
/** The two messages a sharer's chat gets: what to do, then the one to forward, which reads right in the friend's chat (the lead's words). */
const OFFER_NOTE = 'Forward the next message to a friend who uses Mind Forest.';
const OFFER = (title: string, link: string) => `A friend shared a tree with you in Mind Forest: “${title}”. Tap to plant it in your forest: ${link}`;
/** How long each of them may take, so the headset hears how its Share went within seconds. */
const OFFER_MS = 4000;
const GIFT_WAITING = (title: string) => `“${title}” is waiting in your Mind Forest. Put on your headset to see it grow.`;
const GIFT_PAIR_FIRST = (title: string) =>
  `To get “${title}”, pair this chat with your headset first: in your headset, say “Momo, connect my Telegram”, and send me the code it gives you. Then open the link again.`;
const GIFT_NO_ROOM = (title: string, why: string) => `I couldn’t plant “${title}” just now: ${why} The link still works, so open it again later.`;
const GIFT_UNKNOWN = 'That link isn’t one I know. Ask your friend to share the tree again.';
const GIFT_USED = 'That tree was planted already: a shared tree’s link works once.';
const GIFT_EXPIRED = 'That link has expired: a shared tree’s link works for 7 days. Ask your friend to share it again.';
const GIFTS_PAUSED = 'I’ve paused links for a few minutes. Open it again shortly.';
const PLANTED = (title: string) => `“${title}” was planted in a friend’s forest.`;

const Chat = z.object({ device: z.string(), userId: z.number(), name: z.string() });
type Chat = z.infer<typeof Chat>;
/** Each paired chat, by its Telegram chat id, beside the read position of the bot they belong to. */
const Saved = Position.extend({ chats: z.record(z.string(), Chat).default({}) });

const PAIRED = 'We’re paired. I’m Momo, the voice of the Mind Palace in your headset. Tell me anything: a thought, a link, a photo, a file or a voice note. I’ll keep it or talk it over, whichever fits, and I’ll always say what I kept. “List my trees” names your trees and “hand off <a tree>” sends its handoff: one file to share with any agent. /unpair ends this.';
const UNPAIRED = 'Okay, we’re unpaired. To connect again, say “Momo, connect my Telegram” in your headset.';
/** The one line a chat that is not paired gets. */
const STRANGER = 'Hi, I’m Momo, the voice of Mind Palace. I don’t know this chat yet. In your headset, say “Momo, connect my Telegram”, then send me the 6-digit code I give you there.';
const WRONG_CODE = 'Hmm, that code didn’t work. A code works once, for 10 minutes. In your headset, say “Momo, connect my Telegram” and I’ll give you a new one to send here.';
const NO_SPACE = 'I couldn’t open your headset’s mind palace just now. Try me again in a moment.';

const WINDOW_MS = 10 * 60 * 1000;
/** Wrong codes one chat may send in ten minutes before its codes are no longer read, so the million codes cannot be tried through. */
const WRONG_CODES = 5;
/** Wrong codes from every chat together in ten minutes before no code is read for a while: many accounts cannot share out the guessing. */
const WRONG_CODES_IN_ALL = 50;
const PAUSE_MS = 5 * 60 * 1000;
const PAIRING_PAUSED = 'I’ve paused pairing for a few minutes. Send me your code again shortly.';

/**
 * Telegram for the judges' headsets, through one bot that only the hosted service reads. A headset asks for a short code, its
 * judge sends the code to the bot, and from then on that chat's messages go to that device's space and its handoffs come back.
 * A chat reaches the one device it paired with and nothing else.
 */
export class JudgeTelegram {
  private readonly now: () => number;
  private readonly kept: Kept<z.infer<typeof Saved>>;
  private readonly bot: Bot;
  private readonly talk: Talk;
  /** The desk of each device whose space is open. */
  private readonly desks = new Map<string, Desk>();
  private readonly codes = new Map<string, { device: string; expires: number }>();
  private readonly wrong = new Map<number, number[]>();
  private readonly strangers = new Map<number, number[]>();
  /** When each wrong code of the last ten minutes came, from any chat. */
  private wrongInAll: number[] = [];
  private pausedUntil = 0;

  constructor(private readonly opts: Options) {
    this.now = opts.now ?? Date.now;
    this.kept = new Kept(opts.file, Saved);
    this.bot = new Bot({ tokenFrom: 'MIND_PALACE_JUDGE_BOT_TOKEN', ...opts }, this.kept, (message) => this.receive(message), () => {
      opts.log('[telegram] the judges’ bot token is for another bot now, so every pairing is gone.');
      this.kept.patch({ chats: {} });
    });
    this.talk = new Talk(this.bot, JUDGE_LINES, this.now);
  }

  start(): this {
    this.bot.start();
    return this;
  }

  close(): Promise<void> {
    return this.bot.close();
  }

  status(): { bot: string | null; paired: number } {
    return { bot: this.bot.me?.username ?? null, paired: Object.keys(this.kept.value.chats).length };
  }

  /** The contact a device's space is opened with. Its desk takes the device's chat's messages for as long as the space is open. */
  channel(device: string): (desk: Desk) => Channel {
    return (desk) => {
      this.desks.set(device, desk);
      return {
        status: () => ({ ready: this.bot.me !== null, paired: this.chatOf(device)?.[1].name ?? null }),
        pair: () => {
          const me = this.bot.me;
          if (!me) return null;
          const code = this.codeFor(device);
          return { link: `https://t.me/${me.username}?start=${code}`, bot: me.username, code };
        },
        unpair: () => this.unpair(device),
        deliver: (handoff) => this.deliver(device, handoff),
        close: async () => {
          if (this.desks.get(device) === desk) this.desks.delete(device);
        },
      };
    };
  }

  /** Whether the device's headset has a chat paired with it. */
  paired(device: string): boolean {
    return this.chatOf(device) !== undefined;
  }

  /**
   * Posts a tree the device shared to its chat: a line on what to do, then the message to forward, with the link. False when there
   * is no chat, or the message to forward did not go.
   */
  async offer(device: string, title: string, code: string): Promise<boolean> {
    const chat = this.chatOf(device);
    const me = this.bot.me;
    if (!chat || !me) return false;
    await this.bot.post(chat[0], OFFER_NOTE, OFFER_MS);
    return this.bot.post(chat[0], OFFER(title, `https://t.me/${me.username}?start=${SHARE_START}${code}`), OFFER_MS);
  }

  /** A tree shared under `code` grew in a friend's forest: its sharer's chat is told, with no name, since there are no accounts. */
  async planted(code: string): Promise<void> {
    const entry = this.opts.shares?.entry(code);
    const chat = entry && this.chatOf(entry.device);
    if (entry && chat) await this.bot.say(chat[0], PLANTED(entry.title));
  }

  /** A device's space is deleted: its pairing and any code it was given go with it. */
  forget(device: string): void {
    this.unpair(device);
    for (const [code, live] of this.codes) if (live.device === device) this.codes.delete(code);
  }

  private async deliver(device: string, handoff: Delivery): Promise<void> {
    const chat = this.chatOf(device);
    if (!chat) return;
    try {
      await this.bot.send(chat[0], handoff);
    } catch (err) {
      this.bot.log(`the handoff could not be sent: ${this.bot.hide(err)}`);
    }
  }

  private async receive(message: Message): Promise<void> {
    if (message.chat.type !== 'private' || !message.from) return;
    const chat = message.chat.id;
    const arrival = read(message);
    if (arrival.kind === 'start' && arrival.code.startsWith(SHARE_START)) return this.gift(chat, message.from, arrival.code.slice(SHARE_START.length));
    const code = arrival.kind === 'start' ? arrival.code : arrival.kind === 'text' ? codeIn(arrival.text) : '';
    const paused = this.now() < this.pausedUntil;
    if (code && !paused && this.redeem(code, chat, message.from)) return this.bot.say(chat, PAIRED);

    const paired = this.kept.value.chats[String(chat)];
    if (!paired || paired.userId !== message.from.id) {
      if (allowed(this.strangers, chat, STRANGER_REPLIES, this.now())) await this.bot.say(chat, !code ? STRANGER : paused ? PAIRING_PAUSED : WRONG_CODE);
      return;
    }
    if (arrival.kind === 'unpair') {
      this.unpair(paired.device);
      return this.bot.say(chat, UNPAIRED);
    }
    const open = await this.opts.open(paired.device).catch(() => false);
    const desk = open ? this.desks.get(paired.device) : undefined;
    if (!desk) return this.bot.say(chat, NO_SPACE);
    await this.talk.take(chat, desk, arrival);
  }

  /**
   * A friend opened a shared tree's link. In a chat paired with a headset, the tree goes to that headset's space to grow there;
   * in any other, the friend is told to pair first, and the link keeps working. A link that is not live counts as a wrong code.
   */
  private async gift(chat: number, from: NonNullable<Message['from']>, code: string): Promise<void> {
    const { shares, gift } = this.opts;
    const now = this.now();
    if (now < this.pausedUntil || this.tooManyWrong(chat)) {
      if (allowed(this.strangers, chat, STRANGER_REPLIES, now)) await this.bot.say(chat, GIFTS_PAUSED);
      return;
    }
    const found = shares?.find(code) ?? { state: 'unknown' as const };
    if (found.state !== 'live') {
      this.wrongCode(chat);
      return this.bot.say(chat, found.state === 'used' ? GIFT_USED : found.state === 'expired' ? GIFT_EXPIRED : GIFT_UNKNOWN);
    }
    const paired = this.kept.value.chats[String(chat)];
    if (!paired || paired.userId !== from.id) {
      if (allowed(this.strangers, chat, STRANGER_REPLIES, now)) await this.bot.say(chat, GIFT_PAIR_FIRST(found.entry.title));
      return;
    }
    const taken = await (gift ?? (async () => ({ ok: false as const, why: 'sharing is off here.' })))(paired.device, code).catch((err: unknown) => ({
      ok: false as const,
      why: `${err instanceof Error ? err.message : String(err)}.`,
    }));
    if (!taken.ok) return this.bot.say(chat, GIFT_NO_ROOM(found.entry.title, taken.why));
    shares!.use(code, paired.device);
    this.opts.log(`[telegram] a shared tree went to ${paired.device.slice(0, 8)}`);
    await this.bot.say(chat, GIFT_WAITING(found.entry.title));
  }

  /** Whether the chat sent too many wrong codes in the last ten minutes for its codes to be read. */
  private tooManyWrong(chat: number): boolean {
    return (this.wrong.get(chat) ?? []).filter((at) => at > this.now() - WINDOW_MS).length >= WRONG_CODES;
  }

  /** A wrong code, counted for the chat and for every chat together: past fifty in ten minutes no code is read for a while. */
  private wrongCode(chat: number): void {
    const now = this.now();
    allowed(this.wrong, chat, WRONG_CODES, now);
    this.wrongInAll = [...this.wrongInAll.filter((at) => at > now - WINDOW_MS), now];
    if (this.wrongInAll.length >= WRONG_CODES_IN_ALL) {
      this.pausedUntil = now + PAUSE_MS;
      this.wrongInAll = [];
      this.opts.log(`[telegram] ${WRONG_CODES_IN_ALL} wrong pairing codes (shared trees' links among them) in ten minutes, so no code is read for ${PAUSE_MS / 60_000} minutes`);
    }
  }

  /** Pairs the chat with the device a live code was given to. Each device has one chat and each chat one device, the newest. */
  private redeem(code: string, chat: number, from: NonNullable<Message['from']>): boolean {
    const now = this.now();
    if (this.tooManyWrong(chat)) return false;
    const live = this.codes.get(code.replace(/\D/g, ''));
    if (!live || now > live.expires) {
      this.wrongCode(chat);
      return false;
    }
    this.codes.delete(code.replace(/\D/g, ''));
    this.unpair(live.device);
    this.talk.forget(chat);
    this.kept.patch({ chats: { ...this.kept.value.chats, [String(chat)]: { device: live.device, userId: from.id, name: nameOf(from) } } });
    this.opts.log(`[telegram] a chat paired with ${live.device.slice(0, 8)}`);
    return true;
  }

  private unpair(device: string): void {
    const chat = this.chatOf(device);
    if (!chat) return;
    this.talk.forget(chat[0]);
    const { [String(chat[0])]: _gone, ...rest } = this.kept.value.chats;
    this.kept.patch({ chats: rest });
  }

  private chatOf(device: string): [number, Chat] | undefined {
    const found = Object.entries(this.kept.value.chats).find(([, chat]) => chat.device === device);
    return found && [Number(found[0]), found[1]];
  }

  /** A new six-digit code for the device, in place of any it had. */
  private codeFor(device: string): string {
    const now = this.now();
    for (const [code, live] of this.codes) if (live.device === device || now > live.expires) this.codes.delete(code);
    let code: string;
    do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    while (this.codes.has(code));
    this.codes.set(code, { device, expires: now + CODE_MS });
    return code;
  }
}

/** The six digits of a message that is a code and nothing else, as "482913", "482 913" or "482-913". */
function codeIn(text: string): string {
  const code = /^(\d{3})[\s-]?(\d{3})$/.exec(text.trim());
  return code ? `${code[1]}${code[2]}` : '';
}

/**
 * The judges' bot token, when the hosted service may read it. It never reads the bot the owner's Mac reads: two readers take each
 * other's messages, so a judges' token that is the owner's own is refused.
 */
export function judgeBotToken(env: Record<string, string | undefined>, log: (line: string) => void): string | undefined {
  const token = env.MIND_PALACE_JUDGE_BOT_TOKEN?.trim();
  if (!token) return undefined;
  if (token === env.TELEGRAM_BOT_TOKEN?.trim()) {
    log('[telegram] MIND_PALACE_JUDGE_BOT_TOKEN is the same bot as TELEGRAM_BOT_TOKEN, which the Mac reads, so the judges’ Telegram stays off. Make a second bot with @BotFather.');
    return undefined;
  }
  return token;
}
