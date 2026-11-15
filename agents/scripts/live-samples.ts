// Sample conversations with Momo's live voice, saved as audio files and never played: the user's turns are said by a speech model
// and streamed to /live of a service started here on a copy of a data folder, as a headset would stream them, and Momo's voice is
// laid down as the headset would play it, cut where the user speaks over it. Cards land as a Scout run's do (scripts/live-stage.ts).
// Beside each file, a transcript with the time of every line, every card that landed and every label the orb showed.
//   node --no-warnings --import tsx scripts/live-samples.ts --data <data dir> --out <dir> [--model …] [--voice marin] [--only vermeer]
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { loadEnv } from '../src/node/env.ts';
import type { VoiceFrame } from '../src/node/live.ts';
import { startServer } from '../src/node/server.ts';
import { HEARING_MODEL, openaiRealtime } from '../src/node/speech-openai.ts';
import { openaiWebAnswer } from '../src/node/web-answer.ts';
import { down, speech, wav } from './live-audio.ts';
import { staged } from './live-stage.ts';

const { values: flags } = parseArgs({
  options: {
    data: { type: 'string' },
    out: { type: 'string' },
    model: { type: 'string', default: 'gpt-realtime-2.1' },
    voice: { type: 'string', default: 'marin' },
    only: { type: 'string' },
    scene: { type: 'string', default: '59b6b703' },
    log: { type: 'string' },
  },
});
if (!flags.data || !flags.out) throw new Error('usage: live-samples.ts --data <dir> --out <dir> [--model …] [--voice …] [--only name]');
const key = loadEnv().OPENAI_API_KEY ?? '';
mkdirSync(flags.out, { recursive: true });

/** When a turn is said: once Momo has been quiet a moment, or while Momo tells the `n`th thing that landed, `ms` into it. */
type When = { after: 'quiet'; ms: number } | { after: 'telling'; n: number; ms: number };
interface Conversation {
  name: string;
  about: string;
  turns: { words: string; when: When }[];
  /** How long to listen after the last turn for what lands. */
  tail: number;
}

const CONVERSATIONS: Conversation[] = [
  {
    name: 'vermeer',
    about: "The plan's example: a question Momo knows, a request for new things, the first cards told as they land, and the user cutting in.",
    turns: [
      { words: 'Hey Momo, who painted Girl with a Pearl Earring?', when: { after: 'quiet', ms: 0 } },
      { words: 'Hey Momo, yeah, find me something interesting about Dutch art.', when: { after: 'quiet', ms: 1200 } },
      { words: "Hey Momo, wait, what's a camera obscura?", when: { after: 'telling', n: 2, ms: 2500 } },
    ],
    tail: 30000,
  },
  {
    name: 'web',
    about: 'A question that needs the web, and a follow-up.',
    turns: [
      { words: "Hey Momo, what's on at the Rijksmuseum right now?", when: { after: 'quiet', ms: 0 } },
      { words: 'Hey Momo, is it open on Mondays?', when: { after: 'quiet', ms: 1200 } },
    ],
    tail: 4000,
  },
  {
    name: 'cards',
    about: 'A request for new content, and Momo walking through the cards as they land.',
    turns: [{ words: 'Hey Momo, show me how Dutch painters handled light.', when: { after: 'quiet', ms: 0 } }],
    tail: 32000,
  },
];

const RATE = 24000;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function converse(c: Conversation): Promise<void> {
  const t0 = performance.now();
  const dir = mkdtempSync(join(tmpdir(), 'mp-samples-'));
  mkdirSync(join(dir, 'assets'));
  copyFileSync(join(flags.data!, 'mindstorm.sqlite'), join(dir, 'mindstorm.sqlite'));
  const server = await startServer({
    port: 0, host: '127.0.0.1', dataDir: dir, clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(),
    roles: { ...fakeRoles, scout: staged }, token: 'samples',
    live: { open: openaiRealtime({ apiKey: key, model: flags.model! }), options: { model: flags.model!, voice: flags.voice!, turn: { kind: 'semantic' }, hearing: HEARING_MODEL, effort: 'minimal' }, webAnswer: openaiWebAnswer(fetch, { apiKey: key }) },
    log: (line) => flags.log && appendFileSync(flags.log, `${(performance.now() - t0).toFixed(0).padStart(6)} ${line}\n`),
  });
  const focus = [...server.mind.nodes.values()].find((n) => n.id.startsWith(flags.scene!));
  const scene = focus ? { focus: focus.id, treeId: focus.treeId, selection: [] } : { selection: [] };
  const at = () => performance.now() - t0;
  const lines: { at: number; text: string }[] = [];
  const ws = new WebSocket(`${server.url.replace('http', 'ws')}/ws?token=samples`);
  const connection = await new Promise<string>((ok) => ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as { t: string; connection?: string; activity?: { role: string; state: string; label: string }; set?: { origin: { role?: string }; patches: { entity: string; before: unknown; after: { title?: string } | null }[] } };
    if (m.t === 'hello') ok(m.connection ?? '');
    if (m.t === 'activity' && m.activity?.state === 'start' && (m.activity.role === 'momo' || m.activity.role === 'scout')) lines.push({ at: at(), text: `(the orb: ${m.activity.label})` });
    if (m.t === 'change' && m.set?.origin.role === 'scout') {
      for (const p of m.set.patches) if (p.entity === 'item' && p.before === null && p.after?.title) lines.push({ at: at(), text: `(a card lands: "${p.after.title}")` });
    }
  }));
  const live = new WebSocket(`${server.url.replace('http', 'ws')}/live?token=samples&connection=${connection}`);
  /** Momo's voice as the headset plays it: each response after the one before, from when its first sound arrives. */
  const momo: { id: string; from: number; pcm: Buffer[]; text: string; kind: string; cut?: number }[] = [];
  let playedUntil = 0;
  live.on('message', (raw) => {
    const f = JSON.parse(String(raw)) as VoiceFrame;
    if (f.t === 'text') {
      const r = momo.find((x) => x.id === f.id);
      if (r) r.text = f.text;
      else momo.push({ id: f.id, from: Number.NaN, pcm: [], text: f.text, kind: f.kind });
    }
    if (f.t === 'audio') {
      let r = momo.find((x) => x.id === f.id);
      if (!r) momo.push((r = { id: f.id, from: Number.NaN, pcm: [], text: '', kind: 'reply' }));
      if (Number.isNaN(r.from)) r.from = Math.max(at(), playedUntil);
      const pcm = Buffer.from(f.pcm, 'base64');
      r.pcm.push(pcm);
      playedUntil = r.from + (r.pcm.reduce((n, p) => n + p.length, 0) / 2 / RATE) * 1000;
    }
  });
  await new Promise((ok) => live.on('open', ok));
  const user: { from: number; pcm: Buffer; words: string }[] = [];
  const playing = () => playedUntil > at();
  for (const [k, turn] of c.turns.entries()) {
    const pcm = await speech(key, turn.words, 'ash', 'Casual and natural, like talking to a friend in the room.');
    if (turn.when.after === 'quiet') {
      // Quiet: nothing playing and nothing new for a moment.
      for (let still = 0; still < 1500 + turn.when.ms; still = playing() ? 0 : still + 100) await sleep(100);
    } else {
      const { n, ms } = turn.when;
      while (momo.filter((r) => r.kind === 'results' && !Number.isNaN(r.from)).length < n) await sleep(50);
      const telling = momo.filter((r) => r.kind === 'results')[n - 1]!;
      while (at() < telling.from + ms) await sleep(20);
    }
    const from = at();
    // The headset stops what plays and drops what waits to play behind it.
    for (const r of momo) if (!Number.isNaN(r.from) && r.cut === undefined && r.from + (r.pcm.reduce((a, p) => a + p.length, 0) / 2 / RATE) * 1000 > from) r.cut = Math.max(r.from, from);
    playedUntil = Math.min(playedUntil, from);
    user.push({ from, pcm, words: turn.words });
    live.send(JSON.stringify({ t: 'start', turn: k + 1, scene }));
    const sixteen = down(pcm);
    const pieces = Math.ceil(sixteen.length / 1600) + 25;
    let over = false;
    live.on('message', (raw) => {
      if ((JSON.parse(String(raw)) as VoiceFrame).t === 'over') over = true;
    });
    for (let p = 0; p < pieces && !over; p++) {
      const piece = p * 1600 < sixteen.length ? sixteen.subarray(p * 1600, (p + 1) * 1600) : new Int16Array(1600);
      await sleep(Math.max(0, from + (p + 1) * 100 - at()));
      live.send(JSON.stringify({ t: 'audio', pcm: Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength).toString('base64') }));
    }
  }
  for (let still = 0; still < c.tail; still = playing() ? 0 : still + 100) await sleep(100);
  live.close();
  ws.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });

  const end = Math.max(...user.map((u) => u.from + (u.pcm.length / 2 / RATE) * 1000), ...momo.filter((r) => !Number.isNaN(r.from)).map((r) => r.from + (r.pcm.reduce((a, p) => a + p.length, 0) / 2 / RATE) * 1000)) + 500;
  const mix = new Float32Array(Math.ceil((end / 1000) * RATE));
  const lay = (from: number, pcm: Buffer, until = Number.POSITIVE_INFINITY) => {
    const start = Math.round((from / 1000) * RATE);
    const stop = Math.min(pcm.length / 2, Math.round(((until - from) / 1000) * RATE));
    for (let i = 0; i < stop && start + i < mix.length; i++) mix[start + i]! += pcm.readInt16LE(i * 2);
  };
  for (const u of user) lay(u.from, u.pcm);
  for (const r of momo) if (!Number.isNaN(r.from)) lay(r.from, Buffer.concat(r.pcm), r.cut);
  const samples = Int16Array.from(mix, (v) => Math.max(-32768, Math.min(32767, Math.round(v))));
  const file = join(flags.out!, `${c.name}-${flags.voice}`);
  writeFileSync(`${file}.wav`, wav(samples, RATE));
  for (const u of user) lines.push({ at: u.from, text: `You: ${u.words}` });
  for (const r of momo) {
    if (Number.isNaN(r.from)) continue;
    const who = `Momo${r.kind === 'results' ? ' (telling what landed)' : ''}`;
    if (r.cut === r.from) lines.push({ at: r.from, text: `(${who} had more ready, not heard since the user spoke: ${r.text})` });
    else lines.push({ at: r.from, text: `${who}: ${r.cut !== undefined ? `${r.text} [cut off ${((r.cut - r.from) / 1000).toFixed(1)} s in, as the user spoke]` : r.text}` });
  }
  lines.sort((a, b) => a.at - b.at);
  const transcript = [`# ${c.name}, ${flags.voice}, ${flags.model}`, c.about, '', ...lines.map((l) => `[${(l.at / 1000).toFixed(1).padStart(5)} s] ${l.text}`)].join('\n');
  writeFileSync(`${file}.txt`, `${transcript}\n`);
  console.log(`${file}.wav, ${(end / 1000).toFixed(1)} s\n${transcript}\n`);
}

for (const c of CONVERSATIONS.filter((x) => !flags.only || flags.only.split(',').includes(x.name))) await converse(c);
