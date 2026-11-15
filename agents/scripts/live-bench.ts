// Measures Momo's live voice as a headset uses it: each request of scripts/live-requests.ts is said by a speech model into a 16 kHz
// WAV file (made once, never played), streamed to /live of a service started here on a copy of a data folder, at the pace it was
// said, then quiet until the turn is over. Every request has a session of its own. For each it records which way Momo answered
// (its tool calls, or none) against the way written down for it, the time from the end of speech to Momo's first sound, for a web
// question to the answer itself, everything Momo said and was told, and what the turn cost. Nothing is played aloud.
// The roles are the stand-ins (no Meta model calls) unless --staged, which lands realistic cards over 35 s as the Scout does.
//   node --no-warnings --import tsx scripts/live-bench.ts --data <data dir> --out <file.jsonl> [--model gpt-realtime-2.1-mini]
//     [--voice marin] [--effort minimal] [--clips <dir>] [--only k1,w2] [--settle 7000] [--staged]
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { loadEnv } from '../src/node/env.ts';
import { cost, type OpenRealtime, type RealtimeEvent, type Usage, type VoiceFrame } from '../src/node/live.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { startServer } from '../src/node/server.ts';
import { HEARING_MODEL, openaiRealtime } from '../src/node/speech-openai.ts';
import { ask } from '../src/node/web-answer.ts';
import { down, samplesOf, speech, wav } from './live-audio.ts';
import { PAUSED, REQUESTS, type Request } from './live-requests.ts';
import { staged } from './live-stage.ts';

const { values: flags } = parseArgs({
  options: {
    data: { type: 'string' },
    out: { type: 'string' },
    model: { type: 'string', default: 'gpt-realtime-2.1-mini' },
    voice: { type: 'string', default: 'marin' },
    effort: { type: 'string', default: 'minimal' },
    clips: { type: 'string' },
    only: { type: 'string' },
    settle: { type: 'string', default: '7000' },
    staged: { type: 'boolean', default: false },
    real: { type: 'boolean', default: false },
    scene: { type: 'string', default: '7d121822' },
    turn: { type: 'string', default: 'semantic' },
    paused: { type: 'boolean', default: false },
    hiss: { type: 'string', default: '0' },
    'device-pause': { type: 'string', default: '0' },
    pause: { type: 'string', default: '1800' },
  },
});
if (!flags.data || !flags.out) {
  console.error('usage: live-bench.ts --data <data dir> --out <file.jsonl> [--model …] [--voice …] [--clips <dir>] [--only ids] [--staged]');
  process.exit(1);
}
const env = loadEnv();
const key = env.OPENAI_API_KEY ?? '';
if (!key) throw new Error('no OpenAI key');
const here = import.meta.dirname;
const clipsDir = flags.clips ?? join(flags.out, '..', 'clips');
mkdirSync(clipsDir, { recursive: true });
const SETTLE_MS = Number(flags.settle);
const PIECE = 1600;

// ---- clips

let ttsDollars = 0;
/** The request said by a speech model, as a headset would send it: a moment of quiet, then the words. */
async function clip(r: Request & { pauseMs?: number }): Promise<string> {
  const file = join(clipsDir, `${r.id}.wav`);
  if (existsSync(file)) return file;
  const parts: Int16Array[] = [new Int16Array(16000 * 0.3)];
  for (const [k, words] of r.text.split(' | ').entries()) {
    if (k > 0) parts.push(new Int16Array(Math.round((16000 * (r.pauseMs ?? 0)) / 1000)));
    const pcm = await speech(key, words, 'ash', 'Casual and natural, like talking to a friend in the room, thinking aloud.');
    // About $0.015 a minute of speech (gpt-4o-mini-tts, 2025 list price).
    ttsDollars += (pcm.length / 48000 / 60) * 0.015;
    parts.push(down(pcm));
  }
  const all = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  writeFileSync(file, wav(all, 16000));
  return file;
}

function lastSpeechPiece(s: Int16Array): number {
  for (let i = s.length - 1; i >= 0; i--) if (Math.abs(s[i]!) > 0.02 * 32768) return Math.floor(i / PIECE);
  return 0;
}

// ---- the service, its model's events tapped

interface Tapped {
  at: number;
  dir: 'in' | 'out';
  type: string;
  e: RealtimeEvent;
}
let taps: Tapped[] = [];
const realtime = openaiRealtime({ apiKey: key, model: flags.model! });
const open: OpenRealtime = (on) => {
  const real = realtime({
    event: (e) => {
      taps.push({ at: performance.now(), dir: 'in', type: e.type, e: e.type.endsWith('audio.delta') ? { type: e.type, response_id: e.response_id, item_id: e.item_id, bytes: String(e.delta).length } : e });
      on.event(e);
    },
    closed: on.closed,
  });
  return {
    send: (e) => {
      taps.push({ at: performance.now(), dir: 'out', type: e.type, e: e.type === 'input_audio_buffer.append' ? { type: e.type } : e });
      real.send(e);
    },
    close: () => real.close(),
  };
};
let webDollars = 0;
const webAnswer = async (question: string) => {
  const answered = await ask(fetch, { apiKey: key }, question);
  webDollars += answered.dollars;
  return answered.text;
};

// ---- one request

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** A room's faint noise under the clip and the quiet after it, as a headset's microphone hears it: `--hiss` is its loudest sample. */
const HISS = Number(flags.hiss);
const DEVICE_PAUSE = Number(flags['device-pause']);
function hissed(piece: Int16Array): Int16Array {
  if (!HISS) return piece;
  const out = new Int16Array(piece.length);
  for (let i = 0; i < piece.length; i++) out[i] = Math.max(-32768, Math.min(32767, piece[i]! + Math.round((Math.random() * 2 - 1) * HISS)));
  return out;
}

async function turn(base: string, token: string, r: Request, scene: object): Promise<Record<string, unknown>> {
  const samples = samplesOf(await clip(r));
  const lastPiece = lastSpeechPiece(samples);
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?token=${token}`);
  const connection = await new Promise<string>((ok) => ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as { t: string; connection?: string };
    if (m.t === 'hello') ok(m.connection ?? '');
  }));
  const activities: { at: number; role: string; state: string; label: string }[] = [];
  const cards: { at: number; title: string }[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as { t: string; activity?: { role: string; state: string; label: string }; set?: { origin: { role?: string }; patches: { entity: string; before: unknown; after: { title?: string } | null }[] } };
    if (m.t === 'activity' && m.activity) activities.push({ at: performance.now(), role: m.activity.role, state: m.activity.state, label: m.activity.label });
    if (m.t === 'change' && m.set?.origin.role === 'scout') {
      for (const p of m.set.patches) if (p.entity === 'item' && p.before === null && p.after) cards.push({ at: performance.now(), title: p.after.title ?? '' });
    }
  });
  const live = new WebSocket(`${base.replace(/^http/, 'ws')}/live?token=${token}&connection=${connection}`);
  const frames: { at: number; frame: VoiceFrame }[] = [];
  live.on('message', (raw) => frames.push({ at: performance.now(), frame: JSON.parse(String(raw)) as VoiceFrame }));
  await new Promise((ok) => live.on('open', ok));
  while (!frames.some((f) => f.frame.t === 'ready')) await sleep(5);
  const tapFrom = taps.length;
  const webBefore = webDollars;

  live.send(JSON.stringify({ t: 'start', turn: 1, scene }));
  const began = performance.now();
  let endOfSpeech = 0;
  let over = false;
  let endedByDevice = false;
  for (let p = 0; !over && p < 400; p++) {
    const piece = p * PIECE < samples.length ? hissed(samples.subarray(p * PIECE, (p + 1) * PIECE)) : hissed(new Int16Array(PIECE));
    await sleep(Math.max(0, began + (p + 1) * 100 - performance.now()));
    live.send(JSON.stringify({ t: 'audio', pcm: Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength).toString('base64') }));
    if (p === lastPiece) endOfSpeech = performance.now();
    over = frames.some((f) => f.frame.t === 'over' || f.frame.t === 'failed');
    // The headset ends the turn itself after its recording's pause, 1.2 s of quiet after the last word, unless the service did first.
    if (!over && DEVICE_PAUSE > 0 && p === lastPiece + DEVICE_PAUSE / 100) {
      live.send(JSON.stringify({ t: 'end' }));
      endedByDevice = true;
      break;
    }
  }
  if (!over && !endedByDevice) live.send(JSON.stringify({ t: 'end' }));
  const deadline = performance.now() + (flags.staged || flags.real ? 90000 : 40000);
  for (;;) {
    await sleep(250);
    const mine = taps.slice(tapFrom);
    const lastAt = Math.max(frames.at(-1)!.at, mine.at(-1)?.at ?? 0, activities.at(-1)?.at ?? 0);
    const created = mine.filter((t) => t.type === 'response.created').length;
    const done = mine.filter((t) => t.type === 'response.done').length;
    const working = activities.filter((a) => a.state === 'start').length > activities.filter((a) => a.state !== 'start').length;
    if ((created === done && !working && performance.now() - lastAt > SETTLE_MS) || performance.now() > deadline) break;
  }
  live.close();
  ws.close();
  await sleep(300);

  const mine = taps.slice(tapFrom);
  const after = (at: number | undefined) => (at && endOfSpeech ? Math.round(at - endOfSpeech) : null);
  const overAt = frames.find((f) => f.frame.t === 'over')?.at;
  const firstAudio = frames.find((f) => f.frame.t === 'audio')?.at;
  const calls = mine
    .filter((t) => t.type === 'response.function_call_arguments.done')
    .map((t) => ({ call: String(t.e.call_id), name: String(t.e.name ?? ''), args: String(t.e.arguments ?? ''), at: t.at }));
  for (const t of mine.filter((x) => x.type === 'response.output_item.added')) {
    const item = t.e.item as { type?: string; call_id?: string; name?: string };
    const c = calls.find((x) => x.call === item.call_id);
    if (c && !c.name && item.name) c.name = item.name;
  }
  const outputs = mine.filter((t) => t.type === 'conversation.item.create' && (t.e.item as { type?: string }).type === 'function_call_output');
  const responses = mine
    .filter((t) => t.type === 'response.created')
    .map((t) => {
      const id = (t.e.response as { id: string; metadata?: { purpose?: string } }).id;
      const purpose = (t.e.response as { metadata?: { purpose?: string } | null }).metadata?.purpose ?? 'turn';
      const audio = mine.find((x) => x.type === 'response.output_audio.delta' && x.e.response_id === id);
      const done = mine.find((x) => x.type === 'response.done' && (x.e.response as { id: string }).id === id);
      const text = mine.filter((x) => x.type === 'response.output_audio_transcript.delta' && x.e.response_id === id).map((x) => String(x.e.delta)).join('');
      const usage = (done?.e.response as { usage?: Usage } | undefined)?.usage;
      return { id, purpose, createdAt: t.at, firstAudioAt: audio?.at, text, status: (done?.e.response as { status?: string } | undefined)?.status, dollars: usage ? (cost(flags.model!, usage) ?? 0) : 0 };
    });
  const web = calls.find((c) => c.name === 'web_answer');
  const webOutput = web ? outputs.find((o) => (o.e.item as { call_id?: string }).call_id === web.call) : undefined;
  const answer = webOutput ? responses.find((x) => x.createdAt > webOutput.at && x.firstAudioAt) : undefined;
  const transcript = mine.find((t) => t.type === 'conversation.item.input_audio_transcription.completed');
  const hearingDollars = transcript?.e.usage ? (cost(HEARING_MODEL, transcript.e.usage as Usage) ?? 0) : 0;
  const notes = mine
    .filter((t) => t.type === 'conversation.item.create' && (t.e.item as { role?: string }).role === 'system')
    .map((t) => ({ at: t.at, text: ((t.e.item as { content: { text: string }[] }).content[0]?.text ?? '') }));
  const errors = mine.filter((t) => t.type === 'error').map((t) => JSON.stringify(t.e.error));
  const chose = calls.length > 0 ? calls.map((c) => c.name) : ['own'];
  const right = r.ways.includes(chose[0] as never);
  const realtimeDollars = responses.reduce((s, x) => s + x.dollars, 0);
  return {
    id: r.id,
    group: r.group,
    text: r.text,
    expected: r.ways,
    chose,
    right,
    heard: String(transcript?.e.transcript ?? ''),
    cutOff: Boolean(overAt && !endOfSpeech),
    endedByDevice,
    overMs: after(overAt),
    firstSoundMs: after(firstAudio),
    toolMs: web && webOutput ? Math.round(webOutput.at - web.at) : null,
    answerMs: after(answer?.firstAudioAt),
    responses: responses.map((x) => ({ purpose: x.purpose, status: x.status, firstAudioMs: after(x.firstAudioAt), text: x.text })),
    calls: calls.map((c) => ({ name: c.name, args: c.args, atMs: after(c.at) })),
    notes: notes.map((n) => ({ atMs: after(n.at), text: n.text })),
    activities: activities.map((a) => ({ atMs: after(a.at), role: a.role, state: a.state, label: a.label })),
    cards: cards.map((c) => ({ atMs: after(c.at), title: c.title })),
    errors,
    dollars: { realtime: Number(realtimeDollars.toFixed(5)), hearing: Number(hearingDollars.toFixed(5)), web: Number((webDollars - webBefore).toFixed(5)) },
  };
}

/** The Meta models the service runs on, as main.ts makes them, for --real. */
function realModel() {
  if (!env.MODEL_API_KEY) throw new Error('--real needs MODEL_API_KEY');
  return new MetaModel({
    apiKey: env.MODEL_API_KEY,
    baseUrl: env.MUSE_LLM_BASE_URL || undefined,
    model: env.MUSE_LLM_MODEL || undefined,
    quickModel: env.MIND_PALACE_QUICK_MODEL || undefined,
    onCall: (c) => metaCalls.push({ role: c.role, ms: c.ms, ok: c.ok, tokens: c.tokens ?? 0 }),
  });
}
const metaCalls: { role: string; ms: number; ok: boolean; tokens: number }[] = [];

// ---- the run

const dir = mkdtempSync(join(tmpdir(), 'mp-live-bench-'));
const dataDir = join(dir, 'data');
mkdirSync(join(dataDir, 'assets'), { recursive: true });
copyFileSync(join(flags.data, 'mindstorm.sqlite'), join(dataDir, 'mindstorm.sqlite'));
const lines: string[] = [];
const server = await startServer({
  port: 0,
  host: '127.0.0.1',
  dataDir,
  clientDir: join(here, '../client'),
  model: flags.real ? realModel() : new FakeModel(),
  roles: flags.real ? (await import('../src/core/roles/index.ts')).roles : flags.staged ? { ...fakeRoles, scout: staged } : fakeRoles,
  keys: { YOUTUBE_API_KEY: env.YOUTUBE_API_KEY, TMDB_API_KEY: env.TMDB_API_KEY, EUROPEANA_API_KEY: env.EUROPEANA_API_KEY, GUARDIAN_API_KEY: env.GUARDIAN_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, MIND_PALACE_SEARCH_MODEL: env.MIND_PALACE_SEARCH_MODEL },
  token: 'bench',
  live: {
    open,
    options: { model: flags.model!, voice: flags.voice!, turn: flags.turn!.startsWith('server:') ? { kind: 'server', ms: Number(flags.turn!.slice(7)) } : { kind: 'semantic' }, hearing: HEARING_MODEL, effort: flags.effort as 'minimal', pauseMs: Number(flags.pause) },
    webAnswer,
  },
  log: (line) => lines.push(`${Math.round(performance.now())} ${line}`),
});
try {
  const focus = [...server.mind.nodes.values()].find((n) => n.id.startsWith(flags.scene!));
  const scene = focus ? { focus: focus.id, treeId: focus.treeId, selection: [] } : { selection: [] };
  const set = flags.paused ? PAUSED : REQUESTS;
  const chosen = flags.only ? set.filter((r) => flags.only!.split(',').includes(r.id)) : set;
  for (const r of chosen) {
    taps = [];
    const row = await turn(server.url, server.token, r, scene);
    appendFileSync(flags.out, `${JSON.stringify({ model: flags.model, voice: flags.voice, effort: flags.effort, turn: flags.turn, pause: Number(flags.pause), at: new Date().toISOString(), ...row })}\n`);
    const said = (row.responses as { text: string }[]).map((x) => x.text).join(' | ');
    console.log(`${r.id.padEnd(4)} ${row.right ? 'right' : 'WRONG'} ${(row.chose as string[]).join('+').padEnd(18)} over ${row.overMs} first ${row.firstSoundMs}${row.answerMs ? ` answer ${row.answerMs}` : ''} $${JSON.stringify(row.dollars)}\n     ${said.slice(0, 300)}`);
  }
  console.log(`speech for clips: $${ttsDollars.toFixed(4)}`);
  if (flags.real) console.log(`Meta calls: ${metaCalls.length}, ${metaCalls.filter((c) => !c.ok).length} failed, ${metaCalls.reduce((a, c) => a + c.tokens, 0)} tokens`);
} finally {
  writeFileSync(`${flags.out}.log`, lines.join('\n'));
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}
