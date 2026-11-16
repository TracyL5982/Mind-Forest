import { WebSocket } from 'ws';
import type { OpenRealtime, RealtimeEvent } from './live.ts';

export const SPEECH_VOICE = 'marin';
const SPEECH_MODEL = 'gpt-4o-mini-tts';
const MANNER = 'Warm, calm and unhurried, like a friend who knows a lot and is glad to share it. Natural pauses. Not salesy.';

export type Speak = (text: string, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;

/** How long OpenAI may take to start answering before a reply is given up, so a stalled reply does not keep a client's microphone waiting. */
const FIRST_BYTE_MS = 15000;

/** Dollars per minute of audio, OpenAI's own estimates for gpt-4o-mini-tts and gpt-4o-transcribe, as listed in 2025 and not read again. */
export const SPEECH_DOLLARS_PER_MINUTE = 0.015;
export const HEARING_DOLLARS_PER_MINUTE = 0.006;

/** How long a reply takes to say: about 14 characters a second at a calm pace (150 words a minute). An estimate. */
export function spokenMs(text: string): number {
  return (text.length / 14) * 1000;
}

/**
 * How long a PCM WAV recording is, from the fields a decoder plays it by: its sample rate, channels and bits per sample, and the
 * size of its data. The header's own byte rate is not read, since a decoder does not use it and a client may write anything there.
 * Null for anything that is not a PCM WAV a voice recording could be.
 */
export function wavMs(audio: Uint8Array): number | null {
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const tag = (at: number) => String.fromCharCode(...audio.subarray(at, at + 4));
  if (audio.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let format: { channels: number; rate: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= audio.length; ) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === 'fmt ' && size >= 16 && at + 24 <= audio.length) {
      const pcm = view.getUint16(at + 8, true);
      format = { channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
      if ((pcm !== 1 && pcm !== 3) || format.channels < 1 || format.channels > 2 || format.rate < 8000 || format.rate > 48000 || ![8, 16, 24, 32].includes(format.bits)) return null;
    }
    if (tag(at) === 'data') {
      if (!format) return null;
      // A data size past the end, as a recording streamed before its length was known writes, counts what is there.
      const bytes = Math.min(size, audio.length - (at + 8));
      return (bytes / (format.rate * format.channels * (format.bits / 8))) * 1000;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Spoken replies from OpenAI's speech model, as MP3 that arrives while it is made, so playback starts early. `pcm` is 16-bit mono
 * at 24 kHz instead, the live voice's own format.
 */
export function openaiSpeech(send: typeof fetch, opts: { apiKey: string; model?: string; voice?: string; firstByteMs?: number; format?: 'mp3' | 'pcm' }): Speak {
  return async (text, signal) => {
    const late = new AbortController();
    const timer = setTimeout(() => late.abort(new Error('OpenAI speech did not answer in time')), opts.firstByteMs ?? FIRST_BYTE_MS);
    const res = await send('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model || SPEECH_MODEL, voice: opts.voice || SPEECH_VOICE, input: text, instructions: MANNER, response_format: opts.format ?? 'mp3' }),
      signal: AbortSignal.any([signal, late.signal]),
    }).finally(() => clearTimeout(timer));
    if (!res.ok || !res.body) throw new Error(`OpenAI speech answered ${res.status}`);
    return res.body;
  };
}

export const HEARING_MODEL = 'gpt-4o-transcribe';
const EXTENSION: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };

/** Words the user is likely to say: what they call the agent, and the titles of their cards. */
export interface Hints {
  name: string;
  words: string;
}

/** Turns recorded speech into text, told the words the user is likely to say. */
export type Transcribe = (audio: Uint8Array, mime: string, hints: Hints) => Promise<string>;

/**
 * Speech to text with OpenAI's transcription model, told what the user calls it and what their cards are called.
 * Measured on 24 spoken commands: names and topic words were the only errors, and the card titles removed nearly all of them.
 */
export function openaiTranscribe(send: typeof fetch, opts: { apiKey: string; model?: string }): Transcribe {
  return async (audio, mime, hints) => {
    const type = mime.split(';')[0]!.trim();
    const form = new FormData();
    form.append('model', opts.model || HEARING_MODEL);
    form.append('file', new Blob([audio as BlobPart], { type }), `speech.${EXTENSION[type] ?? 'webm'}`);
    const cards = hints.words ? ` Their cards include: ${hints.words}.` : '';
    form.append('prompt', `Someone is talking to their brainstorming app, which they call ${hints.name}, and may begin with "Hey ${hints.name}".${cards}`);
    const res = await send('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`OpenAI transcription answered ${res.status}`);
    return (((await res.json()) as { text?: string }).text ?? '').trim();
  };
}

/**
 * A socket to OpenAI's realtime model for one live voice (`live.ts`). The key goes in a header, never in the address.
 * Events sent before the socket opens are held until it does.
 */
export function openaiRealtime(opts: { apiKey: string; model: string }): OpenRealtime {
  return (on) => {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(opts.model)}`, { headers: { Authorization: `Bearer ${opts.apiKey}` } });
    const held: string[] = [];
    let ended = false;
    const end = (why: string) => {
      if (ended) return;
      ended = true;
      on.closed(why);
    };
    ws.on('open', () => {
      for (const text of held.splice(0)) ws.send(text);
    });
    ws.on('message', (raw) => {
      try {
        on.event(JSON.parse(String(raw)) as RealtimeEvent);
      } catch {
        // Not an event: nothing to act on.
      }
    });
    ws.on('error', (err) => end(`OpenAI realtime: ${err.message}`));
    ws.on('close', (code, reason) => end(`OpenAI realtime closed (${code}${reason.length ? ` ${String(reason)}` : ''})`));
    return {
      send(event) {
        const text = JSON.stringify(event);
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
        else if (ws.readyState === WebSocket.CONNECTING) held.push(text);
      },
      close() {
        ended = true;
        ws.close();
      },
    };
  };
}
