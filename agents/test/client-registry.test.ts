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

test('every arrangement in the client registry has a name and can arrange', async () => {
  const { COMPOSITES } = await load('composites/index.js');
  assert.deepEqual(Object.keys(COMPOSITES), ['gallery', 'timeline', 'comparison', 'sequence', 'cluster', 'stack']);
  for (const [name, kind] of Object.entries<Record<string, unknown>>(COMPOSITES)) {
    assert.equal(typeof kind.name, 'string', `${name}.name`);
    assert.equal(typeof kind.arrange, 'function', `${name}.arrange`);
  }
});

type Sample = { type: string; item: Record<string, unknown>; props: Record<string, unknown>; size: number[] };

test('every sample in footprints.json gets the footprint written there', async () => {
  const { COMPONENTS } = await load('components/index.js');
  const { samples } = JSON.parse(readFileSync(new URL('./footprints.json', import.meta.url), 'utf8')) as { samples: Sample[] };
  assert.ok(samples.length >= 60, `${samples.length} samples`);
  assert.deepEqual([...new Set(samples.map((sample) => sample.type))].sort(), Object.keys(COMPONENTS).sort(), 'every card type has a sample');
  for (const sample of samples) {
    assert.deepEqual(COMPONENTS[sample.type].size(sample.item, sample.props), sample.size, `${sample.type} ${JSON.stringify(sample.item.title)} ${JSON.stringify(sample.props).slice(0, 80)}`);
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

test('a sign or a unit is counted at least as wide as it draws', async () => {
  const { span, QUOTE_LETTER } = await load('components/shared.js');
  /** Widths in px measured in the page: a fact value at its largest size, and a quote. */
  const value = { '℃': 38.78, '₩': 30.73, '‰': 42.16, '™': 26.86, '½': 25.84, '€': 21.48, '¥': 21.48, '°': 15.07, '²': 10.98, '≈': 21.48, '→': 31.58, '—': 28.83, 'é': 18.34, 'Ω': 25.61, '№': 36.94, '🎉': 33.33 };
  const quote = { '—': 16, '…': 16, '“': 7.47, '’': 4.45, '🎉': 20, '℃': 15.72, 'é': 6.08 };
  for (const [ch, px] of Object.entries(value)) assert.ok(span(ch, 210) * 210 >= px * 100, `${ch} in a fact value`);
  for (const [ch, px] of Object.entries(quote)) assert.ok(span(ch, QUOTE_LETTER) * QUOTE_LETTER >= px * 100, `${ch} in a quote`);
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
