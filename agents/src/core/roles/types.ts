import type { Command, Id, Item, Node, Origin } from '../domain.ts';
import type { Assets, ModelClient, Tools } from '../ports.ts';
import type { Mindstorm } from '../state.ts';
import { defaultView } from '../views.ts';

export interface Settings {
  /** 'provisional': agent picks stay dashed until the user keeps them. 'immediate': they arrive kept. */
  picksMode: 'provisional' | 'immediate';
  /** New picks the Scout asks for per run, beside what the user already has that it brings into the round. */
  picksPerRun: number;
  /** A tie to something the user already has is strong, and brings it into a round or files a dump under a card, at this rating or above, 0…1. */
  strongTie: number;
  /** Whether a tree the user asks for gets its first round of picks straight away. */
  scoutOnDump: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  picksMode: 'provisional',
  picksPerRun: 5,
  strongTie: 0.8,
  scoutOnDump: true,
};

/** What the connected clients can play: player pages from other sites (embeds), and which file types. */
export interface Playback {
  /** False while any connected client cannot show an embedded player, such as the headset. */
  embeds: boolean;
  /** File extensions every client that said so can play. Empty when no client has said. */
  files: string[];
}

/** What every role is handed. Roles read `mind` and return commands. Only the pipeline applies them. */
export interface RoleContext {
  mind: Mindstorm;
  model: ModelClient;
  tools: Tools;
  assets: Assets;
  settings: Settings;
  /** Asked at the moment of choosing, because clients come and go. */
  playback: () => Playback;
  newId: () => Id;
  now: () => string;
  /** A line for the run log. Shown to the user as the agent's work state. */
  note: (role: string, message: string) => void;
}

/** One thing dropped into the mindstorm, before Intake has looked at it. */
export type RawDump =
  | { kind: 'text'; text: string; name?: string }
  | { kind: 'link'; url: string }
  | { kind: 'asset'; asset: string; mime: string; name?: string };

export interface Scene {
  /** The node the user is looking at or has open. */
  focus?: Id;
  selection: Id[];
  treeId?: Id;
}

export interface Turn {
  who: 'user' | 'agent';
  text: string;
}

export interface Scope {
  treeIds: Id[];
  nodeIds: Id[];
}

/** What the Conductor decided an utterance means. */
export type Intent =
  /** A question or need about the anchor: bring content that answers it. */
  | { kind: 'ask'; anchor: Id; need: string }
  /** More of what is already around the anchor. */
  | { kind: 'more'; anchor: Id; need?: string }
  | { kind: 'navigate'; nodeId?: Id; treeId?: Id }
  | { kind: 'organize'; request: string; scope: Scope }
  | { kind: 'handoff'; scope: Scope; note: string }
  /** The user is dictating something to keep. */
  | { kind: 'capture'; text: string }
  /** A new tree: about `subject`, or grown from items the user already has, such as what they just dropped or the card they have open. */
  | { kind: 'tree'; subject: string; itemIds: Id[] }
  | { kind: 'keep'; nodeIds: Id[] }
  | { kind: 'undo' }
  /** Nothing to do but reply. */
  | { kind: 'reply' };

export interface Conducted {
  intent: Intent;
  /** One short spoken line back to the user. */
  say: string;
}

export interface Handoff {
  /** File name without extension. */
  name: string;
  markdown: string;
  json: unknown;
  /** Asset ids to copy beside the files. */
  assets: string[];
}

/** The user asked for a tree to be made of what they dropped. `title` is what they called it, or empty. */
export interface TreeRequest {
  title: string;
}

export interface Roles {
  /** `dropped` is what the user dropped last, so "start a tree on this" can mean it. */
  conductor(ctx: RoleContext, input: { utterance: string; scene: Scene; history: Turn[]; dropped?: Id[] }): Promise<Conducted>;
  /** Turns dumps into items. Does not add them. */
  intake(ctx: RoleContext, dumps: RawDump[]): Promise<Item[]>;
  /**
   * Places what was dropped. Every item joins the knowledge base whether placed or not; the pipeline adds those that are new.
   * Asked for a tree, the items become one new tree. Otherwise an item with a strong fit under a card of a tree is hung there as a pick,
   * and the rest are placed nowhere. Returns createTree and addNode commands.
   */
  filer(ctx: RoleContext, items: Item[], request?: TreeRequest): Promise<Command[]>;
  /**
   * Brings content to the anchor: what the user already has that is strongly tied to it, and new content.
   * New picks join the anchor's round and none is taken away here. Near the cap, the picks already there come back rated against the
   * question as `setWhy` importances, and the pipeline lets the least related give way.
   * Returns addItem + addNode for each new pick, addNode alone for what the user already has, and setWhy for re-rated picks.
   * Picks that are ready early may be handed to `deliver` so the user sees them sooner; the rest are returned.
   */
  scout(
    ctx: RoleContext,
    input: {
      anchor: Id;
      need?: string;
      count?: number;
      /** The recent conversation, so a need is read in context. */
      history?: Turn[];
      deliver?: (commands: Command[]) => void;
    },
  ): Promise<Command[]>;
  organizer(ctx: RoleContext, input: { request: string; scope: Scope; focus?: Id }): Promise<{ commands: Command[]; summary: string }>;
  /** Chooses a component for each node and composites for groups of siblings. Returns setView and setGroup. */
  renderer(ctx: RoleContext, input: { nodeIds: Id[] }): Promise<Command[]>;
  packager(ctx: RoleContext, input: { scope: Scope; note?: string }): Promise<Handoff>;
}

export const AGENT = (role: string, tool?: string): Origin => ({ by: 'agent', role, ...(tool ? { tool } : {}) });

export function makeItem(
  ctx: RoleContext,
  fields: Pick<Item, 'kind' | 'title' | 'origin'> & Partial<Pick<Item, 'text' | 'summary' | 'tags' | 'data'>> & {
    source: Omit<Item['source'], 'capturedAt'>;
  },
): Item {
  return {
    id: ctx.newId(),
    kind: fields.kind,
    title: fields.title,
    text: fields.text ?? '',
    summary: fields.summary ?? '',
    tags: fields.tags ?? [],
    data: fields.data ?? {},
    source: { ...fields.source, capturedAt: ctx.now() },
    origin: fields.origin,
    archived: false,
    revision: 0,
  };
}

/** A node for an item, with its default view. `order` continues after the parent's existing children plus `offset`. */
export function makeNode(
  ctx: RoleContext,
  item: Item,
  fields: Pick<Node, 'treeId' | 'parent' | 'status' | 'why' | 'origin'> & { importance?: number; offset?: number },
): Node {
  return {
    id: ctx.newId(),
    treeId: fields.treeId,
    itemId: item.id,
    parent: fields.parent,
    status: fields.status,
    why: fields.why,
    importance: fields.importance ?? 0.5,
    origin: fields.origin,
    view: defaultView(item, (id) => ctx.assets.url(id)),
    order: (fields.parent && ctx.mind.nodes.has(fields.parent) ? ctx.mind.nextOrder(fields.parent) : 0) + (fields.offset ?? 0),
  };
}

/**
 * An id as a model wrote it back. Shown "item library:film:53", a model often returns the whole of that, so the word before the id
 * and any quotes or brackets around it are dropped.
 */
export function idFrom(raw: string): string {
  return raw.trim().replace(/^(?:item|node|tree)\s+/i, '').replace(/^["'“\[(]+|["'”\])]+$/g, '');
}

/** The status an agent's pick starts with under the current setting. */
export function pickStatus(ctx: RoleContext): Node['status'] {
  return ctx.settings.picksMode === 'provisional' ? 'pick' : 'kept';
}
