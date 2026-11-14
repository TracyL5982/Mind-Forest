import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const load = (path: string) => import(new URL(`../client/js/${path}`, import.meta.url).href);

test('every card type in the client registry can be sized, drawn and opened', async () => {
  const { COMPONENTS } = await load('components/index.js');
  assert.deepEqual(Object.keys(COMPONENTS), ['note', 'quote', 'fact', 'image', 'video', 'link', 'chart', 'person', 'chat', 'code', 'steps']);
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

test('every card type says which chip sources it already shows, and only a link shows one', async () => {
  const { COMPONENTS } = await load('components/index.js');
  const shows = Object.fromEntries(Object.entries<{ shows: string[] }>(COMPONENTS).map(([name, kind]) => [name, kind.shows]));
  assert.deepEqual(shows, { note: [], quote: [], fact: [], image: [], video: [], link: ['site'], chart: [], person: [], chat: [], code: [], steps: [] });
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
  const item = { title: 'A page', text: '', summary: '', data: { site: 'example.com' }, origin: { by: 'agent', role: 'scout' } };
  const as = (component: string, status: string) => ({ status, view: { component, props: { site: 'example.com' } } });
  const origin = [{ kind: 'origin', text: 'example.com', full: 'example.com' }];
  assert.deepEqual(chipsOf(as('note', 'pick'), item), origin);
  assert.deepEqual(chipsOf(as('note', 'kept'), item), origin);
  assert.deepEqual(sizeOf(as('note', 'kept'), item), sizeOf(as('note', 'pick'), item));
  assert.equal(sizeOf(as('note', 'kept'), item)[1] - sizeOf(as('note', 'kept'), { ...item, data: {} })[1], 28);
  assert.deepEqual(chipsOf(as('note', 'pick'), { ...item, origin: { by: 'user' } }), [], 'what the user added names no origin');
  assert.deepEqual(chipsOf(as('link', 'pick'), item), []);
  assert.deepEqual(sizeOf(as('link', 'pick'), item), sizeOf(as('link', 'pick'), { ...item, data: {} }));
});

type Drawn = { kind: string; text: string; full: string; keep?: string };

test('a card draws its first chip, then each next one only while each can have 84 px or its whole text', async () => {
  const { chipsOf } = await load('components/index.js');
  const full = (component: string, data: Record<string, unknown>) =>
    chipsOf({ status: 'kept', view: { component, props: {} } }, { title: 'A title', text: '', summary: '', data }).map((chip: Drawn) => chip.full);
  const short = { when: '1958', where: 'Rome', people: ['Ada'] };
  const long = { when: 'Summer 1958', where: 'Bodega Bay', people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra'] };
  assert.deepEqual(full('note', short), ['1958', 'Rome', 'Ada']);
  assert.deepEqual(full('note', long), ['Summer 1958', 'Bodega Bay']);
  assert.deepEqual(full('fact', long), ['Summer 1958']);
  assert.deepEqual(full('chart', { ...long, when: '1958' }), ['1958', 'Bodega Bay', 'Ada Lovelace, Grace Hopper +1']);
  assert.deepEqual(full('fact', { where: 'The upper reading room of the old municipal library, Vilnius' }), ['The upper reading room of the old municipal library, Vilnius']);
});

test('a photo 240 px wide shows a full date and a place whole', async () => {
  const { chipsOf } = await load('components/index.js');
  const drawn = chipsOf({ status: 'kept', view: { component: 'image', props: {} } }, { title: 'Harbour', data: { when: '12 May 1958', where: 'Bodega Bay' } });
  assert.deepEqual(drawn.map((chip: Drawn) => chip.text), ['12 May 1958', 'Bodega Bay']);
});

test('a chip too long for its share is cut at a whole character, and the line never outgrows the card', async () => {
  const { chipsOf, sizeOf, COMPONENTS } = await load('components/index.js');
  const { graphemes, textWidth } = await load('components/shared.js');
  const place = 'The upper reading room of the old municipal library, Vilnius';
  const crew = ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra', 'Barbara Liskov', 'Alan Kay'];
  const cases: Record<string, unknown>[] = [
    { where: place },
    { when: '1958', where: place },
    { where: place, people: crew },
    { when: 'The long summer of 1958', where: place, people: crew },
    { where: '上海市黄浦区中山东一路外滩观景平台', people: ['李白', '杜甫'] },
    { where: '👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦' },
    { where: 'Zoe\u0308 '.repeat(20) },
    { people: ['Bartholomew Montgomery-Featherstonehaugh', 'Maximiliana Wolfeschlegelsteinhausen', 'C', 'D'] },
  ];
  let cuts = 0;
  for (const component of Object.keys(COMPONENTS)) {
    for (const data of cases) {
      const node = { status: 'kept', view: { component, props: {} } };
      const item = { title: 'A title', text: '', summary: '', data };
      const drawn: Drawn[] = chipsOf(node, item);
      const said = `${component} ${JSON.stringify(data).slice(0, 60)}`;
      assert.ok(drawn.length >= 1, said);
      const line = drawn.reduce((sum, chip) => sum + 28 + textWidth(chip.text), 6 * (drawn.length - 1));
      assert.ok(line <= sizeOf(node, item)[0] - 26, `${said}: the line is ${line} px`);
      for (const chip of drawn) {
        const keep = chip.keep ?? '';
        assert.ok(chip.text.endsWith(keep), `${said}: ${chip.text} keeps its count`);
        if (chip.text === chip.full) continue;
        cuts += 1;
        const start = chip.text.slice(0, chip.text.length - keep.length);
        assert.ok(start.endsWith('…'), `${said}: ${chip.text} ends its words with an ellipsis`);
        const kept = start.slice(0, -1);
        const whole: string[] = graphemes(chip.full);
        assert.ok(kept.length > 0, `${said}: something is left of ${chip.full}`);
        assert.ok(whole.some((_, n) => whole.slice(0, n + 1).join('').trimEnd() === kept), `${said}: ${chip.text} is whole characters of ${chip.full}`);
      }
    }
  }
  assert.ok(cuts > 40, `${cuts} chips were cut`);
});

test('a people chip that is cut loses letters from its names and keeps its count', async () => {
  const { chipsOf } = await load('components/index.js');
  const [chip]: Drawn[] = chipsOf({ status: 'kept', view: { component: 'note', props: {} } }, { title: 'The crew', data: { people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra', 'Barbara Liskov', 'Alan Kay'] } });
  assert.match(chip!.text, /^Ada Lovelace, Grace H\p{L}*… \+3$/u);
  assert.equal(chip!.full, 'Ada Lovelace, Grace Hopper +3');
});

test('every arrangement in the client registry has a name and can arrange', async () => {
  const { COMPOSITES } = await load('composites/index.js');
  assert.deepEqual(Object.keys(COMPOSITES), ['gallery', 'timeline', 'comparison', 'sequence', 'cluster', 'stack']);
  for (const [name, kind] of Object.entries<Record<string, unknown>>(COMPOSITES)) {
    assert.equal(typeof kind.name, 'string', `${name}.name`);
    assert.equal(typeof kind.arrange, 'function', `${name}.arrange`);
  }
});

type Sample = { type: string; item: Record<string, unknown>; props: Record<string, unknown>; size: number[]; chips?: string[] };

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
    if (sample.chips) assert.deepEqual(chipsOf(node, sample.item).map((chip: { text: string }) => chip.text), sample.chips, said);
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
