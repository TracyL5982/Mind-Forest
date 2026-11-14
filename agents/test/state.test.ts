import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommandError } from '../src/core/domain.ts';
import { makeNode } from '../src/core/roles/types.ts';
import { Mindstorm } from '../src/core/state.ts';
import { kit } from './kit.ts';

const USER = { by: 'user' as const };

test('a seeded tree is searchable and has no inbox', () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase', 'Jaws beach scene']);
  assert.equal(k.mind.treeNodes(treeId).length, 3);
  assert.equal(k.mind.search('vertigo')[0]?.item.title, 'Vertigo staircase');
  assert.equal(k.mind.inbox().length, 0);
  assert.equal(k.mind.depth(nodeIds[1]!), 1);
});

test('a failed command leaves nothing behind', () => {
  const k = kit();
  const item = k.item({ title: 'orphan' });
  assert.throws(
    () =>
      k.mind.apply({
        origin: USER,
        label: 'bad',
        commands: [
          { type: 'addItem', item },
          { type: 'deleteNode', id: 'nope' },
        ],
      }),
    CommandError,
  );
  assert.equal(k.mind.items.size, 0);
  assert.equal(k.mind.seq, 0);
});

test('deleting a node removes its subtree, archives its items, and undo restores all of it', () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Root', 'A', 'B']);
  const [root, a, b] = nodeIds as [string, string, string];
  const leaf = k.item({ title: 'under A' });
  const leafNode = makeNode(k.ctx, leaf, { treeId, parent: a, status: 'pick', why: 'x', origin: USER });
  k.mind.apply({
    origin: USER,
    label: 'grow',
    commands: [
      { type: 'addItem', item: leaf },
      { type: 'addNode', node: leafNode },
      { type: 'link', link: { id: 'l1', a: leafNode.id, b, why: 'same idea', strength: 0.9 } },
      { type: 'setGroup', group: { id: 'g1', treeId, anchor: root, composite: 'comparison', title: '', members: [a, b], props: { criteria: [], cells: {} } } },
    ],
  });
  const before = k.mind.snapshot();

  k.mind.apply({ origin: USER, label: 'delete A', commands: [{ type: 'deleteNode', id: a }] });
  assert.equal(k.mind.nodes.has(a), false);
  assert.equal(k.mind.nodes.has(leafNode.id), false);
  assert.equal(k.mind.links.size, 0);
  assert.equal(k.mind.groups.size, 0, 'a group left with one member goes');
  assert.equal(k.mind.item(leaf.id).archived, true);
  assert.equal(k.mind.search('under').length, 0, 'archived items leave the index');

  k.mind.undo();
  const after = k.mind.snapshot();
  assert.deepEqual({ ...after, seq: 0 }, { ...before, seq: 0 });
  assert.equal(k.mind.search('under').length, 1);
});

test('undo refuses when something changed since', () => {
  const k = kit();
  const { nodeIds } = k.seedTree('Film', ['Root', 'A']);
  const itemId = k.mind.node(nodeIds[1]!).itemId;
  const first = k.mind.apply({ origin: USER, label: 'edit 1', commands: [{ type: 'editItem', id: itemId, patch: { title: 'A1' } }] });
  k.mind.apply({ origin: USER, label: 'edit 2', commands: [{ type: 'editItem', id: itemId, patch: { title: 'A2' } }] });
  assert.throws(() => k.mind.undo(first.id), /changed since/);
  assert.throws(
    () => k.mind.apply({ origin: USER, label: 'stale', commands: [{ type: 'editItem', id: itemId, patch: { title: 'x' }, expectRevision: 0 }] }),
    /revision/,
  );
});

test('keeping a pick keeps the picks above it', () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Root']);
  const p1 = k.item({ title: 'p1' });
  const n1 = makeNode(k.ctx, p1, { treeId, parent: nodeIds[0]!, status: 'pick', why: '', origin: USER });
  const p2 = k.item({ title: 'p2' });
  k.mind.apply({ origin: USER, label: 'p1', commands: [{ type: 'addItem', item: p1 }, { type: 'addNode', node: n1 }] });
  const n2 = makeNode(k.ctx, p2, { treeId, parent: n1.id, status: 'pick', why: '', origin: USER });
  k.mind.apply({ origin: USER, label: 'p2', commands: [{ type: 'addItem', item: p2 }, { type: 'addNode', node: n2 }] });
  k.mind.apply({ origin: USER, label: 'keep', commands: [{ type: 'keepPick', id: n2.id }] });
  assert.equal(k.mind.node(n1.id).status, 'kept');
  assert.equal(k.mind.picks(nodeIds[0]!).length, 0);
});

test('moving a root into another tree merges the trees', () => {
  const k = kit();
  const a = k.seedTree('A', ['a-root', 'a-child']);
  const b = k.seedTree('B', ['b-root']);
  k.mind.apply({ origin: USER, label: 'merge', commands: [{ type: 'moveNode', id: a.nodeIds[0]!, parent: b.nodeIds[0]! }] });
  assert.equal(k.mind.trees.size, 1);
  assert.equal(k.mind.treeNodes(b.treeId).length, 3);
  assert.equal(k.mind.node(a.nodeIds[1]!).treeId, b.treeId);
  assert.throws(
    () => k.mind.apply({ origin: USER, label: 'loop', commands: [{ type: 'moveNode', id: b.nodeIds[0]!, parent: a.nodeIds[1]! }] }),
    /under itself/,
  );
});

test('replaying stored change sets rebuilds the same state', () => {
  const k = kit();
  const { nodeIds } = k.seedTree('Film', ['Root', 'A', 'B']);
  k.mind.apply({ origin: USER, label: 'delete', commands: [{ type: 'deleteNode', id: nodeIds[1]! }] });
  k.mind.undo();
  const copy = new Mindstorm({ now: () => '', newId: () => 'x' });
  copy.load(k.mind.changes());
  assert.deepEqual(copy.snapshot(), k.mind.snapshot());
  assert.equal(copy.search('root').length, 1);
  assert.throws(() => copy.undo(k.mind.changes()[3]!.id), /already undone/);
});

test('the service refuses a group that mixes picks with kept cards, is of no known kind, has the wrong number of members or takes a node from another group', () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Root']);
  const root = nodeIds[0]!;
  const ids = Array.from({ length: 6 }, (_, i) => {
    const item = k.item({ title: `card ${i}` });
    const node = makeNode(k.ctx, item, { treeId, parent: root, status: i < 5 ? 'kept' : 'pick', why: '', origin: USER });
    k.mind.apply({ origin: USER, label: 'add', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
    return node.id;
  });
  const group = (id: string, composite: string, members: string[], props: Record<string, unknown> = {}) => () =>
    k.mind.apply({ origin: USER, label: 'group', commands: [{ type: 'setGroup', group: { id, treeId, anchor: root, composite, title: '', members, props } }] });
  assert.throws(group('g', 'cluster', [ids[3]!, ids[4]!, ids[5]!]), /picks or kept cards, never both/);
  assert.throws(group('g', 'heap', ids.slice(0, 3)), /no composite is called heap/);
  assert.throws(group('g', 'cluster', ids.slice(0, 2)), /a cluster holds at least 3 members, not 2/);
  assert.throws(group('g', 'beforeafter', ids.slice(0, 5), { changes: {} }), /a beforeafter holds 2 to 4 members, not 5/);
  assert.throws(group('g', 'matrix', ids.slice(0, 3), { x: 'Cost', y: 'Reach', reasons: {} }), /a matrix holds 4 members, not 3/);
  assert.throws(group('g', 'matrix', ids.slice(0, 4), { x: '', y: 'Reach', reasons: {} }), /props of a matrix/);
  group('g1', 'sequence', ids.slice(0, 3))();
  assert.throws(group('g2', 'cluster', ids.slice(2, 5)), new RegExp(`node ${ids[2]} is already in group g1`));
  group('g1', 'sequence', ids.slice(1, 4))();
  assert.deepEqual(k.mind.groups.get('g1')!.members, ids.slice(1, 4), 'a group may be set again under its own id');
  group('g3', 'beforeafter', [ids[0]!, ids[4]!], { changes: { [ids[4]!]: 'Recut' } })();
  assert.equal(k.mind.groups.size, 2);
});
