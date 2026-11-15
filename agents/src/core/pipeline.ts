import { CommandError, type ChangeSet, type Command, type Id, type Item, type Origin } from './domain.ts';
import type { Assets, ModelClient, Store, Tools } from './ports.ts';
import { admit, plainTitle } from './round.ts';
import { treeRequest } from './tree-request.ts';
import { brief } from './roles/questions.ts';
import {
  AGENT,
  type Handoff,
  type Intent,
  type RawDump,
  type RoleContext,
  type Roles,
  type Scene,
  type Scope,
  type Playback,
  type Settings,
  type TreeRequest,
  type Turn,
} from './roles/types.ts';
import type { Mindstorm } from './state.ts';

export interface Activity {
  id: Id;
  role: string;
  state: 'start' | 'done' | 'error';
  message: string;
  /** The node the work is about, so a client can show the work state in place. */
  nodeId?: Id;
}

/** Everything the pipeline tells the outside world. A host forwards these to its clients. */
export type Outbound =
  | { t: 'change'; set: ChangeSet }
  | { t: 'activity'; activity: Activity }
  | { t: 'note'; role: string; message: string }
  | { t: 'say'; text: string }
  | { t: 'heard'; text: string; final: boolean }
  | { t: 'navigate'; nodeId?: Id; treeId?: Id }
  | { t: 'handoff'; handoff: Handoff }
  | { t: 'settings'; settings: Settings };

/** What a drop became: the items it made or named, and the new nodes that hold them. An item no node holds is in the knowledge base alone. */
export interface Filed {
  items: Item[];
  nodeIds: Id[];
}

const NOTHING: Filed = { items: [], nodeIds: [] };

export interface PipelineDeps {
  mind: Mindstorm;
  roles: Roles;
  model: ModelClient;
  tools: Tools;
  assets: Assets;
  store: Store;
  settings: Settings;
  newId: () => Id;
  now: () => string;
  emit: (message: Outbound) => void;
  /** How long a partial transcript must hold still before the agent acts on it. */
  settleMs?: number;
  /** What the connected clients can play. Without it every client is taken to be a browser. */
  playback?: () => Playback;
}

const USER: Origin = { by: 'user' };
const MAX_PARALLEL_SCOUTS = 2;

/**
 * The one place roles are run and their commands applied.
 * Content roles decide what exists; every batch they produce is then handed to the Renderer, which decides how it looks.
 */
export class Pipeline {
  readonly ctx: RoleContext;
  private readonly history: Turn[] = [];
  private readonly scoutRun = new Map<Id, number>();
  private scoutQueue: (() => Promise<void>)[] = [];
  private scoutsRunning = 0;
  private voiceRun = 0;
  private settle: ReturnType<typeof setTimeout> | null = null;
  private acting: { text: string; run: number } | null = null;
  private readonly pending = new Set<Promise<unknown>>();
  /** The items of the latest drop, until the user opens a card, so "start a tree on this" can mean them. */
  private dropped: Id[] = [];
  /** The questions last written for each card, under what they were written from. */
  private readonly offered = new Map<Id, { from: string; questions: Promise<string[]> }>();

  constructor(private readonly deps: PipelineDeps) {
    this.ctx = {
      mind: deps.mind,
      model: deps.model,
      tools: deps.tools,
      assets: deps.assets,
      settings: deps.settings,
      playback: deps.playback ?? (() => ({ embeds: true, files: [] })),
      newId: deps.newId,
      now: deps.now,
      note: (role, message) => deps.emit({ t: 'note', role, message }),
    };
  }

  /** Resolves when every piece of background work started so far has finished. For tests and scripts. */
  async idle(): Promise<void> {
    while (this.pending.size > 0 || this.scoutsRunning > 0 || this.scoutQueue.length > 0) {
      await Promise.allSettled([...this.pending]);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // ---- what a user can do

  /**
   * Anything dropped into the mindstorm joins the knowledge base: Intake reads it, and the Filer hangs it under a card only when it
   * plainly belongs there. A drop whose words ask for a tree ("start a tree on this", "make a tree about …") becomes one instead.
   */
  async dump(dumps: RawDump[]): Promise<Filed> {
    const asked = askedForTree(dumps);
    if (asked.request && asked.dumps.length === 0) return this.makeTree(asked.request.title, asked.request.title ? [] : this.dropped);
    return this.work('intake', `Reading ${dumps.length === 1 ? 'what you dropped' : `${dumps.length} things`}`, undefined, async () => {
      const items = await this.deps.roles.intake(this.ctx, asked.dumps);
      if (items.length === 0) return NOTHING;
      this.dropped = asked.request ? [] : items.map((i) => i.id);
      return this.file(items, asked.request);
    });
  }

  /**
   * A new tree the user asked for: grown from items they already have, or about a subject. A subject that names something the user
   * already has, such as a film of the library, makes that thing the root. The root's first round draws on everything the user has.
   */
  async makeTree(subject: string, itemIds: Id[] = []): Promise<Filed> {
    const { mind } = this.deps;
    const request: TreeRequest = { title: subject.trim() };
    const have = itemIds.flatMap((id) => mind.items.get(id) ?? []);
    if (have.length > 0) {
      this.dropped = [];
      return this.file(have, request);
    }
    if (!request.title) {
      this.say('What should the tree be about?');
      return NOTHING;
    }
    const named = mind
      .search(request.title, { limit: 10 })
      .find((hit) => mind.known(hit.id) && plainTitle(hit.item.title) === plainTitle(request.title));
    if (named) return this.file([named.item], request);
    return this.work('intake', `Starting a tree on "${request.title}"`, undefined, async () => {
      const items = await this.deps.roles.intake(this.ctx, [{ kind: 'text', text: request.title }]);
      return items.length === 0 ? NOTHING : this.file(items, request);
    });
  }

  /**
   * Speech, as it arrives. A partial that holds still for a moment is acted on early.
   * The final transcript confirms it, or replaces it and the earlier work is dropped.
   */
  utter(text: string, scene: Scene, final: boolean): void {
    const clean = text.trim();
    if (!clean) return;
    this.deps.emit({ t: 'heard', text: clean, final });
    if (this.settle) clearTimeout(this.settle);
    this.settle = null;
    if (final) {
      if (this.acting && normal(this.acting.text) === normal(clean)) return;
      this.track(this.act(clean, scene));
      return;
    }
    if (clean.split(/\s+/).length < 4) return;
    this.settle = setTimeout(() => {
      this.settle = null;
      this.track(this.act(clean, scene));
    }, this.deps.settleMs ?? 900);
  }

  /**
   * The user opened or looked at a card. A card opens to show what it holds and brings nothing: picks come from talking about it,
   * and from the first round of a tree the user asked for. "This" stops meaning the latest drop.
   */
  focus(_nodeId: Id): void {
    this.dropped = [];
  }

  /** A typed or picked question about a card. It joins the conversation, as a spoken one does. What it brings joins the card's round, and the picks least related to the question make room. */
  ask(anchor: Id, need: string): Promise<void> {
    this.history.push({ who: 'user', text: need });
    return this.runScout(anchor, need);
  }

  more(anchor: Id, need?: string): Promise<void> {
    return this.runScout(anchor, need);
  }

  /**
   * What the user is likely to ask next about a card, for a client to offer under it. Never rejects.
   * The same card, with the same cards round it, in the same conversation, gets the questions written before.
   */
  questions(nodeId: Id): Promise<string[]> {
    if (!this.deps.mind.nodes.has(nodeId)) return Promise.resolve([]);
    const input = { card: brief(this.deps.mind, nodeId), history: this.history.slice(-6) };
    const from = JSON.stringify(input);
    const offered = this.offered.get(nodeId);
    if (offered?.from === from) return offered.questions;
    const questions = this.deps.roles.questions(this.ctx, input).catch((err: unknown) => {
      this.fail('questions', err);
      // A failure is not kept, so the next time the card is opened asks again.
      if (this.offered.get(nodeId)?.questions === questions) this.offered.delete(nodeId);
      return [];
    });
    this.offered.set(nodeId, { from, questions });
    return questions;
  }

  keep(nodeIds: Id[]): void {
    const ids = nodeIds.filter((id) => this.deps.mind.nodes.get(id)?.status === 'pick');
    if (ids.length === 0) return;
    this.apply(USER, ids.length === 1 ? 'Keep a pick' : `Keep ${ids.length} picks`, ids.map((id) => ({ type: 'keepPick', id })));
  }

  /** Direct manipulation from a client: drag to move, edit text, delete. */
  userCommands(label: string, commands: Command[]): ChangeSet | null {
    const set = this.apply(USER, label, commands);
    if (set) this.afterContent(set);
    return set;
  }

  undo(id?: Id): ChangeSet | null {
    try {
      const set = this.deps.mind.undo(id, USER, isHousekeeping);
      this.commit(set);
      this.afterContent(set);
      return set;
    } catch (err) {
      this.fail('undo', err);
      return null;
    }
  }

  async organize(request: string, scope: Scope, focus?: Id): Promise<string> {
    return this.work('organizer', 'Reorganizing', focus, async () => {
      const { commands, summary } = await this.deps.roles.organizer(this.ctx, { request, scope, focus });
      if (commands.length > 0) {
        const set = this.apply(AGENT('organizer'), `Organize: ${request}`.slice(0, 120), commands);
        if (!set) return 'I could not make that change. Nothing was moved.';
        this.afterContent(set);
      }
      return summary;
    });
  }

  async handoff(scope: Scope, note?: string): Promise<Handoff> {
    return this.work('packager', 'Packaging a handoff', undefined, async () => {
      const handoff = await this.deps.roles.packager(this.ctx, { scope, note });
      this.deps.emit({ t: 'handoff', handoff });
      return handoff;
    });
  }

  /** What the next undo would take back, for a client's undo button. */
  undoLabel(): string | null {
    return this.deps.mind.undoTarget(isHousekeeping)?.label ?? null;
  }

  setSettings(patch: Partial<Settings>): void {
    Object.assign(this.deps.settings, patch);
    this.deps.emit({ t: 'settings', settings: this.deps.settings });
  }

  // ---- voice

  private async act(text: string, scene: Scene): Promise<void> {
    const run = ++this.voiceRun;
    this.acting = { text, run };
    try {
      const { intent, say } = await this.work('conductor', 'Listening', scene.focus, () =>
        this.deps.roles.conductor(this.ctx, { utterance: text, scene, history: this.history.slice(-6), dropped: this.dropped }),
      );
      if (run !== this.voiceRun) return;
      this.history.push({ who: 'user', text });
      if (say) this.say(say);
      await this.dispatch(intent, scene);
    } catch (err) {
      this.fail('conductor', err);
    } finally {
      if (this.acting?.run === run) this.acting = null;
    }
  }

  private async dispatch(intent: Intent, scene: Scene): Promise<void> {
    switch (intent.kind) {
      case 'ask':
        return this.runScout(intent.anchor, intent.need);
      case 'more':
        return this.more(intent.anchor, intent.need);
      case 'navigate':
        this.deps.emit({ t: 'navigate', nodeId: intent.nodeId, treeId: intent.treeId });
        if (intent.nodeId) this.focus(intent.nodeId);
        return;
      case 'organize':
        this.say(await this.organize(intent.request, intent.scope, scene.focus));
        return;
      case 'handoff': {
        const made = await this.handoff(intent.scope, intent.note || undefined);
        this.say(`Your handoff is ready: ${made.name}.`);
        return;
      }
      case 'capture':
        await this.dump([{ kind: 'text', text: intent.text }]);
        return;
      case 'tree':
        await this.makeTree(intent.subject, intent.itemIds);
        return;
      case 'keep':
        this.keep(intent.nodeIds);
        return;
      case 'undo':
        this.undo();
        return;
      case 'reply':
        return;
    }
  }

  private say(text: string): void {
    this.history.push({ who: 'agent', text });
    this.deps.emit({ t: 'say', text });
  }

  // ---- content flow

  /** Adds what is new of `items` to the knowledge base and places them as the Filer says. A tree the user asked for gets its first round. */
  private file(items: Item[], request?: TreeRequest): Promise<Filed> {
    const { mind } = this.deps;
    const named = items.length === 1 ? `"${items[0]!.title}"` : `${items.length} items`;
    return this.work('filer', request ? `Starting a tree with ${named}` : `Finding a place for ${named}`, undefined, async () => {
      const placing = await this.deps.roles.filer(this.ctx, items, request);
      const fresh = items.filter((item) => !mind.items.has(item.id)).map((item): Command => ({ type: 'addItem', item }));
      const set = this.apply(AGENT('filer'), request ? `Start a tree with ${named}` : `Add ${named}`, admit(mind, [...fresh, ...placing]));
      if (!set) return NOTHING;
      const nodeIds = newNodeIds(set);
      this.afterContent(set);
      const root = nodeIds.find((id) => mind.node(id).parent === null);
      if (request && root && this.deps.settings.scoutOnDump) this.queueScout(root);
      return { items, nodeIds };
    });
  }

  private queueScout(anchor: Id): void {
    this.scoutQueue.push(() => this.runScout(anchor, undefined));
    this.drainScouts();
  }

  private drainScouts(): void {
    while (this.scoutsRunning < MAX_PARALLEL_SCOUTS && this.scoutQueue.length > 0) {
      const next = this.scoutQueue.shift()!;
      this.scoutsRunning++;
      void next().finally(() => {
        this.scoutsRunning--;
        this.drainScouts();
      });
    }
  }

  /** A newer request for the same anchor wins. The older one's results are dropped when they arrive. */
  private async runScout(anchor: Id, need: string | undefined): Promise<void> {
    if (!this.deps.mind.nodes.has(anchor)) return;
    const run = (this.scoutRun.get(anchor) ?? 0) + 1;
    this.scoutRun.set(anchor, run);
    const title = this.deps.mind.itemOf(anchor).title;
    try {
      await this.work('scout', need ? `Looking for: ${need}` : `Finding more around "${title}"`, anchor, async () => {
        // The picks of one run arrive in several deliveries. They share a part, so one undo takes the whole run back.
        const part = this.deps.newId();
        const bring = (commands: Command[]) => {
          // A card deleted while its picks were being found takes the run with it.
          if (this.scoutRun.get(anchor) !== run || commands.length === 0 || !this.deps.mind.nodes.has(anchor)) return;
          const set = this.apply(AGENT('scout'), need ? `Picks for: ${need}`.slice(0, 120) : `Picks for "${title}"`, admit(this.deps.mind, commands), part);
          if (set) this.afterContent(set);
        };
        bring(await this.deps.roles.scout(this.ctx, { anchor, need, history: this.history.slice(-6), deliver: bring }));
      });
    } catch (err) {
      this.fail('scout', err);
    }
  }

  /** New or changed content goes to the Renderer, and the trees it touched get fresh digests. */
  private afterContent(set: ChangeSet): void {
    const mind = this.deps.mind;
    const nodeIds = [
      ...new Set(
        set.patches.flatMap((p) => {
          if (p.after === null) return [];
          if (p.entity === 'node') return [p.id];
          if (p.entity === 'item') return mind.nodesOfItem(p.id).map((n) => n.id);
          return [];
        }),
      ),
    ].filter((id) => mind.nodes.has(id));
    this.digest(set);
    if (nodeIds.length === 0) return;
    this.track(
      this.work('renderer', 'Choosing how to show this', nodeIds[0], async () => {
        const commands = await this.deps.roles.renderer(this.ctx, { nodeIds: nodeIds.filter((id) => mind.nodes.has(id)) });
        if (commands.length > 0) this.apply(AGENT('renderer'), 'Choose formats', commands);
      }).catch((err) => this.fail('renderer', err)),
    );
  }

  /** The Archivist: a plain-code description of each touched tree, kept current for filing and retrieval. */
  private digest(set: ChangeSet): void {
    const mind = this.deps.mind;
    const treeIds = new Set<Id>();
    for (const p of set.patches) {
      const value = p.after ?? p.before;
      if (p.entity === 'node' && value && 'treeId' in value) treeIds.add(value.treeId);
    }
    const commands: Command[] = [];
    for (const id of treeIds) {
      const tree = mind.trees.get(id);
      if (!tree) continue;
      const nodes = mind.treeNodes(id).filter((n) => n.status === 'kept');
      const counts = new Map<string, number>();
      for (const n of nodes) for (const tag of mind.item(n.itemId).tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      const tags = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
      const titles = nodes.slice(0, 8).map((n) => mind.item(n.itemId).title);
      const digest = `${titles.join('; ')}${tags.length ? ` [${tags.join(', ')}]` : ''}`.slice(0, 400);
      if (digest !== tree.digest) commands.push({ type: 'setDigest', id, digest });
    }
    if (commands.length > 0) this.apply(AGENT('archivist'), 'Update tree digests', commands);
  }

  // ---- plumbing

  private apply(origin: Origin, label: string, commands: Command[], part?: Id): ChangeSet | null {
    if (commands.length === 0) return null;
    try {
      const set = this.deps.mind.apply({ origin, label, commands, ...(part ? { part } : {}) });
      this.commit(set);
      return set;
    } catch (err) {
      this.fail(origin.role ?? 'user', err);
      return null;
    }
  }

  private commit(set: ChangeSet): void {
    if (set.patches.length === 0 && !set.undoes) return;
    this.deps.store.append(set);
    this.deps.emit({ t: 'change', set });
  }

  private async work<T>(role: string, message: string, nodeId: Id | undefined, body: () => Promise<T>): Promise<T> {
    const id = this.deps.newId();
    this.deps.emit({ t: 'activity', activity: { id, role, state: 'start', message, nodeId } });
    try {
      const result = await body();
      this.deps.emit({ t: 'activity', activity: { id, role, state: 'done', message, nodeId } });
      return result;
    } catch (err) {
      this.deps.emit({ t: 'activity', activity: { id, role, state: 'error', message: describe(err), nodeId } });
      throw err;
    }
  }

  private fail(role: string, err: unknown): void {
    this.deps.emit({ t: 'note', role, message: `failed: ${describe(err)}` });
  }

  private track(p: Promise<unknown>): void {
    const guarded = p.catch((err) => this.fail('pipeline', err));
    this.pending.add(guarded);
    void guarded.finally(() => this.pending.delete(guarded));
  }
}

/** Formats and digests follow from content. They are not something a user thinks of undoing. */
function isHousekeeping(set: ChangeSet): boolean {
  return set.origin.role === 'renderer' || set.origin.role === 'archivist';
}

/** A drop whose text asks for a tree: the request, and what was dropped without the words that asked. */
function askedForTree(dumps: RawDump[]): { request?: TreeRequest; dumps: RawDump[] } {
  for (const [at, dump] of dumps.entries()) {
    const asked = dump.kind === 'text' ? treeRequest(dump.text) : null;
    if (!asked) continue;
    const rest = dumps.flatMap((d, i) => (i !== at ? [d] : asked.rest ? [{ ...d, text: asked.rest }] : []));
    return { request: { title: asked.subject }, dumps: rest };
  }
  return { dumps };
}

function newNodeIds(set: ChangeSet): Id[] {
  return set.patches.filter((p) => p.entity === 'node' && p.before === null && p.after !== null).map((p) => p.id);
}

function normal(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function describe(err: unknown): string {
  if (err instanceof CommandError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
