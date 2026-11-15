import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command, Group, Id, Item, Node, View } from '../src/core/domain.ts';
import { byRule, grounded, renderer, type ComponentsReply, type CompositesReply } from '../src/core/roles/renderer.ts';
import { SAMPLES, STRUCTURED_IDS, sampleAssetUrl, type StructuredId } from '../src/core/samples.ts';
import { makeNode } from '../src/core/roles/types.ts';
import { CHECKS, COMPONENT_IDS, isValidGroup, isValidView } from '../src/core/views.ts';
import { kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };
/** Text that makes a short item a note and not an idea. */
const PLAIN = 'Some words about it.';
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

test('a title that merely starts with a number is no fact', async () => {
  const k = kit();
  const { ids } = grow(k, [{ title: '12 Angry Men', text: '12 Angry Men' }, { title: 'Chapter 3', text: 'Chapter 3' }, { title: '12 Angry Men', text: PLAIN }]);
  await render(k, ids);
  assert.deepEqual(ids.map((id) => view(k, id).component), ['note', 'note', 'note']);
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
  const { treeId, root, ids } = grow(k, [image('a'), image('b'), image('c'), { title: 'A note', text: PLAIN }]);
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
  const pick = (title: string, summary: string): Fields => ({ title, summary, text: PLAIN, status: 'pick', why: `An alternative to the dolly zoom` });
  const { root, ids } = grow(k, [
    { title: 'Kept one', text: PLAIN, summary: 'Already here' },
    { title: 'Kept two', text: PLAIN, summary: 'Already here' },
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
    { title: 'a', text: PLAIN, status: 'pick' },
    { title: 'b', text: PLAIN, status: 'pick' },
    { title: 'c', text: PLAIN, status: 'pick' },
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
    { title: 'x', text: PLAIN, why: 'option one' },
    { title: 'y', text: PLAIN, why: 'option two' },
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

// ---- the card types chosen from an item's structure

const url = (id: string) => `/assets/${id}`;
const WEB = { from: 'web', capturedAt: '' };
const SCOUT = { by: 'agent' as const, role: 'scout' };

/** The component the rules give an item, and its props. */
function ruled(fields: Partial<Item> & { title: string }) {
  return byRule(kit().item({ text: PLAIN, ...fields }), url);
}
const chosen = (fields: Partial<Item> & { title: string }) => ruled(fields).component;

const LINKED = { kind: 'link' as const, source: { from: 'link', url: 'https://example.com/a', capturedAt: '' } };
const PHOTO = { kind: 'image' as const, source: { from: 'drop', asset: 'a1', capturedAt: '' } };
const CLIP = { kind: 'video' as const, source: { from: 'drop', asset: 'v1', capturedAt: '' } };
const ESSAY = `${LONG} `.repeat(9).trim();

test('each structured type is chosen from the data that holds it, and a near miss is not', () => {
  const facts = [{ label: 'Height', value: '330 m' }, { label: 'Built', value: 1889 }];
  assert.deepEqual(ruled({ title: 'Tower', data: { facts } }), { component: 'facts', props: { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }] } });
  assert.equal(chosen({ title: 'Tower', data: { facts: facts.slice(0, 1) } }), 'fact');
  const eight = Array.from({ length: 8 }, (_v, n) => ({ label: `Row ${n}`, value: `${n}` }));
  const many = ruled({ title: 'Many', data: { facts: eight } }).props as { facts: unknown[]; more: number };
  assert.deepEqual([many.facts.length, many.more], [6, 2], 'six facts are shown and the rest are counted');
  const sentence = 'a tower of wrought iron that was meant to stand for twenty years';
  assert.equal(sentence.length, 64);
  assert.equal(chosen({ title: 'Tower', data: { facts: [facts[0], { label: 'What', value: sentence.slice(0, 60) }] } }), 'facts', 'a value of sixty characters is still a figure');
  assert.notEqual(chosen({ title: 'Tower', data: { facts: [facts[0], { label: 'What', value: sentence }] } }), 'facts', 'a longer value is a sentence, and the item is left to its other rows');
  assert.notEqual(chosen({ title: 'Tower', data: { facts: [{ label: 'What', value: sentence }] } }), 'fact');
  assert.equal(chosen({ title: 'Tower', data: { facts: [{ label: 'What', value: '高'.repeat(60) }] } }), 'fact', 'characters are counted, not bytes');

  const table = { heads: ['Plan', 'Price'], rows: [['Solo', '$8'], ['Team', '']] };
  assert.deepEqual(ruled({ title: 'Plans', data: { table } }), { component: 'table', props: table });
  assert.equal(chosen({ title: 'Plans', data: { table: { heads: ['Plan', 'Price'], rows: [] } } }), 'note', 'a table with no row');
  assert.equal(chosen({ title: 'Plans', data: { table: { heads: ['Plan', 'Price'], rows: [['Solo']] } } }), 'note', 'a row with a cell missing');

  assert.deepEqual(ruled({ title: 'Bring', data: { items: ['tent', 'stove'] } }), { component: 'list', props: { items: ['tent', 'stove'] } });
  assert.deepEqual(ruled({ title: 'Bring', data: { items: ['tent', 'stove'], checklist: [true, false] } }).props, { items: ['tent', 'stove'], checked: [true, false] });
  assert.deepEqual(ruled({ title: 'Bring', data: { items: ['tent', 'stove'], checklist: [true] } }).props, { items: ['tent', 'stove'] }, 'marks that do not pair with the items are left out');
  assert.equal(chosen({ title: 'Bring', data: { items: ['tent'] } }), 'note');

  const shares = { labels: ['Rent', 'Food', 'Other'], values: [50, 30, 20] };
  assert.deepEqual(ruled({ title: 'Budget', data: { chart: { ...shares, unit: '%' } } }), { component: 'breakdown', props: { ...shares, unit: '%' } });
  for (const unit of ['percent', 'Pct', '％', '百分比']) assert.equal(chosen({ title: 'Budget', data: { chart: { ...shares, unit } } }), 'breakdown', unit);
  assert.equal(chosen({ title: 'Budget', data: { chart: { ...shares, values: [33.3, 33.3, 33.3], unit: '%' } } }), 'breakdown', 'thirds sum to about a hundred');
  assert.equal(chosen({ title: 'Budget', data: { chart: { ...shares, values: [50, 30, 10], unit: '%' } } }), 'chart', 'percentages that are not parts of one whole');
  assert.equal(chosen({ title: 'Budget', data: { chart: { ...shares, values: [0.5, 0.3, 0.2] } } }), 'chart', 'a sum of one with no unit');
  assert.equal(chosen({ title: 'Budget', data: { chart: { ...shares, unit: 'films' } } }), 'chart', 'a hundred of something else');
  assert.equal(chosen({ title: 'Budget', data: { chart: { ...shares, values: [120, -30, 10], unit: '%' } } }), 'chart', 'a share below zero');
  const nine = Array.from({ length: 9 }, (_v, n) => `Part ${n}`);
  assert.equal(chosen({ title: 'Budget', data: { chart: { labels: nine, values: [20, 10, 10, 10, 10, 10, 10, 10, 10], unit: '%' } } }), 'chart', 'more than eight parts');

  assert.deepEqual(ruled({ title: 'Sky', data: { question: 'Why is the sky blue?', answer: 'Air scatters blue light.' } }).component, 'qa');
  assert.equal(chosen({ title: 'Sky', data: { question: 'Why is the sky blue?' } }), 'note');
  assert.deepEqual(ruled({ title: 'Parallax', data: { term: 'Parallax', definition: 'an apparent shift' } }), { component: 'definition', props: { term: 'Parallax', definition: 'an apparent shift' } });
  assert.equal(chosen({ title: 'Parallax', data: { term: 'Parallax', definition: ' ' } }), 'note');

  assert.deepEqual(ruled({ title: 'Space', data: { excerpt: { text: 'The house shelters day-dreaming.', at: 'Chapter 1' }, site: 'example.org', from: 'Books' } }).props, {
    text: 'The house shelters day-dreaming.', at: 'Chapter 1', source: 'example.org',
  });
  assert.equal((ruled({ title: 'Space', data: { excerpt: { text: 'The house.' }, from: 'Books' } }).props as { source: string }).source, 'Books');
  assert.equal(chosen({ title: 'Space', data: { excerpt: { text: '' } } }), 'note');

  assert.deepEqual(ruled({ title: 'Rust', data: { pros: ['fast'], cons: ['slow builds'] } }), { component: 'proscons', props: { pros: ['fast'], cons: ['slow builds'] } });
  assert.equal(chosen({ title: 'Rust', data: { pros: ['fast'] } }), 'note', 'points for with none against');

  const colours = [{ name: 'Ember', value: '#E4572E' }, { name: 'navy', value: 'navy' }];
  assert.deepEqual(ruled({ title: 'Palette', data: { colours } }), { component: 'swatch', props: { colours } });
  assert.equal(chosen({ title: 'Palette', data: { colours: colours.slice(0, 1) } }), 'note', 'one colour is no palette');
});

test('a pick is drawn as what its source catalogued it as', () => {
  const work = { kind: 'artwork', by: 'Ilse Brandt', date: '1928', medium: 'Gelatin silver print', holder: 'The Example Museum', site: 'museum.example', from: 'The Example Museum' };
  const page = 'https://museum.example/works/1';
  assert.deepEqual(ruled({ title: 'Stairwell', kind: 'image', origin: SCOUT, data: work, source: { ...WEB, url: page, asset: 'a1' } }), {
    component: 'artwork',
    props: { src: '/assets/a1', maker: 'Ilse Brandt', date: '1928', medium: 'Gelatin silver print', holder: 'The Example Museum' },
  });
  assert.equal(chosen({ title: 'Stairwell', origin: SCOUT, data: work, source: { ...WEB, url: page } }), 'excerpt', 'an artwork whose picture could not be stored is the passage of its record');
  assert.equal(chosen({ title: 'Stairwell', origin: SCOUT, data: work, source: WEB }), 'note', 'and a note when it has no address either');
  assert.equal(chosen({ title: 'Stairwell', kind: 'image', origin: SCOUT, data: { ...work, kind: undefined }, source: { ...WEB, url: page, asset: 'a1' } }), 'image', 'a picture no source catalogued');

  const paper = { kind: 'paper', by: 'M. Okafor et al.', date: '2011-05-03', authors: ['M. Okafor', 'L. Haas'], authorsCut: true, venue: 'Journal of Example Vision' };
  const doi = 'https://doi.example/10.1000/zoom';
  assert.deepEqual(ruled({ title: 'Perceived depth', origin: SCOUT, data: paper, source: { ...WEB, url: doi } }), {
    component: 'reference',
    props: { kind: 'paper', authors: ['M. Okafor', 'L. Haas'], more: true, year: '2011', venue: 'Journal of Example Vision', url: doi },
  });
  assert.deepEqual(ruled({ title: 'The Poetics of Space', origin: SCOUT, data: { kind: 'book', by: 'Gaston Bachelard', date: 'n.d.' } }), {
    component: 'reference',
    props: { kind: 'book', authors: ['Gaston Bachelard'] },
  });
  assert.equal(chosen({ title: 'An essay', origin: SCOUT, data: { kind: 'article', by: 'A. Writer' } }), 'note');
});

test('a place is a note whose title is the place and nothing more', () => {
  const place = (title: string, where: string, more: Partial<Item> = {}) => chosen({ title, data: { where }, ...more });
  assert.deepEqual(ruled({ title: 'Lisbon', data: { where: 'Lisbon' } }), { component: 'place', props: { name: 'Lisbon' } });
  assert.deepEqual(ruled({ title: 'Lisbon', data: { where: 'Lisbon, Portugal', image: 'https://example.com/lisbon.jpg' } }).props, { name: 'Lisbon, Portugal', src: 'https://example.com/lisbon.jpg' });
  for (const [title, where] of [['LISBON', 'lisbon'], ['Lisbon, Portugal', 'Lisbon'], ['Ｌｉｓｂｏｎ', 'Lisbon'], ['  West   Lake ', 'West Lake'], ['西湖', '西湖']] as const) {
    assert.equal(place(title, where), 'place', `${title} is ${where}`);
  }
  for (const [title, where] of [
    ['Dinner in Lisbon', 'Lisbon'],
    ['Lisbon vs Porto', 'Lisbon'],
    ['Leaving home', 'home'],
    ['The', 'The Hague'],
    ['在西湖边吃的那顿饭', '西湖'],
    ['Portobello mushrooms', 'Porto'],
    ['里斯本', 'Lisbon'],
  ] as const) {
    assert.equal(place(title, where), 'note', `${title} is not ${where}`);
  }
  assert.equal(place('Lisbon', 'Lisbon', { text: '' }), 'place', 'a place with no note');
  assert.equal(place('Lisbon', 'Lisbon', { text: 'x'.repeat(279) }), 'place');
  assert.equal(place('Lisbon', 'Lisbon', { text: 'x'.repeat(280) }), 'note', 'a long note is not hidden behind the name of its place');
  assert.equal(place('Lisbon', 'Lisbon', { text: `${LONG} `.repeat(8) }), 'note');
  assert.equal(place('西湖', '西湖', { text: '字'.repeat(279) }), 'place');
  assert.equal(place('西湖', '西湖', { text: '字'.repeat(280) }), 'note');
  assert.equal(place('Lisbon', 'Lisbon', { text: `${'x'.repeat(140)}${' '.repeat(50)}\n\n${'ｘ'.repeat(130)}` }), 'place', 'counted in one written form, a run of white space once');
  assert.equal(place('Lisbon', 'Lisbon', PHOTO), 'image');
  assert.equal(place('Lisbon', 'Lisbon', CLIP), 'video');
  assert.equal(place('Lisbon', 'Lisbon', LINKED), 'link');
  assert.equal(place('Lisbon', 'Lisbon', { kind: 'file' }), 'note');
});

test('an idea is a phrase the user wrote, and a label is a note', () => {
  const typed = (text: string, title = text) => chosen({ title, text });
  assert.deepEqual(ruled({ title: 'Build a treehouse', text: 'Build a treehouse' }), { component: 'idea', props: {} });
  for (const thought of ['Why do users churn?', '把客厅改成工作室！', '把书房搬到阁楼', 'A map that redraws itself as you learn']) assert.equal(typed(thought), 'idea', thought);
  assert.equal(typed('Why do users churn?', 'Why do users churn'), 'idea', 'a title without the end punctuation');
  assert.equal(typed('把客厅改成工作室！', '把客厅改成工作室'), 'idea');
  assert.equal(typed('  build a   treehouse. ', 'Build a treehouse'), 'idea', 'case and spacing do not count');
  assert.equal(typed('', 'Build a treehouse'), 'idea', 'a title alone');
  assert.equal(typed('Build a treehouse', ''), 'idea', 'a text alone');

  for (const label of ['TODO', '🎉', '灵感', 'Buy milk', 'Room 204', 'example.com/pricing', 'Maria Chen', 'Q3 Roadmap', '例子.中国/价格表单页面', '第3章的想法和笔记', 'NASA', '周五见']) {
    assert.equal(typed(label), 'note', label);
  }
  assert.equal(typed('Why do users churn?', 'Why users churn'), 'note', 'a title in other words');
  assert.equal(typed('With a rope ladder.', 'Build a treehouse'), 'note', 'a title with more text under it');
  assert.equal(typed('Build a treehouse in the old oak by the river'), 'idea', 'a thought of nine words');
  assert.equal(typed('x'.repeat(4) + ' word'.repeat(11)), 'idea', 'fifty-nine characters');
  assert.equal(typed('x'.repeat(5) + ' word'.repeat(11)), 'note', 'sixty characters or more');
  assert.equal(chosen({ title: 'Build a treehouse', text: 'Build a treehouse', origin: SCOUT }), 'note', 'a thought an agent brought');
  assert.equal(chosen({ title: 'treehouse plans.pdf', text: '', kind: 'file' }), 'note', 'a file');
});

/** One small piece of each structure a row draws, with the type that row draws. */
const PIECES: [string, Record<string, unknown>][] = [
  ['breakdown', { chart: { labels: ['Rent', 'Food'], values: [60, 40], unit: '%' } }],
  ['chart', { chart: { labels: ['May', 'June'], values: [12, 15] } }],
  ['table', { table: { heads: ['Plan', 'Price'], rows: [['Solo', '$8'], ['Team', '$20']] } }],
  ['proscons', { pros: ['fast'], cons: ['slow builds'] }],
  ['qa', { question: 'Why is the sky blue?', answer: 'Air scatters blue light.' }],
  ['definition', { term: 'Parallax', definition: 'an apparent shift' }],
  ['steps', { steps: ['Boil water', 'Add pasta'] }],
  ['list', { items: ['tent', 'stove'] }],
  ['quote', { quote: { text: 'Invent the future.', by: 'Alan Kay' } }],
  ['person', { person: { name: 'Agnès Varda', role: 'Director' } }],
  ['swatch', { colours: [{ name: 'Ember', value: '#E4572E' }, { name: 'navy', value: 'navy' }] }],
  ['facts', { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }] }],
  ['fact', { facts: [{ label: 'Height', value: '330 m' }] }],
  ['excerpt', { excerpt: { text: 'The house shelters day-dreaming.', at: 'Chapter 1' } }],
];

test('a structure draws its item only when it is at least a fifth of the item, and a long item keeps the drawing of its kind', () => {
  for (const [type, data] of PIECES) {
    assert.equal(chosen({ title: 'Short', data }), type, `${type} of a short note`);
    assert.equal(chosen({ title: 'Essay', text: ESSAY, data }), 'note', `${type} inside an essay`);
    assert.equal(chosen({ ...LINKED, title: 'Article', text: ESSAY, data }), 'link', `${type} inside a saved page`);
  }
  const long = kit().item({ title: 'Essay', text: ESSAY, data: { facts: [{ label: 'Height', value: '330 m' }] } });
  assert.deepEqual(byRule(long, url), { component: 'note', props: {} });
  assert.deepEqual(long.data.facts, [{ label: 'Height', value: '330 m' }], 'the structure stays with the item');
});

test('the share a structure covers is counted in characters of one written form, against the text the user wrote, or the title and text of anything else', () => {
  const quoting = (said: string, text: string) => chosen({ title: 'A title the model wrote', text, data: { quote: { text: said } } });
  assert.equal(quoting('y'.repeat(20), 'x'.repeat(100)), 'quote', 'twenty of a hundred');
  assert.equal(quoting('y'.repeat(19), 'x'.repeat(100)), 'note', 'nineteen of a hundred');
  assert.equal(quoting('y'.repeat(20), `${'x'.repeat(49)}${' '.repeat(40)}\n\n${'x'.repeat(50)}`), 'quote', 'a run of white space counts once');
  assert.equal(quoting('y'.repeat(20), 'ｘ'.repeat(100)), 'quote', 'a full-width letter is one character');
  assert.equal(quoting('字'.repeat(20), '文'.repeat(100)), 'quote');
  assert.equal(quoting('字'.repeat(19), '文'.repeat(100)), 'note');

  const saved = (said: string) => chosen({ ...LINKED, title: 'Ten chars!', text: 'x'.repeat(90), data: { quote: { text: said } } });
  assert.deepEqual([saved('y'.repeat(20)), saved('y'.repeat(19))], ['quote', 'link'], 'a saved page has its own title, which counts');
  const brought = (said: string) => chosen({ title: 'Ten chars!', text: 'x'.repeat(90), origin: SCOUT, data: { quote: { text: said } } });
  assert.deepEqual([brought('y'.repeat(20)), brought('y'.repeat(19))], ['quote', 'note'], 'and so does the title of what an agent brought');
  const titled = (said: string) => chosen({ title: 'x'.repeat(100), text: '', data: { quote: { text: said } } });
  assert.deepEqual([titled('y'.repeat(20)), titled('y'.repeat(19))], ['quote', 'note'], 'a title alone is all the item says');
});

test('the same lines are the same card whatever title the model gave them', () => {
  for (const title of ['Milk and eggs', "Things to pick up for Saturday's dinner party"]) assert.equal(chosen({ title, text: 'Milk\nEggs', data: { items: ['Milk', 'Eggs'] } }), 'list', title);
  for (const title of ['买菜', '明天去超市要买的两样东西']) assert.equal(chosen({ title, text: '酱油\n姜', data: { items: ['酱油', '姜'] } }), 'list', title);
});

test('a chart or a breakdown a source carried draws its pick however long the words beside it, and one read off a long text the user made does not', () => {
  const years = ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022'];
  const values = [12.1, 12.4, 12.9, 13.3, 13.8, 14.6, 15.2, 15.9];
  const text = `${LONG} ${LONG}\n\nMeasured: share of electricity from wind, percent\n\n${years.map((year, n) => `${year}: ${values[n]}`).join(', ')}`;
  const pick = { title: 'Share of electricity from wind', text, origin: SCOUT, source: { ...WEB, url: 'https://data.example.org/grapher/wind-share' } };
  assert.deepEqual(ruled({ ...pick, data: { chart: { labels: years, values }, site: 'data.example.org' } }), { component: 'chart', props: { chart: 'line', labels: years, values } });
  assert.equal(chosen({ title: pick.title, text, data: { chart: { labels: years, values } } }), 'note', 'the same chart, read off a text the user pasted, is under the floor');

  const shares = { labels: ['Coal', 'Gas', 'Wind', 'Other'], values: [40, 30, 20, 10], unit: '%' };
  assert.equal(chosen({ ...pick, text: ESSAY, data: { chart: shares } }), 'breakdown');
  assert.equal(chosen({ title: pick.title, text: ESSAY, data: { chart: shares } }), 'note');
  assert.equal(chosen({ ...pick, text: ESSAY, data: { steps: ['Boil', 'Stir'] } }), 'excerpt', 'steps beside a long passage keep their floor');
});

test('a page the Scout picked draws as the passage it chose, with the site it is from', () => {
  const passage = 'Lime raises the pH slowly, over a season, and works faster when it is dug in than when it is left on the surface.';
  const data = { site: 'www.rhs.example', by: 'Royal Horticultural Society', date: '2024', from: 'Web' };
  const pick = { title: 'Soil pH: why it matters', text: `${passage}\n\nRoyal Horticultural Society, 2024, Web`, origin: SCOUT, data, source: { ...WEB, url: 'https://www.rhs.example/soil-ph' } };
  const drawn = ruled(pick);
  assert.deepEqual(drawn, { component: 'excerpt', props: { text: pick.text, source: 'www.rhs.example' } });
  assert.ok(grounded(drawn, kit().item(pick), url));
  assert.equal((ruled({ ...pick, data: { ...data, site: undefined } }).props as { source: string }).source, 'Web', 'the source that found it, when the site is not known');

  assert.equal(chosen({ ...pick, text: 'Royal Horticultural Society, 2024, Web' }), 'note', 'a pick with no passage, only the line that says who made it');
  assert.equal(chosen({ ...pick, text: '' }), 'note');
  assert.equal(chosen({ ...pick, source: WEB }), 'note', 'a thought the Scout wrote has no address');
  assert.equal(chosen({ ...pick, origin: { by: 'user' } }), 'note', 'a text the user made is not a passage of a page');
  assert.equal(chosen({ ...pick, kind: 'image', source: { ...pick.source, asset: 'a1' } }), 'image');
  assert.equal(chosen({ ...pick, data: { ...data, kind: 'paper' } }), 'reference', 'a catalogued record comes first');
  assert.equal(chosen({ ...pick, data: { ...data, chart: { labels: ['2019', '2020'], values: [12, 15] } } }), 'chart');
});

test('a structure with more entries than its card shows is measured by what the card shows', () => {
  const eight = Array.from({ length: 8 }, (_v, n) => ({ label: 'L', value: `${n}` }));
  assert.equal(chosen({ title: '', text: 'x'.repeat(61), data: { facts: eight } }), 'note', 'only the six facts the card shows are counted');
  assert.equal(chosen({ title: '', text: 'x'.repeat(60), data: { facts: eight } }), 'facts');
  assert.equal(chosen({ title: '', text: '', data: { steps: ['Boil', 'Stir'] } }), 'steps', 'an item with no words of its own hides none');
});

test('a place written after its region, or with its kind of district, is that place in a script without spaces', () => {
  const place = (title: string, where: string) => chosen({ title, data: { where } });
  const same: [string, string][] = [['杭州西湖', '西湖'], ['上海外滩', '外滩'], ['北京市', '北京'], ['北京', '北京市'], ['东京都', '东京'], ['浙江省杭州市西湖', '西湖'], ['京都清水寺', '清水寺'], ['杭州西湖，浙江', '西湖']];
  for (const [title, where] of same) assert.equal(place(title, where), 'place', `${title} is ${where}`);
  assert.deepEqual(ruled({ title: '杭州西湖', data: { where: '西湖' } }).props, { name: '西湖' });
  const kinds: [string, string][] = [['周庄镇', '周庄'], ['沙溪', '沙溪乡'], ['西递村', '西递'], ['大理州', '大理'], ['大阪府', '大阪'], ['北海道', '北海'], ['箱根町', '箱根'], ['부산시', '부산'], ['제주', '제주도'], ['해운대구', '해운대']];
  for (const [title, where] of kinds) assert.equal(place(title, where), 'place', `${title} is ${where}, with a town, a prefecture or a Korean district at its end`);
  const other: [string, string][] = [
    ['东京都', '京都'],
    ['杭州西湖', '湖'],
    ['京都', '京'],
    ['北京站', '北京'],
    ['北京市区', '北京'],
    ['西湖边', '西湖'],
    ['西湖杭州', '西湖'],
    ['在杭州西湖边的茶馆西湖', '西湖'],
    ['Old Lisbon', 'Lisbon'],
    ['Lisbonne', 'Lisbon'],
    ['Lisbon西湖', '西湖'],
    ['杭州 西湖', '西湖'],
  ];
  for (const [title, where] of other) assert.equal(place(title, where), 'note', `${title} is not ${where}`);
});

test('when an item satisfies two rules, the earlier one draws it', () => {
  const percent = { labels: ['Rent', 'Food'], values: [60, 40], unit: '%' };
  const table = { heads: ['Plan', 'Price'], rows: [['Solo', '$8']] };
  const paper = { kind: 'paper', by: 'M. Okafor' };
  const facts = [{ label: 'a', value: '1' }, { label: 'b', value: '2' }];
  const pairs: [string, string, Partial<Item>][] = [
    ['artwork', 'image', { ...PHOTO, data: { kind: 'artwork' } }],
    ['artwork', 'steps', { ...PHOTO, data: { kind: 'artwork', steps: ['Boil', 'Stir'] } }],
    ['reference', 'chart', { origin: SCOUT, data: { ...paper, chart: { labels: ['2019', '2020'], values: [12, 15] } } }],
    ['reference', 'facts', { origin: SCOUT, data: { ...paper, facts } }],
    ['reference', 'image', { ...PHOTO, origin: SCOUT, data: { kind: 'book', by: 'Gaston Bachelard' } }],
    ['image', 'place', { ...PHOTO, title: 'Lisbon', data: { where: 'Lisbon' } }],
    ['image', 'steps', { ...PHOTO, data: { steps: ['Boil the water', 'Stir it in'] } }],
    ['image', 'facts', { ...PHOTO, title: 'Receipt', data: { facts: [{ label: 'Total', value: '$12' }, { label: 'Tip', value: '$2' }] } }],
    ['video', 'place', { ...CLIP, title: 'Lisbon', data: { where: 'Lisbon' } }],
    ['video', 'steps', { ...CLIP, data: { steps: ['Boil the water', 'Stir it in'] } }],
    ['breakdown', 'chart', { data: { chart: percent } }],
    ['breakdown', 'table', { data: { chart: percent, table } }],
    ['table', 'link', { ...LINKED, data: { table } }],
    ['table', 'facts', { data: { table, facts } }],
    ['proscons', 'list', { data: { pros: ['fast'], cons: ['slow'], items: ['fast', 'slow'] } }],
    ['qa', 'definition', { data: { question: 'What is parallax?', answer: 'A shift.', term: 'Parallax', definition: 'A shift.' } }],
    ['steps', 'list', { data: { steps: ['Boil', 'Stir'], items: ['Boil', 'Stir'] } }],
    ['steps', 'link', { ...LINKED, data: { steps: ['Boil the water', 'Stir it in'] } }],
    ['quote', 'excerpt', { data: { quote: { text: 'Invent the future.' }, excerpt: { text: 'Invent the future.' } } }],
    ['image', 'code', { ...PHOTO, data: { code: { source: 'const a = 1;' } } }],
    ['code', 'table', { data: { table, code: { source: 'Plan | Price' } } }],
    ['code', 'chart', { data: { chart: percent, code: { source: 'const a = 1;' } } }],
    ['code', 'facts', { data: { code: { source: 'const a = 1;' }, facts } }],
    ['code', 'place', { kind: 'code', title: 'Lisbon', text: 'print(1)', data: { where: 'Lisbon' } }],
    ['fact', 'idea', { title: 'Budget: $1.2M', text: 'Budget: $1.2M' }],
    ['link', 'excerpt', { ...LINKED, data: { excerpt: { text: 'Some words about it.' } } }],
    ['link', 'place', { ...LINKED, title: 'Lisbon', data: { where: 'Lisbon' } }],
    ['excerpt', 'place', { title: 'Lisbon', data: { where: 'Lisbon', excerpt: { text: 'Some words about it.' } } }],
    ['list', 'idea', { title: 'Bring', text: '', data: { items: ['tent', 'stove'] } }],
    ['place', 'idea', { title: 'West Lake Hangzhou', text: '', data: { where: 'West Lake Hangzhou' } }],
  ];
  for (const [first, second, fields] of pairs) assert.equal(chosen({ title: 'Both', ...fields }), first, `${first} before ${second}`);

  assert.equal(chosen({ ...LINKED, title: 'Article', text: ESSAY, data: { table } }), 'link', 'a table gives way to the link below the floor');
});

test('an item that is code draws as code, whatever was read off it and however little of it that was', () => {
  const constants = Array.from({ length: 6 }, (_v, n) => `export const LIMIT_${n} = ${n * 10};`).join('\n');
  const facts = Array.from({ length: 6 }, (_v, n) => ({ label: `LIMIT_${n}`, value: `${n * 10}` }));
  assert.equal(chosen({ title: 'limits.ts', text: constants, data: { facts } }), 'facts', 'the same text, when it is not code, is its facts');
  assert.deepEqual(ruled({ title: 'limits.ts', text: constants, data: { facts, code: { source: constants } } }), { component: 'code', props: { language: 'text', source: constants } });
  assert.equal(chosen({ title: 'limits.ts', kind: 'code', text: constants, data: { facts } }), 'code');

  const source = 'def rate(tier):\n    \"\"\"\n    tier | rate\n    free | 10\n    pro  | 100\n    \"\"\"\n    return RATES[tier]';
  const table = { heads: ['tier', 'rate'], rows: [['free', '10'], ['pro', '100']] };
  assert.equal(chosen({ title: 'rate', text: source, data: { table } }), 'table');
  assert.equal(chosen({ title: 'rate', text: source, data: { table, code: { language: 'python', source } } }), 'code', 'a table in a docstring does not draw the function');

  assert.equal(chosen({ title: 'Snippet', text: ESSAY, data: { code: { source: 'const a = 1;' } } }), 'code', 'code has no floor');
  assert.equal(chosen({ ...LINKED, title: 'Gist', data: { code: { source: 'const a = 1;' } } }), 'code');
  assert.equal(chosen({ title: 'Empty', kind: 'code', text: '' }), 'note', 'code with no source is a note');
  assert.equal(chosen({ title: 'Empty', kind: 'code', text: '', data: { code: { source: '' } } }), 'note');
  assert.equal(chosen({ title: 'Empty', kind: 'code', text: '', data: { facts: [{ label: 'Height', value: '330 m' }] } }), 'fact', 'and what it carries still draws it');
});

test('three sibling pictures become a gallery whether a rule draws them as images, videos or artworks', async () => {
  const k = kit();
  const { ids } = grow(k, [
    { ...PHOTO, title: 'Stairwell', origin: SCOUT, data: { kind: 'artwork', by: 'Ilse Brandt' } },
    { ...PHOTO, title: 'Beach' },
    { ...CLIP, title: 'Waves' },
  ]);
  await render(k, ids);
  assert.deepEqual(ids.map((id) => view(k, id).component), ['artwork', 'image', 'video']);
  assert.deepEqual(groups(k).map((g) => [g.composite, g.members]), [['gallery', ids]]);
});

test('a conversation stays a chat whatever else its data holds', () => {
  const messages = [{ role: 'user', text: 'How?' }, { role: 'assistant', text: 'Like so.' }];
  const data = { messages, steps: ['Boil', 'Stir'], table: { heads: ['a', 'b'], rows: [['1', '2']] }, where: 'Talk' };
  assert.equal(chosen({ title: 'Talk', kind: 'chat', data }), 'chat');
  assert.equal(chosen({ title: 'Talk', kind: 'chat', data: { steps: ['Boil', 'Stir'] } }), 'note', 'with no message to show it is a note');
});

test('every sample is drawn as its type, with props the library accepts and the item states', () => {
  assert.deepEqual(Object.keys(CHECKS), COMPONENT_IDS, 'every component has a content check');
  assert.equal(COMPONENT_IDS.length, 25);
  for (const id of STRUCTURED_IDS) {
    const { item, props } = SAMPLES[id];
    const made = byRule(item, sampleAssetUrl);
    if (id === 'callout') assert.notEqual(made.component, 'callout', 'no rule chooses a callout');
    else assert.deepEqual(made, { component: id, props });
    assert.ok(isValidView({ component: id, props }), `${id} props are valid`);
    assert.ok(grounded({ component: id, props }, item, sampleAssetUrl), `${id} props stand in the item`);
  }
  assert.ok(/[一-鿿]/.test(SAMPLES.list.item.title + SAMPLES.qa.item.title + SAMPLES.idea.item.title + SAMPLES.place.item.title));
});

test('a prop the item does not state is refused, for every structured type', () => {
  const p = <K extends StructuredId>(id: K) => SAMPLES[id].props as any;
  const unstated: Record<StructuredId, Record<string, unknown>[]> = {
    facts: [
      { ...p('facts'), facts: [{ label: 'Height', value: '324 m' }, ...p('facts').facts.slice(1)] },
      { ...p('facts'), more: 4 },
      { ...p('facts'), facts: [{ label: '', value: '330 m' }, ...p('facts').facts.slice(1)] },
    ],
    table: [{ ...p('table'), rows: [['Solo', '$9', '1', '']] }, { ...p('table'), heads: ['Plan', 'Cost', 'Seats', 'Support'] }],
    list: [{ ...p('list'), items: ['帐篷', '睡袋', '头灯', '雨衣'] }, { ...p('list'), checked: [true, true, true, false] }],
    breakdown: [{ ...p('breakdown'), values: [45, 25, 10, 21] }, { ...p('breakdown'), labels: ['Rent', 'Food', 'Transport', 'Fun'] }, { ...p('breakdown'), unit: 'euros' }],
    qa: [{ ...p('qa'), answer: '因为海水是蓝色的。' }, { ...p('qa'), question: '为什么天空是红色的？' }],
    callout: [{ ...p('callout'), text: 'Anything above 30 °C kills the yeast.' }, { ...p('callout'), text: 'Never rinse the jar with hot water. Feed it once a day' }],
    excerpt: [{ ...p('excerpt'), text: 'The house protects day-dreaming.' }, { ...p('excerpt'), at: 'Chapter 2' }, { ...p('excerpt'), source: 'elsewhere.example' }],
    definition: [{ ...p('definition'), definition: 'a kind of lens' }, { ...p('definition'), term: 'Paradox' }],
    idea: [{ text: 'Anything' }],
    proscons: [{ ...p('proscons'), pros: ['no data races', 'loved by all'] }, { ...p('proscons'), cons: ['slow builds', 'hard to hire for'] }],
    swatch: [
      { colours: [{ name: 'Ember', value: '#E4572F' }, { name: 'Lagoon', value: '#17BEBB' }] },
      { colours: [{ name: 'Sunset', value: '#E4572E' }, { name: 'Lagoon', value: '#17BEBB' }] },
      { colours: [{ name: 'Ember', value: '#E4572E' }, { name: 'navy', value: 'navy' }] },
    ],
    artwork: [{ ...p('artwork'), src: 'https://elsewhere.example/x.jpg' }, { ...p('artwork'), maker: 'Man Ray' }, { ...p('artwork'), date: '1929' }, { ...p('artwork'), medium: 'Oil on canvas' }, { ...p('artwork'), holder: 'The Louvre' }],
    reference: [
      { ...p('reference'), authors: ['M. Okafor', 'A. Einstein'] },
      { ...p('reference'), year: '2012' },
      { ...p('reference'), venue: 'Nature' },
      { ...p('reference'), kind: 'book' },
      { ...p('reference'), url: 'https://elsewhere.example/' },
    ],
    place: [{ ...p('place'), name: '太湖' }, { ...p('place'), src: 'https://elsewhere.example/x.jpg' }],
  };
  for (const id of STRUCTURED_IDS) {
    assert.ok(unstated[id].length > 0);
    unstated[id].forEach((props, n) => assert.equal(grounded({ component: id, props }, SAMPLES[id].item, sampleAssetUrl), false, `${id} #${n + 1} is refused`));
  }
  const uncut = { ...SAMPLES.reference.item, data: { ...SAMPLES.reference.item.data, authorsCut: undefined } };
  assert.equal(grounded({ component: 'reference', props: p('reference') }, uncut, sampleAssetUrl), false, 'further authors the source does not report');
});

test('a view of an older type is checked the same way, and a prop no schema describes is refused', () => {
  const item = kit().item({ title: 'Churn', text: 'Churn fell to 4.2% in March, from 14.2% a year before.', summary: 'Churn is down.' });
  const ok = (component: string, props: Record<string, unknown>) => grounded({ component, props }, item, url);
  assert.ok(ok('fact', { value: '4.2%', label: 'Monthly churn' }));
  assert.equal(ok('fact', { value: '2%', label: 'Monthly churn' }), false, 'a number inside another number');
  assert.equal(ok('fact', { value: '4.2%', label: ' ' }), false);
  assert.ok(ok('note', { emphasis: 'fell to 4.2%' }));
  assert.equal(ok('note', { emphasis: 'arch' }), false, 'letters inside another word');
  assert.equal(ok('chart', { chart: 'bar', labels: ['March', 'a year before'], values: [4.2, 14] }), false);
  assert.ok(ok('chart', { chart: 'bar', labels: ['March', 'a year before'], values: [4.2, 14.2] }));
  assert.equal(ok('link', { url: 'https://elsewhere.example', site: 'elsewhere.example' }), false, 'an address the item does not have');
  assert.equal(ok('idea', {}), true);
  assert.equal(ok('idea', { size: 'huge' }), false);
  assert.equal(ok('unheard-of', {}), false);
  for (const id of STRUCTURED_IDS) assert.equal(isValidView({ component: id, props: { ...SAMPLES[id].props, extra: 1 } }), false, `${id} with a stray prop`);
});

test('what the rules draw for the older kinds stands in the item too', () => {
  const k = kit();
  const made = [
    k.item({ title: 'Photo', kind: 'image', summary: 'A staircase from above', source: { from: 'drop', asset: 'a1', capturedAt: '' } }),
    k.item({ title: 'Reel', kind: 'video', data: { mediaUrl: 'https://cdn.example/reel.mp4', thumbnailUrl: 'https://cdn.example/reel.jpg' }, source: { from: 'instagram', url: 'https://instagram.com/p/1', capturedAt: '' } }),
    k.item({ title: 'Article', kind: 'link', summary: 'On vertigo', data: { image: 'https://example.com/og.png' }, source: { from: 'paste', url: 'https://www.example.com/a', capturedAt: '' } }),
    k.item({ title: 'Talk', kind: 'chat', data: { messages: [{ role: 'user', text: 'How does a dolly zoom work?' }, { role: 'assistant', text: 'x '.repeat(300) }] }, source: { from: 'chat-export:claude', capturedAt: '' } }),
    k.item({ title: 'Script', kind: 'code', text: 'print(1)' }),
    k.item({ title: 'Director', data: { person: { name: 'Agnès Varda', role: 'Director' } } }),
    k.item({ title: 'Sales', data: { chart: { labels: ['North', 'South'], values: [4, -9], unit: 'units' } } }),
    k.item({ title: 'Kay', data: { quote: { text: 'Invent the future.', by: 'Alan Kay' } } }),
    k.item({ title: 'Recipe', data: { steps: ['Boil water', 'Add pasta'] } }),
    k.item({ title: 'Churn', data: { facts: [{ label: 'Monthly churn', value: 4.2 }] } }),
  ];
  assert.deepEqual(made.map((item) => byRule(item, url).component), ['image', 'video', 'link', 'chat', 'code', 'person', 'chart', 'quote', 'steps', 'fact']);
  for (const item of made) assert.ok(grounded(byRule(item, url), item, url), `${byRule(item, url).component} stands`);
});

test('a time or a date is no fact', () => {
  for (const text of ['Flight home at 10:45', 'Dinner 7:30', 'Meeting: 3pm', 'Doors: 9 a.m.', 'Due: 15 March', 'Born: 3/15/1990', 'Launch 2024-03: 15']) {
    assert.equal(chosen({ title: text, text }), 'note', text);
  }
  assert.deepEqual(ruled({ title: 'Budget', text: 'Budget: $1.2M' }).props, { value: '$1.2M', label: 'Budget' });
  assert.deepEqual(ruled({ title: 'Seats', text: 'Seats = 40' }).props, { value: '40', label: 'Seats' });
});

test('a fact with no value is passed over, and the facts that have one are drawn', () => {
  const facts = [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '' }, { label: 'Floors', value: '3' }];
  assert.deepEqual(ruled({ title: 'Tower', data: { facts } }).props, { facts: [{ label: 'Height', value: '330 m' }, { label: 'Floors', value: '3' }] });
  assert.deepEqual(ruled({ title: 'Tower', data: { facts: facts.slice(0, 2) } }), { component: 'fact', props: { value: '330 m', label: 'Height' } });
  assert.equal(chosen({ title: 'Tower', data: { facts: facts.slice(1, 2) } }), 'note');
});

test('a chart keeps a unit the text writes against its values, and a value written in its magnitude', async () => {
  const k = kit();
  const revenue = 'Revenue was $120k in Q1, $140k in Q2 and $90k in Q3 of last year.';
  const { ids } = grow(k, [
    { title: 'Month', text: 'Where the month goes: rent 45%, food 25%, transport 10% and the rest is saved.' },
    { title: 'Prices', text: 'Prices: basic €5, plus €9, pro €19 a month, billed once a year.' },
    { title: '人口', text: '人口：北京2189万，上海2487万，广州1868万，都是大城市，而且这些年还在慢慢变多，没有停下来的意思。' },
    { title: 'Revenue', text: revenue },
    { title: 'Noon', text: 'Temps: Oslo 5°, Rome 12°, Cairo 24° at noon on that day there.' },
    { title: 'Bare', text: revenue },
    { title: 'Weights', text: 'Where the month goes: rent 45%, food 25%, transport 10% and the rest is saved.' },
  ]);
  const chart = (n: number, chartLabels: string[], chartValues: number[], chartUnit: string) => entry({ id: ids[n]!, component: 'chart', chartLabels, chartValues, chartUnit });
  k.model.on('renderer.components', () => ({
    items: [
      chart(0, ['rent', 'food', 'transport'], [45, 25, 10], '%'),
      chart(1, ['basic', 'plus', 'pro'], [5, 9, 19], '€'),
      chart(2, ['北京', '上海', '广州'], [2189, 2487, 1868], '万'),
      chart(3, ['Q1', 'Q2', 'Q3'], [120, 140, 90], 'k'),
      chart(4, ['Oslo', 'Rome', 'Cairo'], [5, 12, 24], '°'),
      chart(5, ['Q1', 'Q2', 'Q3'], [120, 140, 90], ''),
      chart(6, ['rent', 'food', 'transport'], [45, 25, 10], 'kg'),
    ],
  }));
  await render(k, ids);
  const drawn = (n: number) => [view(k, ids[n]!).component, view(k, ids[n]!).props.values, view(k, ids[n]!).props.unit];
  assert.deepEqual(drawn(0), ['chart', [45, 25, 10], '%']);
  assert.deepEqual(drawn(1), ['chart', [5, 9, 19], '€']);
  assert.deepEqual(drawn(2), ['chart', [2189, 2487, 1868], '万']);
  assert.deepEqual(drawn(3), ['chart', [120, 140, 90], 'k']);
  assert.deepEqual(drawn(4), ['chart', [5, 12, 24], '°']);
  assert.equal(view(k, ids[5]!).component, 'note', 'a hundred and twenty is not what "120k" writes');
  assert.deepEqual(drawn(6), ['chart', [45, 25, 10], undefined], 'a unit the text does not write is left out');
});

test('a stored chart or breakdown stands with the unit the text writes against a value, and falls with one it does not', () => {
  const stands = (text: string, props: Record<string, unknown>, component = 'chart') => grounded({ component, props }, kit().item({ title: 'Card', text }), url);
  const bar = (labels: string[], values: number[], unit?: string) => ({ chart: 'bar', labels, values, ...(unit ? { unit } : {}) });
  assert.ok(stands('Rent 45%, food 25% of the month.', bar(['Rent', 'food'], [45, 25], '%')));
  assert.ok(stands('Rent 45%, food 55% of the month.', { labels: ['Rent', 'food'], values: [45, 55], unit: '%' }, 'breakdown'));
  assert.ok(stands('Prices: basic €5, pro €19 a month.', bar(['basic', 'pro'], [5, 19], '€')));
  assert.ok(stands('Revenue was $120 in Q1 and $140 in Q2.', bar(['Q1', 'Q2'], [120, 140], '$')));
  assert.ok(stands('人口：北京2189万，上海2487万。', bar(['北京', '上海'], [2189, 2487], '万')));
  assert.ok(stands('人口：北京2189万，上海2487万。', bar(['北京', '上海'], [21890000, 24870000])));
  assert.ok(stands('Revenue was $120k in Q1 and $140k in Q2.', bar(['Q1', 'Q2'], [120, 140], 'k')));
  assert.ok(stands('We found 12 films in 2019 and 15 in 2020.', bar(['2019', '2020'], [12, 15], 'films')));

  assert.equal(stands('Rent 45, food 25 of the month.', bar(['Rent', 'food'], [45, 25], '%')), false);
  assert.equal(stands('Rent 45%, food 55% of the month.', { labels: ['Rent', 'food'], values: [45, 55], unit: 'kg' }, 'breakdown'), false);
  assert.equal(stands('人口：北京2189万，上海2487万。', bar(['北京', '上海'], [2189, 2487])), false, 'the bare number is not what the text writes');
  assert.equal(stands('人口：北京2189万，上海2487万。', bar(['北京', '上海'], [2189, 2487], '亿')), false);
  assert.equal(stands('Revenue was $120k in Q1 and $140k in Q2.', bar(['Q1', 'Q2'], [120, 140])), false);
  assert.equal(stands('Revenue was $120k in Q1 and $140 in Q2.', bar(['Q1', 'Q2'], [120, 140], 'k')), false, 'every value is written, bare or in the unit');
});

test('a card shows no blank label, value, list entry, point or colour name', () => {
  const blank: [string, Record<string, unknown>][] = [
    ['facts', { facts: [{ label: 'a', value: ' ' }, { label: 'b', value: '2' }] }],
    ['facts', { facts: [{ label: '', value: '1' }, { label: 'b', value: '2' }] }],
    ['list', { items: ['tent', ' '] }],
    ['proscons', { pros: ['fast'], cons: [''] }],
    ['proscons', { pros: ['\t'], cons: ['slow'] }],
    ['swatch', { colours: [{ name: '', value: '#fff' }, { name: 'navy', value: 'navy' }] }],
  ];
  for (const [component, props] of blank) assert.equal(isValidView({ component, props }), false, `${component} ${JSON.stringify(props)}`);
});

test('a swatch paints only a hex colour or a colour name, so no other value of a style can come in as a colour', () => {
  const swatch = (value: string) => isValidView({ component: 'swatch', props: { colours: [{ name: 'One', value }, { name: 'Two', value: '#fff' }] } });
  for (const value of ['#abc', '#abcd', '#A1b2C3', '#a1b2c3d4', 'navy', 'RebeccaPurple', 'lightgoldenrodyellow']) assert.ok(swatch(value), value);
  for (const value of ['var(--accent)', 'url(https://example.com/x.png)', 'rgb(1, 2, 3)', '#ab', '#abcde', '#abcdefg', 'red; background: blue', 'dark red', '', ' navy', `${'a'.repeat(31)}`, 'expression(alert(1))', 'calc(1px)']) assert.equal(swatch(value), false, value);
});

test('an address in the data states nothing, a table cell holds no cell break, and a quotation may run over a tab', () => {
  const k = kit();
  const essay = k.item({ title: 'Trams', kind: 'link', text: 'A photo essay about the tram lines and the hills they climb.', data: { image: 'https://cdn.example/img/2048/photo.jpg', date: '1928' }, source: { from: 'link', url: 'https://example.com/trams/77', capturedAt: '' } });
  assert.equal(grounded({ component: 'fact', props: { value: '2048', label: 'Width' } }, essay, url), false, 'a number inside a picture address');
  assert.equal(grounded({ component: 'fact', props: { value: '77', label: 'Page' } }, essay, url), false);
  assert.ok(grounded({ component: 'fact', props: { value: '1928', label: 'Year' } }, essay, url), 'a date the data holds');
  assert.ok(grounded(byRule(essay, url), essay, url), 'the picture is still the link card\'s own');

  const plans = k.item({ title: 'Plans', text: 'Plan | Price | Seats\nSolo | $8 | 1' });
  const table = (rows: string[][], heads = ['Plan', 'Price', 'Seats']) => grounded({ component: 'table', props: { heads, rows } }, plans, url);
  assert.ok(table([['Solo', '$8', '1']]));
  assert.equal(table([['Solo | $8', '', '1']]), false, 'one cell that spans two');
  assert.equal(table([['Solo', '$8', '1']], ['Plan | Price', 'Price', 'Seats']), false);

  const said = k.item({ title: 'Cameras', text: 'The   best  camera\tis the one you have with you, people say.' });
  assert.ok(grounded({ component: 'quote', props: { text: 'The best camera is the one you have with you' } }, said, url));
});
