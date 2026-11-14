import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Id } from '../src/core/domain.ts';
import { intake } from '../src/core/roles/intake.ts';
import { ComponentsReply, renderer } from '../src/core/roles/renderer.ts';
import { makeNode } from '../src/core/roles/types.ts';
import { choose } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { kit } from './kit.ts';

/** What the real Intake keeps of a pasted text when the fake clerk describes it. */
async function pasted(text: string) {
  const k = kit();
  k.model.describing();
  const [item] = await intake(k.ctx, [{ kind: 'text', text }]);
  return item!.data;
}

test('the fake clerk reads each kind of structure from its plain written form, and the real Intake keeps it', async () => {
  assert.deepEqual(await pasted('Moving to Rust\nWhere: Lisbon\nPeople: Ana Lima, Ben Okri\nPros:\n- no data races\n- one binary\nCons: slow builds, a steep start.'), {
    where: 'Lisbon',
    people: ['Ana Lima', 'Ben Okri'],
    pros: ['no data races', 'one binary'],
    cons: ['slow builds', 'a steep start'],
  });
  assert.deepEqual(await pasted('| Plan | Price |\n| --- | --- |\n| Solo | $8 |\n| Team | $20 |'), {
    table: { heads: ['Plan', 'Price'], rows: [['Solo', '$8'], ['Team', '$20']] },
  });
  assert.deepEqual(await pasted('Q: Why is the sky blue?\nA: Air scatters short wavelengths the most.\nTerm: Parallax\nDefinition: the apparent shift of an object when the viewer moves'), {
    question: 'Why is the sky blue?',
    answer: 'Air scatters short wavelengths the most.',
    term: 'Parallax',
    definition: 'the apparent shift of an object when the viewer moves',
  });
  assert.deepEqual(await pasted('Packing\n[x] passport\n[ ] charger'), { items: ['passport', 'charger'], checklist: [true, false] });
  assert.deepEqual(await pasted('Bring\n- tent\n- stove'), { items: ['tent', 'stove'] });
  assert.deepEqual(await pasted('Palette: Ember #E4572E, #17BEBB and #fff.'), {
    colours: [{ name: 'Ember', value: '#E4572E' }, { name: '#17BEBB', value: '#17BEBB' }, { name: '#fff', value: '#fff' }],
  });
  assert.deepEqual(await pasted('The house remembers.\n> Every stair keeps the weight of who climbed it.\nAt: Chapter 3'), {
    excerpt: { text: 'Every stair keeps the weight of who climbed it.', at: 'Chapter 3' },
  });
});

test('a plain sentence gets no structure from the fake clerk, and a place it invents is dropped', async () => {
  assert.deepEqual(await pasted('The dolly zoom makes dread out of geometry'), {});
  assert.deepEqual(await pasted('A walk by the river. fake:invent'), {});
});

test('the fake clerk answers for a link and a photo with a full reply', async () => {
  const k = kit();
  k.model.describing();
  const url = 'https://example.com/trip';
  k.world.pages.set(url, { url, title: 'Trip notes', text: 'Three days away.\nWhere: Porto', site: 'example.com' });
  const { id } = await k.assets.put(new Uint8Array([1]), 'image/jpeg', 'beach.jpg');

  const [link, photo] = await intake(k.ctx, [{ kind: 'link', url }, { kind: 'asset', asset: id, mime: 'image/jpeg', name: 'beach.jpg' }]);

  assert.deepEqual(link!.data, { where: 'Porto', site: 'example.com' });
  assert.equal(photo!.title, 'beach.jpg');
  assert.equal(k.notes.length, 0, 'no reply was refused by its schema');
});

test('the fake clerk reads facts and a series, and the fake Renderer draws every structured type from a pasted text or a request', async () => {
  assert.deepEqual(await pasted('Eiffel Tower\nHeight = 330 m\nBuilt = 1889'), { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }] });
  assert.deepEqual(await pasted('Budget\nChart: Rent 50%, Food 30%, Other 20%'), { chart: { labels: ['Rent', 'Food', 'Other'], values: [50, 30, 20], unit: '%' } });
  assert.deepEqual(await pasted('Films\nChart: 1960s 3, 1980s 9'), { chart: { labels: ['1960s', '1980s'], values: [3, 9] } });

  const k = kit({ picksPerRun: 1 });
  const { treeId, nodeIds } = k.seedTree('Tree', ['Root']);
  const root = nodeIds[0]!;
  const drawn = async (ids: Id[]) => {
    k.mind.apply({ origin: { by: 'agent', role: 'renderer' }, label: 'render', commands: await fakeRoles.renderer(k.ctx, { nodeIds: ids }) });
    return ids.map((id) => k.mind.node(id).view.component);
  };
  const paste = async (text: string) => {
    const [item] = await fakeRoles.intake(k.ctx, [{ kind: 'text', text }]);
    const node = makeNode(k.ctx, item!, { treeId, parent: root, status: 'kept', why: '', origin: item!.origin });
    k.mind.apply({ origin: item!.origin, label: 'paste', commands: [{ type: 'addItem', item: item! }, { type: 'addNode', node }] });
    return (await drawn([node.id]))[0];
  };
  const ask = async (need: string) => {
    const commands = await fakeRoles.scout(k.ctx, { anchor: root, need, mode: 'more' });
    k.mind.apply({ origin: { by: 'agent', role: 'scout' }, label: 'scout', commands });
    return (await drawn(commands.flatMap((c) => (c.type === 'addNode' ? [c.node.id] : []))))[0];
  };

  const made = {
    facts: await paste('Eiffel Tower\nHeight = 330 m\nBuilt = 1889\nFloors = 3'),
    table: await paste('Plan | Price\nSolo | $8\nTeam | $20'),
    list: await paste('Packing\n[x] passport\n[ ] charger'),
    breakdown: await paste('Budget\nChart: Rent 50%, Food 30%, Other 20%'),
    qa: await paste('Q: Why is the sky blue?\nA: Air scatters short wavelengths the most.'),
    callout: await paste('Sourdough\nCaution: water above 40 °C kills the yeast.'),
    excerpt: await paste('The house remembers.\n> Every stair keeps the weight of who climbed it.\nAt: Chapter 3'),
    definition: await paste('Term: Parallax\nDefinition: the apparent shift of an object when the viewer moves'),
    idea: await paste('Build a treehouse'),
    proscons: await paste('Moving to Rust\nPros: no data races, one binary\nCons: slow builds'),
    swatch: await paste('Palette: Ember #E4572E, Lagoon #17BEBB'),
    artwork: await ask('find a museum painting of stairs'),
    reference: await ask('find a paper on the dolly zoom'),
    place: await paste('Lisbon\nWhere: Lisbon'),
  };
  assert.deepEqual(made, Object.fromEntries(Object.keys(made).map((id) => [id, id])));
  assert.equal(await paste('function add(a, b) {\n  return a + b;\n}'), 'code', 'pasted code is drawn as code');
});

const PORTO =
  'Weekend in Porto\n' +
  'We took the early train on Friday and walked the river both days, and when it rained on Saturday we sat in the bookshop until it closed and nobody minded. Next time we go in May, before the crowds, and stay an extra night.\n' +
  'Cost: €240\nNights: 2\nBest: the bridge at dusk; the tiled station; grilled sardines';
const PORTO_SHEET = {
  sections: [
    { kind: 'heading', text: 'Weekend in Porto' },
    { kind: 'text', text: 'We took the early train on Friday and walked the river both days, and when it rained on Saturday we sat in the bookshop until it closed and nobody minded. Next time we go in May, before the crowds, and stay an extra night.' },
    { kind: 'figures', facts: [{ label: 'Cost', value: '€240' }, { label: 'Nights', value: '2' }] },
    { kind: 'list', items: ['the bridge at dusk', 'the tiled station', 'grilled sardines'] },
  ],
};

test('the fake chooses a callout, a sheet or a note for a text the rules left as a note, and its choice passes the real checks', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Tree', ['Root']);
  const paste = async (text: string) => {
    const [item] = await fakeRoles.intake(k.ctx, [{ kind: 'text', text }]);
    const node = makeNode(k.ctx, item!, { treeId, parent: nodeIds[0]!, status: 'kept', why: '', origin: item!.origin });
    k.mind.apply({ origin: item!.origin, label: 'paste', commands: [{ type: 'addItem', item: item! }, { type: 'addNode', node }] });
    k.mind.apply({ origin: { by: 'agent', role: 'renderer' }, label: 'render', commands: await fakeRoles.renderer(k.ctx, { nodeIds: [node.id] }) });
    return k.mind.node(node.id).view;
  };

  assert.deepEqual(await paste(PORTO), { component: 'sheet', props: PORTO_SHEET, by: 'renderer' });
  assert.deepEqual(await paste('Sourdough\nNote: the starter doubles in about six hours.'), { component: 'callout', props: { text: 'the starter doubles in about six hours.', tone: 'note' }, by: 'renderer' });
  assert.equal((await paste('The tower, 2019\nBest: the view at night; the lift; the gardens below it')).component, 'note', 'a list with no sentence beside it is no sheet');
  assert.deepEqual(k.notes, []);

  assert.equal((await paste('Survey of 40 viewers\nWhat they noticed in the scene, in their own words. fake:invent')).component, 'note');
  assert.deepEqual(k.notes, ['renderer: Kept "Survey of 40 viewers" as a note: the model\'s fact shows value, which the content does not state.']);
});

test('the fake model answers the real Renderer about cards, one valid entry for each item it is asked about', async () => {
  const k = kit();
  k.model.choosing();
  const long = 'A plain paragraph about how the camera moves through the house, long enough to be worth a second look. '.repeat(14);
  const { nodeIds } = k.seedTree('Tree', ['Root', 'Porto', 'Kitchen', 'Essay'], { Porto: PORTO, Kitchen: 'Frying\nWarning: hot oil spits when water touches it.', Essay: long });
  const commands = await renderer(k.ctx, { nodeIds });
  k.mind.apply({ origin: { by: 'agent', role: 'renderer' }, label: 'render', commands });

  assert.deepEqual(nodeIds.slice(1).map((id) => k.mind.node(id).view.component), ['sheet', 'callout', 'note']);
  assert.deepEqual(k.mind.node(nodeIds[1]!).view.props, PORTO_SHEET);
  assert.deepEqual(k.notes, []);
  assert.ok(ComponentsReply.safeParse({ items: [{ id: 'a', ...choose(PORTO) }, { id: 'b', ...choose('fake:invent') }, { id: 'c', ...choose('') }] }).success);
});
