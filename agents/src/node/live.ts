import type { Id } from '../core/domain.ts';
import { brief } from '../core/roles/questions.ts';
import type { Scene } from '../core/roles/types.ts';
import type { Mindstorm } from '../core/state.ts';
import type { DeviceFrame } from './protocol.ts';

/**
 * Momo's real-time voice for one device (`/live`): the device's microphone after the wake goes to OpenAI's realtime
 * model, and its voice comes back as it is made. The model is Momo's ears and voice, not a second brain: anything that
 * changes the mindstorm goes through its one tool, `act`, which hands the request to the pipeline as an utterance. Every
 * `say` the pipeline makes is voiced in the same session, the first after an `act` as that act's result and the rest as
 * news. The frames are in docs/protocol.md; why it is built this way is in agents/DECISIONS.md.
 */

/** What the service sends a device on `/live`. Audio is base64 of 16-bit mono PCM at `ready.rate`. */
export type VoiceFrame =
  | { t: 'ready'; rate: number }
  | { t: 'over'; turn: number }
  | { t: 'audio'; id: string; pcm: string }
  | { t: 'text'; id: string; text: string }
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

/** The token counts OpenAI reports for one response. */
export interface Usage {
  input_token_details?: { text_tokens?: number; audio_tokens?: number; cached_tokens_details?: { text_tokens?: number; audio_tokens?: number } };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

export const RATE = 24000;
const IDLE_MS = 5 * 60 * 1000;

/** Dollars per million tokens (https://developers.openai.com/api/docs/pricing, 2026-11-14). */
const PRICES: Record<string, { audioIn: number; audioCached: number; audioOut: number; textIn: number; textCached: number; textOut: number }> = {
  'gpt-realtime-2.1': { audioIn: 32, audioCached: 0.4, audioOut: 64, textIn: 4, textCached: 0.4, textOut: 24 },
  'gpt-realtime-2.1-mini': { audioIn: 10, audioCached: 0.3, audioOut: 20, textIn: 0.6, textCached: 0.06, textOut: 2.4 },
};

/** What one response cost, in dollars, or null for a model whose prices are not listed. */
export function cost(model: string, usage: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const input = usage.input_token_details ?? {};
  const cached = input.cached_tokens_details ?? {};
  const output = usage.output_token_details ?? {};
  const audioCached = cached.audio_tokens ?? 0;
  const textCached = cached.text_tokens ?? 0;
  const dollars =
    ((input.audio_tokens ?? 0) - audioCached) * p.audioIn + audioCached * p.audioCached +
    ((input.text_tokens ?? 0) - textCached) * p.textIn + textCached * p.textCached +
    (output.audio_tokens ?? 0) * p.audioOut + (output.text_tokens ?? 0) * p.textOut;
  return dollars / 1e6;
}

export interface LiveOptions {
  model: string;
  voice: string;
  /** How the model hears the end of a turn: by meaning (`semantic`, eager) or by a pause of `ms` (`server`). */
  turn: { kind: 'semantic' } | { kind: 'server'; ms: number };
  /** For the reasoning models: how hard it thinks before it speaks. */
  effort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface LiveDeps {
  open: OpenRealtime;
  options: LiveOptions;
  /** Hands a request to the pipeline, as an utterance said in that scene. */
  utter: (text: string, scene: Scene) => void;
  /** The scene and the recent conversation, in words, for the model's instructions. */
  context: (scene: Scene) => string;
  /** What the user calls the agent. */
  name: () => string;
  log: (line: string) => void;
  now?: () => number;
  idleMs?: number;
}

const ACT = {
  type: 'function',
  name: 'act',
  description:
    "Hands what the user asked for to Mind Palace's agents, which decide what to do and do it: finding things, bringing more, starting a tree, keeping, organizing, going somewhere, undoing, a handoff. Returns what they say back.",
  parameters: {
    type: 'object',
    properties: { request: { type: 'string', description: "The user's request in their own words, lightly cleaned. Leave out the greeting." } },
    required: ['request'],
  },
};

function instructions(name: string, context: string): string {
  return `You are ${name}, the voice of Mind Palace, a space where the user brainstorms in VR. Everything you say is heard, so keep it short: one sentence, often a few words. Be warm and natural, and vary how you say things.
The user begins each turn with "Hey ${name}". That alone is a greeting, not a request.
Mind Palace's agents do the work and decide what happens; you are their voice. Whenever the user asks for anything that finds, adds, changes, keeps, organizes, moves through or hands off their ideas, call act with the request, and give a brief acknowledgment as you do. Never claim or promise a result act has not returned: no "here are three", no "done".
When act returns a reply, say it in your own words and keep its facts. When it returns nothing to say, say nothing. When it failed, say so briefly.
A message from Mind Palace is news for the user: tell them briefly.
Without act you may answer a simple question about what is in view, from the scene below only, and make small talk.
Never say your own name.
${context}`;
}

function turnDetection(turn: LiveOptions['turn']): Record<string, unknown> {
  const common = { create_response: true, interrupt_response: true };
  return turn.kind === 'semantic'
    ? { type: 'semantic_vad', eagerness: 'high', ...common }
    : { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: turn.ms, ...common };
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

/** Who has the floor. A response answering the user's turn carries that turn until the device has been told it is over. */
type Floor =
  | { kind: 'idle' }
  | { kind: 'hearing'; turn: number }
  | { kind: 'answering'; id?: string; turn?: number };

/** Something to voice once the floor is free. */
type Pending = { kind: 'reply'; callId: string; text: string | null } | { kind: 'news'; text: string };

export class LiveVoice {
  private session: Realtime | null = null;
  private floor: Floor = { kind: 'idle' };
  private scene: Scene = { selection: [] };
  /** `act` calls whose result the pipeline has not said yet, oldest first. */
  private acts: string[] = [];
  private queue: Pending[] = [];
  private upsampler = new Upsampler();
  private texts = new Map<string, string>();
  private idle: ReturnType<typeof setTimeout> | null = null;
  /** For the log: when the model heard the end of the user's speech, and whether that turn's first sound was logged. */
  private stopped: { at: number; turn: number } | null = null;

  constructor(
    private readonly deps: LiveDeps,
    private readonly device: (frame: VoiceFrame) => void,
  ) {
    device({ t: 'ready', rate: RATE });
  }

  /** A frame from the device. */
  heard(frame: DeviceFrame): void {
    this.touch();
    switch (frame.t) {
      case 'start': {
        const fresh = !this.session;
        this.scene = frame.scene;
        const s = this.ensure();
        if (this.floor.kind === 'answering') {
          s.send({ type: 'response.cancel' });
          this.texts.clear();
        }
        if (!fresh) s.send({ type: 'session.update', session: { type: 'realtime', instructions: this.instructions() } });
        s.send({ type: 'input_audio_buffer.clear' });
        this.upsampler = new Upsampler();
        this.floor = { kind: 'hearing', turn: frame.turn };
        return;
      }
      case 'audio':
        if (this.floor.kind !== 'hearing' || !this.session) return;
        this.session.send({ type: 'input_audio_buffer.append', audio: this.upsampler.push(Buffer.from(frame.pcm, 'base64')).toString('base64') });
        return;
      case 'end':
        if (this.floor.kind !== 'hearing' || !this.session) return;
        this.session.send({ type: 'input_audio_buffer.commit' });
        this.session.send({ type: 'response.create' });
        return;
      case 'cancel':
        if (this.floor.kind !== 'hearing' || !this.session) return;
        this.session.send({ type: 'input_audio_buffer.clear' });
        this.floor = { kind: 'idle' };
        this.drain();
        return;
    }
  }

  /** A line the pipeline said. The first after an `act` is its result; a results announcement never is. */
  said(text: string, kind?: string): void {
    const callId = kind === 'results' ? undefined : this.acts.shift();
    this.queue.push(callId ? { kind: 'reply', callId, text } : { kind: 'news', text });
    this.drain();
  }

  /** The Conductor failed on what an `act` handed it, so no reply will come for it. */
  actFailed(): void {
    const callId = this.acts.shift();
    if (!callId) return;
    this.queue.push({ kind: 'reply', callId, text: null });
    this.drain();
  }

  /** The device left. */
  close(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    this.session?.close();
    this.session = null;
  }

  private instructions(): string {
    return instructions(this.deps.name(), this.deps.context(this.scene));
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
        instructions: this.instructions(),
        audio: {
          input: { format: { type: 'audio/pcm', rate: RATE }, turn_detection: turnDetection(options.turn) },
          output: { format: { type: 'audio/pcm', rate: RATE }, voice: options.voice },
        },
        tools: [ACT],
        tool_choice: 'auto',
        ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
      },
    });
    this.deps.log(`[live] session opened (${options.model})`);
    return session;
  }

  private event(e: RealtimeEvent): void {
    this.touch();
    const now = this.deps.now?.() ?? Date.now();
    switch (e.type) {
      case 'input_audio_buffer.speech_stopped':
        if (this.floor.kind === 'hearing') this.stopped = { at: now, turn: this.floor.turn };
        return;
      case 'input_audio_buffer.speech_started':
        // The user went on after a pause the model took for the end of the turn: it dropped that answer and listens on.
        if (this.floor.kind === 'answering' && this.floor.turn !== undefined) this.floor = { kind: 'hearing', turn: this.floor.turn };
        return;
      case 'response.created': {
        const id = (e.response as { id: string }).id;
        if (this.floor.kind === 'hearing') this.floor = { kind: 'answering', id, turn: this.floor.turn };
        else if (this.floor.kind === 'answering' && !this.floor.id) this.floor = { ...this.floor, id };
        return;
      }
      case 'response.output_audio.delta': {
        if (!this.current(e.response_id)) return;
        this.tellOver();
        if (this.stopped) {
          this.deps.log(`[live] turn ${this.stopped.turn}: first sound ${now - this.stopped.at} ms after the model heard the end of speech`);
          this.stopped = null;
        }
        this.device({ t: 'audio', id: e.response_id as string, pcm: e.delta as string });
        return;
      }
      case 'response.output_audio_transcript.delta': {
        if (!this.current(e.response_id)) return;
        const id = e.response_id as string;
        const text = (this.texts.get(id) ?? '') + (e.delta as string);
        this.texts.set(id, text);
        this.device({ t: 'text', id, text });
        return;
      }
      case 'response.function_call_arguments.done': {
        if (e.name !== 'act') return;
        let request = '';
        try {
          request = String((JSON.parse(e.arguments as string) as { request?: unknown }).request ?? '').trim();
        } catch {
          // Arguments that are not JSON ask for nothing.
        }
        if (!request) return;
        this.deps.log(`[live] act: ${request}`);
        this.acts.push(e.call_id as string);
        this.deps.utter(request, this.scene);
        return;
      }
      case 'response.done': {
        const response = e.response as { id: string; status: string; usage?: Usage };
        if (!this.current(response.id)) return;
        if (response.status !== 'cancelled') this.tellOver();
        const dollars = response.usage ? cost(this.deps.options.model, response.usage) : null;
        const said = this.texts.get(response.id);
        this.deps.log(`[live] response ${response.status}${said ? `: ${said}` : ''}${dollars === null ? '' : ` ($${dollars.toFixed(4)})`}`);
        this.texts.delete(response.id);
        this.device({ t: 'done', id: response.id, ...(response.usage ? { usage: response.usage } : {}) });
        this.floor = { kind: 'idle' };
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

  /** Whether a response is the one the floor is with, so the rest of a cancelled one is not passed on. */
  private current(id: unknown): boolean {
    return this.floor.kind === 'answering' && this.floor.id === id;
  }

  /** The device stops streaming: the response that answers its turn has begun, or ended without a sound. */
  private tellOver(): void {
    if (this.floor.kind !== 'answering' || this.floor.turn === undefined) return;
    this.device({ t: 'over', turn: this.floor.turn });
    this.floor = { kind: 'answering', id: this.floor.id };
  }

  /** Voices what is waiting, all of it in one response, once nobody holds the floor. */
  private drain(): void {
    if (this.floor.kind !== 'idle' || this.queue.length === 0) return;
    const s = this.ensure();
    for (const p of this.queue.splice(0)) {
      if (p.kind === 'reply') {
        const output = p.text === null ? { failed: true } : { reply: p.text };
        s.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: p.callId, output: JSON.stringify(output) } });
      } else {
        s.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: `Mind Palace: ${p.text}` }] } });
      }
    }
    s.send({ type: 'response.create' });
    this.floor = { kind: 'answering' };
  }

  private lost(why: string): void {
    this.deps.log(`[live] session closed: ${why}`);
    this.session = null;
    // Its calls cannot be answered in another session, so what the pipeline says for them is news there.
    this.acts = [];
    this.texts.clear();
    if (this.floor.kind !== 'idle') this.device({ t: 'failed', why });
    this.floor = { kind: 'idle' };
  }

  /** Something happened: the session stays open until nothing has for a while. */
  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.floor.kind !== 'idle' || this.acts.length > 0 || !this.session) return;
      this.deps.log('[live] session closed after five quiet minutes');
      this.session.close();
      this.session = null;
    }, this.deps.idleMs ?? IDLE_MS);
    this.idle.unref?.();
  }
}

const MAX_RECENT = 6;

/** The scene in words for the voice: the open card, its tree, and the last few things said. */
export function describeScene(mind: Mindstorm, scene: Scene, recent: readonly { who: 'user' | 'agent'; text: string }[]): string {
  const lines: string[] = [];
  const focus: Id | undefined = scene.focus && mind.nodes.has(scene.focus) ? scene.focus : undefined;
  if (focus) {
    const card = brief(mind, focus);
    lines.push(`In view, the open card: "${card.title}" (${card.kind})${card.summary ? `: ${card.summary}` : ''}`);
    if (card.under.length) lines.push(`Under it: ${card.under.join('; ')}`);
  }
  const treeId = scene.treeId ?? (focus ? mind.node(focus).treeId : undefined);
  if (treeId && mind.trees.has(treeId)) {
    const titles = mind.treeNodes(treeId).slice(0, 12).map((n) => mind.itemOf(n.id).title).filter(Boolean);
    lines.push(`The tree "${mind.tree(treeId).title}" holds: ${titles.join('; ')}`);
  }
  if (lines.length === 0) lines.push('Nothing is open.');
  const said = recent.slice(-MAX_RECENT);
  if (said.length) lines.push(`Said lately:\n${said.map((r) => `${r.who === 'user' ? 'User' : 'You'}: ${r.text}`).join('\n')}`);
  return lines.join('\n');
}
