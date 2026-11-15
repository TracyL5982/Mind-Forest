import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command, Group, Id, Item, Node, View } from '../src/core/domain.ts';
import { byModel, byRule, CHOSEN, grounded, renderer, type Chosen, type ComponentsReply, type CompositesReply } from '../src/core/roles/renderer.ts';
import { EXPLORABLES, SAMPLES, SHEETS, STRUCTURED_IDS, sampleAssetUrl, type StructuredId } from '../src/core/samples.ts';
import { Pipeline } from '../src/core/pipeline.ts';
import { makeNode } from '../src/core/roles/types.ts';
import { CHECKS, COMPONENT_IDS, isValidGroup, isValidView, ROOM, type PropsOf } from '../src/core/views.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };
/** Text that makes a short item a note and not an idea. */
const PLAIN = 'Some words about it.';
const LONG = 'A plain paragraph about how the camera moves through the house, long enough to be worth a second look.';

type Fields = Partial<Item> & { title: string } & { status?: Node['status']; why?: string; importance?: number };

/**
 * The words a person would have written for each piece an item's data holds, a line or a list line for each: a figure, a series, a
 * quotation, a passage, a term and its meaning, a question and its answer, steps, a list, pros and cons, a table, a person and a
 * palette. A card that shows such a piece is held to the item's words, so an item that carries the piece says it too.
 */
function saying(data: Record<string, unknown> = {}): string {
  const { chart, facts, quote, excerpt, term, definition, question, answer, steps, items, pros, cons, table, person, colours } = data as {
    chart?: { labels: (string | number)[]; values: number[]; unit?: string };
    facts?: { label: string; value: string | number }[];
    quote?: { text: string };
    excerpt?: { text: string; at?: string };
    term?: string;
    definition?: string;
    question?: string;
    answer?: string;
    steps?: string[];
    items?: string[];
    pros?: string[];
    cons?: string[];
    table?: { heads: string[]; rows: string[][] };
    person?: { name: string; role?: string };
    colours?: { name: string; value: string }[];
  };
  const listed = (entries: string[] | undefined) => entries?.map((entry) => `- ${entry}`) ?? [];
  return [
    ...(chart?.labels.map((label, n) => `${label}: ${chart.values[n]}${chart.unit ? ` ${chart.unit}` : ''}`) ?? []),
    ...(facts?.map(({ label, value }) => `${label}: ${value}`) ?? []),
    ...(quote ? [quote.text] : []),
    ...(excerpt ? [excerpt.text, ...(excerpt.at ? [`At: ${excerpt.at}`] : [])] : []),
    ...(term !== undefined && definition !== undefined ? [definition] : []),
    ...(question !== undefined && answer !== undefined ? [question, answer] : []),
    ...(steps?.map((step, n) => `${n + 1}. ${step}`) ?? []),
    ...listed(items),
    ...(pros ? ['Pros:', ...listed(pros)] : []),
    ...(cons ? ['Cons:', ...listed(cons)] : []),
    ...(table ? [table.heads, ...table.rows].map((cells) => `| ${cells.join(' | ')} |`) : []),
    ...(person ? [person.name, ...(person.role ? [person.role] : [])] : []),
    ...(colours?.map(({ name, value }) => `${name}: ${value}`) ?? []),
  ].join('\n');
}

/** A tree with a root and one child per entry. Returns the root id and the child ids in order. */
function grow(k: Kit, children: Fields[]): { treeId: Id; root: Id; ids: Id[] } {
  const { treeId, nodeIds } = k.seedTree('Tree', ['Root']);
  const root = nodeIds[0]!;
  return { treeId, root, ids: children.map((fields) => hang(k, treeId, root, fields)) };
}

function hang(k: Kit, treeId: Id, parent: Id, { status = 'kept', why = '', importance, ...fields }: Fields): Id {
  const item = k.item({ text: saying(fields.data), ...fields });
  const node = makeNode(k.ctx, item, { treeId, parent, status, why, importance, origin: USER });
  k.mind.apply({ origin: USER, label: 'hang', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
  return node.id;
}

/** Runs the Renderer, checks every command against the libraries, and applies them. */
async function render(k: Kit, nodeIds: Id[], edited: Id[] = []): Promise<Command[]> {
  const commands = await renderer(k.ctx, { nodeIds, edited });
  for (const c of commands) {
    if (c.type === 'setView') {
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
  return { component: 'note', subject: '', passage: '', by: '', tone: '', lines: [], labels: [], numbers: [], left: [], right: [], unit: '', emphasis: '', sections: [], controls: [], formula: '', ...fields };
}

function proposal(fields: Partial<CompositesReply['groups'][number]> & { parent: Id; members: Id[] }): CompositesReply['groups'][number] {
  return { composite: 'cluster', title: '', labels: [], criteria: [], cells: [], theme: '', reasons: [], changes: [], axes: [], parts: [], ...fields };
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
    { title: 'Stat', text: '42% churn in month one.' },
    { title: 'Budget', text: 'Budget: $1.2M' },
    { title: 'Leavers', text: '42% of users leave in month one.' },
  ]);
  const [bar, line, steps, quote, person, code, script, fact, valueFirst, labelFirst, phrase] = ids as [Id, Id, Id, Id, Id, Id, Id, Id, Id, Id, Id];
  k.model.on('renderer.composites', () => ({ groups: [] }));
  await render(k, ids);

  assert.deepEqual(view(k, bar).props, { chart: 'bar', labels: ['North', 'South'], values: [4, 9], unit: 'units' });
  assert.equal(view(k, line).props.chart, 'line', 'years in order read as a line');
  assert.deepEqual(view(k, steps), { component: 'steps', props: { steps: ['Boil water', 'Add pasta'] }, by: 'renderer' });
  assert.deepEqual(view(k, quote).props, { text: 'Invent the future.' }, 'the item does not write who said it, so the card does not name him');
  assert.deepEqual(view(k, person), { component: 'person', props: { name: 'Agnès Varda', role: 'Director' }, by: 'renderer' });
  assert.deepEqual(view(k, code).props, { language: 'ts', source: 'const a = 1;' });
  assert.equal(view(k, script).component, 'code');
  assert.deepEqual(view(k, fact), { component: 'fact', props: { value: '4.2', label: 'Monthly churn' }, by: 'renderer' });
  assert.deepEqual(view(k, valueFirst).props, { value: '42%', label: 'churn in month one' }, 'the label is the rest of the line as it is written');
  assert.deepEqual(view(k, labelFirst).props, { value: '$1.2M', label: 'Budget' }, 'the label is the words before the colon');
  assert.deepEqual(view(k, phrase).props, { value: '42%', label: 'of users leave in month one' }, 'the label keeps the "of" that joins it to its value, as the line writes it');
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
  const text = 'Alan Kay: “the best way to predict\nthe future is to invent it”.';
  const { ids } = grow(k, [{ title: 'On the future', text }, { title: 'Plain', text: LONG }]);
  k.model.on('renderer.components', () => ({
    items: [
      entry({ id: ids[0]!, component: 'quote', passage: '"the best way to predict the future is to invent it"', by: 'Alan Kay' }),
      entry({ id: ids[1]!, component: 'note', emphasis: LONG }),
      entry({ id: 'nobody', component: 'fact', passage: '1', subject: 'x' }),
    ],
  }));
  const commands = await render(k, ids);

  assert.deepEqual(view(k, ids[0]!), {
    component: 'quote',
    props: { text: 'the best way to predict\nthe future is to invent it', by: 'Alan Kay' },
    by: 'renderer',
  });
  assert.deepEqual(view(k, ids[1]!).props, { emphasis: LONG });
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
      entry({ id: ids[0]!, component: 'quote', passage: 'Cinema is truth at 24 frames a second', by: 'Godard' }),
      entry({ id: ids[1]!, component: 'chart', labels: ['March', 'April', 'May'], numbers: [12, 30, 45] }),
      entry({ id: ids[2]!, component: 'fact', passage: '33%', subject: 'Failure rate' }),
      entry({ id: ids[3]!, component: 'steps', lines: ['scout the house', 'light it', 'shoot it'] }),
    ],
  }));
  await render(k, ids);
  for (const id of ids) assert.deepEqual(view(k, id), { component: 'note', props: {}, by: 'renderer' }, 'the note stays, and the model has answered');
});

test('a chart and steps taken from the text are accepted, with the heading over them, and a chart of the figures in a sentence is not', async () => {
  const k = kit();
  const { ids } = grow(k, [
    { title: 'Builds', text: 'Builds we shipped:\nMarch: 1,200 builds\nApril: 3,050 builds' },
    { title: 'Shoot', text: 'How we do it:\n1. Scout the house\n2. Light it\n3. Shoot at dusk' },
    { title: 'Builds in a sentence', text: 'We shipped 1,200 builds in March and 3,050 builds in April.' },
  ]);
  const chart = { labels: ['March', 'April'], numbers: [1200, 3050], unit: 'builds' };
  k.model.on('renderer.components', () => ({
    items: [
      entry({ id: ids[0]!, component: 'chart', ...chart }),
      entry({ id: ids[1]!, component: 'steps', lines: ['Scout the house', 'Light it', 'Shoot at dusk'] }),
      entry({ id: ids[2]!, component: 'chart', ...chart }),
    ],
  }));
  await render(k, ids);
  assert.deepEqual(view(k, ids[0]!).props, { chart: 'bar', labels: ['March', 'April'], values: [1200, 3050], unit: 'builds', above: ['Builds we shipped:'] }, 'the chart is drawn under the line that heads it');
  assert.deepEqual(view(k, ids[1]!).props, { steps: ['Scout the house', 'Light it', 'Shoot at dusk'], above: ['How we do it:'] }, 'the steps are drawn under the line that heads them');
  assert.equal(view(k, ids[2]!).component, 'note', 'a chart would leave out the words of the sentence around its figures');
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

test('a layout the model describes is set as a tree labelled in the words of its members, and one nested five deep is set aside with a note', async () => {
  const k = kit();
  const { root, ids } = grow(k, [
    { title: 'Eat: grilled sardines in Alfama', summary: 'Smoke on every corner in June.' },
    { title: 'Eat: pastéis de nata at Belém', summary: 'Warm from the oven.' },
    { title: 'See: Tram 28 at dawn', summary: 'Before the crowds.' },
    { title: 'See: the tiled station at São Bento', summary: 'Twenty thousand tiles.' },
  ]);
  const [a, b, c, d] = ids as [Id, Id, Id, Id];
  const part = (id: string, parent: string, kind: CompositesReply['groups'][number]['parts'][number]['kind'], label = '') => ({ id, parent, kind, role: 'normal' as const, label, join: 'none' as const });
  k.model.on('renderer.composites', () => ({
    groups: [proposal({
      parent: root,
      composite: 'layout',
      title: 'Lisbon',
      members: [],
      parts: [part('all', '', 'row', 'Three days'), part('eat', 'all', 'column', 'Eat'), part('see', 'all', 'column', 'See'), part('wrap', 'see', 'row'), part(a, 'eat', 'card'), part(b, 'eat', 'card'), part(c, 'wrap', 'card'), part(d, 'wrap', 'card')],
    })],
  }));
  await render(k, ids);
  const card = (id: Id) => ({ kind: 'card', id, role: 'normal' });
  assert.deepEqual(groups(k).map((g) => [g.composite, g.title, g.members, g.props]), [
    ['layout', 'Lisbon', [a, b, c, d], { tree: { kind: 'row', children: [{ kind: 'column', label: 'Eat', children: [card(a), card(b)] }, { kind: 'column', label: 'See', children: [{ kind: 'row', children: [card(c), card(d)] }] }] } }],
  ], 'a label no member states is dropped');

  const deep = kit();
  const tree = grow(deep, [{ title: 'one' }, { title: 'two' }, { title: 'three' }, { title: 'four' }]);
  const nest = ['b1', 'b2', 'b3', 'b4', 'b5'].map((id, n) => part(id, n === 0 ? '' : `b${n}`, 'row'));
  deep.model.on('renderer.composites', () => ({ groups: [proposal({ parent: tree.root, composite: 'layout', members: [], parts: [...nest, ...tree.ids.map((id) => part(id, 'b5', 'card'))] })] }));
  await render(deep, tree.ids);
  assert.deepEqual(groups(deep), []);
  assert.ok(deep.notes.some((note) => /layout .* 5 containers deep/.test(note)), deep.notes.join('\n'));
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
  assert.deepEqual(view(k, ids[1]!), { component: 'note', props: {}, by: 'default' });
  assert.deepEqual(
    commands.map((c) => c.type),
    ['setView', 'setGroup'],
  );
  assert.deepEqual(k.model.calls.map((c) => c.role).sort(), ['renderer.components', 'renderer.composites'], 'a call that got no answer is not asked again in halves');
  assert.deepEqual(k.notes.map((n) => n.replace(/\(.*\)/, '()')).sort(), [
    'renderer: A call to choose components for 1 item failed (). Kept the rule-based views of it.',
    'renderer: The model could not look for composites (). Kept the rule-based groups.',
  ]);
});

// ---- the six arrangements of the second pass

const picture = (title: string): Fields => ({ title, kind: 'image', source: { from: 'drop', asset: title, capturedAt: '' } });
const figure = (label: string, value: string): Fields => ({ title: label, data: { facts: [{ label, value }] } });
const chart = (title: string): Fields => ({ title, data: { chart: { labels: ['2022', '2023', '2024'], values: [1.2, 2.5, 4.1], unit: 'M' } } });
const SWATCH: Fields = { title: 'Palette', text: 'Ember #E4572E and Lagoon #17BEBB', data: { colours: [{ name: 'Ember', value: '#E4572E' }, { name: 'Lagoon', value: '#17BEBB' }] } };
const IDEA: Fields = { title: 'Paint the door ochre', text: 'Paint the door ochre' };
const arranged = (k: Kit) => groups(k).map((g) => [g.composite, g.members]);

test('three facts and a chart under one parent are an overview with the figures first, and two charts or six facts are not', async () => {
  const k = kit();
  const { ids } = grow(k, [figure('Height', '330 m'), chart('Visitors'), figure('Built', '1889'), figure('Floors', '3'), { title: 'A note', text: PLAIN }]);
  await render(k, ids);
  assert.deepEqual(ids.map((id) => view(k, id).component), ['fact', 'chart', 'fact', 'fact', 'note']);
  assert.deepEqual(arranged(k), [['overview', [ids[0], ids[2], ids[3], ids[1]]]]);
  assert.deepEqual(await render(k, ids), [], 'an overview that still holds is left alone');

  for (const pool of [[figure('Height', '330 m'), figure('Built', '1889'), chart('Visitors'), chart('Tickets')], [...['b', 'c', 'd', 'e', 'f', 'g'].map((n) => figure(`Floor ${n}`, '3')), chart('Visitors')], [figure('Height', '330 m'), chart('Visitors')]]) {
    const none = kit();
    none.model.on('renderer.composites', () => ({ groups: [] }));
    await render(none, grow(none, pool).ids);
    assert.deepEqual(arranged(none), [], `${pool.length} siblings`);
  }
});

test('two pictures, a swatch and an idea are a moodboard, three pictures alone stay a gallery, and an idea that joins them makes the gallery a moodboard', async () => {
  const k = kit();
  const { ids } = grow(k, [picture('a'), SWATCH, picture('b'), IDEA]);
  await render(k, ids);
  assert.deepEqual(ids.map((id) => view(k, id).component), ['image', 'swatch', 'image', 'idea']);
  assert.deepEqual(arranged(k), [['moodboard', ids]]);

  const pictures = kit();
  const { treeId, root, ids: three } = grow(pictures, [picture('a'), picture('b'), picture('c')]);
  await render(pictures, three);
  assert.deepEqual(arranged(pictures), [['gallery', three]]);
  const idea = hang(pictures, treeId, root, IDEA);
  assert.deepEqual((await render(pictures, [idea])).map((c) => c.type), ['setView', 'removeGroup', 'setGroup']);
  assert.deepEqual(arranged(pictures), [['moodboard', [...three, idea]]]);

  for (const pool of [[picture('a'), SWATCH, IDEA, IDEA], [picture('a'), picture('b'), SWATCH]]) {
    const none = kit();
    none.model.on('renderer.composites', () => ({ groups: [] }));
    await render(none, grow(none, pool).ids);
    assert.deepEqual(arranged(none), [], 'one picture, or three siblings');
  }
});

test('an overview or a moodboard whose rule no longer holds is removed', async () => {
  const k = kit();
  k.model.on('renderer.composites', () => ({ groups: [] }));
  const { treeId, root, ids } = grow(k, [figure('Height', '330 m'), figure('Built', '1889'), chart('Visitors')]);
  await render(k, ids);
  assert.equal(groups(k)[0]?.composite, 'overview');
  const second = hang(k, treeId, root, chart('Tickets'));
  assert.deepEqual((await render(k, [second])).map((c) => c.type), ['setView', 'removeGroup']);
  assert.deepEqual(arranged(k), []);
});

const ALFAMA = { lat: 38.7139, lon: -9.1334 };
/** About 35 m from ALFAMA, as a second photo taken on the same street is. */
const ALFAMA_TOO = { lat: 38.7141, lon: -9.1337 };
const PORTO_AT = { lat: 41.1406, lon: -8.611 };
const EVORA = { lat: 38.5714, lon: -7.9135 };
const photo = (title: string, at: { lat: number; lon: number }): Fields => ({ title, kind: 'image', source: { from: 'drop', asset: title, capturedAt: '' }, data: { at } });

test('four photos from three places are a map before they are a gallery, with one pin for each place and the photos in pin order', async () => {
  const k = kit();
  const { root, ids } = grow(k, [photo('Alfama', ALFAMA), photo('Porto', PORTO_AT), photo('Alfama again', ALFAMA_TOO), photo('Évora', EVORA), { title: 'A note', text: PLAIN }]);
  await render(k, ids);
  const [alfama, porto, again, evora] = ids as [Id, Id, Id, Id];

  assert.deepEqual(arranged(k), [['map', [alfama, again, porto, evora]]]);
  const map = groups(k)[0]!;
  assert.equal(map.anchor, root);
  assert.deepEqual(map.props.pins, [{ ...ALFAMA, members: [alfama, again] }, { ...PORTO_AT, members: [porto] }, { ...EVORA, members: [evora] }]);
  assert.equal(map.props.zoom, 6, 'the largest zoom at which Porto and Évora both fit');
  assert.deepEqual(await render(k, ids), [], 'a map that still holds is left alone');
});

test('three photos taken at one place are no map, and stay a gallery', async () => {
  const k = kit();
  const { ids } = grow(k, [photo('Door', ALFAMA), photo('Window', ALFAMA_TOO), photo('Tiles', { lat: 38.7137, lon: -9.1331 })]);
  await render(k, ids);
  assert.deepEqual(arranged(k), [['gallery', ids]]);
});

test('siblings with both a date and a place are a map before they are a timeline, pinned in date order', async () => {
  const k = kit();
  const event = (title: string, when: string, at: { lat: number; lon: number }): Fields => ({ title, text: PLAIN, data: { when, at } });
  const { ids } = grow(k, [
    event('The earthquake', '1755', ALFAMA),
    event('The first shipment of port', '1678', PORTO_AT),
    event('The university moves to Coimbra', '1537', { lat: 40.2033, lon: -8.4103 }),
    event('The Pena Palace is built', '1854', { lat: 38.7876, lon: -9.3906 }),
    event('The Roman temple is restored', '1871', EVORA),
  ]);
  await render(k, ids);
  const [lisbon, port, coimbra, sintra, evora] = ids as [Id, Id, Id, Id, Id];

  assert.deepEqual(arranged(k), [['map', [coimbra, port, lisbon, sintra, evora]]]);
  assert.deepEqual(
    (groups(k)[0]!.props.pins as { members: Id[] }[]).map((pin) => pin.members),
    [[coimbra], [port], [lisbon, sintra], [evora]],
    'Sintra is under the pin of Lisbon, a few px away on a map of all of Portugal',
  );
});

/** Five picks that each answer which lens to take, and a model that ranks them. */
function lenses(status: Node['status'] = 'pick') {
  const k = kit();
  const pick = (title: string, said: string): Fields => ({ title, summary: said, text: said, status, why: 'One answer to which lens to take' });
  const { root, ids } = grow(k, [
    pick('Summicron 35', 'Small and sharp. It costs the most.'),
    pick('Nokton 40', 'Fast and cheap. The focus throw is long.'),
    pick('Planar 50', 'Sharp at every stop.'),
    pick('Elmar 24', 'Wide enough for rooms.'),
    pick('Jupiter 8', 'A Soviet copy of the Sonnar.'),
  ]);
  const order = [ids[2]!, ids[0]!, ids[1]!, ids[4]!, ids[3]!] as const;
  k.model.on('renderer.composites', () => ({
    groups: [
      proposal({ parent: root, composite: 'ranked', title: 'Which lens', members: [...order], reasons: ['sharp at every stop', 'Small and sharp, it costs the most', 'Fast and cheap.', 'Made in 1950.', ''] }),
    ],
  }));
  return { k, ids, order };
}

test('the model may rank picks best first, a reason stands only as the whole text of its own pick, and keeping one pick removes the ranking', async () => {
  const { k, ids, order } = lenses();
  await render(k, ids);
  const [ranked] = groups(k);
  assert.equal(ranked!.composite, 'ranked');
  assert.equal(ranked!.title, 'Which lens');
  assert.deepEqual(ranked!.members, [...order]);
  assert.deepEqual(
    ranked!.props.reasons,
    { [order[0]]: 'Sharp at every stop.', [order[1]]: 'Small and sharp. It costs the most.', [order[2]]: '', [order[3]]: '', [order[4]]: '' },
    'a reason is drawn as its pick writes it, its case and its stops, and one sentence of a pick that says more, or one the pick does not hold, is blank',
  );

  k.mind.apply({ origin: USER, label: 'keep', commands: [{ type: 'keepPick', id: ids[0]! }] });
  assert.deepEqual(await render(k, [ids[0]!]), [{ type: 'removeGroup', id: ranked!.id }]);

  const kept = lenses('kept');
  await render(kept.k, kept.ids);
  assert.deepEqual(arranged(kept.k), [], 'cards the user kept are not ranked');
});

test('the model may set states of one thing in order with each change between them, and a change that is not the whole text of either state is blank', async () => {
  const k = kit();
  const state = (title: string, said: string): Fields => ({ title, summary: said, text: said });
  const { root, ids } = grow(k, [
    state('The harbour wall in 2019', 'A wall of timber and patched concrete.'),
    state('The harbour wall in 2024', 'The council rebuilt the wall in stone. It stands two metres higher.'),
    state('The ferry', 'Runs all winter.'),
    state('The fish market', 'Empty since spring. It closed.'),
  ]);
  const [before, after, ferry, market] = ids as [Id, Id, Id, Id];
  const rebuilt = 'The council rebuilt the wall in stone. It stands two metres higher.';
  k.model.on('renderer.composites', () => ({
    groups: [
      proposal({ parent: root, composite: 'beforeafter', title: 'The wall', members: [before, after], changes: [rebuilt] }),
      proposal({ parent: root, composite: 'beforeafter', members: [ferry, market], changes: ['It closed.'] }),
    ],
  }));
  await render(k, ids);
  assert.deepEqual(
    groups(k).map((g) => [g.composite, g.members, g.props]),
    [
      ['beforeafter', [before, after], { changes: { [after]: rebuilt } }],
      ['beforeafter', [ferry, market], { changes: { [market]: '' } }],
    ],
    'a change that is one sentence of the later state, which says more, is blank',
  );
});

test('the model may lead with one member, and may set four members on two axes that their content names, each with a line of its own that stands whole', async () => {
  const k = kit();
  const idea = (title: string, said: string): Fields => ({ title, summary: said, text: said });
  const { root, ids } = grow(k, [
    idea('Fix the onboarding email', 'Little effort. A large impact on sign-ups.'),
    idea('Rebuild the editor', 'Months of effort, and a large impact.'),
    idea('Rename the settings tab', 'Little effort and little impact.'),
    idea('Port to the watch', 'Much effort for little impact.'),
    idea('Why sign-ups fell', 'The email went to spam for a month.'),
    idea('The spam report', 'Two in three emails were flagged.'),
    idea('What users said', 'Nobody saw the email.'),
  ]);
  k.model.on('renderer.composites', () => ({
    groups: [
      proposal({
        parent: root,
        composite: 'matrix',
        title: 'What to build',
        members: ids.slice(0, 4),
        axes: ['effort', 'impact'],
        reasons: ['Little effort. A large impact on sign-ups.', 'large impact', 'Little effort and little impact.', 'Much effort.'],
      }),
      proposal({ parent: root, composite: 'lead', title: 'Sign-ups', members: [ids[4]!, ids[5]!, ids[6]!] }),
    ],
  }));
  await render(k, ids);
  assert.deepEqual(
    groups(k).map((g) => [g.composite, g.members, g.props]),
    [
      ['matrix', ids.slice(0, 4), { x: 'effort', y: 'impact', reasons: { [ids[0]!]: 'Little effort. A large impact on sign-ups.', [ids[1]!]: '', [ids[2]!]: 'Little effort and little impact.', [ids[3]!]: '' } }],
      ['lead', [ids[4], ids[5], ids[6]], {}],
    ],
    'a fragment of a member, and words its text does not write whole, are blank',
  );

  for (const wrong of [
    proposal({ parent: root, composite: 'matrix', members: ids.slice(0, 4), axes: ['cost', 'impact'] }),
    proposal({ parent: root, composite: 'matrix', members: ids.slice(0, 3), axes: ['effort', 'impact'] }),
    proposal({ parent: root, composite: 'lead', members: ids.slice(4, 6) }),
  ]) {
    const again = kit();
    const tree = grow(again, ids.map((id) => ({ title: k.mind.itemOf(id).title, summary: k.mind.itemOf(id).summary, text: PLAIN })));
    again.model.on('renderer.composites', () => ({ groups: [{ ...wrong, parent: tree.root, members: wrong.members.map((id) => tree.ids[ids.indexOf(id)]!) }] }));
    await render(again, tree.ids);
    assert.deepEqual(arranged(again), [], `${wrong.composite} of ${wrong.members.length} on ${wrong.axes.join(' and ')}`);
  }
});

// ---- the card types chosen from an item's structure

const url = (id: string) => `/assets/${id}`;
const WEB = { from: 'web', capturedAt: '' };
const SCOUT = { by: 'agent' as const, role: 'scout' };

/** The component the rules give an item, and its props. */
function ruled(fields: Partial<Item> & { title: string }) {
  return byRule(kit().item({ text: saying(fields.data) || PLAIN, ...fields }), url);
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
  assert.deepEqual(ruled({ title: 'Many', data: { facts: eight.slice(0, 6) } }), { component: 'facts', props: { facts: eight.slice(0, 6) } }, 'six facts are a grid');
  assert.equal(chosen({ title: 'Many', data: { facts: eight } }), 'note', 'eight are not, as a grid of six would leave two of them out');
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
  assert.deepEqual(ruled({ title: 'Bring', text: '- [x] tent\n- [ ] stove', data: { items: ['tent', 'stove'], checklist: [true, false] } }).props, { items: ['tent', 'stove'], checked: [true, false] }, 'a mark is the check box its line writes');
  assert.equal(chosen({ title: 'Bring', text: '- [ ] tent\n- [x] stove', data: { items: ['tent', 'stove'], checklist: [true, false] } }), 'note', 'marks the lines do not write are no checklist of them');
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
  assert.deepEqual(ruled({ title: 'Parallax', data: { term: 'Parallax', definition: 'Parallax is an apparent shift.' } }), { component: 'definition', props: { term: 'Parallax', definition: 'Parallax is an apparent shift.' } });
  assert.equal(chosen({ title: 'Parallax', data: { term: 'Parallax', definition: ' ' } }), 'note');

  assert.deepEqual(ruled({ title: 'Space', data: { excerpt: { text: 'The house shelters day-dreaming.', at: 'Chapter 1' }, site: 'example.org', from: 'Books' } }).props, {
    text: 'The house shelters day-dreaming.', at: 'Chapter 1', source: 'example.org',
  });
  assert.equal((ruled({ title: 'Space', data: { excerpt: { text: 'The house.' }, from: 'Books' } }).props as { source: string }).source, 'Books');
  assert.equal(chosen({ title: 'Space', data: { excerpt: { text: '' } } }), 'note');

  assert.deepEqual(
    ruled({ title: 'Rust', data: { pros: ['fast'], cons: ['slow builds'] } }),
    { component: 'proscons', props: { pros: ['fast'], cons: ['slow builds'], heads: ['Pros:', 'Cons:'] } },
    'each side is drawn under the label the item gives it',
  );
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
  assert.equal(typed(`把${'书'.repeat(22)}`), 'idea', 'twenty-three characters of a script written without spaces');
  assert.equal(typed(`把${'书'.repeat(23)}`), 'note', 'twenty-four or more, which is room for a caution or a definition');
  assert.equal(typed(`ｈｏｗ ａｂｏｕｔ${' ｗｏｒｄ'.repeat(10)}`), 'idea', 'full-width letters are counted in their plain form, as a spaced script');
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
  ['definition', { term: 'Parallax', definition: 'Parallax is an apparent shift.' }],
  ['steps', { steps: ['Boil water', 'Add pasta'] }],
  ['list', { items: ['tent', 'stove'] }],
  ['quote', { quote: { text: 'Invent the future.', by: 'Alan Kay' } }],
  ['person', { person: { name: 'Agnès Varda', role: 'Director' } }],
  ['swatch', { colours: [{ name: 'Ember', value: '#E4572E' }, { name: 'navy', value: 'navy' }] }],
  ['facts', { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }] }],
  ['fact', { facts: [{ label: 'Height', value: '330 m' }] }],
  ['excerpt', { excerpt: { text: 'The house shelters day-dreaming.', at: 'Chapter 1' } }],
];

test('a structure draws its item only when its card shows the whole item, or a fifth of it for a person or a palette, and a long item keeps the drawing of its kind', () => {
  for (const [type, data] of PIECES) {
    assert.equal(chosen({ title: 'Short', data }), type, `${type} of a short note`);
    assert.equal(chosen({ title: 'Essay', text: ESSAY, data }), 'note', `${type} inside an essay`);
    assert.equal(chosen({ ...LINKED, title: 'Article', text: ESSAY, data }), 'link', `${type} inside a saved page`);
  }
  const long = kit().item({ title: 'Essay', text: ESSAY, data: { facts: [{ label: 'Height', value: '330 m' }] } });
  assert.deepEqual(byRule(long, url), { component: 'note', props: {} }, 'a fact is no whole essay');
  assert.deepEqual(long.data.facts, [{ label: 'Height', value: '330 m' }], 'the structure stays with the item');
});

test('a person card shows its whole item, the name and the line that says who they are, or the item is a note', () => {
  const person = { name: 'Amir Haddad', role: "Consultant cardiologist at St Mary's." };
  const drawn = (text: string, data: Record<string, unknown> = { person }) => ruled({ title: 'A title the model wrote', text, data });
  assert.deepEqual(drawn("Amir Haddad\nConsultant cardiologist at St Mary's."), { component: 'person', props: person }, 'the name and the role are all it says');
  assert.deepEqual(drawn('Amir Haddad', { person: { name: 'Amir Haddad' } }), { component: 'person', props: { name: 'Amir Haddad' } }, 'a name alone');
  const struck = "Amir Haddad\nConsultant cardiologist at St Mary's.\nStruck off in March 2026 for falsifying trial data.";
  assert.equal(drawn(struck).component, 'note', 'a line the card would leave out keeps the item a note');
  assert.equal(drawn(`${'x'.repeat(79)}\n\n${'y'.repeat(20)}`, { person: { name: 'y'.repeat(20) } }).component, 'note', 'a name is no share of its item');
  assert.equal(drawn('Rumoured: Chief Scientist at NASA.\nAmir Haddad', { person: { name: 'Amir Haddad', role: 'Chief Scientist at NASA.' } }).component, 'note', 'a role is the line after the name, in order');
  assert.deepEqual(
    ruled({ title: 'A title the model wrote', text: `${'x'.repeat(80)}\n\n${'y'.repeat(19)}`, data: { quote: { text: 'y'.repeat(19) } } }),
    { component: 'quote', props: { text: 'y'.repeat(19), above: ['x'.repeat(80)] } },
    'a quote shows the whole item, with the line before it drawn over it',
  );
});

test('the same lines are the same card whatever title the model gave them', () => {
  for (const title of ['Milk and eggs', "Things to pick up for Saturday's dinner party"]) assert.equal(chosen({ title, text: 'Milk\nEggs', data: { items: ['Milk', 'Eggs'] } }), 'list', title);
  for (const title of ['买菜', '明天去超市要买的两样东西']) assert.equal(chosen({ title, text: '酱油\n姜', data: { items: ['酱油', '姜'] } }), 'list', title);
});

test('a chart or a breakdown a source carried draws its pick however long the words beside it, and one read off a long text the user made does not', () => {
  const years = ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022'];
  const values = [12.1, 12.4, 12.9, 13.3, 13.8, 14.6, 15.2, 15.9];
  const series = years.map((year, n) => `${year}: ${values[n]}`).join(', ');
  const measured = 'Measured: share of electricity from wind, percent';
  const text = `${LONG} ${LONG} ${LONG}\n\n${measured}\n\n${series}`;
  const pick = { title: 'Share of electricity from wind', text, origin: SCOUT, source: { ...WEB, url: 'https://data.example.org/grapher/wind-share' } };
  assert.deepEqual(ruled({ ...pick, data: { chart: { labels: years, values }, site: 'data.example.org' } }), { component: 'chart', props: { chart: 'line', labels: years, values } }, 'a record draws as itself');
  assert.equal(chosen({ title: pick.title, text, data: { chart: { labels: years, values } } }), 'note', 'the same chart, read off a text the user pasted, would leave out prose too long to draw over it');
  assert.deepEqual(
    ruled({ title: pick.title, text: `${LONG} ${LONG}\n\n${measured}\n\n${series}`, data: { chart: { labels: years, values } } }),
    { component: 'chart', props: { chart: 'line', labels: years, values, above: [`${LONG} ${LONG}`, measured] } },
    'under two sentences of prose, which it draws over itself, the chart is the whole item',
  );

  const shares = { labels: ['Coal', 'Gas', 'Wind', 'Other'], values: [40, 30, 20, 10], unit: '%' };
  assert.equal(chosen({ ...pick, text: ESSAY, data: { chart: shares } }), 'breakdown', 'a record of shares draws as itself beside an essay');
  assert.equal(chosen({ title: pick.title, text: ESSAY, data: { chart: shares } }), 'note', 'shares read off an essay are no whole item of it');
  assert.equal(chosen({ ...pick, text: ESSAY, data: { steps: ['Boil', 'Stir'] } }), 'excerpt', 'steps no source carried are held to the long passage beside them, which they are not');
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

test('a structure with more entries than its card shows is no card of its item, however much of the item they are', () => {
  const eight = Array.from({ length: 8 }, (_v, n) => ({ label: 'L', value: `${n}` }));
  const written = (count: number) => `${'x'.repeat(20)}\n${saying({ facts: eight.slice(0, count) })}`;
  assert.deepEqual(ruled({ title: '', text: written(6), data: { facts: eight.slice(0, 6) } }), { component: 'facts', props: { facts: eight.slice(0, 6), above: ['x'.repeat(20)] } }, 'six facts are a grid, under the line over them');
  assert.equal(chosen({ title: '', text: written(8), data: { facts: eight } }), 'note', 'a grid of six of eight facts would leave two of them out');
  assert.equal(chosen({ title: '', text: '1. Boil\n2. Stir', data: { steps: ['Boil', 'Stir'] } }), 'steps', 'steps that are all of the words');
  assert.equal(chosen({ title: '', text: '', data: { steps: ['Boil', 'Stir'] } }), 'note', 'an item with no words of its own states no step');
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
  // Two cards both stand only on words that are the whole item for each of them.
  const shares = { heads: ['Part', 'Share'], rows: [['Rent', '60%'], ['Food', '40%']] };
  const plans = { heads: ['Plan', 'Price'], rows: [['Solo', '$8'], ['Team', '$20']] };
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
    ['breakdown', 'table', { text: saying({ table: shares }), data: { chart: percent, table: shares } }],
    ['table', 'link', { ...LINKED, data: { table } }],
    ['table', 'facts', { text: saying({ table: plans }), data: { table: plans, facts: [{ label: 'Solo', value: '$8' }, { label: 'Team', value: '$20' }] } }],
    ['proscons', 'list', { text: '- Pros: fast\n- Cons: slow', data: { pros: ['fast'], cons: ['slow'], items: ['Pros: fast', 'Cons: slow'] } }],
    ['qa', 'definition', { data: { question: 'What is parallax?', answer: 'A shift.', term: 'Parallax', definition: 'Parallax is a shift.' } }],
    ['steps', 'list', { text: '1. Boil\n2. Stir', data: { steps: ['Boil', 'Stir'], items: ['Boil', 'Stir'] } }],
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
    ['list', 'idea', { title: 'Bring', text: '- tent\n- stove', data: { items: ['tent', 'stove'] } }],
    ['place', 'idea', { title: 'West Lake Hangzhou', text: '', data: { where: 'West Lake Hangzhou' } }],
  ];
  for (const [first, second, fields] of pairs) assert.equal(chosen({ title: 'Both', ...fields }), first, `${first} before ${second}`);

  assert.equal(chosen({ ...LINKED, title: 'Article', text: ESSAY, data: { table } }), 'link', 'a table that is no whole essay gives way to the link');
});

test('an item that is code draws as code, whatever was read off it and however little of it that was', () => {
  const constants = Array.from({ length: 6 }, (_v, n) => `LIMIT_${n} = ${n * 10}`).join('\n');
  const facts = Array.from({ length: 6 }, (_v, n) => ({ label: `LIMIT_${n}`, value: `${n * 10}` }));
  assert.equal(chosen({ title: 'limits.ini', text: constants, data: { facts } }), 'facts', 'the same text, when it is not code, is its facts');
  assert.deepEqual(ruled({ title: 'limits.ini', text: constants, data: { facts, code: { source: constants } } }), { component: 'code', props: { language: 'text', source: constants } }, 'code that was read as facts');
  assert.equal(chosen({ title: 'limits.ini', kind: 'code', text: constants, data: { facts } }), 'code', 'an item of the kind code');

  const source = 'def rate(tier):\n    \"\"\"\n    tier | rate\n    free | 10\n    pro  | 100\n    \"\"\"\n    return RATES[tier]';
  const table = { heads: ['tier', 'rate'], rows: [['free', '10'], ['pro', '100']] };
  assert.equal(chosen({ title: 'rate', text: source, data: { table } }), 'note', 'the table is no whole item of the function around it');
  assert.equal(chosen({ title: 'rate', text: source, data: { table, code: { language: 'python', source } } }), 'code', 'a table in a docstring does not draw the function');

  assert.equal(chosen({ title: 'Snippet', text: ESSAY, data: { code: { source: 'const a = 1;' } } }), 'code', 'code has no floor');
  assert.equal(chosen({ ...LINKED, title: 'Gist', data: { code: { source: 'const a = 1;' } } }), 'code');
  assert.equal(chosen({ title: 'Empty', kind: 'code', text: '' }), 'note', 'code with no source is a note');
  assert.equal(chosen({ title: 'Empty', kind: 'code', text: '', data: { code: { source: '' } } }), 'note');
  assert.equal(chosen({ title: 'Agnès Varda', kind: 'code', text: '', data: { person: { name: 'Agnès Varda', role: 'Director' } } }), 'note', 'a person it carries is no card of its own: the card would show none of its words');
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

test('a recording is drawn as one with what is known of its sound, whatever its transcript holds, and one with nothing to play is a note', () => {
  const sound = { seconds: 20, peaks: [0.1, 1, 0.4] };
  const transcript = { kind: 'audio' as const, text: 'Pros: quick. Cons: loud.', data: { sound, pros: ['quick'], cons: ['loud'], when: 'Thursday' } };
  const dropped = ruled({ title: 'Memo', ...transcript, source: { from: 'drop', asset: 'm1', capturedAt: '' } });
  assert.deepEqual(dropped, { component: 'audio', props: { src: '/assets/m1', ...sound } });
  const missing = ruled({ title: 'Memo', ...transcript });
  assert.deepEqual(missing, { component: 'note', props: {} }, 'a recording with no file is a note, and no rule reads its transcript');
  const episode = kit().item({
    title: 'Why the room seems to stretch', kind: 'audio', origin: SCOUT, text: 'Two cinematographers on the dolly zoom.',
    data: { mediaUrl: 'https://cdn.example/41.mp3', thumbnailUrl: 'https://cdn.example/41.jpg', sound: { seconds: 2520 }, site: 'podcasts.example' },
    source: { from: 'web', url: 'https://podcasts.example/41', capturedAt: '' },
  });
  assert.deepEqual(byRule(episode, url), { component: 'audio', props: { src: 'https://cdn.example/41.mp3', seconds: 2520 } }, 'a pick plays from the address its source gave');
  assert.ok(grounded(byRule(episode, url), episode, url) && grounded(dropped, kit().item({ title: 'Memo', ...transcript, source: { from: 'drop', asset: 'm1', capturedAt: '' } }), url));
  assert.equal(grounded({ component: 'audio', props: { src: 'https://cdn.example/41.mp3', seconds: 60 } }, episode, url), false, 'a length the item does not hold');
  assert.equal(chosen({ title: 'Memo', kind: 'audio', data: { mediaUrl: '   ' } }), 'note');
});

test('a conversation stays a chat whatever else its data holds', () => {
  const messages = [{ role: 'user', text: 'How?' }, { role: 'assistant', text: 'Like so.' }];
  const data = { messages, steps: ['Boil', 'Stir'], table: { heads: ['a', 'b'], rows: [['1', '2']] }, where: 'Talk' };
  assert.equal(chosen({ title: 'Talk', kind: 'chat', data }), 'chat');
  assert.equal(chosen({ title: 'Talk', kind: 'chat', data: { steps: ['Boil', 'Stir'] } }), 'note', 'with no message to show it is a note');
});

test('every sample is drawn as its type, with props the library accepts and the item states', () => {
  assert.deepEqual(Object.keys(CHECKS), COMPONENT_IDS, 'every component has a content check');
  assert.equal(COMPONENT_IDS.length, 28);
  for (const id of STRUCTURED_IDS) {
    const { item, props } = SAMPLES[id];
    const made = byRule(item, sampleAssetUrl);
    if (id === 'callout' || id === 'sheet' || id === 'explorable') assert.equal(made.component, 'note', `no rule chooses a ${id}`);
    else assert.deepEqual(made, { component: id, props });
    assert.ok(isValidView({ component: id, props }), `${id} props are valid`);
    assert.ok(grounded({ component: id, props }, item, sampleAssetUrl), `${id} props stand in the item`);
  }
  assert.ok(/[一-鿿]/.test(SAMPLES.list.item.title + SAMPLES.qa.item.title + SAMPLES.idea.item.title + SAMPLES.place.item.title));

  assert.equal(SHEETS.length, 3);
  for (const { item, props } of SHEETS) {
    assert.ok(isValidView({ component: 'sheet', props }), `the sheet for ${item.title} is valid`);
    assert.ok(grounded({ component: 'sheet', props }, item, sampleAssetUrl), `the sheet for ${item.title} stands in the item`);
  }
  assert.ok(SHEETS.some(({ item }) => /[一-鿿]/.test(item.title)));
  assert.deepEqual([...new Set(SHEETS.flatMap(({ props }) => props.sections.map((section) => section.kind)))].sort(), ['excerpt', 'figures', 'heading', 'list', 'table', 'text']);

  assert.deepEqual(EXPLORABLES.map(({ props }) => props.controls.map((control) => control.kind).join()), ['slider', 'segmented', 'toggle']);
  for (const { item, props } of EXPLORABLES) assert.ok(grounded({ component: 'explorable', props }, item, sampleAssetUrl), `the explorable for ${item.title} stands in the item`);
  assert.ok(EXPLORABLES.some(({ item }) => /[一-鿿]/.test(item.title)));
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
    sheet: [
      { sections: [{ kind: 'heading', text: 'Ten days is safer' }, ...p('sheet').sections.slice(1)] },
      { sections: [p('sheet').sections[0], { kind: 'text', text: 'The authors conclude that ten days is enough for a child treated at home.' }, p('sheet').sections[2]] },
      { sections: [...p('sheet').sections.slice(0, 2), { kind: 'figures', facts: [{ label: 'Children randomised', value: '842' }] }] },
      { sections: [...p('sheet').sections.slice(0, 2), { kind: 'list', items: ['amoxicillin', 'penicillin'] }] },
      { sections: [...p('sheet').sections.slice(0, 2), { kind: 'table', heads: ['Group', 'Failed'], rows: [['five days', '12.6%'], ['ten days', '21.4%']] }] },
      { sections: [...p('sheet').sections.slice(0, 2), { kind: 'excerpt', text: 'five days is enough', by: 'The Lancet' }] },
      { sections: [...p('sheet').sections.slice(0, 2), { kind: 'picture', src: 'https://elsewhere.example/x.jpg' }] },
    ],
    explorable: [
      { ...p('explorable'), controls: [{ ...p('explorable').controls[0], values: [24, 86, 200] }] },
      { ...p('explorable'), controls: [{ ...p('explorable').controls[0], label: 'zoom' }] },
      { ...p('explorable'), controls: [{ ...p('explorable').controls[0], unit: 'inches' }] },
      { ...p('explorable'), output: { ...p('explorable').output, values: [73.7, 39.6, 10.4] } },
      { ...p('explorable'), output: { ...p('explorable').output, label: 'angle of view' } },
      { ...p('explorable'), output: { ...p('explorable').output, formula: [...p('explorable').output.formula, 1.05, '*'] } },
      { ...p('explorable'), output: { ...p('explorable').output, formula: [...p('explorable').output.formula, 'g', '*'] } },
    ],
  };
  for (const id of STRUCTURED_IDS) {
    assert.ok(unstated[id].length > 0);
    unstated[id].forEach((props, n) => assert.equal(grounded({ component: id, props }, SAMPLES[id].item, sampleAssetUrl), false, `${id} #${n + 1} is refused`));
  }
  const uncut = { ...SAMPLES.reference.item, data: { ...SAMPLES.reference.item.data, authorsCut: undefined } };
  assert.equal(grounded({ component: 'reference', props: p('reference') }, uncut, sampleAssetUrl), false, 'further authors the source does not report');
});

test('a view of an older type is checked the same way, and a prop no schema describes is refused', () => {
  const said = (text: string) => kit().item({ title: 'Churn', text, summary: 'Churn is down.' });
  const sentence = said('Churn fell to 4.2% in March, from 14.2% a year before.');
  const ok = (component: string, props: Record<string, unknown>, item = sentence) => grounded({ component, props }, item, url);
  const line = said('Churn in March: 4.2%');
  assert.ok(ok('fact', { value: '4.2%', label: 'Churn in March' }, line), 'a fact that is its line');
  assert.equal(ok('fact', { value: '4.2%', label: 'Monthly churn' }, line), false, 'a label the line does not write');
  assert.equal(ok('fact', { value: '2%', label: 'Churn in March' }, line), false, 'a number inside another number');
  assert.equal(ok('fact', { value: '4.2%', label: ' ' }, line), false, 'a blank label');
  assert.equal(ok('fact', { value: '4.2%', label: 'Churn in March' }), false, 'a label gathered from around its value leaves the rest of the sentence out');
  assert.ok(ok('note', { emphasis: 'Churn fell to 4.2% in March, from 14.2% a year before.' }), 'words set large that are the sentence');
  assert.equal(ok('note', { emphasis: 'fell to 4.2%' }), false, 'words set large are whole sentences');
  assert.equal(ok('note', { emphasis: 'arch' }), false, 'letters inside another word');
  const lines = said('March: 4.2%\nA year before: 14.2%');
  assert.ok(ok('chart', { chart: 'bar', labels: ['March', 'A year before'], values: [4.2, 14.2], unit: '%' }, lines), 'a chart that is its lines');
  assert.equal(ok('chart', { chart: 'bar', labels: ['March', 'A year before'], values: [4.2, 14], unit: '%' }, lines), false, 'a value the line does not write');
  assert.equal(ok('chart', { chart: 'bar', labels: ['March', 'year before'], values: [4.2, 14.2], unit: '%' }, lines), false, 'a label without the article its line writes');
  assert.equal(ok('chart', { chart: 'bar', labels: ['March', 'A year before'], values: [4.2, 14.2] }, lines), false, 'values without the percent sign their lines write');
  assert.equal(ok('chart', { chart: 'bar', labels: ['March', 'year before'], values: [4.2, 14.2], unit: '%' }), false, 'a chart of the figures in a sentence leaves its other words out');
  assert.equal(ok('link', { url: 'https://elsewhere.example', site: 'elsewhere.example' }), false, 'an address the item does not have');
  assert.equal(ok('idea', {}), true, 'an idea shows nothing but the item');
  assert.equal(ok('idea', { size: 'huge' }), false, 'a prop no schema describes');
  assert.equal(ok('unheard-of', {}), false, 'a component the library does not have');
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
    k.item({ title: 'Director', text: 'Agnès Varda\nDirector', data: { person: { name: 'Agnès Varda', role: 'Director' } } }),
    k.item({ title: 'Sales', text: 'North: 4 units\nSouth: -9 units', data: { chart: { labels: ['North', 'South'], values: [4, -9], unit: 'units' } } }),
    k.item({ title: 'Kay', text: 'Alan Kay: "Invent the future."', data: { quote: { text: 'Invent the future.', by: 'Alan Kay' } } }),
    k.item({ title: 'Recipe', text: '1. Boil water\n2. Add pasta', data: { steps: ['Boil water', 'Add pasta'] } }),
    k.item({ title: 'Churn', text: 'Monthly churn: 4.2', data: { facts: [{ label: 'Monthly churn', value: 4.2 }] } }),
  ];
  assert.deepEqual(made.map((item) => byRule(item, url).component), ['image', 'video', 'link', 'chat', 'code', 'person', 'chart', 'quote', 'steps', 'fact'], 'each item is drawn as its kind or its structure');
  for (const item of made) assert.ok(grounded(byRule(item, url), item, url), `${byRule(item, url).component} stands`);
});

test('a time or a date is no fact', () => {
  for (const text of ['Flight home at 10:45', 'Dinner 7:30', 'Meeting: 3pm', 'Doors: 9 a.m.', 'Due: 15 March', 'Born: 3/15/1990', 'Launch 2024-03: 15']) {
    assert.equal(chosen({ title: text, text }), 'note', text);
  }
  assert.deepEqual(ruled({ title: 'Budget', text: 'Budget: $1.2M' }).props, { value: '$1.2M', label: 'Budget' });
  assert.deepEqual(ruled({ title: 'Seats', text: 'Seats = 40' }).props, { value: '40', label: 'Seats' });
});

test('a fact with no value is passed over, and the facts that have one are drawn when they are the whole item', () => {
  const facts = [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '' }, { label: 'Floors', value: '3' }];
  assert.deepEqual(ruled({ title: 'Tower', text: 'Height: 330 m\nFloors: 3', data: { facts } }).props, { facts: [{ label: 'Height', value: '330 m' }, { label: 'Floors', value: '3' }] }, 'a fact with no value is passed over');
  assert.equal(chosen({ title: 'Tower', data: { facts } }), 'note', 'a grid would leave out the line that writes a label with no value');
  assert.deepEqual(ruled({ title: 'Tower', text: 'Height: 330 m', data: { facts: facts.slice(0, 2) } }), { component: 'fact', props: { value: '330 m', label: 'Height' } }, 'the one fact that has a value');
  assert.equal(chosen({ title: 'Tower', data: { facts: facts.slice(1, 2) } }), 'note', 'a label with no value is no fact');
});

test('a chart keeps a unit the text writes against its values, and a value written in its magnitude', async () => {
  const k = kit();
  const revenue = 'Revenue last year: Q1 $120k, Q2 $140k and Q3 $90k';
  const { ids } = grow(k, [
    { title: 'Month', text: 'Where the month goes: rent 45%, food 25% and transport 10%' },
    { title: 'Prices', text: 'Prices a month: basic €5, plus €9 and pro €19' },
    { title: '人口', text: '人口：北京2189万，上海2487万，广州1868万' },
    { title: 'Revenue', text: revenue },
    { title: 'Noon', text: 'Temps at noon: Oslo 5°, Rome 12° and Cairo 24°' },
    { title: 'Bare', text: revenue },
    { title: 'Weights', text: 'What the month weighs: rent 45, food 25 and transport 10' },
    { title: 'Thousands', text: revenue },
  ]);
  const chart = (n: number, labels: string[], numbers: number[], unit: string) => entry({ id: ids[n]!, component: 'chart', labels, numbers, unit });
  k.model.on('renderer.components', () => ({
    items: [
      chart(0, ['rent', 'food', 'transport'], [45, 25, 10], '%'),
      chart(1, ['basic', 'plus', 'pro'], [5, 9, 19], '€'),
      chart(2, ['北京', '上海', '广州'], [2189, 2487, 1868], '万'),
      chart(3, ['Q1', 'Q2', 'Q3'], [120, 140, 90], '$k'),
      chart(4, ['Oslo', 'Rome', 'Cairo'], [5, 12, 24], '°'),
      chart(5, ['Q1', 'Q2', 'Q3'], [120, 140, 90], ''),
      chart(6, ['rent', 'food', 'transport'], [45, 25, 10], 'kg'),
      chart(7, ['Q1', 'Q2', 'Q3'], [120, 140, 90], 'k'),
    ],
  }));
  await render(k, ids);
  const drawn = (n: number) => [view(k, ids[n]!).component, view(k, ids[n]!).props.values, view(k, ids[n]!).props.unit];
  assert.deepEqual(drawn(0), ['chart', [45, 25, 10], '%'], 'a percent sign');
  assert.deepEqual(drawn(1), ['chart', [5, 9, 19], '€'], 'a currency sign before the value');
  assert.deepEqual(drawn(2), ['chart', [2189, 2487, 1868], '万'], 'a magnitude in a script without spaces');
  assert.deepEqual(drawn(3), ['chart', [120, 140, 90], '$k'], 'a currency sign and a magnitude around the value');
  assert.deepEqual(drawn(4), ['chart', [5, 12, 24], '°'], 'a degree sign');
  assert.equal(view(k, ids[5]!).component, 'note', 'a hundred and twenty is not what "120k" writes');
  assert.deepEqual(drawn(6), ['chart', [45, 25, 10], undefined], 'a unit the text does not write is left out');
  assert.equal(view(k, ids[7]!).component, 'note', 'values in thousands without the dollar sign the text writes against them');
});

test('a stored chart or breakdown stands with the unit the text writes against a value, and falls with one it does not', () => {
  const stands = (text: string, props: Record<string, unknown>, component = 'chart') => grounded({ component, props }, kit().item({ title: 'Card', text }), url);
  const bar = (labels: string[], values: number[], unit?: string) => ({ chart: 'bar', labels, values, ...(unit ? { unit } : {}) });
  assert.ok(stands('Rent 45%, food 25%', bar(['Rent', 'food'], [45, 25], '%')), 'a percent sign after each value');
  assert.ok(stands('Rent 45%, food 55%', { labels: ['Rent', 'food'], values: [45, 55], unit: '%' }, 'breakdown'), 'shares in percent');
  assert.ok(stands('basic €5, pro €19', bar(['basic', 'pro'], [5, 19], '€')), 'a currency sign before each value');
  assert.ok(stands('Q1 $120 and Q2 $140', bar(['Q1', 'Q2'], [120, 140], '$')), 'a dollar sign');
  assert.ok(stands('北京2189万，上海2487万', bar(['北京', '上海'], [2189, 2487], '万')), 'a magnitude in a script without spaces');
  assert.ok(stands('Q1 $120k and Q2 $140k', bar(['Q1', 'Q2'], [120, 140], '$k')), 'a currency sign and a magnitude around each value');
  assert.ok(stands('2019: 12 films\n2020: 15 films', bar(['2019', '2020'], [12, 15], 'films')), 'a word after each value');
  assert.equal(stands('Rent 45%, food 25% of the month.', bar(['Rent', 'food'], [45, 25], '%')), false, 'a chart of the figures in a sentence leaves its other words out');

  assert.equal(stands('Rent 45, food 25', bar(['Rent', 'food'], [45, 25], '%')), false, 'a percent sign the text does not write');
  assert.equal(stands('Rent 45%, food 55%', { labels: ['Rent', 'food'], values: [45, 55], unit: 'kg' }, 'breakdown'), false, 'a unit the text does not write');
  assert.equal(stands('北京2189万，上海2487万', bar(['北京', '上海'], [2189, 2487])), false, 'the bare number is not what the text writes');
  assert.equal(stands('北京2189万，上海2487万', bar(['北京', '上海'], [21890000, 24870000])), false, 'nor is the number counted out, which the card would draw in other words');
  assert.equal(stands('北京2189万，上海2487万', bar(['北京', '上海'], [2189, 2487], '亿')), false, 'a magnitude the text does not write');
  assert.equal(stands('Q1 $120k and Q2 $140k', bar(['Q1', 'Q2'], [120, 140])), false, 'values without the signs around them');
  assert.equal(stands('Q1 $120k and Q2 $140k', bar(['Q1', 'Q2'], [120, 140], 'k')), false, 'values in thousands without the dollar sign');
  assert.equal(stands('Q1 $120k and Q2 $140', bar(['Q1', 'Q2'], [120, 140], '$k')), false, 'every value is written in the unit');
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
  assert.equal(grounded({ component: 'list', props: { items: ['1928', 'tram lines'] } }, essay, url), false, 'a list entry is a whole sentence or line of the words, and neither is one');
  assert.equal(grounded({ component: 'fact', props: { value: '1928', label: 'Year' } }, essay, url), false, 'which the words set beside no label');
  assert.ok(grounded(byRule(essay, url), essay, url), 'the picture is still the link card\'s own');

  const plans = k.item({ title: 'Plans', text: 'Plan | Price | Seats\nSolo | $8 | 1' });
  const table = (rows: string[][], heads = ['Plan', 'Price', 'Seats']) => grounded({ component: 'table', props: { heads, rows } }, plans, url);
  assert.ok(table([['Solo', '$8', '1']]));
  assert.equal(table([['Solo | $8', '', '1']]), false, 'one cell that spans two');
  assert.equal(table([['Solo', '$8', '1']], ['Plan | Price', 'Price', 'Seats']), false);

  const said = k.item({ title: 'Cameras', text: 'People say this. The   best  camera\tis the one you have with you.' });
  assert.ok(grounded({ component: 'quote', props: { text: 'The   best  camera\tis the one you have with you.', above: ['People say this.'] } }, said, url), 'a tab in prose is white space to the match, and drawn as the item writes it');
  assert.equal(grounded({ component: 'quote', props: { text: 'The best camera is the one you have with you', above: ['People say this.'] } }, said, url), false, 'a quotation drawn in other characters than the item writes is redrawn in its own');
  assert.equal(grounded({ component: 'quote', props: { text: 'The best camera is the one you have with you' } }, said, url), false, 'and the sentence before the quotation is drawn over it');
});

// ---- the cards the model chooses

type Control = ComponentsReply['items'][number]['controls'][number];
/** A toggle or segmented control of a reply, with each state's name and its text: the whole line that opens with the name. */
const control = (kind: 'toggle' | 'segmented', label: string, states: [string, string][]): Control => ({
  kind, label, states: states.map(([name]) => name), texts: states.map(([name, text]) => `${name}: ${text}`), name: '', unit: '', min: 0, max: 0, values: [],
});
const slider = (fields: Partial<Control>): Control => ({ kind: 'slider', label: '', states: [], texts: [], name: '', unit: '', min: 0, max: 0, values: [], ...fields });
const DOLLY_STATES: [string, string][] = [
  ['Zoom only', 'the lens zooms in while the camera stays put, so the background grows with the subject.'],
  ['Dolly only', 'the camera moves in on a fixed lens, so the subject grows and the background barely changes.'],
  ['Both', 'the camera pulls back as the lens zooms in, so the subject holds its size and the background swells behind it.'],
];
const DOLLY = `Three ways to shoot a dolly zoom.\n${DOLLY_STATES.map(([name, text]) => `${name}: ${text}`).join('\n')}`;
const FIELD = 'On a full-frame camera the field of view narrows as the focal length grows. At 24 mm the field of view is 73.7°. At 50 mm it is 39.6°. At 200 mm it is 10.3°.';

const said = (component: Chosen, slots: Partial<ComponentsReply['items'][number]>) => entry({ id: '', component, ...slots });
/** What the run log says of a card whose words are not its whole item. */
const WHOLE = 'is not the whole content, every line in order and every mark as it is written';
type Part = ComponentsReply['items'][number]['sections'][number];
const part = (kind: Part['kind'], slots: Partial<Part> = {}): Part => ({ kind, text: '', by: '', lines: [], ...slots });

/**
 * For each card: a text, a claim that is the whole text with the props it draws, and a claim the text does not hold with why the card
 * is refused.
 */
const CLAIMS: Record<Exclude<Chosen, 'note' | 'idea' | 'sheet'>, { text: string; held: Partial<ComponentsReply['items'][number]>; props: Record<string, unknown>; lacked: Partial<ComponentsReply['items'][number]>; fails: string }> = {
  quote: {
    text: 'Nonna measured nothing.\nNonna: "Salt it like the sea, and taste it as you go."',
    held: { passage: '"Salt it like the sea, and taste it as you go."', by: 'Nonna' },
    props: { text: 'Salt it like the sea, and taste it as you go.', by: 'Nonna', above: ['Nonna measured nothing.'] },
    lacked: { passage: 'Salt it like the ocean, and taste it as you go.', by: 'Nonna' },
    fails: WHOLE,
  },
  fact: {
    text: 'From the March report\nChurn in March, the lowest since launch: 4.2%',
    held: { passage: '4.2%', subject: 'Churn in March, the lowest since launch' },
    props: { value: '4.2%', label: 'Churn in March, the lowest since launch', above: ['From the March report'] },
    lacked: { passage: '4.5%', subject: 'Churn in March, the lowest since launch' },
    fails: WHOLE,
  },
  facts: {
    text: 'The flat\nSize: 62 square metres\nRent: €1,450 a month\nStation: 12 minutes away',
    held: { lines: ['Size | 62 square metres', 'Rent | €1,450 a month', 'Station | 12 minutes away'] },
    props: { facts: [{ label: 'Size', value: '62 square metres' }, { label: 'Rent', value: '€1,450 a month' }, { label: 'Station', value: '12 minutes away' }], above: ['The flat'] },
    lacked: { lines: ['Size | 62 square metres', 'Rent | €1,540 a month', 'Station | 12 minutes away'] },
    fails: WHOLE,
  },
  steps: {
    text: 'How we do it:\n1. Scout the house\n2. Light it\n3. Shoot at dusk',
    held: { lines: ['Scout the house', 'Light it', 'Shoot at dusk'] },
    props: { steps: ['Scout the house', 'Light it', 'Shoot at dusk'], above: ['How we do it:'] },
    lacked: { lines: ['Scout the house', 'Light it', 'Strike the set'] },
    fails: WHOLE,
  },
  list: {
    text: 'For the weekend we still need:\n- a tent\n- two sleeping bags\n- a head torch\n- something for the mosquitoes',
    held: { lines: ['a tent', 'two sleeping bags', 'a head torch', 'something for the mosquitoes'] },
    props: { items: ['a tent', 'two sleeping bags', 'a head torch', 'something for the mosquitoes'], above: ['For the weekend we still need:'] },
    lacked: { lines: ['a tent', 'a stove', 'a head torch', 'something for the mosquitoes'] },
    fails: WHOLE,
  },
  chart: {
    text: 'Builds we shipped:\nMarch: 1,200 builds\nApril: 3,050 builds',
    held: { labels: ['March', 'April'], numbers: [1200, 3050], unit: 'builds' },
    props: { chart: 'bar', labels: ['March', 'April'], values: [1200, 3050], unit: 'builds', above: ['Builds we shipped:'] },
    lacked: { labels: ['March', 'April'], numbers: [1200, 3500], unit: 'builds' },
    fails: WHOLE,
  },
  breakdown: {
    text: 'Where the month goes: rent 45%, food 25%, transport 10% and savings 20%.',
    held: { labels: ['rent', 'food', 'transport', 'savings'], numbers: [45, 25, 10, 20], unit: '%' },
    props: { labels: ['rent', 'food', 'transport', 'savings'], values: [45, 25, 10, 20], unit: '%', above: ['Where the month goes:'] },
    lacked: { labels: ['rent', 'food', 'transport', 'fun'], numbers: [45, 25, 10, 20], unit: '%' },
    fails: WHOLE,
  },
  table: {
    text: 'Plan | Price | Seats\nSolo | $8 | 1\nTeam | $20 | 5\nOrg | $1,200 | 100',
    held: { lines: ['| Plan | Price | Seats |', '|---|---|---|', 'Solo | $8 | 1', 'Team | $20 | 5', 'Org | $1,200 | 100'] },
    props: { heads: ['Plan', 'Price', 'Seats'], rows: [['Solo', '$8', '1'], ['Team', '$20', '5'], ['Org', '$1,200', '100']] },
    lacked: { lines: ['Plan | Price | Seats', 'Solo | $9 | 1', 'Team | $20 | 5', 'Org | $1,200 | 100'] },
    fails: WHOLE,
  },
  qa: {
    text: 'Why does bread go stale faster in the fridge? Because the starch recrystallises fastest just above freezing.',
    held: { subject: 'Why does bread go stale faster in the fridge?', passage: 'Because the starch recrystallises fastest just above freezing.' },
    props: { question: 'Why does bread go stale faster in the fridge?', answer: 'Because the starch recrystallises fastest just above freezing.' },
    lacked: { subject: 'Why does bread go stale faster in the fridge?', passage: 'Because the fridge dries it out.' },
    fails: WHOLE,
  },
  definition: {
    text: 'Parallax is the apparent shift of an object against its background when the viewer moves.',
    held: { subject: 'Parallax', passage: 'Parallax is the apparent shift of an object against its background when the viewer moves.' },
    props: { term: 'Parallax', definition: 'Parallax is the apparent shift of an object against its background when the viewer moves.' },
    lacked: { subject: 'Paradox', passage: 'Parallax is the apparent shift of an object against its background when the viewer moves.' },
    fails: WHOLE,
  },
  proscons: {
    text: 'Moving to Rust\nPros:\n- no data races\n- one small binary\nCons:\n- slow builds\n- a steep start',
    held: { left: ['no data races', 'one small binary'], right: ['slow builds', 'a steep start'] },
    props: { pros: ['no data races', 'one small binary'], cons: ['slow builds', 'a steep start'], heads: ['Pros:', 'Cons:'], above: ['Moving to Rust'] },
    lacked: { left: ['no data races', 'one small binary'], right: ['hard to hire for', 'a steep start'] },
    fails: WHOLE,
  },
  callout: {
    text: 'Feed the starter once a day with flour and water. Never rinse the jar with hot water.',
    held: { passage: 'Never rinse the jar with hot water.', tone: 'caution' },
    props: { text: 'Never rinse the jar with hot water.', tone: 'caution', above: ['Feed the starter once a day with flour and water.'] },
    lacked: { passage: 'Never rinse the jar with hot water. Feed the starter once a day', tone: 'caution' },
    fails: WHOLE,
  },
  excerpt: {
    text: 'Copied from Chapter 1 of the handbook. The house shelters day-dreaming, the house protects the dreamer.',
    held: { passage: 'The house shelters day-dreaming, the house protects the dreamer.', by: 'Chapter 1' },
    props: { text: 'The house shelters day-dreaming, the house protects the dreamer.', at: 'Chapter 1', above: ['Copied from Chapter 1 of the handbook.'] },
    lacked: { passage: 'The house protects day-dreaming.' },
    fails: WHOLE,
  },
  explorable: {
    text: DOLLY,
    held: { controls: [control('segmented', 'Three ways to shoot a dolly zoom', DOLLY_STATES)] },
    props: {
      controls: [{ kind: 'segmented', label: 'Three ways to shoot a dolly zoom', states: DOLLY_STATES.map(([name, text]) => ({ name, text: `${name}: ${text}` })) }],
      output: { kind: 'text' },
      above: ['Three ways to shoot a dolly zoom.'],
    },
    lacked: { controls: [control('segmented', 'Four ways to shoot a dolly zoom', DOLLY_STATES)] },
    fails: 'shows controls[0].label, which the content does not state',
  },
};

test('each card the model may choose is drawn from a claim that is its whole text, and one the text does not hold keeps the note and says why in the run log', async () => {
  const types = Object.keys(CLAIMS) as (keyof typeof CLAIMS)[];
  assert.deepEqual([...types, 'note', 'idea', 'sheet'].sort(), [...CHOSEN].sort(), 'every card the model may choose is here');

  const asked = async (which: 'held' | 'lacked') => {
    const k = kit();
    const { ids } = grow(k, types.map((type) => ({ title: `${type} ${which}`, text: CLAIMS[type].text })));
    for (const id of ids) assert.equal(view(k, id).component, 'note', 'the rules are unsure of each');
    k.model.on('renderer.components', () => ({ items: types.map((type, n) => ({ ...said(type, CLAIMS[type][which]), id: ids[n]! })) })).on('renderer.composites', () => ({ groups: [] }));
    await render(k, ids);
    assert.equal(k.model.calls.filter((call) => call.role === 'renderer.components').length, 2, 'fourteen items in two calls');
    return { k, ids };
  };

  const held = await asked('held');
  types.forEach((type, n) => assert.deepEqual(view(held.k, held.ids[n]!), { component: type, props: CLAIMS[type].props, by: 'renderer' }, `${type} is drawn`));
  assert.deepEqual(held.k.notes, [], 'a card that was drawn leaves no line');

  const lacked = await asked('lacked');
  for (const id of lacked.ids) assert.deepEqual(view(lacked.k, id), { component: 'note', props: {}, by: 'renderer' }, 'the note stays');
  assert.deepEqual(lacked.k.notes, types.map((type) => `renderer: Kept "${type} lacked" as the rules drew it: the model's ${type} ${CLAIMS[type].fails}.`), 'one line for each card, which says why it was refused');
});

test('a slider is drawn when its formula gives each value the item states within 1 percent, and a formula that misses by 5 percent or cannot be read keeps the note and says why', async () => {
  const k = kit();
  const { ids } = grow(k, ['matches', 'misses', 'unknown function', 'no value'].map((title) => ({ title, text: FIELD })));
  const fov = (formula: string, min = 12): Partial<ComponentsReply['items'][number]> => ({
    controls: [slider({ label: 'focal length', name: 'f', unit: 'mm', min, max: 300, values: [24, 50, 200] })],
    formula,
    subject: 'field of view',
    unit: '°',
    numbers: [73.7, 39.6, 10.3],
  });
  const replies = [fov('2 * atan(18 / f) * 57.2958'), fov('2 * atan(18 / f) * 57.2958 * 1.05'), fov('2 * atan2(18, f) * 57.2958'), fov('2 * atan(18 / f) * 57.2958', 0)];
  k.model.on('renderer.components', () => ({ items: replies.map((reply, n) => ({ ...said('explorable', reply), id: ids[n]! })) })).on('renderer.composites', () => ({ groups: [] }));
  await render(k, ids);
  assert.deepEqual(view(k, ids[0]!), {
    component: 'explorable',
    props: {
      controls: [{ kind: 'slider', name: 'f', label: 'focal length', unit: 'mm', min: 12, max: 300, step: 2, values: [24, 50, 200] }],
      output: { kind: 'chart', label: 'field of view', unit: '°', formula: [2, 18, 'f', '/', 'atan', '*', 57.2958, '*'], values: [73.7, 39.6, 10.3] },
    },
    by: 'renderer',
  });
  for (const id of ids.slice(1)) assert.equal(view(k, id).component, 'note');
  assert.deepEqual(k.notes, [
    'renderer: Kept "misses" as the rules drew it: the model\'s explorable has a formula that gives 77.43 at focal length 24, where the item states 73.7.',
    'renderer: Kept "unknown function" as the rules drew it: the model\'s explorable has a formula that cannot be read: it calls the unknown function "atan2".',
    'renderer: Kept "no value" as the rules drew it: the model\'s explorable has a formula that has no value at focal length 0.',
  ]);

  const two = kit();
  const narrows = 'On a full-frame camera the field of view narrows as the focal length grows: at 24 mm it is 73.7°, and at 50 mm it is 39.6°.';
  const pair = grow(two, [{ title: 'Two stated', text: narrows }]).ids;
  two.model.on('renderer.components', () => ({ items: [{ ...said('explorable', { ...fov('2 * atan(18 / f) * 57.2958'), controls: [slider({ label: 'focal length', name: 'f', unit: 'mm', min: 12, max: 300, values: [24, 50] })], numbers: [73.7, 39.6] }), id: pair[0]! }] })).on('renderer.composites', () => ({ groups: [] }));
  await render(two, pair);
  assert.equal((view(two, pair[0]!).props as { output: { kind: string } }).output.kind, 'figure', 'two stated values are drawn as a figure');
  assert.ok(grounded(view(two, pair[0]!), two.mind.itemOf(pair[0]!), url));
  assert.ok(!grounded(view(two, pair[0]!), { ...two.mind.itemOf(pair[0]!), text: narrows.replace('50 mm', '85 mm') }, url), 'a stated value the item no longer writes');
});

test('the model is asked only about text the rules left as a note or an idea: no link, picture, conversation, code, short line or structure a rule drew', async () => {
  const k = kit();
  const thought = 'What if the map redrew itself as you learn?';
  const { ids } = grow(k, [
    { title: 'Long', text: LONG },
    { title: 'Pick', text: LONG, origin: { by: 'agent', role: 'scout' } },
    { title: 'Short', text: 'A short remark with a number, 12.' },
    { title: 'Page', kind: 'link', text: LONG, source: { from: 'link', url: 'https://example.com/a', capturedAt: '' } },
    { title: 'Photo', kind: 'image', text: LONG, source: { from: 'drop', asset: 'a1', capturedAt: '' } },
    { title: 'Talk', kind: 'chat', text: LONG, data: { messages: [{ role: 'user', text: 'Hello there' }] } },
    { title: 'Script', kind: 'code', text: `print(1)  # ${LONG}` },
    { title: 'Recipe', text: 'Boil the water, then add the pasta.', data: { steps: ['Boil the water', 'add the pasta'] } },
    { title: thought, text: thought },
    { title: 'Build a treehouse in the old oak', text: 'Build a treehouse in the old oak' },
    { title: '提醒', text: '注意：奶奶对花生过敏，聚餐不要用花生油。' },
    { title: '把书房搬到阁楼去，客厅留给孩子们玩', text: '把书房搬到阁楼去，客厅留给孩子们玩' },
    { title: '把书房搬到阁楼去，再刷墙', text: '把书房搬到阁楼去，再刷墙' },
    { title: '', text: '', kind: 'file' },
  ]);
  assert.deepEqual([8, 9, 11, 12].map((n) => ruled(k.mind.itemOf(ids[n]!)).component), ['idea', 'idea', 'idea', 'idea']);
  k.model.on('renderer.components', () => ({ items: [] }));
  await render(k, ids);
  const asked = k.model.calls.filter((call) => call.role === 'renderer.components').map((call) => call.detail).join('\n\n');
  assert.deepEqual(
    [...asked.matchAll(/^id: (.+)$/gm)].map((found) => found[1]).sort(),
    [ids[0], ids[1], ids[8], ids[10], ids[11]].sort(),
    'forty characters with spaces between words, or sixteen without, and no fewer',
  );
  assert.deepEqual([...asked.matchAll(/^id: (.+)\n.*\nnow: idea$/gm)].map((found) => found[1]).sort(), [ids[8], ids[11]].sort(), 'the prompt says which the rules drew as an idea');
});

test('the model may keep an idea, or make a note, a callout or a definition of it, and may call a longer line in a script without spaces an idea', async () => {
  const k = kit();
  const lines = [
    'What if the map redrew itself as you learn?',
    'Call the plumber about the boiler before the weekend',
    'Never leave the gas heater on at the cabin',
    '把书房搬到阁楼去，客厅留给孩子们玩',
    '要是把周会改成每人写三句话，会不会省下整整一个小时',
    '注意：奶奶对花生过敏，家里聚餐千万不要用花生油',
    '周五下午3点前把报销单交给财务，别忘了附上发票原件',
  ];
  const { ids } = grow(k, lines.map((text) => ({ title: text, text })));
  assert.deepEqual(ids.map((id) => view(k, id).component), Array(7).fill('note'), 'each starts as the default note');
  assert.deepEqual(ids.map((id) => ruled(k.mind.itemOf(id)).component), ['idea', 'idea', 'idea', 'idea', 'note', 'idea', 'note']);
  k.model.on('renderer.components', () => ({
    items: [
      entry({ id: ids[0]!, component: 'idea' }),
      entry({ id: ids[1]!, component: 'note' }),
      entry({ id: ids[2]!, component: 'callout', passage: lines[2]!, tone: 'caution' }),
      entry({ id: ids[3]!, component: 'idea' }),
      entry({ id: ids[4]!, component: 'idea' }),
      entry({ id: ids[5]!, component: 'callout', passage: '注意：奶奶对花生过敏，家里聚餐千万不要用花生油', tone: 'caution' }),
      entry({ id: ids[6]!, component: 'idea' }),
    ],
  })).on('renderer.composites', () => ({ groups: [] }));
  await render(k, ids);
  assert.deepEqual(ids.map((id) => view(k, id).component), ['idea', 'note', 'callout', 'idea', 'idea', 'callout', 'note']);
  for (const id of ids) assert.equal(view(k, id).by, 'renderer');
  assert.deepEqual(view(k, ids[4]!).props, {}, 'an idea has no props');
  assert.deepEqual(k.notes, [`renderer: Kept "${lines[6]}" as the rules drew it: the model's idea is not one the library accepts.`], 'a line with a number is no idea, whoever says so');

  assert.deepEqual(await render(k, ids), [], 'a second pass changes nothing');
  assert.equal(components(k).length, 1, 'and asks about none of them again');

  const prose = kit();
  const item = prose.item({ title: 'Long', text: LONG });
  assert.deepEqual(byModel(entry({ id: '', component: 'idea' }), item, url), { refused: 'invalid', component: 'idea' }, 'a paragraph under a title is no idea');
  assert.deepEqual(byModel(entry({ id: '', component: 'idea' }), prose.item({ title: 'x'.repeat(60), text: 'x'.repeat(60) }), url), { refused: 'invalid', component: 'idea' });
});

const components = (k: Kit) => k.model.calls.filter((made) => made.role === 'renderer.components');
const idsIn = (prompt: string) => [...prompt.matchAll(/^id: (.+)$/gm)].map((found) => found[1]!);

test('a note or an idea the model confirmed is not asked about again until its item changes', async () => {
  const k = kit();
  const thought = 'What if the map redrew itself as you learn?';
  const { ids } = grow(k, [{ title: 'Long', text: LONG }, { title: thought, text: thought }, { title: 'Other', text: `${LONG} And more.` }]);
  k.model.on('renderer.components', (req) => ({ items: idsIn(req.user).map((id) => entry({ id, component: id === ids[1] ? 'idea' : 'note' })) }));
  await render(k, ids);
  assert.deepEqual(ids.map((id) => view(k, id)), [
    { component: 'note', props: {}, by: 'renderer' },
    { component: 'idea', props: {}, by: 'renderer' },
    { component: 'note', props: {}, by: 'renderer' },
  ]);
  assert.equal(components(k).length, 1);

  assert.deepEqual(await render(k, ids), [], 'a second pass over the same items changes nothing');
  assert.equal(components(k).length, 1, 'and makes no call');

  const edit = (id: Id, patch: { text?: string; title?: string; data?: Item['data']; summary?: string }) =>
    k.mind.apply({ origin: USER, label: 'edit', commands: [{ type: 'editItem', id: k.mind.node(id).itemId, patch }] });
  edit(ids[0]!, { text: `${LONG} Caution: the stairs are steep.` });
  edit(ids[1]!, { title: 'What if the map redrew itself as you learned?', text: 'What if the map redrew itself as you learned?' });
  await render(k, ids, [ids[0]!, ids[1]!]);
  assert.equal(components(k).length, 2, 'an edit is worth a second question');
  assert.deepEqual(idsIn(components(k)[1]!.detail), [ids[0], ids[1]], 'about the edited items and no other');
});

test('the pipeline tells the Renderer which items changed in what a card is drawn from: the title, the text or the data, and not the summary or the tags', async () => {
  const k = kit();
  const sets: unknown[] = [];
  const pipeline = new Pipeline({
    mind: k.mind, roles: { ...fakeRoles, renderer }, model: k.model, tools: k.ctx.tools, assets: k.assets, store: { append: (set) => sets.push(set), all: () => [] },
    settings: k.ctx.settings, newId: k.ctx.newId, now: k.ctx.now, emit: () => {},
  });
  const { ids } = grow(k, [{ title: 'Long', text: LONG }]);
  const itemId = k.mind.node(ids[0]!).itemId;
  k.model.on('renderer.components', (req) => ({ items: idsIn(req.user).map((id) => entry({ id })) })).on('renderer.composites', () => ({ groups: [] }));
  const edit = async (patch: { text?: string; title?: string; data?: Item['data']; summary?: string; tags?: string[] }) => {
    pipeline.userCommands('Edit', [{ type: 'editItem', id: itemId, patch }]);
    await pipeline.idle();
    return components(k).length;
  };

  pipeline.userCommands('Say why', [{ type: 'setWhy', id: ids[0]!, why: 'It opens the film' }]);
  await pipeline.idle();
  assert.equal(components(k).length, 1, 'a new note is asked about');
  assert.deepEqual(view(k, ids[0]!), { component: 'note', props: {}, by: 'renderer' });

  pipeline.userCommands('Say why', [{ type: 'setWhy', id: ids[0]!, why: 'It closes the film' }]);
  await pipeline.idle();
  assert.equal(components(k).length, 1, 'a change to the node is no change to the item');
  assert.equal(await edit({ summary: 'About the camera.', tags: ['camera'] }), 1, 'nor is a new summary or new tags');
  assert.equal(await edit({ text: `${LONG} It never cuts.` }), 2, 'new text is');
  assert.equal(await edit({ title: 'Longer' }), 3, 'a new title is');
  assert.equal(await edit({ data: { where: 'Lisbon' } }), 4, 'new data is');
  assert.equal(await edit({ data: { where: 'Lisbon' } }), 4, 'the same data again is not');
});

test('one pass asks about 24 items at most in calls of eight, a call answered unreadably is asked again in two halves one after the other, and a call that got no answer is not', async () => {
  const k = kit();
  const { ids } = grow(k, Array.from({ length: 30 }, (_v, n) => ({ title: `Note ${n}`, text: `${LONG} We paid 12 euros for the ferry.` })));
  const running = { now: 0, most: 0 };
  k.model
    .on('renderer.components', async (req) => {
      const asked = idsIn(req.user);
      running.most = Math.max(running.most, ++running.now);
      await new Promise((done) => setTimeout(done, 1));
      running.now--;
      // The second call of eight is answered in a shape the schema refuses, and so is the second of its halves. The third gets no answer.
      if ((asked.length === 8 && asked.includes(ids[8]!)) || asked.includes(ids[12]!)) return { items: 'not a list' };
      if (asked.includes(ids[16]!)) throw new Error('timed out');
      return { items: asked.map((id) => entry({ id, emphasis: 'We paid 12 euros for the ferry' })) };
    })
    .on('renderer.composites', () => ({ groups: [] }));
  await render(k, ids);
  assert.deepEqual(components(k).map((made) => idsIn(made.detail).length), [8, 8, 8, 4, 4]);
  assert.equal(running.most, 3, 'never more calls at once than the three of the pass');
  const answered = (n: number) => n < 12;
  assert.deepEqual(ids.map((id) => 'emphasis' in view(k, id).props), ids.map((_id, n) => answered(n)));
  assert.deepEqual(ids.map((id) => view(k, id).by), ids.map((_id, n) => (answered(n) ? 'renderer' : 'default')), 'an item with no answer keeps its rule card as a default');
  assert.deepEqual(k.notes.map((note) => note.replace(/\(.*\)/, '()')).sort(), [
    'renderer: A call to choose components for 4 items failed (). Kept the rule-based views of them.',
    'renderer: A call to choose components for 8 items failed (). Asking once more, in two halves.',
    'renderer: A call to choose components for 8 items failed (). Kept the rule-based views of them.',
  ]);

  const before = components(k).length;
  k.model.on('renderer.components', (req) => ({ items: idsIn(req.user).map((id) => entry({ id })) }));
  await render(k, ids);
  assert.deepEqual(components(k).slice(before).flatMap((made) => idsIn(made.detail)), ids.slice(12), 'the next pass asks about the eighteen that got no answer, and no other');
});

test('the pipeline runs the Renderer again over the items a pass left unanswered, one pass after another, and stops after four', async () => {
  const dropped = (count: number) => {
    const k = kit();
    const pipeline = new Pipeline({
      mind: k.mind, roles: { ...fakeRoles, renderer }, model: k.model, tools: k.ctx.tools, assets: k.assets, store: { append: () => {}, all: () => [] },
      settings: k.ctx.settings, newId: k.ctx.newId, now: k.ctx.now, emit: () => {},
    });
    const { treeId, nodeIds } = k.seedTree('Tree', ['Root']);
    const made = Array.from({ length: count }, (_v, n) => {
      const item = k.item({ title: `Note ${n}`, text: `${LONG} We paid 12 euros for the ferry.` });
      return { item, node: makeNode(k.ctx, item, { treeId, parent: nodeIds[0]!, status: 'kept', why: '', origin: USER }) };
    });
    const drop = () => pipeline.userCommands('Drop', made.flatMap(({ item, node }): Command[] => [{ type: 'addItem', item }, { type: 'addNode', node }]));
    return { k, pipeline, ids: made.map(({ node }) => node.id), drop };
  };
  const answering = (k: Kit, running: { now: number; most: number }, fails: (asked: Id[]) => boolean = () => false) =>
    k.model
      .on('renderer.components', async (req) => {
        running.most = Math.max(running.most, ++running.now);
        await new Promise((done) => setTimeout(done, 1));
        running.now--;
        if (fails(idsIn(req.user))) throw new Error('timed out');
        return { items: idsIn(req.user).map((id) => entry({ id, emphasis: 'We paid 12 euros for the ferry' })) };
      })
      .on('renderer.composites', () => ({ groups: [] }));

  const thirty = dropped(30);
  const running = { now: 0, most: 0 };
  answering(thirty.k, running);
  thirty.drop();
  await thirty.pipeline.idle();
  assert.deepEqual(thirty.ids.map((id) => view(thirty.k, id)), thirty.ids.map(() => ({ component: 'note', props: { emphasis: 'We paid 12 euros for the ferry' }, by: 'renderer' })), 'all thirty are answered for');
  assert.deepEqual(components(thirty.k).map((made) => idsIn(made.detail).length), [8, 8, 8, 6], 'three calls for twenty-four, then one for the six left');
  assert.equal(thirty.k.model.calls.filter((made) => made.role === 'renderer.composites').length, 1, 'the siblings are looked at for an arrangement once');

  const sixty = dropped(60);
  const busy = { now: 0, most: 0 };
  answering(sixty.k, busy);
  sixty.drop();
  await sixty.pipeline.idle();
  assert.ok(sixty.ids.every((id) => view(sixty.k, id).by === 'renderer'), 'sixty are answered for in three passes');
  assert.deepEqual([components(sixty.k).length, busy.most], [8, 3], 'eight calls in all, and never more than the three of one pass at a time');

  const failing = dropped(12);
  answering(failing.k, { now: 0, most: 0 }, (asked) => asked.includes(failing.ids[11]!));
  failing.drop();
  await failing.pipeline.idle();
  assert.deepEqual(failing.ids.map((id) => view(failing.k, id).by), failing.ids.map((_id, n) => (n < 6 ? 'renderer' : 'default')), 'the items of a call that keeps failing stay plain cards');
  assert.deepEqual(components(failing.k).map((made) => idsIn(made.detail).length), [6, 6, 6], 'they are asked about once more, and a pass in which every call failed is the last');

  const down = dropped(30);
  const waiting = { now: 0, most: 0 };
  answering(down.k, waiting, () => true);
  down.drop();
  await down.pipeline.idle();
  assert.deepEqual([components(down.k).map((made) => idsIn(made.detail).length), waiting.most], [[8, 8, 8], 3], 'a model that is down costs one pass of three calls');
  assert.ok(down.ids.every((id) => view(down.k, id).by === 'default'));
  down.pipeline.userCommands('Why', [{ type: 'setWhy', id: down.ids[0]!, why: 'touched' }]);
  await down.pipeline.idle();
  assert.equal(components(down.k).length, 4, 'an item is asked about again when it is next touched');

  const hundred = dropped(100);
  answering(hundred.k, { now: 0, most: 0 });
  hundred.drop();
  await hundred.pipeline.idle();
  assert.equal(hundred.ids.filter((id) => view(hundred.k, id).by === 'renderer').length, 96, 'four passes of twenty-four');
});

test('a card the model chose that an edit left unstated falls back to a default note when the call about it fails, so the next pass asks again', async () => {
  const k = kit();
  const { ids } = grow(k, [{ title: 'House', text: 'Caution: the stairs are steep and the rail is loose, so hold on to the wall.' }]);
  k.model.on('renderer.components', () => ({ items: [entry({ id: ids[0]!, component: 'callout', passage: 'Caution: the stairs are steep and the rail is loose, so hold on to the wall.', tone: 'caution' })] }));
  await render(k, ids);
  assert.equal(view(k, ids[0]!).component, 'callout');

  k.mind.apply({ origin: USER, label: 'edit', commands: [{ type: 'editItem', id: k.mind.node(ids[0]!).itemId, patch: { text: 'The stairs were rebuilt last spring and the rail is new and firm.' } }] });
  k.model.on('renderer.components', () => {
    throw new Error('timed out');
  });
  await render(k, ids, ids);
  assert.deepEqual(view(k, ids[0]!), { component: 'note', props: {}, by: 'default' });
});

test('a figure label of over forty characters is refused in a fact, in facts and in a sheet, none of which stands without it', async () => {
  const [long, short, fits] = ['Rent with the heating, as the agent quoted it', 'Rent with heating, as the agent quoted it', 'Rent and heating, as the agent quoted it'];
  assert.deepEqual([long.length, short.length, fits.length], [45, 41, 40], 'labels on either side of the room');
  const rent = (label: string) => `The flat\n${label}: €1,450 a month`;
  assert.deepEqual(verdict(rent(long), 'fact', { passage: '€1,450 a month', subject: long }), { refused: 'long', component: 'fact', prop: 'label' }, 'forty-five characters');
  assert.deepEqual(verdict(rent(short), 'fact', { passage: '€1,450 a month', subject: short }), { refused: 'long', component: 'fact', prop: 'label' }, 'forty-one characters');
  assert.ok('draw' in verdict(rent(fits), 'fact', { passage: '€1,450 a month', subject: fits }), 'forty characters are allowed');
  const flat = `The flat\nSize: 62 square metres\n${long}: €1,450 a month\nStation: 12 minutes away`;
  assert.deepEqual(verdict(flat, 'facts', { lines: ['Size | 62 square metres', `${long} | €1,450 a month`, 'Station | 12 minutes away'] }), { refused: 'long', component: 'facts', prop: 'facts[1].label' }, 'a grid with the long label');
  assert.deepEqual(verdict(flat, 'facts', { lines: ['Size | 62 square metres', 'Station | 12 minutes away'] }), { refused: 'part', component: 'facts' }, 'and a grid without it leaves its line out');
  assert.ok('draw' in verdict(`${'公'.repeat(40)}：六十二平方米`, 'fact', { passage: '六十二平方米', subject: '公'.repeat(40) }), 'counted in characters, whatever the script');
  assert.deepEqual(verdict(`${'公'.repeat(41)}：六十二平方米`, 'fact', { passage: '六十二平方米', subject: '公'.repeat(41) }), { refused: 'long', component: 'fact', prop: 'label' }, 'forty-one characters of a script without spaces');

  const repair = 'The repair of the roof, as the council costed it';
  const pool = `The pool roof\nThe council met on Tuesday and costed the repair of the roof.\n${repair}: £48,000\nStill open:\n- the contractor\n- the dates for the school`;
  const sections = [
    part('heading', { text: 'The pool roof' }),
    part('text', { text: 'The council met on Tuesday and costed the repair of the roof.' }),
    part('figures', { lines: [`${repair} | £48,000`] }),
    part('list', { text: 'Still open:', lines: ['the contractor', 'the dates for the school'] }),
  ];
  assert.deepEqual(verdict(pool, 'sheet', { sections }), { refused: 'invalid', component: 'sheet' }, 'a sheet has no room for the label either');

  const k = kit();
  const { ids } = grow(k, [{ title: 'Pool', text: pool }, { title: 'Flat', text: rent(long) }]);
  k.model.on('renderer.components', () => ({ items: [{ ...said('sheet', { sections }), id: ids[0]! }, { ...said('fact', { passage: '€1,450 a month', subject: long }), id: ids[1]! }] }));
  await render(k, ids);
  assert.deepEqual(
    k.notes,
    ['renderer: Kept "Pool" as the rules drew it: the model\'s sheet is not one the library accepts.', 'renderer: Kept "Flat" as the rules drew it: the model\'s fact shows label, which is longer than a card has room for.'],
    'each refusal is a line of the run log',
  );
  assert.match(components(k)[0]!.detail, /A label is the item's own words beside its value, as its line or row writes them, at most 40 characters\. Add no word of your own\./, 'the model is told the room a label has');
});

const COUNCIL = 'The council met on Tuesday to settle the budget for the pool, and the meeting ran long because nobody agreed about the roof.';
const CLUB = 'The swimming club asked whether lessons could move to the school in the meantime, and the head teacher said she would ask the governors.';
const REPORT =
  `${COUNCIL} ` +
  'In the end the repair was costed at £48,000 and the pool will close for 6 weeks from March. ' +
  `${CLUB} ` +
  'Mrs Adeyemi said, "We have patched that roof for twenty years, and it has cost us more than a new one." ' +
  'Three things are still open:\n- the contractor\n- the dates for the school\n- who pays for the minibus\n';
const COSTS = ['Repair | £48,000', 'Pool will close | 6 weeks'];
const MEANTIME = 'The club will swim at the school in the meantime.';
const ADEYEMI = '"We have patched that roof for twenty years, and it has cost us more than a new one."';
/** A short report that a sheet can show whole: a heading, two sentences, two figures and a quotation. */
const ROOF = `The pool roof\n${COUNCIL} ${MEANTIME}\nRepair: £48,000\nPool will close: 6 weeks\nMrs Adeyemi: ${ADEYEMI}`;

const verdict = (text: string, component: Chosen, slots: Partial<ComponentsReply['items'][number]>, title = 'Card') => byModel(said(component, slots), kit().item({ title, text }), url);

test('a sheet is assembled from the sections that are its whole item', () => {
  const sections = [part('heading', { text: 'The pool roof' }), part('text', { text: `${COUNCIL} ${MEANTIME}` }), part('figures', { lines: COSTS }), part('excerpt', { text: ADEYEMI, by: 'Mrs Adeyemi' })];
  assert.deepEqual(
    verdict(ROOF, 'sheet', { sections }, 'The pool roof'),
    {
      draw: {
        component: 'sheet',
        props: {
          sections: [
            { kind: 'heading', text: 'The pool roof' },
            { kind: 'text', text: `${COUNCIL} ${MEANTIME}` },
            { kind: 'figures', facts: [{ label: 'Repair', value: '£48,000' }, { label: 'Pool will close', value: '6 weeks' }] },
            { kind: 'excerpt', text: ADEYEMI, by: 'Mrs Adeyemi' },
          ],
        },
      },
    },
    'every line of the report, in its order',
  );
  assert.deepEqual(verdict(ROOF, 'facts', { lines: COSTS }), { refused: 'part', component: 'facts' }, 'the two figures alone leave the rest of the report out');
  assert.deepEqual(verdict(REPORT, 'sheet', { sections: [part('text', { text: COUNCIL }), part('figures', { lines: COSTS }), part('excerpt', { text: ADEYEMI, by: 'Mrs Adeyemi' })] }), { refused: 'part', component: 'sheet' }, 'and a sheet of some sentences of a longer report is refused');
});

test('a sheet is its whole item in order: the opening it leaves out is drawn over it, and a sentence on its own, a passage cut short or sentences out of order are refused', () => {
  const rest = [part('figures', { lines: COSTS }), part('excerpt', { text: ADEYEMI, by: 'Mrs Adeyemi' })];
  const made = (text: string) => {
    const got = verdict(ROOF, 'sheet', { sections: [part('text', { text }), ...rest] }, 'The pool roof');
    return 'draw' in got ? (got.draw.props.above ?? []) : got.refused;
  };
  assert.deepEqual(made(`${COUNCIL} ${MEANTIME}`), [], 'both sentences, with nothing over them');
  assert.deepEqual(made(MEANTIME), [COUNCIL], 'the second sentence, under the first');
  assert.equal(made(COUNCIL), 'part', 'the first sentence without the second');
  assert.equal(made('The council met on Tuesday to settle the budget for the pool, and the meeting ran long because nobody…'), 'part', 'an opening the reply cut short');
  assert.equal(made(`${MEANTIME} ${COUNCIL}`), 'part', 'two sentences that do not follow one another');
  const opening = verdict(ROOF, 'sheet', { sections: rest }, 'The pool roof');
  assert.deepEqual('draw' in opening && opening.draw.props.above, [`${COUNCIL} ${MEANTIME}`], 'a sheet with no text draws the opening over its other sections');
  assert.deepEqual(verdict(ROOF, 'sheet', { sections: [part('heading', { text: 'The roof of the pool' }), part('text', { text: `${COUNCIL} ${MEANTIME}` }), ...rest] }), { refused: 'part', component: 'sheet' }, 'a heading the item does not write');

  const zh = '上个月我们走访了城东的六家社区老年食堂，和四十多位老人、十几位工作人员聊了聊，想弄清楚这些食堂到底是谁在用、钱从哪里来、还能撑多久。';
  const visit = (opening: string) => `${opening}\n午餐平均卖：12元\n还没定的事：\n- 谁来做饭\n- 谁来付钱`;
  const lunch = [part('figures', { lines: ['午餐平均卖 | 12元'] }), part('list', { text: '还没定的事：', lines: ['谁来做饭', '谁来付钱'] })];
  assert.ok('draw' in verdict(visit(zh.repeat(2)), 'sheet', { sections: lunch }), 'an opening of 132 characters is drawn over a sheet in a script without spaces');
  assert.deepEqual(verdict(visit(zh.repeat(3)), 'sheet', { sections: lunch }), { refused: 'part', component: 'sheet' }, 'and one of 198 is not, which the sheet would leave out');
});

test('a figure, a list entry, a table row or a section the text does not state refuses its card, which is never drawn without it', async () => {
  const opening = part('text', { text: `${COUNCIL} ${MEANTIME}` });
  const quoted = part('excerpt', { text: ADEYEMI, by: 'Mrs Adeyemi' });
  const k = kit();
  const { ids } = grow(k, [{ title: 'Invented', text: ROOF }, { title: 'Extra', text: ROOF }]);
  k.model.on('renderer.components', () => ({
    items: [
      { ...said('sheet', { sections: [opening, part('figures', { lines: ['Repair | £84,000', 'Pool will close | 6 weeks'] }), quoted] }), id: ids[0]! },
      { ...said('sheet', { sections: [opening, part('figures', { lines: COSTS }), quoted, part('list', { lines: ['the contractor', 'the dates for the school'] })] }), id: ids[1]! },
    ],
  }));
  await render(k, ids);
  assert.deepEqual(ids.map((id) => view(k, id).component), ['note', 'note'], 'neither sheet is drawn');
  assert.deepEqual(
    k.notes,
    ['Invented', 'Extra'].map((title) => `renderer: Kept "${title}" as the rules drew it: the model's sheet ${WHOLE}.`),
    'a figure the report does not write, and a section it does not hold',
  );

  const camp = 'For the weekend we still need:\n- a tent\n- two sleeping bags\n- a head torch';
  assert.deepEqual(verdict(camp, 'list', { lines: ['a tent', 'a stove', 'two sleeping bags', 'a head torch'] }), { refused: 'part', component: 'list' }, 'an entry the list does not write');
  assert.deepEqual(verdict(camp, 'list', { lines: ['a tent', 'two sleeping bags', 'a head torch'] }), { draw: { component: 'list', props: { items: ['a tent', 'two sleeping bags', 'a head torch'], above: ['For the weekend we still need:'] } } }, 'the entries it writes');
  const plans = 'Plan | Price | Seats\nSolo | $8 | 1\nTeam | $20 | 5';
  assert.deepEqual(verdict(plans, 'table', { lines: ['Plan | Price | Seats', 'Solo | $8 | 1', 'Team | $25 | 5'] }), { refused: 'part', component: 'table' }, 'a row with a cell the table does not write');
  assert.deepEqual(verdict(plans, 'table', { lines: ['Plan | Price | Seats', 'Solo | $8 | 1'] }), { refused: 'part', component: 'table' }, 'a table without one of its rows');
  assert.deepEqual(verdict(plans, 'table', { lines: ['Plan | Cost | Seats', 'Solo | $8 | 1', 'Team | $20 | 5'] }), { refused: 'part', component: 'table' }, 'a head the table does not write');
  assert.deepEqual(verdict(camp, 'steps', { lines: ['a tent', 'a stove', 'two sleeping bags', 'a head torch'] }), { refused: 'part', component: 'steps' }, 'a procedure with a step the text does not write');
});

test('an entry written twice counts once: thirty lines of two entries are a list of two', () => {
  const best = 'Best of the weekend:\n- the bridge at dusk\n- the tiled station';
  const twice = Array.from({ length: 30 }, (_v, n) => (n % 2 ? 'The  tiled station' : 'the bridge at dusk'));
  assert.deepEqual(verdict(best, 'list', { lines: twice }), { draw: { component: 'list', props: { items: ['the bridge at dusk', 'the tiled station'], above: ['Best of the weekend:'] } } }, 'no list of thirty stands for two lines, and each entry is drawn as the item writes it');
  const figures = part('figures', { lines: ['Two nights | €240', 'Train, each | €38'] });
  const made = verdict(`Two nights: €240\nTrain, each: €38\n${best}`, 'sheet', { sections: [figures, figures, part('list', { text: 'Best of the weekend:', lines: twice })] });
  assert.deepEqual(
    'draw' in made && (made.draw.props.sections as { kind: string }[]).map((section) => section.kind),
    ['figures', 'list'],
    'the same section twice is one section',
  );
  const facts = verdict('Size: 62 square metres\nRent: €1,450 a month', 'facts', { lines: ['Size | 62 square metres', 'size | 62 square  metres', 'Rent | €1,450 a month'] });
  assert.deepEqual('draw' in facts && (facts.draw.props.facts as unknown[]).length, 2, 'a figure written twice is one figure');
  const table = verdict('Plan | Price\nSolo | $8\nTeam | $20', 'table', { lines: ['Plan | Price', 'Solo | $8', 'solo | $8', 'Team | $20'] });
  assert.deepEqual('draw' in table && table.draw.props.rows, [['Solo', '$8'], ['Team', '$20']], 'a row written twice is one row');
});

test('a quote, an excerpt or a callout of over 400 characters, or 200 in a script without spaces, is refused', () => {
  const sentence = 'I have been meaning to write since the spring, and now the garden is nearly over for the year. ';
  const letter = sentence.repeat(5).trim();
  assert.ok(letter.length > 400, 'the letter is over 400 characters');
  for (const component of ['quote', 'excerpt', 'callout'] as const) {
    assert.deepEqual(verdict(letter, component, { passage: letter }), { refused: 'long', component, prop: 'text' }, component);
    assert.ok('draw' in verdict(letter, component, { passage: sentence.repeat(4).trim() }), `${component} of four sentences`);
  }
  const zh = '春天以来一直想给你写信，现在园子里的活儿也快忙完了。';
  assert.deepEqual(verdict(zh.repeat(8), 'quote', { passage: zh.repeat(8) }), { refused: 'long', component: 'quote', prop: 'text' }, '208 characters');
  assert.ok('draw' in verdict(zh.repeat(8), 'quote', { passage: zh.repeat(7) }), '182 characters');
  const quoting = verdict(`${letter} Dad wrote, "${letter}"`, 'sheet', { sections: [part('text', { text: sentence.repeat(2).trim() }), part('excerpt', { text: letter, by: 'Dad' })] });
  assert.deepEqual(quoting, { refused: 'invalid', component: 'sheet' }, 'and so is a sheet whose only other section is such a passage');
});

test('a passage is whole: a callout, a quote and an excerpt show every sentence of their item, with the sentences before them drawn over them', () => {
  const pills = 'Do not take ibuprofen while you are on warfarin unless your doctor has told you to. Together they raise the risk of bleeding in the stomach.';
  const cut = (component: Chosen, passage: string) => verdict(pills, component, { passage, tone: 'caution' });
  const notWhole = { refused: 'part' } as const;
  assert.deepEqual(cut('callout', 'take ibuprofen while you are on warfarin'), { ...notWhole, component: 'callout' }, 'without "Do not" it says the opposite');
  assert.deepEqual(cut('callout', 'Do not take ibuprofen while you are on warfarin'), { ...notWhole, component: 'callout' }, 'without its condition');
  assert.deepEqual(cut('quote', 'take ibuprofen while you are on warfarin unless your doctor has told you to.'), { ...notWhole, component: 'quote' }, 'a sentence without its opening');
  assert.deepEqual(cut('excerpt', 'they raise the risk of bleeding in the stomach.'), { ...notWhole, component: 'excerpt' }, 'a sentence without its first word');
  assert.deepEqual(cut('callout', 'Do not take ibuprofen while you are on warfarin unless your doctor has told you to.'), { ...notWhole, component: 'callout' }, 'the first sentence without the second');
  assert.ok('draw' in cut('callout', pills), 'two whole sentences');
  assert.deepEqual(
    cut('callout', 'Together they raise the risk of bleeding in the stomach.'),
    { draw: { component: 'callout', props: { text: 'Together they raise the risk of bleeding in the stomach.', tone: 'caution', above: ['Do not take ibuprofen while you are on warfarin unless your doctor has told you to.'] } } },
    'the second sentence, under the first',
  );
  assert.deepEqual(cut('callout', 'Take ibuprofen with warfarin.'), { ...notWhole, component: 'callout' }, 'words the text does not hold');

  const caution = 'Caution: the stairs to the cellar are steep and the rail is loose.';
  assert.ok('draw' in verdict(caution, 'callout', { passage: caution }), 'with its marker');
  assert.deepEqual(
    verdict(caution, 'callout', { passage: 'the stairs to the cellar are steep and the rail is loose.' }),
    { draw: { component: 'callout', props: { text: 'the stairs to the cellar are steep and the rail is loose.', tone: 'caution', above: ['Caution:'] } } },
    'and without it, under it',
  );
  assert.deepEqual(verdict(`${caution}\n注意：地窖的楼梯很陡。`, 'callout', { passage: caution }), { ...notWhole, component: 'callout' }, 'one line of two');
  assert.ok('draw' in verdict('注意：地窖的楼梯很陡，扶手也松了。', 'callout', { passage: '注意：地窖的楼梯很陡，扶手也松了。' }), 'a marker in a script without spaces');
  assert.deepEqual(verdict(`${caution}\n注意：地窖的楼梯很陡。`, 'callout', { passage: 'the rail is loose.' }), { ...notWhole, component: 'callout' }, 'the end of a sentence');

  assert.deepEqual(
    verdict('Nonna measured nothing.\nNonna: "Salt it like the sea."', 'quote', { passage: 'Salt it like the sea', by: 'Nonna' }),
    { draw: { component: 'quote', props: { text: 'Salt it like the sea', by: 'Nonna', above: ['Nonna measured nothing.'] } } },
    'the words in quotation marks, after the name of who said them',
  );
  const spoken = 'Nonna measured nothing. "Salt it like the sea," she said.';
  assert.deepEqual(verdict(spoken, 'quote', { passage: 'Salt it like the sea', by: 'Nonna' }), { ...notWhole, component: 'quote' }, 'a quote leaves out the words that say she said them');
  assert.deepEqual(verdict(spoken, 'quote', { passage: 'Salt it like', by: 'Nonna' }), { ...notWhole, component: 'quote' }, 'and the end of what she said');
  assert.deepEqual(verdict('爸爸为什么总在车里坐一会儿才上楼？他说那几分钟是只属于他自己的。', 'quote', { passage: '那几分钟是只属于他自己的。', by: '爸爸' }), { ...notWhole, component: 'quote' }, 'reported speech with no marks is part of its sentence');
});

test('a meaning belongs to its term: it is the whole item, and opens with the term or stands on a line the term labels', () => {
  const essay =
    'When a factory vents its waste into a river, the cost does not vanish. ' +
    'It lands on the people downstream, who pay in dirty water and see no invoice. Costs of this kind are called externalities. The lunch was not free.';
  const meant = (term: string, meaning: string, text = essay) => {
    const made = verdict(text, 'definition', { subject: term, passage: meaning });
    return 'draw' in made ? 'definition' : made.refused;
  };
  assert.equal(meant('lunch', 'who pay in dirty water and see no invoice. Costs of this kind are called externalities.'), 'part', 'a passage from the middle of another sentence');
  assert.equal(meant('factory', 'Costs of this kind are called externalities.'), 'part', 'a whole sentence two sentences away');
  assert.equal(meant('externalities', 'It lands on the people downstream, who pay in dirty water and see no invoice.'), 'part', 'the sentence before the term');
  assert.equal(meant('externalities', 'Costs of this kind are called externalities.'), 'part', 'a sentence that holds the term and does not open with it');
  const opens = 'Externalities are costs that land on people who agreed to none of them.';
  assert.equal(meant('externalities', opens, `${opens} The lunch was not free.`), 'part', 'the sentence that opens with it, without the sentence after it');
  assert.equal(meant('externalities', opens, opens), 'definition', 'the sentence that opens with it, which is all the item says');
  assert.equal(meant('mindfulness', 'Some say mindfulness is just relaxation.', 'Some say mindfulness is just relaxation. It is a practice of attention.'), 'part', 'a sentence that reports what some say');
  assert.equal(meant('externalities', 'The cost of pollution that others bear.'), 'part', 'words the item does not hold');

  assert.equal(meant('Parallax', 'Parallax is the apparent shift of an object when the viewer moves.', 'Parallax is the apparent shift of an object when the viewer moves.'), 'definition', 'a meaning that opens with its term');
  assert.equal(meant('Parallax', 'the apparent shift of an object when the viewer moves', 'Parallax is the apparent shift of an object when the viewer moves.'), 'part', 'the rest of the sentence after the term');
  assert.equal(meant('Parallax', 'the apparent shift of an object when the viewer moves.', 'Parallax: the apparent shift of an object when the viewer moves.'), 'definition', 'a meaning on a line the term labels');
  assert.equal(meant('A tomato', 'a vegetable', 'A tomato is not a vegetable.'), 'part', 'a piece of a sentence that denies it');
  assert.equal(meant('theory', "The term 'theory' means a hunch.", "The term 'theory' means a hunch. Scientists would say that is wrong."), 'part', 'a sentence without the next one, which calls it wrong');
  assert.equal(meant('Weather', 'Climate is the weather of a place over years.', 'Weather\nClimate is the weather of a place over years.'), 'part', 'a term on a line of its own does not mean the sentence under it');
  const climate = verdict('Weather\nClimate is the weather of a place over years.', 'definition', { subject: 'Climate', passage: 'Climate is the weather of a place over years.' });
  assert.deepEqual('draw' in climate && climate.draw.props.above, ['Weather'], 'which is drawn over the meaning of its own term');
  assert.equal(meant('幸存者偏差', '幸存者偏差：只看到经过筛选留下来的人或事，而忽略了被淘汰的那些。', '幸存者偏差：只看到经过筛选留下来的人或事，而忽略了被淘汰的那些。'), 'definition', 'a term and a full-width colon');
  assert.equal(meant('沉没成本', '沉没成本，指的是已经付出而且无论如何都收不回来的成本。', '沉没成本，指的是已经付出而且无论如何都收不回来的成本。'), 'definition', 'a term and a full-width comma');
  assert.equal(meant('最小可行产品', '只做核心功能、能拿去给真实用户试的第一个版本。', '最小可行产品，就是只做核心功能、能拿去给真实用户试的第一个版本。'), 'part', 'the rest of a sentence in a script without spaces');
});

test('a label is the item\'s own words beside its value, as its line or row writes them, and a card with any other label is refused', () => {
  const study = 'First-period absences: 15%\nFell asleep in class, at the start: 31%\nFell asleep in class, at the end: 19%';
  const named = (lines: string[], text = study) => {
    const made = verdict(text, 'facts', { lines });
    return 'draw' in made ? (made.draw.props.facts as { label: string }[]).map(({ label }) => label) : made.refused;
  };
  const [absences, start, end] = ['First-period absences', 'Fell asleep in class, at the start', 'Fell asleep in class, at the end'];
  assert.deepEqual(named([`${absences} | 15%`, `${start} | 31%`, `${end} | 19%`]), [absences, start, end], 'each label as its line writes it');
  assert.equal(named([`${absences} | 15%`, `${start} | 19%`, `${end} | 31%`]), 'part', 'a label beside the value of another line');
  assert.equal(named([`Absences | 15%`, `${start} | 31%`, `${end} | 19%`]), 'part', 'a label with a word of its line left out');
  assert.equal(named([`${absences} | 15%`, 'at the start | 31%', 'at the end | 19%'], study), 'part', 'a label cut from the rest of its line');
  assert.equal(named([`${absences} | 15%`, 'Sleepy at the start | 31%', 'Sleepy at the end | 19%']), 'part', 'words the line does not hold');
  const sentences = 'First-period absences fell by 15%. The share of students who fell asleep in class at least once a week dropped from 31% to 19%.';
  assert.equal(named([`${absences} | 15%`, 'fell asleep in class | 31%', 'asleep, once a week | 19%'], sentences), 'part', 'figures read out of sentences leave the rest of them out');
  assert.deepEqual(verdict('Absences fell by 15%.', 'fact', { passage: '15%', subject: 'Absences' }), { refused: 'part', component: 'fact' }, 'a label without the words between it and its value');
  assert.ok('draw' in verdict('Absences: 15%', 'fact', { passage: '15%', subject: 'Absences' }), 'a label before a colon');

  const budget = '这个月的钱都花在哪儿了：\n| 房租 | 45% |\n| 吃饭 | 25% |\n| 交通 | 10% |\n| 孩子的兴趣班 | 15% |\n| 其他 | 5% |';
  const shares = (numbers: number[]) => verdict(budget, 'breakdown', { labels: ['房租', '吃饭', '交通', '孩子的兴趣班', '其他'], numbers, unit: '%' });
  assert.ok('draw' in shares([45, 25, 10, 15, 5]), 'each share beside its label in its row');
  assert.deepEqual(shares([5, 25, 10, 15, 45]), { refused: 'part', component: 'breakdown' }, 'a share that stands in another row');
  const rent = 'Median rent.\n2019: 980 euros\n2020: 1010 euros\n2021: 1090 euros';
  assert.ok('draw' in verdict(rent, 'chart', { labels: ['2019', '2020', '2021'], numbers: [980, 1010, 1090], unit: 'euros' }), 'each year beside its rent');
  assert.deepEqual(verdict(rent, 'chart', { labels: ['2019', '2020', '2021'], numbers: [1090, 1010, 980], unit: 'euros' }), { refused: 'part', component: 'chart' }, 'the rents in another order');
  assert.deepEqual(verdict('Rent 45%, food 25%', 'breakdown', { labels: ['Rent', 'food'], numbers: [45, 25], unit: '%' }), { refused: 'invalid', component: 'breakdown' }, 'two shares of seventy are no whole');

  const tutoring = kit().item({ title: 'Tutoring', text: 'Pricing\nOne-to-one, an hour: £40\nGroups of three, a head: £25\nHours a week: 10' });
  const facts = (labels: string[], item = tutoring) => byRule({ ...item, data: { facts: [{ label: labels[0]!, value: '£40' }, { label: labels[1]!, value: '£25' }, { label: labels[2]!, value: '10' }] } }, url);
  assert.deepEqual(
    facts(['One-to-one, an hour', 'Groups of three, a head', 'Hours a week']).props,
    { facts: [{ label: 'One-to-one, an hour', value: '£40' }, { label: 'Groups of three, a head', value: '£25' }, { label: 'Hours a week', value: '10' }], above: ['Pricing'] },
    'the rules hold a label that a role extracted to the words of its line',
  );
  assert.equal(facts(['One-to-one, per hour', 'Groups of three, a head', 'Hours a week']).component, 'note', 'and not to other forms of them');
  assert.equal(facts(['One-to-one lessons, an hour', 'Groups of three, a head', 'Hours a week']).component, 'note', 'nor to a label that adds a word, whose figure the grid would leave out');
  assert.equal(facts(['Private lessons', 'Group lessons', 'Hours a week']).component, 'note', 'nor to labels of their own');
  const sentence = kit().item({ title: 'Tutoring', text: 'Pricing: charge £40 an hour for one-to-one and £25 a head for groups of three, and aim for 10 hours a week.' });
  assert.equal(facts(['one-to-one, an hour', 'groups of three, a head', 'hours a week'], sentence).component, 'note', 'nor to words gathered from a sentence');
});

test('a dedicated card always wins: a sheet of one section under its item\'s heading and opening is that section\'s own card, and a sheet with text that card would leave out stays a sheet', () => {
  const component = (text: string, sections: Part[]) => {
    const made = verdict(text, 'sheet', { sections });
    return 'draw' in made ? made.draw.component : made.refused;
  };
  const tower = 'The tower in short.\nHeight: 330 m\nBuilt: 1889\nSteps: 1,665';
  const about = part('text', { text: 'The tower in short.' });
  assert.equal(component(tower, [about, part('figures', { lines: ['Height | 330 m', 'Built | 1889', 'Steps | 1,665'] })]), 'facts', 'figures');
  assert.equal(component('Height of the tower: 330 m', [part('heading', { text: 'the tower' }), part('figures', { lines: ['Height of the tower | 330 m'] })]), 'fact', 'one figure');
  assert.equal(component('Bring for the weekend:\n- a tent\n- two sleeping bags\n- a head torch', [part('text', { text: 'Bring for the weekend:' }), part('list', { lines: ['a tent', 'two sleeping bags', 'a head torch'] })]), 'list', 'a list');
  assert.equal(component('Per seat.\nPlan | Price\nSolo | $8\nTeam | $20\nOrg | $90', [part('text', { text: 'Per seat.' }), part('table', { lines: ['Plan | Price', 'Solo | $8', 'Team | $20', 'Org | $90'] })]), 'table', 'a table');
  assert.equal(component('Nonna: "Salt it like the sea, and taste the water."', [part('heading', { text: 'Nonna\'s advice' }), part('excerpt', { text: 'Salt it like the sea, and taste the water.', by: 'Nonna' })]), 'quote', 'words someone said');
  assert.equal(component('From chapter 3.\nEvery stair keeps the weight of who climbed it, and every door the hands that held it.', [part('text', { text: 'From chapter 3.' }), part('excerpt', { text: 'Every stair keeps the weight of who climbed it, and every door the hands that held it.' })]), 'excerpt', 'a passage');

  const ask = 'Maria Chen, head of design at Orbit, has said her team will test the onboarding flow. For that we need:';
  const needs = ['the build ready by the first week of December', 'a short script for the sessions', 'someone to take notes'];
  const after = 'The five customers who offered in the spring can come in the week after.';
  const plan = `${ask}\n${needs.map((need) => `- ${need}`).join('\n')}\n${after}`;
  assert.equal(component(plan, [part('text', { text: ask }), part('list', { lines: needs }), part('text', { text: after })]), 'sheet', 'the sheet keeps the sentence after the list, which the list would leave out');
  assert.deepEqual(verdict(plan, 'list', { lines: needs }), { refused: 'part', component: 'list' }, 'so the model may not choose the list by itself');
  const list = verdict(`${ask}\n${needs.map((need) => `- ${need}`).join('\n')}`, 'list', { lines: needs });
  assert.deepEqual('draw' in list && list.draw.props.above, [ask], 'and may when nothing follows it');
});

test('an entry is whole units, so the condition a sentence opens with stays with it, and a card of pieces is refused', async () => {
  const plan =
    'Ask Maria Chen, head of design at Orbit, whether her team would test the onboarding flow. If she agrees we need the build ready by the first week of December, ' +
    'a short script for the sessions, and someone to take notes. If she does not, fall back to the five customers who offered in the spring.';
  const needs = ['the build ready by the first week of December', 'a short script for the sessions', 'someone to take notes'];
  assert.deepEqual(verdict(plan, 'list', { lines: needs }), { refused: 'part', component: 'list' }, 'entries cut out of a sentence');
  assert.deepEqual(verdict(plan, 'steps', { lines: ['Ask Maria Chen, head of design at Orbit, whether her team would test the onboarding flow.', ...needs] }), { refused: 'part', component: 'steps' }, 'a whole sentence and pieces of the next');
  const sheet = verdict(plan, 'sheet', { sections: [part('text', { text: 'Ask Maria Chen, head of design at Orbit, whether her team would test the onboarding flow.' }), part('list', { lines: needs })] });
  assert.deepEqual(sheet, { refused: 'part', component: 'sheet' }, 'and so is a sheet of them');
  const branches = verdict(plan, 'steps', { lines: plan.split(/(?<=\.) /) });
  assert.ok('draw' in branches, 'the sentences whole, each with its condition');
  for (const [text, entries] of [['When you arrive, collect your badge, your key and the map.', ['your badge', 'your key', 'the map']], ['Unless it rains, bring a hat, a towel and sun cream.', ['a hat', 'a towel', 'sun cream']], ['如果下雨，就带伞、雨衣和雨靴。', ['伞', '雨衣', '雨靴']], ['要是她同意，我们需要场地、投影和茶点。', ['场地', '投影', '茶点']]] as const) {
    assert.equal('refused' in verdict(text, 'list', { lines: [...entries] }), true, text);
  }
  assert.ok('draw' in verdict('Bring:\n- a hat\n- a towel\n- sun cream', 'list', { lines: ['a hat', 'a towel', 'sun cream'] }), 'entries that are lines');

  const k = kit();
  const { ids } = grow(k, [{ title: 'Orbit', text: plan }]);
  k.model.on('renderer.components', () => ({ items: [{ ...said('list', { lines: needs }), id: ids[0]! }] })).on('renderer.composites', () => ({ groups: [] }));
  await render(k, ids);
  assert.equal(k.notes.at(-1), `renderer: Kept "Orbit" as the rules drew it: the model's list ${WHOLE}.`, 'the run log says why');
});

test('the model may not take a conversation apart: a dialogue keeps its note', () => {
  const chat = 'Mum: Has anyone seen the photo of Grandad on the tractor?\nBen: I think it is in the blue album\nMum: I looked. It is not there\nCaz: I have it! I will bring it Sunday\nBen: Scan it first this time';
  for (const [component, slots] of [
    ['qa', { subject: 'Has anyone seen the photo of Grandad on the tractor?', passage: 'I think it is in the blue album' }],
    ['list', { lines: ['I will bring it Sunday', 'Scan it first this time'] }],
    ['steps', { lines: ['I will bring it Sunday', 'Scan it first this time'] }],
    ['sheet', { sections: [part('text', { text: 'Has anyone seen the photo of Grandad on the tractor?' }), part('list', { lines: ['I will bring it Sunday', 'Scan it first this time'] })] }],
  ] as const) {
    assert.ok('refused' in verdict(chat, component, slots as never), component);
  }
  assert.deepEqual(verdict(chat, 'note', { emphasis: 'Caz: I have it!' }), { draw: { component: 'note', props: { emphasis: 'Caz: I have it!' } } }, 'a note may set apart a sentence of it, with the name of who said it');
  assert.deepEqual(verdict(chat, 'note', { emphasis: 'I have it!' }), { draw: { component: 'note', props: {} }, left: [{ prop: 'emphasis', why: 'part' }] }, 'and draws none without the name');
  const zh = '用户：孩子七岁，游泳和围棋选哪个好？\n\n助手：先看孩子自己的意愿。\n\n用户：她比较好动。\n\n助手：那建议先学游泳。';
  assert.deepEqual(verdict(zh, 'qa', { subject: '孩子七岁，游泳和围棋选哪个好？', passage: '先看孩子自己的意愿。' }), { refused: 'part', component: 'qa' }, 'a question and an answer without who asked and who answered');
  assert.deepEqual(verdict(zh, 'qa', { subject: '孩子七岁，游泳和围棋选哪个好？', passage: '助手：先看孩子自己的意愿。' }), { refused: 'part', component: 'qa' }, 'or with the rest of the conversation left out');
});

test('a sheet keeps its shape: one heading and it first, four sections at most, each within its room and never cut to it, and never text alone', () => {
  const shape = (sections: Part[], text = ROOF) => {
    const made = verdict(text, 'sheet', { sections });
    return 'draw' in made ? (made.draw.props.sections as { kind: string }[]).map((section) => section.kind) : made.refused;
  };
  const [heading, other] = [part('heading', { text: 'The pool roof' }), part('heading', { text: 'The roof' })];
  const [council, meantime, both] = [part('text', { text: COUNCIL }), part('text', { text: MEANTIME }), part('text', { text: `${COUNCIL} ${MEANTIME}` })];
  const costs = part('figures', { lines: COSTS });
  const quoted = part('excerpt', { text: ADEYEMI, by: 'Mrs Adeyemi' });
  assert.equal(shape([council, meantime]), 'invalid', 'text alone is a note');
  assert.equal(shape([heading, costs]), 'invalid', 'a heading and one section is no sheet');
  assert.equal(shape([part('picture'), both, costs, quoted]), 'invalid', 'an item with no picture has none to show');
  assert.deepEqual(shape([heading, both, costs, quoted]), ['heading', 'text', 'figures', 'excerpt'], 'a heading first and three sections');
  assert.equal(shape([heading, other, both, costs]), 'invalid', 'two headings are refused, and the second is not dropped in silence');
  assert.equal(shape([both, heading, costs, quoted]), 'invalid', 'a heading that is not first');
  assert.equal(shape([heading, council, meantime, costs, quoted]), 'invalid', 'five sections, a heading counted, are not cut to four');
  assert.equal(shape([council, meantime, costs, quoted, part('list', { lines: ['the contractor', 'the dates for the school'] })]), 'invalid', 'nor are five without a heading');

  const diary = 'Rain by month, in millimetres, at the allotment, which we wrote down every morning before work for the whole of last year, mostly out of stubbornness and partly to settle an argument about whether the summer was really as wet as it felt at the time.';
  const names = ['Ada', 'Ben', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal', 'Ivy', 'Jo'];
  const rain = [['Jan', '81'], ['Feb', '60'], ['Mar', '55'], ['Apr', '41'], ['May', '47'], ['Jun', '52']];
  const kept = (months: number, people: number) => {
    const rows = rain.slice(0, months).map((row) => row.join(' | '));
    const text = `${diary}\nMonth | Rain\n${rows.join('\n')}\nThe names were:\n${names.slice(0, people).map((name) => `- ${name}`).join('\n')}`;
    return shape([part('text', { text: diary }), part('table', { lines: ['Month | Rain', ...rows] }), part('list', { text: 'The names were:', lines: names.slice(0, people) })], text);
  };
  assert.deepEqual(kept(5, 8), ['text', 'table', 'list'], 'five rows and eight entries fit');
  assert.equal(kept(6, 8), 'invalid', 'a sixth row is past the room of a table in a sheet, and the table is not cut to it');
  assert.equal(kept(5, 10), 'invalid', 'and so are ten entries of a list');

  const passage = `${LONG} `.repeat(4).trim();
  const priced = `${passage}\ncost: £48,000`;
  assert.equal(shape([part('text', { text: passage }), part('figures', { lines: ['cost | £48,000'] })], priced), 'invalid', 'a passage past the room of a sheet');
  assert.equal(shape([part('text', { text: `${passage.slice(0, 278)}…` }), part('figures', { lines: ['cost | £48,000'] })], priced), 'part', 'and the same passage cut short with an ellipsis');
  assert.equal(isValidView({ component: 'sheet', props: { sections: [{ kind: 'text', text: 'x'.repeat(ROOM.text + 1) }, { kind: 'figures', facts: [{ label: 'a', value: '1' }] }] } }), false, 'the library refuses a passage past its room');
  assert.equal(isValidView({ component: 'sheet', props: { sections: [{ kind: 'text', text: 'x' }, { kind: 'figures', facts: [{ label: 'a'.repeat(ROOM.label + 1), value: '1' }] }] } }), false, 'and a label past its own');
  assert.equal(isValidView({ component: 'sheet', props: { sections: [{ kind: 'heading', text: 'x'.repeat(ROOM.heading + 1) }, { kind: 'text', text: 'x' }, { kind: 'figures', facts: [{ label: 'a', value: '1' }] }] } }), false);
  assert.equal(isValidView({ component: 'sheet', props: { sections: [{ kind: 'text', text: 'x' }, { kind: 'excerpt', text: 'x'.repeat(ROOM.passage.spaced + 1) }] } }), false);
});

test('a card the model chose is held to its whole item as a rule is, and a picture section shows the picture the item has', () => {
  const diary = `${LONG} ${LONG} We paid 12 euros for the ferry. ${LONG}`;
  assert.deepEqual(verdict(diary, 'fact', { passage: '12 euros', subject: 'Ferry' }), { refused: 'part', component: 'fact' }, 'a figure from the middle of a diary');
  assert.deepEqual(verdict(diary, 'note', { emphasis: 'We paid 12 euros for the ferry' }), { draw: { component: 'note', props: {} }, left: [{ prop: 'emphasis', why: 'part' }] }, 'a note sets apart no sentence that far into it');
  assert.deepEqual(verdict(`We paid 12 euros for the ferry. ${LONG} ${LONG}`, 'note', { emphasis: 'We paid 12 euros for the ferry.' }), { draw: { component: 'note', props: { emphasis: 'We paid 12 euros for the ferry.' } } }, 'and does set apart the sentence that opens it');
  assert.deepEqual(verdict(diary, 'fact', { passage: '', subject: 'Ferry' }), { refused: 'part', component: 'fact' }, 'a fact with no value');
  assert.deepEqual(verdict(diary, 'steps', { lines: ['We paid 12 euros for the ferry'] }), { refused: 'part', component: 'steps' }, 'one step of a diary');

  const harbour = (text: string, data: Record<string, unknown> = { image: 'https://example.org/harbour.jpg' }) => kit().item({ title: 'The harbour', text, data });
  const ferry = part('figures', { lines: ['Ferry | 12 euros'] });
  const priced = `${LONG}\nFerry: 12 euros`;
  assert.deepEqual(byModel(said('sheet', { sections: [part('picture'), ferry] }), harbour(`${LONG} We paid 12 euros for the ferry.`), url), { refused: 'part', component: 'sheet' }, 'a picture and a figure the sentence does not lay out so');
  assert.deepEqual(
    byModel(said('sheet', { sections: [part('picture'), part('text', { text: LONG }), ferry] }), harbour(priced), url),
    { draw: { component: 'sheet', props: { sections: [{ kind: 'picture', src: 'https://example.org/harbour.jpg' }, { kind: 'text', text: LONG }, { kind: 'figures', facts: [{ label: 'Ferry', value: '12 euros' }] }] } } },
    'the item\'s own picture beside its words',
  );
  assert.deepEqual(byModel(said('sheet', { sections: [part('picture'), part('text', { text: LONG }), ferry] }), harbour(priced, {}), url), { refused: 'invalid', component: 'sheet' }, 'an item with no picture has none to show');
});

test('a card that would turn a text around is not drawn: a passage is drawn under the lead that denies it or not at all, and a wrapped sentence, a label of another line or a meaning someone else gave is refused', () => {
  const callout = (passage: string) => said('callout', { passage, tone: 'caution' });
  const cases: [string, ComponentsReply['items'][number], string][] = [
    ['Wrong: store the vaccine in the freezer. Right: store it in the fridge door, never the freezer.', callout('store the vaccine in the freezer.'), 'store the vaccine in the freezer.'],
    ['错误：发烧时多穿衣服捂汗。正确：适当减少衣物，多喝水。', callout('发烧时多穿衣服捂汗。'), '捂汗'],
    ['Claim: the drug is safe in pregnancy. Evidence: none so far, and two case reports suggest harm.', said('excerpt', { passage: 'the drug is safe in pregnancy.' }), 'safe in pregnancy'],
    ['It is not true that "the vaccine changes your DNA." It does not.', callout('the vaccine changes your DNA.'), 'DNA'],
    ['"Sugar makes children hyperactive" is a myth that a dozen trials have failed to support.', said('quote', { passage: 'Sugar makes children hyperactive' }), 'hyperactive'],
    ['"Never," she said, "take the pills with alcohol."', callout('take the pills with alcohol.'), 'alcohol'],
    ['Do not\ntake ibuprofen while you are on warfarin. Together they raise the risk of bleeding.', callout('take ibuprofen while you are on warfarin.'), 'take ibuprofen'],
    ['身高88厘米\n体重12.5公斤\n头围47厘米', said('facts', { lines: ['身高 | 12.5公斤', '体重 | 12.5公斤', '头围 | 47厘米'] }), '"身高","value":"12.5'],
    ['Rent is due on the 1st. The deposit is £900. Bills are £120.', said('facts', { lines: ['Rent | £900', 'Deposit | £900', 'Bills | £120'] }), '"Rent"'],
    ['2022年 卖了120台\n2023年 卖了95台\n2024年 卖了140台', said('chart', { labels: ['2022年', '2023年', '2024年'], numbers: [95, 120, 140], unit: '台' }), '[95,120,140]'],
    ['Inflation is a general rise in prices. Deflation is the opposite, a general fall.', said('definition', { subject: 'inflation', passage: 'Deflation is the opposite, a general fall.' }), 'Deflation'],
    ['有人说内卷是指努力工作。这是误解，内卷是指无效的过度竞争。', said('definition', { subject: '内卷', passage: '努力工作。' }), '努力工作'],
    ["A common mistake is thinking that 'literally' means 'figuratively'.", said('definition', { subject: 'literally', passage: "'figuratively'." }), 'figuratively'],
    [
      'Take two tablets only if a doctor says so.\nDose: 500 mg per tablet\nStore below 25°C\nKeep away from children',
      said('sheet', { sections: [part('text', { text: 'Take two tablets…' }), part('list', { lines: ['Store below 25°C', 'Keep away from children'] }), part('figures', { lines: ['Dose | 500 mg per tablet'] })] }),
      'Take two tablets…',
    ],
  ];
  for (const [text, reply, shown] of cases) {
    const made = byModel(reply, kit().item({ title: 'Untitled', text }), url);
    assert.ok(!('draw' in made) || !JSON.stringify(made.draw.props).includes(shown), `${text}: ${'draw' in made ? JSON.stringify(made.draw.props) : made.refused}`);
  }
  // A lead the card draws over its passage is read with it, as the item writes them: the card shows the whole item.
  const led: [string, string, string][] = [
    ['Not recommended: giving honey to babies under one year old.', 'giving honey to babies under one year old.', 'Not recommended:'],
    ['禁止：在加油站吸烟或打电话。', '在加油站吸烟或打电话。', '禁止：'],
    ['服药期间请勿\n饮酒或驾驶机动车，以免发生危险。', '饮酒或驾驶机动车，以免发生危险。', '服药期间请勿'],
  ];
  for (const [text, passage, lead] of led) {
    assert.deepEqual(byModel(callout(passage), kit().item({ title: 'Untitled', text }), url), { draw: { component: 'callout', props: { text: passage, tone: 'caution', above: [lead] } } }, `${text}: drawn under its lead`);
  }
});

test('a figure whose label is a piece cut out of its line refuses the card, with a line in the run log', async () => {
  const k = kit();
  const lunch = '上个月我们走访了六家食堂。\n一份午餐平均卖：12元\n成本：16元左右\n每天就餐人数：80人上下';
  const { ids } = grow(k, [{ title: 'Lunch', text: lunch }, { title: 'Piece', text: lunch }]);
  k.model
    .on('renderer.components', () => ({
      items: [
        { ...said('facts', { lines: ['一份午餐平均卖 | 12元', '成本 | 16元左右', '每天就餐人数 | 80人上下'] }), id: ids[0]! },
        { ...said('facts', { lines: ['午餐平均卖 | 12元', '成本 | 16元左右', '每天就餐人数 | 80人上下'] }), id: ids[1]! },
      ],
    }))
    .on('renderer.composites', () => ({ groups: [] }));
  await render(k, ids);
  assert.deepEqual(
    view(k, ids[0]!).props,
    { facts: [{ label: '一份午餐平均卖', value: '12元' }, { label: '成本', value: '16元左右' }, { label: '每天就餐人数', value: '80人上下' }], above: ['上个月我们走访了六家食堂。'] },
    'each label as its line writes it, under the sentence over them',
  );
  assert.equal(view(k, ids[1]!).component, 'note', 'a label without the words that open its line');
  assert.deepEqual(k.notes, [`renderer: Kept "Piece" as the rules drew it: the model's facts ${WHOLE}.`], 'the run log says why');
});

test('a reply the checks cannot read leaves its own item as the rules drew it, and the rest of the pass draws on', async () => {
  const k = kit();
  const { ids } = grow(k, [
    { title: 'Bring for the weekend', text: 'Bring for the weekend:\n- a tent\n- two sleeping bags\n- a head torch, and spare batteries for it' },
    { title: 'Sourdough', text: 'Feed the starter once a day with flour and water.\nNever rinse the jar with hot water.' },
  ]);
  const list = CHECKS.list as { frame?: unknown };
  const frame = list.frame;
  list.frame = () => {
    throw new Error('no frame');
  };
  try {
    k.model
      .on('renderer.components', () => ({
        items: [
          entry({ id: ids[0]!, component: 'list', lines: ['a tent', 'two sleeping bags', 'a head torch, and spare batteries for it'] }),
          entry({ id: ids[1]!, component: 'callout', passage: 'Never rinse the jar with hot water.', tone: 'caution' }),
        ],
      }))
      .on('renderer.composites', () => ({ groups: [] }));
    await render(k, ids);
  } finally {
    list.frame = frame;
  }
  assert.equal(view(k, ids[0]!).component, 'note', 'the reply that threw keeps the rules\' card');
  assert.deepEqual(view(k, ids[1]!).props, { text: 'Never rinse the jar with hot water.', tone: 'caution', above: ['Feed the starter once a day with flour and water.'] }, 'the other reply of the pass is drawn');
  assert.ok(k.notes.some((note) => note.includes('could not be checked (no frame)')), 'the run log says which reply could not be checked');
});

test('a card draws each piece of its item where it stands, with the marks around it: quotation marks, the item\'s own numbers, a sign and its row and column', () => {
  const drawn = (text: string, component: Chosen, slots: Partial<ComponentsReply['items'][number]>, title = 'Card') => {
    const result = verdict(text, component, slots, title);
    return 'draw' in result ? result.draw.props : result.refused;
  };
  // Quotation marks around an entry or a passage are its words; a quote card draws a pair of its own, and never one mark of a pair.
  assert.deepEqual(drawn('- "Vaccines cause autism."\n- "Detox teas flush out toxins."', 'list', { lines: ['Vaccines cause autism.', 'Detox teas flush out toxins.'] }), { items: ['"Vaccines cause autism."', '"Detox teas flush out toxins."'] });
  for (const passage of ['"Never mix bleach and ammonia." — Mum', 'Never mix bleach and ammonia." — Mum']) {
    assert.deepEqual(drawn('"Never mix bleach and ammonia." — Mum', 'callout', { passage, tone: 'caution' }), { text: '"Never mix bleach and ammonia." — Mum', tone: 'caution' }, passage);
  }
  assert.deepEqual(drawn('“药不管用就加倍吃。”', 'callout', { passage: '药不管用就加倍吃。', tone: 'caution' }), { text: '“药不管用就加倍吃。”', tone: 'caution' });
  assert.deepEqual(drawn('“The best way to predict the future is to invent it.” — Alan Kay', 'quote', { passage: 'The best way to predict the future is to invent it.', by: 'Alan Kay' }), { text: 'The best way to predict the future is to invent it.', by: 'Alan Kay' });
  assert.equal(drawn('Mum said nothing at all. Dad said, "You should have revised harder."', 'quote', { passage: 'said nothing at all. Dad said, "You should have revised harder."', by: 'Mum' }), 'part', 'words that only follow a name are no quotation of theirs');
  assert.equal(drawn('班主任没说话。教导主任说：“这孩子不用补课。”', 'quote', { passage: '没说话。教导主任说：“这孩子不用补课。”', by: '班主任' }), 'part');
  // The item's own numbers: a steps card draws 1, 2, 3, so a countdown, years or a line it does not number are no steps of it.
  const countdown = '5. Heat\n4. Alien\n3. Ran\n2. Vertigo\n1. Ikiru';
  assert.equal(drawn(countdown, 'steps', { lines: ['Heat', 'Alien', 'Ran', 'Vertigo', 'Ikiru'] }), 'part', 'a countdown is not renumbered');
  assert.equal(drawn(countdown, 'steps', { lines: countdown.split('\n') }), 'part', 'a step that keeps its number is no step');
  assert.deepEqual(drawn(countdown, 'list', { lines: countdown.split('\n') }), { items: countdown.split('\n') }, 'a list draws the numbers as written');
  assert.deepEqual(drawn('2019. We moved to Leeds.\n2021. We moved back to Hull.', 'list', { lines: ['2019. We moved to Leeds.', '2021. We moved back to Hull.'] }), { items: ['2019. We moved to Leeds.', '2021. We moved back to Hull.'] });
  assert.equal(drawn('2019. We moved to Leeds.\n2021. We moved back to Hull.', 'list', { lines: ['We moved to Leeds.', 'We moved back to Hull.'] }), 'part', 'a year is no list number');
  const ps = '1. Fill the kettle halfway with water.\n2. Add two tablespoons of bleach.\nPS: ignore step 2, use white vinegar.';
  assert.equal(drawn(ps, 'steps', { lines: ['Fill the kettle halfway with water.', 'Add two tablespoons of bleach.', 'PS: ignore step 2, use white vinegar.'] }), 'part', 'a line the item leaves unnumbered is no third step');
  assert.deepEqual(drawn('1、5天后复查\n2、3个月内不要剧烈运动', 'steps', { lines: ['5天后复查', '3个月内不要剧烈运动'] }), { steps: ['5天后复查', '3个月内不要剧烈运动'] }, 'numbers that count from one are the steps card\'s');
  // A list line is one line: a heading under it is never a part of it.
  assert.equal(drawn('Pack in the cabin bag:\n- Passport\n- Power banks\nDo NOT pack in the hold:\n- Lighters', 'list', { lines: ['Passport', 'Power banks Do NOT pack in the hold:', 'Lighters'] }), 'part');
  // A cell is the item's cell at its own row and column, an empty one too.
  const pills = '| Medicine | Morning | Night |\n|---|---|---|\n| Ibuprofen | 200 mg | |\n| Melatonin | | 3 mg |';
  assert.equal(drawn(pills, 'table', { lines: ['Medicine | Morning | Night', 'Ibuprofen | 200 mg | ', 'Melatonin | 3 mg | '] }), 'part', 'a blank cell moved');
  assert.deepEqual(drawn(pills, 'table', { lines: ['Medicine | Morning | Night', 'Ibuprofen | 200 mg | ', 'Melatonin |  | 3 mg'] }), { heads: ['Medicine', 'Morning', 'Night'], rows: [['Ibuprofen', '200 mg', ''], ['Melatonin', '', '3 mg']] });
  assert.equal(drawn('| Year | 2024 | 2025 |\n|---|---|---|\n| Profit margin | 5% | -3% |', 'facts', { lines: ['Year 2024 | 2025', 'Profit margin 5% | -3%'] }), 'part', 'a label is one cell');
  assert.equal(drawn('| 食物 | 孕期 |\n|---|---|\n| 生鱼片 | 不宜 |\n| 熟鱼 | 可以 |', 'facts', { lines: ['不宜 | 生鱼片', '可以 | 熟鱼'] }), 'part', 'a table\'s figures read across the row, as its heads do');
  // A value is one whole number with its sign and its sign word.
  assert.equal(drawn('Q1: − 3%\nQ2: 4%', 'facts', { lines: ['Q1 | 3%', 'Q2 | 4%'] }), 'part', 'a minus sign with a space after it');
  assert.deepEqual(drawn('Q1: − 3%\nQ2: 4%', 'facts', { lines: ['Q1 | -3%', 'Q2 | 4%'] }), { facts: [{ label: 'Q1', value: '− 3%' }, { label: 'Q2', value: '4%' }] });
  assert.equal(drawn('Margin: minus 3%', 'fact', { subject: 'Margin minus', passage: '3%' }), 'part');
  assert.equal(drawn('利润率：负3%\n营收：12亿', 'facts', { lines: ['利润率：负 | 3%', '营收 | 12亿'] }), 'part');
  assert.equal(drawn('今晚最低气温\n零下\n25度', 'fact', { subject: '零下', passage: '25度' }), 'part', 'a sign word on the line over the value');
  assert.equal(drawn('Dose: 1/2 tablet\nAt night: 4,5 mg', 'facts', { lines: ['Dose: 1 | 2 tablet', 'At night: 4 | 5 mg'] }), 'part', 'a number split across a label and a value');
  // A term ends where a word does; a state's name labels its own line; an answer answers one question.
  assert.equal(drawn('病毒性肺炎是由病毒引起的肺部感染。', 'definition', { subject: '病毒', passage: '病毒性肺炎是由病毒引起的肺部感染。' }), 'part');
  assert.deepEqual(drawn('病毒性肺炎是由病毒引起的肺部感染。', 'definition', { subject: '病毒性肺炎', passage: '病毒性肺炎是由病毒引起的肺部感染。' }), { term: '病毒性肺炎', definition: '病毒性肺炎是由病毒引起的肺部感染。' });
  const aperture = 'Wide open vs stopped down\n- The background melts into a soft blur.\n- Everything from the fence to the hills is sharp.';
  const toggle = (states: string[], texts: string[]) => ({ controls: [{ kind: 'toggle' as const, label: 'Aperture', states, texts, name: '', unit: '', min: 0, max: 0, values: [] }] });
  assert.equal(drawn(aperture, 'explorable', toggle(['Stopped down', 'Wide open'], ['The background melts into a soft blur.', 'Everything from the fence to the hills is sharp.']), 'Aperture'), 'part', 'names that label no line of their state');
  const labelled = 'Wide open: the background melts into a soft blur.\nStopped down: everything from the fence to the hills is sharp.';
  assert.equal(drawn(labelled, 'explorable', toggle(['Stopped down', 'Wide open'], ['the background melts into a soft blur.', 'everything from the fence to the hills is sharp.']), 'Aperture'), 'part', 'names swapped against the lines they label');
  assert.deepEqual(
    (drawn(labelled, 'explorable', toggle(['wide open', 'stopped down'], ['the background melts into a soft blur.', 'everything from the fence to the hills is sharp.']), 'Aperture') as PropsOf<'explorable'>).controls[0],
    { kind: 'toggle', label: 'Aperture', states: [{ name: 'Wide open', text: 'the background melts into a soft blur.' }, { name: 'Stopped down', text: 'everything from the fence to the hills is sharp.' }] },
    'each name as its line writes it',
  );
  assert.equal(drawn('问：怀孕34周能坐飞机吗？\n答：大多数航空公司允许。\n问：36周以后呢？\n答：基本都不允许。', 'qa', { subject: '怀孕34周能坐飞机吗？', passage: '大多数航空公司允许。\n问：36周以后呢？\n答：基本都不允许。' }), 'part');
});

test('a figure\'s label is all its line writes before the separator and its value all it writes after, drawn as written; a term is its whole subject; a list keeps the numbers the item writes', () => {
  const drawn = (text: string, component: Chosen, slots: Partial<ComponentsReply['items'][number]>, title = 'Card') => {
    const result = verdict(text, component, slots, title);
    return 'draw' in result ? result.draw.props : result.refused;
  };
  // What the value's words leave out after the separator is the value's, and a chart reads its number from all of it.
  assert.deepEqual(drawn('Margin: - 3%\nRevenue: 12%', 'facts', { lines: ['Margin | 3%', 'Revenue | 12%'] }), { facts: [{ label: 'Margin', value: '- 3%' }, { label: 'Revenue', value: '12%' }] });
  assert.deepEqual(drawn('Margin: – 3%\nCash: — 2%', 'facts', { lines: ['Margin | 3%', 'Cash | 2%'] }), { facts: [{ label: 'Margin', value: '– 3%' }, { label: 'Cash', value: '— 2%' }] });
  assert.equal(drawn('Margin: - 3%\nRevenue: 12%', 'chart', { labels: ['Margin', 'Revenue'], numbers: [3, 12], unit: '%' }), 'part', 'a chart reads -3 off "- 3%"');
  assert.deepEqual(drawn('Margin: - 3%\nRevenue: 12%', 'chart', { labels: ['Margin', 'Revenue'], numbers: [-3, 12], unit: '%' }), { chart: 'bar', labels: ['Margin', 'Revenue'], values: [-3, 12], unit: '%' });
  assert.deepEqual(drawn('Net income: (1,234)\nRevenue: 4,210', 'chart', { labels: ['Net income', 'Revenue'], numbers: [-1234, 4210], unit: '' }), { chart: 'bar', labels: ['Net income', 'Revenue'], values: [-1234, 4210] }, 'brackets around a figure make it negative');
  // A label that runs past its separator takes a part of the value with it.
  for (const [text, lines] of [
    ['Revenue: down 12%\nRate: under 5%', ['Revenue: down | 12%', 'Rate: under | 5%']],
    ['Error rate: <5%\nAge: ≥ 18', ['Error rate: < | 5%', 'Age: ≥ | 18']],
    ['利润率：减3%\n营收：降12%', ['利润率：减 | 3%', '营收：降 | 12%']],
    ['Dose: 3–5 tablets\nMax: 8 a day', ['Dose: 3 | –5 tablets', 'Max | 8 a day']],
    ['Rent: 1 200 €\nDose: 1 / 2 tablet', ['Rent: 1 | 200 €', 'Dose: 1 / | 2 tablet']],
    ['Net income: (1,234)\nRevenue: 4,210', ['Net income: ( | 1,234)', 'Revenue | 4,210']],
  ] as [string, string[]][]) {
    assert.equal(drawn(text, 'facts', { lines }), 'part', lines[0]!);
  }
  assert.deepEqual(drawn('Revenue: down 12%\nRate: under 5%', 'facts', { lines: ['Revenue | down 12%', 'Rate | under 5%'] }), { facts: [{ label: 'Revenue', value: 'down 12%' }, { label: 'Rate', value: 'under 5%' }] });
  assert.equal(drawn('Dose 3–5 tablets', 'fact', { subject: 'Dose 3', passage: '–5 tablets' }), 'part', 'nothing between a label and its value in a script written with spaces');
  // A comma before three digits groups thousands, so the days are figures and no table.
  assert.deepEqual(drawn('Mon: 5,000\nTue: 7,200\nWed: 6,100', 'chart', { labels: ['Mon', 'Tue', 'Wed'], numbers: [5000, 7200, 6100], unit: '' }), { chart: 'bar', labels: ['Mon', 'Tue', 'Wed'], values: [5000, 7200, 6100] });
  // A term is all the subject before the word that says what it means.
  assert.equal(drawn('Apple pie is a baked dessert of apples in pastry.', 'definition', { subject: 'Apple', passage: 'Apple pie is a baked dessert of apples in pastry.' }), 'part');
  assert.equal(drawn('手指是手掌末端的五个分支。', 'definition', { subject: '手', passage: '手指是手掌末端的五个分支。' }), 'part');
  assert.deepEqual(drawn('手指是手掌末端的五个分支。', 'definition', { subject: '手指', passage: '手指是手掌末端的五个分支。' }), { term: '手指', definition: '手指是手掌末端的五个分支。' });
  const zoom = 'A dolly zoom is a shot in which the camera moves in as the lens zooms out.';
  assert.deepEqual(drawn(zoom, 'definition', { subject: 'Dolly zoom', passage: zoom }), { term: 'dolly zoom', definition: zoom }, 'a term may leave out the article of its subject, and is drawn as written after it');
  assert.equal(drawn(zoom, 'definition', { subject: 'zoom', passage: zoom }), 'part', 'and nothing else');
  for (const [term, meaning] of [
    ['Bokeh', 'Bokeh means the quality of the blur in the parts of a picture that are out of focus.'],
    ['Parallax', 'Parallax refers to the apparent shift of an object against its background when the viewer moves.'],
    ['Dolly zooms', 'Dolly zooms are shots in which the camera and the lens move against each other.'],
  ]) {
    assert.deepEqual(drawn(meaning!, 'definition', { subject: term, passage: meaning }), { term, definition: meaning }, meaning);
  }
  // A list keeps the numbers the item writes, even 1, 2, 3; a steps card draws those itself.
  assert.deepEqual(drawn('1. B\n2. D\n3. A', 'list', { lines: ['B', 'D', 'A'] }), { items: ['1. B', '2. D', '3. A'] });
  assert.deepEqual(drawn('1、王芳\n2、李强\n3、张伟', 'list', { lines: ['王芳', '李强', '张伟'] }), { items: ['1、王芳', '2、李强', '3、张伟'] });
  assert.deepEqual(drawn('1. B\n2. D\n3. A', 'steps', { lines: ['B', 'D', 'A'] }), { steps: ['B', 'D', 'A'] });
  // A quotation inside the quoted words keeps its marks.
  assert.deepEqual(drawn('She said, "He told me \'never sign it.\'"', 'quote', { passage: "He told me 'never sign it.'", by: 'She said' }), { text: "He told me 'never sign it.'", by: 'She said' });
});

test('a number that opens a line is an entry\'s only when white space follows its stop', () => {
  const rates = 'Rates we were quoted this week by the banks:\n4.2%\n3.1%';
  assert.deepEqual(verdict(rates, 'list', { lines: ['2%', '1%'] }), { refused: 'part', component: 'list' }, 'the decimals of 4.2% and 3.1% are no list numbers');
  assert.deepEqual(verdict(rates, 'list', { lines: ['4.2%', '3.1%'] }), { draw: { component: 'list', props: { items: ['4.2%', '3.1%'], above: ['Rates we were quoted this week by the banks:'] } } }, 'the whole rates are the list');
  for (const line of ['1.5 cups flour', '3.14 is pi', '2024.11 发布']) {
    assert.deepEqual(verdict(`Notes:\n${line}\n2 eggs`, 'list', { lines: [line.slice(line.indexOf(' ') + 1), '2 eggs'] }), { refused: 'part', component: 'list' }, `${line}: its number is its own`);
  }
  assert.deepEqual(verdict('Steps:\n1. Stop the writer.\n2. Copy the file.', 'steps', { lines: ['Stop the writer.', 'Copy the file.'] }), { draw: { component: 'steps', props: { steps: ['Stop the writer.', 'Copy the file.'], above: ['Steps:'] } } }, 'a step number with a space after its stop');
  assert.deepEqual(verdict('步骤：\n1、关掉电源\n2、拆下灯罩', 'steps', { lines: ['关掉电源', '拆下灯罩'] }), { draw: { component: 'steps', props: { steps: ['关掉电源', '拆下灯罩'], above: ['步骤：'] } } }, 'a number before 、');
});

/** Holds the question of how siblings group until the test lets go, so the test can act while the model is still being asked. */
function slowComposites(k: Kit, reply: () => CompositesReply): { asked: Promise<void>; open: () => void } {
  let open!: () => void;
  let wasAsked!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const asked = new Promise<void>((r) => (wasAsked = r));
  const json = k.model.json.bind(k.model);
  k.model.json = (async (req: Parameters<typeof json>[0]) => {
    if (req.role !== 'renderer.composites') return json(req);
    wasAsked();
    await gate;
    return req.schema.parse(reply());
  }) as typeof k.model.json;
  return { asked, open };
}

test('a card takes its look before the model has said how its siblings group', async () => {
  const k = kit();
  const { ids } = grow(k, [
    { title: 'Recipe', data: { steps: ['Boil water', 'Add pasta'] }, status: 'pick' },
    { title: 'One', text: PLAIN, status: 'pick' },
    { title: 'Two', text: PLAIN, status: 'pick' },
    { title: 'Three', text: PLAIN, status: 'pick' },
  ]);
  const composites = slowComposites(k, () => ({ groups: [] }));
  const early: Command[][] = [];

  const run = renderer(k.ctx, { nodeIds: ids, deliver: (commands) => early.push(commands) });
  await composites.asked;
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(early.flat().map((c) => (c.type === 'setView' ? [c.id, c.view.component] : [c.type])), [[ids[0], 'steps']]);
  composites.open();
  assert.deepEqual(await run, []);
});

test('a group the model proposed for a card that gave way while it was asked is not applied', async () => {
  const k = kit();
  const { root, ids } = grow(k, ['One', 'Two', 'Three', 'Four'].map((title) => ({ title, text: PLAIN, status: 'pick' as const })));
  const composites = slowComposites(k, () => ({ groups: [proposal({ parent: root, composite: 'cluster', theme: 'Moves', members: ids.slice(0, 3) })] }));

  const run = renderer(k.ctx, { nodeIds: ids });
  await composites.asked;
  k.mind.apply({ origin: { by: 'agent', role: 'scout' }, label: 'make room', commands: [{ type: 'deleteNode', id: ids[0]! }] });
  composites.open();
  const commands = await run;

  assert.ok(!commands.some((c) => c.type === 'setGroup'), 'the group named a card that is gone');
  if (commands.length > 0) k.mind.apply({ origin: { by: 'agent', role: 'renderer' }, label: 'render', commands });
});

test('a timeline the model proposed is still drawn from the siblings that stayed when one gave way while it was asked', async () => {
  const k = kit();
  const dated = (title: string, when: string) => ({ title, text: `${title}, ${when}.`, summary: `Made in ${when}`, status: 'pick' as const, why: 'a step in the timeline' });
  const { root, ids } = grow(k, [dated('Sketchpad', '1963'), dated('Mother of All Demos', '1968'), dated('Alto', '1973'), dated('Macintosh', '1984'), dated('Web', '1991')]);
  const composites = slowComposites(k, () => ({ groups: [proposal({ parent: root, composite: 'timeline', members: ids, labels: ['1963', '1968', '1973', '1984', '1991'] })] }));

  const run = renderer(k.ctx, { nodeIds: ids });
  await composites.asked;
  k.mind.apply({ origin: { by: 'agent', role: 'scout' }, label: 'make room', commands: [{ type: 'deleteNode', id: ids[0]! }] });
  composites.open();
  const commands = await run;

  const timeline = commands.find((c) => c.type === 'setGroup');
  assert.ok(timeline && timeline.type === 'setGroup', 'the timeline is kept');
  assert.deepEqual(timeline.group.members, ids.slice(1));
  k.mind.apply({ origin: { by: 'agent', role: 'renderer' }, label: 'render', commands });
});
