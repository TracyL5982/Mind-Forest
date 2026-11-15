// How faithfully the live voice says the pipeline's lines (src/node/live.ts), in each style, on the real models. Each sample is a line
// the pipeline says, a Conductor reply or a results line, two of them in Chinese, said in a realtime session out of the model's
// conversation as the service says it. What was said is the model's own transcript of its voice. It is checked for every name and number
// the line carries, for numbers it does not, and by a judge model for anything added or changed. Prints the rate per style and kind and
// every failure, and writes all of it to <out>/fidelity.json. With --samples it also writes three lines in each voice and style as WAV
// files to <out>, for a person to choose from by ear. Nothing is played.
//   node --no-warnings --import tsx scripts/voice-fidelity.ts <out-dir> [--trials 2] [--samples marin,cedar]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VoiceStyle } from '../src/core/roles/types.ts';
import { loadEnv } from '../src/node/env.ts';
import { cost, lineInstructions, RATE, type Lately, type RealtimeEvent, type Usage } from '../src/node/live.ts';
import { openaiRealtime } from '../src/node/speech-openai.ts';

const args = process.argv.slice(2);
const out = args[0];
if (!out || out.startsWith('--')) {
  console.error('usage: voice-fidelity.ts <out-dir> [--trials 2] [--samples marin,cedar]');
  process.exit(1);
}
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
const trials = Number(flag('--trials') ?? 2);
const sampleVoices = flag('--samples')?.split(',');
const env = loadEnv();
const key = env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY is not set in the environment file');
  process.exit(1);
}
const MODEL = env.MIND_PALACE_LIVE_MODEL || 'gpt-realtime-2.1-mini';
const JUDGE = env.FIDELITY_JUDGE || 'gpt-5.4';

interface Sample {
  kind: 'reply' | 'results';
  text: string;
  /** Names the line carries, each of which must be said. */
  names: string[];
  /** What the user last said, which sets the language. */
  user: string;
}
const EN = 'Hey Momo, show me more like this.';
const ZH = '嘿 Momo，给我看看更多关于老地图的东西。';
const SAMPLES: Sample[] = [
  { kind: 'reply', text: 'Looking for horror examples.', names: ['horror'], user: 'Find me horror examples.' },
  { kind: 'reply', text: 'Bringing more.', names: [], user: EN },
  { kind: 'reply', text: 'Undone.', names: [], user: 'Undo that.' },
  { kind: 'reply', text: 'Going up.', names: [], user: 'Go up one.' },
  { kind: 'reply', text: 'Back to the start.', names: [], user: 'Go back to the start.' },
  { kind: 'reply', text: 'Kept 2.', names: [], user: 'Keep the first two.' },
  { kind: 'reply', text: 'Which one should I keep?', names: [], user: 'Keep that one.' },
  { kind: 'reply', text: "There's nothing new here to keep.", names: [], user: 'Keep these.' },
  { kind: 'reply', text: 'On it.', names: [], user: 'Tidy this tree up.' },
  { kind: 'reply', text: 'Looking into old maps of Amsterdam.', names: ['Amsterdam'], user: 'What about old maps of Amsterdam?' },
  { kind: 'reply', text: 'Finding films with a slow dolly zoom.', names: ['dolly zoom'], user: 'Find films with a slow dolly zoom.' },
  { kind: 'reply', text: 'Starting a tree on Dutch painters.', names: ['Dutch painters'], user: 'Start a new tree on Dutch painters.' },
  { kind: 'reply', text: 'Your handoff is ready: Night stairs research.', names: ['Night stairs research'], user: 'Package this for Sam.' },
  { kind: 'reply', text: "We're already at the top.", names: [], user: 'Go up.' },
  { kind: 'reply', text: 'Looking for 3 more papers on adaptive menus.', names: ['adaptive menus'], user: 'Find three more papers on adaptive menus.' },
  { kind: 'reply', text: '正在找关于老地图的更多资料。', names: ['老地图'], user: ZH },
  { kind: 'results', text: 'Four new things under generative UI: a film "Minority Report" and a video "Bret Victor - Inventing on Principle".', names: ['generative UI', 'Minority Report', 'Bret Victor', 'Inventing on Principle'], user: EN },
  { kind: 'results', text: 'Five new things under generative UI, including a paper "Predictability and accuracy in adaptive user interfaces".', names: ['generative UI', 'Predictability and accuracy in adaptive user interfaces'], user: EN },
  { kind: 'results', text: 'I found nothing new for generative UI.', names: ['generative UI'], user: EN },
  { kind: 'results', text: 'Three new things under Vertigo: a film "Vertigo" and an article "The Dolly Zoom, Explained".', names: ['Vertigo', 'The Dolly Zoom Explained'], user: EN },
  { kind: 'results', text: 'Two new things under Night stairs: a photograph "Stairwell, seen from above" and a picture "Night stairs, lit from below".', names: ['Night stairs', 'Stairwell seen from above', 'Night stairs lit from below'], user: EN },
  { kind: 'results', text: 'Six new things under world building: a book "The Left Hand of Darkness" and a game "Outer Wilds".', names: ['world building', 'The Left Hand of Darkness', 'Outer Wilds'], user: 'Hey Momo, more on world building.' },
  { kind: 'results', text: 'Four new things under Dutch painters: a painting "The Milkmaid" by Johannes Vermeer and a video "Rembrandt in 10 minutes".', names: ['Dutch painters', 'The Milkmaid', 'Johannes Vermeer', 'Rembrandt in 10 minutes'], user: EN },
  { kind: 'results', text: 'I moved 3 cards under Lighting and renamed the tree to "Stairs at night".', names: ['Lighting', 'Stairs at night'], user: 'Tidy this tree up.' },
  { kind: 'results', text: 'Seven new things under sourdough, including a paper "Microbial ecology of sourdough starters".', names: ['sourdough', 'Microbial ecology of sourdough starters'], user: EN },
  { kind: 'results', text: 'One new thing under old maps: a map "Amsterdam, 1652".', names: ['old maps', 'Amsterdam'], user: EN },
  { kind: 'results', text: 'Eight new things under jazz: an album "Kind of Blue" and a film "Whiplash".', names: ['jazz', 'Kind of Blue', 'Whiplash'], user: EN },
  { kind: 'results', text: 'I found nothing new for Bret Victor.', names: ['Bret Victor'], user: EN },
  { kind: 'results', text: 'Five new things under the 1928 photographs: a photograph "Berlin, Potsdamer Platz" and an article "Ilse Brandt at 30".', names: ['Berlin', 'Potsdamer Platz', 'Ilse Brandt'], user: EN },
  { kind: 'results', text: '老地图下有四个新东西：一张地图“阿姆斯特丹，1652年”和一个视频“地图的历史”。', names: ['老地图', '阿姆斯特丹', '地图的历史'], user: ZH },
];

// ---- the exact checks

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30 };
const HAN: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** Han numerals written as digits: 十 as tens, and a run of single digits (a year said digit by digit) as one number. */
function hanDigits(text: string): string {
  return text
    .replace(/([一二三四五六七八九])?十([一二三四五六七八九])?/g, (_, a: string | undefined, b: string | undefined) => String((a ? HAN[a]! : 1) * 10 + (b ? HAN[b]! : 0)))
    .replace(/[零一二两三四五六七八九]{2,}/g, (run) => [...run].map((c) => HAN[c]).join(''))
    .replace(/[零一二两三四五六七八九](?=[个张件篇部年项])/g, (c) => String(HAN[c]));
}

/** Lower case, numbers as digits, no punctuation, single spaces. */
function plain(text: string): string {
  return hanDigits(text.toLowerCase())
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty)\b/g, (w) => String(WORDS[w]))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function numbers(text: string): number[] {
  return (plain(text).match(/\d+/g) ?? []).map(Number);
}

/** What the exact checks found wrong: a name or number of the line not said, or a number said that the line does not have. */
function exact(sample: Sample, said: string): string[] {
  const heard = plain(said);
  const compact = heard.replace(/ /g, '');
  const wrong: string[] = [];
  for (const name of sample.names) {
    const want = plain(name);
    if (!heard.includes(want) && !compact.includes(want.replace(/ /g, ''))) wrong.push(`left out "${name}"`);
  }
  const have = numbers(said);
  const want = numbers(sample.text);
  for (const n of want) if (!have.includes(n)) wrong.push(`left out the number ${n}`);
  for (const n of have) if (!want.includes(n)) wrong.push(`added the number ${n}`);
  return wrong;
}

// ---- the judge

async function judge(sample: Sample, said: string): Promise<{ faithful: boolean; problems: string[] }> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: JUDGE,
      input: `A brainstorming app decided to say a line to its user. A voice then said it, possibly in its own words and possibly translated into the user's language.

Line: ${sample.text}
Said: ${said}

Is what was said faithful to the line? It is faithful when it keeps every fact, name, title and number, adds no fact, opinion, offer, promise, question, greeting or claim that the line does not make, and does not change what the line means.
These are fine and are not problems: rewording; a different opening such as "Here are" or "Okay,"; joining words such as "called" or "titled" before a title; translation into the user's language; naming only the items the line itself names.
These are problems: a name, title or number lost or changed; a thing given another kind (a map called an idea); a statement made into a request or command; a claim, offer, promise or question the line does not make, such as saying something was found or done when the line does not say so.
Answer with JSON only: {"faithful": true or false, "problems": ["each thing lost, added or changed"]}`,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`the judge answered ${res.status}`);
  const json = (await res.json()) as { output?: { type: string; content?: { type: string; text?: string }[] }[] };
  const text = (json.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('');
  const verdict = JSON.parse(/\{[^]*\}/.exec(text)?.[0] ?? '{}') as { faithful?: boolean; problems?: string[] };
  return { faithful: verdict.faithful === true, problems: verdict.problems ?? [] };
}

// ---- the voice

interface Spoken {
  said: string;
  pcm: Buffer;
  firstAudioMs: number | null;
  usage?: Usage;
}

function session(voice: string) {
  const waiting: ((e: RealtimeEvent) => void)[] = [];
  const rt = openaiRealtime({ apiKey: key!, model: MODEL })({
    event: (e) => waiting.forEach((w) => w(e)),
    closed: (why) => console.error(`the session closed: ${why}`),
  });
  rt.send({
    type: 'session.update',
    session: {
      type: 'realtime',
      model: MODEL,
      output_modalities: ['audio'],
      instructions: 'You are Momo, the voice of Mind Palace. You only say the lines you are given.',
      audio: { output: { format: { type: 'audio/pcm', rate: RATE }, voice } },
      reasoning: { effort: 'minimal' },
    },
  });
  /** Says one line as the service does, and gathers what came back. */
  return {
    say(line: string, style: VoiceStyle, lately: Lately): Promise<Spoken> {
      return new Promise((done, fail) => {
        const began = performance.now();
        let id: string | null = null;
        let said = '';
        const pcm: Buffer[] = [];
        let first: number | null = null;
        const on = (e: RealtimeEvent) => {
          if (e.type === 'error') {
            waiting.splice(waiting.indexOf(on), 1);
            fail(new Error(JSON.stringify(e.error)));
          }
          if (e.type === 'response.created') id = (e.response as { id: string }).id;
          if (e.response_id !== id && e.type !== 'response.done') return;
          if (e.type === 'response.output_audio_transcript.delta') said += e.delta as string;
          if (e.type === 'response.output_audio.delta') {
            first ??= performance.now() - began;
            pcm.push(Buffer.from(e.delta as string, 'base64'));
          }
          if (e.type === 'response.done' && (e.response as { id: string }).id === id) {
            waiting.splice(waiting.indexOf(on), 1);
            done({ said: said.trim(), pcm: Buffer.concat(pcm), firstAudioMs: first, usage: (e.response as { usage?: Usage }).usage });
          }
        };
        waiting.push(on);
        rt.send({ type: 'response.create', response: { conversation: 'none', output_modalities: ['audio'], instructions: lineInstructions({ text: line }, style, lately), input: [] } });
      });
    },
    close: () => rt.close(),
  };
}

function wav(pcm: Buffer): Buffer {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

mkdirSync(out, { recursive: true });
const lately = (s: Sample): Lately => ({ name: 'Momo', turns: [{ who: 'user', text: s.user }] });

if (sampleVoices) {
  const picked = [SAMPLES[9]!, SAMPLES[16]!, SAMPLES[29]!];
  for (const voice of sampleVoices) {
    const s = session(voice);
    for (const style of ['own words', 'verbatim'] as const) {
      for (const [k, sample] of picked.entries()) {
        const spoken = await s.say(sample.text, style, lately(sample));
        const file = join(out, `${voice}-${style.replace(' ', '-')}-${k + 1}.wav`);
        writeFileSync(file, wav(spoken.pcm));
        console.log(`${file}  ${(spoken.pcm.length / (RATE * 2)).toFixed(1)} s  "${spoken.said}"`);
      }
    }
    s.close();
  }
  process.exit(0);
}

interface Result {
  style: VoiceStyle;
  trial: number;
  kind: Sample['kind'];
  line: string;
  said: string;
  exact: string[];
  judged: { faithful: boolean; problems: string[] };
  passed: boolean;
  firstAudioMs: number | null;
  seconds: number;
  dollars: number | null;
}
const results: Result[] = [];
const s = session(env.MIND_PALACE_VOICE || 'marin');
for (let trial = 1; trial <= trials; trial++) {
  for (const style of ['own words', 'verbatim'] as const) {
    for (const sample of SAMPLES) {
      const spoken = await s.say(sample.text, style, lately(sample));
      const wrong = exact(sample, spoken.said);
      const judged = await judge(sample, spoken.said);
      const passed = wrong.length === 0 && judged.faithful;
      results.push({
        style, trial, kind: sample.kind, line: sample.text, said: spoken.said, exact: wrong, judged, passed,
        firstAudioMs: spoken.firstAudioMs === null ? null : Math.round(spoken.firstAudioMs),
        seconds: spoken.pcm.length / (RATE * 2),
        dollars: spoken.usage ? cost(MODEL, spoken.usage) : null,
      });
      process.stdout.write(passed ? '.' : 'x');
    }
  }
}
s.close();
console.log();
writeFileSync(join(out, 'fidelity.json'), JSON.stringify(results, null, 2));

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};
console.log(`${MODEL}, judged by ${JUDGE}, ${SAMPLES.length} lines, ${trials} trials each`);
console.log('| Style | Kind | Passed | Exact checks failed | Judge said unfaithful | First sound, median (range) | Per line |');
console.log('|---|---|---|---|---|---|---|');
for (const style of ['own words', 'verbatim'] as const) {
  for (const kind of ['reply', 'results'] as const) {
    const rs = results.filter((r) => r.style === style && r.kind === kind);
    const firsts = rs.flatMap((r) => (r.firstAudioMs === null ? [] : [r.firstAudioMs]));
    const dollars = rs.flatMap((r) => (r.dollars === null ? [] : [r.dollars]));
    console.log(
      `| ${style} | ${kind} | ${rs.filter((r) => r.passed).length}/${rs.length} | ${rs.filter((r) => r.exact.length).length} | ${rs.filter((r) => !r.judged.faithful).length} | ` +
        `${median(firsts)} ms (${Math.min(...firsts)} to ${Math.max(...firsts)}) | $${(dollars.reduce((a, b) => a + b, 0) / Math.max(1, dollars.length)).toFixed(4)} |`,
    );
  }
}
for (const r of results.filter((r) => !r.passed)) {
  console.log(`\n${r.style}, ${r.kind}, trial ${r.trial}\n  line: ${r.line}\n  said: ${r.said}\n  ${[...r.exact, ...r.judged.problems.map((p) => `judge: ${p}`)].join('\n  ')}`);
}
