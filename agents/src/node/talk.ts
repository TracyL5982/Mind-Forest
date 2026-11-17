import { asUrl } from '../core/roles/intake/plain.ts';
import type { RawDump } from '../core/roles/types.ts';
import { Declined, type Arrival, type Attachment, type Delivery, type Desk } from './contact.ts';
import { MAX_OFFERED, mayAsk, plainAsk, type TreeLine } from './tree-asks.ts';

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
  hello: 'You are paired. Send anything to add it to your mindstorm. “List my trees” names them, “hand off <a tree>” sends its handoff, and /handoff sends the latest again.',
  tooBig: 'That file is over 20 MB, more than a Telegram bot can take. Drop it on the Mind Palace web page instead.',
  failed: 'That could not be added. Try again, or drop it on the Mind Palace web page.',
  noHandoff: 'No handoff yet. Say “hand off” and a tree’s name here, or ask on the headset.',
  notHeard: 'Voice notes are written out only with OPENAI_API_KEY in ~/.muse-garden.env, so the recording was added as it is.',
};

export const JUDGE_LINES: Lines = {
  hello: 'You are paired with your headset. Send anything to add it to your mind palace. “List my trees” names them, “hand off <a tree>” sends its handoff, and /unpair ends this.',
  tooBig: 'That file is over 20 MB, more than a Telegram bot can take.',
  failed: 'That could not be added. Try again in a moment.',
  noHandoff: 'No handoff yet. Say “hand off” and a tree’s name here, or ask Momo in the headset.',
  notHeard: 'Voice notes cannot be written out on this service, so the recording was added as it is.',
};

const OTHER = 'Mind Palace takes text, links, photos, videos, files and voice notes.';
const HEARD_FAILED = 'The words could not be written out, so the recording was added as it is.';
const NO_TREES = 'You have no trees yet. Send “make a tree about …” to grow one.';
/** The most trees one list names. */
const MAX_LISTED = 20;
/** How long a list stays open to an answer by number. */
const OFFER_MS = 10 * 60 * 1000;
/** Chats with an open list. Past this many the oldest is dropped, so strangers' chats cannot grow it without end. */
const MAX_OFFERS = 500;

/**
 * What a paired person's messages do, whichever chat app they came through: a drop goes into the mindstorm, and plain words about
 * the trees list them, find one or send its handoff. A list that offers trees stays open for ten minutes, so "2" picks the second.
 */
export class Talk {
  private readonly offers = new Map<number, { trees: TreeLine[]; expires: number }>();

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

  /** The chat is no longer paired, so nothing it was offered is kept. */
  forget(chat: number): void {
    this.offers.delete(chat);
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
        return say(await desk.dump([{ kind: 'asset', asset, mime: arrival.file.mime, name: arrival.file.name }, ...dumpsOf(arrival.caption)]));
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
        return say(`${filed}\n${heard.note}`);
      }
    }
  }

  /** Words the person typed or said: an answer to the list they were offered, something asked of the trees, or a drop. */
  private async words(chat: number, desk: Desk, text: string): Promise<void> {
    const say = (line: string) => this.wire.say(chat, line);
    const picked = this.picked(chat, text);
    if (picked) return this.pack(chat, desk, picked);
    const ask = plainAsk(text) ?? (mayAsk(text) ? await desk.ask(text).catch(() => null) : null);
    if (!ask) return say(await desk.dump(dumpsOf(text)));
    this.offers.delete(chat);
    switch (ask.kind) {
      case 'latest': {
        const latest = desk.latest();
        return latest ? this.wire.send(chat, latest) : say(this.lines.noHandoff);
      }
      case 'list': {
        const trees = desk.trees();
        if (trees.length === 0) return say(NO_TREES);
        return say(`Your trees, newest first:\n${this.offer(chat, trees, MAX_LISTED)}\nReply with a number for a tree’s handoff.`);
      }
      case 'handoff': {
        const found = await desk.match(ask.words);
        if (found.length === 1) return this.pack(chat, desk, found[0]!);
        if (found.length > 1) return say(`Which one?\n${this.offer(chat, found, MAX_OFFERED)}\nReply with a number.`);
        return say(this.none(chat, desk, ask.words));
      }
      case 'find': {
        const found = await desk.match(ask.words);
        if (found.length === 0) return say(this.none(chat, desk, ask.words));
        return say(`Found:\n${this.offer(chat, found, MAX_OFFERED)}\nReply with ${found.length === 1 ? '“yes” or 1' : 'a number'} for ${found.length === 1 ? 'its' : 'a tree’s'} handoff.`);
      }
    }
  }

  private async pack(chat: number, desk: Desk, tree: TreeLine): Promise<void> {
    this.offers.delete(chat);
    await this.wire.say(chat, `Packing “${tree.title}”…`);
    try {
      await desk.handoff(tree.id);
    } catch (err) {
      if (err instanceof Declined) throw err;
      this.wire.log(`a handoff could not be made: ${err instanceof Error ? err.message : String(err)}`);
      await this.wire.say(chat, `The handoff of “${tree.title}” could not be made. Try again in a moment.`);
    }
  }

  /** The trees as numbered lines, kept so the next message can pick one by its number. */
  private offer(chat: number, trees: TreeLine[], most: number): string {
    const shown = trees.slice(0, most);
    this.offers.delete(chat);
    this.offers.set(chat, { trees: shown, expires: this.now() + OFFER_MS });
    if (this.offers.size > MAX_OFFERS) this.offers.delete(this.offers.keys().next().value!);
    const more = trees.length > shown.length ? [`And ${trees.length - shown.length} more.`] : [];
    return [...shown.map((tree, i) => `${i + 1}. ${tree.title}: ${tree.line}`), ...more].join('\n');
  }

  /** The tree a message picks from the list this chat was offered: its number, its name, or "yes" to a list of one. */
  private picked(chat: number, text: string): TreeLine | undefined {
    const offer = this.offers.get(chat);
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
    return `No tree matches “${words}”. Your trees, newest first:\n${this.offer(chat, trees, MAX_LISTED)}\nReply with a number for a tree’s handoff.`;
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
