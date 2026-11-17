import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Command, Id, Item, Origin } from '../core/domain.ts';
import type { Pipeline } from '../core/pipeline.ts';
import type { Assets } from '../core/ports.ts';
import type { RoleContext, Roles } from '../core/roles/types.ts';
import type { Mindstorm } from '../core/state.ts';
import type { VoiceFrame } from '../node/live.ts';
import { itemOf, nodeOf, type Making } from './cards.ts';
import type { Lines, LineShown } from './lines.ts';
import type { Voice } from './momo-voice.ts';
import type { DemoScript, ScriptCard, ScriptPhase } from './script.ts';
import { inLayers, layersOf, type Showcase } from './showcase.ts';
import { layingOut } from './real-pace.ts';
import { momentAt, takeOf, type Mode, type Take, type TimedLine } from './take.ts';

/**
 * The demo: one prepared tree, grown round by round.
 *
 * - Going to a round sets the tree up as it stands just before that round: every earlier round built, its cards kept. A headset is
 *   taken through the rounds in order, each card opened before its cards are added, because a headset makes its layers itself from
 *   what is asked on it, and cards that all arrive at once land on one layer.
 * - Playing a round is the Scout's work, scripted, as one take (`take.ts`): a fixed timeline of the labels the agents show, the
 *   cards that land and what Momo says, each at the moment it would come in a real round. The page's Play, or the round's line
 *   said in the headset, runs it; it can be paused, and moved to any moment, where the tree is made to stand as it stood then.
 *
 * Nothing of the live system is changed by it but what the Scout brings, the questions offered under a round's card, the
 * Renderer, which is given nothing to choose because each card comes with its look, and Momo's voice, which says the take's
 * written lines from their recordings in place of words of her own.
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
  /** How fast a take's clock runs: 1 is the pace of a real round. Tests run it faster. */
  rate: number;
  /** The longest wait for the app to join again after it is started again on the headset. */
  rejoin: number;
  /** How long the daily tree takes to grow, from its first card to its last layer. */
  grow: number;
  /** How long after a headset joins, or is put on again, the daily tree starts to grow, once Momo's message is sent. */
  growAfterJoin: number;
  /** The shortest time off that counts as the headset taken off and put on again: its menu leaves the app for a moment too. */
  wornAway: number;
}

export const PACE: Pace = { stand: 9000, open: 4000, land: 3000, breath: 220, step: 1500, rate: 1, rejoin: 25000, grow: 5000, growAfterJoin: 2000, wornAway: 5000 };

/**
 * The daily tree shot of the film, in the user's words: Momo's message on the phone, and then, with the headset on, one of the
 * showcase trees grows anew and she says the line. Both are these words.
 */
export const DAILY_WORDS = 'Hi there! I grew a new tree today on the topics you love!';
/** The showcase tree the daily tree is unless the page picks another: the user's "rightmost tree", by the lead's reading. */
export const DAILY_TREE = 'constellations';

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
  /** What Momo says in each round, written down, with its recordings. */
  lines: Lines;
  /** Sends the headset a piece of Momo's voice, as the live voice does. False when no headset has its voice open. */
  momo?: (frame: VoiceFrame) => boolean;
  /**
   * Starts the app again on the headset, joined to this service as before, and resolves with a line for the log. A headset
   * keeps a tree standing after the service deletes it, so this is the only way to an empty stage there. Absent where the host
   * cannot do it; then the page says to do it by hand.
   */
  restart?: () => Promise<string>;
  /**
   * The person's own contact (their Telegram): whether an account is paired with this service, and a message of the service's
   * own sent to it, true once it was taken. Absent where the service reads no bot.
   */
  owner?: { paired: () => boolean; tell: (text: string) => Promise<boolean> };
  /** Whether the work under way came from the person's own contact (their Telegram), not from the headset or the page. */
  fromContact?: () => boolean;
  log: (line: string) => void;
  pace?: Partial<Pace>;
}

/**
 * What Momo is told beside her own instructions while the demo runs. Her words stay her own: this only makes a request a take,
 * so a line of the walkthrough starts a search without a question back. Which card a round waits on she is told with where the
 * user is (`takeNote`), since by her own rules a question gets an answer and no cards, and half the walkthrough's lines are questions.
 */
export const momoNote = (script: DemoScript) => `# Recording a walkthrough
The user is recording a walkthrough of one tree, and each thing they say is a take. Your words for each take are written and recorded already, and the recording is played for you. So, only here:
- With no tree open, "let's jam on…", "let's brainstorm…" or a subject alone asks for a tree: call start_tree with the subject at once, ask nothing, and say nothing yourself. The walkthrough's own subject is "${script.topic}": when that is what they mean, in whatever words, give start_tree exactly those words.
- A [Where the user is] note may end with a line that begins "Recording:". It says what the next thing the user says asks for with that card open, and it comes before the rules above. When it says a new layer: call find_new on the open card at once, their words as the need, even when they put it as a question, a reaction or a single word ("So which ones do we keep?", "that's cool, but…", "Layers?"), ask nothing back and say nothing yourself. Only "more of this" and "more like this" stay more_like_this. When it says to answer aloud: say nothing and call no tool, because your answer is recorded.
- With no such line, everything is as above.
- A round here lands many cards at once. At [More cards landed] with more than two cards, never say their titles one after another: say how many came and name the one you like best, in one short line.`;

/**
 * The pace takes are loaded at before one is chosen on the page, and so the pace a line said in the headset starts then. One of
 * the choices that are the user's to make.
 */
export const SPOKEN_FIRST: Mode = 'fast';

/** What a set-up round is recorded as: never the user's doing, so an undo does not take one back. */
const DEMO: Origin = { by: 'user', role: 'demo' };
/** The daily tree's layers, which arrive on a headset as an agent's cards do: one after another, a note each. */
const GROWN: Origin = { by: 'agent', role: 'demo' };
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
  /** The take the bar shows: its round, how long it is, where it is, and whether it is running. Null before any round was played or moved in. */
  take: { round: string; ms: number; at: number; playing: boolean } | null;
  /** The pace takes are loaded at: `fast`, or `real` for the pace of a real round. */
  mode: Mode;
  /** Lines of Momo's being recorded now, and how many lines hold the user's own words. */
  lines: { recording: number; edited: number };
  /**
   * The daily tree: the showcase tree it can be, which one is armed (taken out of the forest, to grow again), whether Momo's
   * message went to the phone, whether it has grown, whether a headset joining or put on again will still start it, and whether
   * this service can send the message at all.
   */
  daily: { trees: { id: string; title: string }[]; armed: string | null; sent: boolean; grown: boolean; onJoin: boolean; canSend: boolean };
}

/** A take as the page draws it: the timeline, with each of Momo's lines as it is written and whether its recording exists. */
export interface TakeShown extends Take {
  /**
   * `voice`: the voice the line's recording is in, or null while it has none. `closest`: for a line Momo did not say as
   * written, the closest wording she did say; such a line is not ready, and that take of hers plays for it until it is.
   */
  lines: (TimedLine & Pick<LineShown, 'written' | 'edited'> & { recorded: boolean; voice: Voice | null; closest: string | null })[];
}

/** A take that is running. */
interface Rolling {
  phase: ScriptPhase;
  take: Take;
  /** Where the take is now, in its own ms. */
  now: () => number;
  /** Ends it where it is. */
  stop: () => void;
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
  /** The take that is running, and where the last one was left: paused, moved to, or over. */
  private rolling: Rolling | null = null;
  private cursor: { round: string; ms: number } | null = null;
  /** The pace takes are loaded at: the one last chosen on the page. A line said in the headset starts a take at it. */
  private mode: Mode = SPOKEN_FIRST;
  /** The take the Scout is about to be asked for, from the page: its round, and the moment it starts from. */
  private pending: { phase: string; from: number } | null = null;
  /** The labels held up at a moment the take is paused on, each ended by calling it. */
  private held: (() => void)[] = [];
  /** The round the user's next words ask for, as Momo was last told with where they are. */
  private listening: { phase: ScriptPhase; at: number } | null = null;
  /** Until when Momo is told nothing of what a take did, so the run's end is not told in words of her own. */
  private quiet = 0;
  private plays = 0;
  /** The newest move asked for: an older one still waiting gives way to it. */
  private moves = 0;
  private moving: Promise<void> = Promise.resolve();
  /** Trees started from the person's contact: no round of the script plays under them (the user's choice, 2026-11-17). */
  private outside = new Set<Id>();
  /** The daily tree once armed: which showcase tree, whether Momo's message went, whether it grew, and whether a join started it. */
  private daily: { tree: string; sent: boolean; grown: boolean; auto: boolean } | null = null;

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
    const outside = join(this.deps.dataDir, 'demo-outside.json');
    if (existsSync(outside)) this.outside = new Set(JSON.parse(readFileSync(outside, 'utf8')) as Id[]);
    const daily = join(this.deps.dataDir, 'demo-daily.json');
    if (existsSync(daily)) this.daily = JSON.parse(readFileSync(daily, 'utf8')) as typeof this.daily;
    this.plant();
  }

  /**
   * Whether the Scout here is the real one: a tree started from the person's contact is theirs, grown as their own service grows it,
   * and never takes a round of the script, then or later. Such a tree is known by its root, asked for in the contact's work.
   */
  private outsideScript(anchor: Id): boolean {
    const node = this.deps.mind.nodes.get(anchor);
    if (!node) return false;
    if (node.parent === null && this.deps.fromContact?.() && !this.outside.has(node.treeId)) {
      this.outside.add(node.treeId);
      writeFileSync(join(this.deps.dataDir, 'demo-outside.json'), JSON.stringify([...this.outside]));
    }
    return this.outside.has(node.treeId);
  }

  /** Resolves once no take is playing: what the person's contact sends meanwhile waits for it (the user's choice, 2026-11-17). */
  async untilTaken(): Promise<void> {
    while (this.directing()) await pause(250);
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
    // The daily tree, once armed, stays out of the forest until it grows.
    const held = this.daily && !this.daily.grown ? this.daily.tree : null;
    const wanted = new Map(this.showing ? this.shows.filter((show) => show.tree.id !== held).map((show): [Id, Showcase] => [this.showId(show), show]) : []);
    const gone = [...mind.trees.keys()].filter((id) => id.startsWith('show-') && !wanted.has(id));
    if (gone.length > 0) this.deps.asDevice(() => pipeline.stage(DEMO, 'Demo: take the showcase trees down', gone.map((id): Command => ({ type: 'deleteTree', id }))));
    let n = 0;
    for (const [treeId, show] of wanted) {
      n++;
      if (mind.trees.has(treeId)) continue;
      // The trees are a few minutes apart, the first written the oldest, so the forest orders them the same way each time.
      const { first, layers } = this.planting(show, new Date(Date.now() - (this.shows.length - n + 1) * 60_000).toISOString());
      // Planted as nobody's request: a headset puts such a tree away on its desk, where one it asked for would stand.
      pipeline.stage(DEMO, `Demo: the showcase tree "${show.tree.title}"`, [...first, ...layers.flat()]);
      this.deps.log(`[demo] the showcase tree "${show.tree.title}" stands in the forest: ${show.tree.cards.length} cards`);
    }
    return gone.length > 0;
  }

  /**
   * A showcase tree as commands: its first card with the tree, made at `at`, and then each layer of its cards, kept, in order.
   * Each item is added with the first command that needs it.
   */
  private planting(show: Showcase, at: string): { first: Command[]; layers: Command[][] } {
    const { mind } = this.deps;
    const { tree } = show;
    const treeId = this.showId(show);
    const set = `show-${tree.id}`;
    const making: Making = { ...this.making, media: (file) => this.media.get(`${tree.id}/${file}`) };
    const rootId = `${treeId}-root`;
    const top: Item = {
      id: `${set}-root-${createHash('sha1').update(tree.topic).digest('hex').slice(0, 8)}`,
      kind: 'text', title: tree.topic, text: tree.topic, summary: '', tags: [], data: {},
      source: { from: 'voice', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0,
    };
    const root = nodeOf({ id: 'root', kind: 'note', origin: 'ocean', title: top.title, text: '' }, top, { id: rootId, treeId, parent: rootId, status: 'kept', order: 0, rank: 0 }, making);
    const first: Command[] = [
      ...(mind.items.has(top.id) ? [] : [{ type: 'addItem', item: top } as Command]),
      { type: 'createTree', tree: { id: treeId, title: tree.title, rootId, digest: '', createdAt: at }, root: { ...root, parent: null, why: '', origin: { by: 'user' }, importance: 1 } },
    ];
    const added = new Set<string>();
    const placed = new Map<string, number>();
    const layers = layersOf(tree).map((cards) =>
      cards.flatMap((card): Command[] => {
        const item = itemOf(card, making, set);
        const adding: Command[] = mind.items.has(item.id) || added.has(item.id) ? [] : [{ type: 'addItem', item }];
        added.add(item.id);
        const parent = card.parent === 'root' ? rootId : `${treeId}-${card.parent}`;
        const order = placed.get(parent) ?? 0;
        placed.set(parent, order + 1);
        return [...adding, { type: 'addNode', node: nodeOf(card, item, { id: `${treeId}-${card.id}`, treeId, parent, status: 'kept', order, rank: order }, making) }];
      }),
    );
    return { first, layers };
  }

  // ---- the daily tree

  private keepDaily(): void {
    writeFileSync(join(this.deps.dataDir, 'demo-daily.json'), JSON.stringify(this.daily));
  }

  /**
   * Arms the daily tree: the showcase tree named is taken out of the forest, to grow again, and the other trees stand. Arming
   * again is a new take: the tree is taken down whether it grew or not, and a tree armed before comes back. A headset keeps a
   * tree that is gone, so it is started again, as for the showcase switch.
   */
  async armDaily(tree: string = DAILY_TREE): Promise<void> {
    this.problem = null;
    if (!this.shows.some((show) => show.tree.id === tree)) this.refuse(`There is no showcase tree called ${tree}.`);
    if (!this.showing) this.refuse('The other trees are switched off, and the daily tree is one of them: switch them on first.');
    this.daily = { tree, sent: false, grown: false, auto: false };
    this.keepDaily();
    this.deps.log(`[demo] the daily tree is armed: "${this.titleOfShow(tree)}" is out of the forest until it grows`);
    if (this.plant() && this.deps.devices() > 0) {
      this.busy = 'Starting the app again on the headset, which keeps showing the tree that was taken out';
      try {
        await this.startAgain(() => true);
      } finally {
        this.busy = null;
      }
    }
  }

  /** Momo's message about the daily tree goes to the person's phone, through their own bot. */
  async sendDaily(): Promise<void> {
    const daily = this.daily;
    this.problem = null;
    if (!daily) this.refuse('Arm the daily tree first.');
    const { owner } = this.deps;
    if (!owner?.paired()) this.refuse("Momo's message cannot be sent: no Telegram account is paired with this service.");
    if (!(await owner.tell(DAILY_WORDS))) this.refuse("Telegram did not take Momo's message: the service's log says why. Press Send again.");
    daily.sent = true;
    this.keepDaily();
    this.deps.log("[demo] Momo's daily tree message went to the paired phone");
  }

  /**
   * Grows the daily tree: its first card stands as a tree the headset asked for, so it stands in front of the user and not on the
   * desk, and its layers land after it, kept, on a fixed timetable over `pace.grow`. Momo says her line from its recording as it
   * begins, and is told nothing of the growing, so no remark of her own talks over it; no agent is at work, so no status shows.
   */
  async growDaily(): Promise<void> {
    const daily = this.daily;
    if (!daily) this.refuse('Arm the daily tree first.');
    const show = this.shows.find((s) => s.tree.id === daily.tree);
    if (!show) this.refuse(`The daily tree "${daily.tree}" is no longer among the showcase trees: arm another.`);
    if (!this.showing) this.refuse('The other trees are switched off, and the daily tree is one of them: switch them on first.');
    const treeId = this.showId(show);
    if (daily.grown || this.deps.mind.trees.has(treeId)) this.refuse(`"${show.tree.title}" has grown already: arm it again for another take.`);
    daily.grown = true;
    daily.auto = true;
    this.keepDaily();
    this.problem = null;
    const { title } = show.tree;
    this.busy = `"${title}" grows on the headset`;
    // Momo is told nothing of the growing, so no remark of hers talks over her line, until a moment after it ends.
    this.quiet = Number.POSITIVE_INFINITY;
    let said = Date.now();
    const spoken = this.deps.lines.ms(DAILY_WORDS);
    try {
      const { first, layers } = this.planting(show, new Date().toISOString());
      const { pipeline } = this.deps;
      // A headset stands a tree it asked for once the one standing is put away, and says so: the cards wait for that, since a
      // card that lands on a tree that is not standing is simply there when it stands.
      const rootId = `${treeId}-root`;
      const stood = this.deps.devices() > 0 ? this.hears([`focus:${rootId}`], this.pace.stand) : null;
      this.deps.asDevice(() => pipeline.stage(DEMO, `Demo: Momo grew "${title}" today`, first));
      if (stood && !(await stood)) this.deps.log(`[demo] "${title}" was not seen to stand in time: it grows anyway`);
      said = Date.now();
      void this.say(++this.plays, { id: 'daily', kind: 'answer', cards: [], text: DAILY_WORDS, at: 0, ms: spoken }, 0, 1, () => this.daily !== daily);
      for (const [n, layer] of layers.entries()) {
        await pause(this.pace.grow / layers.length);
        if (this.daily !== daily) return;
        this.deps.asDevice(() => pipeline.stage(GROWN, `Demo: "${title}" grows, layer ${n + 1} of ${layers.length}`, layer));
      }
      this.deps.log(`[demo] the daily tree "${title}" grew: ${show.tree.cards.length} cards in ${layers.length} layers`);
    } finally {
      this.quiet = Math.max(Date.now(), said + spoken) + 500;
      this.busy = null;
    }
  }

  /** Says on the page why what was asked is not done, and stops. */
  private refuse(why: string): never {
    this.problem = why;
    throw new Error(why);
  }

  private titleOfShow(id: string): string {
    return this.shows.find((show) => show.tree.id === id)?.tree.title ?? id;
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
      take: this.rolling
        ? { round: this.rolling.phase.id, ms: this.rolling.take.ms, at: Math.round(Math.min(this.rolling.now(), this.rolling.take.ms)), playing: true }
        : this.cursor
          ? { round: this.cursor.round, ms: this.timeline(this.cursor.round).ms, at: Math.round(this.cursor.ms), playing: false }
          : null,
      mode: this.mode,
      lines: { recording: this.deps.lines.busy, edited: this.deps.lines.edited },
      daily: {
        trees: this.shows.map(({ tree }) => ({ id: tree.id, title: tree.title })),
        armed: this.daily?.tree ?? null,
        sent: this.daily?.sent ?? false,
        grown: this.daily?.grown ?? false,
        onJoin: Boolean(this.daily?.sent && !this.daily.grown && !this.daily.auto),
        canSend: this.deps.owner?.paired() ?? false,
      },
    };
  }

  private phase(id: string): ScriptPhase {
    const phase = this.script.phases.find((p) => p.id === id);
    if (!phase) throw new Error(`the script has no round called ${id}`);
    return phase;
  }

  /** A round's take as it would play now: the user's words where they wrote any, each line as long as its recording. */
  private timeline(round: string, mode: Mode = this.mode): Take {
    const { lines } = this.deps;
    const phase = this.phase(round);
    return takeOf(phase, lines.of(round, mode), (text) => lines.ms(text), this.titleOfHead(phase), mode);
  }

  /**
   * Loads takes at a pace. A take that is running is ended, and the bar goes back to the start, since a moment of one pace's
   * take is not a moment of the other's.
   */
  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    if (this.rolling) this.deps.pipeline.forget();
    this.halt();
    this.cursor = null;
    this.mode = mode;
    this.deps.log(`[demo] takes are loaded at ${mode === 'real' ? 'real pace' : 'the fast pace'}`);
  }

  /** The lines as they are said now, as a `lines.json` to put in the repository. */
  linesFile(): unknown {
    return this.deps.lines.file();
  }

  /** A round's take for the page. */
  shown(round: string, mode: Mode = this.mode): TakeShown {
    const { lines } = this.deps;
    const take = this.timeline(round, mode);
    const shown = new Map(lines.of(round, mode).map((line): [string, LineShown] => [line.id, line]));
    return { ...take, lines: take.lines.map((line) => ({ ...line, written: shown.get(line.id)!.written, edited: shown.get(line.id)!.edited, recorded: lines.recorded(line.text), voice: lines.voice(line.text), closest: lines.closest(line.text) })) };
  }

  /**
   * Writes the user's words over one of Momo's lines, or with `null` goes back to her own, and has the new words recorded. A take
   * that is running goes on with the words it began with.
   */
  setLine(round: string, line: string, text: string | null, mode: Mode = this.mode): TakeShown {
    this.phase(round);
    if (!this.deps.lines.edit(round, line, text, mode)) throw new Error(`round ${round} has no line called ${line}`);
    for (const said of this.deps.lines.of(round, mode)) {
      // Writing a line, even the same words again, has her try it afresh.
      if (said.id === line) this.deps.lines.again(said.text);
      void this.deps.lines.audio(said.text, said.kind);
    }
    return this.shown(round, mode);
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
      this.halt();
      this.cursor = null;
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

  // ---- a round as a take

  /** Ends the take that is running where it is, and takes down the labels held at a paused moment. */
  private halt(): void {
    this.pending = null;
    this.rolling?.stop();
    for (const end of this.held.splice(0)) end();
  }

  /**
   * Whether the tree stands as a round's take needs: every round before it built, and none after it. A take played anywhere
   * else would hang its cards among the wrong ones.
   */
  private ready(phase: ScriptPhase): void {
    const at = this.script.phases.indexOf(phase);
    const before = this.script.phases.slice(0, at).find((p) => p.cards.length > 0 && !this.built.has(p.id));
    const after = this.script.phases.slice(at + 1).find((p) => p.cards.length > 0 && this.built.has(p.id));
    if (before || after) throw new Error(`The tree is not set up for "${phase.title}": press Go to this round first.`);
  }

  private headOf(phase: ScriptPhase): Id | null {
    const head = phase.head === 'root' ? this.root : this.nodes.get(phase.head);
    return head && this.deps.mind.nodes.has(head) ? head : null;
  }

  /**
   * Plays a round's take on the headset from a moment of it: the scene, Momo's voice and the agents' labels together, at the
   * pace of a real round. With no round named it is the one the bar is on, or the next. With no moment named it goes on from
   * where the bar is, or from the start when the take was over.
   */
  async playTake(round?: string, from?: number): Promise<void> {
    this.problem = null;
    try {
      const phase = round ? this.phase(round) : this.cursor ? this.phase(this.cursor.round) : this.script.phases.slice(this.armed).find((p) => !this.built.has(p.id));
      if (!phase) throw new Error('Every round is built: go to an earlier round to play again.');
      this.ready(phase);
      const take = this.timeline(phase.id);
      let at = Math.max(0, Math.min(from ?? (this.cursor?.round === phase.id ? this.cursor.ms : 0), take.ms));
      if (at >= take.ms - 50) at = 0;
      this.halt();
      // Every line is recorded before the take begins, so none starts late for want of its recording.
      await Promise.all(take.lines.map((line) => this.deps.lines.audio(line.text, line.kind)));
      if (phase.head === 'root' && !this.headOf(phase)) {
        // The tree's own first round follows from starting it, as it does when the user asks for a tree.
        this.pending = { phase: phase.id, from: 0 };
        await this.deps.asDevice(() => this.deps.pipeline.makeTree(this.script.topic));
        return;
      }
      const head = await this.stand(phase, take, at);
      // A take with no run in it, or taken up after its run is over, is Momo alone: no Scout is asked, so none is shown at work.
      if (phase.cards.length === 0 || at >= take.end) {
        await this.roll(this.deps.pipeline.ctx, phase, head, undefined, at);
        return;
      }
      this.pending = { phase: phase.id, from: at };
      await this.deps.asDevice(() => this.deps.pipeline.more(head, phase.ask));
    } catch (err) {
      this.pending = null;
      this.problem = err instanceof Error ? err.message : String(err);
      this.deps.log(`[demo] could not play: ${this.problem}`);
      throw err;
    }
  }

  /**
   * Stops the take where it is, and leaves it there as a move to that moment would: a delivery whose time had just come is
   * landed, so the tree is exactly that moment's, with that moment's labels.
   */
  async pause(): Promise<void> {
    const was = this.rolling;
    if (!was) return;
    this.halt();
    // The run the take rode on is over without a word: what it would announce is not said.
    this.deps.pipeline.forget();
    if (this.cursor) await this.seek(was.phase.id, this.cursor.ms);
  }

  /**
   * Moves a round's take to a moment, as dragging a film's bar does, and leaves it paused there: the cards that had landed by
   * then stand, later ones are taken away, and the labels are that moment's. Moves asked for while one is under way are done in
   * order, and only the newest of those waiting is done.
   */
  seek(round: string, ms: number): Promise<void> {
    const phase = this.phase(round);
    const move = ++this.moves;
    this.moving = this.moving
      .catch(() => {})
      .then(async () => {
        if (move !== this.moves) return;
        this.problem = null;
        try {
          this.ready(phase);
          if (this.rolling) this.deps.pipeline.forget();
          this.halt();
          const take = this.timeline(phase.id);
          const at = Math.max(0, Math.min(ms, take.ms));
          this.cursor = { round: phase.id, ms: Math.round(at) };
          if (phase.head === 'root' && !this.headOf(phase)) return;
          this.hold(take, at, await this.stand(phase, take, at));
        } catch (err) {
          this.problem = err instanceof Error ? err.message : String(err);
          throw err;
        }
      });
    return this.moving;
  }

  /**
   * Makes the tree stand as it does at one moment of a take: the headset on the round's card, the cards that have landed by then
   * hung on it as suggestions, and those that land later taken away. Returns the round's card.
   */
  private async stand(phase: ScriptPhase, take: Take, ms: number): Promise<Id> {
    const { mind, pipeline } = this.deps;
    const head = this.headOf(phase);
    if (!head) throw new Error(`"${phase.title}" is asked from a card that is not in the tree yet: press Go to this round first.`);
    if (this.deps.devices() > 0 && this.at !== head) {
      const there = this.hears([`questions:${head}`, `focus:${head}`], this.pace.open);
      this.deps.asDevice(() => pipeline.go(head));
      await there;
      await pause(this.pace.breath);
      this.at = head;
    }
    const landed = new Set(momentAt(take, ms).cards);
    const early: Command[] = [];
    for (const card of phase.cards) {
      const node = this.nodes.get(card.id);
      if (landed.has(card.id) || !node) continue;
      this.nodes.delete(card.id);
      if (mind.nodes.has(node)) early.push({ type: 'deleteNode', id: node });
    }
    if (early.length > 0) this.deps.asDevice(() => pipeline.stage(DEMO, 'Demo: back in the take', early));
    const order = take.drops.flatMap((drop) => drop.cards);
    const due = phase.cards.filter((card) => landed.has(card.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const late = this.commandsFor(mind, due, head, 'pick', 0);
    if (late.length > 0) this.deps.asDevice(() => pipeline.stage(DEMO, 'Demo: on in the take', late));
    this.mark(phase);
    return head;
  }

  /** A round counts as played once all its cards stand, and as waiting again once one is taken back. */
  private mark(phase: ScriptPhase, over = false): void {
    const at = this.script.phases.indexOf(phase);
    const whole = phase.cards.length > 0 ? phase.cards.every((card) => this.nodes.has(card.id)) : over;
    if (whole) {
      this.built.set(phase.id, 'played');
      if (at >= this.armed) this.armed = at + 1;
      while (this.armed < this.script.phases.length && this.built.has(this.script.phases[this.armed]!.id)) this.armed++;
    } else {
      this.built.delete(phase.id);
      this.armed = Math.min(this.armed, at);
    }
  }

  /** Shows the labels of one moment for as long as the take rests there. */
  private hold(take: Take, ms: number, head: Id): void {
    for (const step of momentAt(take, ms).steps) {
      if (step.role === 'renderer') continue;
      void this.deps.pipeline.ctx.step('scout', step.label, () => new Promise<void>((end) => this.held.push(end)), { nodeId: head }).catch(() => {});
    }
  }

  /**
   * One take running, from a moment of it: each label shown from its start to its end, each delivery of cards landed as the
   * run's picks, and each of Momo's lines said, all on the take's own clock. Resolves when the take is over or is stopped.
   */
  private roll(ctx: RoleContext, phase: ScriptPhase, anchor: Id, deliver: ((commands: Command[]) => void) | undefined, from: number): Promise<Command[]> {
    this.halt();
    const take = this.timeline(phase.id);
    const play = ++this.plays;
    const rate = Math.max(0.01, this.pace.rate);
    const wall = Date.now();
    const now = () => from + (Date.now() - wall) * rate;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const ends = new Set<() => void>();
    let stopped = false;
    /** Stopped before its end: only then is a line Momo is in cut short. */
    let cut = false;
    let finish!: () => void;
    const over = new Promise<void>((done) => (finish = done));
    /** The Scout's run within the take: over once the last card has landed, so its own label goes before Momo wraps up. */
    let ranOut!: () => void;
    const ran = new Promise<void>((done) => (ranOut = done));
    const at = (ms: number, act: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!stopped) act();
      }, Math.max(0, (ms - now()) / rate));
      timers.add(timer);
    };
    const end = (ms: number) => {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      for (const done of ends) done();
      this.cursor = { round: phase.id, ms: Math.round(Math.max(0, Math.min(ms, take.ms))) };
      this.rolling = null;
      this.playing.delete(phase.id);
      this.quiet = Date.now() + 500;
      ranOut();
      finish();
    };
    this.rolling = {
      phase, take, now,
      stop: () => {
        cut = true;
        end(now());
      },
    };
    this.pending = null;
    this.listening = null;
    this.cursor = null;
    this.playing.add(phase.id);
    this.deps.log(`[demo] playing "${phase.title}" under "${ctx.mind.itemOf(anchor).title}" from ${(from / 1000).toFixed(1)} of ${(take.ms / 1000).toFixed(1)} s`);
    if (phase.head === 'root') {
      this.root = anchor;
      // The tree is named as a set-up names it, whatever words started it, so its cover reads the same after every take.
      const tree = ctx.mind.tree(ctx.mind.node(anchor).treeId);
      if (tree.title !== this.script.title) this.deps.pipeline.stage(DEMO, 'Demo: name the tree', [{ type: 'renameTree', id: tree.id, title: this.script.title }]);
    }

    for (const step of take.steps) {
      // The Renderer's label is the pipeline's own, shown when a delivery lands.
      if (step.role === 'renderer' || step.end <= from) continue;
      at(step.at, () => {
        const shown = new Promise<void>((done) => {
          ends.add(done);
          at(step.end, done);
        });
        void ctx.step('scout', step.label, () => shown, { nodeId: anchor }).catch(() => {});
      });
    }
    let rank = take.drops.filter((drop) => drop.at <= from).reduce((n, drop) => n + drop.cards.length, 0);
    for (const drop of take.drops) {
      if (drop.at <= from) continue;
      const cards = drop.cards.map((id) => phase.cards.find((card) => card.id === id)!);
      const first = rank;
      rank += cards.length;
      at(drop.at, () => {
        const commands = this.commandsFor(ctx.mind, cards, anchor, 'pick', first);
        if (deliver) deliver(commands);
        else if (commands.length > 0) this.deps.pipeline.stage(DEMO, `Demo: ${phase.title}`, commands);
        this.mark(phase);
      });
    }
    for (const line of take.lines) {
      if (line.ms === 0 || line.at + line.ms <= from) continue;
      at(line.at, () => void this.say(play, line, Math.max(0, from - line.at), rate, () => cut));
    }
    at(take.end, ranOut);
    at(take.ms, () => {
      this.mark(phase, true);
      end(take.ms);
    });
    // Asked for as a Scout's run, the take hands the run back when its cards are in; asked for by itself, it is awaited whole.
    return (deliver ? ran : over).then(() => []);
  }

  /**
   * One of Momo's lines said on the headset from its recording: its words for the caption, then its sound a tenth of a second
   * at a time, kept a quarter of a second ahead of the clock, so a take that is stopped falls silent at once.
   */
  private async say(play: number, line: TimedLine, offset: number, rate: number, stopped: () => boolean): Promise<void> {
    const send = this.deps.momo;
    if (!send) return;
    const id = `take-${play}-${line.id}`;
    // The caption is what is heard: for a line that is not ready, the wording of her closest take.
    const text = this.deps.lines.closest(line.text) ?? line.text;
    const kind = line.kind === 'answer' ? 'reply' : 'results';
    const pcm = await this.deps.lines.audio(line.text, line.kind);
    // The headset shows a line's words as it hears them. A live reply's sound comes well ahead of its playing, so the share played
    // of what has come is the share of the line; a recording goes a quarter of a second ahead, so it is told the recording's
    // whole length and where in it the sound starts, and shows the share of that.
    const from = pcm ? Math.floor((offset * BYTES_PER_MS) / 2) * 2 : 0;
    if (!send(pcm ? { t: 'text', id, text, kind, ms: Math.round(pcm.length / BYTES_PER_MS), from: Math.round(from / BYTES_PER_MS) } : { t: 'text', id, text, kind })) return;
    if (pcm) {
      const piece = BYTES_PER_MS * 100;
      const began = Date.now();
      for (let at = from; at < pcm.length && !stopped(); at += piece) {
        send({ t: 'audio', id, pcm: Buffer.from(pcm.subarray(at, at + piece)).toString('base64') });
        const ahead = (at + piece) / BYTES_PER_MS - offset - (Date.now() - began) * rate;
        if (ahead > 250) await pause((ahead - 250) / rate);
      }
    }
    send({ t: 'done', id });
  }

  /**
   * Whether Momo's own voice is kept from the headset now: while a take runs or is about to, and from when she is told that the
   * user's next words ask for a round, since the round's recorded lines are what is heard. On an empty stage the next words
   * start the tree, which is the first round.
   */
  mutes(): boolean {
    if (!this.scripted) return false;
    if (this.rolling || this.pending) return true;
    return this.listening !== null || this.awaitsTree();
  }

  private awaitsTree(): boolean {
    return this.built.size === 0 && this.headOf(this.script.phases[0]!) === null;
  }

  /** Whether Momo is told nothing of what the agents do now: a take says its own lines, and its run's end is not hers to tell. */
  directing(): boolean {
    return this.rolling !== null || this.pending !== null || Date.now() < this.quiet;
  }

  /**
   * Momo finished a reply that was kept from the headset. If the user's words were to bring a round and she started no search,
   * the take starts anyway, so a take never hangs on what the live model chose to do.
   */
  replied(): void {
    const round = this.listening?.phase ?? (this.awaitsTree() ? this.script.phases[0] : undefined);
    if (!round || !this.scripted) return;
    const timer = setTimeout(() => {
      if (this.rolling || this.pending || this.built.has(round.id)) return;
      this.deps.log(`[demo] Momo started nothing for "${round.title}", so its take is started for her`);
      void this.playTake(round.id, 0).catch(() => {});
    }, 1500);
    timer.unref?.();
  }

  /**
   * What Momo is told, with where the user is, about the card they have open: whether the next thing they say asks for the round
   * that waits on that card. A round with cards is a new layer on it; a round that brings nothing is answered aloud from it.
   */
  takeNote(focus: Id | undefined): string {
    this.listening = null;
    if (!this.scripted || !focus) return '';
    const here = this.script.phases.filter(
      (phase) => !this.built.has(phase.id) && !this.playing.has(phase.id) && (phase.head === 'root' ? this.root === focus : this.nodes.get(phase.head) === focus),
    );
    if (here.length === 0) return '';
    const withCards = here.find((phase) => phase.cards.length > 0);
    this.listening = { phase: withCards ?? here[0]!, at: Date.now() };
    return withCards
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
        if (!this.pending && this.outsideScript(input.anchor)) return real.scout(ctx, input);
        // The page's Play names its round and the moment it starts from; a request made on the headset finds its round, from the start.
        const asked = this.pending;
        const phase = asked ? this.phase(asked.phase) : this.scripted && !this.inShowcase(input.anchor) ? this.choose(input.anchor, input.need) : undefined;
        return phase ? this.roll(ctx, phase, input.anchor, input.deliver, asked?.from ?? 0) : real.scout(ctx, input);
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
          await pause(this.laying(input.nodeIds));
          return [];
        }
        return real.renderer(ctx, { ...input, nodeIds: others });
      },
    };
  }

  /**
   * How long the Renderer is shown laying these cards out. In a fast take, 0.6 s. At real pace, what the take's schedule gives
   * the delivery: nothing to speak of for a found card, whose look is settled by rule, and seconds for one that was written.
   */
  private laying(nodeIds: readonly Id[]): number {
    const rolling = this.rolling;
    if (!rolling || this.mode !== 'real') return Math.min(600, this.pace.step / 2);
    const cards = rolling.phase.cards.filter((card) => nodeIds.includes(this.nodes.get(card.id) ?? '')).map((card) => card.id);
    return layingOut(rolling.take, cards) / Math.max(0.01, this.pace.rate);
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
    this.listening = null;
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
    // The walkthrough's tree is not set up again for a headset that grows the daily tree, since that takes its view to the
    // walkthrough's cards.
    if (this.growOnReturn('a headset joined')) return;
    if (this.busy || this.built.size === 0) return;
    const at = this.script.phases[this.armed]?.id ?? 'end';
    this.deps.log('[demo] a headset joined: setting the tree up again for it');
    setTimeout(() => void this.goto(at).catch(() => {}), 1200);
  }

  /**
   * The headset was put on again after `away` seconds off, still joined: the app stays joined while it is off. A moment off, as
   * its menu takes, is not taking it off.
   */
  worn(away: number): void {
    if (away * 1000 >= this.pace.wornAway) this.growOnReturn(`the headset was put on again after ${away.toFixed(1)} s off`);
    else if (this.daily?.sent && !this.daily.auto) this.deps.log(`[demo] the headset was off for ${away.toFixed(1)} s, too short to be put on again: the daily tree waits`);
  }

  /**
   * A headset joined, or was put on again, after Momo's message went: the daily tree grows a moment later, once for each time it
   * is armed. True when it does.
   */
  private growOnReturn(how: string): boolean {
    const daily = this.daily;
    if (!daily?.sent || daily.grown || daily.auto) return false;
    daily.auto = true;
    this.keepDaily();
    this.deps.log(`[demo] ${how} after Momo's message: the daily tree grows in ${Math.round(this.pace.growAfterJoin / 100) / 10} s`);
    setTimeout(() => void this.growDaily().catch((err) => this.deps.log(`[demo] the daily tree did not grow: ${err instanceof Error ? err.message : String(err)}`)), this.pace.growAfterJoin);
    return true;
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

/** 16-bit mono at 24 kHz, the live voice's own format. */
const BYTES_PER_MS = 48;

function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve();
}
