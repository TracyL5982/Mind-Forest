import type { Id, Item } from '../core/domain.ts';
import type { Filed } from '../core/pipeline.ts';
import type { RawDump } from '../core/roles/types.ts';
import type { Mindstorm } from '../core/state.ts';
import type { Ask, TreeLine } from './tree-asks.ts';

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
  /** What the paired person sent, read as a drop on the web page is. Resolves once Intake has filed it, with the words that say where it went. */
  dump(dumps: RawDump[]): Promise<string>;
  /** Why a file of this size cannot be kept, before it is fetched, or null when it can. */
  fits(bytes: number): string | null;
  /** Keeps a file that arrived, as an upload does, and returns its asset id. */
  keep(bytes: Uint8Array, mime: string, name: string): Promise<string>;
  /** Speech to text, of a recording `seconds` long when that is known. Absent when the service has no way to hear. */
  transcribe?: (audio: Uint8Array, mime: string, seconds?: number) => Promise<string>;
  /** The latest handoff the service made, to send again. */
  latest(): Delivery | null;
  /** The trees, the newest first. */
  trees(): TreeLine[];
  /** What a message that plain rules did not read asks of the trees, or null when it is a drop. */
  ask(text: string): Promise<Ask | null>;
  /** The trees a few words mean, by name first, then by what is in them, best first. */
  match(words: string): Promise<TreeLine[]>;
  /** Makes one tree's handoff. The file reaches the paired person as every handoff does, through `Channel.deliver`. */
  handoff(treeId: Id): Promise<void>;
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
}

/**
 * A way the person who owns the mindstorm reaches it from any phone or computer, such as a chat app.
 * What arrives goes to a `Desk`; every handoff the service makes is delivered back.
 */
export interface Channel {
  status(): ContactStatus;
  /** A way to pair that works once, for ten minutes. Null while the contact is not ready. */
  pair(): Invite | null;
  unpair(): void;
  /** Sends a handoff to the paired person. Never rejects; does nothing when no one is paired. */
  deliver(handoff: Delivery): Promise<void>;
  close(): Promise<void>;
}

const MAX_LISTED = 10;
const NOTHING_ADDED = 'Nothing was added. To grow a tree, send “make a tree about …”, or add “start a tree on this” to what you send.';

/** Where a drop went, in the words a contact replies with: a new tree, under a card, or the knowledge base. */
export function whereItWent(mind: Mindstorm, filed: Filed): string {
  if (filed.items.length === 0) return NOTHING_ADDED;
  if (filed.items.length === 1) return `Added ${quoted(filed.items[0]!)}. It ${place(mind, filed, filed.items[0]!)}.`;
  const lines = filed.items.slice(0, MAX_LISTED).map((item) => `${quoted(item)} ${place(mind, filed, item)}.`);
  const more = filed.items.length > MAX_LISTED ? [`And ${filed.items.length - MAX_LISTED} more.`] : [];
  return [`Added ${filed.items.length} things.`, ...lines, ...more].join('\n');
}

function place(mind: Mindstorm, filed: Filed, item: Item): string {
  const node = filed.nodeIds.map((id) => mind.nodes.get(id)).find((n) => n?.itemId === item.id);
  if (!node) return 'is in your knowledge base';
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
