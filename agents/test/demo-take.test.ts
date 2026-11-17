import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { Lines, type LinesFile } from '../src/demo/lines.ts';
import { loadScript, type ScriptPhase } from '../src/demo/script.ts';
import { momentAt, planLines, REAL, schedule, takeOf, type Line } from '../src/demo/take.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running } from '../src/node/server.ts';

const demoDir = join(import.meta.dirname, '../demo');
/** Each boot of the demo copies its pictures into its data folder, about 20 MB: every folder made here is removed when the tests end. */
const made: string[] = [];
const temp = (prefix: string) => (made.push(mkdtempSync(join(tmpdir(), prefix))), made.at(-1)!);
process.on('exit', () => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const script = loadScript(join(demoDir, 'script.json'));
const round = (id: string): ScriptPhase => script.phases.find((phase) => phase.id === id)!;
const titlesOf = (phase: ScriptPhase, ids: string[]) => ids.map((id) => phase.cards.find((card) => card.id === id)!.title).sort();

/** A round's lines as the generator plans them, with stand-in words: each line says which cards it is of and takes 4 s. */
async function plan(phase: ScriptPhase, ms = 4000): Promise<Line[]> {
  return planLines(phase, 'the card', async ({ kind, cards }) => ({ text: `${kind}: ${cards.map((card) => card.title).join(', ') || 'no card'}.`, ms }));
}

/** The stand-in voice: 24 kHz PCM, 50 ms for each character, so a line's length follows from its words. */
const speak = async (text: string) => new Uint8Array(text.length * 48 * 50);

// ---- the timeline

test('a round\'s schedule lands every card once, the user\'s own first, then each source, then what is made, under the labels of that work', () => {
  for (const phase of script.phases) {
    const sched = schedule(phase);
    assert.deepEqual(sched.drops.flatMap((drop) => drop.cards).sort(), phase.cards.map((card) => card.id).sort(), `${phase.id}: every card lands once`);
    assert.ok(sched.drops.every((drop, n) => n === 0 || drop.at >= sched.drops[n - 1]!.at), `${phase.id}: deliveries are in order`);
    assert.ok(sched.steps.every((step) => step.end > step.at && step.end <= sched.end), `${phase.id}: every label ends by the run's end`);
    for (const drop of sched.drops) assert.ok(sched.steps.some((step) => step.end === drop.at), `${phase.id}: a label ends as its cards land`);
  }
  const n3 = round('n3');
  const sched = schedule(n3);
  const own = n3.cards.filter((card) => card.origin === 'ocean').map((card) => card.id);
  assert.deepEqual(sched.drops[0], { at: REAL.begins + REAL.plan + REAL.own, cards: own }, 'what the user has lands first');
  assert.deepEqual(sched.steps.slice(0, 2).map((step) => step.label), ['Choosing where to look first', 'Checking what you already have']);
  const made = n3.cards.filter((card) => card.origin === 'generated' && card.image);
  assert.ok(made.length > 0 && made.every((card) => sched.drops.find((drop) => drop.cards.includes(card.id))!.at >= REAL.begins + REAL.plan + REAL.picture), 'a made picture takes as long as one does');
  assert.deepEqual(schedule(round('bs')), { steps: [], drops: [], end: 0 }, 'a round that brings nothing has no run');
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

async function linesFolder(rounds: string[]): Promise<string> {
  const dir = temp('mp-demo-lines-');
  const file: LinesFile = { version: 1, voice: 'test-voice', rounds: {} };
  for (const id of rounds) file.rounds[id] = await plan(round(id));
  writeFileSync(join(dir, 'lines.json'), JSON.stringify(file));
  return dir;
}

test('the user\'s words over a line win, are kept across a restart, and go back to Momo\'s own; each wording is recorded once', async () => {
  const dir = await linesFolder(['n3']);
  const dataDir = temp('mp-demo-data-');
  const spoken: string[] = [];
  const open = () => new Lines({ demoDir: dir, dataDir, voice: 'test-voice', speak: async (text) => (spoken.push(text), speak(text)), log: () => {} });
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

  const again = open();
  assert.equal(again.of('n3')[0]!.text, 'Let me pull some threads on that.', 'the data folder keeps the user\'s words');
  assert.equal(again.edited, 1);
  await again.audio('Let me pull some threads on that.');
  assert.equal(spoken.length, 2, 'and their recording');
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
async function stage(rate: number, rounds = ['n3']): Promise<Stage> {
  const spoken: string[] = [];
  const run = await startServer({
    port: 0, host: '127.0.0.1', dataDir: temp('mp-demo-'), clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret',
    live: { open: () => ({ send: () => {}, close: () => {} }), options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' as const }, hearing: 'gpt-4o-transcribe' } },
    demo: {
      script, mediaDir: join(demoDir, 'media'), linesDir: await linesFolder(rounds), voice: 'test-voice', speak: async (text) => (spoken.push(text), speak(text)),
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
    assert.deepEqual(under(run, 'Llull’s ring'), round('n3').cards.map((card) => card.title).sort());
    const head = [...run.mind.nodes.values()].find((node) => run.mind.item(node.itemId).title === 'Llull’s ring')!;
    assert.ok(run.mind.children(head.id).every((node) => node.status === 'pick'), 'the cards land as suggestions, as a real round\'s do');

    const after = s.seen.slice(from);
    const deliveries = after.filter((m) => m.t === 'change' && m.set!.origin.role === 'scout').map((m) => m.set!.patches.filter((p) => p.entity === 'node' && p.before === null).length).filter((n) => n > 0);
    assert.deepEqual(deliveries, take.drops.map((drop) => drop.cards.length), 'each delivery of the schedule lands as one of the run\'s');
    const labels = after.filter((m) => m.t === 'activity' && m.activity!.role === 'scout' && m.activity!.state === 'start').map((m) => m.activity!.label);
    for (const step of take.steps) assert.ok(labels.includes(step.label), `the label "${step.label}" was shown`);
    assert.ok(labels.some((label) => /^(Looking into|Finding more for)/.test(label)), 'under the run\'s own label');

    const said = s.voice.filter((m) => m.t === 'text').map((m) => m.text);
    assert.deepEqual(said, take.lines.map((line) => line.text), 'Momo says every line, in order, in the words as written');
    for (const line of take.lines) assert.equal(bytesOf(s.voice, line.id), line.text.length * 2400, `all of the recording of ${line.id} was sent`);
    assert.equal(s.voice.filter((m) => m.t === 'done').length, take.lines.length);
    assert.deepEqual([...s.spoken].sort(), take.lines.map((line) => line.text).sort(), 'each line was recorded once, before the take began');
    assert.ok(played.lines.every((line) => line.recorded && line.ms === line.text.length * 50), 'and from then on is as long as its recording');
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
    assert.deepEqual(under(run, 'Llull’s ring'), titlesOf(n3, first!.cards), 'the cards that had landed by then stand');
    assert.deepEqual(run.demo!.status().take, { round: 'n3', ms: take.ms, at: Math.round(between), playing: false });
    assert.equal(run.demo!.status().rounds.find((r) => r.id === 'n3')!.state, 'waiting');
    const held = () => s.seen.filter((m) => m.t === 'activity' && m.activity!.state === 'start').map((m) => m.activity!.label);
    assert.ok(momentAt(take, between).steps.length > 0);
    await until(() => momentAt(take, between).steps.every((step) => held().includes(step.label)));

    await run.demo!.seek('n3', take.ms);
    assert.deepEqual(under(run, 'Llull’s ring'), n3.cards.map((card) => card.title).sort());
    assert.equal(run.demo!.status().rounds.find((r) => r.id === 'n3')!.state, 'played');
    assert.equal(run.demo!.status().armed, script.phases.indexOf(n3) + 1);

    const from = s.seen.length;
    await run.demo!.seek('n3', second!.at);
    assert.deepEqual(under(run, 'Llull’s ring'), titlesOf(n3, [...first!.cards, ...second!.cards]), 'going back takes the later cards away');
    await until(() => s.seen.slice(from).some((m) => m.t === 'change'));
    const removed = s.seen.slice(from).filter((m) => m.t === 'change').flatMap((m) => m.set!.patches.filter((p) => p.entity === 'node' && p.after === null));
    assert.equal(removed.length, n3.cards.length - first!.cards.length - second!.cards.length, 'and the headset is told of each card taken away');

    await run.demo!.seek('n3', 0);
    assert.deepEqual(under(run, 'Llull’s ring'), []);
    assert.equal(run.demo!.status().armed, script.phases.indexOf(n3));

    // Moves asked for faster than they are done: only the newest of those waiting is done.
    void run.demo!.seek('n3', first!.at);
    void run.demo!.seek('n3', second!.at);
    await run.demo!.seek('n3', between);
    assert.deepEqual(under(run, 'Llull’s ring'), titlesOf(n3, first!.cards));

    await assert.rejects(run.demo!.playTake('f2'), /not set up for .*Go to this round first/, 'a later round is not played over a tree that is not ready for it');
    assert.match(run.demo!.status().problem!, /Go to this round first/);
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
    await until(() => under(run, 'Llull’s ring').length > 0);
    await run.demo!.pause();
    const paused = run.demo!.status().take!;
    assert.equal(paused.playing, false);
    const take = run.demo!.shown('n3');
    assert.ok(paused.at > 0 && paused.at < take.ms);
    assert.deepEqual(under(run, 'Llull’s ring'), titlesOf(n3, momentAt(take, paused.at).cards), 'the tree is as the take had it at that moment');
    // What was on its way to the headset as the take stopped arrives first.
    await new Promise((r) => setTimeout(r, 300));
    const heard = s.voice.length;
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(under(run, 'Llull’s ring'), titlesOf(n3, momentAt(take, paused.at).cards), 'paused, nothing more lands');
    assert.equal(s.voice.slice(heard).filter((m) => m.t === 'audio').length, 0, 'and Momo is silent');
    assert.equal(run.demo!.status().take!.at, paused.at);

    const line = momentAt(take, paused.at).line;
    const before = line ? bytesOf(s.voice, line.line.id) : 0;
    void run.demo!.playTake();
    await until(() => run.demo!.status().take?.playing === false && run.demo!.status().take?.at === take.ms, 15000);
    assert.deepEqual(under(run, 'Llull’s ring'), n3.cards.map((card) => card.title).sort(), 'played on, the rest of the round arrives');
    if (line) {
      const whole = line.line.text.length * 2400;
      const resumed = bytesOf(s.voice, line.line.id) - before;
      assert.equal(resumed, whole - Math.floor((line.offset * 48) / 2) * 2, 'the line she was in went on from the very point the take was paused at, not from its start');
    }
    const starts = s.voice.filter((m) => m.t === 'text' && m.id?.endsWith('-answer'));
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
    const ring = [...run.mind.nodes.values()].find((node) => run.mind.item(node.itemId).title === 'Llull’s ring')!;
    assert.equal(run.demo!.mutes(), false);
    assert.match(run.demo!.takeNote(ring.id), /new layer/);
    assert.equal(run.demo!.mutes(), true);
    assert.match(run.demo!.shown('n3').lines[0]!.text, /^answer:/);
    // She answers and starts nothing: the take starts for her.
    run.demo!.replied();
    await until(() => run.demo!.status().take?.round === 'n3' && run.demo!.status().take?.playing === false && run.demo!.status().take!.at > 0, 10000);
    assert.ok(s.voice.some((m) => m.t === 'text' && m.text === 'Look at this one first.'), 'the user\'s words are said');
    assert.ok(s.spoken.includes('Look at this one first.') && !s.spoken.some((text) => text.startsWith('first: ')), 'and only they were recorded for that line');
    assert.equal(run.demo!.mutes(), false, 'the round played, Momo is herself again');

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
    assert.deepEqual(s.voice.filter((m) => m.t === 'text').map((m) => m.text), run.demo!.shown('r1').lines.map((line) => line.text));

    await run.demo!.goto('bs');
    assert.deepEqual(run.demo!.shown('bs').lines, [], 'a round with no words and no cards has nothing on its timeline');
    await run.demo!.playTake('bs');
    assert.equal(run.demo!.status().rounds.find((r) => r.id === 'bs')!.state, 'played');
  } finally {
    await s.close();
  }
});
