/**
 * The check of a wake (DECISIONS.md 70). A device's spotter is set to catch its name nearly every time, and so it also wakes on
 * things that only sound like it. With each wake the device sends the second or so of sound that woke it; the service writes that down
 * and lets Momo act only if it holds "hey <name>" or "hi <name>".
 */
import { saysWakePhrase } from '../core/wake.ts';
import type { Transcribe } from './speech-openai.ts';

/** What the transcription model is told before it writes down the sound of a wake: what `openaiTranscribe` tells it with no cards. */
export function nameCheckPrompt(name: string): string {
  return `Someone is talking to their brainstorming app, which they call ${name}, and may begin with "Hey ${name}".`;
}

/** 16-bit mono PCM at 16 kHz, as a device sends the sound of a wake, in a WAV file. */
export function wavOf(pcm: Uint8Array): Uint8Array {
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + pcm.length, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16000, 24);
  out.writeUInt32LE(32000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(pcm.length, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length).copy(out, 44);
  return out;
}

/** Writes down the sound of a wake and says whether it holds the name. `heard` is what it was written down as, for the log. */
export async function checkName(transcribe: Transcribe, pcm: Uint8Array, name: string): Promise<{ ok: boolean; heard: string }> {
  const heard = await transcribe(wavOf(pcm), 'audio/wav', { name, words: '' });
  return { ok: saysWakePhrase(heard, name), heard };
}
