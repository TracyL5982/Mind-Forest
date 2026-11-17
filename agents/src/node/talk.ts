import { asUrl } from '../core/roles/intake/plain.ts';
import type { RawDump } from '../core/roles/types.ts';
import { treeRequest } from '../core/tree-request.ts';
import { Declined, type Arrival, type Attachment, type Delivery, type Desk, type Kept } from './contact.ts';
import type { Reading, Said } from './momo-chat.ts';
import { MAX_OFFERED, plainAsk, type Ask, type TreeLine } from './tree-asks.ts';

/** How a talk reaches the chat app. */
export interface Wire {
  /** A reply that never rejects. */
  say(chat: number, text: string): Promise<void>;
  send(chat: number, handoff: Delivery): Promise<void>;
  /** A file's bytes, or null when it is larger than the app lets a bot fetch. */
  fetch(file: Attachment): Promise<Uint8Array | null>;
  log(line: string): void;
}

/** The lines that differ with who is talking: the owner on their Mac, with its web page, or a judge with a headset alone. */
export interface Lines {
  hello: string;
  tooBig: string;
  failed: string;
  noHandoff: string;
  notHeard: string;
}

export const OWNER_LINES: Lines = {
  hello: 'I’m here, and we’re paired. Tell me anything and I’ll keep it or talk it over, whichever fits. “List my trees” names your trees, “hand off <a tree>” sends its handoff, and /handoff sends the latest again.',
  tooBig: 'That one’s over 20 MB, more than Telegram lets me take. Drop it on the Mind Palace web page instead.',
  failed: 'Something went wrong on my side, so I didn’t keep that. Try again, or drop it on the Mind Palace web page.',
  noHandoff: 'There’s no handoff yet. Tell me “hand off” and a tree’s name, or ask me in the headset.',
  notHeard: 'I can’t write voice notes out here without OPENAI_API_KEY in ~/.muse-garden.env, so I kept the recording as it is.',
};

export const JUDGE_LINES: Lines = {
  hello: 'I’m here, and we’re paired with your headset. Tell me anything and I’ll keep it or talk it over, whichever fits. “List my trees” names your trees, “hand off <a tree>” sends its handoff, and /unpair ends this.',
  tooBig: 'That one’s over 20 MB, more than Telegram lets me take.',
  failed: 'Something went wrong on my side, so I didn’t keep that. Try again in a moment.',
  noHandoff: 'There’s no handoff yet. Tell me “hand off” and a tree’s name, or ask me in the headset.',
  notHeard: 'I can’t write voice notes out on this service, so I kept the recording as it is.',
};

const OTHER = 'I can take text, links, photos, videos, files and voice notes. That one I can’t read.';
const HEARD_FAILED = 'I couldn’t make out the words, so I kept the recording as it is.';
const NO_TREES = 'You’ve no trees yet. Send me “make a tree about …” and I’ll grow one.';
/** The most trees one list names. */
const MAX_LISTED = 20;
/** How long a list stays open to an answer by number. */
const OFFER_MS = 10 * 60 * 1000;
/** How long what was said is remembered, so a follow-up is read with it. */
const SAID_MS = 30 * 60 * 1000;
/** How many things said are remembered: three turns each way. */
const SAID_KEPT = 6;
/** Chats remembered at once. Past this many the oldest is dropped. */
const MAX_CHATS = 500;

/** What is remembered of one chat, in memory only: a restart forgets it, and the next message is read on its own. */
interface Memory {
  /** The trees last listed, so "2" picks the second. */
  offer?: { trees: TreeLine[]; expires: number };
  said: Said[];
  /** The message Momo asked about keeping. */
  waiting?: string;
  at: number;
}

/**
 * What a paired person's messages do, whichever chat app they came through. Momo reads each one and answers it, keeps it, does
 * both or asks (`momo-chat.ts`); plain words about the trees list them, find one or send its handoff with no model call; and a
 * link, photo or file is always kept, with Momo answering what is asked about it.
 */
export class Talk {
  private readonly chats = new Map<number, Memory>();

  constructor(
    private readonly wire: Wire,
    private readonly lines: Lines,
    private readonly now: () => number = Date.now,
  ) {}

  /** Answers one message. Never rejects: what fails is logged, and the person is told. */
  async take(chat: number, desk: Desk, arrival: Arrival): Promise<void> {
    try {
      await this.answer(chat, desk, arrival);
    } catch (err) {
      if (err instanceof Declined) return this.wire.say(chat, err.message);
      this.wire.log(`a message could not be added: ${err instanceof Error ? err.message : String(err)}`);
      await this.wire.say(chat, this.lines.failed);
    }
  }

  /** The chat is no longer paired, so nothing of it is remembered. */
  forget(chat: number): void {
    this.chats.delete(chat);
  }

  private memory(chat: number): Memory {
    const now = this.now();
    let memory = this.chats.get(chat);
    if (!memory || now - memory.at > SAID_MS) memory = { said: [], at: now };
    memory.at = now;
    this.chats.delete(chat);
    this.chats.set(chat, memory);
    if (this.chats.size > MAX_CHATS) this.chats.delete(this.chats.keys().next().value!);
    return memory;
  }

  private async answer(chat: number, desk: Desk, arrival: Arrival): Promise<void> {
    const say = (text: string) => this.wire.say(chat, text);
    switch (arrival.kind) {
      case 'start':
      case 'unpair':
        return say(this.lines.hello);
      case 'other':
        return say(OTHER);
      case 'text':
        return this.words(chat, desk, arrival.text);
      case 'file': {
        const bytes = await this.fetch(desk, arrival.file);
        if (!bytes) return say(this.lines.tooBig);
        const asset = await desk.keep(bytes, arrival.file.mime, arrival.file.name);
        const kept = await desk.dump([{ kind: 'asset', asset, mime: arrival.file.mime, name: arrival.file.name }, ...dumpsOf(arrival.caption)]);
        return this.about(chat, desk, arrival.caption, kept);
      }
      case 'voice': {
        // A voice note is written out, not kept, so the room for files does not decide it: only its own size does.
        const why = desk.transcribe && arrival.file.size !== undefined ? desk.hearable(arrival.file.size) : null;
        if (why) return say(why);
        const bytes = await this.wire.fetch(arrival.file);
        if (!bytes) return say(this.lines.tooBig);
        const heard = await this.hear(desk, bytes, arrival.file);
        if (heard.text) return this.words(chat, desk, heard.text);
        const asset = await desk.keep(bytes, arrival.file.mime, arrival.file.name);
        const filed = await desk.dump([{ kind: 'asset', asset, mime: arrival.file.mime, name: arrival.file.name }]);
        return say(`${filed.line}\n${heard.note}`);
      }
    }
  }

  /**
   * Words the person typed or said. Plain rules read the cases that need no judgment: a pick from the list they were offered,
   * something asked of the trees, a request for a new tree, a link. Momo reads everything else.
   */
  private async words(chat: number, desk: Desk, text: string): Promise<void> {
    const memory = this.memory(chat);
    const picked = this.picked(memory, text);
    if (picked) return this.pack(chat, desk, picked);
    const asked = plainAsk(text);
    if (asked) return this.trees(chat, desk, asked);
    if (treeRequest(text)) return this.wire.say(chat, (await desk.dump(dumpsOf(text))).line);
    if (/https?:\/\//i.test(text)) {
      const kept = await desk.dump(dumpsOf(text));
      return this.about(chat, desk, asUrl(text.trim()) ? '' : text, kept);
    }

    let reading: Reading;
    try {
      reading = await desk.read({ text, said: memory.said, waiting: memory.waiting });
    } catch (err) {
      if (err instanceof Declined) throw err;
      // With no reading, the message is kept, as every message was before Momo read them: nothing the person sent is lost.
      this.wire.log(`Momo could not read a message, so it was kept: ${err instanceof Error ? err.message : String(err)}`);
      return this.wire.say(chat, (await desk.dump(dumpsOf(text))).line);
    }
    const waited = reading.earlier ? memory.waiting : undefined;
    memory.waiting = undefined;
    const reply = reading.reply.trim();
    switch (reading.does) {
      case 'ask':
        memory.waiting = text;
        return this.told(chat, memory, text, reply || 'Want me to keep that, or were you just telling me?');
      case 'answer':
        return this.told(chat, memory, text, reply || 'Okay.');
      case 'save':
        return this.told(chat, memory, text, reply, await desk.dump(dumpsOf(waited ?? text)));
      case 'both':
        return this.told(chat, memory, text, reply, await desk.dump([{ kind: 'text', text: `${(waited ?? text).trim()}\n\n${reply}` }]));
      case 'tree': {
        const subject = reading.words.trim();
        if (!subject) return this.told(chat, memory, text, reply || 'What should the tree be about?');
        return this.told(chat, memory, text, reply, await desk.dump([{ kind: 'text', text: `Make a tree about ${subject}` }]));
      }
      case 'list':
      case 'latest':
        return this.trees(chat, desk, { kind: reading.does });
      case 'find':
      case 'handoff': {
        const words = reading.words.trim();
        return words ? this.trees(chat, desk, { kind: reading.does, words }) : this.trees(chat, desk, { kind: 'list' });
      }
    }
  }

  /** Momo's reply, then what was kept and where, and both remembered for the next message. */
  private async told(chat: number, memory: Memory, text: string, reply: string, kept?: Kept): Promise<void> {
    const whole = [reply, kept?.line].filter(Boolean).join('\n\n');
    memory.said = [...memory.said, { who: 'user' as const, text }, { who: 'momo' as const, text: whole }].slice(-SAID_KEPT);
    await this.wire.say(chat, whole);
  }

  /** What came with a message is kept already. Momo answers the words sent with it, when there are any; the reply always says what was kept. */
  private async about(chat: number, desk: Desk, words: string, kept: Kept): Promise<void> {
    const asked = words.trim();
    if (!asked || treeRequest(asked) || kept.things.length === 0) return this.wire.say(chat, kept.line);
    const memory = this.memory(chat);
    let reply = '';
    try {
      reply = (await desk.read({ text: asked, said: memory.said, kept: kept.things })).reply.trim();
    } catch (err) {
      this.wire.log(`Momo could not read the words sent with something kept: ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.told(chat, memory, asked, reply, kept);
  }

  /** Something asked of the trees the person has. */
  private async trees(chat: number, desk: Desk, ask: Ask): Promise<void> {
    const say = (line: string) => this.wire.say(chat, line);
    this.memory(chat).offer = undefined;
    switch (ask.kind) {
      case 'latest': {
        const latest = desk.latest();
        return latest ? this.wire.send(chat, latest) : say(this.lines.noHandoff);
      }
      case 'list': {
        const trees = desk.trees();
        if (trees.length === 0) return say(NO_TREES);
        return say(`Here are your trees, newest first:\n${this.offer(chat, trees, MAX_LISTED)}\nSend me a number and I’ll hand that tree off.`);
      }
      case 'handoff': {
        const found = await desk.match(ask.words);
        if (found.length === 1) return this.pack(chat, desk, found[0]!);
        if (found.length > 1) return say(`Which one do you mean?\n${this.offer(chat, found, MAX_OFFERED)}\nSend me its number.`);
        return say(this.none(chat, desk, ask.words));
      }
      case 'find': {
        const found = await desk.match(ask.words);
        if (found.length === 0) return say(this.none(chat, desk, ask.words));
        return say(`I found ${found.length === 1 ? 'this' : 'these'}:\n${this.offer(chat, found, MAX_OFFERED)}\nSend me ${found.length === 1 ? '“yes” or 1' : 'a number'} and I’ll hand ${found.length === 1 ? 'it' : 'that one'} off.`);
      }
    }
  }

  private async pack(chat: number, desk: Desk, tree: TreeLine): Promise<void> {
    this.memory(chat).offer = undefined;
    await this.wire.say(chat, `Packing “${tree.title}”…`);
    try {
      await desk.handoff(tree.id);
    } catch (err) {
      if (err instanceof Declined) throw err;
      this.wire.log(`a handoff could not be made: ${err instanceof Error ? err.message : String(err)}`);
      await this.wire.say(chat, `I couldn’t make the handoff of “${tree.title}”. Try me again in a moment.`);
    }
  }

  /** The trees as numbered lines, kept so the next message can pick one by its number. */
  private offer(chat: number, trees: TreeLine[], most: number): string {
    const shown = trees.slice(0, most);
    this.memory(chat).offer = { trees: shown, expires: this.now() + OFFER_MS };
    const more = trees.length > shown.length ? [`And ${trees.length - shown.length} more.`] : [];
    return [...shown.map((tree, i) => `${i + 1}. ${tree.title}: ${tree.line}`), ...more].join('\n');
  }

  /** The tree a message picks from the list this chat was offered: its number, its name, or "yes" to a list of one. */
  private picked(memory: Memory, text: string): TreeLine | undefined {
    const offer = memory.offer;
    if (!offer || this.now() > offer.expires) return undefined;
    const clean = text.trim().replace(/[.!]+$/, '').toLowerCase();
    const number = /^#?(\d{1,2})$/.exec(clean)?.[1];
    if (number) return offer.trees[Number(number) - 1];
    if (offer.trees.length === 1 && /^(?:yes|yes please|yep|yeah|ok|okay|sure|please|hand it off|send it)$/.test(clean)) return offer.trees[0];
    return offer.trees.find((tree) => tree.title.toLowerCase() === clean);
  }

  private none(chat: number, desk: Desk, words: string): string {
    const trees = desk.trees();
    if (trees.length === 0) return NO_TREES;
    return `I can’t find a tree for “${words}”. Here are your trees, newest first:\n${this.offer(chat, trees, MAX_LISTED)}\nSend me a number and I’ll hand that tree off.`;
  }

  private async fetch(desk: Desk, file: Attachment): Promise<Uint8Array | null> {
    const why = file.size === undefined ? null : desk.fits(file.size);
    if (why) throw new Declined(why);
    return this.wire.fetch(file);
  }

  /** A voice note's words, or why it is kept as a recording instead. */
  private async hear(desk: Desk, audio: Uint8Array, file: Attachment): Promise<{ text: string; note: string }> {
    if (!desk.transcribe) return { text: '', note: this.lines.notHeard };
    try {
      return { text: (await desk.transcribe(audio, file.mime, file.seconds)).trim(), note: HEARD_FAILED };
    } catch (err) {
      if (err instanceof Declined) throw err;
      this.wire.log(`a voice note could not be written out: ${err instanceof Error ? err.message : String(err)}`);
      return { text: '', note: HEARD_FAILED };
    }
  }
}

/** What a text becomes when dropped, as the web page sends it: a link when it is one web address and nothing else, otherwise a text. */
function dumpsOf(text: string): RawDump[] {
  const clean = text.trim();
  if (!clean) return [];
  const url = asUrl(clean);
  return url ? [{ kind: 'link', url }] : [{ kind: 'text', text: clean }];
}
