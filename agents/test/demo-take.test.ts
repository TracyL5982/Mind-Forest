import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { Lines, recordingName, type LinesFile } from '../src/demo/lines.ts';
import { loadScript, type ScriptPhase } from '../src/demo/script.ts';
import { compare, record as recordLine, sentences, wavOf } from '../src/demo/momo-voice.ts';
import { MODES, momentAt, planLines, REAL, schedule, takeOf, type Line } from '../src/demo/take.ts';
import { FakeModel } from '../src/fake/model.ts';
import { demoData } from './demo-data.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running } from '../src/node/server.ts';

const demoDir = join(import.meta.dirname, '../demo');
const script = loadScript(join(demoDir, 'script.json'));
const data = demoData();
const temp = data.temp;
const round = (id: string): ScriptPhase => script.phases.find((phase) => phase.id === id)!;
const titlesOf = (phase: ScriptPhase, ids: string[]) => ids.map((id) => phase.cards.find((card) => card.id === id)!.title).sort();

/** A round's lines as the generator plans them, with stand-in words: each line says which cards it is of and takes 4 s. */
async function plan(phase: ScriptPhase, ms = 4000): Promise<Line[]> {
  return planLines(phase, 'the card', async ({ kind, cards }) => ({ text: `${kind}: ${cards.map((card) => card.title).join(', ') || 'no card'}.`, ms }));
}

/** The stand-in voice: 24 kHz PCM, 50 ms for each character, so a line's length follows from its words. */
const speak = async (text: string) => new Uint8Array(text.length * 48 * 50);
/**
 * It records as the service's recorder does. A line with "tongue twister" in it is one she does not say as written: it comes
 * back not ready, with her closest take of it and that take's wording.
 */
const record = async (text: string) =>
  /tongue twister/.test(text)
    ? { unsaid: true as const, closest: 'Her closest wording.', pcm: await speak('Her closest wording.'), own: true, takes: 9 }
    : { pcm: await speak(text), takes: 1 };

// ---- the timeline

test('a round\'s schedule lands every card once, the user\'s own first, then each source, then what is made, under the labels of that work', () => {
  for (const phase of script.phases) {
    const sched = schedule(phase, 'the card');
    assert.deepEqual(sched.drops.flatMap((drop) => drop.cards).sort(), phase.cards.map((card) => card.id).sort(), `${phase.id}: every card lands once`);
    assert.ok(sched.drops.every((drop, n) => n === 0 || drop.at >= sched.drops[n - 1]!.at), `${phase.id}: deliveries are in order`);
    assert.ok(sched.steps.every((step) => step.end > step.at && step.end <= sched.end), `${phase.id}: every label ends by the run's end`);
    // A found or a made card lands as its label ends. What the Scout writes itself has no label of its own: it lands while "Thinking of directions" is up.
    for (const drop of sched.drops) {
      const written = drop.cards.every((id) => phase.cards.find((card) => card.id === id)!.origin === 'generated' && !phase.cards.find((card) => card.id === id)!.image);
      assert.ok(written ? sched.steps.some((step) => /^Thinking of directions/.test(step.label) && step.at < drop.at && drop.at <= step.end) : sched.steps.some((step) => step.end === drop.at), `${phase.id}: a label ends as its cards land`);
    }
  }
  const n3 = round('n3');
  const sched = schedule(n3);
  const own = n3.cards.filter((card) => card.origin === 'ocean').map((card) => card.id);
  assert.deepEqual(sched.drops[0], { at: REAL.begins + REAL.plan + REAL.own, cards: own }, 'what the user has lands first');
  assert.deepEqual(sched.steps.slice(0, 2).map((step) => step.label), ['Choosing where to look first', 'Checking what you already have']);
  const made = n3.cards.filter((card) => card.origin === 'generated' && card.image);
  assert.ok(made.length > 0 && made.every((card) => sched.drops.find((drop) => drop.cards.includes(card.id))!.at >= REAL.begins + REAL.plan + REAL.picture), 'a made picture takes as long as one does');
  assert.deepEqual(schedule(round('bs')), { steps: [], drops: [], end: 0, settled: 0 }, 'a round that brings nothing has no run');
});

test('Momo speaks at the moments the live voice does: her answer, the first card, later cards gathered, and a wrap-up', async () => {
  const n3 = round('n3');
  const lines = await plan(n3);
  assert.deepEqual(lines.map((line) => line.kind), ['answer', 'first', ...lines.slice(2, -1).map(() => 'more'), 'wrap']);
  assert.ok(lines.length >= 4, 'a round whose cards come over half a minute has remarks between the first card and the wrap-up');
  assert.equal(lines[1]!.cards.length, 1, 'the first remark is of the first card alone');
  assert.equal(lines[1]!.cards[0], schedule(n3).drops[0]!.cards[0]);
  assert.deepEqual(lines.flatMap((line) => line.cards).sort(), n3.cards.map((card) => card.id).sort(), 'between them the lines tell of every card once');
  assert.deepEqual(lines.map((line) => line.id), ['answer', 'first', ...lines.slice(2, -1).map((_, n) => `more-${n + 1}`), 'wrap']);

  assert.deepEqual((await plan(round('f7'))).map((line) => line.kind).slice(0, 1), ['first'], 'a round asked for by a pinch has no answer: nothing was said');
  assert.deepEqual(await plan(round('bs')), [], 'and a round with no words and no cards has no lines');
  // With long lines she is still talking when the rest land, so one wrap-up tells of them all.
  assert.deepEqual((await plan(round('f7'), 60_000)).map((line) => line.kind), ['first', 'wrap']);
});

test('on the timeline a remark starts as its cards land, never over the line before it, and the wrap-up after the run is over', async () => {
  const n3 = round('n3');
  const lines = await plan(n3);
  const sched = schedule(n3);
  const take = takeOf(n3, lines, () => 4000);
  assert.equal(take.lines[0]!.at, 0);
  for (const [n, line] of take.lines.entries()) {
    if (n > 0) assert.ok(line.at >= take.lines[n - 1]!.at + take.lines[n - 1]!.ms + REAL.breath, `${line.id} waits for the line before it`);
    const landed = Math.max(0, ...line.cards.map((id) => sched.drops.find((drop) => drop.cards.includes(id))!.at));
    assert.ok(line.at >= landed, `${line.id} is not said before its cards land`);
  }
  assert.equal(take.lines[1]!.at, 4000 + REAL.breath, 'the first card is told once her answer is over, when it landed while she spoke');
  assert.equal(takeOf(n3, lines, () => 2000).lines[1]!.at, sched.drops[0]!.at, 'and the moment it lands, when she was free');
  assert.ok(take.lines.at(-1)!.at >= sched.end);
  assert.equal(take.ms, take.lines.at(-1)!.at + 4000 + REAL.tail);

  // Longer lines push later ones back and never the cards.
  const slow = takeOf(n3, lines, () => 15_000);
  assert.deepEqual(slow.drops, take.drops);
  assert.ok(slow.lines[2]!.at > take.lines[2]!.at && slow.ms > take.ms);
  // A line with no words is not said and takes no time.
  const silent = takeOf(n3, lines.map((line) => (line.id === 'first' ? { ...line, text: '' } : line)), (text) => (text ? 4000 : 0));
  assert.equal(silent.lines[1]!.ms, 0);

  const mid = (sched.drops[0]!.at + sched.drops[1]!.at) / 2;
  const moment = momentAt(take, mid);
  assert.deepEqual(moment.cards, sched.drops[0]!.cards, 'at a moment, the cards that have landed by then');
  assert.ok(moment.steps.length > 0 && moment.steps.every((step) => step.at <= mid && mid < step.end));
  assert.deepEqual(momentAt(take, 0).cards, []);
  assert.equal(momentAt(take, 1000).line?.line.id, 'answer');
  assert.equal(momentAt(take, 1000).line?.offset, 1000);
  assert.deepEqual(momentAt(take, take.ms).cards.sort(), n3.cards.map((card) => card.id).sort());
});

// ---- the written lines

const silentOf = (demoDir: string, dataDir: string) => new Lines({ demoDir, dataDir, voice: 'test-voice', log: () => {} });

async function linesFolder(rounds: string[], said?: Record<string, string>): Promise<string> {
  const dir = temp('mp-demo-lines-');
  const file: LinesFile = { version: 1, voice: 'test-voice', rounds: {}, real: {}, ...(said ? { said } : {}) };
  for (const id of rounds) file.real[id] = await planLines(round(id), 'the card', async ({ kind, cards }) => ({ text: `${kind} at real pace: ${cards.map((card) => card.title).join(', ') || 'no card'}.`, ms: 4000 }), 'real');
  for (const id of rounds) file.rounds[id] = await plan(round(id));
  writeFileSync(join(dir, 'lines.json'), JSON.stringify(file));
  return dir;
}

test('the user\'s words over a line win, are kept across a restart, and go back to Momo\'s own; each wording is recorded once', async () => {
  const dir = await linesFolder(['n3']);
  const dataDir = temp('mp-demo-data-');
  const spoken: string[] = [];
  const open = () => new Lines({ demoDir: dir, dataDir, voice: 'test-voice', record: async (text) => (spoken.push(text), record(text)), log: () => {} });
  const lines = open();
  const written = lines.of('n3')[0]!.text;
  assert.deepEqual([lines.of('n3')[0]!.edited, lines.edited, lines.of('r1')], [false, 0, []]);
  assert.equal(lines.recorded(written), false);
  assert.equal(lines.ms(written), Math.max(1200, written.length * 66), 'with no recording, a line is as long as its words read');

  assert.equal((await lines.audio(written))!.length, written.length * 2400);
  await lines.audio(written);
  assert.deepEqual(spoken, [written], 'the same words are recorded once');
  assert.equal(lines.ms(written), written.length * 50, 'and a recorded line is as long as its recording');

  assert.equal(lines.edit('n3', 'answer', '  Let me pull   some threads on that. '), true);
  assert.deepEqual([lines.of('n3')[0]!.text, lines.of('n3')[0]!.written, lines.of('n3')[0]!.edited], ['Let me pull some threads on that.', written, true]);
  assert.equal(lines.recorded('Let me pull some threads on that.'), false, 'changed words are another recording');
  await lines.audio('Let me pull some threads on that.');
  assert.deepEqual(spoken, [written, 'Let me pull some threads on that.']);
  assert.equal(lines.edit('n3', 'no-such-line', 'x'), false);
  // A line she does not say as written is not ready: her closest take of it plays for it, and its wording is offered.
  assert.deepEqual([lines.voice(written), lines.voice('Let me pull some threads on that.'), lines.voice('Never recorded.')], ['realtime', 'realtime', null]);
  lines.edit('n3', 'first', 'A tongue twister of a line.');
  const standIn = await lines.audio('A tongue twister of a line.', 'first');
  assert.equal(standIn!.length, 'Her closest wording.'.length * 2400, 'what plays is her closest take, never silence and never another voice');
  assert.deepEqual([lines.recorded('A tongue twister of a line.'), lines.closest('A tongue twister of a line.'), lines.closest(written)], [false, 'Her closest wording.', null]);
  assert.equal(lines.ms('A tongue twister of a line.'), 'Her closest wording.'.length * 50, 'and the line is as long as that take');
  assert.deepEqual([lines.recorded('Her closest wording.'), lines.voice('Her closest wording.')], [true, 'realtime'], 'taking her wording needs no new take');
  await lines.audio('A tongue twister of a line.', 'first');
  assert.equal(spoken.filter((text) => /tongue twister/.test(text)).length, 1, 'it is not tried again by itself');
  assert.equal(open().closest('A tongue twister of a line.'), 'Her closest wording.', 'a restart keeps the line not ready, with her take');
  lines.again('A tongue twister of a line.');
  await lines.audio('A tongue twister of a line.', 'first');
  assert.equal(spoken.filter((text) => /tongue twister/.test(text)).length, 2, 'but is when asked');
  // A recording that is not noted as the realtime voice's, as one left from before, is no recording: it is never played.
  writeFileSync(join(dataDir, 'demo-voice', recordingName('test-voice', 'Left from before.')), new Uint8Array(48_000));
  assert.deepEqual([lines.recorded('Left from before.'), await silentOf(dir, dataDir).audio('Left from before.')], [false, null]);

  const again = open();
  assert.equal(again.of('n3')[0]!.text, 'Let me pull some threads on that.', 'the data folder keeps the user\'s words');
  assert.equal(again.edited, 2);
  const made = spoken.length;
  await again.audio('Let me pull some threads on that.');
  assert.equal(spoken.length, made, 'and their recording');
  assert.equal(again.voice('Let me pull some threads on that.'), 'realtime');
  again.edit('n3', 'first', null);
  again.edit('n3', 'answer', null);
  assert.deepEqual([again.of('n3')[0]!.text, again.edited], [written, 0]);
  again.edit('n3', 'answer', written);
  assert.equal(again.edited, 0, 'Momo\'s own words written back are no edit');

  const silent = new Lines({ demoDir: dir, dataDir: temp('mp-demo-data-'), voice: 'test-voice', log: () => {} });
  assert.equal(await silent.audio(written), null, 'with no voice a line has no sound');
});

// ---- a take on the stage

interface Seen {
  t: string;
  id?: string;
  text?: string;
  pcm?: string;
  activity?: { role: string; label: string; state: string };
  set?: { origin: { role?: string }; patches: { entity: string; id: string; before: unknown; after: unknown }[] };
  connection?: string;
}

interface Stage {
  run: Running;
  /** What the headset's own connection was sent, and what its voice socket was. */
  seen: Seen[];
  voice: Seen[];
  spoken: string[];
  close: () => Promise<void>;
}

/** The demo with stand-in roles, a headset joined with its voice open, and takes that run `rate` times as fast as a real round. */
async function stage(rate: number, rounds = ['n3'], said?: Record<string, string>): Promise<Stage> {
  const spoken: string[] = [];
  const run = await startServer({
    port: 0, host: '127.0.0.1', dataDir: data.fresh(), clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret',
    live: { open: () => ({ send: () => {}, close: () => {} }), options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' as const }, hearing: 'gpt-4o-transcribe' } },
    demo: {
      script, mediaDir: join(demoDir, 'media'), linesDir: await linesFolder(rounds, said), voice: 'test-voice', record: async (text) => (spoken.push(text), record(text)),
      pace: { stand: 300, open: 300, land: 300, breath: 0, step: 0, rate, rejoin: 500 },
    },
  });
  const seen: Seen[] = [];
  const voice: Seen[] = [];
  const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`);
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Seen;
    seen.push(m);
    // As the app does, the headset says a card is open when it is taken to it.
    if ((m as { t: string; nodeId?: string }).t === 'navigate') ws.send(JSON.stringify({ t: 'questions', nodeId: (m as { nodeId?: string }).nodeId }));
  });
  await new Promise((open) => ws.on('open', open));
  ws.send(JSON.stringify({ t: 'client', media: { embeds: false, files: ['mp4'] } }));
  while (run.demo!.status().devices === 0 || !seen.some((m) => m.t === 'hello')) await new Promise((r) => setTimeout(r, 5));
  const live = new WebSocket(`${run.url.replace('http', 'ws')}/live?token=secret&connection=${seen.find((m) => m.t === 'hello')!.connection}`);
  live.on('message', (raw) => voice.push(JSON.parse(String(raw)) as Seen));
  await new Promise((open) => live.on('open', open));
  return { run, seen, voice, spoken, close: async () => (ws.close(), live.close(), run.close()) };
}

const until = async (ok: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const under = (run: Running, title: string) => {
  const head = [...run.mind.nodes.values()].find((node) => run.mind.item(node.itemId).title === title)!;
  return run.mind.children(head.id).map((node) => run.mind.item(node.itemId).title).sort();
};
/** What Momo said, line by line: a line's words come as its sound does, so its last words sent are the line. */
const saidOf = (voice: Seen[]) => {
  const lines = new Map<string, string>();
  for (const m of voice) if (m.t === 'text') lines.set(m.id!, m.text!);
  return [...lines.values()];
};
const bytesOfId = (voice: Seen[], id: string) => voice.filter((m) => m.t === 'audio' && m.id === id).reduce((n, m) => n + Buffer.from(m.pcm!, 'base64').length, 0);
const bytesOf = (voice: Seen[], id: string) => voice.filter((m) => m.t === 'audio' && m.id?.endsWith(`-${id}`)).reduce((n, m) => n + Buffer.from(m.pcm!, 'base64').length, 0);

test('Play runs a round\'s take on the headset: its labels, its cards as picks in their deliveries, and each of Momo\'s lines said exactly', { timeout: 30000 }, async () => {
  const s = await stage(300);
  try {
    const { run } = s;
    await run.demo!.goto('n3');
    const take = run.demo!.shown('n3');
    assert.ok(take.lines.every((line) => !line.recorded), 'nothing is recorded before the first play');
    const from = s.seen.length;
    void run.demo!.playTake('n3');
    await until(() => run.demo!.status().take?.playing === true);
    assert.equal(run.demo!.status().rounds.find((r) => r.id === 'n3')!.state, 'playing');
    await until(() => run.demo!.status().take?.playing === false);
    await run.pipeline.idle();

    const status = run.demo!.status();
    const played = run.demo!.shown('n3');
    assert.deepEqual(status.take, { round: 'n3', ms: played.ms, at: played.ms, playing: false }, 'over, the bar rests at the end');
    assert.equal(status.rounds.find((r) => r.id === 'n3')!.state, 'played');
    assert.deepEqual(under(run, 'Neurones poster'), round('n3').cards.map((card) => card.title).sort());
    const head = [...run.mind.nodes.values()].find((node) => run.mind.item(node.itemId).title === 'Neurones poster')!;
    assert.ok(run.mind.children(head.id).every((node) => node.status === 'pick'), 'the cards land as suggestions, as a real round\'s do');

    const after = s.seen.slice(from);
    const deliveries = after.filter((m) => m.t === 'change' && m.set!.origin.role === 'scout').map((m) => m.set!.patches.filter((p) => p.entity === 'node' && p.before === null).length).filter((n) => n > 0);
    assert.deepEqual(deliveries, take.drops.map((drop) => drop.cards.length), 'each delivery of the schedule lands as one of the run\'s');
    const labels = after.filter((m) => m.t === 'activity' && m.activity!.role === 'scout' && m.activity!.state === 'start').map((m) => m.activity!.label);
    for (const step of take.steps) assert.ok(labels.includes(step.label), `the label "${step.label}" was shown`);
    assert.ok(labels.some((label) => /^(Looking into|Finding more for)/.test(label)), 'under the run\'s own label');

    const said = saidOf(s.voice);
    // A line's words go once, whole, with its recording's length, so the headset shows them as it hears them: the sound itself
    // goes only a quarter of a second ahead, which would otherwise read as the line nearly over from its first word.
    for (const id of new Set(s.voice.filter((m) => m.t === 'audio').map((m) => m.id!))) {
      const texts = s.voice.filter((m) => m.id === id && m.t === 'text');
      assert.equal(texts.length, 1, 'a line\'s words are sent once');
      assert.equal((texts[0] as { ms?: number }).ms, Math.round(bytesOfId(s.voice, id) / 48), 'with the length of its sound');
      assert.equal((texts[0] as { from?: number }).from, 0);
    }
    // The last line's sound may still be on its way as the take ends.
    await until(() => s.voice.filter((m) => m.t === 'done').length === take.lines.length);
    for (const line of take.lines) assert.equal(bytesOf(s.voice, line.id), line.text.length * 2400, `all of the recording of ${line.id} was sent`);
    assert.equal(s.voice.filter((m) => m.t === 'done').length, take.lines.length);
    assert.deepEqual([...s.spoken].sort(), take.lines.map((line) => line.text).sort(), 'each line was recorded once, before the take began');
    assert.ok(played.lines.every((line) => line.recorded && line.voice === 'realtime' && line.ms === line.text.length * 50), 'and from then on is as long as its recording, and the page is told which voice it is in');
  } finally {
    await s.close();
  }
});

test('moving the bar makes the tree stand as it did at that moment, forwards and backwards, and a round is not played out of its place', { timeout: 30000 }, async () => {
  const s = await stage(300);
  try {
    const { run } = s;
    await run.demo!.goto('n3');
    const n3 = round('n3');
    const take = run.demo!.shown('n3');
    const [first, second] = take.drops;
    const between = (first!.at + second!.at) / 2;

    await run.demo!.seek('n3', between);
    assert.deepEqual(under(run, 'Neurones poster'), titlesOf(n3, first!.cards), 'the cards that had landed by then stand');
    assert.deepEqual(run.demo!.status().take, { round: 'n3', ms: take.ms, at: Math.round(between), playing: false });
    assert.equal(run.demo!.status().rounds.find((r) => r.id === 'n3')!.state, 'waiting');
    const held = () => s.seen.filter((m) => m.t === 'activity' && m.activity!.state === 'start').map((m) => m.activity!.label);
    assert.ok(momentAt(take, between).steps.length > 0);
    await until(() => momentAt(take, between).steps.every((step) => held().includes(step.label)));

    await run.demo!.seek('n3', take.ms);
    assert.deepEqual(under(run, 'Neurones poster'), n3.cards.map((card) => card.title).sort());
    assert.equal(run.demo!.status().rounds.find((r) => r.id === 'n3')!.state, 'played');
    assert.equal(run.demo!.status().armed, script.phases.indexOf(n3) + 1);

    const from = s.seen.length;
    await run.demo!.seek('n3', second!.at);
    assert.deepEqual(under(run, 'Neurones poster'), titlesOf(n3, [...first!.cards, ...second!.cards]), 'going back takes the later cards away');
    await until(() => s.seen.slice(from).some((m) => m.t === 'change'));
    const removed = s.seen.slice(from).filter((m) => m.t === 'change').flatMap((m) => m.set!.patches.filter((p) => p.entity === 'node' && p.after === null));
    assert.equal(removed.length, n3.cards.length - first!.cards.length - second!.cards.length, 'and the headset is told of each card taken away');

    await run.demo!.seek('n3', 0);
    assert.deepEqual(under(run, 'Neurones poster'), []);
    assert.equal(run.demo!.status().armed, script.phases.indexOf(n3));

    // Moves asked for faster than they are done: only the newest of those waiting is done.
    void run.demo!.seek('n3', first!.at);
    void run.demo!.seek('n3', second!.at);
    await run.demo!.seek('n3', between);
    assert.deepEqual(under(run, 'Neurones poster'), titlesOf(n3, first!.cards));

    await assert.rejects(run.demo!.playTake('f2'), /not set up for .*Go to this round first/, 'a later round is not played over a tree that is not ready for it');
    assert.match(run.demo!.status().problem!, /Go to this round first/);
  } finally {
    await s.close();
  }
});

test('when the last round has played to its end Momo asks about Muse Code, once in each set-up, and again from the page', { timeout: 30000 }, async () => {
  const question = 'Ready to take this to Muse Code?';
  const last = script.phases.at(-1)!.id;
  const s = await stage(300, [last], { museCode: question });
  const asked = () => saidOf(s.voice).filter((text) => text === question).length;
  try {
    const { run } = s;
    await run.demo!.goto(last);
    assert.deepEqual(run.demo!.status().ending, { asked: false, armed: false }, 'set up, the round waits and nothing is asked');
    void run.demo!.playTake(last);
    await until(() => run.demo!.status().ending?.armed === true, 20000);
    assert.equal(asked(), 1, 'she asks it as the take ends, with its caption');
    // Played again in the same set-up, it is not asked again.
    await run.demo!.seek(last, 0);
    void run.demo!.playTake(last);
    await until(() => run.demo!.status().take?.playing === true);
    await until(() => run.demo!.status().take?.playing === false, 20000);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(asked(), 1);
    // A new set-up asks it again once its last round is played, and the page asks it by hand.
    await run.demo!.goto(last);
    assert.deepEqual(run.demo!.status().ending, { asked: false, armed: false });
    await run.demo!.askMuseCode();
    assert.deepEqual(run.demo!.status().ending, { asked: true, armed: true });
    assert.equal(asked(), 2);
  } finally {
    await s.close();
  }
});

test('a take pauses where it is and goes on from there: no card lands while paused, and Momo takes her line up where she stopped', { timeout: 30000 }, async () => {
  const s = await stage(40);
  try {
    const { run } = s;
    await run.demo!.goto('n3');
    const n3 = round('n3');
    void run.demo!.playTake('n3');
    await until(() => under(run, 'Neurones poster').length > 0);
    await run.demo!.pause();
    const paused = run.demo!.status().take!;
    assert.equal(paused.playing, false);
    const take = run.demo!.shown('n3');
    assert.ok(paused.at > 0 && paused.at < take.ms);
    assert.deepEqual(under(run, 'Neurones poster'), titlesOf(n3, momentAt(take, paused.at).cards), 'the tree is as the take had it at that moment');
    // What was on its way to the headset as the take stopped arrives first.
    await new Promise((r) => setTimeout(r, 300));
    const heard = s.voice.length;
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(under(run, 'Neurones poster'), titlesOf(n3, momentAt(take, paused.at).cards), 'paused, nothing more lands');
    assert.equal(s.voice.slice(heard).filter((m) => m.t === 'audio').length, 0, 'and Momo is silent');
    assert.equal(run.demo!.status().take!.at, paused.at);

    const line = momentAt(take, paused.at).line;
    const before = line ? bytesOf(s.voice, line.line.id) : 0;
    void run.demo!.playTake();
    await until(() => run.demo!.status().take?.playing === false && run.demo!.status().take?.at === take.ms, 15000);
    assert.deepEqual(under(run, 'Neurones poster'), n3.cards.map((card) => card.title).sort(), 'played on, the rest of the round arrives');
    if (line) {
      const whole = line.line.text.length * 2400;
      const resumed = bytesOf(s.voice, line.line.id) - before;
      assert.equal(resumed, whole - Math.floor((line.offset * 48) / 2) * 2, 'the line she was in went on from the very point the take was paused at, not from its start');
    }
    const starts = [...new Set(s.voice.filter((m) => m.t === 'text' && m.id?.endsWith('-answer')).map((m) => m.id))];
    assert.equal(starts.length, 1, 'her answer, long over, is not said again');
  } finally {
    await s.close();
  }
});

test('the user\'s words over a line are what Momo says; her live voice is kept from the headset; a take starts even when she starts no search', { timeout: 30000 }, async () => {
  const s = await stage(300);
  try {
    const { run } = s;
    const token = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };
    const post = async (path: string, body: object) => (await fetch(`${run.url}${path}`, { method: 'POST', headers: token, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>;
    await run.demo!.goto('n3');
    await post('/api/demo/line', { round: 'n3', line: 'first', text: 'Look at this one first.' });
    const take = (await (await fetch(`${run.url}/api/demo/take?round=n3`, { headers: token })).json()) as { lines: { id: string; text: string; edited: boolean; written: string }[]; ms: number };
    const first = take.lines.find((line) => line.id === 'first')!;
    assert.deepEqual([first.text, first.edited, first.written.startsWith('first: ')], ['Look at this one first.', true, true]);
    assert.equal(run.demo!.status().lines.edited, 1);

    // With the round's card open, Momo is told the next words ask for it: from then her own voice is kept from the headset.
    const poster = [...run.mind.nodes.values()].find((node) => run.mind.item(node.itemId).title === 'Neurones poster')!;
    assert.equal(run.demo!.mutes(), false);
    assert.match(run.demo!.takeNote(poster.id), /new layer/);
    assert.equal(run.demo!.mutes(), true);
    assert.match(run.demo!.shown('n3').lines[0]!.text, /^answer:/);
    // She answers and starts nothing: the take starts for her.
    run.demo!.replied();
    await until(() => run.demo!.status().take?.round === 'n3' && run.demo!.status().take?.playing === false && run.demo!.status().take!.at > 0, 10000);
    assert.ok(s.voice.some((m) => m.t === 'text' && m.text === 'Look at this one first.'), 'the user\'s words are said');
    assert.ok(s.spoken.includes('Look at this one first.') && !s.spoken.some((text) => text.startsWith('first: ')), 'and only they were recorded for that line');
    assert.equal(run.demo!.mutes(), false, 'the round played, Momo is herself again');

    // A line she does not say as written is not ready: the page is told so with her closest wording, and the take plays her closest take of it.
    await run.demo!.goto('n3');
    await post('/api/demo/line', { round: 'n3', line: 'wrap', text: 'A tongue twister of a wrap-up.' });
    await until(() => run.demo!.shown('n3').lines.at(-1)!.closest !== null);
    const unready = run.demo!.shown('n3').lines.at(-1)!;
    assert.deepEqual([unready.closest, unready.recorded, unready.voice, unready.ms], ['Her closest wording.', false, null, 'Her closest wording.'.length * 50]);
    const heardBefore = s.voice.length;
    void run.demo!.playTake('n3');
    await until(() => run.demo!.status().take?.playing === true);
    await until(() => run.demo!.status().take?.playing === false, 10000);
    // The last line's sound may still be on its way as the take ends.
    await until(() => s.voice.slice(heardBefore).some((m) => m.t === 'done' && m.id?.endsWith('-wrap')));
    const lastSaid = s.voice.slice(heardBefore).filter((m) => m.t === 'text').at(-1)!;
    assert.equal(lastSaid.text, 'Her closest wording.', 'the caption is what is heard');
    assert.equal(bytesOf(s.voice.slice(heardBefore), 'wrap'), 'Her closest wording.'.length * 2400, 'and what is heard is her closest take, whole');
    // One click takes her wording: it is the line's text, its recording is there, and the line is ready.
    await post('/api/demo/line', { round: 'n3', line: 'wrap', text: 'Her closest wording.' });
    const taken = run.demo!.shown('n3').lines.at(-1)!;
    assert.deepEqual([taken.text, taken.recorded, taken.closest], ['Her closest wording.', true, null]);
    await post('/api/demo/line', { round: 'n3', line: 'wrap', text: null });

    // Save to script: the lines as they are said now, the user's words among them, in the file the repository keeps.
    const file = (await (await fetch(`${run.url}/api/demo/lines.json`, { headers: token })).json()) as LinesFile;
    assert.deepEqual([file.version, file.voice, file.rounds.n3!.find((line) => line.id === 'first')!.text], [1, 'test-voice', 'Look at this one first.']);
    assert.deepEqual(Object.keys(file.rounds.n3![0]!).sort(), ['cards', 'id', 'kind', 'text']);
    writeFileSync(join(temp('mp-demo-lines-'), 'lines.json'), JSON.stringify(file));

    // The page's own calls: move, play from a moment, pause.
    await run.demo!.goto('n3');
    const moved = (await post('/api/demo/seek', { round: 'n3', at: 9000 })) as { take: { at: number; playing: boolean } };
    assert.deepEqual(moved.take, { round: 'n3', ms: run.demo!.shown('n3').ms, at: 9000, playing: false });
    await post('/api/demo/play', { round: 'n3', at: 9000 });
    await until(() => run.demo!.status().take?.playing === true);
    const stopped = (await post('/api/demo/pause', {})) as { take: { at: number; playing: boolean } };
    assert.ok(!stopped.take.playing && stopped.take.at >= 9000);
  } finally {
    await s.close();
  }
});

test('Play on an empty stage starts the tree and brings the first round, and a round that brings nothing only says its lines', { timeout: 30000 }, async () => {
  const s = await stage(300, ['r1']);
  try {
    const { run } = s;
    await run.demo!.goto('r1');
    assert.equal(run.demo!.mutes(), true, 'on an empty stage the next words start the tree, so Momo\'s own voice is kept back');
    void run.demo!.playTake('r1');
    await until(() => run.demo!.status().take?.playing === false && run.demo!.status().rounds[0]!.state === 'played', 10000);
    const tree = [...run.mind.trees.values()].find((t) => t.title === script.title)!;
    assert.deepEqual(run.mind.children(tree.rootId).map((node) => run.mind.item(node.itemId).title).sort(), round('r1').cards.map((card) => card.title).sort());
    assert.deepEqual(saidOf(s.voice), run.demo!.shown('r1').lines.map((line) => line.text));

    await run.demo!.goto('bs');
    assert.deepEqual(run.demo!.shown('bs').lines, [], 'a round with no words and no cards has nothing on its timeline');
    await run.demo!.playTake('bs');
    assert.equal(run.demo!.status().rounds.find((r) => r.id === 'bs')!.state, 'played');
  } finally {
    await s.close();
  }
});

// ---- Momo and the other agents

test('in every round Momo wraps up only once every agent is done, and is never left resting while one still works', () => {
  // The rounds as they are recorded: the repository's own lines, each as long as its recording.
  const said = new Lines({ demoDir, dataDir: temp('mp-demo-data-'), voice: 'marin', log: () => {} });
  let wraps = 0;
  for (const phase of script.phases) {
    const take = takeOf(phase, said.of(phase.id), (text) => said.ms(text), 'the card');
    if (phase.cards.length === 0) continue;
    const lastCard = take.drops.at(-1)!.at;
    // Every label the take shows ends by the run's end, the run's own label with it, and the Renderer's 0.6 s after the last card.
    assert.ok(take.steps.every((step) => step.end <= take.end), `${phase.id}: a label outlasts the run`);
    assert.ok(take.end <= take.settled && lastCard + 600 < take.settled, `${phase.id}: the agents are done before the take says they are`);
    const wrap = take.lines.find((line) => line.kind === 'wrap');
    if (wrap) {
      wraps++;
      assert.ok(wrap.at >= take.settled, `${phase.id}: the wrap-up starts at ${wrap.at}, before every agent is done at ${take.settled}`);
      assert.equal(take.lines.at(-1), wrap, `${phase.id}: nothing is said after the wrap-up`);
    }
    // From the run's start to the last card laid out, at every moment Momo speaks or an agent has a label up. This is the
    // service's half of "never resting while an agent works": it assumes the headset shows her working whenever she is silent
    // and an agent has a label up, with the conversation open or not, which is the headset's to do. (The run's own label is up
    // from its start to its end.)
    const laidOut = lastCard + 600;
    for (let t = REAL.begins; t < laidOut; t += 50) {
      const speaks = take.lines.some((line) => line.ms > 0 && line.at <= t && t < line.at + line.ms);
      const works = t < take.end || take.drops.some((drop) => drop.at <= t && t < drop.at + 600);
      assert.ok(speaks || works, `${phase.id}: at ${t} ms Momo is silent and no agent is shown at work`);
    }
    // And she is not kept waiting once they are done: the wrap-up follows within a breath, unless she is still talking.
    if (wrap) {
      const before = take.lines.filter((line) => line !== wrap && line.ms > 0).at(-1);
      assert.ok(wrap.at <= Math.max(take.settled, before ? before.at + before.ms + REAL.breath : 0), `${phase.id}: the wrap-up waits for nothing`);
    }
  }
  assert.ok(wraps >= 29, `the recorded rounds with cards have wrap-ups (${wraps})`);
});

test('played on a headset, every agent\'s label has ended before the wrap-up is said, and the run ends with its last card', { timeout: 30000 }, async () => {
  const s = await stage(25);
  try {
    const { run } = s;
    await run.demo!.goto('n3');
    const take = run.demo!.shown('n3');
    // What reached the headset, in the order it came, on either socket.
    const order: { kind: string; label?: string; role?: string; state?: string; id?: string }[] = [];
    const before = { seen: s.seen.length, voice: s.voice.length };
    const tick = setInterval(() => {
      for (const m of s.seen.splice(before.seen)) if (m.t === 'activity') order.push({ kind: 'activity', label: m.activity!.label, role: m.activity!.role, state: m.activity!.state });
      for (const m of s.voice.splice(before.voice)) order.push({ kind: m.t, id: m.id });
    }, 2);
    void run.demo!.playTake('n3');
    await until(() => run.demo!.status().take?.playing === true);
    await until(() => run.demo!.status().take?.playing === false, 20000);
    await new Promise((r) => setTimeout(r, 100));
    clearInterval(tick);

    const wrapAt = order.findIndex((m) => m.kind === 'text' && m.id?.endsWith('-wrap'));
    assert.ok(wrapAt > 0, 'the wrap-up was said');
    const open = new Map<string, number>();
    for (const m of order.slice(0, wrapAt)) if (m.kind === 'activity') open.set(`${m.role}: ${m.label}`, (open.get(`${m.role}: ${m.label}`) ?? 0) + (m.state === 'start' ? 1 : -1));
    assert.deepEqual([...open].filter(([, n]) => n > 0).map(([label]) => label), [], 'no agent has a label up when the wrap-up starts');
    assert.ok(order.slice(0, wrapAt).some((m) => m.kind === 'activity' && m.role === 'scout' && /^(Looking into|Finding more for)/.test(m.label!) && m.state !== 'start'), 'the Scout\'s own label ended before it');
    assert.deepEqual(order.slice(wrapAt).filter((m) => m.kind === 'activity' && m.state === 'start'), [], 'and no agent starts anything during or after it');

    // The take sends the headset nothing about the conversation: whether it stays open after a line, and what her mark shows then, is the headset's.
    assert.equal(order.filter((m) => m.kind === 'name').length, 0);
    assert.equal(run.demo!.status().rounds.find((r) => r.id === 'n3')!.state, 'played');
  } finally {
    await s.close();
  }
});

// ---- two paces

test('at both paces, in every round, Momo speaks of a card only once it has landed, and wraps up only once every agent is done', async () => {
  const said = new Lines({ demoDir, dataDir: temp('mp-demo-data-'), voice: 'marin', log: () => {} });
  for (const mode of MODES) {
    for (const phase of script.phases) {
      const sched = schedule(phase, 'the card', mode);
      assert.deepEqual(sched.drops.flatMap((drop) => drop.cards).sort(), phase.cards.map((card) => card.id).sort(), `${mode} ${phase.id}: every card lands once`);
      assert.ok(sched.steps.every((step) => step.end > step.at && step.end <= sched.settled), `${mode} ${phase.id}: every label has ended when the agents are said to be done`);
      const landsAt = new Map(sched.drops.flatMap((drop) => drop.cards.map((id): [string, number] => [id, drop.at])));
      // The lines as they are recorded, where the round has them at this pace, and as the plan gives them with short and with long lines.
      const recorded = said.of(phase.id, mode);
      const plans: [string, Line[], (text: string) => number][] = [
        ['short lines', await planLines(phase, 'the card', async ({ kind }) => ({ text: `${kind}.`, ms: 3000 }), mode), () => 3000],
        ['long lines', await planLines(phase, 'the card', async ({ kind }) => ({ text: `${kind}.`, ms: 14_000 }), mode), () => 14_000],
        ...(recorded.length > 0 ? [['the recorded lines', recorded, (text: string) => said.ms(text)] as [string, Line[], (text: string) => number]] : []),
      ];
      for (const [name, lines, lengthOf] of plans) {
        const take = takeOf(phase, lines, lengthOf, 'the card', mode);
        for (const line of take.lines) {
          for (const id of line.cards) assert.ok(landsAt.has(id) && line.at >= landsAt.get(id)!, `${mode} ${phase.id}, ${name}: "${line.id}" starts at ${line.at}, before a card it speaks of lands at ${landsAt.get(id)}`);
        }
        const wrap = take.lines.find((line) => line.kind === 'wrap');
        if (wrap) assert.ok(wrap.at >= take.settled && take.lines.at(-1) === wrap, `${mode} ${phase.id}, ${name}: the wrap-up waits for every agent, and is the last thing said`);
        if (phase.cards.length > 0 && lines.length > 0) assert.deepEqual(take.lines.flatMap((line) => line.cards).sort(), phase.cards.map((card) => card.id).sort(), `${mode} ${phase.id}, ${name}: between them the lines tell of every card once`);
      }
    }
  }
});

test('a round at real pace is the same every time, and comes as a real round does: in bursts, with searches that bring nothing, over the span of a real run', () => {
  const sizes = new Set<number>();
  let empty = 0;
  for (const phase of script.phases.filter((p) => p.cards.length > 0)) {
    const sched = schedule(phase, 'the card', 'real');
    assert.deepEqual(schedule(phase, 'the card', 'real'), sched, `${phase.id}: the same schedule each time`);
    for (const drop of sched.drops) sizes.add(drop.cards.length);
    const labels = sched.steps.map((step) => step.label);
    assert.ok(labels.includes('Choosing where to look first') && labels.some((label) => label.startsWith('Thinking of directions for ')), `${phase.id}: the Scout chooses and thinks, as in every real run`);
    const thinking = sched.steps.find((step) => step.label.startsWith('Thinking of directions for '))!;
    // A round of three cards or fewer does not run the span of a real run: its cards come from the fast searches, and nobody
    // is left watching labels with nothing arriving. Every label has ended within about 2 s of its last found card.
    const small = phase.cards.length <= 3;
    if (small) {
      const found = sched.drops.filter((drop) => !drop.cards.some((id) => phase.cards.find((card) => card.id === id)!.origin === 'generated' && phase.cards.find((card) => card.id === id)!.image));
      const last = Math.max(...found.map((drop) => drop.at));
      const before = sched.steps.filter((step) => !step.label.startsWith('Making a picture') && step.at <= last + 2300);
      assert.ok(last <= 7000, `${phase.id}: a small round's cards are in by ${last}, at the times of a real run's first searches`);
      assert.ok(before.every((step) => step.end <= last + 2300), `${phase.id}: a small round's labels end within about 2 s of its last card`);
      continue;
    }
    assert.ok(thinking.end - thinking.at >= 19_000 && thinking.end - thinking.at <= 36_000, `${phase.id}: it thinks for as long as a real run does`);
    const searches = sched.steps.filter((step) => step.label.startsWith('Searching '));
    assert.ok(searches.length >= 3 && searches.every((step) => / for \S/.test(step.label)), `${phase.id}: three searches or more, each for some words`);
    const readings = sched.steps.filter((step) => step.label.startsWith('Reading '));
    const barren = readings.filter((step) => !sched.drops.some((drop) => drop.at === step.end));
    empty += barren.length;
    assert.ok(barren.length >= 1, `${phase.id}: at least one reading brings nothing`);
    // Every label names a source the service has, and none it does not.
    for (const step of sched.steps) {
      assert.ok(!/Writing an idea down|The Met|Library of Congress|Wellcome|NASA|MASP/.test(step.label), `${phase.id}: "${step.label}" is not a label the service shows`);
      assert.ok(step.label.split(' ').length <= 9, `${phase.id}: "${step.label}" is too long`);
    }
    const first = sched.drops[0]!.at;
    if (phase.cards.some((card) => card.origin !== 'generated')) assert.ok(first >= 1000 && first <= 7000, `${phase.id}: the first card lands at ${first}, near the 3 s of a real run`);
    assert.ok(sched.end >= 14_000 && sched.end <= 40_000, `${phase.id}: the run lasts ${sched.end}, as a real one does`);
  }
  assert.ok(sizes.has(1) && [...sizes].some((n) => n >= 5) && [...sizes].some((n) => n === 2 || n === 3), `cards come one at a time, a few at a time and many at once (${[...sizes].sort()})`);
  assert.ok(empty >= 30, 'and many searches bring nothing');
  // The fast pace keeps its own labels to the service's wording too.
  for (const phase of script.phases) {
    for (const step of schedule(phase, 'the card', 'fast').steps) assert.ok(!/Writing an idea down|The Met|Library of Congress|Wellcome|NASA|MASP/.test(step.label) && (!step.label.startsWith('Searching ') || / for \S/.test(step.label)), `fast ${phase.id}: "${step.label}"`);
  }
});

test('the page loads a pace: its take, its lines and its edits are its own, a spoken line starts it, and the file to save holds both', { timeout: 30000 }, async () => {
  const s = await stage(300);
  try {
    const { run } = s;
    const token = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };
    const post = async (path: string, body: object) => (await fetch(`${run.url}${path}`, { method: 'POST', headers: token, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>;
    await run.demo!.goto('n3');
    assert.equal(run.demo!.status().mode, 'fast', 'until a pace is chosen, takes are the fast ones');
    const fast = run.demo!.shown('n3');
    await run.demo!.seek('n3', 4000);
    assert.equal(((await post('/api/demo/mode', { mode: 'real' })) as { mode: string; take: unknown }).mode, 'real');
    assert.equal(run.demo!.status().take, null, 'the bar goes back to the start: a moment of one take is not a moment of the other');
    assert.equal(((await post('/api/demo/mode', { mode: 'slow' })) as { error?: string }).error, 'a mode is "fast" or "real"');
    const real = run.demo!.shown('n3');
    assert.deepEqual([fast.mode, real.mode], ['fast', 'real']);
    assert.ok(real.end !== fast.end && real.ms !== fast.ms, 'the real take has its own length');
    assert.ok(real.lines.every((line) => /at real pace/.test(line.text)) && fast.lines.every((line) => !/at real pace/.test(line.text)), 'and its own lines');
    assert.notDeepEqual(real.drops, fast.drops);

    // An edit is the loaded pace's alone.
    await post('/api/demo/line', { round: 'n3', line: 'wrap', text: 'A wrap-up for the real take.' });
    assert.equal(run.demo!.shown('n3', 'real').lines.at(-1)!.text, 'A wrap-up for the real take.');
    assert.ok(run.demo!.shown('n3', 'fast').lines.every((line) => !line.edited));
    const file = (await (await fetch(`${run.url}/api/demo/lines.json`, { headers: token })).json()) as LinesFile;
    assert.equal(file.real.n3!.at(-1)!.text, 'A wrap-up for the real take.');
    assert.ok(!file.rounds.n3!.some((line) => line.text === 'A wrap-up for the real take.'), 'Save to script holds both paces, each with its own words');

    // Played, the round's cards land in the real take's deliveries, and its lines are said.
    void run.demo!.playTake('n3');
    await until(() => run.demo!.status().take?.playing === true);
    await until(() => run.demo!.status().take?.playing === false, 20000);
    await until(() => s.voice.filter((m) => m.t === 'done').length === real.lines.length);
    assert.deepEqual(under(run, 'Neurones poster'), round('n3').cards.map((card) => card.title).sort());
    const texts = saidOf(s.voice);
    assert.deepEqual(texts, run.demo!.shown('n3').lines.map((line) => line.text));
    assert.equal(texts.at(-1), 'A wrap-up for the real take.');

    // A line said in the headset starts the pace that is loaded.
    await run.demo!.goto('n3');
    const poster = [...run.mind.nodes.values()].find((node) => run.mind.item(node.itemId).title === 'Neurones poster')!;
    void run.pipeline.ask(poster.id, round('n3').say);
    await until(() => run.demo!.status().take?.playing === true);
    assert.equal(run.demo!.status().take!.ms, run.demo!.shown('n3', 'real').ms, 'the take that runs is the real one');
    await run.demo!.pause();
  } finally {
    await s.close();
  }
});

// ---- the realtime voice

test('a recording\'s words are compared as they sound: a spelling by ear or a moved space is the same line, a changed, added or dropped word is not', () => {
  assert.equal(compare('I’d start with “By time”—new in front, old fading back.', "I'd start with 'By time': new in front, old fading back"), 'exact');
  assert.equal(compare('The fibres meet at the centre of Llull’s ring.', "The fibers meet at the center of Lowell's ring."), 'close');
  assert.equal(compare('There are 12 new cards, with a readout at 19 percent: rows, book and lotus.', 'There are twelve new cards with a readout at 19%. Rose, book, and lotus.'), 'close', 'a number, a percent sign and a homophone are the same words said');
  assert.equal(compare('A line groups them.', 'A line grouped them.'), 'differs');
  assert.equal(compare('A work room where one dial moves.', 'A workroom where one dial moves.'), 'close');
  assert.equal(compare('First up, there’s a film card.', 'First up, there’s a foam card.'), 'differs');
  assert.equal(compare('What’s this part?', 'What’s this card?'), 'differs');
  assert.equal(compare('We can open it and then keep one or two favorites.', 'We can open it.'), 'differs');
  assert.equal(compare('It uses a pointing gesture.', 'It uses the pointing gesture.'), 'differs');
});

/** A stand-in realtime model that says `takes[n]` on its nth session, as sound whose length follows from the words. */
function realtime(takes: string[]) {
  const asked: string[] = [];
  let n = 0;
  const open = (on: { event: (e: { type: string; [key: string]: unknown }) => void }) => ({
    send: (e: { type: string; item?: { content: { text: string }[] } }) => {
      if (e.type === 'conversation.item.create') asked.push(e.item!.content[0]!.text);
      if (e.type !== 'response.create') return;
      const said = takes[n++] ?? '';
      queueMicrotask(() => {
        on.event({ type: 'response.output_audio.delta', delta: Buffer.from(new TextEncoder().encode(said.padEnd(20_000, ' '))).toString('base64') });
        on.event({ type: 'response.output_audio_transcript.done', transcript: said });
        on.event({ type: 'response.done', response: {} });
      });
    },
    close: () => {},
  });
  return { open, asked, sessions: () => n };
}
/** The stand-in listener writes a take out as the words that made it. */
const heardAs = async (wav: Uint8Array) => new TextDecoder().decode(wav.subarray(44)).trim();

test('a line is recorded by the realtime model as Momo, a take kept only when it is heard as written; then a sentence at a time; and never by another voice', async () => {
  const line = 'Nine more landed, and my favourite is “Linux file system”.';
  const model = realtime(['Nine more just landed and I love the Linux one.', 'Nine more landed, and my favorite is Linux file system.']);
  const options = { open: model.open, model: 'gpt-realtime-2.1', voice: 'marin', name: 'Momo', hear: heardAs, log: () => {} };
  const kept = await recordLine(options, line, 'more');
  assert.ok(!('unsaid' in kept));
  assert.deepEqual([kept.takes, model.sessions()], [2, 2], 'the first take changed the words and was not kept; the second was');
  assert.equal(await heardAs(wavOf(kept.pcm)), 'Nine more landed, and my favorite is Linux file system.');
  assert.match(model.asked[0]!, /^The moment: more cards have just landed.*\nYour line: """Nine more landed, and my favourite is “Linux file system”\."""$/s, 'she is given the line and the moment it is said at');

  // Two sentences she will not say in one go: each is said alone, and the two takes are joined at a pause.
  const two = 'I’d open the paper first. Want to keep that one?';
  const pieces = realtime(['x', 'x', 'x', 'x', 'x', 'I’d open the paper first.', 'Want to keep it?', 'Want to keep that one?']);
  const joined = await recordLine({ ...options, open: pieces.open }, two, 'wrap');
  assert.ok(!('unsaid' in joined));
  assert.deepEqual([joined.takes, sentences(two)], [8, ['I’d open the paper first.', 'Want to keep that one?']]);
  const bytes = (said: string) => new TextEncoder().encode(said.padEnd(20_000, ' ')).length;
  assert.equal(joined.pcm.length, bytes('I’d open the paper first.') + bytes('Want to keep that one?') + 13_440, 'the two takes with 280 ms of quiet between them');
  assert.match(pieces.asked[5]!, /Your line: """I’d open the paper first\."""$/);

  // A line she never says as written is not ready. Her closest wording comes back, with its take when the sound bears it out.
  const stubborn = realtime(['Nine landed, my favourite is Linux.', 'Something else entirely.', 'x', 'x', 'x']);
  const unsaid = await recordLine({ ...options, open: stubborn.open }, line, 'more');
  assert.ok('unsaid' in unsaid);
  assert.deepEqual([unsaid.closest, unsaid.own, unsaid.takes, stubborn.sessions()], ['Nine landed, my favourite is Linux.', true, 5, 5], 'a line of one sentence has no sentences to try: five takes, and it is not ready');
  assert.equal(await heardAs(wavOf(unsaid.pcm!)), 'Nine landed, my favourite is Linux.');
});
