import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { landedCards, runTool, toolLabel, toolSpecs, whereNote } from '../src/core/voice-tools.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer } from '../src/node/server.ts';

async function world() {
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir: mkdtempSync(join(tmpdir(), 'mp-tools-')), clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret' });
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
  await run.pipeline.idle();
  const tree = [...run.mind.trees.values()][0]!;
  const root = tree.rootId;
  const pick = run.mind.picks(root)[0]!;
  const said: { t: string; nodeId?: string; treeId?: string }[] = [];
  const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`);
  ws.on('message', (raw) => said.push(JSON.parse(String(raw))));
  await new Promise((ok) => ws.on('open', ok));
  const call = async (name: string, args: object, focus = root, webAnswer?: (q: string) => Promise<string>) => {
    const out = await runTool(name, JSON.stringify(args), { pipeline: run.pipeline, scene: { focus, treeId: tree.id, selection: [] }, webAnswer });
    await run.pipeline.idle();
    await new Promise((r) => setTimeout(r, 20));
    return out;
  };
  const close = async () => {
    ws.close();
    await run.close();
  };
  return { run, tree, root, pick, said, call, close };
}

test('every tool is declared with a description and arguments the model fills', () => {
  const specs = toolSpecs();
  assert.deepEqual(specs.map((s) => s.name), ['web_answer', 'look_up_mindstorm', 'find_new', 'start_tree', 'more_like_this', 'keep', 'undo', 'go_to', 'organize', 'hand_off', 'save_note']);
  for (const s of specs) {
    assert.ok(s.description.length > 30, `${s.name} says when to use it`);
    assert.equal((s.parameters as { type: string }).type, 'object');
  }
  assert.equal(toolLabel('web_answer', '{"question":"Who won the Booker Prize this year?"}'), 'Searching the web for Who won the Booker Prize');
  assert.equal(toolLabel('look_up_mindstorm', '{"query":"x"}'), undefined, 'a lookup is too quick to show');
});

test('find_new brings new cards onto the open card and answers at once; more_like_this does too', async () => {
  const w = await world();
  try {
    const before = w.run.mind.picks(w.root).length;
    const out = await w.call('find_new', { subject: 'rye bread', angle: 'old recipes' });
    assert.deepEqual(out.started, true);
    assert.equal(out.on, 'Sourdough rises slowly in winter');
    assert.ok(w.run.mind.picks(w.root).length > before, 'a Scout run on the open card brought picks');
    assert.equal((await w.call('more_like_this', { narrower: '' })).started, true);
  } finally {
    await w.close();
  }
});

test('look_up_mindstorm answers from what the user has, saying where each thing is', async () => {
  const w = await world();
  try {
    const out = (await w.call('look_up_mindstorm', { query: 'sourdough winter' })) as { found: { title: string; where: string; card?: string; saved: boolean }[] };
    assert.equal(out.found[0]!.title, 'Sourdough rises slowly in winter');
    assert.match(out.found[0]!.where, /the root of the tree/);
    assert.equal(out.found[0]!.card, w.root);
    const none = (await w.call('look_up_mindstorm', { query: 'zeppelin' })) as { found: unknown[]; note: string };
    assert.deepEqual(none.found, []);
    assert.equal(out.found[0]!.saved, true);
    const tree = (await w.call('look_up_mindstorm', { query: `my ${w.tree.title} tree` })) as { tree: string; cards: { card?: string; saved: boolean }[] };
    assert.equal(tree.tree, w.tree.title, 'a tree named is the tree itself');
    assert.equal(tree.cards.length, w.run.mind.treeNodes(w.tree.id).length);
    assert.equal(tree.cards.find((c) => c.card === w.pick.id)?.saved, false, 'a suggestion not yet kept is not saved');
  } finally {
    await w.close();
  }
});

test('keep, undo and go_to act as the Conductor would, and go_to only opens', async () => {
  const w = await world();
  try {
    const kept = await w.call('keep', { which: 'this' }, w.pick.id);
    assert.equal(kept.done, true);
    assert.equal(w.run.mind.node(w.pick.id).status, 'kept');
    assert.deepEqual(await w.call('undo', {}), { done: true, undid: 'Keep a pick' });
    assert.equal(w.run.mind.node(w.pick.id).status, 'pick');

    const nodes = w.run.mind.nodes.size;
    assert.deepEqual(await w.call('go_to', { to: 'up' }, w.pick.id), { done: true, opened: 'Sourdough rises slowly in winter', moved: "up one level, to the tree's first card" });
    assert.deepEqual(w.said.filter((m) => m.t === 'navigate').at(-1), { t: 'navigate', nodeId: w.root });
    const named = await w.call('go_to', { to: w.run.mind.itemOf(w.pick.id).title }, w.root);
    assert.equal(named.done, true);
    assert.equal(w.said.filter((m) => m.t === 'navigate').at(-1)!.nodeId, w.pick.id);
    assert.equal(w.run.mind.nodes.size, nodes, 'opening a card brings nothing');
    assert.equal((await w.call('go_to', { to: 'zeppelin hangar' })).done, false);
    assert.equal((await w.call('keep', { which: 'this' }, w.root)).done, false, 'the open card is no suggestion, and it has several');
  } finally {
    await w.close();
  }
});

test('start_tree makes a tree about a subject, or from the open card', async () => {
  const w = await world();
  try {
    assert.deepEqual((await w.call('start_tree', { subject: 'Dutch ceramics' })).started, true);
    assert.ok([...w.run.mind.trees.values()].some((t) => t.title === 'Dutch ceramics'));
    const grown = await w.call('start_tree', { subject: '' }, w.pick.id);
    assert.equal(grown.tree, w.run.mind.itemOf(w.pick.id).title);
  } finally {
    await w.close();
  }
});

test('web_answer hands on the web answer, or says the web is not reachable', async () => {
  const w = await world();
  try {
    assert.deepEqual(await w.call('web_answer', { question: 'Booker Prize 2026' }, w.root, async (q) => `asked: ${q}`), { answer: 'asked: Booker Prize 2026' });
    assert.match(String((await w.call('web_answer', { question: 'x' })).error), /not reachable/);
    assert.match(String((await runTool('nope', '{}', { pipeline: w.run.pipeline, scene: { selection: [] } })).error), /no tool called nope/);
  } finally {
    await w.close();
  }
});

test('Momo is told where the user is and of each card that lands, in what the card states', async () => {
  const w = await world();
  try {
    assert.match(whereNote(w.run.pipeline.ctx, { focus: w.root, treeId: w.tree.id, selection: [] }), /^The user has open the card "Sourdough rises slowly in winter" \(a note\) in the tree "[^"]+"\.\nSuggestions round it, not yet kept: 1\. /);
    assert.equal(whereNote(w.run.pipeline.ctx, { selection: [] }), 'The user has no tree or card open.');
    const sets = w.run.mind.changes().filter((s) => s.origin.role === 'scout');
    const cards = landedCards(w.run.mind, sets[0]!);
    assert.ok(cards.length > 0);
    assert.equal(cards[0]!.anchor, w.root);
    assert.equal(cards[0]!.under, 'Sourdough rises slowly in winter');
    assert.ok(cards[0]!.title && cards[0]!.kind && cards[0]!.why);
    assert.deepEqual(landedCards(w.run.mind, w.run.mind.changes()[0]!), [], 'only the Scout lands cards');
  } finally {
    await w.close();
  }
});
