import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command, Group, Id, Item, Node, View } from '../src/core/domain.ts';
import { renderer, type ComponentsReply, type CompositesReply } from '../src/core/roles/renderer.ts';
import { makeNode } from '../src/core/roles/types.ts';
import { isValidGroup, isValidView } from '../src/core/views.ts';
import { kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };
const LONG = 'A plain paragraph about how the camera moves through the house, long enough to be worth a second look.';

type Fields = Partial<Item> & { title: string } & { status?: Node['status']; why?: string; importance?: number };

/** A tree with a root and one child per entry. Returns the root id and the child ids in order. */
function grow(k: Kit, children: Fields[]): { treeId: Id; root: Id; ids: Id[] } {
  const { treeId, nodeIds } = k.seedTree('Tree', ['Root']);
  const root = nodeIds[0]!;
  return { treeId, root, ids: children.map((fields) => hang(k, treeId, root, fields)) };
}

function hang(k: Kit, treeId: Id, parent: Id, { status = 'kept', why = '', importance, ...fields }: Fields): Id {
  const item = k.item({ text: '', ...fields });
  const node = makeNode(k.ctx, item, { treeId, parent, status, why, importance, origin: USER });
  k.mind.apply({ origin: USER, label: 'hang', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
  return node.id;
}

/** Runs the Renderer, checks every command against the libraries, and applies them. */
async function render(k: Kit, nodeIds: Id[]): Promise<Command[]> {
  const commands = await renderer(k.ctx, { nodeIds });
  for (const c of commands) {
    if (c.type === 'setView') {
      assert.equal(c.view.by, 'renderer');
      assert.ok(isValidView(c.view), `invalid ${c.view.component} view`);
    } else if (c.type === 'setGroup') {
      assert.ok(isValidGroup(c.group), `invalid ${c.group.composite} group`);
    } else {
      assert.equal(c.type, 'removeGroup');
    }
  }
  if (commands.length > 0) k.mind.apply({ origin: { by: 'agent', role: 'renderer' }, label: 'render', commands });
  return commands;
}

const view = (k: Kit, id: Id): View => k.mind.node(id).view;
const groups = (k: Kit): Group[] => [...k.mind.groups.values()];

function entry(fields: Partial<ComponentsReply['items'][number]> & { id: Id }): ComponentsReply['items'][number] {
  return {
    component: 'note',
    quoteText: '',
    quoteBy: '',
    factValue: '',
    factLabel: '',
    steps: [],
    chartLabels: [],
    chartValues: [],
    chartUnit: '',
    emphasis: '',
    ...fields,
  };
}

function proposal(fields: Partial<CompositesReply['groups'][number]> & { parent: Id; members: Id[] }): CompositesReply['groups'][number] {
  return { composite: 'cluster', title: '', labels: [], criteria: [], cells: [], theme: '', ...fields };
}

test('structured data picks the component without asking the model', async () => {
  const k = kit();
  const { ids } = grow(k, [
    { title: 'Sales', data: { chart: { labels: ['North', 'South'], values: [4, 9], unit: 'units' } } },
    { title: 'Revenue', data: { chart: { labels: ['2022', '2023', '2024'], values: [1, 2, 4] } } },
    { title: 'Recipe', data: { steps: ['Boil water', 'Add pasta'] } },
    { title: 'Kay', data: { quote: { text: 'Invent the future.', by: 'Alan Kay' } } },
    { title: 'Director', data: { person: { name: 'Agnès Varda', role: 'Director' } } },
    { title: 'Snippet', data: { code: { language: 'ts', source: 'const a = 1;' } } },
    { title: 'Script', kind: 'code', text: 'print(1)' },
    { title: 'Churn', data: { facts: [{ label: 'Monthly churn', value: 4.2 }] } },
    { title: 'Stat', text: '42% of users leave in month one.' },
    { title: 'Budget', text: 'Budget: $1.2M' },
  ]);
  const [bar, line, steps, quote, person, code, script, fact, valueFirst, labelFirst] = ids as [Id, Id, Id, Id, Id, Id, Id, Id, Id, Id];
  k.model.on('renderer.composites', () => ({ groups: [] }));
  await render(k, ids);

  assert.deepEqual(view(k, bar).props, { chart: 'bar', labels: ['North', 'South'], values: [4, 9], unit: 'units' });
  assert.equal(view(k, line).props.chart, 'line', 'years in order read as a line');
  assert.deepEqual(view(k, steps), { component: 'steps', props: { steps: ['Boil water', 'Add pasta'] }, by: 'renderer' });
  assert.deepEqual(view(k, quote).props, { text: 'Invent the future.', by: 'Alan Kay' });
  assert.deepEqual(view(k, person), { component: 'person', props: { name: 'Agnès Varda', role: 'Director' }, by: 'renderer' });
  assert.deepEqual(view(k, code).props, { language: 'ts', source: 'const a = 1;' });
  assert.equal(view(k, script).component, 'code');
  assert.deepEqual(view(k, fact), { component: 'fact', props: { value: '4.2', label: 'Monthly churn' }, by: 'renderer' });
  assert.deepEqual(view(k, valueFirst).props, { value: '42%', label: 'of users leave in month one' });
  assert.deepEqual(view(k, labelFirst).props, { value: '$1.2M', label: 'Budget' });
  assert.equal(k.model.calls.filter((c) => c.role === 'renderer.components').length, 0);
});

test('a title that merely starts with a number stays a note', async () => {
  const k = kit();
  const { ids } = grow(k, [{ title: '12 Angry Men', text: '12 Angry Men' }, { title: 'Chapter 3', text: 'Chapter 3' }]);
  assert.deepEqual(await render(k, ids), []);
  assert.equal(view(k, ids[0]!).component, 'note');
});

test('media, links and chats are drawn from where their content lives', async () => {
  const k = kit();
  const chat = [
    { role: 'system', text: 'Be brief.' },
    { role: 'user', text: 'How does a dolly zoom work?' },
    { role: 'assistant', text: 'Sure.' },
    { role: 'user', text: 'Go deeper.' },
    { role: 'assistant', text: 'x'.repeat(400) },
    { role: 'user', text: 'Thanks' },
  ];
  const { ids } = grow(k, [
    { title: 'Photo', kind: 'image', summary: 'A staircase from above', source: { from: 'drop', asset: 'a1', capturedAt: '' } },
    {
      title: 'Reel',
      kind: 'video',
      summary: 's'.repeat(200),
      data: { mediaUrl: 'https://cdn.example/reel.mp4', thumbnailUrl: 'https://cdn.example/reel.jpg' },
      source: { from: 'instagram', url: 'https://instagram.com/p/1', capturedAt: '' },
    },
    { title: 'Lost photo', kind: 'image' },
    {
      title: 'Article',
      kind: 'link',
      summary: 'On vertigo',
      data: { image: 'https://example.com/og.png' },
      source: { from: 'paste', url: 'https://www.example.com/a', capturedAt: '' },
    },
    { title: 'Talk', kind: 'chat', data: { messages: chat }, source: { from: 'chat-export:claude', capturedAt: '' } },
  ]);
  const [photo, reel, lost, article, talk] = ids as [Id, Id, Id, Id, Id];
  await render(k, ids);

  assert.deepEqual(view(k, photo).props, { src: '/assets/a1', caption: 'A staircase from above' });
  assert.deepEqual(view(k, reel).props, { src: 'https://cdn.example/reel.mp4', poster: 'https://cdn.example/reel.jpg' });
  assert.equal(view(k, lost).component, 'note');
  assert.deepEqual(view(k, article).props, {
    url: 'https://www.example.com/a',
    site: 'example.com',
    description: 'On vertigo',
    image: 'https://example.com/og.png',
  });
  const shown = view(k, talk).props as { messages: { role: string; text: string }[]; source: string };
  assert.deepEqual(
    shown.messages.map((m) => m.role),
    ['user', 'user', 'assistant'],
  );
  assert.equal(shown.messages[0]!.text, 'How does a dolly zoom work?');
  assert.equal(shown.messages[2]!.text.length, 280);
  assert.equal(shown.source, 'claude');
});

test('the model upgrades a text item to a quote that is in its text', async () => {
  const k = kit();
  const text = 'Somebody once told me that “the best way to predict\nthe future is to invent it”, which Alan Kay said in 1971.';
  const { ids } = grow(k, [{ title: 'On the future', text }, { title: 'Plain', text: LONG }]);
  k.model.on('renderer.components', () => ({
    items: [
      entry({ id: ids[0]!, component: 'quote', quoteText: '"the best way to predict the future is to invent it"', quoteBy: 'Alan Kay' }),
      entry({ id: ids[1]!, component: 'note', emphasis: 'the camera moves through the house' }),
      entry({ id: 'nobody', component: 'fact', factValue: '1', factLabel: 'x' }),
    ],
  }));
  const commands = await render(k, ids);

  assert.deepEqual(view(k, ids[0]!), {
    component: 'quote',
    props: { text: 'the best way to predict the future is to invent it', by: 'Alan Kay' },
    by: 'renderer',
  });
  assert.deepEqual(view(k, ids[1]!).props, { emphasis: 'the camera moves through the house' });
  assert.equal(commands.length, 2);
  assert.match(k.model.calls[0]!.detail, new RegExp(`id: ${ids[0]}`));

  assert.deepEqual(await render(k, ids), [], 'a second pass changes nothing');
  assert.equal(k.model.calls.length, 1, 'and does not ask again about a choice that still stands');
});

test('a quote, a fact, steps or a chart the text does not hold is refused', async () => {
  const k = kit();
  const { ids } = grow(k, [
    { title: 'A', text: LONG },
    { title: 'B', text: `${LONG} We shipped 12 builds in March and 30 in April.` },
    { title: 'C', text: `${LONG} Roughly a third of them failed.` },
    { title: 'D', text: `${LONG} First scout the house. Then light it.` },
  ]);
  k.model.on('renderer.components', () => ({
    items: [
      entry({ id: ids[0]!, component: 'quote', quoteText: 'Cinema is truth at 24 frames a second', quoteBy: 'Godard' }),
      entry({ id: ids[1]!, component: 'chart', chartLabels: ['March', 'April', 'May'], chartValues: [12, 30, 45] }),
      entry({ id: ids[2]!, component: 'fact', factValue: '33%', factLabel: 'Failure rate' }),
      entry({ id: ids[3]!, component: 'steps', steps: ['scout the house', 'light it', 'shoot it'] }),
    ],
  }));
  assert.deepEqual(await render(k, ids), []);
  for (const id of ids) assert.deepEqual(view(k, id), { component: 'note', props: {}, by: 'default' });
});

test('a chart and steps taken from the text are accepted', async () => {
  const k = kit();
  const { ids } = grow(k, [
    { title: 'Builds', text: 'We shipped 1,200 builds in March and 3,050 builds in April.' },
    { title: 'Shoot', text: 'How we do it:\n1. Scout the house\n2. Light it\n3. Shoot at dusk' },
  ]);
  k.model.on('renderer.components', () => ({
    items: [
      entry({ id: ids[0]!, component: 'chart', chartLabels: ['March', 'April'], chartValues: [1200, 3050], chartUnit: 'builds' }),
      entry({ id: ids[1]!, component: 'steps', steps: ['Scout the house', 'Light it', 'Shoot at dusk'] }),
    ],
  }));
  await render(k, ids);
  assert.deepEqual(view(k, ids[0]!).props, { chart: 'bar', labels: ['March', 'April'], values: [1200, 3050], unit: 'builds' });
  assert.deepEqual(view(k, ids[1]!).props, { steps: ['Scout the house', 'Light it', 'Shoot at dusk'] });
});

test('three image siblings become a gallery, and an identical gallery is left alone', async () => {
  const k = kit();
  const image = (title: string): Fields => ({ title, kind: 'image', source: { from: 'drop', asset: title, capturedAt: '' } });
  const { treeId, root, ids } = grow(k, [image('a'), image('b'), image('c'), { title: 'A note' }]);
  await render(k, [ids[0]!]);

  assert.equal(groups(k).length, 1);
  const gallery = groups(k)[0]!;
  assert.equal(gallery.composite, 'gallery');
  assert.equal(gallery.anchor, root);
  assert.deepEqual(gallery.members, ids.slice(0, 3));

  assert.deepEqual(await render(k, ids), [], 'nothing to change');
  assert.equal(groups(k)[0]!.id, gallery.id);

  const fourth = hang(k, treeId, root, image('d'));
  const commands = await render(k, [fourth]);
  assert.deepEqual(
    commands.map((c) => c.type),
    ['removeGroup', 'setGroup'],
    'a new picture replaces the gallery',
  );
  assert.equal(groups(k).length, 1);
  assert.deepEqual(groups(k)[0]!.members, [...ids.slice(0, 3), fourth]);
});

test('dated siblings become a timeline in date order', async () => {
  const k = kit();
  const { ids } = grow(k, [
    { title: 'Jaws', data: { when: '1975' } },
    { title: 'Vertigo', data: { when: '1958' } },
    { title: 'Goodfellas', data: { when: '1990' } },
  ]);
  await render(k, ids);
  const timeline = groups(k)[0]!;
  assert.equal(timeline.composite, 'timeline');
  assert.deepEqual(timeline.members, [ids[1], ids[0], ids[2]]);
  assert.deepEqual(timeline.props, { labels: { [ids[0]!]: '1975', [ids[1]!]: '1958', [ids[2]!]: '1990' } });
});

test('a comparison of three picks is returned, and a group that mixes kept nodes with picks is not', async () => {
  const k = kit();
  const pick = (title: string, summary: string): Fields => ({ title, summary, status: 'pick', why: `An alternative to the dolly zoom` });
  const { root, ids } = grow(k, [
    { title: 'Kept one', summary: 'Already here' },
    { title: 'Kept two', summary: 'Already here' },
    pick('Crash zoom', 'Fast and cheap. Needs a zoom lens. Used since 1960.'),
    pick('Whip pan', 'Free with any lens. Disorienting.'),
    pick('Rack focus', 'Subtle. Needs a focus puller.'),
  ]);
  const [kept1, kept2, p1, p2, p3] = ids as [Id, Id, Id, Id, Id];
  k.model.on('renderer.composites', () => ({
    groups: [
      proposal({ parent: root, composite: 'cluster', theme: 'Mixed bag', members: [kept1, kept2, p1] }),
      proposal({
        parent: root,
        composite: 'comparison',
        title: 'Ways to pull focus',
        members: [p1, p2, p3],
        criteria: ['Cost', 'Gear'],
        cells: [
          { member: p1, values: ['Cheap', 'Zoom lens, 3 crew'] },
          { member: p2, values: ['Free', 'Any lens'] },
          { member: p3, values: ['', 'Focus puller'] },
        ],
      }),
      proposal({ parent: root, composite: 'sequence', members: [p1, p2, p3] }),
    ],
  }));
  await render(k, [p1, p2, p3]);

  assert.equal(groups(k).length, 1);
  const comparison = groups(k)[0]!;
  assert.equal(comparison.composite, 'comparison');
  assert.equal(comparison.title, 'Ways to pull focus');
  assert.deepEqual(comparison.members, [p1, p2, p3]);
  assert.deepEqual(comparison.props, {
    criteria: ['Cost', 'Gear'],
    cells: { [p1]: ['Cheap', ''], [p2]: ['Free', 'Any lens'], [p3]: ['', 'Focus puller'] },
  });
  assert.ok(comparison.members.every((id) => k.mind.node(id).status === 'pick'));
  const prompt = k.model.calls.find((c) => c.role === 'renderer.composites')!.detail;
  assert.ok(!prompt.includes(`- ${kept1} |`), 'kept siblings that did not change are not sent');

  assert.deepEqual(await render(k, ids), [], 'the group already covers its members');
  assert.equal(k.model.calls.filter((c) => c.role === 'renderer.composites').length, 1);
});

test('a kept pick dissolves the group it leaves mixed', async () => {
  const k = kit();
  const { treeId, root, ids } = grow(k, [
    { title: 'a', status: 'pick' },
    { title: 'b', status: 'pick' },
    { title: 'c', status: 'pick' },
  ]);
  k.mind.apply({
    origin: USER,
    label: 'group',
    commands: [{ type: 'setGroup', group: { id: 'g1', treeId, anchor: root, composite: 'sequence', title: '', members: ids, props: {} } }],
  });
  k.mind.apply({ origin: USER, label: 'keep', commands: [{ type: 'keepPick', id: ids[0]! }] });
  assert.deepEqual(await render(k, [ids[0]!]), [{ type: 'removeGroup', id: 'g1' }]);
});

test('the model timeline keeps only members whose date is in their content', async () => {
  const k = kit();
  const { root, ids } = grow(k, [
    { title: 'Vertigo', summary: 'Hitchcock, 1958.' },
    { title: 'Jaws', summary: 'Spielberg, 1975.' },
    { title: 'Goodfellas', summary: 'Scorsese, 1990.' },
    { title: 'Undated', summary: 'Nobody knows.' },
  ]);
  k.model.on('renderer.composites', () => ({
    groups: [proposal({ parent: root, composite: 'timeline', title: 'Dolly zooms', members: ids, labels: ['1958', '1975', '1990', '2001'] })],
  }));
  await render(k, ids);
  assert.deepEqual(groups(k)[0]!.members, ids.slice(0, 3));
  assert.deepEqual(Object.values(groups(k)[0]!.props.labels as Record<string, string>), ['1958', '1975', '1990']);
});

test('beyond nine alike siblings, the least important go into a stack', async () => {
  const k = kit();
  const { ids } = grow(
    k,
    Array.from({ length: 11 }, (_, i) => ({ title: `note ${i}`, importance: i / 10 })),
  );
  k.model.on('renderer.composites', () => ({ groups: [] }));
  await render(k, ids);
  const stack = groups(k)[0]!;
  assert.equal(stack.composite, 'stack');
  assert.deepEqual([...stack.members].sort(), ids.slice(0, 5).sort());
  assert.deepEqual(await render(k, ids), []);
});

test('when the model fails, the rule-based views and groups still come back', async () => {
  const k = kit();
  const image = (title: string): Fields => ({ title, kind: 'image', source: { from: 'drop', asset: title, capturedAt: '' } });
  const { ids } = grow(k, [
    { title: 'Recipe', data: { steps: ['Boil', 'Stir'] } },
    { title: 'Long', text: LONG },
    image('a'),
    image('b'),
    image('c'),
    { title: 'x', why: 'option one' },
    { title: 'y', why: 'option two' },
  ]);
  const commands = await render(k, ids);
  assert.equal(view(k, ids[0]!).component, 'steps');
  assert.equal(view(k, ids[1]!).component, 'note');
  assert.deepEqual(
    commands.map((c) => c.type),
    ['setView', 'setGroup'],
  );
  assert.deepEqual(
    k.model.calls.map((c) => c.role).sort(),
    ['renderer.components', 'renderer.composites'],
  );
  assert.equal(k.notes.filter((n) => n.startsWith('renderer: ')).length, 2);
});
