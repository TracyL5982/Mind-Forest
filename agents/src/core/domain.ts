import { z } from 'zod';

export const Id = z.string().min(1);
export type Id = string;

export const ItemKind = z.enum(['text', 'image', 'video', 'audio', 'link', 'chat', 'file', 'code']);
export type ItemKind = z.infer<typeof ItemKind>;

/** The most slices a recording's loudness is measured in. */
export const PEAKS = 64;

/**
 * What is known of a recording without decoding it again: how long it plays, and, when a client measured the file, how loud each
 * of its equal slices is, 0 to 1, the loudest slice 1. A client measures a file it drops; a source may give the length alone.
 */
export const Sound = z.object({
  seconds: z.number().positive().finite(),
  peaks: z.array(z.number().min(0).max(1)).min(1).max(PEAKS).optional(),
});
export type Sound = z.infer<typeof Sound>;

export const Origin = z.object({
  by: z.enum(['user', 'agent']),
  role: z.string().optional(),
  tool: z.string().optional(),
});
export type Origin = z.infer<typeof Origin>;

export const Source = z.object({
  /** How it arrived: paste, drop, voice, web, instagram, image-gen, muse-code, chat-export:claude … */
  from: z.string(),
  url: z.string().optional(),
  /** Asset id served by the host at /assets/<id>. */
  asset: z.string().optional(),
  capturedAt: z.string(),
});
export type Source = z.infer<typeof Source>;

/**
 * Structured content a component can draw. Content roles fill it; the Renderer only reads it.
 * Known keys: chart {labels, values, unit?}, steps string[], messages {role, text}[], facts {label, value}[],
 * person {name, role?}, quote {text, by?}, code {language?, source}, when string (a date), site string,
 * where string, people string[], pros string[], cons string[], table {heads, rows string[][]}, question and answer,
 * term and definition, items string[] with checklist boolean[], colours {name, value}[], excerpt {text, at?},
 * at {lat, lon} (where the item is, in degrees, from a photo's GPS position or a lookup of `where`),
 * mediaUrl and thumbnailUrl (service addresses of a playable file and its still), embed (a player only a browser can show),
 * library (a LibraryRef).
 * A Scout pick also carries what its source catalogued: kind (artwork, paper or book), medium, holder, authors string[],
 * authorsCut true (when the source lists only the first of them), venue.
 * A recording carries sound (a `Sound`), and its text is its transcript.
 */
export const ItemData = z.record(z.string(), z.unknown());
export type ItemData = z.infer<typeof ItemData>;

/**
 * Where a library item lives in the headset's own media, so a headset draws it from there:
 * a film by its index in clips.json, a work by its id in works.json, a note or a tag of ocean.json by its id.
 */
export const LibraryRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('film'), key: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('work'), key: z.string().min(1) }),
  z.object({ kind: z.literal('note'), key: z.string().min(1) }),
  z.object({ kind: z.literal('tag'), key: z.string().min(1) }),
]);
export type LibraryRef = z.infer<typeof LibraryRef>;

/** `source.from` of the headset's films, works, notes and tags. */
export const LIBRARY = 'library';

export const Item = z.object({
  id: Id,
  kind: ItemKind,
  title: z.string(),
  text: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  data: ItemData,
  source: Source,
  origin: Origin,
  archived: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export type Item = z.infer<typeof Item>;

/** A library item lives in the library whether or not a tree holds it. */
export function inLibrary(item: Item): boolean {
  return item.source.from === LIBRARY;
}

export const View = z.object({
  component: z.string(),
  props: z.record(z.string(), z.unknown()),
  /** 'default' is the rules' card, as the node was made; 'renderer' is the Renderer's choice, which is final until the item changes. */
  by: z.enum(['default', 'renderer']),
  /**
   * The model is choosing this card's look, which lands within 12 s. Until then a client draws an in-progress card in its place, and
   * a client that does not read this draws `component` and `props`: the rules' card, a note or an idea.
   */
  composing: z.literal(true).optional(),
});
export type View = z.infer<typeof View>;

export const NodeStatus = z.enum(['kept', 'pick']);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const Node = z.object({
  id: Id,
  treeId: Id,
  itemId: Id,
  parent: Id.nullable(),
  status: NodeStatus,
  why: z.string(),
  importance: z.number().min(0).max(1),
  origin: Origin,
  view: View,
  /** Position among siblings. */
  order: z.number(),
});
export type Node = z.infer<typeof Node>;

export const Tree = z.object({
  id: Id,
  title: z.string(),
  rootId: Id,
  /** A short description the Archivist keeps current, used for filing and retrieval. */
  digest: z.string(),
  createdAt: z.string(),
});
export type Tree = z.infer<typeof Tree>;

export const Link = z.object({
  id: Id,
  a: Id,
  b: Id,
  why: z.string(),
  strength: z.number().min(0).max(1),
});
export type Link = z.infer<typeof Link>;

/** A composite: several nodes of one tree drawn as one arrangement. */
export const Group = z.object({
  id: Id,
  treeId: Id,
  /** The node the members hang from. */
  anchor: Id,
  composite: z.string(),
  title: z.string(),
  members: z.array(Id),
  props: z.record(z.string(), z.unknown()),
});
export type Group = z.infer<typeof Group>;

export const ItemPatch = z.object({
  title: z.string().optional(),
  text: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  data: ItemData.optional(),
});
export type ItemPatch = z.infer<typeof ItemPatch>;

export const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addItem'), item: Item }),
  z.object({ type: z.literal('editItem'), id: Id, patch: ItemPatch, expectRevision: z.number().int().optional() }),
  z.object({ type: z.literal('createTree'), tree: Tree, root: Node }),
  z.object({ type: z.literal('renameTree'), id: Id, title: z.string() }),
  z.object({ type: z.literal('setDigest'), id: Id, digest: z.string() }),
  z.object({ type: z.literal('deleteTree'), id: Id }),
  z.object({ type: z.literal('addNode'), node: Node }),
  /** Moves the node and everything under it. `treeId` moves it into another tree. */
  z.object({ type: z.literal('moveNode'), id: Id, parent: Id, treeId: Id.optional(), order: z.number().optional() }),
  /** Removes the node and everything under it. Items left with no node are archived, except the library's and what the user dropped that only an agent's unkept pick held. */
  z.object({ type: z.literal('deleteNode'), id: Id }),
  z.object({ type: z.literal('keepPick'), id: Id }),
  z.object({ type: z.literal('setWhy'), id: Id, why: z.string(), importance: z.number().min(0).max(1).optional() }),
  z.object({ type: z.literal('setView'), id: Id, view: View }),
  z.object({ type: z.literal('setGroup'), group: Group }),
  z.object({ type: z.literal('removeGroup'), id: Id }),
  z.object({ type: z.literal('link'), link: Link }),
  z.object({ type: z.literal('unlink'), id: Id }),
]);
export type Command = z.infer<typeof Command>;

export type EntityName = 'item' | 'node' | 'tree' | 'link' | 'group';
export type EntityOf<E extends EntityName> = E extends 'item'
  ? Item
  : E extends 'node'
    ? Node
    : E extends 'tree'
      ? Tree
      : E extends 'link'
        ? Link
        : Group;

/**
 * One entity changing. `after: null` is a removal, `before: null` a creation.
 * A client keeps five id-keyed maps and applies these in order. Undo applies them reversed and swapped.
 */
export interface Patch<E extends EntityName = EntityName> {
  entity: E;
  id: Id;
  before: EntityOf<E> | null;
  after: EntityOf<E> | null;
}

/** Commands applied together, undone together. */
export interface ChangeSet {
  id: Id;
  seq: number;
  at: string;
  origin: Origin;
  label: string;
  commands: Command[];
  patches: Patch[];
  /** Change sets that are parts of one piece of work, such as the deliveries of one Scout run, share this. They are undone together. */
  part?: Id;
  /** Set when this change set is the undo of another. */
  undoes?: Id;
  /** The other sets undone in the same step: the rest of its piece of work, and the housekeeping that followed. */
  alsoUndoes?: Id[];
}

export interface Snapshot {
  seq: number;
  items: Item[];
  nodes: Node[];
  trees: Tree[];
  links: Link[];
  groups: Group[];
}

export class CommandError extends Error {
  constructor(
    readonly code: 'missing' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}
