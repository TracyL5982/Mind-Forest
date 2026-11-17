import { announcement } from './announce.ts';
import { label } from './brief.ts';
import { CommandError, type ChangeSet, type Command, type Id, type Item, type Node, type Origin, type Patch } from './domain.ts';
import type { Assets, ModelClient, Store, Tools } from './ports.ts';
import { admit, plainTitle, type RoundLimits } from './round.ts';
import { treeRequest } from './tree-request.ts';
import { brief } from './roles/questions.ts';
import {
  AGENT,
  makeItem,
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
import { withoutWakePhrase } from './wake.ts';

export interface Activity {
  id: Id;
  role: string;
  state: 'start' | 'done' | 'error';
  /** What is being done, in at most seven words, for a client to show live. */
  label: string;
  /** Longer text about the step, such as what the user asked or why it failed. */
  detail?: string;
  /** The label, or on an error what went wrong. Kept for clients that read it from before `label`. */
  message: string;
  /** The node the work is about, so a client can show the work state in place. */
  nodeId?: Id;
  /** The step is a whole Scout run on `nodeId`, not one of its parts, which name the card too. */
  whole?: true;
}

/** `reply`: what the agent answers at once to what was said. `results`: what a piece of work brought, said when it is done. */
export type SayKind = 'reply' | 'results';

/** Everything the pipeline tells the outside world. A host forwards these to its clients. */
export type Outbound =
  | { t: 'change'; set: ChangeSet }
  | { t: 'activity'; activity: Activity }
  | { t: 'note'; role: string; message: string }
  | { t: 'say'; text: string; kind: SayKind }
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
  /** How many picks a round holds, when it is not the usual ten with eight known (the demo's prepared rounds). */
  round?: RoundLimits;
}

const USER: Origin = { by: 'user' };
/** A tree's subject up to this many characters is its root's title. A longer one, or a link, is read by Intake. */
const SUBJECT_MOST = 120;
const MAX_PARALLEL_SCOUTS = 2;

/**
 * The one place roles are run and their commands applied.
 * Content roles decide what exists; every batch they produce is then handed to the Renderer, which decides how it looks.
 */
export class Pipeline {
  readonly ctx: RoleContext;
  private readonly history: Turn[] = [];
  private readonly scoutRun = new Map<Id, number>();
  /** Runs waiting for a slot. A run that ends hands its slot to the first of them. */
  private scoutQueue: (() => void)[] = [];
  private scoutsRunning = 0;
  private voiceRun = 0;
  private settle: ReturnType<typeof setTimeout> | null = null;
  private acting: { text: string; run: number } | null = null;
  private readonly pending = new Set<Promise<unknown>>();
  /** The items of the latest drop, until the user opens a card, so "start a tree on this" can mean them. */
  private dropped: Id[] = [];
  /** The questions last written for each card, under what they were written from. */
  private readonly offered = new Map<Id, { from: string; questions: Promise<string[]> }>();
  /** What the user last turned to (a card opened, a place they were taken, a card asked about), counted so a run can tell whether they moved on. */
  private attention: { seq: number; on?: Id } = { seq: 0 };

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
      step: (role, label, body, more) => this.work(role, label, more?.nodeId, body, more?.detail),
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
    return this.work('intake', dumps.length === 1 ? 'Reading what you dropped' : `Reading the ${dumps.length} things you dropped`, undefined, async () => {
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
      this.say('What should the tree be about?', 'reply');
      return NOTHING;
    }
    const named = mind
      .search(request.title, { limit: 10 })
      .find((hit) => mind.known(hit.id) && plainTitle(hit.item.title) === plainTitle(request.title));
    if (named) return this.file([named.item], request);
    // A subject named in a few words is the root as the user said it. Read by Intake as something dropped, "Dutch artist"
    // became a card called "Dutch artist reference note", and the tree waited on a model call for it.
    if (!/\n|:\/\//.test(request.title) && request.title.length <= SUBJECT_MOST) {
      return this.file([makeItem(this.ctx, { kind: 'text', title: request.title, text: request.title, origin: USER, source: { from: 'paste' } })], request);
    }
    return this.work('intake', label('Starting a tree on', request.title), undefined, async () => {
      const items = await this.deps.roles.intake(this.ctx, [{ kind: 'text', text: request.title }]);
      return items.length === 0 ? NOTHING : this.file(items, request);
    });
  }

  /**
   * Speech, as it arrives. A partial that holds still for a moment is acted on early.
   * The final transcript confirms it, or replaces it and the earlier work is dropped.
   * A leading "hey <name>" is not part of what was asked, so it is dropped, and the phrase alone asks nothing.
   */
  utter(text: string, scene: Scene, final: boolean): void {
    const clean = withoutWakePhrase(text, this.deps.settings.agentName).trim();
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
  focus(nodeId: Id): void {
    this.dropped = [];
    this.attend(nodeId);
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

  /** Direct manipulation from a client: drag to move, edit text, delete, highlight and draw on a card. */
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

  /** Makes an organizing change and says what was done, by voice or typed. */
  async organize(request: string, scope: Scope, focus?: Id): Promise<string> {
    const summary = await this.work('organizer', 'Reorganizing your cards', focus, async () => {
      const { commands, summary } = await this.deps.roles.organizer(this.ctx, { request, scope, focus });
      if (commands.length > 0) {
        const set = this.apply(AGENT('organizer'), `Organize: ${request}`.slice(0, 120), commands);
        if (!set) return 'I could not make that change. Nothing was moved.';
        this.afterContent(set);
      }
      return summary;
    }, request);
    this.say(summary, 'results');
    return summary;
  }

  async handoff(scope: Scope, note?: string): Promise<Handoff> {
    return this.work('packager', 'Packaging a handoff', undefined, async () => {
      const handoff = await this.deps.roles.packager(this.ctx, { scope, note });
      this.deps.emit({ t: 'handoff', handoff });
      return handoff;
    });
  }

  // ---- the demo (src/demo): a prepared tree set up at once, and the conversation started over

  /**
   * Applies commands as they are, with no round rules, no Renderer pass and no announcement: a prepared round of the demo's tree,
   * whose cards come with their looks chosen. Told to the clients as any change is.
   */
  stage(origin: Origin, label: string, commands: Command[]): ChangeSet | null {
    return this.apply(origin, label, commands);
  }

  /** Takes every client's view to a card or a tree, as a spoken "go to" does. */
  go(nodeId?: Id, treeId?: Id): void {
    this.deps.emit({ t: 'navigate', nodeId, treeId });
    this.attend(nodeId);
  }

  /** Starts the conversation over: what was said, the questions written for cards, and the runs under way are forgotten. */
  forget(): void {
    this.history.length = 0;
    this.offered.clear();
    // A run still under way finds a newer one in its place, so what it brings is dropped and it is not announced.
    for (const [anchor, run] of this.scoutRun) this.scoutRun.set(anchor, run + 1);
    this.dropped = [];
    this.acting = null;
    this.voiceRun++;
    this.attend(undefined);
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
      const { intent, say } = await this.work('conductor', 'Working out what you mean', scene.focus, () =>
        this.deps.roles.conductor(this.ctx, { utterance: text, scene, history: this.history.slice(-6), dropped: this.dropped }),
      text);
      if (run !== this.voiceRun) return;
      this.history.push({ who: 'user', text });
      if (say) this.say(say, 'reply');
      await this.perform(intent, scene);
    } catch (err) {
      this.fail('conductor', err);
    } finally {
      if (this.acting?.run === run) this.acting = null;
    }
  }

  /**
   * Something said in a live conversation that no Conductor reads: what the user said and what Momo answered. It joins the
   * conversation the Scout and the suggested questions read.
   */
  spoken(turn: Turn): void {
    if (turn.text.trim()) this.history.push(turn);
  }

  /** Does what an intent says in the background, for one of Momo's live tools, which answers before the work is done. */
  carryOut(intent: Intent, scene: Scene): void {
    this.track(this.perform(intent, scene));
  }

  /** Does what an intent says, as the Conductor's reading of an utterance asks. */
  async perform(intent: Intent, scene: Scene): Promise<void> {
    switch (intent.kind) {
      case 'ask':
      case 'more':
        return this.runScout(intent.anchor, intent.need, intent.reading);
      case 'navigate':
        this.deps.emit({ t: 'navigate', nodeId: intent.nodeId, treeId: intent.treeId });
        if (intent.nodeId) this.focus(intent.nodeId);
        else this.attend(undefined);
        return;
      case 'organize':
        await this.organize(intent.request, intent.scope, scene.focus);
        return;
      case 'handoff': {
        const made = await this.handoff(intent.scope, intent.note || undefined);
        this.say(`Your handoff is ready: ${made.name}.`, 'results');
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

  /** The one place the agent speaks, so a voice can take every line from here. */
  private say(text: string, kind: SayKind): void {
    this.history.push({ who: 'agent', text });
    this.deps.emit({ t: 'say', text, kind });
  }

  private attend(on: Id | undefined): number {
    this.attention = { seq: this.attention.seq + 1, on };
    return this.attention.seq;
  }

  // ---- content flow

  /** Adds what is new of `items` to the knowledge base and places them as the Filer says. A tree the user asked for gets its first round. */
  private file(items: Item[], request?: TreeRequest): Promise<Filed> {
    const { mind } = this.deps;
    const named = items.length === 1 ? `"${items[0]!.title}"` : `${items.length} items`;
    const doing = items.length === 1 ? label(request ? 'Starting a tree with' : 'Finding a place for', items[0]!.title) : request ? `Starting a tree with ${items.length} things` : `Finding places for ${items.length} things`;
    return this.work('filer', doing, undefined, async () => {
      const placing = await this.deps.roles.filer(this.ctx, items, request);
      const fresh = items.filter((item) => !mind.items.has(item.id)).map((item): Command => ({ type: 'addItem', item }));
      const set = this.apply(AGENT('filer'), request ? `Start a tree with ${named}` : `Add ${named}`, admit(mind, [...fresh, ...placing], this.deps.round));
      if (!set) return NOTHING;
      const nodeIds = newNodeIds(set);
      this.afterContent(set);
      const root = nodeIds.find((id) => mind.node(id).parent === null);
      if (request && root && this.deps.settings.scoutOnDump) void this.queueScout(root);
      return { items, nodeIds };
    });
  }

  /**
   * A run awaits its slot here instead of being started by the run that frees it, so it keeps the async context of whoever asked
   * for it. The host reads that context to mark a change or navigate yours.
   */
  private async queueScout(anchor: Id): Promise<void> {
    if (this.scoutsRunning < MAX_PARALLEL_SCOUTS) this.scoutsRunning++;
    else await new Promise<void>((go) => this.scoutQueue.push(go));
    try {
      await this.runScout(anchor, undefined);
    } finally {
      const next = this.scoutQueue.shift();
      if (next) next();
      else this.scoutsRunning--;
    }
  }

  /**
   * A newer request for the same anchor wins. The older one's results are dropped when they arrive, and it is not announced.
   * Every run is one the user asked for, so when it ends the agent says what it brought, and brings the card into view unless
   * the user has turned to something else since asking.
   */
  private async runScout(anchor: Id, need: string | undefined, reading?: string): Promise<void> {
    const { mind } = this.deps;
    if (!mind.nodes.has(anchor)) return;
    const run = (this.scoutRun.get(anchor) ?? 0) + 1;
    this.scoutRun.set(anchor, run);
    const asked = this.attend(anchor);
    const brought: Id[] = [];
    const title = mind.itemOf(anchor).title;
    // The request as the user is shown it: their own words, or Momo's reading only when there are none.
    const request = need || reading;
    try {
      await this.work('scout', label(request ? 'Looking into' : 'Finding more for', title), anchor, async () => {
        // The picks of one run arrive in several deliveries. They share a part, so one undo takes the whole run back.
        const part = this.deps.newId();
        const bring = (commands: Command[]) => {
          // A card deleted while its picks were being found takes the run with it.
          if (this.scoutRun.get(anchor) !== run || commands.length === 0 || !this.deps.mind.nodes.has(anchor)) return;
          const set = this.apply(AGENT('scout'), request ? `Picks for: ${request}`.slice(0, 120) : `Picks for "${title}"`, admit(this.deps.mind, commands, this.deps.round), part);
          if (!set) return;
          brought.push(...newNodeIds(set).filter((id) => mind.nodes.get(id)?.parent === anchor));
          this.afterContent(set);
        };
        bring(await this.deps.roles.scout(this.ctx, { anchor, need, reading, history: this.history.slice(-6), deliver: bring }));
      }, request, true);
    } catch (err) {
      this.fail('scout', err);
    }
    if (this.scoutRun.get(anchor) !== run || !mind.nodes.has(anchor)) return;
    const there = brought.filter((id) => mind.nodes.has(id));
    const stillHere = this.attention.seq === asked || this.attention.on === anchor;
    if (there.length > 0 && stillHere) this.deps.emit({ t: 'navigate', nodeId: anchor });
    this.say(announcement(mind, anchor, there), 'results');
  }

  /** New or changed content goes to the Renderer, and the trees it touched get fresh digests. A card's edits are neither. */
  private afterContent(set: ChangeSet): void {
    if (set.patches.every(onlyEdits)) return;
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
    const edited = set.patches.flatMap((p) => (p.entity === 'item' && saysOtherwise(p as Patch<'item'>) ? mind.nodesOfItem(p.id).map((n) => n.id) : []));
    this.digest(set);
    if (nodeIds.length > 0) this.render(nodeIds, edited);
  }

  /** Cards left composing when the service last stopped are composed again, so none stands in progress for good. */
  resume(): void {
    const composing = [...this.deps.mind.nodes.values()].filter((node) => node.view.composing).map((node) => node.id);
    if (composing.length > 0) this.render(composing, []);
  }

  /** One pass of the Renderer over these nodes. Every card it brings to the model lands within the pass. */
  private render(nodeIds: Id[], edited: Id[]): void {
    const mind = this.deps.mind;
    this.track(
      this.work('renderer', `Laying out ${nodeIds.length === 1 ? 'a card' : `${nodeIds.length} cards`}`, nodeIds[0], async () => {
        const show = (commands: Command[]) => {
          if (commands.length > 0) this.apply(AGENT('renderer'), 'Choose formats', commands);
        };
        show(await this.deps.roles.renderer(this.ctx, { nodeIds: nodeIds.filter((id) => mind.nodes.has(id)), edited, deliver: show }));
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

  private async work<T>(role: string, label: string, nodeId: Id | undefined, body: () => Promise<T>, detail?: string, whole?: true): Promise<T> {
    const id = this.deps.newId();
    const about = { id, role, label, ...(detail ? { detail } : {}), nodeId, ...(whole ? { whole } : {}) };
    this.deps.emit({ t: 'activity', activity: { ...about, state: 'start', message: label } });
    try {
      const result = await body();
      this.deps.emit({ t: 'activity', activity: { ...about, state: 'done', message: label } });
      return result;
    } catch (err) {
      this.deps.emit({ t: 'activity', activity: { ...about, state: 'error', detail: describe(err), message: describe(err) } });
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
/** Whether a patch changes nothing of a node but the user's highlights and drawings on its card. */
function onlyEdits(p: Patch): boolean {
  if (p.entity !== 'node' || !p.before || !p.after) return false;
  const { edits: _before, ...before } = p.before as Node;
  const { edits: _after, ...after } = p.after as Node;
  return JSON.stringify(before) === JSON.stringify(after);
}

function isHousekeeping(set: ChangeSet): boolean {
  // The demo's prepared rounds are set up, not done by the user: an undo never takes one back.
  return set.origin.role === 'renderer' || set.origin.role === 'archivist' || set.origin.role === 'demo';
}

/** Whether an item that was there before now has another title, text or data: what a card is drawn from. Its summary and tags are not. */
function saysOtherwise({ before, after }: Patch<'item'>): boolean {
  return before !== null && after !== null && (before.title !== after.title || before.text !== after.text || JSON.stringify(before.data) !== JSON.stringify(after.data));
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
