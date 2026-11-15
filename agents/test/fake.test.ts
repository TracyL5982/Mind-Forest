import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Id } from '../src/core/domain.ts';
import { intake } from '../src/core/roles/intake.ts';
import { makeNode } from '../src/core/roles/types.ts';
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
    const commands = await fakeRoles.scout(k.ctx, { anchor: root, need });
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

  const plain: [string, string][] = [
    ['Eiffel Tower\nHeight: 330 m\nBuilt: 1889\nFloors: 3', 'facts'],
    ['Question: Why is the sky blue?\nAnswer: Air scatters short wavelengths the most.', 'qa'],
    ['问：为什么天空是蓝色的？\n答：因为空气分子对蓝光散射得最强。', 'qa'],
    ['Bokeh: the quality of the blur in the parts of a picture that are out of focus', 'definition'],
    ['Rent 45%, food 25%, transport 10% and savings 20%.', 'breakdown'],
    ['City,Rent,Commute\nLisbon,900,25 min\nPorto,700,20 min', 'table'],
    ['City\tRent\nLisbon\t900\nPorto\t700', 'table'],
    ['> Every stair keeps the weight\n> of who climbed it.\nAt: p. 41', 'excerpt'],
    ['Our budget this year: rent 45%, food 25%, transport 10%, savings 20%', 'breakdown'],
  ];
  for (const [text, type] of plain) assert.equal(await paste(text), type, `the plain form ${JSON.stringify(text)}`);
  const ordinary = [
    'Use a | b to pipe output\nthen c | d again',
    'x = y + 2\nSolve for y when x = 10',
    '> 5 means the test passed',
    'Rent went up 45%, which hurt, and food by 25%.',
    'We met on Tuesday, talked for an hour, and left.\nThen it rained, we ran, and the bus came.\nNobody minded, really, at all.',
    'Remember: the keys are under the blue pot by the door',
    'Tom: 5 pm works for me\nAna: 6 is better',
    'Chapter 3: 40 pages of nothing happening, then everything at once.',
    'Weather: 18 degrees and raining again',
    'Score: 3 - 1 to us, finally.\nNext match: 12 May',
    'Tel: 555-0100 #204',
    'Note to self: call the plumber on Monday',
    'Mum said: bring 2 chairs and the big table',
    'Ingredients: flour, butter, sugar, two eggs and a pinch of salt',
    'Budget: rent is 50%, food 30%',
    'Today: finished the report and sent it to the whole team',
    'Dinner, drinks, dancing\nthen home, bed, sleep\nwhat a night, truly, wow',
    'If x > 5 then the loop exits early.\n> not sure this is right though',
  ];
  for (const text of ordinary) assert.ok(['note', 'idea'].includes((await paste(text))!), `ordinary text stays a note: ${JSON.stringify(text)} is drawn as ${await paste(text)}`);
});
