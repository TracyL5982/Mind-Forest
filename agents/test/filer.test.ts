import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command, Item } from '../src/core/domain.ts';
import { filer } from '../src/core/roles/filer.ts';
import { kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };

type Placement = { itemId: string; place: 'existing' | 'new'; parentNodeId?: string; treeTitle?: string; joinsItemId?: string; why?: string };

function script(k: Kit, placements: Placement[]): void {
  k.model.on('filer', () => ({
    placements: placements.map((p) => ({ parentNodeId: '', treeTitle: '', joinsItemId: '', why: 'fits here', ...p })),
  }));
}

/** Applies the Filer's commands the way the pipeline does: the new items first, in one change set. */
function file(k: Kit, items: Item[], commands: Command[]): void {
  k.mind.apply({ origin: USER, label: 'file', commands: [...items.map((item) => ({ type: 'addItem' as const, item })), ...commands] });
}

function nodeOf(k: Kit, item: Item) {
  const nodes = k.mind.nodesOfItem(item.id);
  assert.equal(nodes.length, 1, `"${item.title}" is placed exactly once`);
  return nodes[0]!;
}

test('an item that belongs to an existing tree hangs under the node the model named, as kept user content', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom', 'Whip pan']);
  const item = k.item({ title: 'Vertigo effect in Jaws', summary: 'The beach shot that pulls the background in.' });
  script(k, [{ itemId: item.id, place: 'existing', parentNodeId: film.nodeIds[1], why: 'a famous dolly zoom' }]);

  const commands = await filer(k.ctx, [item]);
  file(k, [item], commands);

  const node = nodeOf(k, item);
  assert.equal(node.parent, film.nodeIds[1]);
  assert.equal(node.treeId, film.treeId);
  assert.equal(node.status, 'kept');
  assert.deepEqual(node.origin, item.origin);
  assert.equal(node.why, 'a famous dolly zoom');
  assert.equal(k.mind.trees.size, 1);
  assert.equal(k.mind.inbox().length, 0);
});

test('items from one dump on a new topic form one new tree together', async () => {
  const k = kit();
  k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  const leaf = k.item({ title: 'Feeding schedule' });
  const root = k.item({ title: 'Sourdough starter', summary: 'How to raise a starter from flour and water.' });
  const deep = k.item({ title: 'Rye flour ratio' });
  script(k, [
    { itemId: leaf.id, place: 'new', joinsItemId: root.id },
    { itemId: deep.id, place: 'new', joinsItemId: leaf.id },
    { itemId: root.id, place: 'new', treeTitle: 'Sourdough baking' },
  ]);

  const commands = await filer(k.ctx, [leaf, root, deep]);
  assert.ok(commands.every((c) => c.type !== 'addItem'), 'the pipeline adds the items, not the Filer');
  file(k, [leaf, root, deep], commands);

  assert.equal(k.mind.trees.size, 2);
  const tree = k.mind.tree(nodeOf(k, root).treeId);
  assert.equal(tree.title, 'Sourdough baking');
  assert.equal(tree.digest, 'How to raise a starter from flour and water.');
  assert.equal(tree.rootId, nodeOf(k, root).id);
  assert.equal(nodeOf(k, leaf).parent, nodeOf(k, root).id);
  assert.equal(nodeOf(k, deep).parent, nodeOf(k, leaf).id);
});

test('two new items under one parent get different places among its children', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  const a = k.item({ title: 'Crane shot' });
  const b = k.item({ title: 'Steadicam' });
  script(k, [
    { itemId: a.id, place: 'existing', parentNodeId: film.nodeIds[0] },
    { itemId: b.id, place: 'existing', parentNodeId: film.nodeIds[0] },
  ]);

  file(k, [a, b], await filer(k.ctx, [a, b]));

  const orders = k.mind.children(film.nodeIds[0]!).map((n) => n.order);
  assert.equal(new Set(orders).size, 3);
  assert.deepEqual(k.mind.children(film.nodeIds[0]!).map((n) => k.mind.itemOf(n.id).title), ['Dolly zoom', 'Crane shot', 'Steadicam']);
});

test('chat takeaways hang under the chat they came from, in the same batch or already placed', async () => {
  const k = kit();
  const old = k.seedTree('Old chat', ['Chat about lenses']);
  const oldChatItem = k.mind.node(old.nodeIds[0]!).itemId;
  const chat = k.item({ kind: 'chat', title: 'Chat about colour grading' });
  const takeaway = k.item({ title: 'Teal and orange is a default, not a rule', data: { fromChat: chat.id } });
  const late = k.item({ title: 'Anamorphic flares', data: { fromChat: oldChatItem } });
  // The takeaways are listed first, and the model is only asked about the chat itself.
  k.model.on('filer', (req) => {
    assert.ok(!req.user.includes(takeaway.id) && !req.user.includes(late.id));
    return { placements: [{ itemId: chat.id, place: 'new', parentNodeId: '', treeTitle: 'Colour grading', joinsItemId: '', why: 'new topic' }] };
  });

  const items = [takeaway, late, chat];
  file(k, items, await filer(k.ctx, items));

  assert.equal(nodeOf(k, takeaway).parent, nodeOf(k, chat).id);
  assert.equal(nodeOf(k, late).parent, old.nodeIds[0]);
  assert.equal(k.mind.tree(nodeOf(k, chat).treeId).title, 'Colour grading');
});

test('an answer naming things that do not exist is repaired by search', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom', 'Whip pan']);
  const close = k.item({ title: 'Dolly zoom tutorial' });
  const far = k.item({ title: 'Quarterly tax deadlines for freelancers' });
  const ignored = k.item({ title: 'Whip pan zoom' });
  script(k, [
    { itemId: close.id, place: 'existing', parentNodeId: 'node-that-is-not-there' },
    { itemId: far.id, place: 'new', joinsItemId: 'item-that-is-not-there' },
    { itemId: 'item-nobody-sent', place: 'new', treeTitle: 'Ghost' },
  ]);

  const items = [close, far, ignored];
  file(k, items, await filer(k.ctx, items));

  assert.equal(nodeOf(k, close).parent, film.nodeIds[1], 'two of three title words match "Dolly zoom"');
  const farNode = nodeOf(k, far);
  assert.equal(farNode.parent, null);
  assert.equal(k.mind.tree(farNode.treeId).title, 'Quarterly tax deadlines for freelancers');
  assert.equal(nodeOf(k, ignored).treeId, film.treeId, 'an item the model skipped is still placed');
  assert.equal(k.mind.trees.size, 2);
});

test('a weak match starts a new tree when search has to decide', async () => {
  const k = kit();
  k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  const item = k.item({ title: 'Zoom call etiquette for remote teams' });

  file(k, [item], await filer(k.ctx, [item]));

  assert.equal(nodeOf(k, item).parent, null);
  assert.equal(k.mind.trees.size, 2);
  assert.equal(k.mind.tree(nodeOf(k, item).treeId).title, 'Zoom call etiquette for remote');
});

test('items that join each other in a circle are still all placed', async () => {
  const k = kit();
  const a = k.item({ title: 'Bread scoring patterns' });
  const b = k.item({ title: 'Lame blades' });
  const c = k.item({ title: 'Oven spring' });
  script(k, [
    { itemId: a.id, place: 'new', joinsItemId: b.id },
    { itemId: b.id, place: 'new', joinsItemId: a.id },
    { itemId: c.id, place: 'new', joinsItemId: c.id },
  ]);

  const items = [a, b, c];
  file(k, items, await filer(k.ctx, items));

  for (const item of items) nodeOf(k, item);
  assert.equal(nodeOf(k, a).parent, null);
  assert.equal(nodeOf(k, b).parent, nodeOf(k, a).id, 'one side of the circle is kept');
  assert.equal(k.mind.inbox().length, 0);
});

test('when the model fails every item is still filed, and the run log says so', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  const close = k.item({ title: 'Dolly zoom' });
  const far = k.item({ title: 'Sourdough starter' });
  k.model.on('filer', () => {
    throw new Error('model is down');
  });

  const items = [close, far];
  file(k, items, await filer(k.ctx, items));

  assert.equal(nodeOf(k, close).parent, film.nodeIds[1]);
  assert.equal(nodeOf(k, far).parent, null);
  assert.equal(k.mind.inbox().length, 0);
  assert.match(k.notes.join('\n'), /^filer: .*model is down/);
});

test('the model is shown at most 8 trees and 12 nodes of each', async () => {
  const k = kit();
  for (let t = 0; t < 10; t++) k.seedTree(`Topic ${t}`, Array.from({ length: 15 }, (_, i) => `Topic ${t} note ${i}`));
  const item = k.item({ title: 'Topic 7 note about something' });
  script(k, [{ itemId: item.id, place: 'new', treeTitle: 'Something else' }]);

  await filer(k.ctx, [item]);

  const shown = k.model.calls.find((c) => c.role === 'filer')!.detail;
  assert.equal(shown.match(/^- tree /gm)?.length, 8);
  assert.equal(shown.match(/^ {4}node /gm)?.length, 8 * 12);
  assert.match(shown, /"Topic 7"/, 'the tree the item resembles is on the shortlist');
});

test('no items, no work', async () => {
  const k = kit();
  assert.deepEqual(await filer(k.ctx, []), []);
  assert.equal(k.model.calls.length, 0);
});
