import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import type { ChangeSet } from '../src/core/domain.ts';
import type { Activity } from '../src/core/pipeline.ts';
import type { Scene, Turn } from '../src/core/roles/types.ts';
import type { CardNote } from '../src/core/voice-tools.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { cost, LiveVoice, Narration, Upsampler, type LiveDeps, type RealtimeEvent, type VoiceFrame } from '../src/node/live.ts';
import { startServer } from '../src/node/server.ts';
import { withoutLinks } from '../src/node/web-answer.ts';

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
  /** What Mind Palace told the model in its own messages. */
  told() {
    return this.sent('conversation.item.create').flatMap((e) => {
      const item = e.item as { role?: string; content?: { text: string }[] };
      return item.role === 'system' ? [item.content![0]!.text] : [];
    });
  }
  outputs() {
    return this.sent('conversation.item.create').flatMap((e) => ((e.item as { type: string }).type === 'function_call_output' ? [e.item as { call_id: string; output: string }] : []));
  }
  /** The model hears the end of the user's turn and writes it down. */
  hears(item: string, words: string) {
    const s = this.last;
    s.event({ type: 'input_audio_buffer.speech_stopped', item_id: item });
    s.event({ type: 'input_audio_buffer.committed', item_id: item });
    s.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: item, delta: words });
    s.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: item, transcript: words, usage: { type: 'tokens', input_tokens: 30, output_tokens: 8, input_token_details: { text_tokens: 10, audio_tokens: 20 } } });
  }
  /** A response begins: the turn detection's own (no metadata) or one the service asked for. */
  begins(id: string, purpose?: string) {
    this.last.event({ type: 'response.created', response: { id, metadata: purpose ? { purpose } : null } });
  }
  /** It says `words`: `ms` of audio in pieces of 100 ms. */
  says(id: string, words: string, ms = 200) {
    const s = this.last;
    s.event({ type: 'response.output_audio_transcript.delta', response_id: id, delta: words });
    for (let at = 0; at < ms; at += 100) s.event({ type: 'response.output_audio.delta', response_id: id, item_id: `${id}-audio`, delta: Buffer.alloc(4800).toString('base64') });
  }
  calls(id: string, call: string, name: string, args: object) {
    const s = this.last;
    s.event({ type: 'response.output_item.added', response_id: id, item: { type: 'function_call', call_id: call, name } });
    s.event({ type: 'response.function_call_arguments.done', response_id: id, call_id: call, arguments: JSON.stringify(args) });
  }
  ends(id: string, status = 'completed') {
    this.last.event({ type: 'response.done', response: { id, status, usage: { output_token_details: { audio_tokens: 40, text_tokens: 10 } } } });
  }
}

const SCENE: Scene = { focus: 'n1', selection: [], treeId: 't1' };
const pcm = (samples: number[]) => {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b.toString('base64');
};
const tick = () => new Promise((ok) => setTimeout(ok, 0));
const card = (title: string, anchor = 'n1'): CardNote => ({ anchor, under: 'Night stairs', kind: 'a picture', title, from: 'Rijksmuseum', why: 'The light' });
/** A Scout run's own step on its card (`whole`), or one of its parts, which name the card too. */
const scout = (id: string, state: Activity['state'], nodeId = 'n1', whole = true) => ({ t: 'activity', activity: { id, role: 'scout', state, label: 'Looking into Night stairs', message: '', nodeId, ...(whole ? { whole } : {}) } }) as const;
const landed = (...titles: string[]) => ({ t: 'change', set: { titles } as unknown as ChangeSet }) as const;

function voice(opts: { batchMs?: number; answerWaitMs?: number } = {}) {
  const model = new Scripted();
  const frames: VoiceFrame[] = [];
  const called: { name: string; args: string; scene: Scene }[] = [];
  const spoken: Turn[] = [];
  const steps: Activity[] = [];
  const clock = { now: 1000 };
  const answers: Record<string, () => Promise<Record<string, unknown>>> = {};
  const v = new LiveVoice(
    {
      open: model.open,
      options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' }, hearing: 'gpt-4o-transcribe', effort: 'minimal' },
      name: () => 'Momo',
      words: (scene) => `Night stairs; Vertigo (${scene.treeId ?? 'no tree'})`,
      tools: () => [{ type: 'function', name: 'web_answer' }],
      call: (name, args, scene) => {
        called.push({ name, args, scene });
        return answers[name]?.() ?? Promise.resolve({ started: true });
      },
      label: (name) => (name === 'web_answer' ? 'Searching the web for NASA' : undefined),
      where: (scene) => `The user has open the card "Night stairs" (${scene.focus ?? 'nothing'}).`,
      cards: (set) => ((set as unknown as { titles: string[] }).titles ?? []).map((t) => card(t)),
      nameOf: () => 'Night stairs',
      spoken: (turn) => spoken.push(turn),
      activity: (a) => steps.push(a),
      log: () => {},
      now: () => clock.now,
      idleMs: 60_000,
      batchMs: opts.batchMs ?? 6000,
      answerWaitMs: opts.answerWaitMs,
    },
    (f) => frames.push(f),
  );
  const of = <T extends VoiceFrame['t']>(t: T) => frames.filter((f): f is Extract<VoiceFrame, { t: T }> => f.t === t);
  /** "Hey Momo, …" heard on turn `n`. */
  const turn = (n: number, words: string) => {
    v.heard({ t: 'start', turn: n, scene: SCENE });
    v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
    model.hears(`item-${n}`, words);
  };
  return { v, model, frames, called, spoken, steps, of, clock, turn, answers };
}

test('the name opens a session in which Momo answers in its own character, with its tools, told where the user is', () => {
  const { v, model, frames } = voice();
  assert.deepEqual(frames, [{ t: 'ready', rate: 24000 }]);
  v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
  assert.equal(model.sessions.length, 0, 'audio before a start opens nothing');

  v.heard({ t: 'start', turn: 1, scene: SCENE });
  const setup = model.sent('session.update')[0]!.session as {
    instructions: string;
    tools: { name: string }[];
    audio: { input: { turn_detection: Record<string, unknown> }; output: { voice: string } };
  };
  assert.deepEqual(setup.audio.input.turn_detection, { type: 'semantic_vad', eagerness: 'high', create_response: true, interrupt_response: false });
  assert.equal(setup.audio.output.voice, 'marin');
  assert.deepEqual(setup.tools.map((t) => t.name), ['web_answer']);
  assert.match(setup.instructions, /curious, warm friend/);
  assert.match(setup.instructions, /Never read out a status/);
  assert.match(setup.instructions, /Never add a fact, date, name or claim about a card that its note does not state/);
  const hearing = model.sent('session.update').at(-1)!.session as { audio: { input: { transcription: { model: string; prompt: string } } } };
  assert.match(hearing.audio.input.transcription.prompt, /call Momo.*Night stairs; Vertigo \(t1\)/, "told the name and the scene's card titles");
  assert.deepEqual(model.told(), ['[Where the user is] The user has open the card "Night stairs" (n1).']);
  v.heard({ t: 'audio', pcm: pcm([0, 300, 600]) });
  assert.equal(model.sent('input_audio_buffer.append').length, 1, 'what follows the name goes to the model');

  v.heard({ t: 'start', turn: 2, scene: SCENE });
  assert.equal(model.told().length, 1, 'the same scene is not told again');
  v.heard({ t: 'start', turn: 3, scene: { ...SCENE, focus: 'n2' } });
  assert.equal(model.told().at(-1), '[Where the user is] The user has open the card "Night stairs" (n2).');
});

test("the user's words follow as they are written down, the turn is over as Momo's own answer begins, and the answer is heard as it comes", () => {
  const { model, frames, spoken, turn } = voice();
  turn(1, 'Hey Momo, who painted Girl with a Pearl Earring?');
  assert.deepEqual(frames.slice(1), [
    { t: 'heard', turn: 1, text: 'Who painted Girl with a Pearl Earring?', final: false },
    { t: 'heard', turn: 1, text: 'Who painted Girl with a Pearl Earring?', final: true },
  ]);
  assert.equal(model.sent('response.create').length, 0, 'the turn detection asks for the answer itself');
  model.begins('r1');
  model.says('r1', 'Vermeer, around 1665.');
  model.ends('r1');
  assert.deepEqual(frames.slice(3).map((f) => (f.t === 'text' ? [f.t, f.text, f.kind] : f.t)), ['over', ['text', 'Vermeer, around 1665.', 'reply'], 'audio', 'audio', 'done']);
  assert.deepEqual(spoken, [{ who: 'user', text: 'Who painted Girl with a Pearl Earring?' }, { who: 'agent', text: 'Vermeer, around 1665.' }]);
});

test('a web question: the call runs as soon as the model makes it, its label shows meanwhile, and its answer is spoken after the lead-in', async () => {
  const { model, called, steps, of, turn, answers } = voice();
  let answer!: (v: Record<string, unknown>) => void;
  answers.web_answer = () => new Promise((ok) => (answer = ok));
  turn(1, 'What did NASA launch this month?');
  model.begins('r1');
  model.says('r1', 'Let me check that.');
  model.calls('r1', 'c1', 'web_answer', { question: 'What did NASA launch this month?' });
  assert.deepEqual(called.map((c) => [c.name, c.args, c.scene.focus]), [['web_answer', '{"question":"What did NASA launch this month?"}', 'n1']], 'before the response ends');
  assert.deepEqual(steps.map((s) => [s.role, s.state, s.label]), [['momo', 'start', 'Searching the web for NASA']]);
  model.ends('r1');
  answer({ answer: 'ESCAPADE, on 13 November.' });
  await tick();
  assert.deepEqual(model.outputs(), [{ type: 'function_call_output', call_id: 'c1', output: '{"answer":"ESCAPADE, on 13 November."}' }]);
  assert.deepEqual(model.sent('response.create').map((e) => e.response), [{ metadata: { purpose: 'reply' } }]);
  assert.deepEqual(steps.map((s) => s.state), ['start', 'done']);
  model.begins('r2', 'reply');
  model.says('r2', 'It was ESCAPADE.');
  model.ends('r2');
  assert.deepEqual(of('text').map((f) => f.kind), ['reply', 'reply']);
  assert.equal(of('quiet').length, 0);
});

test('an answer that arrives while Momo still speaks waits for the response to end', async () => {
  const { model, turn } = voice();
  turn(1, 'What is the weather in Delft?');
  model.begins('r1');
  model.calls('r1', 'c1', 'web_answer', { question: 'weather in Delft' });
  model.says('r1', 'One moment.');
  await tick();
  assert.equal(model.outputs().length, 0, 'not while the lead-in is still being given');
  model.ends('r1');
  assert.equal(model.outputs().length, 1);
  assert.equal(model.sent('response.create').length, 1);
});

test('an act Momo announced as it called it needs no further response; one that could not be done is answered', async () => {
  const { model, turn, answers } = voice();
  turn(1, 'Find me something about Dutch still lifes.');
  model.begins('r1');
  model.says('r1', 'Ooh, let me dig some up.');
  model.calls('r1', 'c1', 'find_new', { subject: 'Dutch still lifes', angle: '' });
  model.ends('r1');
  await tick();
  assert.equal(model.outputs().length, 1);
  assert.equal(model.sent('response.create').length, 0, 'the output joins the conversation, and Momo says nothing more about it');

  answers.keep = async () => ({ done: false, why: 'Which one should I keep?' });
  turn(2, 'Keep it.');
  model.begins('r2');
  model.says('r2', 'Keeping it.');
  model.calls('r2', 'c2', 'keep', { which: 'this' });
  model.ends('r2');
  await tick();
  assert.equal(model.sent('response.create').length, 1, 'Momo says why it could not');
});

test('a turn whose answer says nothing and waits on no call tells the device none is coming; one that calls first keeps thinking', async () => {
  const { model, of, turn } = voice();
  turn(1, 'Hmm.');
  model.begins('r1');
  model.ends('r1');
  assert.deepEqual(of('quiet'), [{ t: 'quiet', turn: 1 }]);

  turn(2, 'Undo that.');
  model.begins('r2');
  model.calls('r2', 'c2', 'undo', {});
  model.ends('r2');
  await tick();
  assert.equal(of('quiet').length, 1, 'still thinking: the call answers the turn');
  assert.equal(model.sent('response.create').length, 1, 'nothing was heard of the turn, so Momo speaks after the call');
});

test('cards of a run this device asked for are walked through: the first at once, later ones gathered, a wrap-up at the end', () => {
  const { v, model, clock } = voice({ batchMs: 6000 });
  v.observed(scout('run1', 'start'));
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  v.observed(landed('Still life with flowers'));
  assert.equal(model.told().filter((t) => t.startsWith('[Card')).length, 0, 'not while the user is heard');
  model.hears('item-1', 'Is it pretty?');
  model.begins('r1');
  model.says('r1', 'Very.');
  model.ends('r1');
  const first = model.told().at(-1)!;
  assert.match(first, /^\[Card landed\] The first card under "Night stairs": a picture "Still life with flowers", from Rijksmuseum\. Why it was picked: The light\./);
  assert.deepEqual(model.sent('response.create').at(-1)!.response, { metadata: { purpose: 'results' } });
  model.begins('r2', 'results');
  model.says('r2', 'First one is up.');
  model.ends('r2');

  clock.now += 1000;
  v.observed(landed('The Milkmaid', 'Delft'));
  assert.equal(model.sent('response.create').length, 1, 'later cards wait to be gathered');
  clock.now += 5000;
  v.observed(landed('Camera obscura'));
  assert.match(model.told().at(-1)!, /^\[More cards landed\] Under "Night stairs", 3 more: a picture "The Milkmaid".*"Delft".*"Camera obscura"/);
  model.begins('r3', 'results');
  model.ends('r3');

  clock.now += 4000;
  v.observed(scout('run1', 'done'));
  v.observed({ t: 'say', text: 'Four new things under Night stairs.', kind: 'results' });
  assert.match(model.told().at(-1)!, /^\[All done\] The search for "Night stairs" is finished: 4 new cards in all\. Wrap up/);
  assert.ok(!model.told().some((t) => t.includes('Four new things')), "the run's own closing line is left to the wrap-up");
  model.begins('r4', 'results');
  model.ends('r4');
  v.observed({ t: 'say', text: 'Your handoff is ready: night-stairs.', kind: 'results' });
  assert.equal(model.told().at(-1), '[From the agents] Your handoff is ready: night-stairs.');
});

test("a run may bring nothing, a step that is not a run's own ends nothing, and a card after its wrap-up is news of its own", () => {
  const n = new Narration(6000);
  n.began('run', 'n1', 'Night stairs');
  assert.equal(n.ended('search'), false, 'a part of the run');
  assert.equal(n.next(0), null);
  assert.equal(n.ended('run'), true);
  assert.match(n.next(1)!, /^\[All done\] The search for "Night stairs" brought nothing new/);
  assert.equal(n.due(), null);
  n.landed(card('A late picture'));
  assert.match(n.next(10_000)!, /^\[More cards landed\] Under "Night stairs", 1 more: a picture "A late picture"/);
  n.began('again', 'n1', 'Night stairs');
  n.landed(card('Fresh'));
  assert.match(n.next(20_000)!, /^\[Card landed\] The first card under "Night stairs": a picture "Fresh"/, 'a run begun after the last ended is new');
});

test('a newer run on a card Momo is walking through goes on as one run: the older one ending says nothing, and the wrap-up waits for the last', () => {
  const { v, model, clock } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.hears('item-1', 'Find me bread pictures.');
  model.begins('r0');
  model.ends('r0');
  v.observed(scout('older', 'start'));
  v.observed(scout('older-search', 'start', 'n1', false));
  v.observed(scout('newer', 'start'));
  v.observed(scout('older-search', 'done', 'n1', false));
  v.observed(scout('older', 'done'));
  assert.ok(!model.told().some((t) => t.startsWith('[All done]')), `nothing is said of the older run, whose cards the pipeline drops: ${model.told().join(' | ')}`);
  v.observed(landed('Rye loaf'));
  assert.match(model.told().at(-1)!, /^\[Card landed\] The first card under "Night stairs": a picture "Rye loaf"/);
  model.begins('r1', 'results');
  model.ends('r1');
  v.observed(scout('picture', 'start', 'n1', false));
  clock.now += 4000;
  v.observed(scout('newer', 'done'));
  v.observed({ t: 'say', text: 'One new thing under Night stairs.', kind: 'results' });
  assert.match(model.told().at(-1)!, /^\[All done\] The search for "Night stairs" is finished: 1 new card in all\./, 'the wrap-up comes as the run ends, though its picture is still being made');
  assert.ok(!model.told().some((t) => t.includes('One new thing')));
});

test("a run on a card deleted while it ran, which the pipeline closes with no line, does not swallow the next line from the agents", async () => {
  const { v, model } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.hears('item-1', 'Find me bread pictures.');
  model.begins('r0');
  model.ends('r0');
  v.observed(scout('run', 'start'));
  v.observed(scout('run', 'done'));
  model.begins('r1', 'results');
  model.ends('r1');
  await tick();
  v.observed({ t: 'say', text: 'Your handoff is ready: bread.', kind: 'results' });
  assert.equal(model.told().at(-1), '[From the agents] Your handoff is ready: bread.');
});

test('a session OpenAI says has expired is closed at once, and the next name opens a new one', () => {
  const { v, model, of } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.last.event({ type: 'error', error: { type: 'invalid_request_error', code: 'session_expired', message: 'Your session hit the maximum duration of 60 minutes.' } });
  assert.equal(model.last.shut, true);
  assert.deepEqual(of('failed').map((f) => f.t), ['failed'], 'the turn being heard fails');
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  assert.equal(model.sessions.length, 2);
});

test('the name while Momo speaks stops it and cuts its voice in the conversation where the device was; a response asked for that had not begun is cancelled when it does', () => {
  const { v, model, clock, turn } = voice();
  turn(1, 'Tell me about Vermeer.');
  model.begins('r1');
  model.says('r1', 'Vermeer painted light like nobody else.', 1000);
  clock.now += 400;
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  assert.deepEqual(model.sent('response.cancel').at(-1), { type: 'response.cancel', response_id: 'r1' });
  assert.deepEqual(model.sent('conversation.item.truncate').at(-1), { type: 'conversation.item.truncate', item_id: 'r1-audio', content_index: 0, audio_end_ms: 400 });
  model.hears('item-2', 'Wait, what about Rembrandt?');

  v.observed(scout('run1', 'start'));
  model.begins('r2');
  model.ends('r2');
  v.observed(landed('Night Watch'));
  assert.equal(model.sent('response.create').length, 1);
  v.heard({ t: 'start', turn: 3, scene: SCENE });
  model.begins('r3', 'results');
  assert.deepEqual(model.sent('response.cancel').at(-1), { type: 'response.cancel', response_id: 'r3' });
});

test('a session that drops while the user is heard fails the turn, and the next name opens a new one', () => {
  const { v, model, of } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.last.closed('OpenAI realtime closed (1006)');
  assert.deepEqual(of('failed'), [{ t: 'failed', why: 'OpenAI realtime closed (1006)' }]);
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  assert.equal(model.sessions.length, 2);
});

test("a turn the device ends itself is answered on the service's asking", () => {
  const { v, model, frames } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  v.heard({ t: 'end' });
  assert.deepEqual(model.last.sent.slice(-2).map((e) => e.type), ['input_audio_buffer.commit', 'response.create'], 'the answer is asked for with the commit');
  v.heard({ t: 'end' });
  model.last.event({ type: 'input_audio_buffer.committed', item_id: 'item-1' });
  assert.deepEqual(model.sent('response.create').map((e) => e.response), [{ metadata: { purpose: 'reply' } }], 'once');
  model.begins('r1', 'reply');
  model.says('r1', 'Hello.');
  model.ends('r1');
  assert.deepEqual(frames.filter((f) => f.t === 'over'), [{ t: 'over', turn: 1 }]);
});

test("1.8 s of quiet after the last word ends a turn the model's turn detection has not, and a shorter pause does not", () => {
  const { v, model } = voice();
  const piece = (amp: number) => pcm(Array.from({ length: 1600 }, (_, i) => Math.round(amp * 32767 * Math.sin(i / 3) + (i % 7) - 3)));
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  for (let k = 0; k < 8; k++) v.heard({ t: 'audio', pcm: piece(0) });
  for (let k = 0; k < 5; k++) v.heard({ t: 'audio', pcm: piece(0.2) });
  for (let k = 0; k < 17; k++) v.heard({ t: 'audio', pcm: piece(0) });
  assert.equal(model.sent('input_audio_buffer.commit').length, 0, 'the quiet before the first word, and 1.7 s after it, end nothing');
  for (let k = 0; k < 3; k++) v.heard({ t: 'audio', pcm: piece(0.2) });
  for (let k = 0; k < 18; k++) v.heard({ t: 'audio', pcm: piece(0) });
  assert.deepEqual(model.last.sent.slice(-2).map((e) => e.type), ['input_audio_buffer.commit', 'response.create']);
  const appended = model.sent('input_audio_buffer.append').length;
  v.heard({ t: 'audio', pcm: piece(0.2) });
  assert.equal(model.sent('input_audio_buffer.append').length, appended, 'nothing more is sent once it is over');
});

test('a turn the turn detection ended at a pause goes on when the user does: its early answer is cancelled, and its words are kept whole', () => {
  const { v, model, frames } = voice();
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.hears('item-1', 'So');
  model.last.event({ type: 'input_audio_buffer.speech_started' });
  model.begins('r1');
  assert.deepEqual(model.sent('response.cancel').at(-1), { type: 'response.cancel', response_id: 'r1' }, 'the answer to "So" is not wanted');
  v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
  assert.equal(model.sent('input_audio_buffer.append').length, 1, 'the microphone still goes to the model');
  model.hears('item-2', 'why did Vermeer paint so few pictures?');
  model.begins('r2');
  const heard = frames.filter((f) => f.t === 'heard' && f.final);
  assert.deepEqual(heard.at(-1), { t: 'heard', turn: 1, text: 'So why did Vermeer paint so few pictures?', final: true });
  assert.deepEqual(frames.filter((f) => f.t === 'over'), [{ t: 'over', turn: 1 }], 'over once, as the answer to all of it begins');
});

test('a turn the turn detection ended but never answered is answered on the service\'s asking', async () => {
  const { model, frames, turn } = voice({ answerWaitMs: 5 });
  turn(1, 'Hello?');
  assert.equal(model.sent('response.create').length, 0);
  await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(model.sent('response.create').map((e) => e.response), [{ metadata: { purpose: 'reply' } }]);
  model.begins('r1', 'reply');
  assert.deepEqual(frames.filter((f) => f.t === 'over'), [{ t: 'over', turn: 1 }]);
});

test('a web answer is spoken without its links', () => {
  assert.equal(
    withoutLinks('M. John Harrison won it for The End of Everything. ([thebookerprizes.com](https://thebookerprizes.com/x?utm_source=openai))'),
    'M. John Harrison won it for The End of Everything.',
  );
  assert.equal(withoutLinks('See [the museum](https://rijksmuseum.nl) for the hours.'), 'See the museum for the hours.');
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

test("the service refuses /live without a live voice; with one, what Momo starts is the named connection's own, and Momo walks through its cards", async () => {
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
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
  await run.pipeline.idle();
  const tree = [...run.mind.trees.values()][0]!;
  const until = async (ok: () => boolean) => {
    while (!ok()) await new Promise((r) => setTimeout(r, 5));
  };
  const connect = async () => {
    const got: { t: string; yours?: boolean; connection?: string; set?: { origin: { role?: string } } }[] = [];
    const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`);
    ws.on('message', (raw) => got.push(JSON.parse(String(raw))));
    await until(() => got.some((m) => m.t === 'hello'));
    return { ws, got, id: got.find((m) => m.t === 'hello')!.connection! };
  };
  const headset = await connect();
  const page = await connect();
  assert.notEqual(headset.id, page.id);

  const frames: VoiceFrame[] = [];
  const live = new WebSocket(`${run.url.replace('http', 'ws')}/live?token=secret&connection=${headset.id}`);
  live.on('message', (raw) => frames.push(JSON.parse(String(raw)) as VoiceFrame));
  await until(() => frames.length > 0);
  assert.deepEqual(frames[0], { t: 'ready', rate: 24000 });

  live.send(JSON.stringify({ t: 'start', turn: 1, scene: { focus: tree.rootId, treeId: tree.id, selection: [] } }));
  await until(() => model.sessions.length > 0 && model.told().length > 0);
  assert.match(model.told()[0]!, /^\[Where the user is\] The user has open the card "Sourdough rises slowly in winter"/);
  model.hears('item-1', 'Hey Momo, find me some bread pictures.');
  model.begins('r1');
  model.says('r1', 'Ooh, on it.');
  model.calls('r1', 'c1', 'find_new', { subject: 'bread pictures', angle: '' });
  model.ends('r1');
  await until(() => model.told().some((t) => t.startsWith('[Card landed]')));
  await run.pipeline.idle();
  const picks = (got: typeof headset.got) => got.filter((m) => m.t === 'change' && m.set?.origin.role === 'scout');
  await until(() => picks(headset.got).length > 0 && picks(page.got).length === picks(headset.got).length);
  assert.ok(picks(headset.got).length > 0 && picks(headset.got).every((m) => m.yours === true), "the run's cards are the headset's own");
  assert.ok(picks(page.got).length > 0 && picks(page.got).every((m) => m.yours === undefined), "and reach the page as everyone's");
  assert.equal(JSON.parse(model.outputs()[0]!.output).started, true);

  model.hears('item-2', 'Hey Momo, who won the Booker this year?');
  model.begins('r2');
  model.calls('r2', 'c2', 'web_answer', { question: 'Booker Prize 2026' });
  model.ends('r2');
  const momo = (got: typeof headset.got) => got.filter((m) => m.t === 'activity' && (m as { activity?: { role: string } }).activity?.role === 'momo');
  await until(() => momo(headset.got).length >= 2);
  assert.deepEqual(momo(page.got), [], "Momo's own steps reach only the headset that asked");
  live.close();
  headset.ws.close();
  page.ws.close();
  await run.close();
});
