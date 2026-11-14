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

test('docs/libraries.md repeats the width wrap gives each character, as the client holds it', async () => {
  const { ADVANCES, TITLE_LETTER, TEXT_LETTER, PASSAGE_LETTER, FIGURES } = (await load('components/shared.js')) as { ADVANCES: Map<number, number[]>; TITLE_LETTER: number; TEXT_LETTER: number; PASSAGE_LETTER: number; FIGURES: [string, number, number, number][] };
  const page = readFileSync(new URL('../docs/libraries.md', import.meta.url), 'utf8');
  const rows = [...page.matchAll(/^\| .+ \| U\+(00[2-7][0-9A-F]) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/gm)];
  assert.equal(rows.length, 95);
  const letters = [TITLE_LETTER, TEXT_LETTER, PASSAGE_LETTER, FIGURES[0]![2], FIGURES[1]![2], FIGURES[2]![2]];
  assert.deepEqual([...ADVANCES.keys()], letters);
  for (const [, code, ...widths] of rows) assert.deepEqual(widths.map(Number), letters.map((letter) => ADVANCES.get(letter)![parseInt(code!, 16) - 0x20]), `U+${code}`);
});

test('wrap ends a line where a page does: between Han characters, after their stops, beside a Latin word and after a joining hyphen', async () => {
  const { wrap, advance, ADVANCES } = (await load('components/shared.js')) as { wrap: (str: string, width: number, letter: number, max: number) => number; advance: (str: string, letter: number) => number; ADVANCES: Map<number, number[]> };
  assert.equal(advance('记忆', 93), 3182);
  assert.equal(advance('a 记', 72), ADVANCES.get(72)![0x61 - 0x20]! + ADVANCES.get(72)![0]! + 1250, 'each English character by the table, and a Han character as one square');
  assert.equal(advance('é', 72), 11 * 72, 'any other character as the width table counts it');
  assert.equal(wrap('记'.repeat(18), 287, 93, 9), 1, 'eighteen Han characters fit a title line of 287 px');
  assert.equal(wrap('记'.repeat(19), 287, 93, 9), 2);
  assert.equal(wrap(`${'记'.repeat(17)}，记`, 287, 93, 9), 2, 'a comma stays with the character before it');
  assert.equal(wrap(`${'记'.repeat(17)}WWW`, 287, 93, 9), 2, 'a Latin word goes to the next line whole');
  assert.equal(wrap('state-of-the-art thinking', 60, 72, 9), 3, 'a hyphen between letters can end a line');
  assert.equal(wrap('-5 to -9', 20, 72, 9), 3, 'a hyphen before a digit cannot');
  assert.equal(wrap('', 100, 72, 9), 1);
  assert.equal(wrap('a b c d e f g h', 10, 72, 3), 3, 'never more than the most lines');
});

test('a table cuts no number, beside words or alone, and shows fewer columns when its numbers need the room', async () => {
  type Plan = { heads: string[]; rows: string[][]; widths: number[]; numbers: boolean[]; foot: string; width: number };
  const { plan } = (await load('components/table.js')) as { plan: (item: unknown, props: unknown) => Plan };
  const { textWidth } = (await load('components/shared.js')) as { textWidth: (str: string) => number };
  const whole = (given: Plan) => given.rows.forEach((row) => row.forEach((cell, i) => { if (/^[\d$]/.test(cell)) assert.ok(given.widths[i]! >= textWidth(cell), `${cell} has ${given.widths[i]} of ${textWidth(cell)}`); }));
  const mixed = plan(blank, { heads: ['Region', 'Q1', 'Q2', 'Note'], rows: [['North', '1,234,567.89', 'n/a', 'a new office by the harbour'], ['South', '–', '2,345,678.90', 'closed in May after the flood']] });
  assert.deepEqual(mixed.numbers, [false, false, false, false], 'a column with a word in it is no column of numbers');
  whole(mixed);
  const long = plan(blank, { heads: ['Body', 'Mass kg'], rows: [['Sun', '1,988,500,000,000,000'], ['Moon', '73,460,000,000']] });
  assert.deepEqual(long.numbers, [false, true], 'a number of more than fourteen characters is still a number');
  whole(long);
  const wide = plan(blank, { heads: ['A', 'B', 'C', 'D', 'E'], rows: [['1,234,567.89', '2,345,678.90', '3,456,789.01', '4,567,890.12', '5,678,901.23']] });
  assert.equal(wide.heads.length, 3);
  assert.equal(wide.foot, 'and 2 more columns');
  whole(wide);
  assert.ok(wide.widths.reduce((sum, each) => sum + each, 14 * 2) <= 319);
  const short = plan(blank, { heads: ['a', 'b', 'c'], rows: [['1', '2'], ['3', '4', '5', '6']] });
  assert.deepEqual(short.rows, [['1', '2', ''], ['3', '4', '5']], 'a table has as many columns as heads');
  const zh = plan({ ...blank, title: '城市比较', text: '' }, { heads: ['城市', '月租'], rows: Array.from({ length: 8 }, () => ['杭州', '¥6,500']) });
  assert.equal(zh.foot, '还有 2 行');
});

test('a card draws its fixed words in Chinese when its item is written in Chinese, and sizes itself with them', async () => {
  const { wordsOf } = (await load('words.js')) as { wordsOf: (item: unknown) => Record<string, unknown> & { more: (n: number) => string; moreOf: (r: number, c: number) => string } };
  const zh = { title: '周末露营清单', text: '[x] 帐篷' };
  assert.equal(wordsOf(zh).more(3), '还有 3 项');
  assert.equal(wordsOf(zh).moreOf(34, 1), '还有 34 行、1 列');
  assert.equal(wordsOf({ title: 'Packing', text: '' }).moreOf(1, 2), 'and 1 more row, 2 more columns');
  assert.equal(wordsOf({ title: 'Quest 3 的定位', text: '' }).untitled, 'Untitled', 'more Latin letters than Han characters is English');
  assert.equal(wordsOf({ title: 'AI 记忆宫殿', text: '' }).untitled, '未命名');
  const palette = '雾蓝 #A9BCCF\n米白 #FAF7EF\n胡桃 #8B5A2B\n墨绿 #2F4F3E\n砖红 #B5523B\n燕麦 #DCCFB8\n石灰 #C9C5BA\n深棕 #4E3B2A';
  assert.equal(wordsOf({ title: '客厅配色', text: palette }).more(2), '还有 2 项', 'the letters of a hex colour are not English');
  assert.equal(wordsOf({ title: '', text: '读书笔记 https://example.com/books/the-poetics-of-space-by-gaston-bachelard' }).untitled, '未命名', 'nor are a web address');
  assert.equal(wordsOf({ title: '', text: '' }).untitled, 'Untitled');
  assert.equal(wordsOf({}).untitled, 'Untitled');
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  const names = ['王晓明', '李静', '陈思远', '赵一凡', '周子涵', '吴雨桐', '郑浩然', '冯梓萱'];
  const paper = (title: string) => COMPONENTS.reference!.size({ ...blank, title }, { kind: 'paper', authors: names, more: true });
  const { wrap } = (await load('components/shared.js')) as { wrap: (str: string, width: number, letter: number, max: number) => number };
  assert.equal(paper('古籍自动标点方法研究')[1], 62 + 21 + 6 + 17 * wrap(`${names.join(', ')} 等`, 255, 72, 2));
  assert.equal(paper('Punctuating old books')[1], 62 + 21 + 6 + 17 * wrap(`${names.join(', ')} and others`, 255, 72, 2));
});

test('a facts card sets every figure in one size, trims what it is given, and marks a value too long to show', async () => {
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  const facts = (...values: string[]) => COMPONENTS.facts!.size(blank, { facts: values.map((value, i) => ({ label: `L${i}`, value })) });
  assert.deepEqual(facts('330 m', '1889'), [320, 30 + 21 + 12 + 28 + 17], 'two short figures in the middle size');
  assert.deepEqual(facts('330 m', '1889', '3', 'Stephen Sauvestre'), [320, 30 + 21 + 12 + (21 + 17) + 12 + (2 * 21 + 17)], 'one long name sets the whole card in the smallest size');
  assert.deepEqual(COMPONENTS.facts!.size(blank, { facts: [{ label: ' Height ', value: '  330 m  ' }, { label: 'Built', value: '\t1889\n' }] }), facts('330 m', '1889'), 'padding around a label or a value counts nothing');
  const passage = 'a room that is too large for its purpose makes those in it speak as if to a crowd '.repeat(6);
  assert.deepEqual(facts(passage, '1889'), [320, 30 + 21 + 12 + (8 * 21 + 17) + 12 + (21 + 17)], 'a passage is given eight lines and no more');
});
