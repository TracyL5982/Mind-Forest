import { MOMO } from '../core/momo.ts';
import type { ChangeSet } from '../core/domain.ts';
import type { Activity, Outbound } from '../core/pipeline.ts';
import type { Scene, Turn } from '../core/roles/types.ts';
import type { CardNote, ToolOutput } from '../core/voice-tools.ts';
import { withoutWakePhrase } from '../core/wake.ts';
import type { DeviceFrame, Look } from './protocol.ts';

/**
 * Momo's real-time voice for one device (`/live`): OpenAI's realtime model holds the conversation. After the wake the device's
 * microphone goes to the model, whose turn detection hears when the user is done; the model answers in its own words, from what it
 * knows, or through its tools (`core/voice-tools.ts`): a quick web answer, the user's saved cards, and the pipeline's moves, such as
 * new cards on the open card. As the cards of a run this device asked for land, the service tells the model in short notes, and it
 * walks the user through them. The frames are in docs/protocol.md; why it is built this way is in agents/DECISIONS.md (57 to 59, 61, 63).
 */

export type SayKind = 'reply' | 'results';

/** What the service sends a device on `/live`. Audio is base64 of 16-bit mono PCM at `ready.rate`. */
export type VoiceFrame =
  | { t: 'ready'; rate: number }
  | { t: 'over'; turn: number }
  | { t: 'heard'; turn: number; text: string; final: boolean }
  | { t: 'quiet'; turn: number }
  // `ms` and `from`: a recording's whole length, and how far into it its sound starts, so its words can be shown as it is heard.
  // `turn`: the turn a reply answers, when it answers one, so a device can tell its answer from anything else Momo says.
  | { t: 'text'; id: string; text: string; kind: SayKind; ms?: number; from?: number; turn?: number }
  | { t: 'audio'; id: string; pcm: string }
  | { t: 'done'; id: string; usage?: Usage }
  /** The check of the sound that woke the device: whether it was the name. On `false` the device closes what the wake opened. */
  | { t: 'name'; ok: boolean }
  | { t: 'failed'; why: string };

/** An event from or to OpenAI's realtime model. */
export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

/** One socket to the realtime model. Events sent before it opens wait for it. */
export interface Realtime {
  send(event: RealtimeEvent): void;
  close(): void;
}
export type OpenRealtime = (on: { event: (e: RealtimeEvent) => void; closed: (why: string) => void }) => Realtime;

/** The token counts OpenAI reports for one response, or for one transcription. */
export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { text_tokens?: number; audio_tokens?: number; image_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number; image_tokens?: number } };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

export const RATE = 24000;
const IDLE_MS = 5 * 60 * 1000;
/**
 * How long the check of a wake may take before the wake is taken for the name. The check answers in about half a second and Momo's
 * first sound comes two seconds or more after the name, so nothing waits for it unless it is this slow (DECISIONS 70).
 */
const NAME_WAIT_MS = 2500;
/** 16-bit mono at RATE. */
const BYTES_PER_MS = (RATE * 2) / 1000;
/** Later cards of a run are gathered into one line at most this often. */
const BATCH_MS = 6000;
/**
 * Quiet after the last word that ends the turn when the model's turn detection has not, a word being louder than both a floor and
 * three times the quietest moment, as the headset's recorder hears it. The detection waited 2.3 to 2.7 s after short commands; the
 * recorder's own 1.2 s cut every request said with a thinking pause of 1.4 to 2.3 s, three of which the detection kept whole, and
 * 1.8 s keeps those (DECISIONS 59).
 */
const PAUSE_MS = 1800;
const PIECE_SAMPLES = 1600;
/** How long the turn detection may take to begin the turn's answer before the service asks for it. */
const ANSWER_WAIT_MS = 4000;
/**
 * How long after a turn was over a call waits for the turn's words to be written down. In the live benches the transcription took
 * 0.51 s at the median and 1.49 s at the slowest (403 turns); 2 of 77 calls that started a Scout run came before it, by 50 and 68 ms.
 */
const SAID_MS = 1500;
/** How long what the user marked on a picture of the headset's own (the walk's sketch) waits to be shown with their words, ms. */
const SIGHT_MS = 5 * 60 * 1000;

/**
 * What the user marked on a picture, as Momo is shown it (WS89): a message of the user's with the part cut out and the whole
 * picture, the line drawn on each in red, and a line saying what they are. The part is seen in detail, the whole at a glance.
 */
export function sightItem(sight: { title: string; crop: string; whole: string }): Record<string, unknown> {
  return {
    type: 'message',
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: `[What I marked] I drew a line round part of the picture on "${sight.title}". The first image is that part, cut out; the second is the whole picture, my line in red. When I ask about "this", "here" or "that part", I mean what is inside my line.`,
      },
      { type: 'input_image', image_url: sight.crop, detail: 'high' },
      { type: 'input_image', image_url: sight.whole, detail: 'low' },
    ],
  };
}
/**
 * Calls whose output Momo always speaks from, even after a lead-in of her own: what they give is for the user to hear (a Telegram
 * pairing code among them). The others act, and Momo said what it is doing as it called them.
 */
const ANSWERS = new Set(['web_answer', 'look_up_mindstorm', 'connect_telegram']);
const DIGITS: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
const DIGIT = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)';
const SPELLED = new RegExp(`\\b${DIGIT}\\b(?:[\\s,.…–—-]+${DIGIT}\\b){2,}`, 'gi');

/** Digits she spells out in words, three or more in a row, written as digits: "four, eight, two" is "4 8 2". */
export function inDigits(text: string): string {
  return text.replace(SPELLED, (run) => run.split(/[^a-z]+/i).filter(Boolean).map((word) => DIGITS[word.toLowerCase()]).join(' '));
}

/**
 * Dollars per million tokens (https://developers.openai.com/api/docs/pricing): the realtime models as read on 2026-11-14, the
 * transcription models as they were listed in 2025 and not read again.
 */
const PRICES: Record<string, { audioIn: number; audioCached: number; audioOut: number; textIn: number; textCached: number; textOut: number; imageIn?: number; imageCached?: number }> = {
  // Image input as read on 2026-11-18 (WS89): what the user marked, shown to Momo.
  'gpt-realtime-2.1': { audioIn: 32, audioCached: 0.4, audioOut: 64, textIn: 4, textCached: 0.4, textOut: 24, imageIn: 5, imageCached: 0.5 },
  'gpt-realtime-2.1-mini': { audioIn: 10, audioCached: 0.3, audioOut: 20, textIn: 0.6, textCached: 0.06, textOut: 2.4, imageIn: 0.8, imageCached: 0.08 },
  'gpt-4o-transcribe': { audioIn: 6, audioCached: 6, audioOut: 0, textIn: 2.5, textCached: 2.5, textOut: 10 },
  'gpt-4o-mini-transcribe': { audioIn: 3, audioCached: 3, audioOut: 0, textIn: 1.25, textCached: 1.25, textOut: 5 },
};

/** What one response or transcription cost, in dollars, or null for a model whose prices are not listed. */
export function cost(model: string, usage: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const input = usage.input_token_details ?? {};
  const cached = input.cached_tokens_details ?? {};
  const output = usage.output_token_details;
  const audioCached = cached.audio_tokens ?? 0;
  const textCached = cached.text_tokens ?? 0;
  const imageCached = cached.image_tokens ?? 0;
  // A transcription reports its output as a total only, and all of it is text.
  const textOut = output ? (output.text_tokens ?? 0) : (usage.output_tokens ?? 0);
  const dollars =
    ((input.audio_tokens ?? 0) - audioCached) * p.audioIn + audioCached * p.audioCached +
    ((input.text_tokens ?? 0) - textCached) * p.textIn + textCached * p.textCached +
    (output?.audio_tokens ?? 0) * p.audioOut + textOut * p.textOut +
    ((input.image_tokens ?? 0) - imageCached) * (p.imageIn ?? p.textIn) + imageCached * (p.imageCached ?? p.textCached);
  return dollars / 1e6;
}

export interface LiveOptions {
  model: string;
  voice: string;
  /** How the model hears the end of a turn: by meaning (`semantic`, eager) or by a pause of `ms` (`server`). */
  turn: { kind: 'semantic' } | { kind: 'server'; ms: number };
  /** The model that writes down what the user said, for the orb and the log. */
  hearing: string;
  /** For the reasoning models: how hard it thinks before it speaks. */
  effort?: 'minimal' | 'low' | 'medium' | 'high';
  /** Quiet after the last word that ends a turn the turn detection has not, in ms; 0 leaves it to the detection. */
  pauseMs?: number;
}

export interface LiveDeps {
  open: OpenRealtime;
  options: LiveOptions;
  /** What the user calls the agent. */
  name: () => string;
  /** Words the user is likely to say in this scene, such as their card titles, for the transcription. */
  words: (scene: Scene) => string;
  /** The tools the model may call, as the session declares them. */
  tools: () => Record<string, unknown>[];
  /** Runs one call as this device's own request. `said`: the user's words in the turn that made it, for a call that needs them. */
  call: (name: string, args: string, scene: Scene, said: () => Promise<string | undefined>) => Promise<ToolOutput>;
  /** A few words for the orb while a call runs, or nothing for a call too quick to show. */
  label: (name: string, args: string) => string | undefined;
  /** Where the user is, in a few lines, for the model. */
  where: (scene: Scene) => string;
  /** The Scout's new cards in a change. */
  cards: (set: ChangeSet) => CardNote[];
  /** A card's name, as Momo is told it. */
  nameOf: (nodeId: string) => string;
  /** What was said, for the conversation the pipeline's roles read. */
  spoken: (turn: Turn) => void;
  /** A step of Momo's own, shown as the pipeline's steps are. */
  activity: (a: Activity) => void;
  /** What a response or a transcription cost, in dollars, as it is known. */
  spent?: (dollars: number) => void;
  /**
   * Whether the sound that woke the device (16 kHz mono 16-bit PCM) holds the name: the check of a wake (`wake-check.ts`). Without it
   * every wake is taken for the name.
   */
  named?: (pcm: Uint8Array) => Promise<boolean>;
  /** How long Momo's answer waits for that check at most, in ms. */
  nameWaitMs?: number;
  log: (line: string) => void;
  /** More instructions for the session, after Momo's own: the demo's, which make every request a take (src/demo). */
  extra?: () => string;
  now?: () => number;
  idleMs?: number;
  batchMs?: number;
  answerWaitMs?: number;
}

// ---- Momo's character

/** The session's instructions, in the labelled parts OpenAI's prompting guide for its realtime models suggests. */
export function instructions(name: string, today: string): string {
  return `# Role and objective
You are ${name}, the voice of Mind Palace, a space in VR where the user's ideas hang as cards in trees. You are ${MOMO.friend}. Today is ${today}.
Your goal is a good conversation: answer what the user asks, think with them, and bring them new things to look at when that helps.

# Personality and tone
${MOMO.warm}
${MOMO.person}
- Short turns: one or two sentences, about five to ten seconds aloud. Go longer only when the user asks you to explain.
${MOMO.varied}
${MOMO.followUp}
- Never read out a status, an id or an address. Never say "Finding things now", "Processing" or "Searching the database".
- Never say your own name, nor "Hey ${name}".

# Language
Speak the language the user just spoke. Card titles stay as written.

# Trees and layers
- A tree starts from one card and grows in layers: asking about a card adds the next layer of cards around it.
- A tree is one line of thought. A new tree is a separate space, for a new subject.
- With a card open, a request for things to look at builds on it: going deeper, a related angle, "more on this", a new layer. That is find_new on the open card.
- start_tree only when the user asks for a tree or a space of its own. A subject alone never starts a tree.
- When the user turns to something the open card does not lead to ("now…", "next…", "new idea…") and does not say where it goes, ask one short question, such as "Add it as a new layer here, or start its own tree?", and start nothing until they answer. Asked for a new layer with no card open, ask which card.

# Answering: choose one way
1. From what you know: anything settled, such as who made what and when, what something is, how it works, why it happened, history, explanations, opinions, recommendations and small talk. Answer at once, with no tool. ${MOMO.knows}
2. web_answer: only what changes or is new: news, this year's events and winners, what is on now, prices, opening hours, weather, schedules. Never for settled facts. First say a few natural words, varied ("Let me check that"), then call it. Tell only what its answer says, in your own words: keep its dates, numbers and hedges, and add none of your own. When it says something has not happened yet, is only planned or is uncertain, say so plainly.
3. look_up_mindstorm: questions about what the user has saved ("what did I save about…", "do I have anything on…", "what did that card say", "what's in my … tree"), or a question their cards may answer. Answer only from what it returns. Call a card saved only when it says saved; the others are suggestions not yet kept. If nothing matches, say so.
4. find_new: the user wants new things to look at ("find me…", "show me something about…", "I need examples of…"), or a topic is better explored as cards than answered in a sentence. Say a short, lively line of your own as you call it, then stop: describe no card until a note says it landed.
A question gets an answer, not cards: "who painted it?" is answered from what you know, never with find_new. A friend answers first and offers to dig in.

# The other tools
- start_tree: a separate tree, only when the user asks for a tree or a space of its own.
- more_like_this: "more", "more like this", "keep going".
- keep: "keep that", "keep them all", "keep the first two".
- undo: "undo", "put it back".
- go_to: "go up", "back to the top", "open the one about Jaws", "go to my lenses tree". It only opens; it never finds or starts anything.
- organize: move, group, rename, tidy, delete.
- hand_off: package cards for another app or agent.
- save_note: the user dictates a thought to keep.
- connect_telegram: "connect my Telegram". This once you do read out a name and a code: the bot's name as given, then the code digit by digit.
Say a few words of your own as you call these ("Keeping that one", "Going up"). When a tool says it could not, say why in a few words.

# Notes from Mind Palace
Messages in square brackets come from Mind Palace, not from the user.
- [Where the user is] says what the user has open. "This" and "it" mean that card.
- [Card landed], [More cards landed], [All done] and [Wrap up] tell you what a search you started brought. Tell the user right away, like a friend pointing something out: the first card in a sentence or two, later ones in one short line ("two more: …"), and at [All done] or [Wrap up] a one-sentence wrap-up that says which you would look at first and offers one next step.
- Never mention the notes themselves ("the note says"): tell what landed as a friend would.
- Say only what a note says about a card. Never add a fact, date, name or claim about a card that its note does not state, and never describe what a card looks like or shows beyond its note. Your own taste is fine when it is plainly an opinion ("sounds like a rabbit hole").
- [From the agents] is a line from Mind Palace's other agents for the user. Say it briefly in your own words, and claim nothing it does not say.

# Rules
- Never make up what is in the user's saved cards; look it up.
- Never name, mention or offer a card that no tool returned and no note told you of. To offer more, offer to find it.
- "Go up" is one level up; say where you went as the tool says it.
- Never say you found or made something until a note says it landed.
- If you cannot tell what the user wants, or which card they mean ("the other one"), ask one short question before you do anything.`;
}

function turnDetection(turn: LiveOptions['turn']): Record<string, unknown> {
  // The device sends no microphone while Momo speaks, and saying the name stops Momo, so only the device interrupts.
  const common = { create_response: true, interrupt_response: false };
  return turn.kind === 'semantic'
    ? { type: 'semantic_vad', eagerness: 'high', ...common }
    : { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: turn.ms, ...common };
}

/** The transcription's prompt, as /api/transcribe's: what the user calls the app, and the words they are likely to say. */
function hearingPrompt(name: string, words: string): string {
  const cards = words ? ` Their cards include: ${words}.` : '';
  return `Someone is talking to their brainstorming app, which they call ${name}, and may begin with "Hey ${name}".${cards}`;
}

/** The device's 16 kHz to the model's 24 kHz, by straight lines between samples, carrying the last sample across pieces. */
export class Upsampler {
  private last = 0;
  /** Where the next output sample falls, in thirds of an input sample from the start of the next piece; -3 is `last`. */
  private at = 0;

  push(pcm: Buffer): Buffer {
    const n = pcm.length >> 1;
    if (n === 0) return Buffer.alloc(0);
    const x = (i: number) => (i < 0 ? this.last : pcm.readInt16LE(i * 2));
    const out: number[] = [];
    for (; Math.floor(this.at / 3) <= n - 2; this.at += 2) {
      const i = Math.floor(this.at / 3);
      const frac = (this.at - i * 3) / 3;
      const a = x(i);
      out.push(Math.round(a + (x(i + 1) - a) * frac));
    }
    this.at -= 3 * n;
    this.last = x(n - 1);
    const bytes = Buffer.alloc(out.length * 2);
    out.forEach((v, k) => bytes.writeInt16LE(v, k * 2));
    return bytes;
  }
}

// ---- walking the user through what lands

/** A Scout run this device asked for, while its cards land. */
interface Run {
  /** The runs' own steps still open on the card: a newer run on it goes on as this one, which ends when the last of them does. */
  steps: Set<string>;
  anchor: string;
  under: string;
  told: number;
  waiting: CardNote[];
  ended: boolean;
}

const described = (c: CardNote) =>
  `${c.kind} "${c.title}"${c.by ? ` by ${c.by}` : ''}${c.date ? ` (${c.date})` : ''}${c.from ? `, from ${c.from}` : ''}` +
  `${c.why ? `. Why it was picked: ${c.why}` : ''}${c.says ? `. The card says: ${c.says}` : ''}${c.shows ? `. It shows: ${c.shows}` : ''}`;

/**
 * When Momo hears of the cards a run brings. The first card of a run is told the moment it lands; later ones are gathered and told
 * together at most every `batchMs`; the run's end is a wrap-up with whatever was not told yet. A newer run on a card while one is
 * under way goes on as the same run: the pipeline drops the older one's later cards and says nothing at its end, so the run ends
 * when the last of its runs' steps does. Only a run's own step counts (`Activity.whole`): its parts name the card too, and a picture
 * still being made after the run is over lands as one more. While a part is still at work on the card, the wrap-up does not call the
 * search finished: pictures landed 15 to 48 s after it in the user's session.
 */
export class Narration {
  private runs: Run[] = [];
  /** Cards whose runs were told done, by name, for a card that lands after: a picture made after the run was over. */
  private finished = new Map<string, string>();
  /** The parts of runs still at work, each with its card. */
  private parts = new Map<string, string>();
  private lastTold = Number.NEGATIVE_INFINITY;

  constructor(private readonly batchMs = BATCH_MS) {}

  /** A Scout run on `anchor` began, as this device asked: a new run, or a newer one on a card whose run is under way. */
  began(step: string, anchor: string, under: string): void {
    const going = this.runs.find((r) => r.anchor === anchor && r.steps.size > 0 && !r.ended);
    if (going) {
      going.steps.add(step);
      return;
    }
    this.runs = this.runs.filter((r) => r.anchor !== anchor);
    this.runs.push({ steps: new Set([step]), anchor, under, told: 0, waiting: [], ended: false });
  }

  /** A card under the run on its card; one that lands after the run was told done is news of its own. */
  landed(card: CardNote): void {
    let run = this.runs.find((r) => r.anchor === card.anchor);
    const under = this.finished.get(card.anchor);
    if (!run && under === undefined) return;
    if (!run) {
      run = { steps: new Set(), anchor: card.anchor, under: under!, told: 1, waiting: [], ended: false };
      this.runs.push(run);
    }
    run.waiting.push(card);
  }

  /** A part of a run on `anchor` began: a search, or a picture being made, which may land after the run is over. */
  part(step: string, anchor: string): void {
    this.parts.set(step, anchor);
  }

  /** A run's step or one of its parts ended. True when it was the last of the run's own steps open on its card, so the run is over. */
  ended(step: string): boolean {
    if (this.parts.delete(step)) return false;
    const run = this.runs.find((r) => r.steps.has(step) && !r.ended);
    if (!run) return false;
    run.steps.delete(step);
    if (run.steps.size === 0) run.ended = true;
    return run.ended;
  }

  /** The note to give now, if one is due. */
  next(now: number): string | null {
    const run = this.runs.find((r) => (this.dueAt(r) ?? Number.POSITIVE_INFINITY) <= now);
    return run ? this.tell(run, now) : null;
  }

  /** When the next note will be due, or null when nothing waits. */
  due(): number | null {
    const times = this.runs.map((r) => this.dueAt(r)).filter((t): t is number => t !== null);
    return times.length > 0 ? Math.min(...times) : null;
  }

  private dueAt(run: Run): number | null {
    if (run.ended) return run.told === 0 ? Number.NEGATIVE_INFINITY : this.lastTold + this.batchMs / 2;
    if (run.waiting.length === 0) return null;
    return run.told === 0 ? Number.NEGATIVE_INFINITY : this.lastTold + this.batchMs;
  }

  private tell(run: Run, now: number): string {
    this.lastTold = now;
    if (run.ended) {
      const untold = run.waiting.splice(0);
      const total = run.told + untold.length;
      this.runs = this.runs.filter((r) => r !== run);
      this.finished.set(run.anchor, run.under);
      const working = [...this.parts.values()].includes(run.anchor);
      const cards = `${total} new card${total === 1 ? '' : 's'}`;
      if (total === 0) {
        return working
          ? `[Wrap up] Nothing from the search for "${run.under}" has landed yet. Say so in a few words.`
          : `[All done] The search for "${run.under}" brought nothing new. Say so in a few words and offer another angle.`;
      }
      const rest = untold.length > 0 ? ` Not told yet: ${untold.map(described).join('; ')}.` : '';
      const said = working ? `[Wrap up] The search for "${run.under}" has brought ${cards}.` : `[All done] The search for "${run.under}" is finished: ${cards} in all.`;
      return `${said}${rest} Wrap up in one or two short sentences: which you would look at first and why, and one next step to offer. Do not go through them one by one.`;
    }
    if (run.told === 0) {
      const first = run.waiting.shift()!;
      run.told = 1;
      return `[Card landed] The first card under "${run.under}": ${described(first)}. Tell the user about it in one or two short sentences, from this note only.`;
    }
    const more = run.waiting.splice(0);
    run.told += more.length;
    return `[More cards landed] Under "${run.under}", ${more.length} more: ${more.map(described).join('; ')}. Tell the user in one short sentence that names them.`;
  }
}

// ---- the voice

/** The model's events that say who has the floor, logged as they come so a turn can be followed. */
const TRACED = new Set(['input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'input_audio_buffer.committed', 'input_audio_buffer.timeout_triggered']);

/**
 * Why a response is given: to answer a turn (at once, or after its calls), or to tell what the agents did. `tools: false`: an answer
 * that may call no tool, as a lesson's.
 */
type Purpose = { kind: 'reply'; turn?: number; tools?: false } | { kind: 'results' };

/**
 * What Momo is told for a lesson of the welcome walk she answers: the lesson's picture, the cards that come up with her answer, and
 * how to answer. The walk stands where a tree would, with cards of its own, so she starts nothing: the answer may call no tool.
 */
export function lessonNote(lesson: Extract<DeviceFrame, { t: 'lesson' }>): string {
  const cards = lesson.cards.map((card, n) => `${n + 1}. ${card.title}${card.says ? `: ${card.says}` : ''}`).join('\n');
  return [
    "[Welcome walk] The user is on the welcome walk, the app's guided tour, in the lesson where they mark part of a picture and ask you about it.",
    `The picture: ${lesson.picture}`,
    ...(cards ? [`For you to know, not to speak of: the lesson's own cards come up round them as you answer:\n${cards}`] : []),
    'Answer their question, from the picture, and nothing more: two short sentences at the very most, about 25 words in all; one sentence is better. Stop as soon as the question is answered. Do not describe, list or mention the cards or anything that arrives, and do not say what you will do next. Start no search and no tree, and call no tool: the walk\'s cards are already there.',
  ].join('\n');
}

/** The response the model is giving. */
interface Speaking {
  id: string;
  purpose: Purpose;
  text: string;
  heard: boolean;
  /** Calls it made, by call id. */
  calls: Set<string>;
  at: number;
}

/** A piece of Momo's voice as the device plays it, so a cut can be placed in it. */
interface Played {
  item: string;
  from: number;
  ms: number;
}

/** A call's output, to hand the model once nobody has the floor. `answer`: Momo speaks from it. */
interface Ready {
  call: string;
  output: string;
  turn?: number;
  answer: boolean;
}

export class LiveVoice {
  private session: Realtime | null = null;
  /**
   * The user's turn while it is heard, from the name until Momo's answer begins: the turn detection may take a pause for its end
   * and hear the user go on. `committed`: it took the end, and no word has come since. `manual`: the device or the pause rule ended
   * it. `quietest`, `spoke` and `quiet`: the recording rule's reading of the pieces so far.
   */
  private hearing: { turn: number; stopped?: number; committed?: boolean; manual?: boolean; quietest: number; spoke: boolean; quiet: number } | null = null;
  /** The latest turn's words as written down so far, every piece of it. */
  private words = { turn: 0, text: '' };
  /** Pieces of turns being written down, by the model's item. */
  private transcribing = new Map<string, { turn: number; text: string; over: number }>();
  /** Calls waiting on a turn's words, each looking again as a piece is written down or fails. */
  private waiting = new Set<() => void>();
  private scene: Scene = { selection: [] };
  /**
   * What the user last marked on a picture (WS89), from the headset's `look`, and whether Momo has been shown it in this session:
   * a card of the service's (`nodeId`) is shown with the next turn begun on it, the headset's own with the next lesson or turn.
   * Kept only here, in memory, until the next look or the marks are gone.
   */
  private sight: { nodeId?: string; title: string; crop: string; whole: string; at: number; shown: boolean } | null = null;
  /** What Momo was last told of where the user is. */
  private toldWhere: string | null = null;
  /** The turn detection's answer to a turn, expected and not begun. `cancel`: the user spoke again first. */
  private expected: { turn: number; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private cancelExpected = false;
  /** A response the service asked for and not begun. `retry`: asked again if the model refuses it while another is under way. */
  private asked: { purpose: Purpose; at: number; retry: boolean } | null = null;
  /** Responses the service asked for that the user spoke over before they began. */
  private cancelling = 0;
  private speaking: Speaking | null = null;
  /** The turn whose answer has not been heard yet. */
  private answering: { turn: number; at: number } | null = null;
  private calls = new Map<string, { name: string; turn?: number }>();
  /** Names of calls as the model begins them, for events that carry only the call's id. */
  private names = new Map<string, string>();
  /** Every call run, so one announced twice runs once. */
  private ran = new Set<string>();
  /** A call gave her a code to say (Telegram's pairing code): until the next turn her captions show spelled-out digits as digits. */
  private code = false;
  /** A response the model refused to begin while another was under way, to ask for again. */
  private refused: Purpose | null = null;
  private ready: Ready[] = [];
  private narration: Narration;
  /** Lines from the pipeline waiting to be told. */
  private notes: string[] = [];
  /**
   * A run just ended, and its closing line, which the wrap-up stands for, may follow at once. The pipeline says it in the same
   * turn of the event loop, or not at all for a card deleted while it ran, so this lasts until the loop turns.
   */
  private runEnded: ReturnType<typeof setTimeout> | null = null;
  private wake: ReturnType<typeof setTimeout> | null = null;
  /** When everything sent to the device so far will have played there. */
  private playedUntil = 0;
  private played: Played[] = [];
  private upsampler = new Upsampler();
  private idle: ReturnType<typeof setTimeout> | null = null;
  /**
   * A wake whose sound is being checked. Until the check answers, Momo does nothing the user could notice: what it would send the
   * device, the calls it would run and the words it would keep all wait in `held`, in order. `items`: what the conversation gained
   * meanwhile, to take out again should it not have been the name. `turn`: a turn began since.
   */
  private naming: { id: number; at: number; held: (() => void)[]; items: string[]; calls: string[]; turn: boolean; heldAudioAt?: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private wakes = 0;
  private readonly device: (frame: VoiceFrame) => void;

  constructor(
    private readonly deps: LiveDeps,
    device: (frame: VoiceFrame) => void,
  ) {
    this.narration = new Narration(deps.batchMs);
    // Everything for the device waits while a wake is checked, except the check's own answer.
    this.device = (frame) => {
      if (!this.naming || frame.t === 'name') return device(frame);
      if (frame.t === 'audio' && this.naming.heldAudioAt === undefined) this.naming.heldAudioAt = this.now();
      this.naming.held.push(() => device(frame));
    };
    device({ t: 'ready', rate: RATE });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** A frame from the device. */
  heard(frame: DeviceFrame): void {
    this.touch();
    switch (frame.t) {
      case 'name':
        this.check(Buffer.from(frame.pcm, 'base64'));
        return;
      case 'start': {
        const s = this.ensure();
        if (this.naming) this.naming.turn = true;
        this.hush();
        this.code = false;
        this.scene = frame.scene;
        s.send({ type: 'session.update', session: { type: 'realtime', audio: { input: { transcription: this.transcription(frame.scene) } } } });
        s.send({ type: 'input_audio_buffer.clear' });
        this.tellWhere();
        this.showSight(frame.scene.focus);
        this.upsampler = new Upsampler();
        this.hearing = { turn: frame.turn, quietest: Number.POSITIVE_INFINITY, spoke: false, quiet: 0 };
        this.words = { turn: frame.turn, text: '' };
        return;
      }
      case 'audio': {
        const h = this.hearing;
        if (!h || !this.session || h.manual) return;
        const pcm = Buffer.from(frame.pcm, 'base64');
        this.session.send({ type: 'input_audio_buffer.append', audio: this.upsampler.push(pcm).toString('base64') });
        for (let at = 0; at + PIECE_SAMPLES * 2 <= pcm.length; at += PIECE_SAMPLES * 2) {
          let sum = 0;
          for (let i = 0; i < PIECE_SAMPLES; i++) sum += (pcm.readInt16LE(at + i * 2) / 32768) ** 2;
          const level = Math.sqrt(sum / PIECE_SAMPLES);
          h.quietest = Math.min(h.quietest, level);
          const words = level > Math.max(0.015, h.quietest * 3);
          if (words) h.spoke = true;
          h.quiet = words ? 0 : h.quiet + 1;
          const pause = (this.deps.options.pauseMs ?? PAUSE_MS) / 100;
          if (pause > 0 && h.spoke && h.quiet === pause && !h.committed) {
            this.deps.log(`[live] turn ${h.turn}: ${pause * 100} ms of quiet after the last word, so it is over`);
            return this.endTurn(this.now() - pause * 100);
          }
        }
        return;
      }
      case 'end':
        this.endTurn();
        return;
      case 'cancel':
        if (!this.hearing || !this.session) return;
        this.session.send({ type: 'input_audio_buffer.clear' });
        this.hearing = null;
        this.drain();
        return;
      case 'lesson': {
        // The words come written down by the device, so nothing is heard: what Momo says stops, as for a new turn, and she is told
        // the lesson, given the words as the user's, and asked for an answer that may call no tool.
        const s = this.ensure();
        this.hush();
        if (this.hearing) s.send({ type: 'input_audio_buffer.clear' });
        this.hearing = null;
        this.answering = { turn: frame.turn, at: this.now() };
        this.note(lessonNote(frame));
        this.showSight(undefined);
        s.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: frame.words }] } });
        this.deps.spoken({ who: 'user', text: frame.words });
        this.deps.log(`[live] lesson, turn ${frame.turn}: ${frame.words}`);
        this.ask({ kind: 'reply', turn: frame.turn, tools: false });
        return;
      }
    }
  }

  /** The device woke: the sound that woke it is checked, and until the check answers Momo's doings wait. */
  private check(pcm: Uint8Array): void {
    if (!this.deps.named) return this.device({ t: 'name', ok: true });
    if (this.naming) this.verdict(this.naming.id, true, 'another wake came first');
    const id = ++this.wakes;
    const timer = setTimeout(() => this.verdict(id, true, 'the check did not answer in time'), this.deps.nameWaitMs ?? NAME_WAIT_MS);
    timer.unref?.();
    this.naming = { id, at: this.now(), held: [], items: [], calls: [], turn: false, timer };
    this.deps.named(pcm).then(
      (ok) => this.verdict(id, ok),
      (err) => this.verdict(id, true, `the check failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  /** The check answered. The name: what waited goes on, in order. Not the name: everything the wake brought is undone. */
  private verdict(id: number, ok: boolean, why?: string): void {
    const n = this.naming;
    if (!n || n.id !== id) return;
    clearTimeout(n.timer);
    this.naming = null;
    const now = this.now();
    const waited = n.held.length > 0 ? `, and ${n.held.length} of Momo's doings had waited for it` : '';
    this.deps.log(`[live] wake ${id} ${why ? `taken for the name (${why})` : ok ? 'was the name' : 'was not the name'}, ${now - n.at} ms after it came${waited}`);
    this.device({ t: 'name', ok });
    if (ok) {
      // Sound that waited plays from now, not from when it came.
      if (n.heldAudioAt !== undefined) {
        const late = now - n.heldAudioAt;
        for (const p of this.played) if (p.from >= n.heldAudioAt) p.from += late;
        this.playedUntil += late;
      }
      for (const go of n.held) go();
      return;
    }
    for (const call of n.calls) this.calls.delete(call);
    if (!n.turn && n.items.length === 0) return;
    this.hush();
    this.session?.send({ type: 'input_audio_buffer.clear' });
    for (const item of n.items) {
      this.transcribing.delete(item);
      this.session?.send({ type: 'conversation.item.delete', item_id: item });
    }
    this.hearing = null;
    for (const look of [...this.waiting]) look();
    this.drain();
  }

  /** All of a turn's words so far, the pieces written down before and then `text`, without the name that woke Momo. */
  private wordsOf(turn: number, text: string): string {
    const before = this.words.turn === turn ? this.words.text : '';
    return withoutWakePhrase([before, text.trim()].filter(Boolean).join(' '), this.deps.name()).trim();
  }

  /** The turn is over on the service's side: the device stopped sending, or the user paused. The answer is asked for with the commit. */
  private endTurn(lastWord?: number): void {
    const h = this.hearing;
    if (!h || !this.session || h.manual || h.committed) return;
    h.manual = true;
    if (lastWord !== undefined) h.stopped = lastWord;
    this.session.send({ type: 'input_audio_buffer.commit' });
    this.ask({ kind: 'reply', turn: h.turn }, false);
  }

  /**
   * What the pipeline did for this device: work it asked for, by voice or by hand. Its Scout runs are walked through as their cards
   * land, and a line it says becomes a note for Momo to say in its own words, except a run's closing line, which the wrap-up says.
   */
  observed(message: Outbound): void {
    if (message.t === 'activity') {
      const a = message.activity;
      if (a.role !== 'scout') return;
      if (a.state === 'start' && a.nodeId && a.whole) this.narration.began(a.id, a.nodeId, this.deps.nameOf(a.nodeId));
      else if (a.state === 'start' && a.nodeId) this.narration.part(a.id, a.nodeId);
      else if (a.state !== 'start' && this.narration.ended(a.id)) {
        if (this.runEnded) clearTimeout(this.runEnded);
        this.runEnded = setTimeout(() => (this.runEnded = null), 0);
        this.runEnded.unref?.();
      }
    } else if (message.t === 'change') {
      const cards = this.deps.cards(message.set);
      if (cards.length === 0) return;
      for (const card of cards) this.narration.landed(card);
    } else if (message.t === 'say') {
      if (message.kind === 'results' && this.runEnded) {
        clearTimeout(this.runEnded);
        this.runEnded = null;
      } else {
        this.notes.push(`[From the agents] ${message.text}`);
      }
    } else {
      return;
    }
    this.drain();
  }

  /**
   * The device left, or the service cut the session for a limit. Nothing of a turn or an answer is kept, as when the session is lost,
   * so the next session does not cancel its own first answer for one asked of this one.
   */
  /** The headset's look at what the user marked on a picture (WS89): kept until the next, or until the card's marks are gone. */
  look(look: Look): void {
    if (!look.crop || !look.whole) {
      if (!look.nodeId || this.sight?.nodeId === look.nodeId) this.sight = null;
      return;
    }
    this.sight = { ...(look.nodeId ? { nodeId: look.nodeId } : {}), title: look.title, crop: look.crop, whole: look.whole, at: this.now(), shown: false };
  }

  /**
   * Shows Momo what the user marked, once a session, before the words of a turn about it: a card of the service's while it is
   * the one open (`focus`), and the headset's own picture if it was marked in the last five minutes.
   */
  private showSight(focus: string | undefined): void {
    const s = this.sight;
    if (!s || s.shown || !this.session) return;
    if (s.nodeId ? focus !== s.nodeId : this.now() - s.at > SIGHT_MS) return;
    this.session.send({ type: 'conversation.item.create', item: sightItem(s) });
    s.shown = true;
    this.deps.log(`[live] Momo is shown what is marked on ${s.title}`);
  }

  close(): void {
    for (const timer of [this.idle, this.wake, this.expected?.timer, this.runEnded, this.naming?.timer]) if (timer) clearTimeout(timer);
    this.idle = this.wake = this.expected = this.runEnded = this.naming = null;
    this.session?.close();
    this.session = null;
    this.forget();
  }

  private transcription(scene: Scene): Record<string, unknown> {
    return { model: this.deps.options.hearing, prompt: hearingPrompt(this.deps.name(), this.deps.words(scene)) };
  }

  private ensure(): Realtime {
    if (this.session) return this.session;
    const { options } = this.deps;
    const session = this.deps.open({
      event: (e) => {
        if (this.session === session) this.event(e);
      },
      closed: (why) => {
        if (this.session === session) this.lost(why);
      },
    });
    this.session = session;
    this.toldWhere = null;
    // A new conversation has seen nothing yet: what is marked is shown again with the next turn about it.
    if (this.sight) this.sight.shown = false;
    const today = new Date(this.now()).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    session.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: options.model,
        output_modalities: ['audio'],
        instructions: instructions(this.deps.name(), today) + (this.deps.extra ? `\n\n${this.deps.extra()}` : ''),
        tools: this.deps.tools(),
        tool_choice: 'auto',
        audio: {
          input: { format: { type: 'audio/pcm', rate: RATE }, transcription: this.transcription({ selection: [] }), turn_detection: turnDetection(options.turn) },
          output: { format: { type: 'audio/pcm', rate: RATE }, voice: options.voice },
        },
        ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
      },
    });
    this.deps.log(`[live] session opened (${options.model}, ${options.voice}, hearing with ${options.hearing})`);
    return session;
  }

  /** Momo is told where the user is when it changed since it was last told. */
  private tellWhere(): void {
    const where = this.deps.where(this.scene);
    if (where === this.toldWhere) return;
    this.toldWhere = where;
    this.note(`[Where the user is] ${where}`);
  }

  private note(text: string): void {
    this.session?.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
  }

  private event(e: RealtimeEvent): void {
    this.touch();
    const now = this.now();
    if (TRACED.has(e.type)) this.deps.log(`[live] ${e.type}`);
    switch (e.type) {
      case 'input_audio_buffer.speech_started':
        if (this.hearing?.committed) {
          // The user went on after a pause the turn detection took for the end: the turn goes on, and its answer waits.
          this.hearing.committed = false;
          if (this.expected) clearTimeout(this.expected.timer);
          this.expected = null;
          this.deps.log(`[live] turn ${this.hearing.turn} goes on after a pause`);
        }
        return;
      case 'input_audio_buffer.speech_stopped':
        if (this.hearing) this.hearing.stopped = now;
        return;
      case 'input_audio_buffer.committed': {
        const heard = this.hearing;
        if (!heard) return;
        this.naming?.items.push(e.item_id as string);
        this.transcribing.set(e.item_id as string, { turn: heard.turn, text: '', over: now });
        this.answering = { turn: heard.turn, at: heard.stopped ?? now };
        if (heard.stopped !== undefined) this.deps.log(`[live] turn ${heard.turn} over ${now - heard.stopped} ms after the model heard the end of speech`);
        // The turn detection answers a turn it ended itself; one the device ended was asked for with its end, and one it is slow
        // to answer the service asks for.
        if (heard.manual) return;
        heard.committed = true;
        if (this.expected) clearTimeout(this.expected.timer);
        const timer = setTimeout(() => {
          if (this.expected?.turn !== heard.turn) return;
          this.expected = null;
          this.deps.log(`[live] turn ${heard.turn}: no answer began, so one is asked for`);
          if (!this.speaking && !this.asked) this.ask({ kind: 'reply', turn: heard.turn }, false);
        }, this.deps.answerWaitMs ?? ANSWER_WAIT_MS);
        timer.unref?.();
        this.expected = { turn: heard.turn, at: now, timer };
        return;
      }
      case 'conversation.item.input_audio_transcription.delta': {
        const t = this.transcribing.get(e.item_id as string);
        if (!t) return;
        t.text += e.delta as string;
        this.device({ t: 'heard', turn: t.turn, text: this.wordsOf(t.turn, t.text), final: false });
        return;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const t = this.transcribing.get(e.item_id as string);
        if (!t) return;
        this.transcribing.delete(e.item_id as string);
        const text = String(e.transcript ?? '').trim();
        const usage = e.usage as Usage | undefined;
        const dollars = usage ? cost(this.deps.options.hearing, usage) : null;
        if (dollars !== null) this.deps.spent?.(dollars);
        this.deps.log(`[live] turn ${t.turn} written down ${now - t.over} ms after it was over: ${text}${dollars === null ? '' : ` ($${dollars.toFixed(5)})`}`);
        const whole = this.wordsOf(t.turn, text);
        if (this.words.turn === t.turn) this.words.text = whole;
        this.device({ t: 'heard', turn: t.turn, text: whole, final: true });
        const clean = withoutWakePhrase(text, this.deps.name()).trim();
        if (clean) this.afterCheck(() => this.deps.spoken({ who: 'user', text: clean }));
        for (const look of [...this.waiting]) look();
        return;
      }
      case 'conversation.item.input_audio_transcription.failed': {
        const t = this.transcribing.get(e.item_id as string);
        if (!t) return;
        this.transcribing.delete(e.item_id as string);
        this.deps.log(`[live] turn ${t.turn} could not be written down: ${JSON.stringify(e.error ?? '')}`);
        for (const look of [...this.waiting]) look();
        return;
      }
      case 'response.created': {
        const response = e.response as { id: string; metadata?: { purpose?: string } | null };
        const ours = Boolean(response.metadata?.purpose);
        // The user went on talking over a pause, so the turn detection's answer to the first part is not wanted.
        const early = !ours && Boolean(this.hearing) && !this.hearing?.committed && !this.hearing?.manual;
        if (ours ? this.cancelling > 0 : this.cancelExpected || early) {
          if (ours) this.cancelling -= 1;
          else if (!early) this.cancelExpected = false;
          this.session?.send({ type: 'response.cancel', response_id: response.id });
          return;
        }
        // The answer begins, so the turn is over: the device stops sending, plays the sent tone and thinks until it is heard.
        if (this.hearing && (!ours || this.asked?.purpose.kind === 'reply')) {
          this.device({ t: 'over', turn: this.hearing.turn });
          this.hearing = null;
        }
        let purpose: Purpose = { kind: 'reply' };
        let at = now;
        if (ours && this.asked) {
          purpose = this.asked.purpose;
          at = this.asked.at;
          this.asked = null;
        } else if (!ours && this.expected) {
          purpose = { kind: 'reply', turn: this.expected.turn };
          at = this.expected.at;
          clearTimeout(this.expected.timer);
          this.expected = null;
        }
        this.speaking = { id: response.id, purpose, text: '', heard: false, calls: new Set(), at };
        return;
      }
      case 'response.output_item.added': {
        const item = e.item as { id?: string; type?: string; call_id?: string; name?: string } | undefined;
        if (item?.type === 'function_call' && item.call_id && item.name) this.names.set(item.call_id, item.name);
        if (item?.id) this.naming?.items.push(item.id);
        return;
      }
      case 'response.output_audio_transcript.delta': {
        const m = this.speaking;
        if (!m || m.id !== e.response_id) return;
        m.text += e.delta as string;
        this.device({ t: 'text', id: m.id, text: this.code ? inDigits(m.text) : m.text, kind: m.purpose.kind, ...(m.purpose.kind === 'reply' && m.purpose.turn !== undefined ? { turn: m.purpose.turn } : {}) });
        return;
      }
      case 'response.output_audio.delta': {
        const m = this.speaking;
        if (!m || m.id !== e.response_id) return;
        const item = String(e.item_id ?? m.id);
        let piece = this.played.at(-1);
        if (piece?.item !== item) {
          piece = { item, from: Math.max(now, this.playedUntil), ms: 0 };
          this.played.push(piece);
          if (this.played.length > 8) this.played.shift();
        }
        if (!m.heard) {
          m.heard = true;
          this.deps.log(`[live] ${m.purpose.kind === 'reply' && m.purpose.turn !== undefined ? `turn ${m.purpose.turn}'s answer` : `the ${m.purpose.kind}`}: first sound ${now - m.at} ms after it was asked for`);
          if (m.purpose.kind === 'reply' && this.answering) {
            this.deps.log(`[live] turn ${this.answering.turn} first heard ${now - this.answering.at} ms after the end of speech`);
            this.answering = null;
          }
        }
        piece.ms += Buffer.byteLength(e.delta as string, 'base64') / BYTES_PER_MS;
        this.playedUntil = piece.from + piece.ms;
        this.device({ t: 'audio', id: m.id, pcm: e.delta as string });
        return;
      }
      case 'response.function_call_arguments.done':
        this.called(String(e.call_id), (e.name as string | undefined) ?? this.names.get(String(e.call_id)) ?? '', String(e.arguments ?? ''));
        return;
      case 'response.done': {
        const response = e.response as { id: string; status: string; usage?: Usage; output?: { type: string; call_id?: string; name?: string; arguments?: string }[] };
        const m = this.speaking;
        if (!m || m.id !== response.id) return;
        // A call the arguments event did not announce is still run.
        for (const out of response.output ?? []) if (out.type === 'function_call' && out.call_id) this.called(out.call_id, out.name ?? '', out.arguments ?? '');
        this.speaking = null;
        const dollars = response.usage ? cost(this.deps.options.model, response.usage) : null;
        if (dollars !== null) this.deps.spent?.(dollars);
        this.deps.log(`[live] ${m.purpose.kind} ${response.status}${m.calls.size ? ` with ${[...m.calls].map((c) => this.names.get(c) ?? '?').join(', ')}` : ''}: ${m.text}${dollars === null ? '' : ` ($${dollars.toFixed(4)})`}`);
        if (m.text || m.heard) this.device({ t: 'done', id: m.id, ...(response.usage ? { usage: response.usage } : {}) });
        if (m.text.trim() && response.status === 'completed') this.afterCheck(() => this.deps.spoken({ who: 'agent', text: m.text.trim() }));
        const a = this.answering;
        const waits = a && ([...this.calls.values()].some((c) => c.turn === a.turn) || this.ready.some((r) => r.turn === a.turn && r.answer));
        if (a && m.purpose.kind === 'reply' && m.purpose.turn === a.turn && !m.heard && !waits) {
          this.answering = null;
          this.device({ t: 'quiet', turn: a.turn });
        }
        this.drain();
        return;
      }
      case 'error': {
        const error = e.error as { message?: string; code?: string } | undefined;
        this.deps.log(`[live] the model refused an event: ${error?.code ?? ''} ${error?.message ?? ''}`.trim());
        if (error?.code === 'session_expired') {
          // OpenAI ends a session after 60 minutes and may leave its socket open: a new one opens at the next name.
          const session = this.session;
          this.lost('the session expired');
          session?.close();
          return;
        }
        if (error?.code === 'conversation_already_has_active_response' && this.asked) {
          // The turn detection began one first. What was asked waits for it to end, unless it was that same turn's answer.
          if (this.asked.retry) this.refused = this.asked.purpose;
          this.asked = null;
        }
        return;
      }
    }
  }

  /** The model called a tool: it runs at once, while the response that called it may still be speaking. */
  private called(call: string, name: string, args: string): void {
    if (!call || this.ran.has(call)) return;
    this.ran.add(call);
    const turn = this.speaking?.purpose.kind === 'reply' ? this.speaking.purpose.turn : undefined;
    this.speaking?.calls.add(call);
    this.names.set(call, name);
    this.calls.set(call, { name, ...(turn !== undefined ? { turn } : {}) });
    this.naming?.calls.push(call);
    this.afterCheck(() => void this.run(call, name, args, turn));
  }

  /** Does it now, or once the wake being checked is found to be the name, and never if it is not. */
  private afterCheck(go: () => void): void {
    if (this.naming) this.naming.held.push(go);
    else go();
  }

  private async run(call: string, name: string, args: string, turn: number | undefined): Promise<void> {
    const at = this.now();
    const label = this.deps.label(name, args);
    const step = (state: Activity['state']) => label && this.deps.activity({ id: `momo-${call}`, role: 'momo', state, label, message: label });
    step('start');
    let output: ToolOutput;
    try {
      output = await this.deps.call(name, args, this.scene, () => this.said(turn));
    } catch (err) {
      output = { error: `It failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    step(output.error ? 'error' : 'done');
    this.calls.delete(call);
    this.deps.log(`[live] ${name}(${args}) answered in ${this.now() - at} ms: ${JSON.stringify(output).slice(0, 400)}`);
    if (typeof output.code === 'string') this.code = true;
    if (!this.session) return;
    // An act Momo announced as it called it needs no more words, unless it could not be done or nothing was heard of the turn yet.
    const answer = ANSWERS.has(name) || 'error' in output || 'why' in output || (turn !== undefined && this.answering?.turn === turn);
    this.ready.push({ call, output: JSON.stringify(output), answer, ...(turn !== undefined ? { turn } : {}) });
    this.drain();
  }

  /** The user's words in `turn`, without the name, once written down: a piece still being written is waited for until `SAID_MS` after the turn was over. */
  private async said(turn: number | undefined): Promise<string | undefined> {
    if (turn === undefined) return undefined;
    const writing = () => [...this.transcribing.values()].filter((t) => t.turn === turn);
    if (writing().length > 0) {
      const left = Math.max(...writing().map((t) => t.over)) + SAID_MS - this.now();
      await new Promise<void>((done) => {
        const stop = () => {
          clearTimeout(timer);
          this.waiting.delete(look);
          done();
        };
        const look = () => writing().length === 0 && stop();
        const timer = setTimeout(stop, Math.max(0, left));
        this.waiting.add(look);
      });
      if (writing().length > 0) {
        this.deps.log(`[live] turn ${turn} not written down ${SAID_MS} ms after it was over: the call goes on without the user's words`);
        return undefined;
      }
    }
    return this.words.turn === turn && this.words.text ? this.words.text : undefined;
  }

  /**
   * Hands the model what waits once nobody has the floor (the user is not being heard and Momo is not answering): calls' outputs
   * first, since the user waits on them, then lines from the pipeline, then what landed.
   */
  private drain(): void {
    if (this.wake) clearTimeout(this.wake);
    this.wake = null;
    if (!this.session || this.hearing || this.speaking || this.asked || this.expected) return;
    const now = this.now();
    if (this.refused) {
      const again = this.refused;
      this.refused = null;
      return this.ask(again);
    }
    if (this.ready.length > 0) {
      const outputs = this.ready.splice(0);
      for (const r of outputs) this.session.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: r.call, output: r.output } });
      const speak = outputs.find((r) => r.answer);
      if (speak) return this.ask({ kind: 'reply', ...(speak.turn !== undefined ? { turn: speak.turn } : {}) });
    }
    const note = this.notes.shift() ?? this.narration.next(now);
    if (note) {
      this.note(note);
      this.deps.log(`[live] told: ${note}`);
      return this.ask({ kind: 'results' });
    }
    const due = this.narration.due();
    if (due !== null) {
      this.wake = setTimeout(() => this.drain(), Math.max(0, due - now));
      this.wake.unref?.();
    }
  }

  private ask(purpose: Purpose, retry = true): void {
    this.asked = { purpose, at: this.now(), retry };
    this.session?.send({ type: 'response.create', response: { metadata: { purpose: purpose.kind }, ...(purpose.kind === 'reply' && purpose.tools === false ? { tool_choice: 'none' } : {}) } });
  }

  /** Stops what Momo is saying, and cuts each piece of its voice in the conversation where the device was when the user spoke. */
  private hush(): void {
    const now = this.now();
    if (this.asked) {
      this.cancelling += 1;
      this.asked = null;
    }
    if (this.expected) {
      clearTimeout(this.expected.timer);
      this.expected = null;
      this.cancelExpected = true;
    }
    if (this.speaking) {
      this.session?.send({ type: 'response.cancel', response_id: this.speaking.id });
      this.deps.log(`[live] ${this.speaking.purpose.kind} cut short: ${this.speaking.text}`);
      this.speaking = null;
    }
    for (const p of this.played) {
      if (p.from + p.ms <= now) continue;
      const heardMs = Math.max(0, Math.floor(now - p.from));
      this.session?.send({ type: 'conversation.item.truncate', item_id: p.item, content_index: 0, audio_end_ms: heardMs });
      this.deps.log(`[live] cut at ${heardMs} of ${Math.round(p.ms)} ms`);
    }
    this.played = [];
    this.playedUntil = now;
    this.answering = null;
  }

  private lost(why: string): void {
    this.deps.log(`[live] session closed: ${why}`);
    this.session = null;
    // Nothing is left for a check to let through or undo, and the device is told of the failure at once.
    if (this.naming) clearTimeout(this.naming.timer);
    this.naming = null;
    const busy = Boolean(this.hearing) || this.transcribing.size > 0 || Boolean(this.speaking) || Boolean(this.asked) || Boolean(this.expected);
    this.forget();
    if (busy) this.device({ t: 'failed', why });
  }

  /** What a session's turns and answers left behind. */
  private forget(): void {
    if (this.expected) clearTimeout(this.expected.timer);
    this.hearing = this.speaking = this.asked = this.expected = this.answering = null;
    this.transcribing.clear();
    this.ready = [];
    this.refused = null;
    this.cancelling = 0;
    this.cancelExpected = false;
  }

  /** Something happened: the session stays open until nothing has for a while. */
  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.hearing || this.speaking || this.asked || this.calls.size > 0 || !this.session) return;
      this.deps.log('[live] session closed after five quiet minutes');
      this.session.close();
      this.session = null;
    }, this.deps.idleMs ?? IDLE_MS);
    this.idle.unref?.();
  }
}
