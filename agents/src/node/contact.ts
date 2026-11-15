import type { Item } from '../core/domain.ts';
import type { Filed } from '../core/pipeline.ts';
import type { RawDump } from '../core/roles/types.ts';
import type { Mindstorm } from '../core/state.ts';

/** A handoff as a contact sends it: one Markdown file that travels alone. */
export interface Delivery {
  /** What it holds, such as a tree's name. */
  title: string;
  /** The file's name, `<name>.md`. */
  file: string;
  markdown: string;
}

/** What a contact asks of the service. */
export interface Desk {
  /** What the paired person sent, read as a drop on the web page is. Resolves once Intake has filed it, with the words that say where it went. */
  dump(dumps: RawDump[]): Promise<string>;
  /** Keeps a file that arrived, as an upload does, and returns its asset id. */
  keep(bytes: Uint8Array, mime: string, name: string): Promise<string>;
  /** Speech to text. Absent when the service has no way to hear. */
  transcribe?: (audio: Uint8Array, mime: string) => Promise<string>;
  /** The latest handoff the service made, to send again. */
  latest(): Delivery | null;
}

export interface ContactStatus {
  /** False until the contact has reached its service, so a pairing link can be made. */
  ready: boolean;
  /** The paired person's name. */
  paired: string | null;
}

/**
 * A way the person who owns the mindstorm reaches it from any phone or computer, such as a chat app.
 * What arrives goes to a `Desk`; every handoff the service makes is delivered back.
 */
export interface Channel {
  status(): ContactStatus;
  /** A link that pairs whoever opens it, once, for ten minutes. Null while the contact is not ready. */
  pair(): string | null;
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
