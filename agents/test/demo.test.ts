import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { momoNote, wavesOf } from '../src/demo/director.ts';
import { loadScript } from '../src/demo/script.ts';
import { startServer, type Running } from '../src/node/server.ts';

/** The demo with stand-in roles and no waits: the walkthrough's own script and pictures, as `npm run demo:fake` runs them. */
const demoDir = join(import.meta.dirname, '../demo');
const script = loadScript(join(demoDir, 'script.json'));
const quick = { stand: 400, open: 400, land: 400, breath: 0, step: 0, rejoin: 1500 };

async function boot(dataDir = mkdtempSync(join(tmpdir(), 'mp-demo-')), restart?: () => Promise<string>): Promise<Running> {
  return startServer({
    port: 0, host: '127.0.0.1', dataDir, clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret',
    demo: { script, mediaDir: join(demoDir, 'media'), pace: quick, restart },
  });
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

const cardsOf = (id: string) => script.phases.find((phase) => phase.id === id)!.cards;
const before = (id: string) => script.phases.slice(0, script.phases.findIndex((phase) => phase.id === id));
/** The node a card of the script hangs on, found by its title. */
const nodeOf = (run: Running, title: string) => [...run.mind.nodes.values()].find((node) => run.mind.item(node.itemId).title === title);
const titlesUnder = (run: Running, title: string) => run.mind.children(nodeOf(run, title)!.id).map((node) => run.mind.item(node.itemId).title);

test('the script holds together: every round is asked from a card an earlier round brings, and no card repeats', () => {
  assert.equal(script.phases[0]!.head, 'root');
  const titles = script.phases.flatMap((phase) => phase.cards.map((card) => card.title.toLowerCase()));
  assert.equal(new Set(titles).size, titles.length, 'two cards share a title, and the round rules would leave one out');
  for (const phase of script.phases) for (const wave of wavesOf(phase)) assert.ok(wave.labels.every((label) => label.split(' ').length <= 9), `a step label of ${phase.id} is too long`);
});

test('going to a round builds every round before it, kept, and leaves it the next', async () => {
  const run = await boot();
  try {
    await run.demo!.goto('n3');
    const built = before('n3');
    assert.deepEqual(built.map((phase) => phase.id), ['r1', 'n2', 'mo']);
    const wanted = built.flatMap((phase) => phase.cards).length;
    assert.equal(run.mind.trees.size, 1);
    assert.equal(run.mind.nodes.size, wanted + 1);
    assert.ok([...run.mind.nodes.values()].every((node) => node.status === 'kept'));
    assert.equal(run.demo!.status().armed, 3);
    // Round 2 hangs from the paper Round 1 brought, as the script says.
    assert.deepEqual(titlesUnder(run, 'Virtual memory palaces: immersion aids recall').sort(), cardsOf('n2').map((card) => card.title).sort());
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
    const head = nodeOf(run, 'Llull’s ring')!;
    await run.pipeline.more(head.id);
    await run.pipeline.idle();
    const landed = run.mind.children(head.id);
    assert.deepEqual(landed.map((node) => run.mind.item(node.itemId).title).sort(), cardsOf('n3').map((card) => card.title).sort());
    assert.ok(landed.every((node) => node.status === 'pick'), 'a round that is played lands as picks, so Momo tells of them');
    assert.equal(run.demo!.status().rounds.find((round) => round.id === 'n3')!.state, 'played');
    assert.equal(run.demo!.status().armed, 4);
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
    const under = titlesUnder(run, 'Your FigJam board');
    for (const card of cardsOf('bp')) assert.ok(under.includes(card.title), `${card.title} did not land`);
    for (const card of cardsOf('bw')) assert.ok(!under.includes(card.title), 'the round before it in the order was played instead');
    // A request on a card no round is asked from: the walkthrough goes on there, with the round after the one just played.
    const elsewhere = nodeOf(run, 'Neurones poster')!;
    const had = run.mind.children(elsewhere.id).length;
    await run.pipeline.more(elsewhere.id);
    await run.pipeline.idle();
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
    const paper = nodeOf(run, 'Virtual memory palaces: immersion aids recall')!;
    assert.deepEqual(await run.pipeline.questions(paper.id), script.phases.find((phase) => phase.id === 'n2')!.offers);
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
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-demo-'));
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
