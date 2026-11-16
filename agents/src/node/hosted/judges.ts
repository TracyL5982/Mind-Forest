import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Channel, Delivery, Desk } from '../contact.ts';
import { JUDGE_LINES, Talk } from '../talk.ts';
import { Bot, CODE_MS, Kept, nameOf, Position, read, type BotOptions, type Message } from '../telegram.ts';

export interface JudgeBotOptions extends BotOptions {
  now?: () => number;
}

interface Options extends JudgeBotOptions {
  /** Where the pairings and the read position are kept: on the volume, so a restart keeps them. */
  file: string;
  /** Opens a device's space, so its desk is here to take a message. False when the device has no space or it cannot open. */
  open: (device: string) => Promise<boolean>;
}

const Chat = z.object({ device: z.string(), userId: z.number(), name: z.string() });
type Chat = z.infer<typeof Chat>;
/** Each paired chat, by its Telegram chat id, beside the read position of the bot they belong to. */
const Saved = Position.extend({ chats: z.record(z.string(), Chat).default({}) });

const PAIRED = 'Paired with your headset. Anything you send here goes into your mind palace: a thought, a link, a photo, a file or a voice note. “List my trees” names your trees and “hand off <a tree>” sends its handoff: one file to share with any agent. /unpair ends this.';
const UNPAIRED = 'Unpaired. To connect again, say “Momo, connect my Telegram” in your headset.';
/** The one line a chat that is not paired gets. */
const STRANGER = 'This is the Mind Palace bot for headsets. In your headset, say “Momo, connect my Telegram”, then send me the 6-digit code Momo gives you.';
const WRONG_CODE = 'That code did not work. A code works once, for 10 minutes. In your headset, say “Momo, connect my Telegram” for a new one, and send it here.';
const NO_SPACE = 'Your headset’s mind palace could not be opened just now. Try again in a moment.';

const WINDOW_MS = 10 * 60 * 1000;
/** Wrong codes one chat may send in ten minutes before its codes are no longer read, so the million codes cannot be tried through. */
const WRONG_CODES = 5;
/** Replies one unpaired chat gets in ten minutes, so the bot cannot be made to send without end. */
const STRANGER_REPLIES = 6;
/** Chats counted at once. Past this the oldest count is dropped. */
const MAX_COUNTED = 2000;

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
    const code = arrival.kind === 'start' ? arrival.code : arrival.kind === 'text' ? codeIn(arrival.text) : '';
    if (code && this.redeem(code, chat, message.from)) return this.bot.say(chat, PAIRED);

    const paired = this.kept.value.chats[String(chat)];
    if (!paired || paired.userId !== message.from.id) {
      if (allowed(this.strangers, chat, STRANGER_REPLIES, this.now())) await this.bot.say(chat, code ? WRONG_CODE : STRANGER);
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

  /** Pairs the chat with the device a live code was given to. Each device has one chat and each chat one device, the newest. */
  private redeem(code: string, chat: number, from: NonNullable<Message['from']>): boolean {
    const now = this.now();
    if ((this.wrong.get(chat) ?? []).filter((at) => at > now - WINDOW_MS).length >= WRONG_CODES) return false;
    const live = this.codes.get(code.replace(/\D/g, ''));
    if (!live || now > live.expires) {
      allowed(this.wrong, chat, WRONG_CODES, now);
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

/** Counts one more for the chat now, and says whether it is still within `most` in the last ten minutes. */
function allowed(counts: Map<number, number[]>, chat: number, most: number, now: number): boolean {
  const recent = (counts.get(chat) ?? []).filter((at) => at > now - WINDOW_MS);
  counts.delete(chat);
  if (recent.length >= most) {
    counts.set(chat, recent);
    return false;
  }
  counts.set(chat, [...recent, now]);
  if (counts.size > MAX_COUNTED) counts.delete(counts.keys().next().value!);
  return true;
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
