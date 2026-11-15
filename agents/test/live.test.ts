import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import type { Scene } from '../src/core/roles/types.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { cost, LiveVoice, Upsampler, type LiveDeps, type RealtimeEvent, type VoiceFrame } from '../src/node/live.ts';
import { startServer } from '../src/node/server.ts';

/** A realtime model the test speaks for: what the voice sent it, and a way to send events back. */
class Scripted {
  sessions: { sent: RealtimeEvent[]; event: (e: RealtimeEvent) => void; closed: (why: string) => void; shut: boolean }[] = [];
  open: LiveDeps['open'] = (on) => {
    const s = { sent: [] as RealtimeEvent[], event: on.event, closed: on.closed, shut: false };
    this.sessions.push(s);
    return { send: (e) => s.sent.push(e), close: () => void (s.shut = true) };
  };
  get last() {
    return this.sessions.at(-1)!;
  }
  sent(type: string) {
    return this.last.sent.filter((e) => e.type === type);
  }
  /** The model answers: a response with audio and words, optionally calling act. */
  answer(id: string, opts: { words?: string; act?: string; status?: string } = {}) {
    const s = this.last;
    s.event({ type: 'response.created', response: { id } });
    if (opts.words) {
      s.event({ type: 'response.output_audio.delta', response_id: id, delta: Buffer.from([1, 0, 2, 0]).toString('base64') });
      s.event({ type: 'response.output_audio_transcript.delta', response_id: id, delta: opts.words });
    }
    if (opts.act) s.event({ type: 'response.function_call_arguments.done', response_id: id, name: 'act', call_id: `call-${id}`, arguments: JSON.stringify({ request: opts.act }) });
    s.event({ type: 'response.done', response: { id, status: opts.status ?? 'completed', usage: { output_token_details: { audio_tokens: 40, text_tokens: 10 } } } });
  }
}

const SCENE: Scene = { focus: 'n1', selection: [], treeId: 't1' };
const pcm = (samples: number[]) => {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b.toString('base64');
};

function voice() {
  const model = new Scripted();
  const frames: VoiceFrame[] = [];
  const utters: { text: string; scene: Scene }[] = [];
  const v = new LiveVoice(
    {
      open: model.open,
      options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' }, effort: 'minimal' },
      utter: (text, scene) => utters.push({ text, scene }),
      context: (scene) => `In view, the open card ${scene.focus}`,
      name: () => 'Momo',
      log: () => {},
      idleMs: 60_000,
    },
    (f) => frames.push(f),
  );
  const of = (t: VoiceFrame['t']) => frames.filter((f) => f.t === t);
  return { v, model, frames, utters, of };
}

test('nothing reaches the model before the user says the name, and the name opens a session that knows Momo and the scene', () => {
  const { v, model, frames } = voice();
  assert.deepEqual(frames, [{ t: 'ready', rate: 24000 }]);
  v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
  v.heard({ t: 'end' });
  assert.equal(model.sessions.length, 0, 'audio before a start opens nothing');

  v.heard({ t: 'start', turn: 1, scene: SCENE });
  assert.equal(model.sessions.length, 1);
  const setup = model.sent('session.update')[0]!.session as { instructions: string; tools: { name: string }[]; audio: { input: { turn_detection: { type: string } } } };
  assert.match(setup.instructions, /You are Momo/);
  assert.match(setup.instructions, /open card n1/);
  assert.deepEqual(setup.tools.map((t) => t.name), ['act']);
  assert.equal(setup.audio.input.turn_detection.type, 'semantic_vad');

  v.heard({ t: 'audio', pcm: pcm(new Array(1600).fill(100)) });
  const appended = model.sent('input_audio_buffer.append');
  assert.equal(appended.length, 1);
  assert.equal(Buffer.from(appended[0]!.audio as string, 'base64').length, 2 * 2399, '1600 samples at 16 kHz are about 2400 at 24 kHz');
});

test("the model's voice goes to the device as it comes, and the device is told its turn is over at the first sound", () => {
  const { v, model, frames } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.answer('r1', { words: 'Sure, one moment.' });
  assert.deepEqual(
    frames.slice(1).map((f) => f.t),
    ['over', 'audio', 'text', 'done'],
  );
  assert.deepEqual(frames[1], { t: 'over', turn: 1 });
  assert.deepEqual(frames[3], { t: 'text', id: 'r1', text: 'Sure, one moment.' });
  v.heard({ t: 'audio', pcm: pcm([5, 6]) });
  assert.equal(model.sent('input_audio_buffer.append').length, 0, 'audio after the turn is over is not sent');
});

test('act hands the request to the pipeline in the scene, and the next say is its result, voiced in the same session', () => {
  const { v, model, utters } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.answer('r1', { words: 'Let me look.', act: 'help me find something interesting to look at' });
  assert.deepEqual(utters, [{ text: 'help me find something interesting to look at', scene: SCENE }]);

  v.said('Looking for something to catch your eye.');
  const outputs = model.sent('conversation.item.create').map((e) => e.item as { type: string; call_id: string; output: string });
  assert.deepEqual(outputs, [{ type: 'function_call_output', call_id: 'call-r1', output: JSON.stringify({ reply: 'Looking for something to catch your eye.' }) }]);
  assert.equal(model.sent('response.create').length, 1);
  assert.equal(model.sessions.length, 1);
});

test('a say with no act waiting, or a results announcement, is news; it waits while the user is heard and goes out when the turn is answered', () => {
  const { v, model } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.answer('r1', { words: 'On it.', act: 'more like this' });
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  const news = () => model.sent('conversation.item.create').map((e) => e.item as { type: string; role?: string; content?: { text: string }[] }).filter((i) => i.type === 'message');
  v.said('Three new cards on Hokusai are in.', 'results');
  assert.equal(news().length, 0, 'nothing is voiced while the user speaks');

  model.answer('r2', { words: 'Sure.' });
  assert.equal(news().length, 1);
  assert.equal(news()[0]!.role, 'system');
  assert.match(news()[0]!.content![0]!.text, /Three new cards on Hokusai/);

  v.said('Bringing more.');
  assert.equal(news().length, 1, 'what is said next waits while the news is being said');
});

test('saying the name while Momo speaks stops that answer, and nothing more of it reaches the device', () => {
  const { v, model, frames, of } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  const s = model.last;
  s.event({ type: 'response.created', response: { id: 'r1' } });
  s.event({ type: 'response.output_audio.delta', response_id: 'r1', delta: 'AAA=' });
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  assert.equal(model.sent('response.cancel').length, 1);
  const before = frames.length;
  s.event({ type: 'response.output_audio.delta', response_id: 'r1', delta: 'AAA=' });
  s.event({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } });
  assert.equal(frames.length, before, 'the cancelled answer sends nothing more');
  model.answer('r2', { words: 'Yes?' });
  assert.deepEqual(of('over'), [{ t: 'over', turn: 1 }, { t: 'over', turn: 2 }]);
});

test('the user going on after a pause the model took for the end keeps the turn open', () => {
  const { v, model, of } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  const s = model.last;
  s.event({ type: 'response.created', response: { id: 'r1' } });
  s.event({ type: 'input_audio_buffer.speech_started' });
  s.event({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } });
  assert.equal(of('over').length, 0);
  v.heard({ t: 'audio', pcm: pcm([1, 2, 3]) });
  assert.equal(model.sent('input_audio_buffer.append').length, 1, 'the rest of what they say still goes to the model');
  model.answer('r2', { words: 'Got it.' });
  assert.deepEqual(of('over'), [{ t: 'over', turn: 1 }]);
});

test('a session that drops ends the turn on the device, and the next name opens a new one where the late reply is news', () => {
  const { v, model, of } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.answer('r1', { words: 'On it.', act: 'start a tree on tides' });
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  model.last.closed('network');
  assert.deepEqual(of('failed'), [{ t: 'failed', why: 'network' }]);

  v.said('Starting a tree on tides.');
  assert.equal(model.sessions.length, 2, 'a say with no session opens one');
  const item = model.sent('conversation.item.create')[0]!.item as { type: string };
  assert.equal(item.type, 'message', 'the old call cannot be answered in the new session');
});

test('nothing said after the name drops the turn; a Conductor that fails is reported as a failed act', () => {
  const { v, model } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  v.heard({ t: 'cancel' });
  assert.equal(model.sent('input_audio_buffer.clear').length, 2);
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  model.answer('r1', { words: 'Okay.', act: 'organize this' });
  v.actFailed();
  const item = model.sent('conversation.item.create')[0]!.item as { output: string };
  assert.equal(item.output, JSON.stringify({ failed: true }));
});

test('the device stopping at the cap commits what it sent and asks for an answer', () => {
  const { v, model } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  v.heard({ t: 'end' });
  assert.deepEqual(model.last.sent.slice(-2).map((e) => e.type), ['input_audio_buffer.commit', 'response.create']);
});

test('16 kHz becomes 24 kHz by straight lines, carried across pieces', () => {
  const up = new Upsampler();
  const ramp = Array.from({ length: 30 }, (_, i) => i * 300);
  const whole = new Upsampler().push(Buffer.from(pcm(ramp), 'base64'));
  const parts = Buffer.concat([up.push(Buffer.from(pcm(ramp.slice(0, 7)), 'base64')), up.push(Buffer.from(pcm(ramp.slice(7)), 'base64'))]);
  assert.deepEqual(parts, whole, 'pieces join as if they were one');
  const out = Array.from({ length: whole.length / 2 }, (_, k) => whole.readInt16LE(k * 2));
  out.forEach((v, k) => assert.equal(v, Math.round(k * 200), `sample ${k} lies on the line`));
  assert.equal(out.length, 44, "every output up to the last whole gap");
});

test('a response costs what its tokens cost at the listed prices', () => {
  const dollars = cost('gpt-realtime-2.1-mini', {
    input_token_details: { text_tokens: 1000, audio_tokens: 40, cached_tokens_details: { text_tokens: 600, audio_tokens: 0 } },
    output_token_details: { text_tokens: 10, audio_tokens: 60 },
  });
  assert.ok(dollars !== null);
  assert.ok(Math.abs(dollars - (400 * 0.6 + 600 * 0.06 + 40 * 10 + 10 * 2.4 + 60 * 20) / 1e6) < 1e-12);
  assert.equal(cost('some-other-model', {}), null);
});

test('the service refuses /live without a live voice, and with one voices what the pipeline says to each device', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-live-'));
  const base = { port: 0, host: '127.0.0.1', clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret' };
  const plain = await startServer({ ...base, dataDir });
  await assert.rejects(
    new Promise((ok, fail) => {
      const ws = new WebSocket(`${plain.url.replace('http', 'ws')}/live?token=secret`);
      ws.on('open', ok);
      ws.on('error', fail);
    }),
    /404/,
  );
  await plain.close();

  const model = new Scripted();
  const run = await startServer({ ...base, dataDir, live: { open: model.open, options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' } } } });
  const frames: VoiceFrame[] = [];
  const ws = new WebSocket(`${run.url.replace('http', 'ws')}/live?token=secret`);
  ws.on('message', (raw) => frames.push(JSON.parse(String(raw)) as VoiceFrame));
  await new Promise((ok) => ws.on('open', ok));
  while (frames.length === 0) await new Promise((ok) => setTimeout(ok, 5));
  assert.deepEqual(frames[0], { t: 'ready', rate: 24000 });

  ws.send(JSON.stringify({ t: 'start', turn: 1, scene: { selection: [] } }));
  while (model.sessions.length === 0) await new Promise((ok) => setTimeout(ok, 5));
  model.answer('r1', { words: 'Sure.', act: 'remember to buy film' });
  while (!model.sent('conversation.item.create').length) await new Promise((ok) => setTimeout(ok, 5));
  const output = model.sent('conversation.item.create')[0]!.item as { type: string; call_id: string; output: string };
  assert.equal(output.type, 'function_call_output');
  assert.equal(output.call_id, 'call-r1');
  assert.ok(JSON.parse(output.output).reply, 'the pipeline answered the act and its say came back as the result');
  ws.close();
  await run.close();
});

test('a call still unanswered when the user speaks again is closed, so the model is not left waiting, and its late reply is news', () => {
  const { v, model } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.answer('r1', { words: 'Bringing more.', act: 'show me more like this' });
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  const closed = model.sent('conversation.item.create').map((e) => e.item as { type: string; call_id: string });
  assert.deepEqual(closed.map((i) => [i.type, i.call_id]), [['function_call_output', 'call-r1']]);
  model.answer('r2', { words: 'Sure.' });
  v.said('Bringing more.');
  const late = model.sent('conversation.item.create').at(-1)!.item as { type: string; role: string };
  assert.equal(late.type, 'message', 'the late reply is news');
});
