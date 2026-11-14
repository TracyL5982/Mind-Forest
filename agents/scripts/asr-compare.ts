/**
 * Speaks the same commands in three voices and scores each speech recognizer on them by word error rate.
 * Recognizers: Chrome's own (the page's first choice), Meta's transcription (the page's fallback), OpenAI's transcription models.
 * Usage: tsx scripts/asr-compare.ts [out dir]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';

const env = loadEnv();
const out = process.argv[2] ?? join(tmpdir(), 'asr-compare');
mkdirSync(out, { recursive: true });

const SAID = [
  'Make a new tree for the Japan trip and move the onsen card into it.',
  'Find me more like the Buffalo parking study, but for European cities.',
  "What's the difference between the Kiso Valley and the Nakasendo trail?",
  'Keep the second pick and drop the rest.',
  'Undo that, I meant the sourdough tree, not the solar one.',
  'Show me papers on spaced repetition for early readers.',
  'Package this tree as a handoff for the design team.',
  'Group the battery payback cards into a comparison.',
];
const ON_SCREEN = 'Japan trip, quiet onsen towns, Kiso Valley, Buffalo parking study, parking maximums, sourdough in winter, rooftop solar batteries, spaced repetition, kids reading app';

type Voice = { name: string; make: (text: string, file: string) => Promise<void> };
const say = (voice: string): Voice['make'] => async (text, file) => {
  execFileSync('say', ['-v', voice, '-o', `${file}.aiff`, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', `${file}.aiff`, file]);
};
const VOICES: Voice[] = [
  {
    name: 'accented',
    make: async (text, file) => {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts', voice: 'cedar', input: text, response_format: 'wav',
          instructions: 'Speak casually and a little fast, like thinking out loud, with a noticeable Mandarin Chinese accent.',
        }),
      });
      if (!res.ok) throw new Error(`speech ${res.status}`);
      writeFileSync(`${file}.src.wav`, Buffer.from(await res.arrayBuffer()));
      execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', `${file}.src.wav`, file]);
    },
  },
  { name: 'mac-chinese', make: say('Eddy (Chinese (China mainland))') },
  { name: 'mac-us', make: say('Samantha') },
];

/** Adds silence at the end, so a recognizer that waits for a pause gets one. */
function padded(file: string, seconds: number): string {
  const wav = readFileSync(file);
  let at = 12;
  let fmt: Buffer | null = null;
  let data: Buffer | null = null;
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = wav.subarray(at + 8, at + 8 + size);
    if (id === 'data') data = wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file} is not a WAV`);
  const pcm = Buffer.concat([data, Buffer.alloc(fmt.readUInt32LE(8) * seconds)]);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  fmt.copy(head, 20, 0, 16);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  const done = file.replace(/\.wav$/, '.padded.wav');
  writeFileSync(done, Buffer.concat([head, pcm]));
  return done;
}

const words = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
function wer(ref: string, hyp: string): number {
  const r = words(ref);
  const h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0]![j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length]![h.length]! / r.length;
}

async function chrome(file: string, lang: string): Promise<string> {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}%noloop`],
  });
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:8787/api/health');
    return await page.evaluate(
      (lang) =>
        new Promise<string>((resolve) => {
          const Rec = (window as unknown as { webkitSpeechRecognition: new () => any }).webkitSpeechRecognition;
          const rec = new Rec();
          rec.lang = lang;
          rec.interimResults = false;
          let heard = '';
          rec.onresult = (e: any) => (heard = [...e.results].map((r: any) => r[0].transcript).join(' '));
          rec.onerror = (e: any) => (heard = `[error ${e.error}]`);
          rec.onend = () => resolve(heard);
          rec.start();
          setTimeout(() => rec.stop(), 15000);
        }),
      lang,
    );
  } finally {
    await browser.close();
  }
}

async function openai(file: string, model: string, prompt?: string): Promise<string> {
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([readFileSync(file)], { type: 'audio/wav' }), 'speech.wav');
  form.append('language', 'en');
  if (prompt) form.append('prompt', `Cards on screen: ${prompt}.`);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) return `[error ${res.status}]`;
  return ((await res.json()) as { text?: string }).text ?? '';
}

const meta = new MetaModel({ apiKey: env.MODEL_API_KEY ?? '' });
const RECOGNIZERS: { name: string; run: (file: string) => Promise<string> }[] = [
  { name: 'chrome en-US', run: (f) => chrome(f, 'en-US') },
  { name: 'meta muse-voice-transcribe', run: async (f) => meta.transcribe({ audio: readFileSync(f), mime: 'audio/wav' }).catch((e) => `[error ${String(e).slice(0, 60)}]`) },
  { name: 'openai gpt-4o-mini-transcribe', run: (f) => openai(f, 'gpt-4o-mini-transcribe') },
  { name: 'openai gpt-4o-transcribe', run: (f) => openai(f, 'gpt-4o-transcribe') },
  { name: 'openai gpt-transcribe', run: (f) => openai(f, 'gpt-transcribe') },
  { name: 'openai gpt-4o-transcribe + cards', run: (f) => openai(f, 'gpt-4o-transcribe', ON_SCREEN) },
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:8787/api/health');
console.log(JSON.stringify({ chromeDefaultLanguage: await page.evaluate(() => navigator.language) }));
await browser.close();

const scores = new Map<string, number[]>();
for (const voice of VOICES) {
  for (const [i, text] of SAID.entries()) {
    const file = join(out, `${voice.name}-${i}.wav`);
    await voice.make(text, file);
    const clip = padded(file, 2);
    for (const r of RECOGNIZERS) {
      const started = Date.now();
      const heard = await r.run(clip);
      const score = wer(text, heard);
      scores.set(`${r.name}|${voice.name}`, [...(scores.get(`${r.name}|${voice.name}`) ?? []), score]);
      console.log(JSON.stringify({ voice: voice.name, recognizer: r.name, ms: Date.now() - started, wer: Number(score.toFixed(2)), said: text, heard }));
    }
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
for (const r of RECOGNIZERS) {
  const row = Object.fromEntries(VOICES.map((v) => [v.name, `${(mean(scores.get(`${r.name}|${v.name}`) ?? []) * 100).toFixed(0)}%`]));
  console.log(JSON.stringify({ recognizer: r.name, wordErrorRate: row, all: `${(mean(VOICES.flatMap((v) => scores.get(`${r.name}|${v.name}`) ?? [])) * 100).toFixed(0)}%` }));
}
