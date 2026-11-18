import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import type { ChangeSet } from '../src/core/domain.ts';
import type { Activity } from '../src/core/pipeline.ts';
import { scout as scoutRole } from '../src/core/roles/scout.ts';
import type { Scene, Turn } from '../src/core/roles/types.ts';
import type { CardNote } from '../src/core/voice-tools.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { cost, LiveVoice, Narration, Upsampler, type LiveDeps, type RealtimeEvent, type VoiceFrame } from '../src/node/live.ts';
import { ClientMessage, DeviceFrame } from '../src/node/protocol.ts';
import { startServer } from '../src/node/server.ts';
import { withoutLinks } from '../src/node/web-answer.ts';
import { tempDir } from './temp.ts';

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
    this.commits(item);
    this.last.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: item, delta: words });
    this.writes(item, words);
  }
  /** The model hears the end of the user's turn, and has not written it down yet. */
  commits(item: string) {
    this.last.event({ type: 'input_audio_buffer.speech_stopped', item_id: item });
    this.last.event({ type: 'input_audio_buffer.committed', item_id: item });
  }
  writes(item: string, words: string) {
    this.last.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: item, transcript: words, usage: { type: 'tokens', input_tokens: 30, output_tokens: 8, input_token_details: { text_tokens: 10, audio_tokens: 20 } } });
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

function voice(opts: { batchMs?: number; answerWaitMs?: number; named?: LiveDeps['named']; nameWaitMs?: number } = {}) {
  const model = new Scripted();
  const frames: VoiceFrame[] = [];
  const called: { name: string; args: string; scene: Scene }[] = [];
  const spoken: Turn[] = [];
  const steps: Activity[] = [];
  const clock = { now: 1000 };
  const answers: Record<string, (said: () => Promise<string | undefined>) => Promise<Record<string, unknown>>> = {};
  const v = new LiveVoice(
    {
      open: model.open,
      options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' }, hearing: 'gpt-4o-transcribe', effort: 'minimal' },
      name: () => 'Momo',
      words: (scene) => `Night stairs; Vertigo (${scene.treeId ?? 'no tree'})`,
      tools: () => [{ type: 'function', name: 'web_answer' }],
      call: (name, args, scene, said) => {
        called.push({ name, args, scene });
        return answers[name]?.(said) ?? Promise.resolve({ started: true });
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
      ...(opts.named ? { named: opts.named } : {}),
      ...(opts.nameWaitMs !== undefined ? { nameWaitMs: opts.nameWaitMs } : {}),
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
  assert.deepEqual(setup.audio.input.turn_detection, { type: 'semantic_vad', eagerness: 'low', create_response: false, interrupt_response: false });
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

test("a lesson of the welcome walk is answered from the words the device wrote down: Momo is told the picture and the lesson's cards, and her answer may call no tool", () => {
  const { v, model, frames, spoken } = voice();
  const lesson = {
    t: 'lesson' as const, turn: 1, words: 'What is she holding?', picture: 'A woman in blue reads a letter by a window.',
    cards: [{ title: 'From your sketch', says: 'The letter in her hands' }, { title: 'The Milkmaid', says: '' }],
  };
  assert.deepEqual(DeviceFrame.parse(lesson), lesson);
  assert.throws(() => DeviceFrame.parse({ ...lesson, words: 'x'.repeat(501) }));
  assert.throws(() => DeviceFrame.parse({ ...lesson, cards: Array.from({ length: 9 }, () => ({ title: 'A card', says: '' })) }));
  v.heard(lesson);
  assert.equal(model.sessions.length, 1, 'it opens the session, as a turn does');
  const told = model.told().at(-1)!;
  assert.match(told, /^\[Welcome walk\]/);
  assert.match(told, /The picture: A woman in blue reads a letter by a window\./);
  assert.match(told, /1\. From your sketch: The letter in her hands\n2\. The Milkmaid\n/);
  assert.match(told, /Start no search and no tree, and call no tool/);
  const said = model.sent('conversation.item.create').at(-1)!.item as { role: string; content: { text: string }[] };
  assert.deepEqual([said.role, said.content[0]!.text], ['user', 'What is she holding?']);
  assert.deepEqual(model.sent('response.create').map((e) => e.response), [{ metadata: { purpose: 'reply' }, tool_choice: 'none' }]);
  model.begins('r1', 'reply');
  model.says('r1', 'A letter, held up to the light. Round you now: the part you marked, and The Milkmaid.');
  model.ends('r1');
  assert.deepEqual(frames.slice(1).map((f) => (f.t === 'text' ? [f.t, f.kind, f.turn] : f.t)), [['text', 'reply', 1], 'audio', 'audio', 'done'], 'its words name the turn they answer');
  assert.deepEqual(spoken.map((t) => t.who), ['user', 'agent'], 'the lesson stays in the conversation');

  // A lesson while Momo speaks stops her, and a turn being heard is dropped for it; a turn after it may call tools as ever.
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  model.begins('r2', 'reply');
  model.says('r2', 'Let me look');
  v.heard({ ...lesson, turn: 3 });
  assert.deepEqual(model.sent('response.cancel').map((e) => e.response_id), ['r2']);
  assert.equal(model.sent('input_audio_buffer.clear').length, 2, 'the turn heard is cleared, as its start cleared before it');
  assert.equal(model.sent('response.create').at(-1)!.response && (model.sent('response.create').at(-1)!.response as { tool_choice?: string }).tool_choice, 'none');
  v.heard({ t: 'start', turn: 4, scene: SCENE });
  v.heard({ t: 'end' });
  assert.deepEqual(model.sent('response.create').at(-1)!.response, { metadata: { purpose: 'reply' } });
});

/** A JPEG as the headset sends one, in a data URL: a few bytes stand for the picture. */
const jpeg = (name: string) => `data:image/jpeg;base64,${Buffer.from(`jpeg of ${name}`).toString('base64')}`;
/** What Momo was shown of what the user marked: each message of the user's that holds pictures, as its text and its pictures. */
const sights = (model: Scripted) =>
  model.sent('conversation.item.create').flatMap((e) => {
    const item = e.item as { role?: string; content?: { type: string; text?: string; image_url?: string; detail?: string }[] };
    const images = item.content?.filter((c) => c.type === 'input_image') ?? [];
    return item.role === 'user' && images.length > 0 ? [{ text: item.content!.find((c) => c.type === 'input_text')?.text ?? '', images: images.map((c) => [c.image_url, c.detail]) }] : [];
  });

test("what the user marked on a card is shown to Momo with the next turn begun on that card, once a conversation, and taken back when the marks go", () => {
  const { v, model } = voice();
  const look = ClientMessage.parse({ t: 'look', nodeId: 'n1', title: 'Night stairs', box: [0.2, 0.3, 0.4, 0.3], crop: jpeg('the part'), whole: jpeg('the whole') });
  assert.equal(look.t, 'look');
  assert.throws(() => ClientMessage.parse({ ...look, crop: 'data:image/png;base64,AAAA' }), 'only a JPEG');
  assert.throws(() => ClientMessage.parse({ ...look, crop: `data:image/jpeg;base64,${'A'.repeat(300_001)}` }), 'and no larger than the limit');
  if (look.t !== 'look') return;
  v.look({ ...look, nodeId: 'n2' });
  turn(1);
  assert.deepEqual(sights(model), [], 'a card that is not the one open is not shown');

  v.look(look);
  turn(2);
  const shown = sights(model);
  assert.equal(shown.length, 1, 'with the card open, the next turn shows it');
  assert.match(shown[0]!.text, /I drew a line round part of the picture on "Night stairs"\. The first image is that part, cut out; the second is the whole picture/);
  assert.deepEqual(shown[0]!.images, [[jpeg('the part'), 'high'], [jpeg('the whole'), 'low']], 'the part in detail, the whole at a glance');
  // It is the last thing put in the conversation as the turn begins, so the words heard next come after it.
  const last = model.sent('conversation.item.create').at(-1)!.item as { role: string; content: { type: string }[] };
  assert.deepEqual([last.role, last.content.map((c) => c.type)], ['user', ['input_text', 'input_image', 'input_image']]);
  turn(3);
  assert.equal(sights(model).length, 1, 'once a conversation');

  // A new conversation has seen nothing: it is shown again while the marks stand.
  v.close();
  turn(4);
  assert.equal(sights(model).length, 1, 'the new session shows it once');

  // The marks gone, nothing is shown.
  v.close();
  v.look({ t: 'look', nodeId: 'n1', title: 'Night stairs' });
  turn(5);
  assert.equal(sights(model).length, 0, 'none once the marks are gone');

  function turn(n: number) {
    v.heard({ t: 'start', turn: n, scene: SCENE });
  }
});

test("a look that comes while the turn begun on its card is still being heard is shown at once, and one after her answer is asked for waits for the next turn", () => {
  const { v, model } = voice();
  const look = { t: 'look' as const, nodeId: 'n1', title: 'Night stairs', box: [0.2, 0.3, 0.4, 0.3] as [number, number, number, number], crop: jpeg('the part'), whole: jpeg('the whole') };
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
  v.look({ ...look, nodeId: 'n2' });
  assert.equal(sights(model).length, 0, "another card's look is not shown in this card's turn");
  v.look(look);
  assert.equal(sights(model).length, 1, "this card's is shown at once, while the words are still heard");
  v.heard({ t: 'end' });
  assert.equal(model.sent('response.create').length, 1, 'her answer is asked for');
  v.look({ ...look, crop: jpeg('another part') });
  assert.equal(sights(model).length, 1, 'a look after that waits');
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  assert.deepEqual(sights(model).at(-1)!.images[0], [jpeg('another part'), 'high'], 'and is shown with the next turn on the card');
});

test("the welcome walk's sketch is shown to Momo before the lesson's words, within five minutes of being sent", () => {
  const { v, model, clock } = voice();
  const lesson = { t: 'lesson' as const, turn: 1, words: 'What is she holding?', picture: 'A woman in blue reads a letter by a window.', cards: [] };
  v.look({ t: 'look', title: 'Woman Reading a Letter', box: [0.4, 0.3, 0.2, 0.3], crop: jpeg('the letter'), whole: jpeg('the painting') });
  v.heard(lesson);
  const items = model.sent('conversation.item.create').map((e) => e.item as { role: string; content: { type: string; text?: string }[] });
  assert.deepEqual(items.map((i) => [i.role, i.content.map((c) => c.type).join(' ')]), [
    ['system', 'input_text'],
    ['user', 'input_text input_image input_image'],
    ['user', 'input_text'],
  ], 'the lesson, then the sketch, then the words');
  assert.equal(items[2]!.content[0]!.text, 'What is she holding?');
  assert.deepEqual(model.sent('response.create').map((e) => e.response), [{ metadata: { purpose: 'reply' }, tool_choice: 'none' }], 'her answer may still call no tool');

  // A sketch sent long before is not the one asked about.
  v.close();
  v.look({ t: 'look', title: 'Woman Reading a Letter', box: [0.4, 0.3, 0.2, 0.3], crop: jpeg('the letter'), whole: jpeg('the painting') });
  clock.now += 5 * 60 * 1000 + 1;
  v.heard({ ...lesson, turn: 2 });
  assert.equal(sights(model).length, 0, 'not five minutes after it was sent');
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

test("connecting Telegram: after a lead-in, Momo is still asked to say the bot and the code, and her caption shows the code in digits until the next turn", async () => {
  const { model, turn, answers, of } = voice();
  answers.connect_telegram = async () => ({ done: true, bot: '@a_bot', code: '482 917', note: 'Say the bot and the code.' });
  turn(1, 'Connect my Telegram.');
  model.begins('r1');
  model.says('r1', "Okay, let's get your Telegram connected—one moment while I pull up the pairing details.");
  model.calls('r1', 'c1', 'connect_telegram', {});
  model.ends('r1');
  await tick();
  assert.equal(model.outputs().length, 1);
  assert.deepEqual(model.sent('response.create').map((e) => e.response), [{ metadata: { purpose: 'reply' } }], 'she is asked to say what the tool gave her');
  model.begins('r2', 'reply');
  model.says('r2', 'Open Telegram and find @a_bot. Send it this code: four, eight, two, nine, one, seven. It works once, for ten minutes.');
  model.ends('r2');
  assert.equal(of('text').at(-1)!.text, 'Open Telegram and find @a_bot. Send it this code: 4 8 2 9 1 7. It works once, for ten minutes.');
  turn(2, 'Thanks, one two three.');
  model.begins('r3');
  model.says('r3', 'You said one, two, three.');
  assert.equal(of('text').at(-1)!.text, 'You said one, two, three.', 'a new turn: her words as she says them');
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
  const wrap = model.told().at(-1)!;
  assert.match(wrap, /^\[Wrap up\] The search for "Night stairs" has brought 1 new card\. Wrap up in one or two short sentences/, 'the wrap-up comes as the run ends, though its picture is still being made');
  assert.doesNotMatch(wrap, /finished|All done/, 'a search whose picture is still being made is not called finished');
  assert.ok(!model.told().some((t) => t.includes('One new thing')));
  model.begins('r2', 'results');
  model.ends('r2');
  clock.now += 20_000;
  v.observed(scout('picture', 'done', 'n1', false));
  v.observed(landed('Rye loaf at dawn'));
  assert.match(model.told().at(-1)!, /^\[More cards landed\] Under "Night stairs", 1 more: a picture "Rye loaf at dawn"/, 'the late picture is told as one more');
});

test('the wrap-up calls a search finished only when none of its parts is still at work on its card, such as a picture being made', () => {
  const n = new Narration(6000);
  n.began('run', 'n1', 'Night stairs');
  n.part('search', 'n1');
  n.part('picture', 'n1');
  n.part('elsewhere', 'n2');
  n.landed(card('Rye loaf'));
  assert.match(n.next(0)!, /^\[Card landed\]/);
  assert.equal(n.ended('search'), false, 'a part ending ends no run');
  assert.equal(n.ended('run'), true);
  assert.match(n.next(10_000)!, /^\[Wrap up\] The search for "Night stairs" has brought 1 new card\./);
  n.ended('picture');
  n.began('again', 'n1', 'Night stairs');
  n.landed(card('Bell tower'));
  assert.match(n.next(20_000)!, /^\[Card landed\]/);
  n.ended('again');
  assert.match(n.next(30_000)!, /^\[All done\] The search for "Night stairs" is finished: 1 new card in all\./, "a part on another card is not this search's");
  n.began('third', 'n3', 'Kiln');
  n.part('slow picture', 'n3');
  n.ended('third');
  assert.match(n.next(40_000)!, /^\[Wrap up\] Nothing from the search for "Kiln" has landed yet\. Say so in a few words\.$/, 'nothing landed yet, and a picture is still being made');
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

test("1.8 s of quiet after the last word ends a turn the model's turn detection has not, and a shorter pause does not", async () => {
  const { v, model } = voice();
  const piece = (amp: number) => pcm(Array.from({ length: 1600 }, (_, i) => Math.round(amp * 32767 * Math.sin(i / 3) + (i % 7) - 3)));
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  for (let k = 0; k < 8; k++) v.heard({ t: 'audio', pcm: piece(0) });
  for (let k = 0; k < 10; k++) v.heard({ t: 'audio', pcm: piece(0.2) });
  for (let k = 0; k < 17; k++) v.heard({ t: 'audio', pcm: piece(0) });
  assert.equal(model.sent('input_audio_buffer.commit').length, 0, 'the quiet before the first word, and 1.7 s after it, end nothing');
  for (let k = 0; k < 6; k++) v.heard({ t: 'audio', pcm: piece(0.2) });
  for (let k = 0; k < 18; k++) v.heard({ t: 'audio', pcm: piece(0) });
  assert.deepEqual(model.last.sent.slice(-2).map((e) => e.type), ['input_audio_buffer.commit', 'response.create'], 'more than the name was said: answered at once');
  const appended = model.sent('input_audio_buffer.append').length;
  v.heard({ t: 'audio', pcm: piece(0.2) });
  assert.equal(model.sent('input_audio_buffer.append').length, appended, 'nothing more is sent once it is over');

  // A short turn the quiet rule ends may be only the name: it is answered once its words are written down, and not if they are.
  v.heard({ t: 'start', turn: 2, scene: SCENE });
  for (let k = 0; k < 8; k++) v.heard({ t: 'audio', pcm: piece(0) });
  for (let k = 0; k < 6; k++) v.heard({ t: 'audio', pcm: piece(0.2) });
  for (let k = 0; k < 18; k++) v.heard({ t: 'audio', pcm: piece(0) });
  assert.equal(model.last.sent.at(-1)!.type, 'input_audio_buffer.commit');
  const asked = model.sent('response.create').length;
  model.last.event({ type: 'input_audio_buffer.committed', item_id: 'item-2' });
  model.writes('item-2', 'Hey Momo.');
  await tick();
  await tick();
  assert.equal(model.sent('response.create').length, asked, 'only the name: nothing is asked');
  for (let k = 0; k < 4; k++) v.heard({ t: 'audio', pcm: piece(0.2) });
  assert.ok(model.sent('input_audio_buffer.append').length > appended + 24, 'and the turn is still heard');
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

test("her name alone starts nothing, and a line with a 0.8 s pause in it is one turn: its answer is asked for once, after all of it, once the user has been quiet 1.2 s", async () => {
  const { v, model, frames, clock, called } = voice();
  const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  const at = (ms: number) => (clock.now = 1000 + ms);
  const event = (type: string, item?: string) => model.last.event({ type, ...(item ? { item_id: item } : {}) });
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
  // "Hi Momo!", then a breath the turn detection takes for the end, 1.1 s after the last word.
  at(0);
  event('input_audio_buffer.speech_stopped', 'item-1');
  at(1100);
  event('input_audio_buffer.committed', 'item-1');
  model.writes('item-1', 'Hi Momo!');
  await wait(250);
  assert.equal(model.sent('response.create').length, 0, 'her name alone: no answer is asked for, so no reply and no tool');
  assert.deepEqual(frames.filter((f) => f.t === 'over'), [], 'and the turn is still heard');

  // The line, with a pause of 0.8 s in it that the turn detection also takes for the end.
  at(2000);
  event('input_audio_buffer.speech_started');
  v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
  at(3000);
  event('input_audio_buffer.speech_stopped', 'item-2');
  at(3600);
  event('input_audio_buffer.committed', 'item-2');
  model.writes('item-2', "I'm designing a mind palace in XR,");
  await wait(100);
  at(3800);
  event('input_audio_buffer.speech_started');
  await wait(700);
  assert.equal(model.sent('response.create').length, 0, 'a pause mid-line ends nothing');
  v.heard({ t: 'audio', pcm: pcm([1, 2, 3, 4]) });
  at(5000);
  event('input_audio_buffer.speech_stopped', 'item-3');
  at(5300);
  event('input_audio_buffer.committed', 'item-3');
  model.writes('item-3', 'and looking for ideas.');
  await wait(400);
  assert.equal(model.sent('response.create').length, 0, 'not before the user has been quiet 1.2 s');
  await wait(700);
  assert.deepEqual(model.sent('response.create').map((e) => e.response), [{ metadata: { purpose: 'reply' } }], 'asked for once, after the whole line');
  const heard = frames.filter((f) => f.t === 'heard' && f.final);
  assert.deepEqual(heard.at(-1), { t: 'heard', turn: 1, text: "I'm designing a mind palace in XR, and looking for ideas.", final: true });
  model.begins('r1', 'reply');
  model.calls('r1', 'c1', 'find_new', { subject: 'mind palace in XR', angle: '' });
  model.ends('r1');
  await tick();
  assert.deepEqual(frames.filter((f) => f.t === 'over'), [{ t: 'over', turn: 1 }], 'over once, as the answer to all of it begins');
  assert.deepEqual(called.map((c) => c.name), ['find_new'], 'one search, for the whole line');
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

test("a call that needs the user's words waits while they are written down, and goes on without them once writing fails or 1.5 s after the turn was over", async () => {
  const { v, model, clock, answers } = voice();
  const got: (string | undefined)[] = [];
  answers.find_new = async (said) => {
    got.push(await said());
    return { started: true };
  };
  const call = (n: number) => {
    model.begins(`r${n}`);
    model.calls(`r${n}`, `c${n}`, 'find_new', { subject: "Vermeer's use of light", angle: 'focusing on domestic interiors' });
  };
  v.heard({ t: 'start', turn: 1, scene: SCENE });
  model.commits('item-1');
  call(1);
  await tick();
  assert.deepEqual(got, [], 'not while the turn is still being written down');
  model.writes('item-1', "Hey Momo, show me some examples of Vermeer's use of light.");
  await tick();
  assert.deepEqual(got, ["Show me some examples of Vermeer's use of light."], 'the whole turn as written down, without the name');
  model.ends('r1');

  v.heard({ t: 'start', turn: 2, scene: SCENE });
  model.commits('item-2');
  model.last.event({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'item-2', error: { message: 'audio unclear' } });
  call(2);
  await tick();
  assert.deepEqual(got.slice(1), [undefined], 'a turn that could not be written down is not waited for');
  model.ends('r2');

  v.heard({ t: 'start', turn: 3, scene: SCENE });
  model.commits('item-3');
  clock.now += 1450;
  call(3);
  await tick();
  assert.equal(got.length, 2, 'waited for until 1.5 s after the turn was over');
  await new Promise((ok) => setTimeout(ok, 120));
  assert.deepEqual(got.slice(2), [undefined]);
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
  // What the user marked, shown as pictures: image tokens at the image rates.
  const seen = cost('gpt-realtime-2.1', { input_token_details: { text_tokens: 100, image_tokens: 340, cached_tokens_details: { image_tokens: 300 } } });
  assert.ok(seen !== null && Math.abs(seen - (100 * 4 + 40 * 5 + 300 * 0.5) / 1e6) < 1e-12);
  const heard = cost('gpt-4o-transcribe', { input_tokens: 48, output_tokens: 15, input_token_details: { text_tokens: 13, audio_tokens: 35 } });
  assert.ok(heard !== null && Math.abs(heard - (13 * 2.5 + 35 * 6 + 15 * 10) / 1e6) < 1e-12);
  assert.equal(cost('some-other-model', {}), null);
});

test("a headset's look at what the user marked reaches its own voice alone, and nothing of the pictures is written to the log", async () => {
  const lines: string[] = [];
  const model = new Scripted();
  const run = await startServer({
    port: 0, host: '127.0.0.1', clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret', dataDir: tempDir('mp-look-'),
    live: { open: model.open, options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' }, hearing: 'gpt-4o-transcribe' } },
    log: (line) => lines.push(line),
  });
  try {
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
    };
    const connect = async () => {
      const got: { t: string; connection?: string }[] = [];
      const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`);
      ws.on('message', (raw) => got.push(JSON.parse(String(raw))));
      await until(() => got.some((m) => m.t === 'hello'));
      const live = new WebSocket(`${run.url.replace('http', 'ws')}/live?token=secret&connection=${got.find((m) => m.t === 'hello')!.connection}`);
      await new Promise((open) => live.on('open', open));
      return { ws, live, got };
    };
    const headset = await connect();
    const other = await connect();
    headset.ws.send(JSON.stringify({ t: 'look', nodeId: 'n1', title: 'Night stairs', box: [0.2, 0.3, 0.4, 0.3], crop: jpeg('the part'), whole: jpeg('the whole') }));
    await new Promise((r) => setTimeout(r, 50));
    other.live.send(JSON.stringify({ t: 'start', turn: 1, scene: SCENE }));
    await until(() => model.sessions.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sights(model).length, 0, "another headset's voice is shown nothing of it");
    headset.live.send(JSON.stringify({ t: 'start', turn: 1, scene: SCENE }));
    await until(() => model.sessions.length === 2 && sights(model).length > 0);
    assert.deepEqual(sights(model).map((s) => s.images.length), [2], "its own voice is shown both, with the turn begun on the card");
    assert.ok(lines.some((l) => l === '[live] Momo is shown what is marked on Night stairs'));
    assert.ok(!lines.some((l) => l.includes('data:image') || l.includes(Buffer.from('jpeg of').toString('base64'))), 'no picture is written to the log');
    for (const c of [headset, other]) c.live.close(), c.ws.close();
  } finally {
    await run.close();
  }
});

test("Send on a card the user drew on shows the Scout the part ringed; another card's, or after the marks are gone, shows it nothing", async () => {
  const asked: { anchor: string; marked?: string }[] = [];
  const run = await startServer({
    port: 0, host: '127.0.0.1', clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), token: 'secret', dataDir: tempDir('mp-send-look-'),
    roles: { ...fakeRoles, scout: async (_ctx, input) => (asked.push({ anchor: input.anchor, ...(input.marked ? { marked: input.marked } : {}) }), []) },
  });
  try {
    await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
    await run.pipeline.idle();
    const tree = [...run.mind.trees.values()][0]!;
    const card = tree.rootId;
    const got: { t: string }[] = [];
    const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`);
    ws.on('message', (raw) => got.push(JSON.parse(String(raw))));
    for (let i = 0; i < 400 && !got.some((m) => m.t === 'hello'); i++) await new Promise((r) => setTimeout(r, 5));
    const ask = async (nodeId: string) => {
      const had = asked.length;
      ws.send(JSON.stringify({ t: 'ask', nodeId, need: 'Tell me more about this part: the part I drew on' }));
      for (let i = 0; i < 400 && asked.length === had; i++) await new Promise((r) => setTimeout(r, 5));
      return asked.at(-1);
    };
    ws.send(JSON.stringify({ t: 'look', nodeId: card, title: 'Sourdough', box: [0.1, 0.1, 0.5, 0.5], crop: jpeg('the crust'), whole: jpeg('the loaf') }));
    assert.deepEqual(await ask(card), { anchor: card, marked: jpeg('the crust') }, 'the part ringed goes with the Send');
    ws.send(JSON.stringify({ t: 'look', nodeId: 'another-card', title: 'Rye', box: [0.1, 0.1, 0.5, 0.5], crop: jpeg('rye'), whole: jpeg('rye loaf') }));
    assert.deepEqual(await ask(card), { anchor: card }, "another card's mark does not");
    ws.send(JSON.stringify({ t: 'look', nodeId: card, title: 'Sourdough', box: [0.1, 0.1, 0.5, 0.5], crop: jpeg('the crust'), whole: jpeg('the loaf') }));
    ws.send(JSON.stringify({ t: 'look', nodeId: card, title: 'Sourdough' }));
    assert.deepEqual(await ask(card), { anchor: card }, 'nor marks that are gone');
    ws.close();
  } finally {
    await run.close();
  }
});

test("the service refuses /live without a live voice; with one, what Momo starts is the named connection's own, and Momo walks through its cards", async () => {
  const dataDir = tempDir('mp-live-');
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

test("a spoken request reaches the Scout as the user said it, with Momo's reading beside it as a suggestion, or that reading alone when the words were not written down", async () => {
  const prompts: string[] = [];
  const note = { angle: 'light', format: 'note', title: 'Light from the left', body: 'Windows on the left.', why: 'the light', tags: ['light'], lines: [], pros: [], cons: [], subject: '', passage: '', by: '', images: [], source: '', lookups: [] };
  const brain = new FakeModel()
    .on('scout.ideate', (req) => {
      prompts.push(req.user);
      return { reading: 'Paintings.', directions: [note] };
    })
    .on('scout.looks', () => ({ looks: [] }));
  const model = new Scripted();
  const run = await startServer({
    port: 0, host: '127.0.0.1', dataDir: tempDir('mp-live-'), clientDir: join(import.meta.dirname, '../client'), model: brain, roles: { ...fakeRoles, scout: scoutRole }, token: 'secret',
    live: { open: model.open, options: { model: 'gpt-realtime-2.1', voice: 'marin', turn: { kind: 'semantic' }, hearing: 'gpt-4o-transcribe' } },
  });
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: A Maid Asleep' }]);
  await run.pipeline.idle();
  const tree = [...run.mind.trees.values()][0]!;
  const until = async (ok: () => boolean) => {
    while (!ok()) await new Promise((r) => setTimeout(r, 5));
  };
  const live = new WebSocket(`${run.url.replace('http', 'ws')}/live?token=secret`);
  await new Promise((ok) => live.on('open', ok));
  const started = () => (model.sessions.length > 0 ? model.sent('input_audio_buffer.clear').length : 0);
  const turn = async (n: number) => {
    const before = started();
    live.send(JSON.stringify({ t: 'start', turn: n, scene: { focus: tree.rootId, treeId: tree.id, selection: [] } }));
    await until(() => started() > before);
  };
  const finds = async (n: number, args: object) => {
    const before = prompts.length;
    model.begins(`r${n}`);
    model.says(`r${n}`, 'Ooh, let me find some.');
    model.calls(`r${n}`, `c${n}`, 'find_new', args);
    model.ends(`r${n}`);
    await until(() => prompts.length > before);
    await run.pipeline.idle();
    return prompts.at(-1)!;
  };
  try {
    prompts.length = 0;

    await turn(1);
    model.hears('item-1', "Hey Momo, show me some examples of Vermeer's use of light.");
    const spoken = await finds(1, { subject: "Vermeer's use of light", angle: 'focusing on domestic interiors and side lighting' });
    assert.match(spoken, /What the user just asked for: "Show me some examples of Vermeer's use of light\."/);
    assert.match(spoken, /The user asked for "Show me some examples of Vermeer's use of light\."\. Every direction must serve that request/);
    assert.match(spoken, /voice assistant the user spoke to read it, a suggestion and not the user's words: "Vermeer's use of light, focusing on domestic interiors and side lighting"\. .*Where the two differ, the user's words win\./);
    assert.deepEqual(spoken.match(/^user: .*$/gm), ["user: Show me some examples of Vermeer's use of light."], "the conversation holds the user's sentence once, and no line of Momo's as the user's");

    await turn(2);
    model.commits('item-2');
    model.last.event({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'item-2', error: { message: 'audio unclear' } });
    const unheard = await finds(2, { subject: 'old maps of Delft', angle: '' });
    assert.doesNotMatch(unheard, /What the user just asked for/);
    assert.doesNotMatch(unheard, /The user asked for "old maps of Delft"/, "Momo's words are never told as the user's");
    assert.match(unheard, /The user asked by voice and their words were not written down\. How the voice assistant they spoke to read the request, not the user's words: "old maps of Delft"\./);
    assert.match(unheard, /The voice assistant read the user's request as "old maps of Delft"\. Every direction must serve that request/);
  } finally {
    live.close();
    await run.close();
  }
});

// ---- the check of a wake (DECISIONS 70)

/** A check the test answers when it chooses. */
function checking() {
  let answer!: (ok: boolean) => void;
  let fail!: (err: Error) => void;
  const sounds: Uint8Array[] = [];
  const named: LiveDeps['named'] = (pcm) => {
    sounds.push(pcm);
    return new Promise<boolean>((ok, no) => {
      answer = ok;
      fail = no;
    });
  };
  return { named, sounds, answer: (ok: boolean) => answer(ok), fail: (why: string) => fail(new Error(why)) };
}
const WOKE = { t: 'name', pcm: pcm([5, 6, 7, 8]) } as const;

test('a service with no check takes every wake for the name', () => {
  const { v, frames } = voice();
  v.heard(WOKE);
  assert.deepEqual(frames.at(-1), { t: 'name', ok: true });
});

test('a wake that was the name costs Momo no time: the check has answered before it has anything to say', async () => {
  const check = checking();
  const { v, model, frames, of, turn, called, spoken } = voice({ named: check.named });
  v.heard(WOKE);
  assert.deepEqual([...check.sounds[0]!], [5, 0, 6, 0, 7, 0, 8, 0], 'the sound of the wake is what is checked');
  assert.equal(of('name').length, 0, 'no answer before the check');
  check.answer(true);
  await tick();
  assert.deepEqual(frames.at(-1), { t: 'name', ok: true });

  turn(1, 'Hey Momo, what is this painting?');
  model.begins('r1');
  model.says('r1', 'It is a Vermeer.');
  model.calls('r1', 'c1', 'web_answer', { question: 'x' });
  model.ends('r1');
  assert.equal(of('audio').length, 2, 'Momo is heard as its voice comes');
  assert.equal(called.length, 1);
  assert.deepEqual(spoken.map((s) => s.who), ['user', 'agent']);
});

test('while a wake is checked Momo does nothing the user could notice, and then does it all in order', async () => {
  const check = checking();
  const { v, model, frames, of, turn, called, spoken } = voice({ named: check.named });
  v.heard(WOKE);
  turn(1, 'Hey Momo, what is this painting?');
  model.begins('r1');
  model.says('r1', 'It is a Vermeer.');
  model.calls('r1', 'c1', 'web_answer', { question: 'x' });
  model.ends('r1');
  assert.deepEqual(frames, [{ t: 'ready', rate: 24000 }], 'nothing reaches the device: no words, no voice, not even that the turn is over');
  assert.equal(called.length, 0, 'no call runs');
  assert.equal(spoken.length, 0, 'and nothing is kept of what was said');
  assert.equal(model.sent('input_audio_buffer.append').length, 1, 'the model hears the turn meanwhile, so no time is lost');

  check.answer(true);
  await tick();
  assert.deepEqual(frames.slice(1).map((f) => f.t), ['name', 'heard', 'heard', 'over', 'text', 'audio', 'audio', 'done']);
  assert.equal(called.length, 1);
  assert.deepEqual(spoken.map((s) => s.who), ['user', 'agent']);
  assert.equal(of('name')[0]!.ok, true);
});

test('a wake that was not the name is undone: the turn is dropped, Momo is stopped and says nothing, and no call runs', async () => {
  const check = checking();
  const { v, model, frames, turn, called, spoken } = voice({ named: check.named });
  v.heard(WOKE);
  turn(1, 'Hey mama, are you coming tonight?');
  model.begins('r1');
  model.last.event({ type: 'response.output_item.added', response_id: 'r1', item: { id: 'r1-message', type: 'message' } });
  model.says('r1', 'I am not sure who is coming.');
  model.calls('r1', 'c1', 'web_answer', { question: 'x' });

  check.answer(false);
  await tick();
  assert.deepEqual(frames.slice(1), [{ t: 'name', ok: false }], 'the device hears only that it was not the name');
  assert.deepEqual(model.sent('response.cancel').map((e) => e.response_id), ['r1']);
  assert.deepEqual(model.sent('conversation.item.delete').map((e) => e.item_id), ['item-1', 'r1-message'], 'what the wake put into the conversation is taken out');
  assert.equal(model.sent('input_audio_buffer.clear').length, 2, 'at the start and again as it is dropped');
  model.ends('r1', 'cancelled');
  await tick();
  assert.equal(called.length, 0);
  assert.equal(spoken.length, 0);
  assert.equal(frames.length, 2, 'and nothing follows');

  // What comes after is heard as ever.
  v.heard({ t: 'audio', pcm: pcm([1, 2]) });
  assert.equal(model.sent('input_audio_buffer.append').length, 1, 'the dropped turn takes no more sound');
  v.heard(WOKE);
  check.answer(true);
  await tick();
  turn(2, 'Hey Momo, undo that.');
  model.begins('r2');
  model.says('r2', 'Undone.');
  model.ends('r2');
  assert.deepEqual(frames.slice(2).map((f) => f.t), ['name', 'heard', 'heard', 'over', 'text', 'audio', 'audio', 'done']);
  assert.deepEqual(spoken, [{ who: 'user', text: 'Undo that.' }, { who: 'agent', text: 'Undone.' }]);
});

test('a wake that was not the name, with nothing said after it, only tells the device', async () => {
  const check = checking();
  const { v, model, frames } = voice({ named: check.named });
  v.heard(WOKE);
  check.answer(false);
  await tick();
  assert.deepEqual(frames.slice(1), [{ t: 'name', ok: false }]);
  assert.equal(model.sessions.length, 0, 'no session was opened for it');
});

test('a check that is slow or fails does not keep Momo waiting: the wake is taken for the name', async () => {
  const slow = checking();
  const a = voice({ named: slow.named, nameWaitMs: 20 });
  a.v.heard(WOKE);
  a.turn(1, 'Hey Momo, more.');
  a.model.begins('r1');
  a.model.says('r1', 'Bringing more.');
  assert.equal(a.frames.length, 1);
  await new Promise((ok) => setTimeout(ok, 40));
  assert.deepEqual(a.frames.slice(1).map((f) => f.t), ['name', 'heard', 'heard', 'over', 'text', 'audio', 'audio']);
  assert.equal(a.of('name')[0]!.ok, true);
  slow.answer(false);
  await tick();
  assert.equal(a.of('name').length, 1, 'its late answer changes nothing');

  const broken = checking();
  const b = voice({ named: broken.named });
  b.v.heard(WOKE);
  broken.fail('OpenAI transcription answered 500');
  await tick();
  assert.deepEqual(b.frames.at(-1), { t: 'name', ok: true });
});
