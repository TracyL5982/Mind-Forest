import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command } from '../src/core/domain.ts';
import { organizer } from '../src/core/roles/organizer.ts';
import { makeNode } from '../src/core/roles/types.ts';
import { AGENT, kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };
const ORGANIZER = AGENT('organizer');

type Op = { op: string; nodeId?: string; targetNodeId?: string; treeId?: string; title?: string; text?: string; why?: string };

function script(k: Kit, operations: Op[], summary = 'I tidied it.') {
  k.model.on('organizer', () => ({ operations, summary }));
}

function apply(k: Kit, commands: Command[]) {
  return k.mind.apply({ origin: ORGANIZER, label: 'organize', commands });
}

function titlesUnder(k: Kit, nodeId: string): string[] {
  return k.mind.children(nodeId).map((n) => k.mind.itemOf(n.id).title);
}

function addPick(k: Kit, treeId: string, parent: string, title: string): string {
  const item = { ...k.item({ title }), origin: AGENT('scout') };
  const node = makeNode(k.ctx, item, { treeId, parent, status: 'pick', why: 'related', origin: AGENT('scout') });
  k.mind.apply({ origin: AGENT('scout'), label: 'pick', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
  return node.id;
}

test('a move puts a node, with what is under it, under the target', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Film', 'Techniques', 'Dolly zoom']);
  const [, techniques, dolly] = nodeIds as [string, string, string];
  script(k, [{ op: 'move', nodeId: dolly, targetNodeId: techniques }], 'I moved the dolly zoom under techniques.');

  const out = await organizer(k.ctx, { request: 'move the camera stuff under techniques', scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);

  assert.deepEqual(titlesUnder(k, techniques), ['Dolly zoom']);
  assert.equal(out.summary, 'I moved the dolly zoom under techniques.');
});

test('the model is shown the scope as an outline with ids, depth and status', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Film', 'Techniques']);
  const pick = addPick(k, treeId, nodeIds[1]!, 'Vertigo effect');
  k.seedTree('Cooking', ['Cooking', 'Salt']);
  script(k, []);

  await organizer(k.ctx, { request: 'clean up', scope: { treeIds: [], nodeIds: [] }, focus: nodeIds[1]! });

  const seen = k.model.calls.at(-1)!.detail;
  assert.match(seen, /Request: clean up/);
  assert.ok(seen.includes(`Tree ${treeId} | Film | root ${nodeIds[0]}`));
  assert.ok(seen.includes(`${pick} | 2 | pick | Vertigo effect`));
  assert.ok(!seen.includes('Salt'), 'a focus limits the outline to its tree');
});

test('rename changes a tree title, or an item title when a node is named', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Film', 'Lense']);
  script(k, [
    { op: 'rename', treeId, title: 'Lenses' },
    { op: 'rename', nodeId: nodeIds[1]!, title: 'Lens' },
  ]);

  const out = await organizer(k.ctx, { request: 'rename this tree to Lenses and fix the typo', scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);

  assert.equal(k.mind.tree(treeId).title, 'Lenses');
  assert.equal(k.mind.itemOf(nodeIds[1]!).title, 'Lens');
});

test('a created note is a kept agent note under the target', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Film', 'Techniques']);
  script(k, [{ op: 'create', targetNodeId: nodeIds[1]!, title: 'Ask Sam', text: 'Ask Sam about anamorphic lenses.', why: 'You asked for this note.' }]);

  const out = await organizer(k.ctx, { request: 'add a note here that says ask Sam about anamorphic lenses', scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);

  const [note] = k.mind.children(nodeIds[1]!);
  assert.equal(note!.status, 'kept');
  assert.deepEqual(note!.origin, ORGANIZER);
  assert.equal(k.mind.itemOf(note!.id).text, 'Ask Sam about anamorphic lenses.');
  assert.deepEqual(k.mind.itemOf(note!.id).origin, ORGANIZER);
});

test('grouping creates a note under a label and moves nodes under it', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Film', 'Dolly zoom', 'Whip pan', 'Budget']);
  const [root, dolly, whip, budget] = nodeIds as [string, string, string, string];
  script(k, [
    { op: 'create', nodeId: 'new-1', targetNodeId: root, title: 'Camera moves' },
    { op: 'move', nodeId: dolly, targetNodeId: 'new-1' },
    { op: 'move', nodeId: whip, targetNodeId: 'new-1' },
  ]);

  const out = await organizer(k.ctx, { request: 'group these by theme', scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);

  const group = k.mind.children(root).find((n) => k.mind.itemOf(n.id).title === 'Camera moves')!;
  assert.deepEqual(titlesUnder(k, group.id), ['Dolly zoom', 'Whip pan']);
  assert.equal(k.mind.node(budget).parent, root);
});

test('a delete removes the node and what is under it, and one undo restores the whole result', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Film', 'Duplicate', 'Keep me']);
  const before = k.mind.snapshot();
  script(k, [
    { op: 'delete', nodeId: nodeIds[1]! },
    { op: 'rename', treeId, title: 'Cinema' },
    { op: 'create', targetNodeId: nodeIds[2]!, title: 'A note' },
  ]);

  const out = await organizer(k.ctx, { request: 'delete the duplicate, call it Cinema, add a note', scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);
  assert.equal(k.mind.nodes.has(nodeIds[1]!), false);
  assert.equal(k.mind.tree(treeId).title, 'Cinema');
  assert.equal(k.mind.children(nodeIds[2]!).length, 1);

  k.mind.undo();
  assert.deepEqual({ ...k.mind.snapshot(), seq: 0 }, { ...before, seq: 0 });
});

test('a tree root is deleted only when the whole tree is named', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Film', 'A']);
  const old = k.seedTree('Old', ['Old', 'B']);
  script(k, [
    { op: 'delete', nodeId: film.nodeIds[0]! },
    { op: 'delete', treeId: old.treeId },
  ]);

  const out = await organizer(k.ctx, { request: 'delete the Old tree', scope: { treeIds: [film.treeId, old.treeId], nodeIds: [] } });
  apply(k, out.commands);

  assert.equal(k.mind.trees.has(film.treeId), true);
  assert.equal(k.mind.trees.has(old.treeId), false);
  assert.ok(k.notes.some((n) => /skipped delete/.test(n)));
  assert.match(out.summary, /left out one step/);
});

test('merging moves one tree under a node of another', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Film', 'Techniques']);
  const lenses = k.seedTree('Lenses', ['Lenses', 'Anamorphic']);
  script(k, [{ op: 'mergeTree', treeId: lenses.treeId, targetNodeId: film.nodeIds[1]! }]);

  const out = await organizer(k.ctx, { request: 'merge these two trees', scope: { treeIds: [film.treeId, lenses.treeId], nodeIds: [] } });
  apply(k, out.commands);

  assert.equal(k.mind.trees.has(lenses.treeId), false);
  assert.deepEqual(titlesUnder(k, film.nodeIds[1]!), ['Lenses']);
  assert.equal(k.mind.node(lenses.nodeIds[1]!).treeId, film.treeId);
});

test('splitting a node out makes a new tree with the same item, its children and its links', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Work', ['Work', 'Marketing', 'Product']);
  const [, marketing, product] = nodeIds as [string, string, string];
  const marketingItem = k.mind.node(marketing).itemId;
  const idea = k.item({ title: 'Launch video' });
  const ideaNode = makeNode(k.ctx, idea, { treeId, parent: marketing, status: 'kept', why: '', origin: USER });
  k.mind.apply({
    origin: USER,
    label: 'grow',
    commands: [
      { type: 'addItem', item: idea },
      { type: 'addNode', node: ideaNode },
      { type: 'link', link: { id: 'l1', a: marketing, b: product, why: 'the launch depends on it', strength: 0.9 } },
    ],
  });
  const before = k.mind.snapshot();
  script(k, [
    { op: 'newTree', nodeId: marketing, title: 'Marketing ideas' },
    { op: 'create', targetNodeId: marketing, title: 'Added after the split' },
  ]);

  const out = await organizer(k.ctx, { request: 'split the marketing ideas into their own tree', scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);

  const made = [...k.mind.trees.values()].find((t) => t.title === 'Marketing ideas')!;
  assert.equal(k.mind.node(made.rootId).itemId, marketingItem);
  assert.equal(k.mind.item(marketingItem).archived, false);
  assert.deepEqual(titlesUnder(k, made.rootId), ['Launch video', 'Added after the split']);
  assert.equal(k.mind.node(ideaNode.id).treeId, made.id);
  assert.equal(k.mind.nodes.has(marketing), false);
  assert.deepEqual(titlesUnder(k, nodeIds[0]!), ['Product']);
  const [link] = k.mind.linksOf(made.rootId);
  assert.equal(link?.why, 'the launch depends on it');

  k.mind.undo();
  assert.deepEqual({ ...k.mind.snapshot(), seq: 0 }, { ...before, seq: 0 });
});

test('a new tree can start from a fresh note', async () => {
  const k = kit();
  const { treeId } = k.seedTree('Film', ['Film']);
  script(k, [{ op: 'newTree', title: 'Sound', text: 'Ideas about sound design.' }]);

  const out = await organizer(k.ctx, { request: 'start a tree called Sound', scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);

  const made = [...k.mind.trees.values()].find((t) => t.title === 'Sound')!;
  assert.equal(k.mind.itemOf(made.rootId).text, 'Ideas about sound design.');
});

test('an operation outside the scope is skipped', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Film', 'A']);
  const other = k.seedTree('Cooking', ['Cooking', 'Salt']);
  script(k, [
    { op: 'delete', nodeId: other.nodeIds[1]! },
    { op: 'move', nodeId: film.nodeIds[1]!, targetNodeId: other.nodeIds[0]! },
    { op: 'rename', treeId: other.treeId, title: 'Hacked' },
    { op: 'rename', nodeId: film.nodeIds[1]!, title: 'Alpha' },
  ]);

  const out = await organizer(k.ctx, { request: 'tidy', scope: { treeIds: [film.treeId], nodeIds: [] } });
  apply(k, out.commands);

  assert.equal(k.mind.nodes.has(other.nodeIds[1]!), true);
  assert.equal(k.mind.tree(other.treeId).title, 'Cooking');
  assert.equal(k.mind.node(film.nodeIds[1]!).treeId, film.treeId);
  assert.equal(k.mind.itemOf(film.nodeIds[1]!).title, 'Alpha');
  assert.equal(k.notes.filter((n) => /skipped/.test(n)).length, 3);
});

test('a node scope covers that node and what is under it, and nothing beside it', async () => {
  const k = kit();
  const { nodeIds } = k.seedTree('Film', ['Film', 'A', 'B']);
  script(k, [
    { op: 'rename', nodeId: nodeIds[1]!, title: 'A2' },
    { op: 'rename', nodeId: nodeIds[2]!, title: 'B2' },
  ]);

  const out = await organizer(k.ctx, { request: 'fix the title of this one', scope: { treeIds: [], nodeIds: [nodeIds[1]!] } });
  apply(k, out.commands);

  assert.equal(k.mind.itemOf(nodeIds[1]!).title, 'A2');
  assert.equal(k.mind.itemOf(nodeIds[2]!).title, 'B');
});

test('moving a node under its own descendant is skipped', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Film', 'A', 'B']);
  const [, a, b] = nodeIds as [string, string, string];
  script(k, [
    { op: 'move', nodeId: b, targetNodeId: a },
    { op: 'move', nodeId: a, targetNodeId: b },
    { op: 'move', nodeId: a, targetNodeId: a },
  ]);

  const out = await organizer(k.ctx, { request: 'nest them', scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);

  assert.equal(out.commands.length, 1);
  assert.equal(k.mind.node(b).parent, a);
  assert.equal(k.mind.node(a).parent, nodeIds[0]);
});

test('a node deleted earlier cannot be moved or edited later', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Film', 'A', 'B']);
  const [, a, b] = nodeIds as [string, string, string];
  const child = k.item({ title: 'under A' });
  const childNode = makeNode(k.ctx, child, { treeId, parent: a, status: 'kept', why: '', origin: USER });
  k.mind.apply({ origin: USER, label: 'grow', commands: [{ type: 'addItem', item: child }, { type: 'addNode', node: childNode }] });
  script(k, [
    { op: 'delete', nodeId: a },
    { op: 'move', nodeId: a, targetNodeId: b },
    { op: 'move', nodeId: childNode.id, targetNodeId: b },
    { op: 'create', targetNodeId: a, title: 'orphan' },
  ]);

  const out = await organizer(k.ctx, { request: 'delete A', scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);

  assert.deepEqual(out.commands, [{ type: 'deleteNode', id: a }]);
  assert.equal(k.mind.nodes.has(childNode.id), false);
});

test('dropping picks deletes unkept picks and leaves kept content alone', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Film', 'A']);
  const p1 = addPick(k, treeId, nodeIds[1]!, 'pick one');
  const p2 = addPick(k, treeId, p1, 'pick under pick');
  const p3 = addPick(k, treeId, nodeIds[0]!, 'pick the user keeps');
  script(k, [{ op: 'keep', nodeId: p3 }, { op: 'dropPicks' }]);

  const out = await organizer(k.ctx, { request: "keep that one and drop everything I haven't kept", scope: { treeIds: [treeId], nodeIds: [] } });
  apply(k, out.commands);

  assert.equal(k.mind.nodes.has(p1), false);
  assert.equal(k.mind.nodes.has(p2), false);
  assert.equal(k.mind.node(p3).status, 'kept');
  assert.equal(k.mind.nodes.has(nodeIds[1]!), true);
});

test('with no scope and no focus only whole-tree changes go through', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Film', 'A']);
  const lenses = k.seedTree('Lenses', ['Lenses', 'B']);
  script(k, [
    { op: 'delete', nodeId: film.nodeIds[1]! },
    { op: 'rename', nodeId: film.nodeIds[1]!, title: 'x' },
    { op: 'mergeTree', treeId: lenses.treeId, targetNodeId: film.nodeIds[0]! },
    { op: 'rename', treeId: film.treeId, title: 'Cinema' },
  ]);

  const out = await organizer(k.ctx, { request: 'merge these two trees and call it Cinema', scope: { treeIds: [], nodeIds: [] } });
  apply(k, out.commands);

  assert.equal(k.mind.trees.size, 1);
  assert.equal(k.mind.tree(film.treeId).title, 'Cinema');
  assert.equal(k.mind.itemOf(film.nodeIds[1]!).title, 'A');
});

test('a model failure changes nothing and says so', async () => {
  const k = kit();
  const { treeId } = k.seedTree('Film', ['Film', 'A']);
  k.model.on('organizer', () => {
    throw new Error('model down');
  });

  const out = await organizer(k.ctx, { request: 'clean up', scope: { treeIds: [treeId], nodeIds: [] } });

  assert.deepEqual(out.commands, []);
  assert.match(out.summary, /^Nothing was changed/);
  assert.ok(k.notes.some((n) => /organizer: the model failed/.test(n)));
});

test('when every operation is invalid nothing changes and the summary says why', async () => {
  const k = kit();
  const { treeId } = k.seedTree('Film', ['Film', 'A']);
  script(k, [{ op: 'delete', nodeId: 'no-such-node' }], 'I deleted it.');

  const out = await organizer(k.ctx, { request: 'delete that', scope: { treeIds: [treeId], nodeIds: [] } });

  assert.deepEqual(out.commands, []);
  assert.match(out.summary, /^Nothing was changed/);
});
