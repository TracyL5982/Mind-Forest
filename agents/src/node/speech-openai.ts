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
 * How long a recording from the Quest is, or null for anything else. Only the header the Quest's own `wavFile` writes is taken
 * (quest/core/agent/listener.cpp): 44 bytes of RIFF, WAVE, a 16-byte fmt of PCM, mono, 16 kHz, 32000 bytes a second, 2-byte blocks
 * of 16 bits, then data. Its length is what follows the header at 32000 bytes a second, whatever the RIFF and data sizes say, since
 * a decoder plays a file with a data size of 0, or with a second fmt, in ways a cleverer reading would count as nothing.
 */
export function questWavMs(audio: Uint8Array): number | null {
  if (audio.length < 44) return null;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const tag = (at: number) => String.fromCharCode(...audio.subarray(at, at + 4));
  const quest =
    tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1 && view.getUint32(24, true) === 16000 &&
    view.getUint32(28, true) === 32000 && view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16 && tag(36) === 'data';
  return quest ? ((audio.length - 44) / 32000) * 1000 : null;
}

/**
 * How long an Ogg Opus recording plays, in ms, read from the file itself: the last page's granule position, which counts samples at
 * 48 kHz whatever rate was recorded. Null when no Ogg page is found. A file can lie here as a sender can about its length, so what
 * is charged is never less than its size allows (`heardMs`).
 */
export function oggOpusMs(audio: Uint8Array): number | null {
  for (let at = audio.length - 27; at >= 0; at--) {
    if (audio[at] !== 0x4f || audio[at + 1] !== 0x67 || audio[at + 2] !== 0x67 || audio[at + 3] !== 0x53 || audio[at + 4] !== 0) continue;
    const granule = new DataView(audio.buffer, audio.byteOffset + at + 6, 8).getBigUint64(0, true);
    // All ones marks a page on which no packet ends.
    if (granule === 0xffff_ffff_ffff_ffffn) continue;
    return Number(granule) / 48;
  }
  return null;
}

/** A voice note's bytes a second at Telegram's usual rate for speech, about 32 kbit/s: no note is counted as shorter than its size at this rate. */
const VOICE_NOTE_BYTES_PER_SECOND = 4000;

/**
 * The length a recording from a chat app is charged at, in ms: the longest of what its sender said, what the file says of itself,
 * and what its size comes to as a voice note. The sender's word alone is theirs to choose.
 */
export function heardMs(audio: Uint8Array, statedSeconds?: number): number {
  return Math.max((statedSeconds ?? 0) * 1000, oggOpusMs(audio) ?? 0, (audio.length / VOICE_NOTE_BYTES_PER_SECOND) * 1000);
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
