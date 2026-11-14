import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const load = (path: string) => import(new URL(`../client/js/${path}`, import.meta.url).href);

test('every card type in the client registry can be sized, drawn and opened', async () => {
  const { COMPONENTS } = await load('components/index.js');
  assert.deepEqual(Object.keys(COMPONENTS), ['note', 'quote', 'fact', 'image', 'video', 'audio', 'link', 'chart', 'person', 'chat', 'code', 'steps', 'facts', 'table', 'list', 'breakdown', 'qa', 'callout', 'excerpt', 'definition', 'idea', 'proscons', 'swatch', 'artwork', 'reference', 'place', 'sheet']);
  for (const [name, kind] of Object.entries<Record<string, unknown>>(COMPONENTS)) {
    for (const part of ['size', 'draw', 'detail']) assert.equal(typeof kind[part], 'function', `${name}.${part}`);
  }
});

test('a card footprint is two whole numbers that depend only on the item and props', async () => {
  const { COMPONENTS } = await load('components/index.js');
  const item = { title: 'A title', text: 'Some text', summary: 'A summary', data: {} };
  const props = { steps: ['a', 'b', 'c', 'd', 'e', 'f'], messages: [{ role: 'user', text: 'hi' }], image: 'x.png', aspect: 2, values: [1, 2], labels: ['a', 'b'] };
  for (const [name, kind] of Object.entries<{ size: (item: unknown, props: unknown) => number[] }>(COMPONENTS)) {
    for (const given of [{}, props]) {
      const size = kind.size(item, given);
      assert.equal(size.length, 2, name);
      assert.ok(size.every((side) => Number.isInteger(side) && side > 0), `${name} is ${size}`);
      assert.deepEqual(kind.size(item, given), size, `${name} gives the same footprint twice`);
    }
  }
});

test('every card type says which chip sources it already shows, and a sheet works them out from what its sections draw', async () => {
  const { COMPONENTS } = await load('components/index.js');
  const shows = Object.fromEntries(Object.entries<{ shows: unknown }>(COMPONENTS).flatMap(([name, kind]) => (Array.isArray(kind.shows) && kind.shows.length > 0 ? [[name, kind.shows]] : [])));
  assert.deepEqual(shows, { link: ['site'], excerpt: ['site', 'from'], reference: ['venue', 'date', 'authors'], artwork: ['holder', 'date'], place: ['where'] });
  for (const [name, kind] of Object.entries<{ shows: unknown }>(COMPONENTS)) assert.ok(name === 'sheet' ? typeof kind.shows === 'function' : Array.isArray(kind.shows), `${name}.shows`);
  const data = { when: '12 May', where: 'Porto', people: ['Ines', 'Tom'], authors: ['Ines'], site: '  Porto  ', count: 3 };
  const props = { sections: [{ kind: 'figures', facts: [{ label: 'Arrived', value: '12 May' }] }, { kind: 'excerpt', text: 'Back for the sardines.', by: 'Ines' }] };
  assert.deepEqual(COMPONENTS.sheet.shows({ title: 'Porto', text: '', data }, props), ['when', 'where', 'authors', 'site'], 'a value it draws, and a list of names when it draws each one');
});

test('a card with chips is taller by one fixed line, whatever its type, its status and however many chips', async () => {
  const { COMPONENTS, sizeOf } = await load('components/index.js');
  const bare = { title: 'A title', text: 'Some text', summary: 'A summary', data: {}, origin: { by: 'agent' } };
  const one = { ...bare, data: { when: '1958' } };
  const many = { ...bare, data: { when: '1958', where: 'Bodega Bay', people: ['Ada', 'Grace', 'Edsger'], from: 'The Met', site: 'example.com' } };
  for (const component of [...Object.keys(COMPONENTS), 'hologram']) {
    const [wide, tall] = sizeOf({ status: 'kept', view: { component, props: {} } }, bare);
    for (const status of ['kept', 'pick']) {
      const node = { status, view: { component, props: {} } };
      assert.deepEqual(sizeOf(node, bare), [wide, tall], `${component} ${status} without chips`);
      assert.deepEqual(sizeOf(node, { ...bare, data: undefined }), [wide, tall], `${component} ${status} without data`);
      assert.deepEqual(sizeOf(node, one), [wide, tall + 28], `${component} ${status} with one chip`);
      assert.deepEqual(sizeOf(node, many), [wide, tall + 28], `${component} ${status} with every source`);
    }
  }
});

test('what the agents brought keeps its origin chip and its size when the pick is kept, and a link does not repeat its site', async () => {
  const { sizeOf, chipsOf } = await load('components/index.js');
  const item = { title: 'A page', text: '', summary: '', data: { site: 'example.com', from: 'The web' }, origin: { by: 'agent', role: 'scout' } };
  const as = (component: string, status: string) => ({ status, view: { component, props: { site: 'example.com' } } });
  const origin = [{ kind: 'origin', text: 'example.com', width: 108 }];
  assert.deepEqual(chipsOf(as('note', 'pick'), item), origin);
  assert.deepEqual(chipsOf(as('note', 'kept'), item), origin);
  assert.deepEqual(sizeOf(as('note', 'kept'), item), sizeOf(as('note', 'pick'), item));
  assert.equal(sizeOf(as('note', 'kept'), item)[1] - sizeOf(as('note', 'kept'), { ...item, data: {} })[1], 28);
  assert.deepEqual(chipsOf(as('note', 'pick'), { ...item, origin: { by: 'user' } }), [], 'what the user added names no origin');
  assert.deepEqual(chipsOf(as('link', 'pick'), item), []);
  assert.deepEqual(sizeOf(as('link', 'pick'), item), sizeOf(as('link', 'pick'), { ...item, data: {} }));
});

type Drawn = { kind: string; text: string; width: number; count?: number };

const drawnOn = async (component: string, data: Record<string, unknown>, origin = { by: 'user' }): Promise<Drawn[]> => {
  const { chipsOf } = await load('components/index.js');
  return chipsOf({ status: 'kept', view: { component, props: {} } }, { title: 'A title', text: '', summary: '', data, origin });
};
const texts = async (component: string, data: Record<string, unknown>) => (await drawnOn(component, data)).map((chip) => chip.text);

test('a card draws its first chip, then each next one only while each can have 72 px or its whole text', async () => {
  const short = { when: '1958', where: 'Rome', people: ['Ada'] };
  const long = { when: 'Summer 1958', where: 'Bodega Bay', people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra'] };
  assert.deepEqual(await texts('note', short), ['1958', 'Rome', 'Ada']);
  assert.deepEqual(await texts('note', long), ['Summer 1958', 'Bodega Bay']);
  assert.deepEqual(await texts('fact', long), ['Summer 1958']);
  assert.deepEqual(await texts('chart', { ...long, when: '1958' }), ['1958', 'Bodega Bay', 'Ada Lovelace, Grace Hopper']);
  assert.deepEqual(await texts('fact', { where: 'The upper reading room of the old municipal library, Vilnius' }), ['The upper reading room of the old municipal library, Vilnius']);
  assert.deepEqual(await texts('note', { when: 'Early September 1958', where: 'Bodega Bay' }), ['Early September 1958'], 'a place with less than 72 px left is left out');
});

test('a chip is given its whole text and the width of its box, and no text is cut', async () => {
  const place = 'The upper reading room of the old municipal library, Vilnius';
  assert.deepEqual(await drawnOn('note', { when: '1958', where: 'Rome' }), [{ kind: 'when', text: '1958', width: 60 }, { kind: 'where', text: 'Rome', width: 62 }]);
  assert.deepEqual(await drawnOn('note', { when: '12 May 1958', where: place }), [{ kind: 'when', text: '12 May 1958', width: 108 }, { kind: 'where', text: place, width: 94 }], 'the long place has what the date leaves');
  assert.deepEqual(await drawnOn('note', { where: place }), [{ kind: 'where', text: place, width: 208 }], 'one long chip has the line');
  assert.deepEqual(await drawnOn('image', { when: '12 May 1958', where: 'Bodega Bay' }), [{ kind: 'when', text: '12 May 1958', width: 108 }, { kind: 'where', text: 'Bodega Bay', width: 100 }], 'a photo 240 px wide has a full date and a place whole');
});

test('a date chip has the width of its whole text before the other chips share what is left', async () => {
  const widths = async (component: string, data: Record<string, unknown>) => (await drawnOn(component, data)).map((chip) => [chip.kind, chip.width]);
  assert.deepEqual(await widths('note', { when: 'Spring 1958', where: 'Sonoma county' }), [['when', 103], ['where', 99]], 'the date is whole and the place has the rest');
  assert.deepEqual(await widths('image', { when: '2024年5月12日', where: '上海市黄浦区中山东一路外滩观景平台' }), [['when', 123], ['where', 85]]);
  assert.deepEqual(await widths('note', { when: 'Some time between the spring of 1958 and the autumn of 1961', where: 'Bodega Bay' }), [['when', 208]], 'a date wider than the line has the line');
  assert.deepEqual(await widths('note', { where: 'Spring 1958', people: ['Sonoma county'] }), [['where', 101], ['people', 101]], 'only a date goes first');
});

test('what the agents brought draws its date, then its origin, before a place or people', async () => {
  const scout = { by: 'agent', role: 'scout' };
  const paper = { site: 'doi.org', by: 'T. Screech et al.', date: '2019', from: 'Research papers', venue: 'Journal of Japanese Studies', authors: ['T. Screech', 'M. Forrer', 'H. Smith'] };
  assert.deepEqual((await drawnOn('note', paper, scout)).map((chip) => [chip.kind, chip.text]), [['when', '2019'], ['origin', 'Journal of Japanese Studies']], 'a note has no room for the authors after the venue');
  assert.deepEqual((await drawnOn('chart', paper, scout)).map((chip) => [chip.kind, chip.text, chip.count]), [['when', '2019', undefined], ['origin', 'Journal of Japanese Studies', undefined], ['people', 'T. Screech, M. Forrer', 1]]);
  assert.deepEqual((await drawnOn('note', paper)).map((chip) => chip.kind), ['when', 'people'], 'the same data on what the user made has no origin');
});

test('the boxes on a line never outgrow the card, and a people chip always has room for its count', async () => {
  const { chipsOf, sizeOf, COMPONENTS } = await load('components/index.js');
  const { textWidth } = await load('components/shared.js');
  const place = 'The upper reading room of the old municipal library, Vilnius';
  const crew = ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra', 'Barbara Liskov', 'Alan Kay'];
  const cases: Record<string, unknown>[] = [
    { where: place },
    { when: '1958', where: place },
    { where: place, people: crew },
    { when: 'The long summer of 1958', where: place, people: crew },
    { date: '2019', venue: 'Journal of Japanese Studies', authors: crew, where: place },
    { where: '上海市黄浦区中山东一路外滩观景平台', people: ['李白', '杜甫'] },
    { where: '👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦' },
    { where: 'Zoë '.repeat(20) },
    { people: ['Bartholomew Montgomery-Featherstonehaugh', 'Maximiliana Wolfeschlegelsteinhausen', 'C', 'D'] },
    { people: Array.from({ length: 1002 }, (_, i) => `Person number ${i}`) },
  ];
  const sides: Record<string, number> = { quote: 40, image: 26, video: 26, callout: 44 };
  let narrow = 0;
  for (const component of Object.keys(COMPONENTS)) {
    for (const data of cases) {
      for (const by of ['user', 'agent']) {
        const node = { status: 'kept', view: { component, props: {} } };
        const item = { title: 'A title', text: '', summary: '', data, origin: { by } };
        const drawn: Drawn[] = chipsOf(node, item);
        const told = `${component} ${by} ${JSON.stringify(data).slice(0, 60)}`;
        const { shows } = COMPONENTS[component];
        const only = Object.keys(data).every((key) => (typeof shows === 'function' ? shows(item, node.view.props) : shows).includes(key));
        assert.ok(drawn.length >= (only ? 0 : 1) && drawn.length <= 3, told);
        const line = drawn.reduce((sum, chip) => sum + chip.width, 6 * (drawn.length - 1));
        assert.ok(line <= sizeOf(node, item)[0] - (sides[component] ?? 32), `${told}: the line is ${line} px`);
        for (const chip of drawn) {
          assert.ok(Number.isInteger(chip.width), `${told}: ${chip.width} is whole px`);
          const need = 28 + textWidth(chip.text) + (chip.count ? textWidth(` +${chip.count}`) : 0);
          assert.ok(chip.width <= need, `${told}: ${chip.text} is no wider than its text`);
          if (chip.width < need) narrow += 1;
          if (chip.count) assert.ok(chip.width >= 28 + textWidth(` +${chip.count}`), `${told}: +${chip.count} fits in ${chip.width} px`);
        }
      }
    }
  }
  assert.ok(narrow > 40, `${narrow} chips have less than their text needs`);
});

test('every arrangement in the client registry has a name and can arrange', async () => {
  const { COMPOSITES } = await load('composites/index.js');
  assert.deepEqual(Object.keys(COMPOSITES), ['gallery', 'timeline', 'comparison', 'sequence', 'cluster', 'stack', 'ranked', 'beforeafter', 'lead', 'overview', 'moodboard', 'matrix', 'map', 'layout']);
  for (const [name, kind] of Object.entries<Record<string, unknown>>(COMPOSITES)) {
    assert.equal(typeof kind.name, 'string', `${name}.name`);
    assert.equal(typeof kind.arrange, 'function', `${name}.arrange`);
  }
});

type Sample = { type: string; item: Record<string, unknown>; props: Record<string, unknown>; size: number[]; chips?: Drawn[] };

test('every sample in footprints.json gets the footprint and the chips written there', async () => {
  const { COMPONENTS, sizeOf, chipsOf } = await load('components/index.js');
  const { samples } = JSON.parse(readFileSync(new URL('./footprints.json', import.meta.url), 'utf8')) as { samples: Sample[] };
  assert.ok(samples.length >= 60, `${samples.length} samples`);
  assert.deepEqual([...new Set(samples.map((sample) => sample.type))].filter((type) => type in COMPONENTS).sort(), Object.keys(COMPONENTS).sort(), 'every card type has a sample');
  assert.ok(samples.filter((sample) => sample.chips?.length).length >= 20, 'samples with chips');
  for (const sample of samples) {
    const node = { view: { component: sample.type, props: sample.props } };
    const said = `${sample.type} ${JSON.stringify(sample.item.title)} ${JSON.stringify(sample.props).slice(0, 80)}`;
    assert.deepEqual(sizeOf(node, sample.item), sample.size, said);
    if (COMPONENTS[sample.type] && !sample.chips?.length) assert.deepEqual(COMPONENTS[sample.type].size(sample.item, sample.props), sample.size, `${said}: no chips, so the type's own size`);
    if (sample.chips) assert.deepEqual(chipsOf(node, sample.item), sample.chips, said);
  }
});

test('a width is counted in whole tenths of a letter, and a joined emoji counts once', async () => {
  const { span, TITLE_LETTER, QUOTE_LETTER } = await load('components/shared.js');
  assert.equal(span('il. frt 09 AZ mw% W'), 5 * 8 + 7 * 3 + 11 * 2 + 12 * 2 + 15 * 3 + 17);
  assert.equal(span('中あ한'), 18 + 18 + 15, 'at the text size');
  assert.equal(span('中あ한', TITLE_LETTER), 17 + 18 + 15, 'at the title size');
  assert.equal(span('中あ한', QUOTE_LETTER), 21 + 21 + 21, 'in a quote');
  assert.equal(span('中あ한', 210), 16 + 16 + 14, 'in a fact value');
  assert.equal(span('Quote', QUOTE_LETTER), span('Quote'), 'the letters of English count the same in every face');
  assert.equal(span('🎉'), 23);
  assert.equal(span('🎉', QUOTE_LETTER), 26);
  assert.equal(span('👨‍👩‍👧‍👦'), span('🎉'));
  assert.equal(span('🏳️‍🌈'), span('🎉'));
  assert.equal(span('©️'), span('🎉'), 'U+FE0F draws the sign before it as an emoji');
  assert.equal(span('❤️'), span('❤'), 'and adds nothing to a character already that wide');
  assert.equal(span('🧑‍⚕️'), span('🎉'), 'or to a joined emoji that ends with it');
  assert.equal(span('é'), 11);
  assert.equal(span('e\u0301'), span('e'), 'an accent that joins a letter takes no room');
  assert.equal(span('\ua984'), 47, 'a character the table does not name counts as the widest');
  const alphabet = 'ABCDEabcdmw.,ilt0123 $%中🎉';
  for (let i = 0; i < 2000; i++) {
    const made = Array.from({ length: 1 + (i % 40) }, (_, k) => [...alphabet][(i * 7 + k * 13) % 25]).join('');
    assert.ok(Number.isInteger(span(made)), made);
  }
});

test('a fact value takes the largest size its digits fit at, and is never given less room than it draws in', async () => {
  const { COMPONENTS } = await load('components/index.js');
  const size = (value: string) => COMPONENTS.fact.size({ title: '' }, { value, label: '' }) as [number, number];
  const height = (lead: number, lines = 1) => 40 + lead * lines;
  assert.deepEqual(size('1234567890123'), [313, height(36)], 'thirteen digits at 21.48 px each fit the largest size');
  assert.deepEqual(size('12345678901234'), [244, height(28)], 'fourteen step down once');
  assert.deepEqual(size('1234567890123456789'), [320, height(28)], 'nineteen at 15.06 px each still fit the middle size');
  assert.deepEqual(size('12345678901234567890'), [234, height(21)], 'twenty step down again');
  assert.deepEqual(size('1234567890123456789012345678'), [314, height(21)]);
  assert.deepEqual(size('12345678901234567890123456789'), [320, height(21, 2)], 'past one line at the smallest size it wraps');
});

test('a fact card grows a line for each line its value needs, up to eight', async () => {
  const { COMPONENTS } = await load('components/index.js');
  const height = (value: string) => (COMPONENTS.fact.size({ title: '' }, { value, label: '' }) as [number, number])[1];
  assert.equal(height('1'.repeat(46)), 40 + 21 * 2, 'forty-six digits at 11.55 px each fit two lines of 266 px');
  assert.equal(height('1'.repeat(47)), 40 + 21 * 3, 'forty-seven need three');
  assert.equal(height('忆'.repeat(35)), 40 + 21 * 3, 'thirty-five Han at seventeen a line need three');
  assert.equal(height('1'.repeat(400)), 40 + 21 * 8, 'a paragraph stops at eight');
});

test('a sign or a unit is counted at least as wide as it draws', async () => {
  const { span, QUOTE_LETTER } = await load('components/shared.js');
  /** Widths in px measured in the page: a fact value at its largest size, and a quote. */
  const value = { '℃': 38.78, '₩': 30.73, '‰': 42.16, '™': 26.86, '½': 25.84, '€': 21.48, '¥': 21.48, '°': 15.07, '²': 10.98, '≈': 21.48, '→': 31.58, '—': 28.83, 'é': 18.34, 'Ω': 25.61, '№': 36.94, '🎉': 33.33 };
  const quote = { '—': 16, '…': 16, '“': 7.47, '’': 4.45, '🎉': 20, '℃': 15.72, 'é': 6.08 };
  for (const [ch, px] of Object.entries(value)) assert.ok(span(ch, 210) * 210 >= px * 100, `${ch} in a fact value`);
  for (const [ch, px] of Object.entries(quote)) assert.ok(span(ch, QUOTE_LETTER) * QUOTE_LETTER >= px * 100, `${ch} in a quote`);
});

test('text that can break anywhere fills each line, and other text keeps room to break between words', async () => {
  const { fold, QUOTE_LETTER } = await load('components/shared.js');
  assert.equal(fold('学'.repeat(15), 247, QUOTE_LETTER, 5), 1);
  assert.equal(fold('学'.repeat(30), 247, QUOTE_LETTER, 5), 2, 'fifteen Han to a line');
  assert.equal(fold('学'.repeat(31), 247, QUOTE_LETTER, 5), 3);
  assert.equal(fold('学かナ한'.repeat(40), 247, QUOTE_LETTER, 5), 5, 'never more than the cap');
  assert.equal(fold(`${'学'.repeat(14)}，${'学'.repeat(15)}`, 247, QUOTE_LETTER, 5), 3, 'a comma may not start a line, so it is counted as words are');
  assert.equal(fold('word '.repeat(12), 247, QUOTE_LETTER, 5), 2);
});

test('a string cut to a width keeps whole characters and fits the width', async () => {
  const { cut, span, initials, TEXT_LETTER } = await load('components/shared.js');
  const whole = new Set(['🎉', '👨‍👩‍👧‍👦', '🏳️‍🌈', '🇯🇵', 'é', '记', 'a']);
  for (const str of ['🎉👨‍👩‍👧‍👦🏳️‍🌈🇯🇵🎉👨‍👩‍👧‍👦', 'éééééééé', '记记记记记记记记记记', 'aaaaaaaaaaaaaaaaaaaaaa']) {
    for (let room = 10; room < 120; room += 7) {
      const shown = cut(str, room, TEXT_LETTER);
      if (shown === str) continue;
      assert.ok(shown.endsWith('…'), shown);
      const kept = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(shown.slice(0, -1))].map((part) => part.segment);
      assert.ok(kept.length >= 1 && kept.every((part) => whole.has(part)), `${JSON.stringify(shown)} at ${room}`);
      if (kept.length > 1) assert.ok(span(shown) * TEXT_LETTER <= room * 100, `${JSON.stringify(shown)} is wider than ${room}`);
    }
  }
  assert.equal(initials('👩‍🔬 lin'), '👩‍🔬L');
  assert.equal(initials(''), '?');
});
