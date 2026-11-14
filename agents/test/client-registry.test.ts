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
  assert.equal(span('中あ한'), 18 + 18 + 18, 'at the text size');
  assert.equal(span('中あ한', TITLE_LETTER), 17 + 18 + 17, 'at the title size');
  assert.equal(span('中あ한', QUOTE_LETTER), 21 + 21 + 21, 'in a quote');
  assert.equal(span('Quote', QUOTE_LETTER), span('Quote'), 'only the widest characters differ by face');
  assert.equal(span('🎉'), 22);
  assert.equal(span('👨‍👩‍👧‍👦'), 22);
  assert.equal(span('🏳️‍🌈'), 22);
  assert.equal(span('🇯🇵'), 22);
  assert.equal(span('é'), 10);
  const alphabet = 'ABCDEabcdmw.,ilt0123 $%中🎉';
  for (let i = 0; i < 2000; i++) {
    const made = Array.from({ length: 1 + (i % 40) }, (_, k) => [...alphabet][(i * 7 + k * 13) % 25]).join('');
    assert.ok(Number.isInteger(span(made)), made);
  }
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
