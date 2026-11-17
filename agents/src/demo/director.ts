import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Command, Id, Item, Origin } from '../core/domain.ts';
import type { Pipeline } from '../core/pipeline.ts';
import type { Assets } from '../core/ports.ts';
import type { RoleContext, Roles } from '../core/roles/types.ts';
import type { Mindstorm } from '../core/state.ts';
import { itemOf, nodeOf, type Making } from './cards.ts';
import type { DemoScript, ScriptCard, ScriptPhase } from './script.ts';
import { inLayers, type Showcase } from './showcase.ts';

/**
 * The demo: one prepared tree, grown round by round.
 *
 * - Going to a round sets the tree up as it stands just before that round: every earlier round built, its cards kept. A headset is
 *   taken through the rounds in order, each card opened before its cards are added, because a headset makes its layers itself from
 *   what is asked on it, and cards that all arrive at once land on one layer.
 * - Playing a round is the Scout's work, scripted. The user asks as usual, by voice or by hand, and Momo answers as usual; when the
 *   Scout is run, the round's cards come in its place, under the same step labels, and Momo tells of them as they land.
 *
 * Nothing of the live system is changed by it but what the Scout brings, the questions offered under a round's card, and the
 * Renderer, which is given nothing to choose because each card comes with its look.
 */

/**
 * How long things take, in milliseconds. A set-up does not run on these: it waits for the headset to say each thing is done (the
 * tree stands, a card is open, a card leads its layer) and these are only the longest it waits. With no headset joined nothing waits.
 */
export interface Pace {
  /** The longest wait for the tree to stand up on the headset after it is made. */
  stand: number;
  /** The longest wait for the headset to open a card it was taken to. */
  open: number;
  /** The longest wait for the headset to say a card leads its layer, after its cards are added. */
  land: number;
  /** A breath between one thing done and the next begun, so the headset's own motion is not cut short. */
  breath: number;
  /** One step of a round that is played: a search, a reading, a picture being made. */
  step: number;
  /** The longest wait for the app to join again after it is started again on the headset. */
  rejoin: number;
}

export const PACE: Pace = { stand: 9000, open: 4000, land: 3000, breath: 220, step: 1500, rejoin: 25000 };

export interface DirectorDeps {
  script: DemoScript;
  /** The folder the script's pictures and films are in. */
  mediaDir: string;
  /** The whole trees that stand in the forest beside the walkthrough's. */
  showcase?: Showcase[];
  /** Where the record of which media file is which stored asset is kept. */
  dataDir: string;
  mind: Mindstorm;
  pipeline: Pipeline;
  assets: Assets;
  /** The roles as they are without the demo, for what the script does not cover. */
  roles: Roles;
  /** Runs something as the headset's own request, so the headset stands the tree it makes and follows where it goes. */
  asDevice: <T>(body: () => T) => T;
  /** How many headsets are joined. */
  devices: () => number;
  /** Ends every live conversation, so Momo starts a take with nothing said before it. */
  forgetVoices: () => void;
  /**
   * Starts the app again on the headset, joined to this service as before, and resolves with a line for the log. A headset
   * keeps a tree standing after the service deletes it, so this is the only way to an empty stage there. Absent where the host
   * cannot do it; then the page says to do it by hand.
   */
  restart?: () => Promise<string>;
  log: (line: string) => void;
  pace?: Partial<Pace>;
}

/**
 * What Momo is told beside her own instructions while the demo runs. Her words stay her own: this only makes a request a take,
 * so a line of the walkthrough starts a search without a question back. Which card a round waits on she is told with where the
 * user is (`takeNote`), since by her own rules a question gets an answer and no cards, and half the walkthrough's lines are questions.
 */
export const momoNote = (script: DemoScript) => `# Recording a walkthrough
The user is recording a walkthrough of one tree, and each thing they say is a take. So, only here:
- With no tree open, "let's jam on…", "let's brainstorm…" or a subject alone asks for a tree: call start_tree with the subject, and ask nothing first. The walkthrough's own subject is "${script.topic}": when that is what they mean, in whatever words, give start_tree exactly those words.
- A [Where the user is] note may end with a line that begins "Recording:". It says what the next thing the user says asks for with that card open, and it comes before the rules above. When it says a new layer: say a few lively words of your own and call find_new on the open card, their words as the need, even when they put it as a question, a reaction or a single word ("So which ones do we keep?", "that's cool, but…", "Layers?"), and ask nothing back. Only "more of this" and "more like this" stay more_like_this. When it says to answer aloud: answer from the card in a sentence or two, and call no tool.
- With no such line, everything is as above.
- A round here lands many cards at once. At [More cards landed] with more than two cards, never say their titles one after another: say how many came and name the one you like best, in one short line.`;

/** What a set-up round is recorded as: never the user's doing, so an undo does not take one back. */
const DEMO: Origin = { by: 'user', role: 'demo' };
/** What the page is told when the app is left showing a tree that is gone. */
const STALE = 'The app still shows a tree that is gone. Start it again: close it on the headset and open it. From a Mac with the headset on the cable: agents/demo/headset.sh restart, or agents/demo/headset.sh fly for the demo on Fly';
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export interface DemoStatus {
  title: string;
  /** The round the tree is set up for, by its place in the script; the number of rounds when all are built. */
  armed: number;
  /** What is being done now, or null. */
  busy: string | null;
  /** Whether a request plays the next round. Off, the live Scout answers. */
  scripted: boolean;
  devices: number;
  /** Each round, in order: whether its cards are in the tree, and how they came. */
  rounds: { id: string; state: 'built' | 'played' | 'playing' | 'waiting' }[];
  /** The last thing that went wrong, for the page to show. */
  problem: string | null;
  /** The showcase trees: whether they stand in the forest, and each by name with the number of its cards. */
  showcase: { on: boolean; trees: { id: string; title: string; cards: number }[] };
}

export class Director {
  private readonly pace: Pace;
  /** The node each card of the script hangs on now. */
  private readonly nodes = new Map<string, Id>();
  /** The tree's first card. */
  private root: Id | null = null;
  private readonly built = new Map<string, 'built' | 'played'>();
  private readonly playing = new Set<string>();
  private armed = 0;
  private scripted = true;
  private busy: string | null = null;
  private problem: string | null = null;
  /** Counts set-ups, so the nodes of one never meet those of another. */
  private round = Date.now();
  /** Which set-up is under way: a newer one ends the older one where it is. */
  private take = 0;
  /** The stored copy of each media file. */
  private media = new Map<string, { id: string; url: string }>();
  /** The card the headset was last taken to in a set-up, and the cards that lead a layer there: neither is told twice. */
  private at: Id | null = null;
  private readonly leading = new Set<Id>();
  /** Who waits to hear something from the headset, by what it is and the card it is about: `focus:<node>`, `questions:<node>`. */
  private readonly waiting = new Map<string, Set<() => void>>();
  /** The showcase trees, and whether they stand in the forest. */
  private readonly shows: Showcase[];
  private showing = true;

  constructor(private readonly deps: DirectorDeps) {
    this.pace = { ...PACE, ...deps.pace };
    this.shows = deps.showcase ?? [];
  }

  get script(): DemoScript {
    return this.deps.script;
  }

  // ---- media

  /** Stores each picture and film of the script once. A file that changed is stored again. */
  async prepare(): Promise<void> {
    const record = join(this.deps.dataDir, 'demo-media.json');
    const kept: Record<string, { id: string; size: number; at: number }> = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : {};
    // A file's name is its place: the script's own by name, a showcase tree's as `<tree>/<name>`.
    const files = new Map<string, string>();
    for (const phase of this.script.phases) for (const card of phase.cards) for (const file of [card.image, card.video]) if (file) files.set(file, join(this.deps.mediaDir, file));
    for (const { tree, mediaDir } of this.shows) for (const card of tree.cards) if (card.image) files.set(`${tree.id}/${card.image}`, join(mediaDir, card.image));
    let stored = 0;
    const missing: string[] = [];
    for (const [file, path] of files) {
      if (!existsSync(path)) {
        missing.push(file);
        continue;
      }
      const { size, mtimeMs } = statSync(path);
      const had = kept[file];
      if (!had || had.size !== size || had.at !== Math.round(mtimeMs) || !(await this.deps.assets.get(had.id))) {
        const { id } = await this.deps.assets.put(new Uint8Array(readFileSync(path)), MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', file.split('/').pop()!);
        kept[file] = { id, size, at: Math.round(mtimeMs) };
        stored++;
      }
      this.media.set(file, { id: kept[file]!.id, url: this.deps.assets.url(kept[file]!.id) });
    }
    writeFileSync(record, JSON.stringify(kept, null, 1));
    this.deps.log(`[demo] "${this.script.title}": ${this.script.phases.length} rounds, ${files.size} media files (${stored} stored now)${missing.length ? `, MISSING: ${missing.join(', ')}` : ''}`);
    // A data folder kept from an earlier run may hold the tree: find what stands, so the page shows it and the next round is the right one.
    this.adopt();
    const shown = join(this.deps.dataDir, 'demo-showcase.json');
    if (existsSync(shown)) this.showing = JSON.parse(readFileSync(shown, 'utf8')).on !== false;
    this.plant();
  }

  // ---- the showcase trees

  /** The id a showcase tree is kept under: it changes when the tree's file does, so a changed tree is planted afresh. */
  private showId(show: Showcase): Id {
    return `show-${show.tree.id}-${createHash('sha1').update(show.text).digest('hex').slice(0, 8)}`;
  }

  /** Whether a card hangs in a showcase tree: such a tree is the user's to ask on as ever, and no round is played on it. */
  private inShowcase(nodeId: Id): boolean {
    return this.deps.mind.nodes.get(nodeId)?.treeId.startsWith('show-') ?? false;
  }

  /**
   * Makes the forest hold the showcase trees as they are written, or none of them: a tree not there is planted whole, its cards
   * kept, and one that is there from an older file, or that should not be there, is taken down. True when a tree was taken down.
   */
  private plant(): boolean {
    const { mind, pipeline } = this.deps;
    const wanted = new Map(this.showing ? this.shows.map((show): [Id, Showcase] => [this.showId(show), show]) : []);
    const gone = [...mind.trees.keys()].filter((id) => id.startsWith('show-') && !wanted.has(id));
    if (gone.length > 0) this.deps.asDevice(() => pipeline.stage(DEMO, 'Demo: take the showcase trees down', gone.map((id): Command => ({ type: 'deleteTree', id }))));
    let n = 0;
    for (const [treeId, show] of wanted) {
      n++;
      if (mind.trees.has(treeId)) continue;
      const { tree } = show;
      const set = `show-${tree.id}`;
      const making: Making = { ...this.making, media: (file) => this.media.get(`${tree.id}/${file}`) };
      // The trees are a few minutes apart, the first written the oldest, so the forest orders them the same way each time.
      const at = new Date(Date.now() - (this.shows.length - n + 1) * 60_000).toISOString();
      const rootId = `${treeId}-root`;
      const first: Item = {
        id: `${set}-root-${createHash('sha1').update(tree.topic).digest('hex').slice(0, 8)}`,
        kind: 'text', title: tree.topic, text: tree.topic, summary: '', tags: [], data: {},
        source: { from: 'voice', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0,
      };
      const root = nodeOf({ id: 'root', kind: 'note', origin: 'ocean', title: first.title, text: '' }, first, { id: rootId, treeId, parent: rootId, status: 'kept', order: 0, rank: 0 }, making);
      const commands: Command[] = [
        ...(mind.items.has(first.id) ? [] : [{ type: 'addItem', item: first } as Command]),
        { type: 'createTree', tree: { id: treeId, title: tree.title, rootId, digest: '', createdAt: at }, root: { ...root, parent: null, why: '', origin: { by: 'user' }, importance: 1 } },
      ];
      const placed = new Map<string, number>();
      for (const card of inLayers(tree)) {
        const item = itemOf(card, making, set);
        if (!mind.items.has(item.id) && !commands.some((c) => c.type === 'addItem' && c.item.id === item.id)) commands.push({ type: 'addItem', item });
        const parent = card.parent === 'root' ? rootId : `${treeId}-${card.parent}`;
        const order = placed.get(parent) ?? 0;
        placed.set(parent, order + 1);
        commands.push({ type: 'addNode', node: nodeOf(card, item, { id: `${treeId}-${card.id}`, treeId, parent, status: 'kept', order, rank: order }, making) });
      }
      // Planted as nobody's request: a headset puts such a tree away on its desk, where one it asked for would stand.
      pipeline.stage(DEMO, `Demo: the showcase tree "${tree.title}"`, commands);
      this.deps.log(`[demo] the showcase tree "${tree.title}" stands in the forest: ${tree.cards.length} cards`);
    }
    return gone.length > 0;
  }

  /**
   * Stands a showcase tree on the headset with every layer open, for showing it whole. A tree that arrives whole lies on one
   * layer there, its deeper cards bunched behind the first: a card takes a layer of its own only once it is asked on, or once
   * the headset is taken to a card under it. So the headset is taken to one card under each card that has any, a layer at a
   * time, and then back to the first card.
   */
  async show(id: string): Promise<void> {
    const found = this.shows.find((show) => show.tree.id === id);
    if (!found) throw new Error(`there is no showcase tree called ${id}`);
    const treeId = this.showId(found);
    const { mind, pipeline } = this.deps;
    if (!this.showing || !mind.trees.has(treeId)) throw new Error(`"${found.tree.title}" is not in the forest: switch the other trees on first`);
    if (this.deps.devices() === 0) throw new Error('No headset is joined to show it on.');
    const take = ++this.take;
    const going = () => take === this.take;
    this.problem = null;
    this.busy = `Showing "${found.tree.title}" whole on the headset`;
    try {
      for (const resume of [...this.waiting.values()].flatMap((set) => [...set])) resume();
      const rootId = `${treeId}-root`;
      // The tree stands from its cover, or is gone back to, and says so.
      const stood = this.hears([`focus:${rootId}`, `questions:${rootId}`], this.pace.stand);
      this.deps.asDevice(() => pipeline.go(rootId));
      await stood;
      await pause(this.pace.breath);
      // One card under each card that leads others: going to it makes the card above it lead its layer.
      const leads = inLayers(found.tree).filter((card) => card.parent !== 'root');
      const seen = new Set<string>();
      for (const card of leads) {
        if (!going()) return;
        if (seen.has(card.parent)) continue;
        seen.add(card.parent);
        const node = `${treeId}-${card.id}`;
        if (!mind.nodes.has(node)) continue;
        const there = this.hears([`questions:${node}`, `focus:${node}`], this.pace.open / 4);
        this.deps.asDevice(() => pipeline.go(node));
        await there;
        await pause(this.pace.breath);
      }
      if (!going()) return;
      this.deps.asDevice(() => pipeline.go(rootId));
      this.deps.log(`[demo] "${found.tree.title}" stands whole on the headset: ${seen.size} layers under its first`);
    } catch (err) {
      this.problem = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      if (going()) this.busy = null;
    }
  }

  /** Puts the showcase trees in the forest, or takes them out. A headset keeps a tree that is gone, so it is started again. */
  async setShowcase(on: boolean): Promise<void> {
    if (on === this.showing) return;
    this.showing = on;
    writeFileSync(join(this.deps.dataDir, 'demo-showcase.json'), JSON.stringify({ on }));
    this.problem = null;
    const going = () => true;
    try {
      if (this.plant() && this.deps.devices() > 0) await this.startAgain(going);
    } finally {
      this.busy = null;
    }
  }

  private get making(): Making {
    return { media: (file) => this.media.get(file), assetUrl: (id) => this.deps.assets.url(id), now: () => new Date().toISOString() };
  }

  // ---- what the page asks

  status(): DemoStatus {
    return {
      title: this.script.title,
      armed: this.armed,
      busy: this.busy,
      scripted: this.scripted,
      devices: this.deps.devices(),
      rounds: this.script.phases.map((phase) => ({ id: phase.id, state: this.playing.has(phase.id) ? 'playing' : (this.built.get(phase.id) ?? 'waiting') })),
      problem: this.problem,
      showcase: { on: this.showing, trees: this.shows.map(({ tree }) => ({ id: tree.id, title: tree.title, cards: tree.cards.length })) },
    };
  }

  /** The script as the page draws it: the chart, and each round with its line, its card and what it brings. */
  outline(): unknown {
    const titles = new Map<string, string>(this.script.phases.flatMap((phase) => phase.cards.map((card): [string, string] => [card.id, card.title])));
    return {
      title: this.script.title,
      topic: this.script.topic,
      chart: this.script.chart ?? null,
      rounds: this.script.phases.map((phase) => ({
        id: phase.id,
        chart: phase.chart ?? null,
        title: phase.title,
        say: phase.say,
        sayAlso: phase.sayAlso,
        do: phase.do,
        momo: phase.momo,
        offers: phase.offers,
        note: phase.note,
        ask: phase.ask ?? null,
        head: phase.head === 'root' ? null : { id: phase.head, title: titles.get(phase.head) ?? phase.head },
        cards: phase.cards.map((card) => ({ id: card.id, title: card.title, kind: card.kind, origin: card.origin, text: card.text, image: card.image ? (this.media.get(card.image)?.url ?? null) : null })),
      })),
    };
  }

  setScripted(on: boolean): void {
    this.scripted = on;
  }

  /**
   * Sets the tree up as it stands just before a round, and leaves that round the next to be played. `end` builds every round.
   * A set-up under way is ended where it is.
   */
  async goto(to: string): Promise<void> {
    const upTo = to === 'end' ? this.script.phases.length : this.script.phases.findIndex((phase) => phase.id === to);
    if (upTo < 0) throw new Error(`the script has no round called ${to}`);
    const take = ++this.take;
    const going = () => take === this.take;
    const target = this.script.phases[upTo];
    this.busy = target ? `Setting up for "${target.title}"` : 'Building the whole tree';
    this.problem = null;
    try {
      this.deps.forgetVoices();
      this.deps.pipeline.forget();
      for (const resume of [...this.waiting.values()].flatMap((set) => [...set])) resume();
      // With rounds to build, the tree stays and only its cards go: a headset keeps the tree it has standing, where a tree
      // deleted under it would be left behind as a cover on its desk. An empty stage has no tree at all.
      const gone = this.clear(upTo > 0);
      if (gone && this.deps.devices() > 0) await this.startAgain(going);
      if (!going()) return;
      this.round++;
      for (let n = 0; n < upTo && going(); n++) {
        this.busy = `${target ? `Setting up for "${target.title}"` : 'Building the whole tree'}: round ${n + 1} of ${upTo}`;
        await this.setUp(this.script.phases[n]!);
      }
      if (!going()) return;
      this.armed = upTo;
      // The view rests where the round begins: on the layer its card stands on, with that card not yet opened.
      const head = target && target.head !== 'root' ? this.nodes.get(target.head) : undefined;
      const lead = head ? this.deps.mind.nodes.get(head)?.parent : !target ? this.root : undefined;
      if (lead && this.deps.devices() > 0) this.deps.asDevice(() => this.deps.pipeline.go(lead));
      this.deps.log(`[demo] set up for ${target ? `"${target.title}"` : 'the end'}: ${this.nodes.size} cards in the tree`);
    } catch (err) {
      this.problem = err instanceof Error ? err.message : String(err);
      this.deps.log(`[demo] could not set up: ${this.problem}`);
      throw err;
    } finally {
      if (going()) this.busy = null;
    }
  }

  /**
   * A headset keeps a deleted tree standing, and keeps its cover once it is put away: the app is started again there, and the
   * set-up waits for it to join. Where that cannot be done, or fails, the page says what to do by hand.
   */
  private async startAgain(going: () => boolean): Promise<void> {
    if (!this.deps.restart) {
      this.problem = STALE;
      return;
    }
    this.busy = 'Starting the app again on the headset, which keeps showing a tree that is gone';
    const joined = this.hears(['joined'], this.pace.rejoin);
    try {
      this.deps.log(`[demo] ${await this.deps.restart()}`);
    } catch (err) {
      if (going()) this.problem = `${STALE} (it was not done from here: ${err instanceof Error ? err.message : String(err)})`;
      return;
    }
    if (!(await joined) && going()) this.problem = 'The app was started again on the headset, but it has not joined: run agents/demo/headset.sh';
  }

  /** Whether this service can start the headset's app again itself. Where it cannot (on Fly), the page says to do it by hand. */
  get restarts(): boolean {
    return Boolean(this.deps.restart);
  }

  /**
   * Plays the next round without a word said: its card is gone to, then the Scout is asked for more on it, which brings the round.
   * For a take where the voice is not wanted, and for when Momo answers a line without starting a search.
   */
  async play(): Promise<void> {
    this.problem = null;
    try {
      const phase = this.script.phases.slice(this.armed).find((p) => !this.built.has(p.id) && p.cards.length > 0);
      if (!phase) throw new Error('Every round is built: go to an earlier round to play again.');
      if (phase.head === 'root' && (!this.root || !this.deps.mind.nodes.has(this.root))) {
        // The tree's own first round follows from starting it, as it does when the user asks for a tree.
        await this.deps.asDevice(() => this.deps.pipeline.makeTree(this.script.topic));
        return;
      }
      const head = phase.head === 'root' ? this.root : this.nodes.get(phase.head);
      if (!head || !this.deps.mind.nodes.has(head)) throw new Error(`"${phase.title}" is asked from a card that is not in the tree yet: go to the round first.`);
      if (this.deps.devices() > 0) {
        const there = this.hears([`questions:${head}`, `focus:${head}`], this.pace.open);
        this.deps.asDevice(() => this.deps.pipeline.go(head));
        await there;
        await pause(this.pace.breath);
      }
      await this.deps.asDevice(() => this.deps.pipeline.more(head, phase.ask));
    } catch (err) {
      this.problem = err instanceof Error ? err.message : String(err);
      this.deps.log(`[demo] could not play: ${this.problem}`);
      throw err;
    }
  }

  /**
   * What Momo is told, with where the user is, about the card they have open: whether the next thing they say asks for the round
   * that waits on that card. A round with cards is a new layer on it; a round that brings nothing is answered aloud from it.
   */
  takeNote(focus: Id | undefined): string {
    if (!this.scripted || !focus) return '';
    const here = this.script.phases.filter(
      (phase) => !this.built.has(phase.id) && !this.playing.has(phase.id) && (phase.head === 'root' ? this.root === focus : this.nodes.get(phase.head) === focus),
    );
    if (here.length === 0) return '';
    return here.some((phase) => phase.cards.length > 0)
      ? '\nRecording: with this card open, the next thing the user says asks for a new layer on it.'
      : '\nRecording: with this card open, the next thing the user says is a question to answer aloud from this card.';
  }

  /**
   * A message from a headset. Two of them say where it has got to, and a set-up waits on them: `questions` for a card is sent
   * when the card opens there, and `focus` when the card leads its layer.
   */
  heard(message: { t: string; nodeId?: string }): void {
    if ((message.t !== 'focus' && message.t !== 'questions') || !message.nodeId) return;
    for (const resume of [...(this.waiting.get(`${message.t}:${message.nodeId}`) ?? [])]) resume();
  }

  // ---- the roles the demo takes over

  /** The Scout, scripted while rounds are left: the round the request fits, brought as a run brings its picks. */
  roles(): Roles {
    const real = this.deps.roles;
    return {
      ...real,
      scout: (ctx, input) => {
        const phase = this.scripted && !this.inShowcase(input.anchor) ? this.choose(input.anchor, input.need) : undefined;
        return phase ? this.bring(ctx, phase, input.anchor, input.deliver) : real.scout(ctx, input);
      },
      questions: async (ctx, input) => {
        // Under the card a round is asked from, the questions the script offers; anywhere else, the live ones.
        const title = plain(input.card.title);
        const offered = this.script.phases.find((phase) => !this.built.has(phase.id) && phase.offers.length > 0 && plain(this.titleOfHead(phase)) === title);
        if (offered) return offered.offers.slice(0, 4);
        return real.questions(ctx, input);
      },
      renderer: async (ctx, input) => {
        // The script's cards come with their looks. Anything else is the Renderer's as ever.
        const others = input.nodeIds.filter((id) => !/^(demo|show)-/.test(ctx.mind.nodes.get(id)?.itemId ?? ''));
        if (others.length === 0) {
          await pause(Math.min(600, this.pace.step / 2));
          return [];
        }
        return real.renderer(ctx, { ...input, nodeIds: others });
      },
    };
  }

  private titleOfHead(phase: ScriptPhase): string {
    if (phase.head === 'root') return this.root && this.deps.mind.nodes.has(this.root) ? this.deps.mind.itemOf(this.root).title : this.script.topic;
    for (const p of this.script.phases) for (const card of p.cards) if (card.id === phase.head) return card.title;
    return phase.head;
  }

  /**
   * The round a request plays.
   * 1. A question the script names plays its round, wherever it is asked.
   * 2. A request on the card a round is asked from plays that round, the earliest first. A round that brings nothing (Momo answers
   *    aloud from the open card) brings nothing here either.
   * 3. Any other request plays the next round in order, on the card it was asked on: the user is followed, not the script.
   */
  private choose(anchor: Id, need: string | undefined): ScriptPhase | undefined {
    const open = this.script.phases.filter((phase) => !this.built.has(phase.id) && !this.playing.has(phase.id));
    if (open.length === 0) return undefined;
    const asked = need ? open.find((phase) => phase.ask && plain(phase.ask) === plain(need)) : undefined;
    if (asked) return asked;
    const isRoot = this.deps.mind.nodes.get(anchor)?.parent === null;
    const here = open.filter((phase) => (phase.head === 'root' ? isRoot && (this.root === null || this.root === anchor || !this.deps.mind.nodes.has(this.root)) : this.nodes.get(phase.head) === anchor));
    const fits = here.find((phase) => phase.cards.length > 0 && !phase.ask) ?? here.find((phase) => phase.cards.length > 0);
    if (fits) return fits;
    if (here.length > 0) return here[0];
    const index = (phase: ScriptPhase) => this.script.phases.indexOf(phase);
    return open.find((phase) => index(phase) >= this.armed && phase.cards.length > 0 && phase.head !== 'root') ?? open.find((phase) => phase.cards.length > 0 && phase.head !== 'root');
  }

  /** One round played: the steps a Scout run shows, with the round's cards landing as its picks, the user's own things first. */
  private async bring(ctx: RoleContext, phase: ScriptPhase, anchor: Id, deliver?: (commands: Command[]) => void): Promise<Command[]> {
    this.playing.add(phase.id);
    this.deps.log(`[demo] playing "${phase.title}" under "${ctx.mind.itemOf(anchor).title}"`);
    const step = (label: string, ms: number) => ctx.step('scout', label, () => pause(ms), { nodeId: anchor });
    try {
      if (phase.head === 'root') {
        this.root = anchor;
        // The tree is named as a set-up names it, whatever words started it, so its cover reads the same after every take.
        const tree = ctx.mind.tree(ctx.mind.node(anchor).treeId);
        if (tree.title !== this.script.title) this.deps.pipeline.stage(DEMO, 'Demo: name the tree', [{ type: 'renameTree', id: tree.id, title: this.script.title }]);
      }
      const waves = wavesOf(phase);
      let rank = 0;
      let last: Command[] = [];
      if (waves.length > 0) await step('Choosing where to look first', this.pace.step * 0.6);
      else await step('Checking what you already have', this.pace.step);
      for (const [n, wave] of waves.entries()) {
        for (const label of wave.labels) await step(label, this.pace.step * wave.weight);
        const commands = this.commandsFor(ctx.mind, wave.cards, anchor, 'pick', rank);
        rank += wave.cards.length;
        if (n < waves.length - 1 && deliver) deliver(commands);
        else last = [...last, ...commands];
      }
      this.built.set(phase.id, 'played');
      const at = this.script.phases.indexOf(phase);
      if (at >= this.armed) this.armed = at + 1;
      while (this.armed < this.script.phases.length && this.built.has(this.script.phases[this.armed]!.id)) this.armed++;
      return last;
    } finally {
      this.playing.delete(phase.id);
    }
  }

  // ---- setting the tree up

  /** The trees this demo made, in this run or one before it: any that holds a card of the script. */
  private trees(): Id[] {
    const ids = new Set<Id>();
    for (const node of this.deps.mind.nodes.values()) if (node.itemId.startsWith('demo-')) ids.add(node.treeId);
    if (this.root && this.deps.mind.nodes.has(this.root)) ids.add(this.deps.mind.node(this.root).treeId);
    return [...ids];
  }

  /**
   * Takes the rounds out of the tree. `keep` leaves the tree and its first card standing; without it the tree goes too.
   * True when a tree was deleted.
   */
  private clear(keep: boolean): boolean {
    const { mind } = this.deps;
    const own = keep && this.root && mind.nodes.has(this.root) ? mind.node(this.root).treeId : null;
    const commands = this.trees().flatMap((id): Command[] => (id === own ? mind.children(this.root!).map((child): Command => ({ type: 'deleteNode', id: child.id })) : [{ type: 'deleteTree', id }]));
    if (commands.length > 0) this.deps.asDevice(() => this.deps.pipeline.stage(DEMO, 'Demo: clear the stage', commands));
    this.nodes.clear();
    this.built.clear();
    this.playing.clear();
    this.at = null;
    this.leading.clear();
    if (!own) this.root = null;
    this.armed = 0;
    return commands.some((command) => command.type === 'deleteTree');
  }

  /**
   * A headset joined. What it was sent on joining is the whole tree at once, which it cannot give its layers: the tree is set up
   * again for it, as it stands. Called when a connection says it is a headset.
   */
  joined(): void {
    for (const resume of [...(this.waiting.get('joined') ?? [])]) resume();
    if (this.busy || this.built.size === 0) return;
    const at = this.script.phases[this.armed]?.id ?? 'end';
    this.deps.log('[demo] a headset joined: setting the tree up again for it');
    setTimeout(() => void this.goto(at).catch(() => {}), 1200);
  }

  /** What a kept data folder holds of the tree: the cards that stand, and so which rounds are built. */
  private adopt(): void {
    const { mind } = this.deps;
    const byItem = new Map<string, Id>();
    for (const node of mind.nodes.values()) if (node.itemId.startsWith('demo-')) byItem.set(node.itemId, node.id);
    if (byItem.size === 0) return;
    const making = this.making;
    for (const phase of this.script.phases) {
      const there = phase.cards.filter((card) => byItem.has(itemOf(card, making).id));
      for (const card of there) this.nodes.set(card.id, byItem.get(itemOf(card, making).id)!);
      if (phase.cards.length > 0 && there.length === phase.cards.length) this.built.set(phase.id, 'built');
    }
    const any = [...this.nodes.values()][0];
    if (any) this.root = mind.tree(mind.node(any).treeId).rootId;
    this.armed = this.script.phases.findIndex((phase) => phase.cards.length > 0 && !this.built.has(phase.id));
    if (this.armed < 0) this.armed = this.script.phases.length;
    this.deps.log(`[demo] the data folder holds the tree with ${this.nodes.size} of its cards: the next round is ${this.script.phases[this.armed]?.title ?? 'none, it is whole'}`);
  }

  /** One round set up at once, its cards kept: the card it is asked from is gone to first, so a headset gives the round its layer. */
  private async setUp(phase: ScriptPhase): Promise<void> {
    const { mind, pipeline } = this.deps;
    const watched = this.deps.devices() > 0;
    let parent: Id;
    if (phase.head === 'root') {
      if (!this.root || !mind.nodes.has(this.root)) {
        const treeId = `demo-tree-${this.round}`;
        const rootId = `d${this.round}-root`;
        const item: Item = {
          id: `demo-root-${createHash('sha1').update(this.script.topic).digest('hex').slice(0, 8)}`,
          kind: 'text', title: this.script.topic, text: this.script.topic, summary: '', tags: [], data: {},
          source: { from: 'voice', capturedAt: new Date().toISOString() }, origin: { by: 'user' }, archived: false, revision: 0,
        };
        const root = nodeOf({ id: 'root', kind: 'note', origin: 'ocean', title: item.title, text: '' }, item, { id: rootId, treeId, parent: rootId, status: 'kept', order: 0, rank: 0 }, this.making);
        const commands: Command[] = [
          ...(mind.items.has(item.id) ? [] : [{ type: 'addItem', item } as Command]),
          { type: 'createTree', tree: { id: treeId, title: this.script.title, rootId, digest: '', createdAt: new Date().toISOString() }, root: { ...root, parent: null, why: '', origin: { by: 'user' }, importance: 1 } },
        ];
        // The tree stands on the headset that asked for it, and its first card leads the first layer: the headset says so.
        const stood = watched ? this.hears([`focus:${rootId}`], this.pace.stand) : null;
        this.deps.asDevice(() => pipeline.stage(DEMO, `Demo: start "${this.script.title}"`, commands));
        this.root = rootId;
        if (stood) this.deps.log(`[demo]   the tree ${(await stood) ? 'stands' : 'was not seen to stand in time'}`);
        if (watched) await pause(this.pace.breath);
      } else if (watched && this.at !== this.root) {
        // The tree was kept: the headset goes back to its first card, standing the tree again if it was put away.
        const there = this.hears([`questions:${this.root}`, `focus:${this.root}`], this.pace.open / 2);
        const root = this.root;
        this.deps.asDevice(() => pipeline.go(root));
        await there;
        await pause(this.pace.breath);
      }
      parent = this.root;
      this.at = parent;
      this.leading.add(parent);
    } else {
      const head = this.nodes.get(phase.head);
      if (!head || !mind.nodes.has(head)) throw new Error(`"${phase.title}" is asked from the card "${phase.head}", which is not in the tree`);
      parent = head;
      // The headset goes to the card and opens it, or goes to its layer when it leads one already. It is where it was last
      // taken when two rounds in a row are asked from one card, and then it says nothing new.
      if (watched && phase.cards.length > 0 && this.at !== parent) {
        const there = this.hears([`questions:${parent}`, `focus:${parent}`], this.pace.open);
        this.deps.asDevice(() => pipeline.go(parent));
        if (!(await there)) this.deps.log(`[demo]   the headset was not seen to open the card of "${phase.title}"`);
        await pause(this.pace.breath);
        this.at = parent;
      }
    }
    const commands = this.commandsFor(mind, phase.cards, parent, 'kept', 0);
    if (commands.length > 0) {
      // Cards that arrive round an open card make it lead a layer, which the headset tells once.
      const led = watched && !this.leading.has(parent) ? this.hears([`focus:${parent}`], this.pace.land) : null;
      this.deps.asDevice(() => pipeline.stage(DEMO, `Demo: ${phase.title}`, commands));
      if (led && !(await led)) this.deps.log(`[demo]   the headset was not seen to give "${phase.title}" its layer`);
      this.leading.add(parent);
      if (watched) await pause(this.pace.breath);
    }
    this.built.set(phase.id, 'built');
  }

  /** Resolves true when a headset says one of these things, or false after `ms`. */
  private hears(keys: string[], ms: number): Promise<boolean> {
    return new Promise((done) => {
      const end = (heard: boolean) => {
        clearTimeout(timer);
        for (const key of keys) {
          const set = this.waiting.get(key);
          set?.delete(resume);
          if (set?.size === 0) this.waiting.delete(key);
        }
        done(heard);
      };
      const resume = () => end(true);
      const timer = setTimeout(() => end(false), ms);
      for (const key of keys) this.waiting.set(key, (this.waiting.get(key) ?? new Set()).add(resume));
    });
  }

  /** The commands that hang these cards under `parent`. A card that is hung already is left as it is. */
  private commandsFor(mind: Mindstorm, cards: ScriptCard[], parent: Id, status: 'kept' | 'pick', rank: number): Command[] {
    const treeId = mind.node(parent).treeId;
    const order = mind.nextOrder(parent);
    const making = this.making;
    const commands: Command[] = [];
    let n = 0;
    for (const card of cards) {
      const standing = this.nodes.get(card.id);
      if (standing && mind.nodes.has(standing)) continue;
      const item = itemOf(card, making);
      if (!mind.items.has(item.id) && !commands.some((c) => c.type === 'addItem' && c.item.id === item.id)) commands.push({ type: 'addItem', item });
      const id = `d${this.round}-${card.id}`;
      commands.push({ type: 'addNode', node: nodeOf(card, item, { id, treeId, parent, status, order: order + n, rank: rank + n }, making) });
      this.nodes.set(card.id, id);
      n++;
    }
    return commands;
  }
}

interface Wave {
  /** The steps shown before the cards land. */
  labels: string[];
  /** How long each step lasts, as a share of the pace's step. */
  weight: number;
  cards: ScriptCard[];
}

/**
 * A round's cards in the order a Scout run brings them: what the user already has first, then what each source outside gave,
 * then what the agents made, each under the label the live Scout shows for that work.
 */
export function wavesOf(phase: ScriptPhase): Wave[] {
  const waves: Wave[] = [];
  const own = phase.cards.filter((card) => card.origin === 'ocean');
  if (own.length > 0) waves.push({ labels: ['Checking what you already have'], weight: 1, cards: own });
  const outside = phase.cards.filter((card) => card.origin === 'external');
  const bySource = new Map<string, ScriptCard[]>();
  for (const card of outside) {
    const source = card.kind === 'paper' ? 'research papers' : (sourceName(card) ?? 'the web');
    bySource.set(source, [...(bySource.get(source) ?? []), card]);
  }
  // A run searches a few sources, not a dozen: the largest keep their names, and the rest are the web's.
  const named = [...bySource].sort((a, b) => b[1].length - a[1].length);
  const kept = named.slice(0, 2);
  const rest = named.slice(2).flatMap(([, cards]) => cards);
  if (rest.length > 0) kept.push(['the web', rest]);
  for (const [source, cards] of kept) {
    waves.push({ labels: [`Searching ${source}`, `Reading ${cards.length} result${cards.length === 1 ? '' : 's'} from ${source}`], weight: 0.8, cards: outside.filter((card) => cards.includes(card)) });
  }
  const made = phase.cards.filter((card) => card.origin === 'generated');
  for (const card of made.slice(0, 1)) waves.push({ labels: [card.image ? `Making a picture of ${card.title}`.slice(0, 60) : 'Writing an idea down'], weight: 1.2, cards: made });
  return waves;
}

/** The source's name as a step would say it: short, and a museum by its own name. */
function sourceName(card: ScriptCard): string | undefined {
  const from = (card.from ?? card.holder ?? '').replace(/,? via .*$/i, '').replace(/,.*$/, '').trim();
  if (!from) return undefined;
  if (/wikimedia|commons/i.test(from)) return 'Wikimedia Commons';
  return from.length <= 34 ? from : undefined;
}

function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve();
}
