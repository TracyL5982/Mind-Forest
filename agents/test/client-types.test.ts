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
const switching = (count: number, said: string) => ({ kind: 'segmented', label: 'Light', states: Array.from({ length: count }, (_, i) => ({ name: `State ${i}`, text: said })) });
const contrasted = (...controls: unknown[]) => ({ controls, output: { kind: 'text' } });

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
    { props: { heads: ['a', 'b'], rows: [] } },
    { props: { heads: ['a', 'b'], rows: [['1', '2']] } },
    { props: { heads: ['a', 'b', 'c'], rows: Array.from({ length: 40 }, () => ['1', '2', words(3)]) } },
    { props: { heads: [words(12), 'b', 'c'], rows: Array.from({ length: 40 }, () => ['1', '2', words(3)]) } },
    { item: { title: words(8) }, props: { heads: [words(12), 'b', 'c'], rows: Array.from({ length: 40 }, () => ['1', '2', words(3)]) } },
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
    { props: { colours: [{ name: 'Night', value: 'black' }] } },
    { props: { colours: [{ name: 'Night', value: 'black' }, { name: 'Day', value: 'white' }] } },
    { props: { colours: Array.from({ length: 9 }, (_, i) => ({ name: `Colour ${i}`, value: `#${i}${i}${i}` })) } },
  ],
  sheet: [
    { props: { sections: [{ kind: 'text', text: 'Pack the night before.' }, { kind: 'list', items: ['Tent', 'Stove'] }] } },
    { props: { sections: [{ kind: 'heading', text: 'Camp' }, { kind: 'text', text: 'Pack the night before.' }, { kind: 'list', items: ['Tent', 'Stove'] }] } },
    { props: { sections: [{ kind: 'heading', text: 'Camp' }, { kind: 'text', text: words(30) }, { kind: 'list', items: ['Tent', 'Stove', 'Lamp'] }] } },
    { props: { sections: [{ kind: 'heading', text: 'Camp' }, { kind: 'text', text: words(30) }, { kind: 'figures', facts: [{ label: 'Nights', value: '2' }] }, { kind: 'list', items: ['Tent', 'Stove', 'Lamp'] }] } },
    { props: { sections: [{ kind: 'picture', src: 'a.png' }, { kind: 'text', text: words(30) }, { kind: 'figures', facts: [{ label: 'Nights', value: '2' }, { label: 'Cost', value: '€240' }, { label: 'Walked', value: '31 km' }] }, { kind: 'list', items: ['Tent', 'Stove', 'Lamp', words(12), 'Map', 'Rope', 'Axe', 'Tea'] }] } },
    { item: { title: words(12) }, props: { sections: [{ kind: 'picture', src: 'a.png' }, { kind: 'text', text: words(30) }, { kind: 'figures', facts: [{ label: 'Nights', value: '2' }, { label: 'Cost', value: '€240' }, { label: 'Walked', value: '31 km' }] }, { kind: 'list', items: ['Tent', 'Stove', 'Lamp', words(12), 'Map', 'Rope', 'Axe', 'Tea'] }] } },
  ],
  explorable: [
    { props: contrasted(switching(2, 'Short.')) },
    { props: contrasted(switching(2, words(12))) },
    { props: contrasted(switching(3, words(30))) },
    { props: contrasted(switching(3, words(30)), switching(2, words(12))) },
  ],
  place: [
    { item: { title: 'Lisbon' }, props: { name: 'Lisbon' } },
    { item: { title: 'Lisbon', summary: 'Three days.' }, props: { name: 'Lisbon' } },
    { item: { title: 'Lisbon', summary: words(30) }, props: { name: 'Lisbon' } },
    { item: { title: 'Lisbon', summary: words(30) }, props: { name: 'Lisbon', src: 'a.png' } },
  ],
};

test('the footprint of each structured card type is whole, the same each time it is asked, leaves its input alone and keeps to 210 by 146', async () => {
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
    sizes.forEach(([wide, tall], i) => assert.ok(wide === 210 && tall <= 146, `${type} step ${i}: ${wide} by ${tall}`));
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
  const { ADVANCES, TITLE_LETTER, TEXT_LETTER, PASSAGE_LETTER, FIGURES, TITLE_FACE, BODY_FACE, META_FACE } = (await load('components/shared.js')) as { ADVANCES: Map<number, number[]>; TITLE_LETTER: number; TEXT_LETTER: number; PASSAGE_LETTER: number; FIGURES: [string, number, number, number][]; TITLE_FACE: number; BODY_FACE: number; META_FACE: number };
  const page = readFileSync(new URL('../docs/libraries.md', import.meta.url), 'utf8');
  const rows = [...page.matchAll(/^\| .+ \| U\+(00[2-7][0-9A-F]) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/gm)];
  assert.equal(rows.length, 95);
  const letters = [TITLE_LETTER, TEXT_LETTER, PASSAGE_LETTER, FIGURES[0]![2], FIGURES[1]![2], FIGURES[2]![2], TITLE_FACE, BODY_FACE, META_FACE];
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

test('a table\'s face names its heads, as many as stand whole on one meta line and a count of the rest, over the cue that counts its rows, and cuts no number', async () => {
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  const { headsLine, isNumber } = (await load('components/table.js')) as { headsLine: (heads: string[]) => string; isNumber: (cell: string) => boolean };
  const { linesOf } = (await load('components/shared.js')) as { linesOf: (str: string, column: number, measure: string) => number };
  const [FRAME, COLUMN, TITLE, GAP, META, CUE] = [30, 210 - 33, 24, 6, 18, 18];
  assert.equal(headsLine(['Plan', 'Price', 'Seats']), 'Plan · Price · Seats', 'heads that stand whole on one line are all named, as the item writes them');
  const heads = ['Year', 'Film', 'Director', 'Gross', 'Country of the studio', 'Running time'];
  const named = headsLine(heads);
  const left = Number(/ \+(\d+)$/.exec(named)?.[1]);
  const kept = heads.length - left;
  assert.ok(left > 0 && named === `${heads.slice(0, kept).join(' · ')} +${left}`, named);
  assert.equal(linesOf(named, COLUMN, 'meta'), 1, 'the heads named stand on one line with the count of the rest');
  assert.ok(linesOf(`${heads.slice(0, kept + 1).join(' · ')} +${left - 1}`, COLUMN, 'meta') > 1, 'and one more would not');
  const long = 'What was measured at the station over the whole of the year';
  assert.equal(headsLine([long, 'Value']), `${long} +1`, 'the first head is named however long it is');
  const table = (props: Record<string, unknown>) => COMPONENTS.table!.size(blank, props);
  assert.deepEqual(table({ heads: ['Wall', 'Length'], rows: [['North', '4.2 m'], ['East', '3.1 m']] }), [210, FRAME + TITLE + GAP + META + 4 + CUE], 'the heads over 4 px and the cue, which counts the rows');
  assert.deepEqual(table({ heads: ['Wall', 'Length'], rows: [] }), [210, FRAME + TITLE + GAP + META], 'a table with no rows has no cue');
  for (const number of ['1,234,567.89', '1,988,500,000,000,000', '$1,234,567,890,123.45 USD', 'US$ 1,200', '¥6,500', '−3%']) assert.ok(isNumber(number), `the opened table sets ${number} whole on one line`);
  for (const words of ['n/a', 'a new office by the harbour', 'closed in May', '–']) assert.ok(!isNumber(words), `${words} wraps as words`);
});

test('a card draws its fixed words in Chinese when its item is written in Chinese, and sizes itself with them', async () => {
  type Cue = { more: string; left: (n: number) => string; rows: (n: number) => string; parts: (n: number) => string; lines: (n: number, language: string) => string; sides: (p: number, c: number) => string; controls: (n: number) => string };
  const { wordsOf } = (await load('words.js')) as { wordsOf: (item: unknown) => { untitled: string; cue: Cue; firstAuthor: (first: string, others: number, more: boolean) => string } };
  const zh = wordsOf({ title: '周末露营清单', text: '[x] 帐篷' });
  const en = wordsOf({ title: 'Packing', text: '' });
  assert.deepEqual([zh.cue.more, zh.cue.left(3), zh.cue.rows(34), zh.cue.parts(2), zh.cue.lines(12, 'python'), zh.cue.sides(3, 2), zh.cue.controls(2)], ['更多', '还有 3 项', '34 行', '2 部分', '12 行 python', '3 条优点，2 条缺点', '2 个控件']);
  assert.deepEqual([en.cue.more, en.cue.left(3), en.cue.rows(1), en.cue.rows(34), en.cue.parts(1), en.cue.lines(1, ''), en.cue.lines(24, 'Python'), en.cue.sides(3, 2), en.cue.controls(2)], ['More', '3 more', '1 row', '34 rows', '1 part', '1 line', '24 lines of Python', '3 for, 2 against', '2 controls']);
  assert.equal(wordsOf({ title: 'Quest 3 的定位', text: '' }).untitled, 'Untitled', 'more Latin letters than Han characters is English');
  assert.equal(wordsOf({ title: 'AI 记忆宫殿', text: '' }).untitled, '未命名');
  const palette = '雾蓝 #A9BCCF\n米白 #FAF7EF\n胡桃 #8B5A2B\n墨绿 #2F4F3E\n砖红 #B5523B\n燕麦 #DCCFB8\n石灰 #C9C5BA\n深棕 #4E3B2A';
  assert.equal(wordsOf({ title: '客厅配色', text: palette }).cue.left(2), '还有 2 项', 'the letters of a hex colour are not English');
  assert.equal(wordsOf({ title: '', text: '读书笔记 https://example.com/books/the-poetics-of-space-by-gaston-bachelard' }).untitled, '未命名', 'nor are a web address');
  assert.equal(wordsOf({ title: '配色', text: '雾蓝 rgb(169, 188, 207)\n砖红 RGBA(181, 82, 59, 0.9)\n墨绿 hsl(147 25% 25%)' }).untitled, '未命名', 'nor a colour written as rgb() or hsl()');
  assert.equal(wordsOf({ title: '', text: '' }).untitled, 'Untitled');
  assert.equal(wordsOf({}).untitled, 'Untitled');
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  const { linesOf } = (await load('components/shared.js')) as { linesOf: (str: string, column: number, measure: string) => number };
  const [FRAME, COLUMN, META, RULE, TITLE, GAP] = [30, 210 - 33, 18, 14, 24, 6];
  const names = ['王晓明', '李静', '陈思远', '赵一凡', '周子涵', '吴雨桐', '郑浩然', '冯梓萱'];
  const paper = (title: string) => COMPONENTS.reference!.size({ ...blank, title }, { kind: 'paper', authors: names, more: true })[1];
  assert.equal(zh.firstAuthor('王晓明', 7, true), '王晓明 等');
  assert.equal(en.firstAuthor('A. Vaswani', 7, false), 'A. Vaswani and 7 others');
  assert.equal(en.firstAuthor('A. Vaswani', 1, false), 'A. Vaswani and 1 other');
  assert.equal(en.firstAuthor('A. Vaswani', 0, true), 'A. Vaswani and others', 'a list the source cut says only that there are others');
  for (const title of ['古籍自动标点方法研究', 'Punctuating old books']) {
    assert.equal(paper(title), FRAME + META + RULE + linesOf(title, COLUMN, 'title') * TITLE + GAP + META, `${title}: the kind over its rule, the title, and the first author on one meta line`);
  }
});

test('a facts card sets two figures to a row in the middle size when both fit half of it, any other alone, and never a value without its label', async () => {
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  const { linesOf } = (await load('components/shared.js')) as { linesOf: (str: string, column: number, measure: string) => number };
  const [FRAME, COLUMN, TITLE, UNDER, MIDDLE, SMALL, META, CUE] = [30, 210 - 33, 24, 4, 28, 24, 18, 18];
  const facts = (...values: string[]) => COMPONENTS.facts!.size(blank, { facts: values.map((value, i) => ({ label: `L${i}`, value })) });
  assert.deepEqual(facts('330 m', '1889'), [210, FRAME + TITLE + UNDER + MIDDLE + META], 'two short figures share a row in the middle size, each over its label');
  assert.deepEqual(facts('12345', '67890'), facts('330 m', '1889'), 'five digits fit half a row in the middle size');
  assert.deepEqual(facts('330 m', '1889', '3', 'Stephen Sauvestre'), [210, FRAME + TITLE + UNDER + MIDDLE + META + CUE], 'the face holds one row, and the cue counts the facts after it');
  assert.deepEqual(COMPONENTS.facts!.size(blank, { facts: [{ label: ' Height ', value: '  330 m  ' }, { label: 'Built', value: '\t1889\n' }] }), facts('330 m', '1889'), 'padding around a label or a value counts nothing');
  const name = 'Gustave Eiffel and Sauvestre';
  assert.equal(linesOf(name, COLUMN, 'figure'), 2);
  assert.deepEqual(facts(name), [210, FRAME + TITLE + UNDER + 2 * SMALL + META], 'a value too long for a line in the middle size steps down to 18 px and wraps, whole');
  const passage = 'a room that is too large for its purpose makes those in it speak as if to a crowd '.repeat(6);
  assert.deepEqual(facts(passage, '1889'), [210, FRAME + TITLE + UNDER + 2 * SMALL + META + CUE], 'a passage stands on the whole lines the face leaves it over a line of its label, and the cue counts the fact after it');
  const over = 'The results of the six week trial';
  assert.equal(linesOf(over, COLUMN, 'body'), 2);
  const crowded = COMPONENTS.facts!.size(blank, { above: [over], facts: [{ label: 'Note', value: passage }] });
  assert.deepEqual(crowded, [210, FRAME + TITLE + 6 + 2 * 22 + CUE], 'a value with no room for a line of its label is left out whole');
});

test('a list, a quote, a question, a callout, an excerpt and a definition show the lines their item writes over them first, each whole, and a note shows the words it sets apart', async () => {
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  const { linesOf } = (await load('components/shared.js')) as { linesOf: (str: string, column: number, measure: string) => number };
  const [FRAME, HEIGHT, COLUMN, TITLE, GAP, TEXT, META, CUE] = [30, 146, 210 - 33, 24, 6, 22, 18, 18];
  const size = (type: string, props: Record<string, unknown>, item = blank) => COMPONENTS[type]!.size(item, props) as [number, number];
  const OVER: Record<string, Record<string, unknown>> = {
    quote: { text: 'A map is not the territory.' },
    list: { items: ['Tent', 'Stove'] },
    qa: { question: 'Why?', answer: 'Because.' },
    callout: { text: 'Mind the step.', tone: 'caution' },
    excerpt: { text: 'A short passage.' },
    definition: { term: 'Bokeh', definition: 'Bokeh is the blur.' },
  };
  for (const [type, props] of Object.entries(OVER)) {
    const [wide, tall] = size(type, props);
    assert.deepEqual(size(type, { ...props, above: ['Results:'] }), [wide, tall + GAP + TEXT], `${type} draws a heading over its structure, 6 px from it`);
    assert.deepEqual(size(type, { ...props, above: ['Results:', '  '] }), [wide, tall + GAP + TEXT], `${type} passes over a blank line`);
  }
  /** What stands before the lines over each: a list's title, and for an excerpt the source under the passage, which it keeps. */
  const BEFORE: Record<string, number> = { list: TITLE + GAP };
  const KEPT: Record<string, number> = { excerpt: 10 + META };
  for (const type of Object.keys(OVER)) {
    const lines = Math.floor((HEIGHT - FRAME - CUE - (BEFORE[type] ?? 0) - (KEPT[type] ?? 0)) / TEXT);
    assert.deepEqual(size(type, { ...OVER[type], above: [words(40)] }), [210, FRAME + (BEFORE[type] ?? 0) + lines * TEXT + (KEPT[type] ?? 0) + CUE], `${type} gives its face to the lines over its structure before any of the structure`);
  }
  const note = (emphasis: string, text: string) => size('note', { emphasis }, { ...blank, text })[1];
  const said = 'Barges carry the grain out and the news in. The road is for locals, and every hamlet faces the water, except the red house. The river is the highway.';
  assert.equal(note('The river is the highway.', said), FRAME + TITLE + GAP + linesOf('The river is the highway.', COLUMN, 'body') * TEXT + CUE, 'a note whose first lines do not reach the words it sets apart starts where they do, and the cue says there is more');
  assert.equal(note('Barges carry the grain', said), note('', said), 'words its first lines reach are marked where they stand');
  assert.equal(note('“The river is the highway”', said), note('The river is the highway.', said.replace('The river', '"The river')), 'and it finds them whatever quotation marks either writes');
});

test('a structured face shows the lines its item writes over its structure first, each whole, and leaves its structure out before any of them, and a chart or a breakdown its heads row', async () => {
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  const [FRAME, HEIGHT, TITLE, GAP, TEXT, HEADS, CUE] = [30, 146, 24, 6, 22, 18 + 5, 18];
  const size = (type: string, props: Record<string, unknown>) => COMPONENTS[type]!.size(blank, props) as [number, number];
  const ROOMY: Record<string, Record<string, unknown>> = {
    facts: { facts: [{ label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }] },
    steps: { steps: ['Zoom in', 'Pull back'] },
    table: { heads: ['Wall', 'Length'], rows: [['North', '4.2 m']] },
    proscons: { heads: ['For:', 'Against:'], pros: ['cheap'], cons: ['slow'] },
    sheet: { sections: [{ kind: 'text', text: 'Pack the night before.' }, { kind: 'list', items: ['Tent', 'Stove'] }] },
  };
  for (const [type, props] of Object.entries(ROOMY)) {
    const [wide, tall] = size(type, props);
    assert.deepEqual(size(type, { ...props, above: ['Results:'] }), [wide, tall + GAP + TEXT], `${type} draws a heading over its structure, whole`);
    assert.deepEqual(size(type, { ...props, above: ['Results:', '  '] }), [wide, tall + GAP + TEXT], `${type} passes over a blank line`);
  }
  const EVERY: Record<string, Record<string, unknown>> = {
    ...ROOMY,
    fact: { value: '12%', label: 'conversion' },
    chart: { chart: 'bar', labels: ['Mar', 'Apr'], values: [4, 9] },
    breakdown: { labels: ['Yes', 'No'], values: [75, 25], unit: '%' },
    explorable: contrasted(switching(2, 'Short.')),
  };
  const LEAD: Record<string, number> = { fact: 0, explorable: 22 + TITLE };
  for (const [type, props] of Object.entries(EVERY)) {
    const lead = LEAD[type] ?? TITLE;
    const gap = type === 'fact' ? 0 : GAP;
    const lines = Math.floor((HEIGHT - FRAME - CUE - lead - gap) / TEXT);
    assert.deepEqual(size(type, { ...props, above: [words(40)] }), [210, FRAME + lead + gap + lines * TEXT + CUE], `${type} gives its face to the lines over its structure before any of the structure`);
  }
  assert.deepEqual(size('chart', { ...EVERY.chart, heads: ['Month', 'Weeks'] }), [210, FRAME + TITLE + GAP + HEADS + GAP + 38 + CUE], 'a chart draws its heads row over the shape, which keeps its least height, and its count becomes the cue');
  assert.deepEqual(size('breakdown', { ...EVERY.breakdown, heads: ['Month', 'Weeks'] }), [210, FRAME + TITLE + GAP + HEADS + GAP + 16 + CUE], 'a breakdown draws its heads row over its bar');
});

test('a sheet\'s face is its title, the lines over it and its first part as that part\'s own preview, and the cue counts the other parts', async () => {
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  const { linesOf } = (await load('components/shared.js')) as { linesOf: (str: string, column: number, measure: string) => number };
  const [FRAME, COLUMN, TITLE, GAP, TEXT, META, CUE] = [30, 210 - 33, 24, 6, 22, 18, 18];
  const sheet = (sections: unknown[], item: Record<string, unknown> = {}) => COMPONENTS.sheet!.size({ ...blank, ...item }, { sections });
  const text = { kind: 'text', text: 'Pack the night before.' };
  const list = { kind: 'list', items: ['Tent', 'Stove'] };
  assert.deepEqual(sheet([text]), [210, FRAME + TITLE + GAP + TEXT], 'the opening sits under the title as a note\'s text does, with no cue when it is all');
  assert.deepEqual(sheet([text, list]), [210, FRAME + TITLE + GAP + TEXT + CUE], 'a part after the first is counted by the cue, not drawn');
  assert.deepEqual(sheet([list, text]), [210, FRAME + TITLE + 10 + TEXT + 5 + TEXT + CUE], 'a list that comes first shows its entries under the title as on a list card');
  assert.deepEqual(sheet([{ kind: 'list', items: ['Tent', 'Stove', 'Lamp', 'Map'] }]), [210, FRAME + TITLE + 10 + 2 * TEXT + 5 + CUE], 'and as many as the face has room for, the cue saying there are more');
  assert.deepEqual(sheet([{ kind: 'heading', text: 'Camp' }, text, list], { title: 'A title that is long enough to take two lines of a card this wide' }), sheet([text, list]), 'the heading stands in for the item\'s title');
  assert.deepEqual(sheet([{ kind: 'picture', src: 'a.png' }, text]), sheet([text, list]), 'a picture is a part the cue counts, which the opened card shows');
  const figures = [{ label: 'Nights', value: '2' }, { label: 'Cost', value: '€240' }];
  assert.deepEqual(sheet([{ kind: 'figures', facts: figures }, text]), [210, COMPONENTS.facts!.size(blank, { facts: figures })[1]! + CUE], 'figures are laid out as on a facts card');
  assert.deepEqual(sheet([{ kind: 'table', heads: ['Wall', 'Length'], rows: [['North', '4.2 m'], ['East', '3.1 m']] }, text]), [210, FRAME + TITLE + GAP + META + 4 + META + CUE], 'a table shows its heads and the count of its rows');
  const passage = 'I would come back just for the sardines.';
  assert.deepEqual(sheet([{ kind: 'excerpt', text: passage, by: 'Ines' }]), [210, FRAME + TITLE + GAP + linesOf(passage, COLUMN - 14, 'passage') * TEXT + 4 + META], 'a passage stands over who said it');
  assert.deepEqual(sheet([{ kind: 'list', label: 'Best:', items: ['the bridge at dusk'] }]), [210, FRAME + TITLE + 10 + TEXT + GAP + TEXT], 'the item\'s own label of a part stands over it');
});

test('an excerpt whose source is its title writes it once', async () => {
  const { COMPONENTS } = (await load('components/index.js')) as { COMPONENTS: Record<string, Kind> };
  const excerpt = (source: string) => COMPONENTS.excerpt!.size({ ...blank, title: '鲁迅《故乡》' }, { text: '世界上本没有路，走的人多了，也便成了路。', source });
  assert.deepEqual(excerpt(' 鲁迅《故乡》 '), excerpt(''));
  assert.deepEqual(excerpt('example.org'), excerpt(''), 'a source that is not the title shares the one meta line under the passage');
});

test('an explorable shows the value its item states where the sliders stand on one, the formula\'s value marked computed anywhere else, and steps through a formula as the service does', async () => {
  type Result = { value: number | undefined; shown: string; computed: boolean };
  const client = (await load('components/explorable.js')) as {
    evaluate: (program: unknown[], values: Record<string, number>) => number | undefined;
    resultAt: (sliders: unknown[], output: unknown, at: Record<string, number>) => Result;
    written: (value: number, decimals: number, unit: string) => string;
  };
  const { evaluate, parse } = await import('../src/core/formula.ts');
  const slider = { kind: 'slider', name: 'f', label: 'focal length', unit: 'mm', min: 12, max: 300, step: 2, values: [24, 50, 200] };
  const output = { kind: 'chart', label: 'field of view', unit: '°', formula: [2, 18, 'f', '/', 'atan', '*', 57.2958, '*'], values: [73.7, 39.6, 10.3] };
  assert.deepEqual(client.resultAt([slider], output, { f: 50 }), { value: 39.6, shown: '39.6°', computed: false });
  assert.deepEqual(client.resultAt([slider], output, { f: 300 }), { value: client.evaluate(output.formula, { f: 300 }), shown: '6.9°', computed: true });
  assert.equal(client.resultAt([slider], { ...output, formula: [1, 'f', '/'] }, { f: 0 }).shown, '–', 'no value where the formula has none');
  assert.equal(client.written(12500.5, 1, 'mm'), '12,500.5 mm');
  assert.equal(client.written(45, 0, '%'), '45%');
  assert.equal(client.written(50, 0, '毫米'), '50毫米');

  const sources = ['2 * atan(18 / f) * 57.2958', '-f ^ 2 + min(f, 3, 1) - max(f, 2)', 'round(f / 3) + sqrt(f) - ln(f) * exp(1 / f)', '1 / (f - 4)', 'sqrt(4 - f)', '2 ^ 3 ^ f'];
  for (const source of sources) {
    const read = parse(source, ['f']);
    assert.ok('program' in read, source);
    for (const f of [-2, 0, 0.5, 1, 4, 7.25, 50]) assert.equal(client.evaluate(read.program, { f }), evaluate(read.program, { f }), `${source} at f = ${f}`);
  }
  assert.equal(client.evaluate([1, '+'], {}), undefined, 'a step short of its arguments has no value');
  assert.equal(client.evaluate([1, 'toString'], {}), undefined, 'a name that is no quantity has no value');
});
