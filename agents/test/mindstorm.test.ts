import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Id, Item, Node } from '../src/core/domain.ts';
import { Pipeline } from '../src/core/pipeline.ts';
import { roles } from '../src/core/roles/index.ts';
import { makeNode, type Settings } from '../src/core/roles/types.ts';
import { AGENT, kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };

/** The real roles over a scripted model, the way the service runs them. The Renderer is left out: no rule here is about looks. */
function harness(settings: Partial<Settings> = {}) {
  const k = kit(settings);
  k.model.describing();
  k.model.on('scout.ideate', () => ({ reading: '', directions: [] }));
  const said: string[] = [];
  const pipeline = new Pipeline({
    mind: k.mind,
    roles: { ...roles, renderer: async () => [] },
    model: k.model,
    tools: k.ctx.tools,
    assets: k.assets,
    store: { append() {}, all: () => [] },
    settings: k.ctx.settings,
    newId: k.ctx.newId,
    now: k.ctx.now,
    emit: (m) => {
      if (m.t === 'say') said.push(m.text);
      if (m.t === 'note') k.notes.push(`${m.role}: ${m.message}`);
    },
    settleMs: 5,
    playback: () => k.playback,
  });
  return { k, pipeline, said };
}

/** Each Scout run thinks of `count` written ideas whose titles start with the run's number, so every run brings new ones. */
function ideas(k: Kit): void {
  let run = 0;
  k.model.on('scout.ideate', (req) => {
    run++;
    const count = Number(/Return exactly (\d+) directions/.exec(req.user)![1]);
    return {
      reading: '',
      directions: Array.from({ length: count }, (_, i) => ({ angle: `angle ${run}.${i}`, format: 'note', title: `Idea ${run}.${i + 1}`, body: 'Something new.', why: `new ${run}`, tags: [], lines: [], pros: [], cons: [], subject: '', passage: '', by: '', controls: [], formula: '', numbers: [], unit: '', images: [], source: '', lookups: [] })),
    };
  });
}

function rate(k: Kit, strengths: Record<Id, number>): void {
  k.model.on('scout.rate', () => ({ ratings: Object.entries(strengths).map(([itemId, strength]) => ({ itemId, strength, why: `tie to ${itemId}` })) }));
}

function own(k: Kit, fields: Partial<Item> & { title: string }): Item {
  const item = k.item(fields);
  k.mind.apply({ origin: USER, label: 'drop', commands: [{ type: 'addItem', item }] });
  return item;
}

function libraryFilm(k: Kit, title: string, text: string, key: number): Item {
  return own(k, { title, text, kind: 'video', source: { from: 'library', capturedAt: '' }, data: { library: { kind: 'film', key }, mediaUrl: `/assets/film-${key}` } });
}

const round = (k: Kit, anchor: Id): Node[] => k.mind.picks(anchor);
const titles = (k: Kit, nodes: Node[]) => nodes.map((n) => k.mind.itemOf(n.id).title);

test('a plain dump joins the knowledge base and starts no tree', async () => {
  const { k, pipeline } = harness();

  await pipeline.dump([{ kind: 'text', text: 'Kubrick hated small talk on set' }]);
  await pipeline.idle();

  assert.equal(k.mind.trees.size, 0);
  assert.deepEqual(k.mind.unplaced().map((i) => i.title), ['Kubrick hated small talk on set']);
  assert.ok(!k.model.calls.some((c) => c.role.startsWith('scout')), 'nothing was scouted for it');
});

test('a dump with a strong fit lands once as a pick under that card, a weak one stays unplaced, and neither starts a tree', async () => {
  const { k, pipeline } = harness();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  k.model.on('filer', (req) => ({
    placements: [...req.user.matchAll(/item (\S+) \(text\) "([^"]+)"/g)].map(([, itemId, title]) => ({
      itemId,
      parentNodeId: film.nodeIds[1]!,
      strength: title!.includes('Jaws') ? 0.9 : 0.5,
      why: 'the same shot',
    })),
  }));

  await pipeline.dump([{ kind: 'text', text: 'The Jaws beach shot is a dolly zoom' }]);
  await pipeline.dump([{ kind: 'text', text: 'Zoom calls drain me' }]);
  await pipeline.idle();

  assert.equal(k.mind.trees.size, 1);
  const jaws = [...k.mind.items.values()].find((i) => i.title.includes('Jaws'))!;
  const [hung] = k.mind.nodesOfItem(jaws.id);
  assert.equal(k.mind.nodesOfItem(jaws.id).length, 1);
  assert.deepEqual([hung!.parent, hung!.status, hung!.why], [film.nodeIds[1], 'pick', 'the same shot']);
  assert.deepEqual(k.mind.unplaced().map((i) => i.title), ['Zoom calls drain me']);
});

test('a dump whose words ask for a tree becomes the root of a new tree, without those words, and gets its first round', async () => {
  for (const text of ['Start a tree on this: The dolly zoom makes dread out of geometry', 'The dolly zoom makes dread out of geometry. Make a tree from this.']) {
    const { k, pipeline } = harness();
    ideas(k);

    await pipeline.dump([{ kind: 'text', text }]);
    await pipeline.idle();

    const [tree] = [...k.mind.trees.values()];
    assert.equal(k.mind.trees.size, 1, text);
    const root = k.mind.itemOf(tree!.rootId);
    assert.match(root.text, /^The dolly zoom makes dread out of geometry\.?$/, 'the root holds what was dropped, not the words that asked');
    assert.equal(k.mind.node(tree!.rootId).status, 'kept');
    assert.ok(round(k, tree!.rootId).length >= 3, 'the root got its first round');
  }
});

test('"start a tree on this" said after a drop grows the tree from that very item', async () => {
  const { k, pipeline } = harness();
  ideas(k);
  await pipeline.dump([{ kind: 'text', text: 'Kubrick hated small talk on set' }]);
  await pipeline.idle();
  const [dropped] = k.mind.unplaced();

  pipeline.utter('start a tree on this', { selection: [] }, true);
  await pipeline.idle();

  const [tree] = [...k.mind.trees.values()];
  assert.equal(k.mind.node(tree!.rootId).itemId, dropped!.id, 'the item itself, not a copy');
  assert.equal(k.mind.items.size, 1 + round(k, tree!.rootId).length);
});

test('"make a tree about X" draws the things the user has that are strongly tied into the root round, strongest first, beside new content', async () => {
  const { k, pipeline } = harness();
  ideas(k);
  const dump = own(k, { title: 'Kubrick hated small talk', text: 'Stanley Kubrick hated small talk on set.' });
  const other = k.seedTree('Machines', ['Machines that look back', 'Kubrick and the polite machine']);
  const card = k.mind.node(other.nodeIds[1]!).itemId;
  const film = libraryFilm(k, '2001: A Space Odyssey', 'Stanley Kubrick sends HAL into space.', 53);
  const weak = libraryFilm(k, 'Barry Lyndon', 'Stanley Kubrick lights a film by candle.', 54);
  own(k, { title: 'Sourdough starter', text: 'Feed it at night.' });
  rate(k, { [film.id]: 0.95, [dump.id]: 0.9, [card]: 0.85, [weak.id]: 0.5 });

  pipeline.utter('make a tree about Stanley Kubrick', { selection: [] }, true);
  await pipeline.idle();

  const tree = [...k.mind.trees.values()].find((t) => t.id !== other.treeId)!;
  assert.equal(tree.title, 'Stanley Kubrick');
  const picks = round(k, tree.rootId);
  const known = picks.filter((n) => n.origin.tool === 'mindstorm' || n.origin.tool === 'library');
  assert.deepEqual(known.map((n) => n.itemId), [film.id, dump.id, card], 'every strong tie, the strongest first, and not the weak one');
  assert.deepEqual(known.map((n) => n.origin.tool), ['library', 'mindstorm', 'mindstorm']);
  assert.equal(picks.length - known.length, 5, 'new content fills the rest');
  assert.ok(k.mind.nodes.has(other.nodeIds[1]!), 'the card stays in its own tree as well');
  const offered = k.model.calls.find((c) => c.role === 'scout.rate')!.detail;
  assert.ok(!offered.includes('Sourdough'), 'what shares nothing with the subject is not offered');
});

test('a subject that names something the user has makes that thing the root, and nothing of the same name repeats it', async () => {
  const { k, pipeline } = harness();
  const vertigo = libraryFilm(k, 'Vertigo', 'Hitchcock: Scottie climbs the bell tower.', 25);
  k.world.sources = [{ id: 'films', name: 'Films', goodFor: 'Films.', query: 'Titles.', show: 2 }];
  k.world.found.set('films:vertigo', [
    { title: 'Vertigo', by: 'Alfred Hitchcock', date: '1958', text: 'A detective with a fear of heights.', url: 'https://films.example/vertigo' },
    { title: 'Rear Window', by: 'Alfred Hitchcock', date: '1954', text: 'A photographer watches his neighbours.', url: 'https://films.example/rear-window' },
  ]);
  k.model
    .on('scout.ideate', () => ({ reading: '', directions: [{ angle: 'the films', format: 'find', title: 'Hitchcock films', body: '', why: 'his other films', tags: [], lines: [], pros: [], cons: [], subject: '', passage: '', by: '', controls: [], formula: '', numbers: [], unit: '', images: [], source: 'films', lookups: ['vertigo'] }] }))
    .on('scout.curate', () => ({ chosen: [1, 2].map((number) => ({ number, note: '', excerpt: '' })) }));

  pipeline.utter('make a tree about vertigo', { selection: [] }, true);
  await pipeline.idle();

  const [tree] = [...k.mind.trees.values()];
  assert.equal(k.mind.node(tree!.rootId).itemId, vertigo.id);
  assert.deepEqual(titles(k, round(k, tree!.rootId)), ['Rear Window'], 'the film source\'s "Vertigo" is the root again, so it is left out');
});

test('a round holds at most 8 things the user already had, the strongest, and keeps room for new content', async () => {
  const { k, pipeline } = harness();
  ideas(k);
  const tree = k.seedTree('Machines', ['Machines that look back', 'HAL is polite']);
  const [root] = tree.nodeIds as [Id];
  const known = Array.from({ length: 11 }, (_, i) => own(k, { title: `Machines that look back, note ${i + 1}`, text: 'machines that look back' }));
  rate(k, Object.fromEntries(known.map((item, i) => [item.id, 0.8 + i * 0.01])));

  await pipeline.ask(root, 'more on the machines');
  await pipeline.idle();

  const picks = round(k, root);
  assert.equal(picks.length, 10);
  assert.deepEqual(picks.filter((n) => n.origin.tool === 'mindstorm').map((n) => n.itemId), known.slice(3).reverse().map((i) => i.id));
});

/** Hangs agent picks under a card, oldest first, the way earlier runs left them. */
function earlier(k: Kit, anchor: Id, titles: string[], origin = AGENT('scout', 'web')): Node[] {
  return titles.map((title) => {
    const item = k.item({ title, origin });
    const node = makeNode(k.ctx, item, { treeId: k.mind.node(anchor).treeId, parent: anchor, status: 'pick', why: 'earlier', origin });
    k.mind.apply({ origin, label: 'earlier', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
    return node;
  });
}

test('opening a card brings nothing; talk about it does, and so does the first round of a tree the user asked for', async () => {
  const { k, pipeline } = harness();
  ideas(k);
  const film = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase']);
  const [root, stairs] = film.nodeIds as [Id, Id];

  pipeline.focus(root);
  pipeline.focus(stairs);
  await pipeline.idle();
  assert.ok(!k.model.calls.some((c) => c.role.startsWith('scout')), 'no Scout run');
  assert.equal(k.mind.picks(root).length + k.mind.picks(stairs).length, 0);

  k.model.on('conductor', () => ({ anchorId: stairs, kind: 'ask', need: 'why the staircase feels like dread', nodeId: '', treeId: '', request: '', scopeNodeIds: [], scopeTreeIds: [], note: '', text: '', keepNodeIds: [], say: 'Looking into it.' }));
  pipeline.utter('why does this feel like dread', { focus: stairs, selection: [] }, true);
  await pipeline.idle();
  assert.equal(k.mind.picks(stairs).length, 5);
  assert.equal(k.mind.picks(root).length, 0);
});

test('a question about a card with 6 picks adds new ones made for it, and the 6 stay', async () => {
  const { k, pipeline } = harness({ picksPerRun: 4 });
  ideas(k);
  const film = k.seedTree('Film', ['Dolly zoom']);
  const [root] = film.nodeIds as [Id];
  const six = earlier(k, root, ['One', 'Two', 'Three', 'Four', 'Five', 'Six']);

  await pipeline.ask(root, 'examples from horror films');
  await pipeline.idle();

  const picks = round(k, root);
  assert.equal(picks.length, 10);
  assert.ok(six.every((n) => k.mind.nodes.has(n.id)), 'nothing was replaced');
  assert.deepEqual(picks.filter((n) => !six.some((o) => o.id === n.id)).map((n) => n.why), ['new 1', 'new 1', 'new 1', 'new 1']);
  assert.match(k.model.calls.find((c) => c.role === 'scout.ideate')!.detail, /asked for "examples from horror films"/);
});

test('a question at the cap lets go of the picks least related to it, not the oldest, and never a kept card', async () => {
  const { k, pipeline } = harness({ picksPerRun: 3 });
  ideas(k);
  const film = k.seedTree('Film', ['Dolly zoom', 'Kept one', 'Kept two']);
  const [root, ...kept] = film.nodeIds as [Id, Id, Id];
  const picks = earlier(k, root, ['Pick 1', 'Pick 2', 'Pick 3', 'Pick 4', 'Pick 5', 'Pick 6', 'Pick 7', 'Pick 8', 'Pick 9']);
  const dump = own(k, { title: 'A thought I dropped' });
  const dumpPick = makeNode(k.ctx, dump, { treeId: film.treeId, parent: root, status: 'pick', why: 'fits', origin: AGENT('filer', 'mindstorm') });
  k.mind.apply({ origin: AGENT('filer'), label: 'file', commands: [{ type: 'addNode', node: dumpPick }] });
  const far: Record<string, number> = { 'Pick 5': 0.1, 'Pick 9': 0.15, 'A thought I dropped': 0.05 };
  let shown = '';
  k.model.on('scout.rate', (req) => {
    shown = req.user.split('already shown')[1] ?? '';
    return { ratings: [...shown.matchAll(/item (\S+) "([^"]+)"/g)].map(([, itemId, title]) => ({ itemId, strength: far[title!] ?? 0.7, why: '' })) };
  });

  await pipeline.ask(root, 'what horror films do with it');
  await pipeline.idle();

  assert.ok(shown.includes('Pick 1') && shown.includes('A thought I dropped'), 'the picks already there were rated against the question');
  const left = round(k, root);
  assert.equal(left.length, 10);
  assert.deepEqual(titles(k, left.filter((n) => n.why === 'earlier')), ['Pick 1', 'Pick 2', 'Pick 3', 'Pick 4', 'Pick 6', 'Pick 7', 'Pick 8']);
  assert.ok(!k.mind.nodes.has(picks[4]!.id) && !k.mind.nodes.has(picks[8]!.id) && !k.mind.nodes.has(dumpPick.id));
  assert.ok(kept.every((id) => k.mind.node(id).status === 'kept'), 'kept cards are never what gives way');
  assert.deepEqual(k.mind.unplaced().map((i) => i.id), [dump.id], 'the dropped thought went back to the knowledge base');
  assert.equal(k.mind.node(picks[0]!.id).importance, 0.7, 'what the rating said is kept as the pick\'s importance');
  assert.deepEqual(k.notes, []);
});

test('nothing repeats inside a tree, by item, by address or by title, and what the user has wins over the same thing from outside', async () => {
  const { k, pipeline } = harness();
  ideas(k);
  const film = k.seedTree('Film', ['Hitchcock']);
  const [root] = film.nodeIds as [Id];
  const page = k.item({ title: 'A page on Hitchcock', kind: 'link', source: { from: 'link', url: 'https://example.com/hitchcock', capturedAt: '' } });
  k.mind.apply({ origin: USER, label: 'save', commands: [{ type: 'addItem', item: page }, { type: 'addNode', node: makeNode(k.ctx, page, { treeId: film.treeId, parent: root, status: 'kept', why: '', origin: USER }) }] });
  const outside = k.item({ title: 'The Vertigo', origin: AGENT('scout', 'films'), source: { from: 'web', url: 'https://films.example/vertigo', capturedAt: '' } });
  const outsidePick = makeNode(k.ctx, outside, { treeId: film.treeId, parent: root, status: 'pick', why: 'a film', origin: AGENT('scout', 'films') });
  k.mind.apply({ origin: AGENT('scout'), label: 'pick', commands: [{ type: 'addItem', item: outside }, { type: 'addNode', node: outsidePick }] });
  const vertigo = libraryFilm(k, 'Vertigo', 'Hitchcock: Scottie climbs the bell tower.', 25);
  rate(k, { [vertigo.id]: 0.9 });

  await pipeline.more(root);
  await pipeline.idle();
  assert.ok(!k.mind.nodes.has(outsidePick.id), 'the outside "Vertigo" gave its place');
  assert.equal(round(k, root).filter((n) => n.itemId === vertigo.id).length, 1);

  const rated = k.model.calls.filter((c) => c.role === 'scout.rate').length;
  await pipeline.more(root);
  await pipeline.idle();
  const offered = (prompt: string) => (prompt.split('These are things the user already has')[1] ?? '').split('already shown')[0]!;
  assert.ok(!k.model.calls.filter((c) => c.role === 'scout.rate').slice(rated).some((c) => offered(c.detail).includes(vertigo.id)), 'the film the tree holds is not offered again');
  assert.ok(k.mind.treeNodes(film.treeId).filter((n) => n.itemId === vertigo.id).length <= 1);

  k.model.on('filer', (req) => ({ placements: [{ itemId: /item (\S+)/.exec(req.user)![1]!, parentNodeId: root, strength: 0.95, why: 'same page' }] }));
  await pipeline.dump([{ kind: 'link', url: 'https://www.example.com/hitchcock/' }]);
  await pipeline.idle();
  const link = [...k.mind.items.values()].find((i) => i.kind === 'link' && i.id !== page.id)!;
  assert.equal(k.mind.nodesOfItem(link.id).length, 0, 'a page the tree already holds is not hung again');
  assert.deepEqual(k.mind.unplaced().map((i) => i.id), [link.id], 'it stays in the knowledge base');

  const keys = k.mind.treeNodes(film.treeId).map((n) => k.mind.itemOf(n.id).title.toLowerCase().replace(/^the /, ''));
  assert.equal(new Set(keys).size, keys.length, 'no two cards of the tree share a title');
});

test('a tree asked for by its subject is rooted in that subject as said, not in a note Intake writes about the words', async () => {
  for (const [said, subject] of [
    ['Can you start a new tree on Dutch artist?', 'Dutch artist'],
    ['start a tree about Hitchcock\'s films', 'Hitchcock\'s films'],
    ['Make a new tree on the Bauhaus', 'the Bauhaus'],
  ]) {
    const { k, pipeline } = harness();
    ideas(k);
    pipeline.utter(said!, { selection: [] }, true);
    await pipeline.idle();

    const [tree] = [...k.mind.trees.values()];
    assert.equal(k.mind.trees.size, 1, said);
    assert.equal(k.mind.itemOf(tree!.rootId).title, subject, said);
    assert.ok(!k.model.calls.some((c) => c.role.startsWith('intake')), `${said}: no Intake call`);
  }
});

test('a tree asked for in Chinese is rooted in the subject the Conductor heard', async () => {
  const { k, pipeline } = harness();
  ideas(k);
  k.model.on('conductor', () => ({ kind: 'tree', text: '荷兰画家', anchorId: '', need: '', nodeId: '', treeId: '', request: '', scopeNodeIds: [], scopeTreeIds: [], note: '', keepNodeIds: [], say: '好，开一棵关于荷兰画家的树。' }));

  pipeline.utter('帮我建一棵关于荷兰画家的新树', { selection: [] }, true);
  await pipeline.idle();

  const [tree] = [...k.mind.trees.values()];
  assert.equal(k.mind.itemOf(tree!.rootId).title, '荷兰画家');
  assert.ok(k.mind.picks(tree!.rootId).length > 0, 'and its first round came');
});
