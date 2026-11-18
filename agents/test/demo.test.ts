import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { DAILY_TREE, momoNote, sharedMessage } from '../src/demo/director.ts';
import { itemOf, nodeOf as nodeOfCard } from '../src/demo/cards.ts';
import { schedule } from '../src/demo/take.ts';
import { loadScript } from '../src/demo/script.ts';
import { demoData } from './demo-data.ts';
import { loadShowcase, type Showcase } from '../src/demo/showcase.ts';
import { startServer, type Running } from '../src/node/server.ts';
import { recordingName } from '../src/demo/lines.ts';
import { ADA, BOT_TOKEN, FakeBot } from './fake-bot.ts';

/** The demo with stand-in roles and no waits: the walkthrough's own script and pictures, as `npm run demo:fake` runs them. */
const demoDir = join(import.meta.dirname, '../demo');
const script = loadScript(join(demoDir, 'script.json'));
/** A take's clock runs 400 times as fast, so a round of 45 s is over in a tenth of one. */
const quick = { stand: 400, open: 400, land: 400, breath: 0, step: 0, rate: 400, rejoin: 1500 };

const data = demoData();
const fresh = data.fresh;

async function boot(dataDir = fresh(), restart?: () => Promise<string>, showcase?: Showcase[]): Promise<Running> {
  return startServer({
    port: 0, host: '127.0.0.1', dataDir, clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret',
    demo: { script, mediaDir: join(demoDir, 'media'), pace: quick, restart, showcase },
  });
}

/** A folder of showcase trees: one small tree that holds together, and one whose card hangs from nothing. */
function showcaseFolder(): string {
  const dir = data.temp('mp-show-');
  mkdirSync(join(dir, 'mini', 'media'), { recursive: true });
  mkdirSync(join(dir, 'broken'));
  writeFileSync(join(dir, 'mini', 'media', 'cone.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  writeFileSync(join(dir, 'mini', 'tree.json'), JSON.stringify({
    version: 1, id: 'mini', title: 'Seed spirals', topic: 'Why do seeds grow in spirals?',
    cards: [
      { id: 'cone', parent: 'root', kind: 'picture', origin: 'ocean', title: 'Pine cone from above', text: 'The scales run in two sets of spirals.', from: 'Pinterest, your Seed board', href: 'https://www.pinterest.com/pin/1/', image: 'cone.jpg', w: 640, h: 640 },
      { id: 'vogel', parent: 'cone', kind: 'paper', origin: 'external', title: 'A better way to build the sunflower head', text: 'One angle between seeds gives the whole head.', authors: ['Helmut Vogel'], date: '1979', venue: 'Mathematical Biosciences', href: 'https://doi.org/10.1016/0025-5564(79)90080-4' },
      { id: 'idea', parent: 'root', kind: 'note', origin: 'generated', title: 'Two rules make the spiral', text: 'Each new seed turns by one angle and moves out a little.' },
    ],
  }));
  writeFileSync(join(dir, 'broken', 'tree.json'), JSON.stringify({ version: 1, id: 'broken', title: 'Broken', topic: 'A card that hangs from nothing', cards: [{ id: 'lost', parent: 'nowhere', kind: 'note', origin: 'generated', title: 'Lost', text: 'It hangs from no card.' }] }));
  return dir;
}

/**
 * A connection that says it is a device, as the app does on joining: it plays files and embeds nothing. The app on a headset
 * joins through OkHttp, which names itself; the Mac preview (`app: false`) does not.
 */
async function headset(run: Running, app = true): Promise<WebSocket> {
  const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`, app ? { headers: { 'user-agent': 'okhttp/4.12.0' } } : {});
  await new Promise((open) => ws.on('open', open));
  const had = run.demo!.status().devices;
  ws.send(JSON.stringify({ t: 'client', media: { embeds: false, files: ['mp4'] } }));
  while (run.demo!.status().devices === had) await new Promise((r) => setTimeout(r, 5));
  return ws;
}

/** A played round's take goes on after its run, while Momo wraps up: resolves once no take is running. */
const over = async (run: Running) => {
  while (run.demo!.status().take?.playing) await new Promise((r) => setTimeout(r, 5));
};
const cardsOf = (id: string) => script.phases.find((phase) => phase.id === id)!.cards;
const before = (id: string) => script.phases.slice(0, script.phases.findIndex((phase) => phase.id === id));
/** The node a card of the script hangs on, found by its title. */
const nodeOf = (run: Running, title: string) => [...run.mind.nodes.values()].find((node) => run.mind.item(node.itemId).title === title);
const titlesUnder = (run: Running, title: string) => run.mind.children(nodeOf(run, title)!.id).map((node) => run.mind.item(node.itemId).title);

test('the script holds together: every round is asked from a card an earlier round brings, and no card repeats', () => {
  assert.equal(script.phases[0]!.head, 'root');
  const titles = script.phases.flatMap((phase) => phase.cards.map((card) => card.title.toLowerCase()));
  assert.equal(new Set(titles).size, titles.length, 'two cards share a title, and the round rules would leave one out');
  for (const phase of script.phases) for (const step of schedule(phase).steps) assert.ok(step.label.split(' ').length <= 9, `a step label of ${phase.id} is too long`);
});

test('going to a round builds every round before it, kept, and leaves it the next', async () => {
  const run = await boot();
  try {
    await run.demo!.goto('n3');
    const built = before('n3');
    assert.deepEqual(built.map((phase) => phase.id), ['r1', 'n2']);
    const wanted = built.flatMap((phase) => phase.cards).length;
    assert.equal(run.mind.trees.size, 1);
    assert.equal(run.mind.nodes.size, wanted + 1);
    assert.ok([...run.mind.nodes.values()].every((node) => node.status === 'kept'));
    assert.equal(run.demo!.status().armed, 2);
    // Round 2 hangs from the film Round 1 brought, as the script says, and Round 3 waits on the Neurones poster with nothing under it.
    assert.deepEqual(titlesUnder(run, 'Slice of Heartland').sort(), cardsOf('n2').map((card) => card.title).sort());
    assert.deepEqual(titlesUnder(run, 'Neurones poster'), []);
    // The card's look is chosen with it: a paper is a reference, a picture carries its shape.
    const paper = nodeOf(run, 'Virtual memory palaces: immersion aids recall')!;
    assert.equal(paper.view.component, 'reference');
    assert.equal(paper.view.by, 'renderer');
    const poster = nodeOf(run, 'Neurones poster')!;
    assert.equal(poster.view.component, 'image');
    assert.equal(typeof poster.view.props.aspect, 'number');
  } finally {
    await run.close();
  }
});

test('a request on the card a round is asked from plays that round as the Scout would: picks, in parts, under step labels', async () => {
  const run = await boot();
  const seen: { t: string; activity?: { role: string; label: string; state: string }; set?: { origin: { role?: string }; label: string } }[] = [];
  const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`);
  ws.on('message', (raw) => seen.push(JSON.parse(String(raw))));
  await new Promise((open) => ws.on('open', open));
  try {
    await run.demo!.goto('n3');
    const head = nodeOf(run, 'Neurones poster')!;
    await run.pipeline.ask(head.id, 'so how do we keep the information organized?');
    await run.pipeline.idle();
    await over(run);
    const landed = run.mind.children(head.id);
    assert.deepEqual(landed.map((node) => run.mind.item(node.itemId).title).sort(), cardsOf('n3').map((card) => card.title).sort());
    assert.ok(landed.every((node) => node.status === 'pick'), 'a round that is played lands as picks, so Momo tells of them');
    assert.equal(run.demo!.status().rounds.find((round) => round.id === 'n3')!.state, 'played');
    assert.equal(run.demo!.status().armed, 3);
    await new Promise((r) => setTimeout(r, 50));
    const steps = seen.filter((m) => m.t === 'activity' && m.activity!.role === 'scout' && m.activity!.state === 'start').map((m) => m.activity!.label);
    assert.ok(steps.includes('Checking what you already have'), steps.join(' | '));
    assert.ok(steps.some((label) => label.startsWith('Searching ')), steps.join(' | '));
    assert.ok(seen.filter((m) => m.t === 'change' && m.set!.origin.role === 'scout').length >= 2, 'the cards come in more than one delivery');
    // The user's mark on the Linux picture came with its card.
    assert.equal(nodeOf(run, 'Linux file system')!.edits?.[0]?.kind, 'stroke');
  } finally {
    ws.close();
    await run.close();
  }
});

test('a question the script names plays its round wherever it stands in the order, and any other request plays the next', async () => {
  const run = await boot();
  try {
    await run.demo!.goto('bw');
    const board = nodeOf(run, 'Your FigJam board')!;
    await run.pipeline.ask(board.id, 'How do we present it?');
    await run.pipeline.idle();
    await over(run);
    const under = titlesUnder(run, 'Your FigJam board');
    for (const card of cardsOf('bp')) assert.ok(under.includes(card.title), `${card.title} did not land`);
    for (const card of cardsOf('bw')) assert.ok(!under.includes(card.title), 'the round before it in the order was played instead');
    // A request on a card no round is asked from: the walkthrough goes on there, with the round after the one just played.
    const elsewhere = nodeOf(run, 'Neurones poster')!;
    const had = run.mind.children(elsewhere.id).length;
    await run.pipeline.more(elsewhere.id);
    await run.pipeline.idle();
    await over(run);
    assert.equal(run.mind.children(elsewhere.id).length, had + cardsOf('bu').length);
    assert.equal(run.demo!.status().rounds.find((round) => round.id === 'bw')!.state, 'waiting', 'the round passed over still waits for its question');
  } finally {
    await run.close();
  }
});

test('the questions under a round\'s card are the script\'s, and the stage can be emptied and set again', async () => {
  const run = await boot();
  try {
    await run.demo!.goto('n2');
    const film = nodeOf(run, 'Slice of Heartland')!;
    assert.deepEqual(await run.pipeline.questions(film.id), script.phases.find((phase) => phase.id === 'n2')!.offers);
    const tree = [...run.mind.trees.keys()][0];
    // Going on keeps the tree a headset has standing; only an empty stage takes it away.
    await run.demo!.goto('f1');
    assert.deepEqual([...run.mind.trees.keys()], [tree]);
    await run.demo!.goto('r1');
    assert.equal(run.mind.trees.size, 0);
    assert.equal(run.mind.nodes.size, 0);
    await run.demo!.goto('end');
    assert.equal(run.mind.nodes.size, script.phases.flatMap((phase) => phase.cards).length + 1);
    assert.ok(run.demo!.status().rounds.every((round) => round.state === 'built'));
  } finally {
    await run.close();
  }
});

test('a data folder kept from an earlier run is taken up where it stood', async () => {
  const dataDir = fresh();
  const first = await boot(dataDir);
  await first.demo!.goto('f2');
  await first.close();
  const again = await boot(dataDir);
  try {
    assert.equal(again.demo!.status().armed, script.phases.findIndex((phase) => phase.id === 'f2'));
    assert.equal(again.demo!.status().rounds.filter((round) => round.state === 'built').length, before('f2').length);
  } finally {
    await again.close();
  }
});

test('an empty stage starts the app again on a headset that showed the tree, and where that cannot be done the page is told', async () => {
  // A headset keeps a tree standing after the service deletes it: only the app started again shows nothing.
  let restarts = 0;
  let worn: WebSocket | null = null;
  let run: Running;
  const restart = async () => {
    restarts++;
    worn?.close();
    worn = await headset(run);
    return 'started again';
  };
  run = await boot(undefined, restart);
  try {
    worn = await headset(run);
    await run.demo!.goto('n2');
    assert.equal(restarts, 0, 'a set-up that keeps the tree leaves the app running');
    await run.demo!.goto('r1');
    assert.equal(restarts, 1);
    assert.equal(run.mind.trees.size, 0);
    assert.equal(run.demo!.status().problem, null);
    assert.equal(run.demo!.status().busy, null);
    // Nothing was standing this time, so nothing is started again.
    await run.demo!.goto('r1');
    assert.equal(restarts, 1);
    // The Mac preview is a device too, but no app on a headset: it is not started again from here, and the page says so.
    worn.close();
    worn = await headset(run, false);
    await run.demo!.goto('n2');
    await run.demo!.goto('r1');
    assert.equal(restarts, 1);
    assert.match(run.demo!.status().problem ?? '', /not the app on a headset/);
  } finally {
    (worn as WebSocket | null)?.close();
    await run.close();
  }

  const bare = await boot();
  const there = await headset(bare);
  try {
    await bare.demo!.goto('n2');
    await bare.demo!.goto('r1');
    assert.match(bare.demo!.status().problem ?? '', /headset\.sh restart/);
  } finally {
    there.close();
    await bare.close();
  }
});

test('the tree a played first round starts is named as a set-up names it, and Momo is given its subject', async () => {
  const run = await boot();
  try {
    await run.pipeline.makeTree(script.topic);
    await run.pipeline.idle();
    await over(run);
    const tree = [...run.mind.trees.values()][0]!;
    assert.equal(tree.title, script.title);
    assert.equal(run.mind.item(run.mind.node(tree.rootId).itemId).title, script.topic);
    assert.deepEqual(run.mind.children(tree.rootId).map((node) => run.mind.item(node.itemId).title).sort(), cardsOf('r1').map((card) => card.title).sort());
    assert.equal(run.demo!.status().rounds[0]!.state, 'played');
    assert.ok(momoNote(script).includes(`"${script.topic}"`));
  } finally {
    await run.close();
  }
});

test('Momo is told, with where the user is, when the next words said on the open card ask for the round that waits on it', async () => {
  // By her own rules a question gets an answer and no cards, and half the walkthrough's lines are questions.
  const run = await boot();
  try {
    await run.demo!.goto('n3');
    const ring = nodeOf(run, 'Llull’s ring')!;
    assert.match(run.demo!.takeNote(ring.id), /^\nRecording: .*new layer/);
    assert.equal(run.demo!.takeNote(nodeOf(run, 'Corals')!.id), '', 'no round waits on this card, so Momo is told nothing more');
    assert.equal(run.demo!.takeNote(undefined), '');
    await run.pipeline.more(ring.id);
    await run.pipeline.idle();
    await over(run);
    assert.equal(run.demo!.takeNote(ring.id), '', 'the round was played: the card is an ordinary card again');
    // The one round that brings nothing is answered aloud from its card.
    await run.demo!.goto('bs');
    assert.match(run.demo!.takeNote(nodeOf(run, 'Sources')!.id), /answer aloud/);
    run.demo!.setScripted(false);
    assert.equal(run.demo!.takeNote(nodeOf(run, 'Sources')!.id), '', 'with scripting off Momo is on her own');
    assert.match(momoNote(script), /Recording:/);
  } finally {
    await run.close();
  }
});

test('the showcase trees stand whole in the forest, outlast every set-up, and no round is played on them', async () => {
  const { trees, problems } = loadShowcase(showcaseFolder());
  assert.deepEqual(trees.map((show) => show.tree.id), ['mini']);
  assert.match(problems.join(' '), /"broken" is left out: .*nowhere/);
  const run = await boot(undefined, undefined, trees);
  try {
    const tree = [...run.mind.trees.values()].find((t) => t.id.startsWith('show-mini-'))!;
    assert.equal(tree.title, 'Seed spirals');
    assert.equal(run.mind.item(run.mind.node(tree.rootId).itemId).title, 'Why do seeds grow in spirals?');
    const cone = nodeOf(run, 'Pine cone from above')!;
    assert.equal(cone.parent, tree.rootId);
    assert.equal(cone.status, 'kept');
    assert.equal(cone.view.component, 'image');
    assert.ok(run.mind.item(cone.itemId).source.asset, 'its picture was stored with the tree');
    assert.deepEqual(titlesUnder(run, 'Pine cone from above'), ['A better way to build the sunflower head']);
    assert.equal(nodeOf(run, 'A better way to build the sunflower head')!.view.component, 'reference');
    assert.deepEqual(run.demo!.status().showcase, { on: true, trees: [{ id: 'mini', title: 'Seed spirals', cards: 3 }] });
    // The walkthrough comes and goes beside it.
    await run.demo!.goto('n3');
    assert.equal(run.mind.trees.size, 2);
    await run.demo!.goto('r1');
    assert.deepEqual([...run.mind.trees.keys()], [tree.id]);
    // Asked on, it is the user's own tree: the Scout answers as ever, and the walkthrough's next round stays where it is.
    await run.pipeline.more(cone.id);
    await run.pipeline.idle();
    await over(run);
    assert.ok(run.demo!.status().rounds.every((round) => round.state === 'waiting'));
    assert.equal(run.demo!.takeNote(cone.id), '');
    // Taken out and put back from the page.
    await run.demo!.setShowcase(false);
    assert.equal(run.mind.trees.size, 0);
    assert.equal(run.demo!.status().showcase.on, false);
    await run.demo!.setShowcase(true);
    assert.ok([...run.mind.trees.keys()].some((id) => id === tree.id));
  } finally {
    await run.close();
  }
});

test('a showcase tree is stood whole on a headset by taking it to one card under each card that leads others', async () => {
  // A tree that arrives whole lies on one layer on a headset: a card takes a layer of its own once the headset is taken under it.
  const { trees } = loadShowcase(showcaseFolder());
  const run = await boot(undefined, undefined, trees);
  try {
    await assert.rejects(run.demo!.show('mini'), /No headset/);
    const worn = await headset(run);
    const went: string[] = [];
    worn.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as { t: string; nodeId?: string; yours?: boolean };
      if (m.t === 'navigate' && m.yours && m.nodeId) went.push(m.nodeId.replace(/^show-mini-[0-9a-f]+-/, ''));
    });
    await run.demo!.show('mini');
    await new Promise((r) => setTimeout(r, 50));
    // The first card, then the paper under the cone (so the cone leads a layer), then the first card again.
    assert.deepEqual(went, ['root', 'vogel', 'root']);
    assert.equal(run.demo!.status().busy, null);
    await assert.rejects(run.demo!.show('nothing'), /no showcase tree/);
    worn.close();
  } finally {
    await run.close();
  }
});

// ---- the daily tree

interface Frame {
  t: string;
  yours?: boolean;
  set?: { origin: { by: string; role?: string }; commands: { type: string; tree?: { id: string; rootId: string }; node?: { id: string; parent: string | null; status: string } }[] };
  id?: string;
  text?: string;
  kind?: string;
  ms?: number;
  from?: number;
}

/**
 * The demo for the daily tree's shot: the small showcase tree, the owner's bot with their account paired (or none), and Momo's
 * voice, whose lines are recorded by a stand-in as sound as long as their words.
 */
async function dailyDemo(paired = true) {
  const bot = await new FakeBot().start();
  const { trees } = loadShowcase(showcaseFolder());
  const run = await startServer({
    port: 0, host: '127.0.0.1', dataDir: fresh(), clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret',
    live: { open: () => ({ send: () => {}, close: () => {} }), options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' as const }, hearing: 'gpt-4o-transcribe' } },
    telegram: { token: BOT_TOKEN, api: bot.url, pollSeconds: 0, conflictMs: 100, retryMs: 20, ...(paired ? { owner: { userId: ADA.id, chatId: ADA.id, name: 'Ada Lovelace' } } : {}) },
    demo: {
      script, mediaDir: join(demoDir, 'media'), showcase: trees, pace: { ...quick, grow: 300, growAfterJoin: 60, wornAway: 5000 },
      voice: 'test-voice', record: async (text) => ({ pcm: new Uint8Array(text.length * 48 * 50), takes: 1 }),
    },
  });
  return { run, bot, close: async () => (await run.close(), await bot.close()) };
}

/**
 * A headset as the app joins, with its voice's socket open: what its connection and its voice are sent. As the app does, it
 * says a tree it asked for stands, by its first card, and that a card it is taken to is open.
 */
async function wearing(run: Running): Promise<{ seen: Frame[]; voice: Frame[]; send: (message: object) => void; off: () => void }> {
  const seen: Frame[] = [];
  const voice: Frame[] = [];
  const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`, { headers: { 'user-agent': 'okhttp/4.12.0' } });
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Frame & { nodeId?: string; connection?: string };
    seen.push(m);
    const made = m.t === 'change' && m.yours ? m.set!.commands.find((c) => c.type === 'createTree') : undefined;
    if (made) ws.send(JSON.stringify({ t: 'focus', nodeId: made.tree!.rootId }));
    if (m.t === 'navigate' && m.nodeId) ws.send(JSON.stringify({ t: 'questions', nodeId: m.nodeId }));
  });
  await new Promise((open) => ws.on('open', open));
  const had = run.demo!.status().devices;
  ws.send(JSON.stringify({ t: 'client', media: { embeds: false, files: ['mp4'] } }));
  while (run.demo!.status().devices === had || !seen.some((m) => m.t === 'hello')) await new Promise((r) => setTimeout(r, 5));
  const live = new WebSocket(`${run.url.replace('http', 'ws')}/live?token=secret&connection=${(seen.find((m) => m.t === 'hello') as { connection?: string }).connection}`);
  live.on('message', (raw) => voice.push(JSON.parse(String(raw)) as Frame));
  await new Promise((open) => live.on('open', open));
  return { seen, voice, send: (message) => ws.send(JSON.stringify(message)), off: () => (live.close(), ws.close()) };
}

/** Resolves once `ok` holds; fails after five seconds. */
async function soon(ok: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const dailyTree = (run: Running) => [...run.mind.trees.values()].find((tree) => tree.id.startsWith('show-mini-'));

test('the daily tree is armed out of the forest, and grows back as the headset\'s own tree, a layer at a time, as Momo says her line', async () => {
  const { run, close } = await dailyDemo();
  let headset: Awaited<ReturnType<typeof wearing>> | null = null;
  try {
    assert.equal(DAILY_TREE, 'constellations', "the rightmost of the showcase trees is the page's first pick");
    assert.deepEqual(run.demo!.status().daily, { trees: [{ id: 'mini', title: 'Seed spirals' }], armed: null, kind: null, sent: false, grown: false, onJoin: false, canSend: true });
    await assert.rejects(run.demo!.armDaily('nothing'), /no showcase tree called nothing/);
    await assert.rejects(run.demo!.growDaily(), /Arm the daily tree first/);
    await run.demo!.armDaily('mini');
    assert.equal(dailyTree(run), undefined, 'armed, it leaves the forest');
    assert.equal(run.demo!.status().daily.armed, 'mini');

    headset = await wearing(run);
    const from = headset.seen.length;
    await run.demo!.growDaily();
    const tree = dailyTree(run)!;
    assert.ok(tree, 'grown, it stands in the forest again');
    assert.ok([...run.mind.nodes.values()].filter((node) => node.treeId === tree.id).every((node) => node.status === 'kept'), 'its cards are kept');
    // Its first card comes first, as a tree the headset asked for, so it stands there; then each layer, deepest last, each as an
    // agent's cards come, one after another with a note each.
    await soon(() => headset!.seen.slice(from).filter((m) => m.t === 'change').length >= 3);
    const changes = headset.seen.slice(from).filter((m) => m.t === 'change');
    assert.ok(changes.every((m) => m.yours), "every change of its growing is the headset's own");
    assert.equal(changes[0]!.set!.commands.find((c) => c.type === 'createTree')?.tree?.id, tree.id);
    const layers = changes.slice(1).map((m) => m.set!.commands.filter((c) => c.type === 'addNode').map((c) => c.node!.id.replace(`${tree.id}-`, '')));
    assert.deepEqual(layers, [['cone', 'idea'], ['vogel']]);
    assert.ok(changes.slice(1).every((m) => m.set!.origin.by === 'agent' && m.set!.origin.role === 'demo'));
    assert.equal(headset.seen.slice(from).filter((m) => m.t === 'activity').length, 0, 'no agent is shown at work');
    // Momo's line is said as written, its caption with its length, from its start.
    await soon(() => headset!.voice.some((m) => m.t === 'done' && m.id?.endsWith('-daily')));
    const said = headset.voice.find((m) => m.t === 'text' && m.id?.endsWith('-daily'))!;
    const words = run.demo!.words('daily');
    assert.deepEqual({ text: said.text, kind: said.kind, ms: said.ms, from: said.from }, { text: words, kind: 'reply', ms: words.length * 50, from: 0 });
    assert.ok(headset.voice.some((m) => m.t === 'audio' && m.id === said.id));
    assert.equal(run.demo!.status().busy, null);
    assert.equal(run.demo!.status().daily.grown, true);
    await assert.rejects(run.demo!.growDaily(), /has grown already: arm it again/);

    // Armed again for another take, it leaves the forest once more. The headset keeps a tree that is gone, and this service
    // cannot start its app again, so the page says to.
    await run.demo!.armDaily('mini');
    assert.equal(dailyTree(run), undefined);
    assert.deepEqual({ sent: run.demo!.status().daily.sent, grown: run.demo!.status().daily.grown }, { sent: false, grown: false });
    assert.match(run.demo!.status().problem ?? '', /headset\.sh restart/);
  } finally {
    headset?.off();
    await close();
  }
});

test("Momo's message goes to the paired phone, and the next headset to join grows the daily tree, once for each time it is armed", async () => {
  const { run, bot, close } = await dailyDemo();
  const worn: Awaited<ReturnType<typeof wearing>>[] = [];
  try {
    await assert.rejects(run.demo!.sendDaily(), /Arm the daily tree first/);
    await run.demo!.armDaily('mini');
    // Joined before the message went, a headset grows nothing.
    worn.push(await wearing(run));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(dailyTree(run), undefined);
    worn.pop()!.off();

    await run.demo!.sendDaily();
    assert.deepEqual(bot.sent.map(({ method, chat, text }) => ({ method, chat, text })), [{ method: 'sendMessage', chat: ADA.id, text: run.demo!.words('daily') }]);
    assert.deepEqual({ sent: run.demo!.status().daily.sent, onJoin: run.demo!.status().daily.onJoin }, { sent: true, onJoin: true });
    worn.push(await wearing(run));
    await soon(() => run.demo!.status().daily.grown && run.demo!.status().busy === null);
    const tree = dailyTree(run)!;
    assert.equal([...run.mind.nodes.values()].filter((node) => node.treeId === tree.id).length, 4, 'its first card and its three');
    assert.equal(run.demo!.status().daily.onJoin, false);
    // Put on again, the headset grows it no more.
    worn.pop()!.off();
    worn.push(await wearing(run));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(dailyTree(run)!.id, tree.id);
    assert.equal(run.demo!.status().problem, null);
  } finally {
    for (const one of worn) one.off();
    await close();
  }

  // With no account paired, the message is not sent, and the page says why.
  const lone = await dailyDemo(false);
  try {
    assert.equal(lone.run.demo!.status().daily.canSend, false);
    await lone.run.demo!.armDaily('mini');
    await assert.rejects(lone.run.demo!.sendDaily(), /no Telegram account is paired/);
    assert.match(lone.run.demo!.status().problem ?? '', /no Telegram account is paired/);
    assert.equal(lone.bot.sent.length, 0);
  } finally {
    await lone.close();
  }
});

test('a headset that stays joined grows the daily tree when it is put on again after five seconds off, once for each arm', async () => {
  const { run, close } = await dailyDemo();
  let headset: Awaited<ReturnType<typeof wearing>> | null = null;
  try {
    await run.demo!.armDaily('mini');
    headset = await wearing(run);
    const worn = async (away: number) => {
      headset!.send({ t: 'worn', away });
      await new Promise((r) => setTimeout(r, 150));
    };
    // Before Momo's message, taking it off and on grows nothing.
    await worn(30);
    assert.equal(dailyTree(run), undefined);
    await run.demo!.sendDaily();
    // A moment off, as the headset's menu takes, is not taking it off.
    await worn(4.9);
    assert.equal(dailyTree(run), undefined);
    assert.equal(run.demo!.status().daily.onJoin, true);
    headset.send({ t: 'worn', away: 12.3 });
    await soon(() => run.demo!.status().daily.grown && run.demo!.status().busy === null);
    const tree = dailyTree(run)!;
    assert.ok(tree, 'put on again, the tree grows');
    await soon(() => headset!.seen.some((m) => m.t === 'change' && m.yours && m.set!.commands.some((c) => c.type === 'createTree' && c.tree?.id === tree.id)));
    // Once for each arm: put on again, nothing more grows; a new arm and message grow it once more.
    await worn(30);
    assert.equal(dailyTree(run)!.id, tree.id);
    assert.equal(run.demo!.status().problem, null);
    await run.demo!.armDaily('mini');
    await run.demo!.sendDaily();
    headset.send({ t: 'worn', away: 8 });
    await soon(() => run.demo!.status().daily.grown && run.demo!.status().busy === null && dailyTree(run) !== undefined);
    // A time off that is no time is refused as any message that does not hold together.
    const from = headset.seen.length;
    headset.send({ t: 'worn', away: -1 });
    await soon(() => headset!.seen.slice(from).some((m) => m.t === 'error'));
  } finally {
    headset?.off();
    await close();
  }
});

test('a tree shared from the headset leaves the forest while that headset keeps it, the phone is told, and it grows back with its own line', async () => {
  const { run, bot, close } = await dailyDemo();
  let headset: Awaited<ReturnType<typeof wearing>> | null = null;
  try {
    headset = await wearing(run);
    const shown = dailyTree(run)!;
    const from = headset.seen.length;
    headset.send({ t: 'share', tree: shown.id });
    await soon(() => bot.sent.length > 0);
    assert.deepEqual(bot.sent.map(({ method, chat, text }) => ({ method, chat, text })), [{ method: 'sendMessage', chat: ADA.id, text: sharedMessage('Seed spirals') }]);
    assert.equal(sharedMessage('Seed spirals'), 'A friend shared a tree with you: “Seed spirals”. Put on your headset to see it grow.');
    // Out of the forest at once, so the app's next start has it no more; this app is not started again, and keeps showing it.
    assert.equal(dailyTree(run), undefined);
    await soon(() => headset!.seen.slice(from).some((m) => m.t === 'change' && m.set!.commands.some((c) => c.type === 'deleteTree')));
    assert.equal(run.demo!.status().problem, null, 'nothing says to start the app again');
    assert.deepEqual(
      (({ armed, kind, sent, grown, onJoin }) => ({ armed, kind, sent, grown, onJoin }))(run.demo!.status().daily),
      { armed: 'mini', kind: 'shared', sent: true, grown: false, onJoin: true },
    );
    // Put on again, it grows back as the headset's own tree, and Momo says the shared tree's line.
    headset.send({ t: 'worn', away: 20 });
    await soon(() => run.demo!.status().daily.grown && run.demo!.status().busy === null && dailyTree(run) !== undefined);
    await soon(() => headset!.voice.some((m) => m.t === 'done' && m.id?.endsWith('-shared')));
    const said = headset.voice.find((m) => m.t === 'text' && m.id?.endsWith('-shared'))!;
    assert.equal(said.text, run.demo!.words('shared'));
    assert.ok(headset.seen.some((m) => m.t === 'change' && m.yours && m.set!.commands.some((c) => c.type === 'createTree' && c.tree?.id === shown.id)));
    // Taken out again from the page for another take: it waits for the headset at once, and the phone is not told again.
    await run.demo!.armDaily('mini', 'shared');
    assert.equal(dailyTree(run), undefined);
    assert.equal(run.demo!.status().daily.onJoin, true);
    assert.equal(bot.sent.length, 1);
    // Cleared, it is back in the forest and nothing waits.
    run.demo!.clearHeld();
    assert.ok(dailyTree(run));
    assert.deepEqual((({ armed, kind, onJoin }) => ({ armed, kind, onJoin }))(run.demo!.status().daily), { armed: null, kind: null, onJoin: false });
    // Only a showcase tree can be shared in the demo: the headset is told no, and the page says why.
    const before = headset.seen.length;
    headset.send({ t: 'share', tree: 'no-such-tree' });
    await soon(() => headset!.seen.slice(before).some((m) => m.t === 'error'));
    assert.match(run.demo!.status().problem ?? '', /Only the showcase trees can be shared/);
    assert.ok(dailyTree(run), 'and nothing is taken out');
  } finally {
    headset?.off();
    await close();
  }

  // A service that is not the demo shares nothing yet, and says so.
  const plain = await startServer({ port: 0, host: '127.0.0.1', dataDir: fresh(), clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret' });
  const ws = new WebSocket(`${plain.url.replace('http', 'ws')}/ws?token=secret`);
  try {
    const seen: Frame[] = [];
    ws.on('message', (raw) => seen.push(JSON.parse(String(raw)) as Frame));
    await new Promise((open) => ws.on('open', open));
    ws.send(JSON.stringify({ t: 'share', tree: 'any' }));
    await soon(() => seen.some((m) => m.t === 'error'));
    assert.match((seen.find((m) => m.t === 'error') as { message?: string }).message ?? '', /not ready on this service yet/);
  } finally {
    ws.close();
    await plain.close();
  }
});

test("Send on a tree hands that tree off to the paired chat as a file: a showcase tree, or the walkthrough's", async () => {
  const { run, bot, close } = await dailyDemo();
  let headset: Awaited<ReturnType<typeof wearing>> | null = null;
  try {
    headset = await wearing(run);
    await run.demo!.goto('n2');
    const walkthrough = [...run.mind.trees.values()].find((tree) => !tree.id.startsWith('show-'))!;
    for (const tree of [dailyTree(run)!, walkthrough]) {
      const after = bot.sent.length;
      headset.send({ t: 'handoff', scope: { treeIds: [tree.id], nodeIds: [] } });
      const file = await bot.reply(ADA.id, /./, 'sendDocument', after);
      assert.equal(/^## (.+)$/m.exec(file.text)?.[1], tree.title, `the file is "${tree.title}" alone`);
    }
  } finally {
    headset?.off();
    await close();
  }
});

test("the lines Momo says as a held tree grows are kept in the demo folder in her realtime voice, said as written and never by another voice", () => {
  const lines = JSON.parse(readFileSync(join(demoDir, 'lines.json'), 'utf8')) as { voice: string; said?: Record<string, string> };
  assert.deepEqual(Object.keys(lines.said ?? {}).sort(), ['daily', 'shared']);
  const voices = JSON.parse(readFileSync(join(demoDir, 'voice', 'voices.json'), 'utf8')) as Record<string, string>;
  for (const text of Object.values(lines.said!)) assert.equal(voices[recordingName(lines.voice, text)], 'realtime', text);
});

test('the showcase trees of the demo folder all hold together, and each is a tree with forks and depth, not a stick', () => {
  const { trees, problems } = loadShowcase(join(demoDir, 'showcase'));
  assert.deepEqual(problems, []);
  assert.deepEqual(trees.map((show) => show.tree.id), ['constellations', 'paper', 'planet', 'seed']);
  for (const { tree } of trees) {
    const under = new Map<string, number>();
    for (const card of tree.cards) under.set(card.parent, (under.get(card.parent) ?? 0) + 1);
    const forks = [...under].filter(([parent, n]) => parent !== 'root' && n >= 2).length;
    const depth = (id: string): number => (id === 'root' ? 0 : 1 + depth(tree.cards.find((card) => card.id === id)!.parent));
    assert.ok(forks >= 8, `${tree.id} forks at ${forks} cards`);
    assert.ok(Math.max(...tree.cards.map((card) => depth(card.id))) >= 4, `${tree.id} is less than four layers deep`);
    assert.ok(tree.cards.length >= 36);
  }
});

test("no showcase card is a work the headset's library already holds, since a pick gives way to what the user has", () => {
  const { works } = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/works/works.json'), 'utf8')) as { works: { url?: string }[] };
  const library = new Set(works.flatMap((work) => work.url ?? []));
  const { trees } = loadShowcase(join(demoDir, 'showcase'));
  const again = trees.flatMap(({ tree }) => tree.cards.filter((card) => card.href && library.has(card.href)).map((card) => `${tree.id}/${card.id}`));
  assert.deepEqual(again, []);
});

test('a card with a credit keeps it as data.credit, with its page, as the Scout keeps a source credit line', () => {
  const making = { media: () => undefined, assetUrl: (id: string) => `/assets/${id}`, now: () => '2026-11-16T00:00:00.000Z' };
  const { trees } = loadShowcase(join(demoDir, 'showcase'));
  const cards = [...script.phases.flatMap((phase) => phase.cards), ...trees.flatMap(({ tree }) => tree.cards)].filter((card) => card.credit?.trim());
  assert.ok(cards.length > 100, `${cards.length} cards with a credit`);
  for (const card of cards) {
    const item = itemOf(card, making);
    assert.deepEqual(item.data.credit, { text: card.credit!.trim(), ...(card.href && { url: card.href }) }, card.id);
  }
});

test("every card's thread says why it is there in under eight words, as the Scout's do, with no two alike under one card", () => {
  const making = { media: () => undefined, assetUrl: (id: string) => `/assets/${id}`, now: () => '2026-11-16T00:00:00.000Z' };
  const { trees } = loadShowcase(join(demoDir, 'showcase'));
  const sets = [
    ...trees.map(({ tree }) => ({ name: tree.id, cards: tree.cards })),
    { name: 'walkthrough', cards: script.phases.flatMap((phase) => phase.cards.map((card) => ({ ...card, parent: phase.head }))) },
  ];
  const broken: string[] = [];
  for (const { name, cards } of sets) {
    const under = new Map<string, string>();
    for (const card of cards) {
      const { why } = nodeOfCard(card, itemOf(card, making), { id: card.id, treeId: name, parent: card.parent, status: 'kept', order: 0, rank: 0 }, making);
      const words = why.split(/\s+/).filter(Boolean).length;
      if (words === 0 || words >= 8 || why.includes('…')) broken.push(`${name}/${card.id}: "${why}"`);
      const key = `${card.parent} ${why.toLowerCase()}`;
      if (under.has(key)) broken.push(`${name}/${card.id}: "${why}", as ${under.get(key)}`);
      under.set(key, card.id);
    }
  }
  assert.deepEqual(broken, []);
});
