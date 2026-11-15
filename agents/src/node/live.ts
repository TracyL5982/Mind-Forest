import type { Activity } from '../core/pipeline.ts';
import type { Scene, VoiceStyle } from '../core/roles/types.ts';
import { withoutWakePhrase } from '../core/wake.ts';
import type { DeviceFrame } from './protocol.ts';

/**
 * Momo's real-time voice for one device (`/live`): OpenAI's realtime model is Momo's ears and mouth, and nothing else. After the wake
 * the device's microphone goes to the model, whose turn detection hears when the user is done and whose transcription writes down what
 * they said. The model never answers the user itself: the transcript goes to the pipeline as a final utterance, and the model speaks
 * each `say` the pipeline makes, in one voice, in its own words or as written. The frames are in docs/protocol.md; why it is built this
 * way is in agents/DECISIONS.md (41 and 42).
 */

export type SayKind = 'reply' | 'results';

/** What the service sends a device on `/live`. Audio is base64 of 16-bit mono PCM at `ready.rate`. */
export type VoiceFrame =
  | { t: 'ready'; rate: number }
  | { t: 'over'; turn: number }
  | { t: 'heard'; turn: number; text: string; final: boolean }
  | { t: 'quiet'; turn: number }
  | { t: 'text'; id: string; text: string; kind: SayKind }
  | { t: 'audio'; id: string; pcm: string }
  | { t: 'done'; id: string; usage?: Usage }
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
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

export const RATE = 24000;
const IDLE_MS = 5 * 60 * 1000;
/** How long a turn waits for its reply before the device is told none is coming. */
const OWED_MS = 15_000;
/** 16-bit mono at RATE. */
const BYTES_PER_MS = (RATE * 2) / 1000;

/**
 * Dollars per million tokens (https://developers.openai.com/api/docs/pricing): the realtime models as read on 2026-11-14, the
 * transcription models as they were listed in 2025 and not read again.
 */
const PRICES: Record<string, { audioIn: number; audioCached: number; audioOut: number; textIn: number; textCached: number; textOut: number }> = {
  'gpt-realtime-2.1': { audioIn: 32, audioCached: 0.4, audioOut: 64, textIn: 4, textCached: 0.4, textOut: 24 },
  'gpt-realtime-2.1-mini': { audioIn: 10, audioCached: 0.3, audioOut: 20, textIn: 0.6, textCached: 0.06, textOut: 2.4 },
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
  // A transcription reports its output as a total only, and all of it is text.
  const textOut = output ? (output.text_tokens ?? 0) : (usage.output_tokens ?? 0);
  const dollars =
    ((input.audio_tokens ?? 0) - audioCached) * p.audioIn + audioCached * p.audioCached +
    ((input.text_tokens ?? 0) - textCached) * p.textIn + textCached * p.textCached +
    (output?.audio_tokens ?? 0) * p.audioOut + textOut * p.textOut;
  return dollars / 1e6;
}

export interface LiveOptions {
  model: string;
  voice: string;
  /** How the model hears the end of a turn: by meaning (`semantic`, eager) or by a pause of `ms` (`server`). */
  turn: { kind: 'semantic' } | { kind: 'server'; ms: number };
  /** The model that writes down what the user said. */
  hearing: string;
  /** For the reasoning models: how hard it thinks before it speaks. */
  effort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface LiveDeps {
  open: OpenRealtime;
  options: LiveOptions;
  /** Hands what the user said to the pipeline, as a final utterance said in that scene. */
  utter: (text: string, scene: Scene) => void;
  /** How Momo says the pipeline's lines. */
  style: () => VoiceStyle;
  /** What the user calls the agent. */
  name: () => string;
  /** Words the user is likely to say in this scene, such as their card titles, for the transcription. */
  words: (scene: Scene) => string;
  log: (line: string) => void;
  now?: () => number;
  idleMs?: number;
  owedMs?: number;
}

/** One line of the pipeline's for Momo to say. A reply answers `turn` when it is the turn's. */
export interface Line {
  text: string;
  kind: SayKind;
  turn?: number;
}

/** Something said lately. Momo's lines carry when they began to play and for how long, so a cut can be placed in them. */
interface Said {
  who: 'user' | 'momo';
  text: string;
  from?: number;
  ms?: number;
}

/** What the model is told when it speaks a line: who it is, and the last few things said, oldest first. */
export interface Lately {
  name: string;
  turns: readonly { who: 'user' | 'momo'; text: string }[];
}

/** Which language to speak: the one the user last spoke, named when its script says it. */
function language(lately: Lately): string {
  const user = [...lately.turns].reverse().find((t) => t.who === 'user')?.text;
  if (!user) return 'the language of the message';
  if (/[぀-ヿ]/.test(user)) return 'Japanese';
  if (/[가-힯]/.test(user)) return 'Korean';
  if (/[㐀-鿿]/.test(user)) return 'Mandarin Chinese';
  return `the language the user last spoke, as in "${user}"`;
}

/**
 * The instructions for speaking one line. 'own words' keeps every fact, name and number and adds nothing, about as short, in the user's
 * language, beginning differently from the last lines. 'verbatim' says exactly the text.
 */
export function lineInstructions(line: Pick<Line, 'text'>, style: VoiceStyle, lately: Lately): string {
  const role = `# Role
You are ${lately.name}, the voice of Mind Palace, where the user brainstorms in VR. Mind Palace's agents decide what to say. You only say it out loud, warm, calm and natural. You never answer, ask, offer or decide anything yourself.`;
  if (style === 'verbatim') {
    return `${role}

# Say exactly this, word for word, and nothing before or after it
${line.text}

# Rules
Do not translate, shorten, explain or add anything. Say every title and number as written.`;
  }
  const lines = lately.turns.slice(-6).map((t) => `${t.who === 'user' ? 'User' : 'You'}: ${t.text}`);
  return `${role}

# The message to say
${line.text}

# Rules
- Say the message in your own words, as one person talking to another.
- Keep every fact, name, title and number in it. Say each title exactly as written.
- Keep what each thing is: a film stays a film, a thing stays a thing, never an idea.
- A message about what is being done stays a statement about it. Never make it a request or a command.
- Add nothing it does not say: no facts, opinions, offers, promises, questions or greetings, and never that you have, got or found something unless it says so.
- About as short as the message, never longer. Never a list.
- Speak ${language(lately)}. Titles stay as written.
- Never say your own name, nor "Hey ${lately.name}".${lines.length ? `\n- Begin differently from your last lines.\n\n# Said lately\n${lines.join('\n')}` : ''}`;
}

function turnDetection(turn: LiveOptions['turn']): Record<string, unknown> {
  // The pipeline answers every turn, so the model makes no response of its own, and only the device stops Momo.
  const common = { create_response: false, interrupt_response: false };
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

/** The model's events that say who has the floor, logged as they come so a turn can be followed. */
const TRACED = new Set(['input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'input_audio_buffer.committed', 'input_audio_buffer.timeout_triggered']);

/** Momo's mouth: saying nothing, a line asked of the model and not begun, or a line being said. */
type Mouth =
  | { kind: 'quiet' }
  | { kind: 'asked'; line: Line; at: number; cancel: boolean }
  | { kind: 'speaking'; line: Line; id: string; at: number; said: Said };

/** The newest turn whose reply has not been said, and the Conductor run that answers it, once one starts. */
interface Owed {
  turn: number;
  conductor?: string;
  timer: ReturnType<typeof setTimeout>;
}

export class LiveVoice {
  private session: Realtime | null = null;
  /** The user's turn while it is heard, from the name until the model hears its end. */
  private hearing: { turn: number; scene: Scene; stopped?: number } | null = null;
  /** Turns heard and being written down, by the model's item. */
  private transcribing = new Map<string, { turn: number; scene: Scene; text: string; over: number }>();
  private owed: Owed | null = null;
  /** The user spoke over a turn still waiting for its reply: that reply, if it comes before the next utterance, is not said. */
  private stale = false;
  private mouth: Mouth = { kind: 'quiet' };
  private queue: Line[] = [];
  /** When everything sent to the device so far will have played there. */
  private playedUntil = 0;
  private turns: Said[] = [];
  private upsampler = new Upsampler();
  private idle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: LiveDeps,
    private readonly device: (frame: VoiceFrame) => void,
  ) {
    device({ t: 'ready', rate: RATE });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** A frame from the device. */
  heard(frame: DeviceFrame): void {
    this.touch();
    switch (frame.t) {
      case 'start': {
        const s = this.ensure();
        this.hush();
        if (this.owed) {
          this.stale = true;
          this.settle(null);
        }
        s.send({ type: 'session.update', session: { type: 'realtime', audio: { input: { transcription: this.transcription(frame.scene) } } } });
        s.send({ type: 'input_audio_buffer.clear' });
        this.upsampler = new Upsampler();
        this.hearing = { turn: frame.turn, scene: frame.scene };
        return;
      }
      case 'audio':
        if (!this.hearing || !this.session) return;
        this.session.send({ type: 'input_audio_buffer.append', audio: this.upsampler.push(Buffer.from(frame.pcm, 'base64')).toString('base64') });
        return;
      case 'end':
        if (!this.hearing || !this.session) return;
        this.session.send({ type: 'input_audio_buffer.commit' });
        return;
      case 'cancel':
        if (!this.hearing || !this.session) return;
        this.session.send({ type: 'input_audio_buffer.clear' });
        this.hearing = null;
        this.stale = false;
        this.drain();
        return;
    }
  }

  /** A line the pipeline said. Without a kind, the first after the user's utterance is its reply and any other is news. */
  said(text: string, kind?: SayKind): void {
    const k = kind ?? (this.owed ? 'reply' : 'results');
    if (k === 'reply' && this.stale) {
      this.deps.log(`[live] not said, since the user spoke over the turn it answers: ${text}`);
      return;
    }
    const line: Line = { text, kind: k, ...(k === 'reply' && this.owed ? { turn: this.owed.turn } : {}) };
    if (k === 'reply') {
      this.settle(null);
      const firstNews = this.queue.findIndex((l) => l.kind !== 'reply');
      this.queue.splice(firstNews < 0 ? this.queue.length : firstNews, 0, line);
    } else {
      this.queue.push(line);
    }
    this.drain();
  }

  /** The pipeline's work. The Conductor run that answers the owed turn ends either with its reply or with nothing to say. */
  activity(a: Activity): void {
    if (a.role !== 'conductor' || !this.owed) return;
    if (a.state === 'start') {
      this.owed.conductor ??= a.id;
      return;
    }
    if (a.id !== this.owed.conductor) return;
    const owed = this.owed;
    if (a.state === 'error') {
      this.settle(owed.turn, 'the Conductor failed, so nothing is said');
      return;
    }
    // When there is a reply, the pipeline says it straight after the Conductor ends, before this runs.
    setTimeout(() => {
      if (this.owed === owed) this.settle(owed.turn, 'the pipeline had nothing to say');
    }, 0);
  }

  /** The device left. */
  close(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (this.owed) clearTimeout(this.owed.timer);
    this.owed = null;
    this.session?.close();
    this.session = null;
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
    session.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: options.model,
        output_modalities: ['audio'],
        instructions: `You are ${this.deps.name()}, the voice of Mind Palace. You only say the lines you are given.`,
        audio: {
          input: { format: { type: 'audio/pcm', rate: RATE }, transcription: this.transcription({ selection: [] }), turn_detection: turnDetection(options.turn) },
          output: { format: { type: 'audio/pcm', rate: RATE }, voice: options.voice },
        },
        ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
      },
    });
    this.deps.log(`[live] session opened (${options.model}, hearing with ${options.hearing})`);
    return session;
  }

  private event(e: RealtimeEvent): void {
    this.touch();
    const now = this.now();
    if (TRACED.has(e.type)) this.deps.log(`[live] ${e.type}`);
    switch (e.type) {
      case 'input_audio_buffer.speech_stopped':
        if (this.hearing) this.hearing.stopped = now;
        return;
      case 'input_audio_buffer.committed': {
        const heard = this.hearing;
        if (!heard) return;
        this.hearing = null;
        this.transcribing.set(e.item_id as string, { turn: heard.turn, scene: heard.scene, text: '', over: now });
        this.device({ t: 'over', turn: heard.turn });
        if (heard.stopped !== undefined) this.deps.log(`[live] turn ${heard.turn} over ${now - heard.stopped} ms after the model heard the end of speech`);
        return;
      }
      case 'conversation.item.input_audio_transcription.delta': {
        const t = this.transcribing.get(e.item_id as string);
        if (!t) return;
        t.text += e.delta as string;
        this.device({ t: 'heard', turn: t.turn, text: t.text, final: false });
        return;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const t = this.transcribing.get(e.item_id as string);
        if (!t) return;
        this.transcribing.delete(e.item_id as string);
        const text = String(e.transcript ?? '').trim();
        const usage = e.usage as Usage | undefined;
        const dollars = usage ? cost(this.deps.options.hearing, usage) : null;
        this.deps.log(`[live] turn ${t.turn} written down ${now - t.over} ms after it was over: ${text}${dollars === null ? '' : ` ($${dollars.toFixed(5)})`}`);
        this.device({ t: 'heard', turn: t.turn, text, final: true });
        // The user's audio is in the model's conversation, where no response reads it.
        this.session?.send({ type: 'conversation.item.delete', item_id: e.item_id });
        this.handOn(t.turn, text, t.scene);
        return;
      }
      case 'conversation.item.input_audio_transcription.failed': {
        const t = this.transcribing.get(e.item_id as string);
        if (!t) return;
        this.transcribing.delete(e.item_id as string);
        this.deps.log(`[live] turn ${t.turn} could not be written down: ${JSON.stringify(e.error ?? '')}`);
        this.device({ t: 'quiet', turn: t.turn });
        this.drain();
        return;
      }
      case 'response.created': {
        if (this.mouth.kind !== 'asked') return;
        const id = (e.response as { id: string }).id;
        const { line, at, cancel } = this.mouth;
        if (cancel) {
          this.session?.send({ type: 'response.cancel', response_id: id });
          this.mouth = { kind: 'quiet' };
          this.drain();
          return;
        }
        this.mouth = { kind: 'speaking', line, id, at, said: { who: 'momo', text: '' } };
        return;
      }
      case 'response.output_audio_transcript.delta': {
        const m = this.mouth;
        if (m.kind !== 'speaking' || m.id !== e.response_id) return;
        m.said.text += e.delta as string;
        this.device({ t: 'text', id: m.id, text: m.said.text, kind: m.line.kind });
        return;
      }
      case 'response.output_audio.delta': {
        const m = this.mouth;
        if (m.kind !== 'speaking' || m.id !== e.response_id) return;
        if (m.said.from === undefined) {
          m.said.from = Math.max(now, this.playedUntil);
          m.said.ms = 0;
          this.deps.log(`[live] ${m.line.turn !== undefined ? `turn ${m.line.turn}: the reply's` : `the ${m.line.kind} line's`} first sound ${now - m.at} ms after it was asked for`);
        }
        m.said.ms = (m.said.ms ?? 0) + Buffer.byteLength(e.delta as string, 'base64') / BYTES_PER_MS;
        this.playedUntil = m.said.from + m.said.ms;
        this.device({ t: 'audio', id: m.id, pcm: e.delta as string });
        return;
      }
      case 'response.done': {
        const response = e.response as { id: string; status: string; usage?: Usage };
        const m = this.mouth;
        if (m.kind !== 'speaking' || m.id !== response.id) return;
        const dollars = response.usage ? cost(this.deps.options.model, response.usage) : null;
        this.deps.log(`[live] ${m.line.kind} ${response.status}: ${m.said.text}${dollars === null ? '' : ` ($${dollars.toFixed(4)})`}`);
        this.device({ t: 'done', id: m.id, ...(response.usage ? { usage: response.usage } : {}) });
        if (m.said.from !== undefined) this.remember(m.said);
        else if (m.line.turn !== undefined) this.device({ t: 'quiet', turn: m.line.turn });
        this.mouth = { kind: 'quiet' };
        this.drain();
        return;
      }
      case 'error': {
        const error = e.error as { message?: string; code?: string } | undefined;
        this.deps.log(`[live] the model refused an event: ${error?.code ?? ''} ${error?.message ?? ''}`.trim());
        return;
      }
    }
  }

  /** The turn's words go to the pipeline, unless they were only the name. */
  private handOn(turn: number, text: string, scene: Scene): void {
    this.stale = false;
    const clean = withoutWakePhrase(text, this.deps.name()).trim();
    if (!clean) {
      this.device({ t: 'quiet', turn });
      this.drain();
      return;
    }
    this.remember({ who: 'user', text: clean });
    this.settle(null);
    const owed: Owed = { turn, timer: setTimeout(() => this.owed === owed && this.settle(turn, 'no reply came'), this.deps.owedMs ?? OWED_MS) };
    owed.timer.unref?.();
    this.owed = owed;
    this.deps.utter(text, scene);
  }

  /** The owed turn is done with: answered (`quiet` null), or with nothing to say, which the device is told. */
  private settle(quiet: number | null, why?: string): void {
    if (this.owed) clearTimeout(this.owed.timer);
    this.owed = null;
    if (quiet === null) return;
    this.deps.log(`[live] turn ${quiet}: ${why ?? 'nothing to say'}`);
    this.device({ t: 'quiet', turn: quiet });
    this.drain();
  }

  /** Stops what Momo is saying, and remembers of each line only what the device has played of it by now. */
  private hush(): void {
    const now = this.now();
    const m = this.mouth;
    if (m.kind === 'asked') m.cancel = true;
    if (m.kind === 'speaking') {
      this.session?.send({ type: 'response.cancel', response_id: m.id });
      this.deps.log(`[live] ${m.line.kind} cut short: ${m.said.text}`);
      if (m.said.from !== undefined) this.remember(m.said);
      this.mouth = { kind: 'quiet' };
    }
    for (const t of this.turns) {
      if (t.from === undefined || t.ms === undefined) continue;
      if (t.from >= now) t.text = '';
      else if (t.from + t.ms > now) t.text = cut(t.text, (now - t.from) / t.ms);
    }
    this.turns = this.turns.filter((t) => t.text);
    this.playedUntil = now;
  }

  /** Says what is waiting, one line at a time, once the user is not being heard. A turn's reply goes before the news. */
  private drain(): void {
    if (this.hearing || this.mouth.kind !== 'quiet') return;
    const next = this.queue[0];
    if (!next) return;
    if (next.kind !== 'reply' && (this.owed || this.transcribing.size > 0)) return;
    this.queue.shift();
    const s = this.ensure();
    s.send({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['audio'],
        instructions: lineInstructions(next, this.deps.style(), { name: this.deps.name(), turns: this.turns }),
        input: [],
        metadata: { kind: next.kind },
      },
    });
    this.mouth = { kind: 'asked', line: next, at: this.now(), cancel: false };
  }

  private remember(said: Said): void {
    if (!said.text.trim()) return;
    this.turns.push(said);
    if (this.turns.length > 6) this.turns.shift();
  }

  private lost(why: string): void {
    this.deps.log(`[live] session closed: ${why}`);
    this.session = null;
    const busy = Boolean(this.hearing) || this.transcribing.size > 0 || this.mouth.kind !== 'quiet';
    this.hearing = null;
    this.transcribing.clear();
    this.mouth = { kind: 'quiet' };
    if (busy) this.device({ t: 'failed', why });
  }

  /** Something happened: the session stays open until nothing has for a while. */
  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.hearing || this.mouth.kind !== 'quiet' || this.queue.length > 0 || !this.session) return;
      this.deps.log('[live] session closed after five quiet minutes');
      this.session.close();
      this.session = null;
    }, this.deps.idleMs ?? IDLE_MS);
    this.idle.unref?.();
  }
}

/** What was heard of a line `share` of the way through it, ending at a whole word, marked as cut short. */
export function cut(text: string, share: number): string {
  const chars = [...text];
  const at = Math.round(chars.length * Math.max(0, Math.min(1, share)));
  if (at >= chars.length) return text;
  const head = chars.slice(0, at).join('');
  const whole = /\s/.test(head) ? head.replace(/\s+\S*$/, '') : head;
  return `${whole.trimEnd()}…`;
}
