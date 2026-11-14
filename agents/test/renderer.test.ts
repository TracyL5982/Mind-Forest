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
  assert.deepEqual(ids.map((id) => view(k, id).component), ['idea', 'idea', 'note']);
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

test('each structured type is chosen from the data that holds it, and a near miss is not', () => {
  const facts = [{ label: 'Height', value: '330 m' }, { label: 'Built', value: 1889 }];
  assert.deepEqual(ruled({ title: 'Tower', data: { facts } }), { component: 'facts', props: { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }] } });
  assert.equal(chosen({ title: 'Tower', data: { facts: facts.slice(0, 1) } }), 'fact');
  const eight = Array.from({ length: 8 }, (_v, n) => ({ label: `Row ${n}`, value: `${n}` }));
  const many = ruled({ title: 'Many', data: { facts: eight } }).props as { facts: unknown[]; more: number };
  assert.deepEqual([many.facts.length, many.more], [6, 2], 'six facts are shown and the rest are counted');

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
  assert.equal(chosen({ title: 'Stairwell', origin: SCOUT, data: work, source: { ...WEB, url: page } }), 'note', 'an artwork whose picture could not be stored');
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

test('a place is an item whose title names where it is, and a photo that merely has a place stays an image', () => {
  const photo = { kind: 'image' as const, source: { from: 'drop', asset: 'a1', capturedAt: '' } };
  assert.deepEqual(ruled({ title: 'Lisbon', data: { where: 'Lisbon' } }), { component: 'place', props: { name: 'Lisbon' } });
  assert.deepEqual(ruled({ ...photo, title: '杭州西湖', data: { where: '西湖' } }), { component: 'place', props: { name: '西湖', src: '/assets/a1' } });
  assert.equal(chosen({ title: 'Belém', data: { where: 'Belém, Lisbon' } }), 'place', 'the place states the title');
  assert.equal(chosen({ ...photo, title: 'beach.jpg', data: { where: 'Porto' } }), 'image');
  assert.equal(chosen({ title: 'Portobello mushrooms', data: { where: 'Porto' } }), 'note', 'a place inside another word is not named');
});

test('an idea is a short thought the user typed, and nothing else', () => {
  assert.deepEqual(ruled({ title: 'Build a treehouse', text: 'Build a treehouse' }), { component: 'idea', props: {} });
  assert.equal(chosen({ title: '把书房搬到阁楼', text: '' }), 'idea');
  assert.equal(chosen({ title: 'Build a treehouse', text: 'Build a treehouse', origin: SCOUT }), 'note', 'a thought an agent brought');
  assert.equal(chosen({ title: 'Build a treehouse', text: 'With a rope ladder.' }), 'note', 'a title with more text under it');
  assert.equal(chosen({ title: 'Build a treehouse in the old oak by the river', text: '' }), 'note', 'forty characters or more');
  assert.equal(chosen({ title: 'treehouse.pdf', text: '', kind: 'file' }), 'note', 'a file');
});

test('when an item satisfies two rules, the earlier one draws it', () => {
  const percent = { labels: ['Rent', 'Food'], values: [60, 40], unit: '%' };
  const table = { heads: ['Plan', 'Price'], rows: [['Solo', '$8']] };
  const link = { kind: 'link' as const, source: { from: 'link', url: 'https://example.com/a', capturedAt: '' } };
  const photo = { kind: 'image' as const, source: { from: 'drop', asset: 'a1', capturedAt: '' } };
  const pairs: [string, string, Partial<Item>][] = [
    ['breakdown', 'chart', { data: { chart: percent } }],
    ['breakdown', 'table', { data: { chart: percent, table } }],
    ['table', 'link', { ...link, data: { table } }],
    ['table', 'facts', { data: { table, facts: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }] } }],
    ['proscons', 'list', { data: { pros: ['fast'], cons: ['slow'], items: ['fast', 'slow'] } }],
    ['qa', 'definition', { data: { question: 'What is parallax?', answer: 'A shift.', term: 'Parallax', definition: 'A shift.' } }],
    ['steps', 'list', { data: { steps: ['Boil', 'Stir'], items: ['Boil', 'Stir'] } }],
    ['quote', 'excerpt', { data: { quote: { text: 'Invent the future.' }, excerpt: { text: 'Invent the future.' } } }],
    ['facts', 'reference', { origin: SCOUT, data: { kind: 'paper', facts: [{ label: 'n', value: '40' }, { label: 'p', value: '0.01' }] } }],
    ['fact', 'idea', { title: 'Budget: $1.2M', text: 'Budget: $1.2M' }],
    ['artwork', 'place', { ...photo, title: 'Lisbon', data: { kind: 'artwork', where: 'Lisbon' } }],
    ['place', 'image', { ...photo, title: 'Lisbon', data: { where: 'Lisbon' } }],
    ['place', 'link', { ...link, title: 'Lisbon', data: { where: 'Lisbon' } }],
    ['list', 'idea', { title: 'Bring', text: '', data: { items: ['tent', 'stove'] } }],
  ];
  for (const [first, second, fields] of pairs) assert.equal(chosen({ title: 'Both', ...fields }), first, `${first} before ${second}`);
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
