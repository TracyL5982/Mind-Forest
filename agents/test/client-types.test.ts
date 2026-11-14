import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SAMPLES_PATH, samplesFile } from '../scripts/samples.ts';

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
