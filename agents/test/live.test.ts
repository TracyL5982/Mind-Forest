import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import type { Activity } from '../src/core/pipeline.ts';
import type { Scene, VoiceStyle } from '../src/core/roles/types.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { cost, cut, LiveVoice, Upsampler, type LiveDeps, type RealtimeEvent, type VoiceFrame } from '../src/node/live.ts';
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
  /** What each response the voice asked for was told to say. */
  asked() {
    return this.sent('response.create').map((e) => e.response as { conversation: string; input: unknown[]; instructions: string; output_modalities: string[] });
  }
  /** The model hears the end of the user's turn and writes it down, a piece at a time. */
  hears(item: string, words: string[]) {
    const s = this.last;
    s.event({ type: 'input_audio_buffer.speech_stopped', item_id: item });
    s.event({ type: 'input_audio_buffer.committed', item_id: item });
    for (const w of words) s.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: item, delta: w });
    s.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: item, transcript: words.join(''), usage: { type: 'tokens', input_tokens: 30, output_tokens: 8, input_token_details: { text_tokens: 10, audio_tokens: 20 } } });
  }
  /** The model says the line it was last asked for: `ms` of audio, in pieces of 100 ms. */
  speaks(id: string, words: string, opts: { ms?: number; status?: string; done?: boolean } = {}) {
    const s = this.last;
    s.event({ type: 'response.created', response: { id } });
    s.event({ type: 'response.output_audio_transcript.delta', response_id: id, delta: words });
    for (let ms = 0; ms < (opts.ms ?? 200); ms += 100) s.event({ type: 'response.output_audio.delta', response_id: id, delta: Buffer.alloc(4800).toString('base64') });
    if (opts.done === false) return;
    s.event({ type: 'response.done', response: { id, status: opts.status ?? 'completed', usage: { output_token_details: { audio_tokens: 40, text_tokens: 10 } } } });
  }
}

const SCENE: Scene = { focus: 'n1', selection: [], treeId: 't1' };
const pcm = (samples: number[]) => {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b.toString('base64');
};
const tick = () => new Promise((ok) => setTimeout(ok, 0));
/** A step of the Conductor's, as the pipeline reports it. */
const conductor = (id: string, state: Activity['state']) => ({ id, role: 'conductor', state, message: 'Working out what you mean', label: 'Working out what you mean' }) as Activity;

function voice(opts: { owedMs?: number } = {}) {
  const model = new Scripted();
  const frames: VoiceFrame[] = [];
  const utters: { text: string; scene: Scene }[] = [];
  const clock = { now: 1000, style: 'own words' as VoiceStyle };
  const v = new LiveVoice(
    {
      open: model.open,
      options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' }, hearing: 'gpt-4o-transcribe', effort: 'minimal' },
      utter: (text, scene) => utters.push({ text, scene }),
      style: () => clock.style,
      words: (scene) => `Night stairs; Vertigo (${scene.treeId ?? 'no tree'})`,
      name: () => 'Momo',
      log: () => {},
      now: () => clock.now,
      idleMs: 60_000,
      owedMs: opts.owedMs,
    },
    (f) => frames.push(f),
  );
  const of = <T extends VoiceFrame['t']>(t: T) => frames.filter((f): f is Extract<VoiceFrame, { t: T }> => f.t === t);
  /** "Hey Momo, …" heard on turn `turn` and handed to the pipeline. */
  const turn = (turn: number, words: string[]) => {
    v.heard({ t: 'start', turn, scene: SCENE });
    v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
    model.hears(`item-${turn}`, words);
  };
  return { v, model, frames, utters, of, clock, turn };
}

test('the name opens a session that hears the turn and writes it down, and never answers it on its own', () => {
  const { v, model, frames } = voice();
  assert.deepEqual(frames, [{ t: 'ready', rate: 24000 }]);
  v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
  assert.equal(model.sessions.length, 0, 'audio before a start opens nothing');

  v.heard({ t: 'start', turn: 1, scene: SCENE });
  const setup = model.sent('session.update')[0]!.session as {
    tools?: unknown;
    audio: { input: { turn_detection: Record<string, unknown> }; output: { voice: string } };
  };
  assert.deepEqual(setup.audio.input.turn_detection, { type: 'semantic_vad', eagerness: 'high', create_response: false, interrupt_response: false });
  assert.equal(setup.audio.output.voice, 'marin');
  assert.equal(setup.tools, undefined, 'the model has no tool to act with');
  const hearing = model.sent('session.update').at(-1)!.session as { audio: { input: { transcription: { model: string; prompt: string } } } };
  assert.equal(hearing.audio.input.transcription.model, 'gpt-4o-transcribe');
  assert.match(hearing.audio.input.transcription.prompt, /call Momo.*Night stairs; Vertigo \(t1\)/, "told the name and the scene's card titles");
  v.heard({ t: 'audio', pcm: pcm([0, 300, 600]) });
  assert.equal(model.sent('input_audio_buffer.append').length, 1, 'what follows the name goes to the model');
});

test("the turn's end tells the device it is over, its words follow as they are written, and the whole goes to the pipeline; the model makes no response", () => {
  const { model, frames, utters, turn } = voice();
  turn(1, ['Hey', ' Momo,', ' show me', ' more.']);
  const after = frames.slice(1);
  assert.deepEqual(after[0], { t: 'over', turn: 1 }, 'over comes first, as soon as the model hears the end');
  assert.deepEqual(
    after.slice(1).map((f) => (f.t === 'heard' ? [f.text, f.final] : f.t)),
    [['Hey', false], ['Hey Momo,', false], ['Hey Momo, show me', false], ['Hey Momo, show me more.', false], ['Hey Momo, show me more.', true]],
  );
  assert.deepEqual(utters, [{ text: 'Hey Momo, show me more.', scene: SCENE }]);
  assert.equal(model.sent('response.create').length, 0, 'nothing is said until the pipeline says it');
  assert.deepEqual(model.sent('conversation.item.delete').map((e) => e.item_id), ['item-1'], "the user's audio leaves the model's conversation");
});

test("every say is spoken in a response of its own outside the model's conversation, in the style the setting asks for", () => {
  const { v, model, of, clock, turn } = voice();
  turn(1, ['Show me more like this.']);
  v.said('Looking for more like this.', 'reply');
  const [own] = model.asked();
  assert.equal(own!.conversation, 'none');
  assert.deepEqual(own!.input, [], 'nothing the user said is read but the line itself');
  assert.match(own!.instructions, /# The message to say\nLooking for more like this\./);
  assert.match(own!.instructions, /Keep every fact, name, title and number/);
  assert.match(own!.instructions, /Add nothing it does not say/);
  assert.match(own!.instructions, /User: Show me more like this\./, 'given the last few things said, so openings vary');
  model.speaks('r1', 'Finding more like this.');
  assert.deepEqual(of('text'), [{ t: 'text', id: 'r1', text: 'Finding more like this.', kind: 'reply' }]);
  assert.equal(of('audio').length, 2);
  assert.equal(of('done')[0]!.id, 'r1');

  clock.style = 'verbatim';
  v.said('Four new things under generative UI: a film "Minority Report".', 'results');
  const verbatim = model.asked()[1]!;
  assert.match(verbatim.instructions, /word for word, and nothing before or after it\nFour new things under generative UI: a film "Minority Report"\./);
  assert.doesNotMatch(verbatim.instructions, /own words/);
  model.speaks('r2', 'Four new things under generative UI: a film "Minority Report".');
  assert.equal(of('text').at(-1)!.kind, 'results');
});

test('Momo speaks in the language the user last spoke', () => {
  const { v, model, turn } = voice();
  turn(1, ['嘿 Momo，给我看看更多关于老地图的东西。']);
  v.said('Looking into old maps.', 'reply');
  assert.match(model.asked()[0]!.instructions, /Speak Mandarin Chinese\./);
});

test("a results line waits for the turn's reply, which goes first, and lines are said one at a time", () => {
  const { v, model, of } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  v.said('Four new things under Jaws.', 'results');
  assert.equal(model.sent('response.create').length, 0, 'nothing is said while the user is heard');
  model.hears('item-1', ['Undo that.']);
  assert.equal(model.sent('response.create').length, 0, 'the results wait for the reply');
  v.said('Undone.', 'reply');
  assert.equal(model.asked().length, 1);
  assert.match(model.asked()[0]!.instructions, /Undone\./);
  model.speaks('r1', 'Undone.');
  assert.equal(model.asked().length, 2, 'the next line once the first is done');
  assert.match(model.asked()[1]!.instructions, /Four new things under Jaws\./);
  assert.equal(of('quiet').length, 0);
});

test('without a kind, the first say after the utterance is its reply and the next is news', () => {
  const { v, model, of, turn } = voice();
  turn(1, ['More.']);
  v.said('Here is more.');
  model.speaks('r1', 'Here is more.');
  v.said('Five new things under Jaws.');
  model.speaks('r2', 'Five new things under Jaws.');
  assert.deepEqual(of('text').map((f) => f.kind), ['reply', 'results']);
});

test('the name alone, or nothing said after it, asks the pipeline nothing, and the device is told no reply is coming', () => {
  const { v, utters, of, turn } = voice();
  turn(1, ['Hey Momo.']);
  assert.deepEqual(utters, []);
  assert.deepEqual(of('quiet'), [{ t: 'quiet', turn: 1 }]);
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  v.heard({ t: 'cancel' });
  assert.deepEqual(utters, []);
});

test('a Conductor that fails, or ends with nothing to say, tells the device no reply is coming; one that replies does not', async () => {
  const { v, of, turn } = voice();
  turn(1, ['Do the thing.']);
  v.activity(conductor('c1', 'start'));
  v.activity(conductor('c1', 'error'));
  assert.deepEqual(of('quiet'), [{ t: 'quiet', turn: 1 }]);

  turn(2, ['Go back to the start.']);
  v.activity(conductor('c2', 'start'));
  v.activity(conductor('c2', 'done'));
  await tick();
  assert.deepEqual(of('quiet').at(-1), { t: 'quiet', turn: 2 });

  turn(3, ['More.']);
  v.activity(conductor('c3', 'start'));
  v.activity(conductor('c3', 'done'));
  v.said('Here is more.', 'reply');
  await tick();
  assert.equal(of('quiet').length, 2, 'a reply is coming for turn 3');
});

test('a turn with no reply after the wait is told so', async () => {
  const { of, turn } = voice({ owedMs: 20 });
  turn(1, ['Keep that.']);
  await new Promise((ok) => setTimeout(ok, 40));
  assert.deepEqual(of('quiet'), [{ t: 'quiet', turn: 1 }]);
});

test('the name while Momo speaks cancels the response, and the model is told only what the user heard of it', () => {
  const { v, model, clock, turn } = voice();
  turn(1, ['Tell me about the stairs.']);
  v.said('The stairs card is a photograph from above, taken in 1928 in Berlin by Ilse Brandt.', 'reply');
  model.speaks('r1', 'The stairs card is a photograph from above, taken in 1928 in Berlin by Ilse Brandt.', { ms: 4000, done: false });
  clock.now += 1000;
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  assert.deepEqual(model.sent('response.cancel').map((e) => e.response_id), ['r1']);
  model.hears('item-2', ['Keep it.']);
  v.said('Kept.', 'reply');
  const told = model.asked().at(-1)!.instructions;
  assert.match(told, /You: The stairs card is a…/, 'a quarter of it was heard, to a whole word');
  assert.doesNotMatch(told, /Ilse Brandt/);
  model.speaks('r1', 'more of the old line');
  assert.match(model.asked().at(-1)!.instructions, /Kept\./, "the cancelled response's late events are not taken for the new line");
});

for (const kind of ['reply', undefined] as const) {
  test(`a reply to a turn the user spoke over is not said, and the next turn's is (${kind ? 'with' : 'without'} a kind)`, () => {
    const { v, model, turn } = voice();
    turn(1, ['Find old maps.']);
    v.heard({ t: 'start', turn: 2, scene: SCENE });
    v.said('Looking for old maps.', kind);
    model.hears('item-2', ['Actually, find sea charts.']);
    v.said('Looking for sea charts.', kind);
    assert.deepEqual(model.asked().map((r) => /Looking for (.*)\./.exec(r.instructions)![1]), ['sea charts']);
  });
}


test('the device stopping at its longest commits what it sent, and the model still makes no response of its own', () => {
  const { v, model } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  v.heard({ t: 'end' });
  assert.equal(model.last.sent.at(-1)!.type, 'input_audio_buffer.commit');
  assert.equal(model.sent('response.create').length, 0);
});

test('a session that drops while the user is heard fails the turn, and the next name opens a new one', () => {
  const { v, model, of } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.last.closed('OpenAI realtime closed (1006)');
  assert.deepEqual(of('failed'), [{ t: 'failed', why: 'OpenAI realtime closed (1006)' }]);
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  assert.equal(model.sessions.length, 2);
});

test('what was heard of a line is cut at a whole word, or anywhere in words without spaces', () => {
  assert.equal(cut('Four new things under generative UI.', 0.5), 'Four new things…');
  assert.equal(cut('Four new things.', 1), 'Four new things.');
  assert.equal(cut('给我看看更多关于老地图', 0.5), '给我看看更多…');
});

test('16 kHz becomes 24 kHz by straight lines, carried across pieces', () => {
  const up = new Upsampler();
  const ramp = Array.from({ length: 30 }, (_, i) => i * 300);
  const whole = new Upsampler().push(Buffer.from(pcm(ramp), 'base64'));
  const parts = Buffer.concat([up.push(Buffer.from(pcm(ramp.slice(0, 7)), 'base64')), up.push(Buffer.from(pcm(ramp.slice(7)), 'base64'))]);
  assert.deepEqual(parts, whole, 'pieces join as if they were one');
  const out = Array.from({ length: whole.length / 2 }, (_, k) => whole.readInt16LE(k * 2));
  out.forEach((v, k) => assert.equal(v, Math.round(k * 200), `sample ${k} lies on the line`));
  assert.equal(out.length, 44, 'every output up to the last whole gap');
});

test('a response and a transcription cost what their tokens cost at the listed prices', () => {
  const dollars = cost('gpt-realtime-2.1-mini', {
    input_token_details: { text_tokens: 1000, audio_tokens: 40, cached_tokens_details: { text_tokens: 600, audio_tokens: 0 } },
    output_token_details: { text_tokens: 10, audio_tokens: 60 },
  });
  assert.ok(dollars !== null);
  assert.ok(Math.abs(dollars - (400 * 0.6 + 600 * 0.06 + 40 * 10 + 10 * 2.4 + 60 * 20) / 1e6) < 1e-12);
  const heard = cost('gpt-4o-transcribe', { input_tokens: 48, output_tokens: 15, input_token_details: { text_tokens: 13, audio_tokens: 35 } });
  assert.ok(heard !== null && Math.abs(heard - (13 * 2.5 + 35 * 6 + 15 * 10) / 1e6) < 1e-12);
  assert.equal(cost('some-other-model', {}), null);
});

test('the service refuses /live without a live voice, and with one hands a heard turn to the pipeline and speaks its reply in the chosen style', async () => {
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
  const run = await startServer({ ...base, dataDir, live: { open: model.open, options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' }, hearing: 'gpt-4o-transcribe' } } });
  const frames: VoiceFrame[] = [];
  const ws = new WebSocket(`${run.url.replace('http', 'ws')}/live?token=secret`);
  ws.on('message', (raw) => frames.push(JSON.parse(String(raw)) as VoiceFrame));
  await new Promise((ok) => ws.on('open', ok));
  const until = async (ok: () => boolean) => {
    while (!ok()) await new Promise((r) => setTimeout(r, 5));
  };
  await until(() => frames.length > 0);
  assert.deepEqual(frames[0], { t: 'ready', rate: 24000 });

  run.pipeline.setSettings({ voiceStyle: 'verbatim' });
  ws.send(JSON.stringify({ t: 'start', turn: 1, scene: { selection: [] } }));
  await until(() => model.sessions.length > 0);
  model.hears('item-1', ['Hey Momo, remember to buy film.']);
  await until(() => model.sent('response.create').length > 0);
  const [spoken] = model.asked();
  assert.match(spoken!.instructions, /word for word[^]*\nNoted\.\n/, "the fake Conductor's reply, as written");
  model.speaks('r1', 'Noted.');
  await until(() => frames.some((f) => f.t === 'done'));
  assert.deepEqual(
    frames.map((f) => f.t),
    ['ready', 'over', 'heard', 'heard', 'text', 'audio', 'audio', 'done'],
  );
  ws.close();
  await run.close();
});
