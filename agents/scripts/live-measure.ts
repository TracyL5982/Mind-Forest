// Measures Momo's live voice against a running service, as a headset would use it: each clip (16 kHz mono 16-bit WAV,
// beginning with "Hey Momo") is streamed to /live in tenth-of-a-second pieces at the pace it was spoken, then quiet until
// the service says the turn is over. For each turn it reports the time from the end of the speech to the turn being over
// and to Momo's first sound, what Momo said, what the pipeline heard and said, and what the responses cost.
//   node --no-warnings --import tsx scripts/live-measure.ts <http://host:port> <token> <model> <clip.wav>...
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { cost, type Usage, type VoiceFrame } from '../src/node/live.ts';

const [base, token, model, ...clips] = process.argv.slice(2);
if (!base || !token || !model || clips.length === 0) {
  console.error('usage: live-measure.ts <http://host:port> <token> <model> <clip.wav>...');
  process.exit(1);
}

const PIECE = 1600;
/** How long after the last response of a turn nothing more may come before the next clip is said. */
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 12000);

function samplesOf(file: string): Int16Array {
  const bytes = readFileSync(file);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'data') return new Int16Array(bytes.buffer.slice(bytes.byteOffset + at + 8, bytes.byteOffset + at + 8 + size));
    at += 8 + size + (size & 1);
  }
  throw new Error(`${file} has no data chunk`);
}

/** The piece holding the last sample louder than speech, so the end of what was said. */
function lastSpeechPiece(s: Int16Array): number {
  for (let i = s.length - 1; i >= 0; i--) if (Math.abs(s[i]!) > 0.02 * 32768) return Math.floor(i / PIECE);
  return 0;
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const live = new WebSocket(`${base.replace(/^http/, 'ws')}/live?token=${encodeURIComponent(token)}`);
const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
const frames: { at: number; frame: VoiceFrame }[] = [];
const pipeline: { at: number; t: string; text: string }[] = [];
live.on('message', (raw) => frames.push({ at: performance.now(), frame: JSON.parse(String(raw)) as VoiceFrame }));
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw)) as { t: string; text?: string; final?: boolean };
  if ((m.t === 'heard' && m.final) || m.t === 'say') pipeline.push({ at: performance.now(), t: m.t, text: m.text ?? '' });
});
await Promise.all([new Promise((ok) => live.on('open', ok)), new Promise((ok) => ws.on('open', ok))]);
while (!frames.some((f) => f.frame.t === 'ready')) await sleep(10);

/** The newest tree's root card, open, as the user would be looking at it. */
const state = (await (await fetch(`${base}/api/state?token=${encodeURIComponent(token)}`)).json()) as { snapshot: { trees: { id: string; rootId: string }[] } };
const tree = state.snapshot.trees.at(-1);
const scene = tree ? { focus: tree.rootId, treeId: tree.id, selection: [] } : { selection: [] };

const rows: Record<string, string | number>[] = [];
for (const [k, clip] of clips.entries()) {
  const turn = k + 1;
  const samples = samplesOf(clip);
  const lastPiece = lastSpeechPiece(samples);
  const from = frames.length;
  const heardFrom = pipeline.length;
  live.send(JSON.stringify({ t: 'start', turn, scene }));
  const began = performance.now();
  let endOfSpeech = 0;
  let over = false;
  for (let p = 0; !over && p < 600; p++) {
    const piece = p * PIECE < samples.length ? samples.subarray(p * PIECE, (p + 1) * PIECE) : new Int16Array(PIECE);
    const due = began + (p + 1) * 100;
    await sleep(Math.max(0, due - performance.now()));
    live.send(JSON.stringify({ t: 'audio', pcm: Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength).toString('base64') }));
    if (p === lastPiece) endOfSpeech = performance.now();
    over = frames.slice(from).some((f) => f.frame.t === 'over' && f.frame.turn === turn) || frames.slice(from).some((f) => f.frame.t === 'failed');
  }
  if (!over) live.send(JSON.stringify({ t: 'end' }));
  // The turn is answered once nothing has come for a while after the last response.
  for (;;) {
    await sleep(250);
    const last = Math.max(frames.at(-1)!.at, pipeline.at(-1)?.at ?? 0);
    const open = frames.slice(from).filter((f) => f.frame.t === 'audio' || f.frame.t === 'text').map((f) => (f.frame as { id: string }).id);
    const done = new Set(frames.slice(from).filter((f) => f.frame.t === 'done').map((f) => (f.frame as { id: string }).id));
    if (open.every((id) => done.has(id)) && performance.now() - last > SETTLE_MS) break;
  }
  const mine = frames.slice(from);
  const overAt = mine.find((f) => f.frame.t === 'over')?.at;
  const firstSound = mine.find((f) => f.frame.t === 'audio')?.at;
  const said = new Map<string, string>();
  for (const f of mine) if (f.frame.t === 'text') said.set(f.frame.id, f.frame.text);
  const usage = mine.flatMap((f) => (f.frame.t === 'done' && f.frame.usage ? [f.frame.usage as Usage] : []));
  const dollars = usage.reduce((sum, u) => sum + (cost(model, u) ?? 0), 0);
  const audioOut = usage.reduce((sum, u) => sum + (u.output_token_details?.audio_tokens ?? 0), 0);
  const failed = mine.find((f) => f.frame.t === 'failed');
  rows.push({
    turn,
    clip: clip.split('/').pop()!,
    // A turn the model ended before the clip's last word was cut off: its timings say nothing about the end of speech.
    overMs: !endOfSpeech ? 'cut off' : overAt ? Math.round(overAt - endOfSpeech) : 'none',
    firstSoundMs: !endOfSpeech ? 'cut off' : firstSound ? Math.round(firstSound - endOfSpeech) : 'none',
    responses: usage.length,
    audioOutTokens: audioOut,
    dollars: Number(dollars.toFixed(5)),
    momo: [...said.values()].join(' | '),
    pipeline: pipeline.slice(heardFrom).map((p) => `${p.t === 'heard' ? 'heard' : 'said'}: ${p.text}`).join(' | '),
    ...(failed ? { failed: (failed.frame as { why: string }).why } : {}),
  });
  console.log(JSON.stringify(rows.at(-1)));
}
live.close();
ws.close();
const sounds = rows.map((r) => r.firstSoundMs).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
const total = rows.reduce((sum, r) => sum + Number(r.dollars), 0);
console.log(JSON.stringify({ model, turns: rows.length, firstSoundMs: { min: sounds[0], median: sounds[Math.floor(sounds.length / 2)], max: sounds.at(-1) }, dollarsPerTurn: Number((total / rows.length).toFixed(5)) }));
