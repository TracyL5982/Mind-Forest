import type { Id, Item } from '../core/domain.ts';
import type { Filed } from '../core/pipeline.ts';
import type { RawDump } from '../core/roles/types.ts';
import type { Mindstorm } from '../core/state.ts';
import type { Heard, KeptThing, Reading } from './momo-chat.ts';
import type { TreeLine } from './tree-asks.ts';

/** A handoff as a contact sends it: one Markdown file that travels alone. */
export interface Delivery {
  /** What it holds, such as a tree's name. */
  title: string;
  /** The file's name, `<name>.md`. */
  file: string;
  markdown: string;
}

/** The service declines what was asked, for a reason the person is told in these words: no room left, or the day's limit reached. */
export class Declined extends Error {}

/** A file a message carries, before it is fetched. */
export interface Attachment {
  id: string;
  size?: number;
  mime: string;
  name: string;
  /** How long a recording plays, when the contact says. */
  seconds?: number;
}

/** What one message from a contact is. */
export type Arrival =
  | { kind: 'start'; code: string }
  | { kind: 'unpair' }
  | { kind: 'text'; text: string }
  | { kind: 'file'; file: Attachment; caption: string }
  | { kind: 'voice'; file: Attachment }
  | { kind: 'other' };

/** What a contact asks of the service. Each of these rejects with `Declined` when the service has a reason to tell the person. */
export interface Desk {
  /**
   * What the paired person sent, read as a drop on the web page is. Resolves once Intake has filed it, with what was kept and where.
   * `into` is the tree they asked for it to go in, with their words that named it.
   */
  dump(dumps: RawDump[], into?: { tree: Id; words: string }): Promise<Kept>;
  /** Momo's reading of a message: whether to answer, keep it, do both or ask, and what Momo says. */
  read(heard: Heard): Promise<Reading>;
  /** Why a file of this size cannot be kept, before it is fetched, or null when it can. */
  fits(bytes: number): string | null;
  /** Keeps a file that arrived, as an upload does, and returns its asset id. */
  keep(bytes: Uint8Array, mime: string, name: string): Promise<string>;
  /** Why a recording of this size cannot be written out, or null when it can. */
  hearable(bytes: number): string | null;
  /** Speech to text, of a recording its sender says is `seconds` long. Absent when the service has no way to hear. */
  transcribe?: (audio: Uint8Array, mime: string, seconds?: number) => Promise<string>;
  /** The latest handoff the service made, to send again. */
  latest(): Delivery | null;
  /** The trees, the newest first. */
  trees(): TreeLine[];
  /** The trees a few words mean, by name first, then by what is in them, best first. */
  match(words: string): Promise<TreeLine[]>;
  /** Makes one tree's handoff. The file reaches the paired person as every handoff does, through `Channel.deliver`. */
  handoff(treeId: Id): Promise<void>;
  /** The contact was paired with someone, or is no longer: the service tells its headsets (`telegram`), so a panel showing a code can close. */
  paired?(paired: boolean): void;
}

/** What a drop came to. */
export interface Kept {
  /** What was kept and where it went, in Momo's words. */
  line: string;
  /** Each thing kept, as Intake read it. */
  things: KeptThing[];
}

export interface ContactStatus {
  /** False until the contact has reached its service, so a pairing link can be made. */
  ready: boolean;
  /** The paired person's name. */
  paired: string | null;
}

/** How a person pairs: a link to open, the contact's name there, and a short code to send it instead when there is one. */
export interface Invite {
  link: string;
  bot: string;
  code?: string;
  /** Seconds the code still works for. */
  expiresIn?: number;
}

/**
 * A way the person who owns the mindstorm reaches it from any phone or computer, such as a chat app.
 * What arrives goes to a `Desk`; every handoff the service makes is delivered back.
 */
export interface Channel {
  status(): ContactStatus;
  /**
   * A way to pair that works once, for ten minutes. Null while the contact is not ready. `reuse`: the code already given, if it still
   * has a while to run, so a code someone was just told (Momo reads hers out) is not replaced under them.
   */
  pair(opts?: { reuse?: boolean }): Invite | null;
  unpair(): void;
  /** Sends a handoff to the paired person. Never rejects; does nothing when no one is paired. */
  deliver(handoff: Delivery): Promise<void>;
  /** Sends a message of the service's own to the paired person. Never rejects: false when no one is paired, or it was not taken. */
  tell?(text: string): Promise<boolean>;
  close(): Promise<void>;
}

const MAX_LISTED = 10;
const NOTHING_ADDED = 'I didn’t keep anything from that. To grow a tree, send “make a tree about …”, or add “start a tree on this” to what you send.';

/** What a drop came to, with where it went in the words Momo replies with: a new tree, under a card, or the knowledge base. */
export function whereItWent(mind: Mindstorm, filed: Filed): Kept {
  const things = filed.items.map((item) => ({ title: item.title, says: item.summary || item.text }));
  if (filed.items.length === 0) return { line: NOTHING_ADDED, things };
  if (filed.items.length === 1) return { line: `I’ve kept ${quoted(filed.items[0]!)}. It ${place(mind, filed, filed.items[0]!)}.`, things };
  const lines = filed.items.slice(0, MAX_LISTED).map((item) => `${quoted(item)} ${place(mind, filed, item)}.`);
  const more = filed.items.length > MAX_LISTED ? [`And ${filed.items.length - MAX_LISTED} more.`] : [];
  return { line: [`I’ve kept ${filed.items.length} things.`, ...lines, ...more].join('\n'), things };
}

function place(mind: Mindstorm, filed: Filed, item: Item): string {
  const node = filed.nodeIds.map((id) => mind.nodes.get(id)).find((n) => n?.itemId === item.id);
  if (!node) return 'is in your knowledge base, in no tree yet';
  const tree = clip(mind.trees.get(node.treeId)?.title ?? 'a tree');
  if (node.parent === null) return `started the tree “${tree}”`;
  return `went under “${clip(mind.itemOf(node.parent).title)}” in “${tree}”`;
}

function quoted(item: Item): string {
  return `“${clip(item.title) || 'Untitled'}”`;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}
