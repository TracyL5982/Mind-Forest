import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SAMPLES_PATH, samplesFile } from '../scripts/samples.ts';
import { STRUCTURED_IDS } from '../src/core/samples.ts';
import { CHECKS, COMPONENT_IDS } from '../src/core/views.ts';

type Kind = { size: (item: unknown, props: unknown) => number[] };
type Given = { item?: Record<string, unknown>; props: Record<string, unknown> };

const load = (path: string) => import(new URL(`../client/js/${path}`, import.meta.url).href);
const blank = { title: 'A title', text: '', summary: '', data: {} };
const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');

/**
 * For each type, cards that each hold more than the one before: more rows, or longer text. The
 * footprint must never shrink along a row, and the last card must be larger than the first.
 */
const GROWING: Record<string, Given[]> = {
  list: [
    { props: { items: ['Tent', 'Stove'] } },
    { props: { items: ['Tent', 'Stove', 'Lamp', 'Map'] } },
    { props: { items: ['Tent', words(12), 'Lamp', 'Map'] } },
    { props: { items: ['Tent', words(12), 'Lamp', 'Map', 'Rope', 'Axe', 'Salt', 'Tea'] } },
    { item: { title: words(12) }, props: { items: ['Tent', words(12), 'Lamp', 'Map', 'Rope', 'Axe', 'Salt', 'Tea'] } },
  ],
  facts: [
    { props: { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }] } },
    { props: { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }, { label: 'Floors', value: '3' }] } },
    { props: { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }, { label: 'Floors', value: '3' }], more: 2 } },
    { props: { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: words(9) }, { label: 'Floors', value: '3' }], more: 2 } },
    { props: { facts: [{ label: 'Height', value: '330 m' }, { label: words(9), value: words(9) }, { label: 'Floors', value: '3' }], more: 2 } },
  ],
  table: [
    { props: { heads: ['a', 'b'], rows: [['1', '2']] } },
    { props: { heads: ['a', 'b'], rows: [['1', '2'], ['3', '4']] } },
    { props: { heads: ['a', 'b', 'c'], rows: [['1', '2', 'three'], ['3', '4', 'five']] } },
    { props: { heads: ['a', 'b', 'c'], rows: [['1', '2', words(3)], ['3', '4', 'five']] } },
    { props: { heads: ['a', 'b', 'c'], rows: Array.from({ length: 6 }, () => ['1', '2', words(3)]) } },
    { props: { heads: ['a', 'b', 'c'], rows: Array.from({ length: 40 }, () => ['1', '2', words(3)]) } },
  ],
  excerpt: [
    { item: { title: '' }, props: { text: 'A short passage.' } },
    { props: { text: 'A short passage.' } },
    { props: { text: 'A short passage.', at: 'Chapter 1' } },
    { props: { text: words(14), at: 'Chapter 1', source: 'example.org' } },
    { props: { text: words(40), at: 'Chapter 1', source: 'example.org' } },
  ],
  idea: [
    { item: { title: 'Go' }, props: {} },
    { item: { title: 'Build a treehouse' }, props: {} },
    { item: { title: 'Build a treehouse in the old oak' }, props: {} },
    { item: { title: 'Build a treehouse in the old oak behind the shed by June' }, props: {} },
  ],
  reference: [
    { props: { kind: 'book', authors: [] } },
    { props: { kind: 'book', authors: ['A. Lima'] } },
    { props: { kind: 'book', authors: ['A. Lima'], venue: 'Example Press' } },
    { props: { kind: 'book', authors: ['A. Lima', 'B. Okri', 'C. Wei', 'D. Haas', 'E. Itō', 'F. Brandt'], more: true, venue: 'Example Press' } },
    { item: { title: words(12) }, props: { kind: 'book', authors: ['A. Lima', 'B. Okri', 'C. Wei', 'D. Haas', 'E. Itō', 'F. Brandt'], more: true, venue: words(12) } },
  ],
  artwork: [
    { props: { src: 'a.png' } },
    { props: { src: 'a.png', maker: 'Ilse Brandt' } },
    { props: { src: 'a.png', maker: 'Ilse Brandt', date: '1928', medium: 'Gelatin silver print' } },
    { props: { src: 'a.png', maker: 'Ilse Brandt', date: '1928', medium: 'Gelatin silver print', holder: 'The Example Museum of Art' } },
    { item: { title: words(10) }, props: { src: 'a.png', maker: words(10), date: '1928', medium: words(10), holder: 'The Example Museum of Art' } },
  ],
  breakdown: [
    { props: { labels: ['Yes', 'No'], values: [3, 1] } },
    { props: { labels: ['Yes', 'No'], values: [3, 1], unit: 'votes' } },
    { props: { labels: ['Yes', 'No', 'Maybe'], values: [3, 1, 2], unit: 'votes' } },
    { item: { title: words(10) }, props: { labels: ['Yes', 'No', 'Maybe', 'Later', 'Never'], values: [3, 1, 2, 1, 1], unit: 'votes' } },
  ],
  qa: [
    { props: { question: 'Why?', answer: 'Because.' } },
    { props: { question: 'Why?', answer: words(12) } },
    { props: { question: words(8), answer: words(12) } },
    { props: { question: words(8), answer: words(40) } },
  ],
  callout: [
    { item: { title: '' }, props: { text: 'Mind the step.', tone: 'caution' } },
    { props: { text: 'Mind the step.', tone: 'caution' } },
    { props: { text: words(8), tone: 'caution' } },
    { props: { text: words(20), tone: 'note' } },
  ],
  definition: [
    { props: { term: 'Bokeh', definition: 'blur' } },
    { props: { term: 'Bokeh', definition: words(8) } },
    { props: { term: 'Bokeh', definition: words(24) } },
  ],
  proscons: [
    { props: { pros: ['cheap'], cons: ['slow'] } },
    { props: { pros: ['cheap', 'small'], cons: ['slow'] } },
    { props: { pros: ['cheap', 'small'], cons: ['slow', words(8), 'loud'] } },
    { props: { pros: ['cheap', 'small', 'a', 'b', 'c', 'd'], cons: ['slow', words(8), 'loud', 'e', 'f'] } },
  ],
  swatch: [
    { props: { colours: [{ name: 'Night', value: 'black' }, { name: 'Day', value: 'white' }] } },
    { props: { colours: [{ name: 'Night', value: 'black' }, { name: 'Day', value: 'white' }, { name: 'Dusk', value: '#334' }] } },
    { item: { title: words(10) }, props: { colours: Array.from({ length: 9 }, (_, i) => ({ name: `Colour ${i}`, value: `#${i}${i}${i}` })) } },
  ],
  place: [
    { item: { title: 'Lisbon' }, props: { name: 'Lisbon' } },
    { item: { title: 'Lisbon', summary: 'Three days.' }, props: { name: 'Lisbon' } },
    { item: { title: 'Lisbon', summary: words(30) }, props: { name: 'Lisbon' } },
    { item: { title: 'Lisbon', summary: words(30) }, props: { name: 'Lisbon', src: 'a.png' } },
  ],
};

/** A type that sets longer words in a smaller size, so a card that holds a little more can be a little shorter. */
const STEPS_DOWN = new Set(['idea']);

test('the footprint of each structured card type is whole, the same each time it is asked, and grows with what the card holds', async () => {
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  for (const [type, steps] of Object.entries(GROWING)) {
    const sizes = steps.map(({ item, props }) => {
      const given = { ...blank, ...item };
      const frozen = JSON.stringify([given, props]);
      const size = COMPONENTS[type]!.size(given, props);
      assert.ok(size.length === 2 && size.every((side) => Number.isInteger(side) && side > 0), `${type} is ${size}`);
      assert.deepEqual(COMPONENTS[type]!.size(given, props), size, `${type} gives the same footprint twice`);
      assert.equal(JSON.stringify([given, props]), frozen, `${type} leaves what it was given alone`);
      return size as [number, number];
    });
    if (!STEPS_DOWN.has(type)) sizes.slice(1).forEach(([wide, tall], i) => assert.ok(wide >= sizes[i]![0] && tall >= sizes[i]![1], `${type} step ${i + 1}: ${sizes[i]} then ${[wide, tall]}`));
    const [first, last] = [sizes[0]!, sizes.at(-1)!];
    assert.ok(last[0] * last[1] > first[0] * first[1], `${type}: ${first} grows to ${last}`);
  }
});

test('the library page draws the samples the rules give today', () => {
  assert.equal(readFileSync(SAMPLES_PATH, 'utf8'), samplesFile(), 'run scripts/samples.ts');
});

test('every component the service can choose has a client module, a content check and its two parts of the libraries page', async () => {
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Record<string, unknown>> };
  const page = readFileSync(new URL('../docs/libraries.md', import.meta.url), 'utf8');
  assert.deepEqual(Object.keys(COMPONENTS), COMPONENT_IDS, 'the client registry holds the service\'s components, in its order');
  for (const id of COMPONENT_IDS) {
    for (const part of ['size', 'draw', 'detail']) assert.equal(typeof COMPONENTS[id]![part], 'function', `${id}.${part}`);
    assert.ok(Array.isArray(COMPONENTS[id]!.shows), `${id}.shows`);
    assert.ok(Object.hasOwn(CHECKS, id) && typeof CHECKS[id].props === 'object', `${id} has a content check`);
    assert.ok(page.includes(`\n### ${id}\n`), `docs/libraries.md has a section for ${id}`);
    assert.ok(page.includes(`\n- **${id}.** `), `docs/libraries.md gives the footprint of ${id}`);
  }
});

test('every structured type has a growing run here and four golden footprints, one of them in Chinese', () => {
  const { samples } = JSON.parse(readFileSync(new URL('./footprints.json', import.meta.url), 'utf8')) as { samples: { type: string; item: unknown; props: unknown }[] };
  assert.deepEqual(Object.keys(GROWING).sort(), [...STRUCTURED_IDS].sort());
  for (const id of STRUCTURED_IDS) {
    const mine = samples.filter((sample) => sample.type === id);
    assert.ok(mine.length >= 4, `${id} has ${mine.length} golden footprints`);
    assert.ok(mine.some((sample) => /\p{Script=Han}/u.test(JSON.stringify([sample.item, sample.props]))), `${id} has a Chinese footprint`);
  }
});

test('the bars of a breakdown are shares of the whole, and a share written as 0 has no bar', async () => {
  const { parts } = (await load('components/breakdown.js')) as { parts: (props: unknown) => { rows: { bar: number; written: string }[] } };
  const bars = (values: number[], unit = '%') => parts({ labels: values.map(String), values, unit }).rows.map((row) => row.bar);
  assert.deepEqual(bars([45, 25, 10, 20]), [0.45, 0.25, 0.1, 0.2]);
  assert.deepEqual(bars([3, 1], 'votes'), [0.75, 0.25]);
  assert.deepEqual(bars([0, 0]), [0, 0], 'a whole of 0 draws empty tracks');
  const tiny = parts({ labels: ['a', 'b'], values: [100, 0.0000001], unit: '%' }).rows;
  assert.deepEqual([tiny[1]!.written, tiny[1]!.bar], ['0%', 0]);
  assert.deepEqual(bars([-5, Number.NaN, 5]), [0, 0, 1]);
});
