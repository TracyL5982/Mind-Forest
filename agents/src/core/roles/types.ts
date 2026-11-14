import type { Command, Id, Item, Node, Origin, Sound } from '../domain.ts';
import type { Assets, ModelClient, Tools } from '../ports.ts';
import type { Mindstorm } from '../state.ts';
import { defaultView } from '../views.ts';

export interface Settings {
  /** 'provisional': agent picks stay dashed until the user keeps them. 'immediate': they arrive kept. */
  picksMode: 'provisional' | 'immediate';
  /** New picks the Scout brings per run. */
  picksPerRun: number;
  /** Most links to existing content the Scout may draw per run. */
  maxLinksPerRun: number;
  /** A link to existing content needs at least this strength, 0…1. */
  linkThreshold: number;
  /** Whether filing a dump also scouts picks for it. */
  scoutOnDump: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  picksMode: 'provisional',
  picksPerRun: 5,
  maxLinksPerRun: 2,
  linkThreshold: 0.8,
  scoutOnDump: true,
};

/** What every role is handed. Roles read `mind` and return commands. Only the pipeline applies them. */
export interface RoleContext {
  mind: Mindstorm;
  model: ModelClient;
  tools: Tools;
  assets: Assets;
  settings: Settings;
  newId: () => Id;
  now: () => string;
  /** A line for the run log. Shown to the user as the agent's work state. */
  note: (role: string, message: string) => void;
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

export interface Roles {
  conductor(ctx: RoleContext, input: { utterance: string; scene: Scene; history: Turn[] }): Promise<Conducted>;
  /** Turns dumps into items. Does not add them. */
  intake(ctx: RoleContext, dumps: RawDump[]): Promise<Item[]>;
  /** Places items that are not in the mindstorm yet. Returns createTree and addNode commands; the pipeline adds the items first. */
  filer(ctx: RoleContext, items: Item[]): Promise<Command[]>;
  /**
   * Brings new content to the anchor.
   * 'refresh' replaces the anchor's unkept picks. 'more' adds to them.
   * Returns addItem + addNode for each pick, deleteNode for replaced picks, and at most `maxLinksPerRun` links.
   * Picks that are ready early may be handed to `deliver` so the user sees them sooner; the rest are returned.
   */
  scout(
    ctx: RoleContext,
    input: {
      anchor: Id;
      need?: string;
      mode: 'refresh' | 'more';
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
   * One pass asks the model about a bounded number of items. `later` is told the nodes it still owes an answer, because the pass was
   * full or a call failed, so the caller can run another pass over them. It is told nothing after a pass in which every call failed:
   * the model is then down, and another pass would only wait on it again. `again` marks such a pass: it looks at cards alone, since
   * the first pass already looked for arrangements among the siblings.
   */
  renderer(ctx: RoleContext, input: { nodeIds: Id[]; edited?: Id[]; again?: boolean; later?: (nodeIds: Id[]) => void }): Promise<Command[]>;
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

/** The status an agent's pick starts with under the current setting. */
export function pickStatus(ctx: RoleContext): Node['status'] {
  return ctx.settings.picksMode === 'provisional' ? 'pick' : 'kept';
}
