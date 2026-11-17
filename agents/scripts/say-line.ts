/**
 * Records one line in Momo's own live voice, for something the app plays by itself (the filming cue, quest/film/README.md):
 * the realtime model, as Momo, saying the line as written, kept only once its words are the line's (`demo/momo-voice.ts`).
 * Usage: node --no-warnings --import tsx scripts/say-line.ts "<the line>" <out.pcm>
 * It writes the sound as 16-bit mono at 24 kHz, and beside it the same as a .wav to listen to and the line as a .txt,
 * which the app shows as Momo's words while the sound plays.
 */
import { writeFileSync } from 'node:fs';
import { spokenName } from '../src/core/wake.ts';
import { DEFAULT_SETTINGS } from '../src/core/roles/types.ts';
import { record, wavOf, type VoiceOptions } from '../src/demo/momo-voice.ts';
import { loadEnv } from '../src/node/env.ts';
import { openaiRealtime, openaiTranscribe, SPEECH_VOICE } from '../src/node/speech-openai.ts';

const [text, out] = process.argv.slice(2);
const env = loadEnv();
if (!text || !out || !env.OPENAI_API_KEY) {
  console.error(!env.OPENAI_API_KEY ? 'OPENAI_API_KEY is not set: Momo cannot be recorded.' : 'Usage: say-line.ts "<the line>" <out.pcm>');
  process.exit(1);
}
const apiKey = env.OPENAI_API_KEY;
const model = env.MIND_PALACE_LIVE_MODEL || 'gpt-realtime-2.1';
const name = spokenName(DEFAULT_SETTINGS.agentName);
const transcribe = openaiTranscribe(fetch, { apiKey, model: env.MIND_PALACE_HEARING_MODEL });
let dollars = 0;
const options: VoiceOptions = {
  open: openaiRealtime({ apiKey, model }),
  model,
  voice: env.MIND_PALACE_VOICE || SPEECH_VOICE,
  name,
  hear: (wav, likely) => transcribe(wav, 'audio/wav', { name, words: likely }),
  spent: (d) => (dollars += d),
  log: (line) => console.log(`  ${line}`),
};
const made = await record(options, text, 'answer');
const base = out.replace(/\.pcm$/, '');
if ('unsaid' in made) {
  console.error(`She did not say it as written in ${made.takes} takes. The closest: "${made.closest}"`);
  if (made.pcm) {
    writeFileSync(`${base}-closest.pcm`, made.pcm);
    writeFileSync(`${base}-closest.wav`, wavOf(made.pcm));
  }
  process.exit(2);
}
writeFileSync(out, made.pcm);
writeFileSync(`${base}.wav`, wavOf(made.pcm));
writeFileSync(`${base}.txt`, `${text}\n`);
console.log(`said as written in ${made.takes} take${made.takes === 1 ? '' : 's'}: ${(made.pcm.length / 48000).toFixed(2)} s, about $${dollars.toFixed(3)} -> ${out}`);
process.exit(0);
