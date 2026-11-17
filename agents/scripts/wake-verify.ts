/**
 * Can a transcript tell the name from what only sounded like it, and how long does it take? Sends the sound of each wake
 * (quest/tools/wake_measure.sh <clips> -dump <dir>) to the transcription model, as the service does to check a wake
 * (src/node/wake-check.ts), and counts how many real names pass and how many false wakes are stopped.
 * Usage: tsx scripts/wake-verify.ts <dump dir> [how many real names to try, default 150]
 * Every false wake is tried. About 250 one-second clips, a few cents. Writes <dump dir>/verified.tsv.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { saysWakePhrase } from '../src/core/wake.ts';
import { loadEnv } from '../src/node/env.ts';
import { HEARING_MODEL } from '../src/node/speech-openai.ts';
import { nameCheckPrompt } from '../src/node/wake-check.ts';

const dir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: wake-verify.ts <dump dir> [real names to try]');
const wanted = Number(process.argv[3] ?? 150);
const env = loadEnv();
const apiKey = env.OPENAI_API_KEY;
if (!apiKey) throw new Error('no OPENAI_API_KEY');
const model = env.MIND_PALACE_HEARING_MODEL || HEARING_MODEL;

interface Wake { file: string; set: string; language: string; voice: string; words: string; real: boolean }
const all: Wake[] = readFileSync(join(dir, 'wakes.tsv'), 'utf8').split('\n').filter(Boolean).map((line) => {
  const [file, set, language, voice, words] = line.split('\t') as [string, string, string, string, string];
  return { file, set, language, voice, words, real: set !== 'near' && set !== 'talk' };
});
// A second wake within one clip of a request is a false one too, but which is which is not known: left out.
const firsts = all.filter((w) => !/-\d+$/.test(w.file) || !w.real);
const real = firsts.filter((w) => w.real);
const step = Math.max(1, Math.floor(real.length / wanted));
const chosen = [...real.filter((_, i) => i % step === 0).slice(0, wanted), ...firsts.filter((w) => !w.real)];

async function hear(wav: Uint8Array, prompt: string | null): Promise<{ text: string; ms: number }> {
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'name.wav');
  if (prompt) form.append('prompt', prompt);
  const at = Date.now();
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  if (!res.ok) throw new Error(`OpenAI transcription answered ${res.status}`);
  const text = (((await res.json()) as { text?: string }).text ?? '').trim();
  return { text, ms: Date.now() - at };
}

const PROMPTS: Record<string, string | null> = { told: nameCheckPrompt('Momo'), plain: null };
const rows: string[] = [];
const tally: Record<string, { real: number; passed: number; false: number; stopped: number; ms: number[] }> = {};
for (const key of Object.keys(PROMPTS)) tally[key] = { real: 0, passed: 0, false: 0, stopped: 0, ms: [] };

let next = 0;
async function worker(): Promise<void> {
  for (;;) {
    const w = chosen[next++];
    if (!w) return;
    const wav = readFileSync(join(dir, `${w.file}.wav`));
    for (const [key, prompt] of Object.entries(PROMPTS)) {
      const heard = await hear(wav, prompt);
      const ok = saysWakePhrase(heard.text, 'momo');
      const t = tally[key]!;
      if (w.real) { t.real++; if (ok) t.passed++; } else { t.false++; if (!ok) t.stopped++; }
      t.ms.push(heard.ms);
      rows.push([w.file, w.set, w.real ? 'real' : 'false', key, ok ? 'pass' : 'stop', heard.ms, heard.text.replace(/\s+/g, ' '), w.words].join('\t'));
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
writeFileSync(join(dir, 'verified.tsv'), rows.sort().join('\n') + '\n');
for (const [key, t] of Object.entries(tally)) {
  const ms = t.ms.sort((a, b) => a - b);
  const at = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
  console.log(`${key}: ${t.passed} of ${t.real} real names pass, ${t.stopped} of ${t.false} false wakes are stopped; answered in ${at(0.5)} ms at the median, ${at(0.9)} ms at the 90th in a hundred, ${ms.at(-1)} ms at most`);
}
