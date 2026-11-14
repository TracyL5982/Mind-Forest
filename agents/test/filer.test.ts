import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command, Item } from '../src/core/domain.ts';
import { filer } from '../src/core/roles/filer.ts';
import { makeNode } from '../src/core/roles/types.ts';
import { kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };

type Placement = { itemId: string; parentNodeId?: string; strength?: number; why?: string };

function script(k: Kit, placements: Placement[]): void {
  k.model.on('filer', () => ({
    placements: placements.map((p) => ({ parentNodeId: '', strength: 0.9, why: 'fits here', ...p })),
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

test('an item with a strong fit hangs under the card the model named, as a dashed pick that holds what was dropped', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom', 'Whip pan']);
  const item = k.item({ title: 'Vertigo effect in Jaws', summary: 'The beach shot that pulls the background in.' });
  script(k, [{ itemId: item.id, parentNodeId: film.nodeIds[1], why: 'a famous dolly zoom' }]);

  const commands = await filer(k.ctx, [item]);
  file(k, [item], commands);

  const node = nodeOf(k, item);
  assert.deepEqual([node.parent, node.treeId, node.status, node.why], [film.nodeIds[1], film.treeId, 'pick', 'a famous dolly zoom']);
  assert.deepEqual(node.origin, { by: 'agent', role: 'filer', tool: 'mindstorm' });
  assert.equal(k.mind.trees.size, 1, 'no tree was started');
});

test('a fit the model rates weak, or no fit at all, leaves the item in the knowledge base and starts no tree', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  const weak = k.item({ title: 'Zoom call etiquette for remote teams' });
  const none = k.item({ title: 'Sourdough starter' });
  script(k, [
    { itemId: weak.id, parentNodeId: film.nodeIds[1], strength: 0.6 },
    { itemId: none.id, parentNodeId: '', strength: 0 },
  ]);

  file(k, [weak, none], await filer(k.ctx, [weak, none]));

  assert.equal(k.mind.trees.size, 1);
  assert.deepEqual(k.mind.unplaced().map((i) => i.title).sort(), [none.title, weak.title].sort());
});

test('with no trees to place under, the model is not asked and nothing is placed', async () => {
  const k = kit();
  const item = k.item({ title: 'Sourdough starter' });

  assert.deepEqual(await filer(k.ctx, [item]), []);
  assert.equal(k.model.calls.length, 0);
});

test('asked for a tree, the drop becomes one of kept cards, with no model: the first item the root, a takeaway under its chat, the rest under the root', async () => {
  const k = kit();
  k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  const chat = k.item({ kind: 'chat', title: 'Chat about colour grading' });
  const takeaway = k.item({ title: 'Teal and orange is a default, not a rule', data: { fromChat: chat.id } });
  const note = k.item({ title: 'Grade for the skin first' });

  const items = [takeaway, chat, note];
  file(k, items, await filer(k.ctx, items, { title: 'colour grading' }));

  const root = nodeOf(k, chat);
  const tree = k.mind.tree(root.treeId);
  assert.deepEqual([tree.title, tree.rootId, root.parent], ['Colour grading', root.id, null]);
  assert.equal(nodeOf(k, takeaway).parent, root.id);
  assert.equal(nodeOf(k, note).parent, root.id);
  assert.ok([root, nodeOf(k, takeaway), nodeOf(k, note)].every((n) => n.status === 'kept' && n.origin.by === 'user'));
  assert.equal(k.model.calls.length, 0);
});

test('a tree asked for with no name is named after its root', async () => {
  const k = kit();
  const item = k.item({ title: 'the dolly zoom makes dread out of geometry' });

  file(k, [item], await filer(k.ctx, [item], { title: '' }));

  assert.equal(k.mind.tree(nodeOf(k, item).treeId).title, 'The dolly zoom makes dread');
});

test('two new items under one card get different places among its children', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  const a = k.item({ title: 'Crane shot' });
  const b = k.item({ title: 'Steadicam' });
  script(k, [
    { itemId: a.id, parentNodeId: film.nodeIds[0] },
    { itemId: b.id, parentNodeId: film.nodeIds[0] },
  ]);

  file(k, [a, b], await filer(k.ctx, [a, b]));

  const orders = k.mind.children(film.nodeIds[0]!).map((n) => n.order);
  assert.equal(new Set(orders).size, 3);
  assert.deepEqual(k.mind.children(film.nodeIds[0]!).map((n) => k.mind.itemOf(n.id).title), ['Dolly zoom', 'Crane shot', 'Steadicam']);
});

test('a chat takeaway goes where its chat goes: under the chat a tree holds, under the chat placed with it, nowhere with a chat placed nowhere', async () => {
  const k = kit();
  const old = k.seedTree('Old chat', ['Chat about lenses', 'Lens notes']);
  const oldChatItem = k.mind.node(old.nodeIds[0]!).itemId;
  const placedChat = k.item({ kind: 'chat', title: 'Chat about anamorphic lenses' });
  const loneChat = k.item({ kind: 'chat', title: 'Chat about colour grading' });
  const late = k.item({ title: 'Anamorphic flares', data: { fromChat: oldChatItem } });
  const withPlaced = k.item({ title: 'Oval bokeh', data: { fromChat: placedChat.id } });
  const withLone = k.item({ title: 'Teal and orange is a default, not a rule', data: { fromChat: loneChat.id } });
  k.model.on('filer', (req) => {
    assert.ok(![late, withPlaced, withLone].some((i) => req.user.includes(i.id)), 'the model is only asked about the chats');
    return { placements: [{ itemId: placedChat.id, parentNodeId: old.nodeIds[1]!, strength: 0.9, why: 'more on lenses' }, { itemId: loneChat.id, parentNodeId: '', strength: 0, why: '' }] };
  });

  const items = [late, withPlaced, withLone, placedChat, loneChat];
  file(k, items, await filer(k.ctx, items));

  assert.equal(nodeOf(k, late).parent, old.nodeIds[0]);
  assert.equal(nodeOf(k, withPlaced).parent, nodeOf(k, placedChat).id);
  assert.equal(nodeOf(k, withPlaced).status, 'pick');
  assert.deepEqual(k.mind.unplaced().map((i) => i.title).sort(), [loneChat.title, withLone.title].sort());
});

test('an answer naming a card that does not exist, or a pick rather than a card, places nothing', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  const suggestion = k.item({ title: 'A suggestion', origin: { by: 'agent', role: 'scout' } });
  const pick = makeNode(k.ctx, suggestion, { treeId: film.treeId, parent: film.nodeIds[0]!, status: 'pick', why: '', origin: { by: 'agent', role: 'scout' } });
  k.mind.apply({ origin: USER, label: 'pick', commands: [{ type: 'addItem', item: suggestion }, { type: 'addNode', node: pick }] });
  const ghost = k.item({ title: 'Dolly zoom tutorial' });
  const onPick = k.item({ title: 'More on the suggestion' });
  script(k, [
    { itemId: ghost.id, parentNodeId: 'node-that-is-not-there' },
    { itemId: onPick.id, parentNodeId: pick.id },
    { itemId: 'item-nobody-sent', parentNodeId: film.nodeIds[0] },
  ]);

  const items = [ghost, onPick];
  file(k, items, await filer(k.ctx, items));

  assert.equal(k.mind.unplaced().length, 2);
});

test('when the model fails nothing is placed, and the run log says so', async () => {
  const k = kit();
  k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  const close = k.item({ title: 'Dolly zoom' });
  k.model.on('filer', () => {
    throw new Error('model is down');
  });

  file(k, [close], await filer(k.ctx, [close]));

  assert.deepEqual(k.mind.unplaced(), [k.mind.item(close.id)]);
  assert.match(k.notes.join('\n'), /^filer: .*model is down.*knowledge base/);
});

test('the model is shown at most 8 trees and 12 nodes of each', async () => {
  const k = kit();
  for (let t = 0; t < 10; t++) k.seedTree(`Topic ${t}`, Array.from({ length: 15 }, (_, i) => `Topic ${t} note ${i}`));
  const item = k.item({ title: 'Topic 7 note about something' });
  script(k, [{ itemId: item.id }]);

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

test('the cards a dump is offered are the trees\' own, even when items of the library match it better', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom shots']);
  for (let n = 0; n < 6; n++) {
    const film = k.item({ title: 'Dolly zoom', text: 'dolly zoom', kind: 'video', source: { from: 'library', capturedAt: '' }, data: { library: { kind: 'film', key: n } } });
    k.mind.apply({ origin: USER, label: 'library', commands: [{ type: 'addItem', item: film }] });
  }
  const dropped = k.item({ title: 'Dolly zoom' });
  script(k, [{ itemId: dropped.id, parentNodeId: film.nodeIds[1] }]);

  file(k, [dropped], await filer(k.ctx, [dropped]));

  assert.match(k.model.calls[0]!.detail, new RegExp(`node ${film.nodeIds[1]} .*Dolly zoom shots`));
  assert.equal(nodeOf(k, dropped).parent, film.nodeIds[1]);
});
