import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Item } from '../src/core/domain.ts';
import { byRule, renderer } from '../src/core/roles/renderer.ts';
import { scout } from '../src/core/roles/scout.ts';
import { AGENT, kit, type Kit } from './kit.ts';

const EMPTY = { lines: [], pros: [], cons: [], subject: '', passage: '', by: '', images: [], source: '', lookups: [] };

function written(format: string, title: string, fields: Record<string, unknown>) {
  return { angle: `angle of ${title}`, format, title, body: '', why: `toward ${title}`, tags: ['horror'], ...EMPTY, ...fields };
}

/** One Scout run on a horror card whose model writes this one direction. What lands, and the run log. */
async function landed(direction: unknown): Promise<{ k: Kit; items: Item[] }> {
  const k = kit();
  const tree = k.seedTree('Horror', ['Standoffs in horror films']);
  const anchor = tree.nodeIds[0]!;
  k.model.on('scout.ideate', () => ({ reading: 'A study of horror standoffs.', directions: [direction] }));
  k.mind.apply({ origin: AGENT('scout'), label: 'scout', commands: await scout(k.ctx, { anchor, count: 1 }) });
  return { k, items: k.mind.picks(anchor).map((n) => k.mind.itemOf(n.id)) };
}

const cardOf = (k: Kit, item: Item) => byRule(item, (id) => k.assets.url(id));

const SHAPES: { direction: ReturnType<typeof written>; card: string; props: Record<string, unknown> }[] = [
  {
    direction: written('steps', 'Stage a blood test scene', { body: 'A standoff you can shoot in a kitchen.', lines: ['Tie everyone to chairs', 'Heat a wire', 'Touch each sample in turn'] }),
    card: 'steps',
    props: { steps: ['Tie everyone to chairs', 'Heat a wire', 'Touch each sample in turn'], above: ['A standoff you can shoot in a kitchen.'] },
  },
  {
    direction: written('list', 'Standoffs in a locked room', { body: 'Each traps its people with the threat.', lines: ['The Thing: the blood test', 'Alien: the airlock', 'Get Out: the teacup'] }),
    card: 'list',
    props: { items: ['The Thing: the blood test', 'Alien: the airlock', 'Get Out: the teacup'], above: ['Each traps its people with the threat.'] },
  },
  {
    direction: written('facts', 'The Thing in numbers', { body: 'How the 1982 film was made.', lines: ['Released | 1982', 'Budget | $15 million', 'Director | John Carpenter'] }),
    card: 'facts',
    props: { facts: [{ label: 'Released', value: '1982' }, { label: 'Budget', value: '$15 million' }, { label: 'Director', value: 'John Carpenter' }], above: ['How the 1982 film was made.'] },
  },
  {
    direction: written('quote', 'Lovecraft on fear', { passage: '"The oldest and strongest emotion of mankind is fear."', by: 'H. P. Lovecraft' }),
    card: 'quote',
    props: { text: 'The oldest and strongest emotion of mankind is fear.', by: 'H. P. Lovecraft' },
  },
  {
    direction: written('table', 'Three standoffs compared', {
      body: 'What each standoff turns on.',
      lines: ['Film | Threat | Way out', 'The Thing | A copy among them | A hot wire', 'Alien | The creature aboard | The airlock'],
    }),
    card: 'table',
    props: { heads: ['Film', 'Threat', 'Way out'], rows: [['The Thing', 'A copy among them', 'A hot wire'], ['Alien', 'The creature aboard', 'The airlock']], above: ['What each standoff turns on.'] },
  },
  {
    direction: written('qa', 'Why the blood test works', { subject: 'Why does the blood test work?', passage: 'Every piece of the Thing defends itself, so a hot wire makes the copy jump.' }),
    card: 'qa',
    props: { question: 'Why does the blood test work?', answer: 'Every piece of the Thing defends itself, so a hot wire makes the copy jump.' },
  },
  {
    direction: written('definition', 'What a Mexican standoff is', { subject: 'Mexican standoff', passage: 'a stand where no side can strike first without being struck.' }),
    card: 'definition',
    props: { term: 'Mexican standoff', definition: 'a stand where no side can strike first without being struck.' },
  },
  {
    direction: written('proscons', 'Show the monster or not', { body: 'Whether the standoff shows its monster.', pros: ['The threat is concrete', 'The payoff is earned'], cons: ['The mystery is gone', 'The effects can date'] }),
    card: 'proscons',
    props: { pros: ['The threat is concrete', 'The payoff is earned'], cons: ['The mystery is gone', 'The effects can date'], heads: ['For', 'Against'], above: ['Whether the standoff shows its monster.'] },
  },
  {
    direction: written('callout', 'Never test with a match', { body: 'The blood test as staged in 1982.', passage: 'A naked flame near a petrol can on set burns the crew, not the Thing.' }),
    card: 'callout',
    props: { text: 'A naked flame near a petrol can on set burns the crew, not the Thing.', tone: 'caution', above: ['The blood test as staged in 1982.'] },
  },
];

for (const { direction, card, props } of SHAPES) {
  test(`${card} "${direction.title}" the Scout writes lands as its card, which shows every field it wrote`, async () => {
    const { k, items } = await landed(direction);

    assert.equal(items.length, 1);
    const drawn = cardOf(k, items[0]!);
    assert.equal(drawn.component, card);
    assert.deepEqual(drawn.props, props);
    assert.equal(items[0]!.title, direction.title);
    assert.deepEqual(k.notes.filter((n) => / lands as .*, not /.test(n)), []);
  });

  test(`${card} "${direction.title}" lands in its final look, which a Renderer pass leaves as it is`, async () => {
    const { k, items } = await landed(direction);
    const node = [...k.mind.nodes.values()].find((n) => n.itemId === items[0]!.id)!;

    assert.equal(node.view.component, card);
    assert.equal(node.view.composing, undefined);
    const pass = await renderer(k.ctx, { nodeIds: [node.id] });
    assert.deepEqual(pass.filter((c) => c.type === 'setView'), []);
  });
}

test('a note stays prose', async () => {
  const body = 'A standoff is a promise of violence that the film keeps postponing. The longer it holds, the more each glance counts.';
  const { k, items } = await landed(written('note', 'The postponed promise', { body }));

  assert.equal(items[0]!.text, body);
  assert.equal(cardOf(k, items[0]!).component, 'note');
});

const SHORT: { direction: ReturnType<typeof written>; says: RegExp; words: string[] }[] = [
  { direction: written('list', 'Two rooms', { body: 'Rooms that trap.', lines: ['The lab', 'The kennel'] }), says: /not a list: it has only 2 of the 3 entries it needs/, words: ['Rooms that trap.', 'The lab', 'The kennel'] },
  { direction: written('steps', 'One step', { lines: ['Heat a wire', 'Touch the sample'] }), says: /not steps: it has only 2 of the 3 steps it needs/, words: ['Heat a wire', 'Touch the sample'] },
  { direction: written('facts', 'One figure', { lines: ['Released | 1982'] }), says: /not facts: it has only 1 of the 2 figures it needs/, words: ['Released: 1982'] },
  { direction: written('facts', 'A figure with no value', { lines: ['Released | 1982', 'Budget'] }), says: /not facts: it has a figure without its label or value/, words: ['Released: 1982', 'Budget'] },
  { direction: written('quote', 'Nobody said it', { passage: 'Fear is the oldest emotion.' }), says: /not a quote: it has nobody named as saying it/, words: ['Fear is the oldest emotion.'] },
  { direction: written('table', 'A ragged table', { lines: ['Film | Threat', 'The Thing | A copy | A wire', 'Alien | The creature'] }), says: /not a table: it has a row whose cells do not match the heads/, words: ['The Thing', 'Alien'] },
  { direction: written('table', 'One row', { lines: ['Film | Threat', 'The Thing | A copy'] }), says: /not a table: it has only 1 of the 2 rows it needs/, words: ['The Thing'] },
  { direction: written('qa', 'No answer', { subject: 'Why does the test work?' }), says: /not a question and answer: it has no answer/, words: ['Why does the test work?'] },
  { direction: written('definition', 'No meaning', { subject: 'Mexican standoff' }), says: /not a definition: it has no meaning/, words: ['Mexican standoff'] },
  { direction: written('callout', 'No warning', { body: 'Something to watch for.' }), says: /not a callout: it has no warning/, words: ['Something to watch for.'] },
  { direction: written('proscons', 'One side', { pros: ['Concrete', 'Earned'], cons: ['Dated'] }), says: /not pros and cons: it has only 1 of the 2 points against it needs/, words: ['Concrete', 'Earned', 'Dated'] },
];

for (const { direction, says, words } of SHORT) {
  test(`${direction.format} "${direction.title}" that lacks part of its form lands in its own words, and the log says what it lands as and why`, async () => {
    const { k, items } = await landed(direction);

    assert.equal(items.length, 1);
    assert.notEqual(cardOf(k, items[0]!).component, direction.format);
    for (const word of words) assert.ok(items[0]!.text.includes(word), `the text keeps "${word}"`);
    assert.deepEqual(Object.keys(items[0]!.data).filter((key) => key !== 'shortTitle'), [], 'no half-filled structure is kept');
    const drawnAs = cardOf(k, items[0]!).component;
    assert.ok(k.notes.some((n) => n.includes(`"${direction.title}" lands as ${drawnAs === 'note' ? 'a note' : `a ${drawnAs}`}, not`) && says.test(n)), k.notes.join('\n'));
  });
}

test('a shape that fills its form but fails its card\'s check lands in its own words, and the log says what it lands as', async () => {
  const long = 'the year the film opened to poor reviews and a box office that barely covered its budget';
  const { k, items } = await landed(written('facts', 'A figure too long', { lines: ['Released | 1982', `Reception | ${long}`] }));

  assert.equal(cardOf(k, items[0]!).component, 'note');
  assert.ok(items[0]!.text.includes(long));
  assert.deepEqual(Object.keys(items[0]!.data).filter((key) => key !== 'shortTitle'), []);
  assert.ok(k.notes.some((n) => /"A figure too long" lands as a note, not facts: its card's check refused it/.test(n)), k.notes.join('\n'));
});

test('a written idea with no words at all lands nothing', async () => {
  const { k, items } = await landed(written('list', 'Nothing here', {}));

  assert.deepEqual(items, []);
  assert.ok(k.notes.some((n) => n.includes('"Nothing here" came with no words')));
});

test('a bullet or a number the model puts in front of an entry is the card\'s to draw, and a figure may come as "label: value"', async () => {
  const listed = await landed(written('list', 'Rooms that trap', { lines: ['- The lab', '• The kennel', '* The storeroom'] }));
  const stepped = await landed(written('steps', 'Stage it', { lines: ['1. Tie everyone to chairs', '2) Heat a wire', '3. Touch each sample'] }));
  const figured = await landed(written('facts', 'The Thing in numbers', { lines: ['Released: 1982', 'Director: John Carpenter'] }));

  assert.deepEqual(cardOf(listed.k, listed.items[0]!).props, { items: ['The lab', 'The kennel', 'The storeroom'] });
  assert.deepEqual(cardOf(stepped.k, stepped.items[0]!).props, { steps: ['Tie everyone to chairs', 'Heat a wire', 'Touch each sample'] });
  assert.deepEqual(cardOf(figured.k, figured.items[0]!).props, { facts: [{ label: 'Released', value: '1982' }, { label: 'Director', value: 'John Carpenter' }] });
});


test('a definition whose meaning opens with its term is written as the meaning alone, so the card names the term once', async () => {
  const passage = 'Parallax is the shift of a near thing against a far one as you move.';
  const { k, items } = await landed(written('definition', 'Parallax', { subject: 'Parallax', passage }));
  const article = await landed(written('definition', 'Dolly zoom', { subject: 'Dolly zoom', passage: 'A dolly zoom is a shot that tracks back while zooming in.' }));

  assert.equal(items[0]!.text, passage);
  assert.deepEqual(cardOf(k, items[0]!), { component: 'definition', props: { term: 'Parallax', definition: passage } });
  assert.equal(article.items[0]!.text, 'A dolly zoom is a shot that tracks back while zooming in.');
  assert.equal(cardOf(article.k, article.items[0]!).component, 'definition');
});

test('figures and cells written with full-width marks, as Chinese writes them, are read as the card\'s own', async () => {
  const figured = await landed(written('facts', '怪形', { lines: ['上映：1982', '导演：约翰·卡朋特'] }));
  const tabled = await landed(written('table', '三场对峙', { lines: ['电影｜威胁', '怪形｜伪装者', '异形｜怪物'] }));

  assert.deepEqual(cardOf(figured.k, figured.items[0]!).props, { facts: [{ label: '上映', value: '1982' }, { label: '导演', value: '约翰·卡朋特' }] });
  assert.deepEqual(cardOf(tabled.k, tabled.items[0]!).props, { heads: ['电影', '威胁'], rows: [['怪形', '伪装者'], ['异形', '怪物']] });
});

test('pros and cons are headed in the language the idea is written in', async () => {
  const chinese = await landed(written('proscons', '露不露怪物', { pros: ['威胁具体', '高潮有力'], cons: ['神秘感消失', '特效会过时'] }));
  const english = await landed(written('proscons', 'Show the monster', { pros: ['Concrete', 'Earned'], cons: ['Dated', 'Less dread'] }));

  assert.deepEqual(cardOf(chinese.k, chinese.items[0]!).props.heads, ['优点', '缺点']);
  assert.deepEqual(cardOf(english.k, english.items[0]!).props.heads, ['For', 'Against']);
});
