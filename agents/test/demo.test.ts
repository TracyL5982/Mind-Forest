import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { momoNote } from '../src/demo/director.ts';
import { schedule } from '../src/demo/take.ts';
import { loadScript } from '../src/demo/script.ts';
import { loadShowcase, type Showcase } from '../src/demo/showcase.ts';
import { startServer, type Running } from '../src/node/server.ts';

/** The demo with stand-in roles and no waits: the walkthrough's own script and pictures, as `npm run demo:fake` runs them. */
const demoDir = join(import.meta.dirname, '../demo');
const script = loadScript(join(demoDir, 'script.json'));
/** A take's clock runs 400 times as fast, so a round of 45 s is over in a tenth of one. */
const quick = { stand: 400, open: 400, land: 400, breath: 0, step: 0, rate: 400, rejoin: 1500 };

async function boot(dataDir = mkdtempSync(join(tmpdir(), 'mp-demo-')), restart?: () => Promise<string>, showcase?: Showcase[]): Promise<Running> {
  return startServer({
    port: 0, host: '127.0.0.1', dataDir, clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret',
    demo: { script, mediaDir: join(demoDir, 'media'), pace: quick, restart, showcase },
  });
}

/** A folder of showcase trees: one small tree that holds together, and one whose card hangs from nothing. */
function showcaseFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mp-show-'));
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
