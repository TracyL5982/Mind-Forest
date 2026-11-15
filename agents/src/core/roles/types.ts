import type { Command, Id, Item, ItemKind, Node, Origin, Sound } from '../domain.ts';
import { shortTitleOf } from '../fitted.ts';
import type { Assets, ModelClient, Tools } from '../ports.ts';
import type { Mindstorm } from '../state.ts';
import { firstView } from './renderer.ts';

export interface Settings {
  /** 'provisional': agent picks stay dashed until the user keeps them. 'immediate': they arrive kept. */
  picksMode: 'provisional' | 'immediate';
  /** New picks the Scout asks for per run, beside what the user already has that it brings into the round. */
  picksPerRun: number;
  /** A tie to something the user already has is strong, and brings it into a round or files a dump under a card, at this rating or above, 0…1. */
  strongTie: number;
  /** Whether a tree the user asks for gets its first round of picks straight away. */
  scoutOnDump: boolean;
  /** What the user calls the agent. "Hey" or "hi" and this name wake it. */
  agentName: string;
}

export const DEFAULT_SETTINGS: Settings = {
  picksMode: 'provisional',
  picksPerRun: 5,
  strongTie: 0.8,
  scoutOnDump: true,
  agentName: 'momo',
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
  /** A line for the run log. */
  note: (role: string, message: string) => void;
  /**
   * Runs one step of a role's work, shown live to the user as `label` while it lasts: at most seven words saying what is being
   * done, true of this step ("Searching research papers for adaptive menus"). `detail` is longer text a client may show beside it.
   */
  step: <T>(role: string, label: string, body: () => Promise<T>, more?: { nodeId?: Id; detail?: string }) => Promise<T>;
}

/** One thing dropped into the mindstorm, before Intake has looked at it. */
export type RawDump =
  | { kind: 'text'; text: string; name?: string }
  | { kind: 'link'; url: string }
  /** `sound` is what the client measured of a recording it could decode. A recording without it is filed by name only. */
  | { kind: 'asset'; asset: string; mime: string; name?: string; sound?: Sound };

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

/** What a card's suggested questions are written from: the card, where it stands, and the cards round it. Every text is already clipped. */
export interface CardBrief {
  title: string;
  kind: ItemKind;
  /** Who put it here, and from where. */
  from: string;
  why: string;
  summary: string;
  text: string;
  /** Titles from the tree's root down to the card's parent. */
  path: string[];
  /** Titles of the cards under it. */
  under: string[];
  /** Titles of the cards beside it. */
  beside: string[];
}

export interface Handoff {
  /** File name without extension. */
  name: string;
  /** What the handoff holds, in words: the trees' names, or "the whole mindstorm". */
  title: string;
  /** The handoff as one Markdown file that travels alone. It names no attached file: each picture and video is described in words, with the web address it came from where it has one. */
  markdown: string;
  /** The same handoff for the bundle, where each file sits beside it at `assets/<id>`. */
  bundled: string;
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
  /**
   * Chooses a component for each node and composites for groups of siblings. Returns setView and setGroup.
   * `edited` names the nodes whose item's title, text or data changed since it was last drawn.
   * A card the model is asked about lands within `waitMs` (12 s unless given), as the model's card or as the rules drew it, and is
   * final. The views may be handed to `deliver` as soon as they are chosen, so a card takes its look without waiting on how its
   * siblings group; a card brought to the model that was not made composing is marked so through `deliver` before the call.
   */
  renderer(ctx: RoleContext, input: { nodeIds: Id[]; edited?: Id[]; deliver?: (commands: Command[]) => void; waitMs?: number }): Promise<Command[]>;
  packager(ctx: RoleContext, input: { scope: Scope; note?: string }): Promise<Handoff>;
  /** Up to four short questions the user is likely to ask next about an open card. Throws when the model fails. */
  questions(ctx: RoleContext, input: { card: CardBrief; history: Turn[] }): Promise<string[]>;
}

export const AGENT = (role: string, tool?: string): Origin => ({ by: 'agent', role, ...(tool ? { tool } : {}) });

/**
 * A new item. Its title is kept as the role gives it. A title the model wrote is already held to a small face's two lines by
 * `fittedTitle`; any other, a source's own, keeps every word, and `data.shortTitle` holds the start of it the face shows.
 */
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
    data: withShortTitle(fields.data ?? {}, fields.title),
    source: { ...fields.source, capturedAt: ctx.now() },
    origin: fields.origin,
    archived: false,
    revision: 0,
  };
}

/** An item's data with `shortTitle` set to what a small face shows of `title`, or without it when the whole title fits. */
export function withShortTitle(data: Item['data'], title: string): Item['data'] {
  const { shortTitle: _, ...rest } = data;
  const short = shortTitleOf(title);
  return short ? { ...rest, shortTitle: short } : rest;
}

/**
 * A node for an item, with the rules' card for it, final unless the model is to be asked, when it is marked composing (`firstView`).
 * `order` continues after the parent's existing children plus `offset`.
 */
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
    view: firstView(item, (id) => ctx.assets.url(id)),
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
