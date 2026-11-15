import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const load = (path: string) => import(new URL(`../client/js/${path}`, import.meta.url).href);

test('every card type in the client registry can be sized, drawn and opened', async () => {
  const { COMPONENTS } = await load('components/index.js');
  assert.deepEqual(Object.keys(COMPONENTS), ['note', 'quote', 'fact', 'image', 'video', 'audio', 'link', 'chart', 'person', 'chat', 'code', 'steps', 'facts', 'table', 'list', 'breakdown', 'qa', 'callout', 'excerpt', 'definition', 'idea', 'proscons', 'swatch', 'artwork', 'reference', 'place', 'sheet', 'explorable']);
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

test('a face is the same size with sources or without, kept or a pick, and never wider than 210 or taller than 146', async () => {
  const { COMPONENTS, sizeOf } = await load('components/index.js');
  const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const bare = { title: 'A title', text: 'Some text', summary: 'A summary', data: {}, origin: { by: 'agent' } };
  const sourced = { ...bare, data: { when: '1958', where: 'Bodega Bay', people: ['Ada', 'Grace', 'Edsger'], from: 'The Met', site: 'example.com' } };
  const full = { ...sourced, title: long(30), text: long(200), summary: long(60) };
  const props = {
    text: long(80), by: long(10), value: '1'.repeat(60), label: long(20), caption: long(30), description: long(40), name: long(12), role: long(20),
    messages: Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', text: long(25) })), source: long(200), language: 'python',
    steps: Array.from({ length: 9 }, () => long(15)), items: Array.from({ length: 12 }, () => long(9)), facts: Array.from({ length: 9 }, () => ({ label: long(6), value: long(4) })),
    heads: ['Month', 'Weeks'], rows: Array.from({ length: 30 }, () => ['a', 'b', 'c']), labels: ['a', 'b', 'c'], values: [3, 1, 2], question: long(30), answer: long(60),
    term: long(8), definition: long(60), pros: [long(10), 'b'], cons: [long(10)], colours: Array.from({ length: 14 }, (_, i) => ({ name: long(5), value: `#${i}${i}${i}` })),
    authors: [long(4), 'B'], kind: 'book', venue: long(10), above: [long(30), 'Results:', long(20)],
    sections: [{ kind: 'text', text: long(60) }, { kind: 'list', items: [long(9), 'b'] }],
    controls: [{ kind: 'segmented', label: 'Light', states: [{ name: 'One', text: long(30) }, { name: 'Two', text: long(30) }] }], output: { kind: 'text' },
  };
  for (const component of [...Object.keys(COMPONENTS), 'hologram']) {
    for (const given of [{}, props]) {
      const at = (status: string, item: unknown) => sizeOf({ status, view: { component, props: given } }, item);
      const size = at('kept', bare);
      assert.deepEqual(at('pick', bare), size, `${component} is as large a pick as kept`);
      assert.deepEqual(at('kept', sourced), size, `${component} draws no chip line, so its sources add nothing`);
      assert.deepEqual(at('kept', { ...bare, data: undefined }), size, `${component} without data`);
      for (const item of [bare, full]) {
        const [wide, tall] = at('kept', item);
        assert.ok(wide <= 210 && tall <= 146, `${component} with ${given === props ? 'everything' : 'nothing'} is ${wide} by ${tall}`);
      }
    }
  }
});

test('every arrangement in the client registry has a name and can arrange', async () => {
  const { COMPOSITES } = await load('composites/index.js');
  assert.deepEqual(Object.keys(COMPOSITES), ['gallery', 'timeline', 'comparison', 'sequence', 'cluster', 'stack', 'ranked', 'beforeafter', 'lead', 'overview', 'moodboard', 'matrix', 'map', 'layout']);
  for (const [name, kind] of Object.entries<Record<string, unknown>>(COMPOSITES)) {
    assert.equal(typeof kind.name, 'string', `${name}.name`);
    assert.equal(typeof kind.arrange, 'function', `${name}.arrange`);
  }
});

type Sample = { type: string; item: Record<string, unknown>; props: Record<string, unknown>; size: number[] };

test('every sample in footprints.json gets the footprint written there', async () => {
  const { COMPONENTS, sizeOf } = await load('components/index.js');
  const { samples } = JSON.parse(readFileSync(new URL('./footprints.json', import.meta.url), 'utf8')) as { samples: Sample[] };
  assert.ok(samples.length >= 60, `${samples.length} samples`);
  assert.deepEqual([...new Set(samples.map((sample) => sample.type))].filter((type) => type in COMPONENTS).sort(), Object.keys(COMPONENTS).sort(), 'every card type has a sample');
  for (const sample of samples) {
    const node = { view: { component: sample.type, props: sample.props } };
    const said = `${sample.type} ${JSON.stringify(sample.item.title)} ${JSON.stringify(sample.props).slice(0, 80)}`;
    assert.deepEqual(sizeOf(node, sample.item), sample.size, said);
    if (COMPONENTS[sample.type]) assert.deepEqual(COMPONENTS[sample.type].size(sample.item, sample.props), sample.size, `${said}: the type's own size`);
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

/** A fact face with no label and no title: the frame, the value's line or lines, and the rule 1 px under it, 2 px tall. */
const factHeight = (lead: number, lines = 1) => 30 + lead * lines + 1 + 2;

test('a fact value takes the largest size its digits fit at in the 177 px column, 34, 24 or 18 px, and is never cut', async () => {
  const { COMPONENTS } = await load('components/index.js');
  const size = (value: string) => COMPONENTS.fact.size({ title: '' }, { value, label: '' }) as [number, number];
  assert.deepEqual(size('12345678'), [210, factHeight(36)], 'eight digits at 21.48 px each fit the largest size, on its 36 px line');
  assert.deepEqual(size('123456789'), [210, factHeight(28)], 'nine step down once');
  assert.deepEqual(size('12345678901'), [210, factHeight(28)], 'eleven at 15.06 px each still fit the middle size');
  assert.deepEqual(size('123456789012'), [210, factHeight(24)], 'twelve step down again, to 18 px');
  assert.deepEqual(size('123456789012345'), [210, factHeight(24)], 'where fifteen at 11.28 px each fit one line');
  assert.deepEqual(size('1234567890123456'), [210, factHeight(24, 2)], 'past one line at 18 px it wraps, whole');
});

test('a fact card\'s value stands on as many lines as it needs at 18 px, up to the four a face holds, its label under it on two', async () => {
  const { COMPONENTS } = await load('components/index.js');
  const height = (value: string, label = '') => (COMPONENTS.fact.size({ title: '' }, { value, label }) as [number, number])[1];
  assert.equal(height('1'.repeat(45)), factHeight(24, 3), 'forty-five digits at fifteen a line need three');
  assert.equal(height('1'.repeat(46)), factHeight(24, 4), 'forty-six need four');
  assert.equal(height('1'.repeat(400)), 30 + 24 * 4 + 18, 'a paragraph stops at four, and the cue says there is more');
  assert.equal(height('42%', 'of viewers leave in the first minute'), factHeight(36) + 1 + 2 * 22, 'a label of two lines stands 1 px under the rule');
  assert.equal(height('42%', 'of viewers leave in the first minute of the film, before the title has gone'), factHeight(36) + 1 + 2 * 22 + 18, 'a longer label stops at two lines, and the cue says there is more');
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
