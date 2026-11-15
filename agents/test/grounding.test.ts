import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grounding, type Piece } from '../src/core/grounding.ts';
import { structure } from '../src/core/roles/intake/describe.ts';
import { blank } from '../src/fake/model.ts';

const says = (text: string, claim: string) => grounding(text).says(claim);
const kept = (text: string, reply: Partial<ReturnType<typeof blank>>): Record<string, any> => structure({ ...blank(), ...reply }, text);
const entry = (text: string): Piece => ({ text, entry: true });
const loose = (text: string): Piece => ({ text, entry: false });
/** How the pieces read as the whole of the text under its title, or nothing. */
const shows = (text: string, pieces: Piece[], title = '') => grounding(text, { title }).shows([{ pieces }]);
/** The lines drawn over the pieces when they read as the whole text. */
const above = (text: string, pieces: Piece[], title = '') => shows(text, pieces, title)?.above;

test('a word is stated only as a whole word', () => {
  for (const [text, claim] of [
    ['A comparison of two plans.', 'Paris'],
    ['Anna Karenina was cited.', 'Ann'],
    ['I do not know.', 'no'],
    ['Packing: passport, charger.', 'pass'],
    ['A hundred pages.', 'red'],
    ['It is fearless.', 'fear'],
    ['Plan | Price', 'Pri'],
    ['We will discuss it.', 'U.S.'],
    ['They met in Lisbon.', 'T In'],
  ] as const) {
    assert.equal(says(text, claim), false, `"${claim}" in "${text}"`);
  }
  assert.equal(says('We flew from Paris to Lisbon.', 'paris'), true);
  assert.equal(says("We read Anna's notes.", 'Anna'), true);
});

test('several words are stated when they follow one another in the text, whatever the case, spacing, quotes and punctuation', () => {
  const text = 'For: no data races; one binary to ship; it’s “fearless” concurrency.\nAgainst: a steep learning curve.';
  assert.equal(says(text, 'No Data Races.'), true);
  assert.equal(says(text, '  one   binary\nto ship!'), true);
  assert.equal(says(text, 'it\'s "fearless" concurrency'), true);
  assert.equal(says(text, 'A steep learning-curve'), true);
  assert.equal(says(text, 'steep/learning curve'), true);
  assert.equal(says(text, 'no data race'), false);
  assert.equal(says(text, 'data no races'), false);
  assert.equal(says('It was a hundred-page report.', 'hundredpage'), false);
  assert.equal(says('It was a hundred-page report.', 'hundred page'), true);
});

test('a number is stated only as the whole number, with its sign, decimal point and thousands separators', () => {
  for (const [text, claim] of [
    ['Founded in 1950.', '5'],
    ['Budget: 1,200 euros.', '200'],
    ['Rent | 15', '1.5'],
    ['It scored 3.5 points.', '35'],
    ['Food | 5', '-5'],
    ['Scores were 1,2,3 in that order.', '12'],
    ['See page 14.', 'page 1'],
    ['Org | $1,200', '$20'],
    ['Call 555-0123 now.', '12'],
  ] as const) {
    assert.equal(says(text, claim), false, `"${claim}" in "${text}"`);
  }
  assert.equal(says('Budget: 1,200 euros.', '1200'), true);
  assert.equal(says('Budget: 1200 euros.', '1,200'), true);
  assert.equal(says('It fell to -5 overnight.', '-5'), true);
  assert.equal(says('Solo | $8 | 1', '$8'), true);
  assert.equal(says('We meet at 5pm.', '5 pm'), true);
  assert.equal(says('See pages 10-12.', '12'), true);
});

test('a number value is read in any grouping', () => {
  const text = grounding('Sales were 1,200 in May, 3.50 in June and -7 in July of 1950.');
  for (const value of [1200, 3.5, -7, 1950]) assert.equal(text.writes(value), true, String(value));
  for (const value of [200, 35, 7, 5, 195, 0, NaN]) assert.equal(text.writes(value), false, String(value));
  assert.equal(grounding('Scores were 1,2,3.').writes(12), false);
});

test('a claim with no letter or digit is stated only where the text holds it standing alone', () => {
  const text = 'It was an important hundred-page report. Brand colour #abcdef. Done ✓ and priced $$$ — maybe 🌍';
  for (const claim of ['???', '…', '!!!', '-', '#', '+++', '(!)', '', '   ']) assert.equal(says(text, claim), false, JSON.stringify(claim));
  for (const claim of ['✓', '$$$', '—', '🌍', ' ✓ ']) assert.equal(says(text, claim), true, claim);
  assert.equal(says('', '?'), false);
});

test('a script written without spaces is matched as a run of characters', () => {
  assert.equal(says('北京是中国的首都，人口2189万。', '北京'), true);
  assert.equal(says('北京是中国的首都，人口2189万。', '首都'), true);
  assert.equal(says('北京是中国的首都，人口2189万。', '2189万'), true);
  assert.equal(says('北京是中国的首都，人口2189万。', '上海'), false);
  assert.equal(says('北京是中国的首都，人口2189万。', '京国'), false);
  assert.equal(says('北京是中国的首都，人口2189万。', '189'), false);
  assert.equal(says('東京タワーへ行きました。', 'タワー'), true);
  assert.equal(says('我爱🌍', '🌍'), true);
  assert.equal(says('서울에서 만났다', '서울'), true);
  assert.equal(says('ไปเที่ยวกรุงเทพ', 'กรุงเทพ'), true);
});


test('a hex colour is stated only whole, with its "#"', () => {
  assert.equal(grounding('Ember #E4572E here').paints('#e4572e'), true);
  assert.equal(grounding('Paper is #fff.').paints(' #FFF '), true);
  for (const [text, hex] of [
    ['I had a coffee this morning', '#fee'],
    ['Glass #abcdef', '#abc'],
    ['Glass #abcdef', '#cde'],
    ['Call 555123 tomorrow', '#555'],
    ['Founded in 1950', '#195'],
    ['a #feet tag', '#fee'],
    ['Ember #E4572E', '#123456'],
  ] as const) {
    assert.equal(grounding(text).paints(hex), false, `${hex} in "${text}"`);
  }
});


test('the text and the claim are compared in one written form', () => {
  assert.equal(says('１９５８年３月、東京で開催。', '1958年3月'), true, 'full-width digits');
  assert.equal(says('1958年3月、東京で開催。', '１９５８年３月'), true);
  assert.equal(grounding('参加者は１,２００人。').writes(1200), true);
  assert.equal(says('Code 1９50 shipped.', '50'), false, 'a full-width digit does not split a number');
  assert.equal(says('We sat in the café Zoë all day.', 'café Zoë'), true, 'decomposed accents');
  assert.equal(says('We sat in the café all day.', 'café'), true);
  assert.equal(says('We sat in the café all day.', 'cafe'), false);
  assert.equal(says('ガ行のガーデン', 'ガーデン'), true, 'decomposed kana');
  assert.equal(says('한글.txt', '한글'), true, 'decomposed Hangul');
  assert.equal(says('The Lis​bon office and a compar­ison.', 'bon'), false, 'an invisible character splits no word');
  assert.equal(says('The Lis​bon office and a compar­ison.', 'comparison'), true);
});


test('a short claim does not cross a table cell, a list item, a table row or a CJK full stop', () => {
  for (const [text, claim] of [
    ['| City | State |\n| Paris | Texas |', 'Paris Texas'],
    ['City\tState\nParis\tTexas', 'Paris Texas'],
    ['City | State\nParis | Texas', 'State Paris'],
    ['- New\n- York\n- Boston', 'New York'],
    ['1. New\n2. York', 'New 2 York'],
    ['他去了北京。上海很热。', '北京上海'],
  ] as const) {
    assert.equal(says(text, claim), false, `"${claim}" in "${text}"`);
  }
  assert.equal(says('Then Dr. Smith spoke.', 'Dr Smith'), true, 'a Latin period is crossed');
  assert.equal(says('We stayed in New\nYork for a week.', 'New York'), true, 'and so is a line break inside a sentence');
  assert.equal(says('| City | State |\n| Paris | Texas |', 'Paris | Texas'), true);
});

test('a number is compared by value: leading zeros and trailing decimal zeros do not count', () => {
  assert.equal(says('Meet on March 03 at 9.', 'March 3'), true);
  assert.equal(says('Meet on March 3 at 9.', 'March 03'), true);
  assert.equal(says('Budget was 5.0 million.', '5 million'), true);
  assert.equal(says('Budget was 5 million.', '5.00 million'), true);
  const text = grounding('Budget was 5.0 million and 1,200.00 dollars.');
  assert.equal(text.writes(5_000_000), true);
  assert.equal(text.writes(1200), true);
  assert.equal(text.writes(200), false);
});

test('a dash before a number is its sign, and a dash between two numbers is a range', () => {
  for (const minus of ['-', '−', '–']) {
    const text = grounding(`Low of ${minus}5 tonight.`);
    assert.equal(text.writes(-5), true, minus);
    assert.equal(text.writes(5), false, minus);
    assert.equal(text.says('5'), false, minus);
  }
  for (const range of ['See pages 10-12.', 'See pages 10–12.', 'Trip on 12–15 March.']) {
    const text = grounding(range);
    assert.equal(text.writes(12), true, range);
    assert.equal(text.writes(-12), false, range);
    assert.equal(text.writes(-15), false, range);
  }
  assert.equal(grounding('Born 1958-03-01.').says('1958-03-01'), true);
});

test('a minus sign, a word that says one, brackets around money and a magnitude word are part of the number', () => {
  for (const [text, signed, bare] of [
    ['Sales growth: 2023 +8%, 2024 -3%.', '-3%', '3%'],
    ['To buy:\n-5 apples', '-5 apples', '5 apples'],
    ['Pages 5 -10 cover it.', '-10', '10'],
    ['这个季度增长率为负3%。', '负3%', '3%'],
    ['明天最低气温零下5度。', '零下5度', '5度'],
    ['It was minus 3 at dawn.', '-3', '3'],
    ['Revenue £4.2m, net income (£1.3m).', '(£1.3m)', '£1.3m'],
    ['Leeds has about 800 thousand people.', '800,000', '800'],
    ['A loss of (£250).', '-£250', '£250'],
  ] as const) {
    assert.equal(says(text, signed), true, `"${signed}" in "${text}"`);
    assert.equal(says(text, bare), false, `"${bare}" in "${text}"`);
  }
  assert.deepEqual([says('这个季度增长率为负3%。', '-3%'), says('It was minus 3 at dawn.', 'minus 3')], [true, true], 'either way of writing the sign');
  assert.deepEqual([says('Leeds has 800 thousand people.', '800k'), grounding('It drew 2 million views.').writes(2_000_000), says('It cost $5m.', '$5 million')], [true, true, true]);
  assert.equal(says('The vote (2019) was close.', '2019'), true, 'a year in brackets is no loss');
  assert.equal(says('It fell by 5 overnight.', '-5'), false);
});

test('digit groups joined by commas are read as thousands, as a list, or as both where the text leaves it open', () => {
  const million = grounding('Budget: 1,200,000 euros.');
  assert.equal(million.writes(1200000), true);
  for (const part of [1, 200, 0, 1200]) assert.equal(million.writes(part), false, String(part));

  const open = grounding('Values: 100,200,300');
  for (const value of [100200300, 100, 200, 300]) assert.equal(open.writes(value), true, String(value));
  assert.equal(open.writes(100200), false);

  const row = grounding('Sales: Q1,120,340,560');
  for (const value of [120, 340, 560]) assert.equal(row.writes(value), true, String(value));
  assert.equal(row.writes(1120340560), false, 'the 1 of "Q1" opens no number');
  for (const value of [128, 256, 512]) assert.equal(grounding('Sizes: 128,256,512 GB.').writes(value), true, String(value));
  assert.equal(says('Sizes: 128,256,512 GB.', '512 GB'), true);

  const csv = grounding('Year,Sales,Costs\n2021,100,200\n2022,150,250');
  for (const value of [2021, 100, 200, 2022, 150, 250]) assert.equal(csv.writes(value), true, String(value));
  assert.equal(csv.writes(100200), false, 'a list holds no thousands');
  assert.equal(csv.says('2021, 100'), true);
  for (const room of ['101', '102', '103']) assert.equal(says('Rooms 101,102,103 are booked.', room), true, room);
});

test('a decimal comma, a space between thousands and dotted thousands are read as the number meant', () => {
  const comma = grounding('Länge: 1,5 km.');
  assert.equal(comma.writes(1.5), true);
  assert.equal(comma.says('1.5 km'), true);
  assert.equal(comma.writes(15), false);

  const spaced = grounding('Prix: 1 200 euros.');
  assert.equal(spaced.writes(1200), true);
  assert.equal(spaced.writes(200), false);
  assert.equal(spaced.writes(1), false);
  assert.equal(grounding('Prix: 1 200 euros.').writes(1200), true, 'a no-break space');
  const columns = grounding('2022 15 250');
  for (const value of [2022, 15, 250]) assert.equal(columns.writes(value), true, String(value));
  assert.equal(columns.writes(15250), false, 'a row of numbers is not one number');
  assert.equal(grounding('Rated 1.0 200 times.').writes(200), true, 'a decimal opens no thousands');

  const dotted = grounding('Preis: 1.200,50 Euro.');
  assert.equal(dotted.writes(1200.5), true);
  assert.equal(dotted.writes(1.2), false);
  assert.equal(dotted.writes(50), false);
});

test('three or more dotted groups are one token that states itself and each group, and no decimal between two of them', () => {
  const date = grounding('Opened 2024.03.15 in Seoul.');
  assert.equal(date.says('2024.03.15'), true);
  assert.equal(date.says('2024'), true);
  for (const value of [2024, 3, 15]) assert.equal(date.writes(value), true, String(value));
  assert.equal(date.writes(2024.03), false);
  assert.equal(date.says('2024.03'), false);
  assert.equal(date.says('2024.03.16'), false);
  const host = grounding('Host 192.168.1.1 is up, on v1.2.3.');
  assert.equal(host.says('192.168.1.1'), true);
  for (const value of [192.168, 1.1, 1.2, 2.3]) assert.equal(host.writes(value), false, String(value));
  assert.equal(says('Opened 15.03.2024 in Berlin.', '15.03.2024'), true);
});

test('a magnitude glued to digits makes one number that states the expanded value and not the bare digits', () => {
  for (const [text, value, bare] of [
    ['We have 5k users.', 5000, 5],
    ['销量3万台。', 30000, 3],
    ['人口2亿。', 200000000, 2],
    ['共4千人。', 4000, 4],
    ['It drew 1.5M views.', 1500000, 1.5],
    ['Worth 2bn today.', 2000000000, 2],
    ['Sold 1.1k copies.', 1100, 1.1],
  ] as const) {
    assert.equal(grounding(text).writes(value), true, text);
    assert.equal(grounding(text).writes(bare), false, text);
  }
  assert.equal(says('销量3万台。', '3万台'), true);
  assert.equal(says('销量3万台。', '3 万台'), true);
  assert.equal(says('We have 5k users.', '5,000 users'), true);
  assert.equal(says('We have 5,000 users.', '5k users'), true);
  assert.equal(grounding('The trail is 5km long, done by 5pm.').writes(5), true);
  assert.equal(says('The trail is 5km long.', '5 km'), true);
});

test('a currency sign, a percent sign or a comparator on a claim number must be on the number in the text, or said in words', () => {
  for (const [text, claim] of [
    ['It costs 5 apples.', '$5'],
    ['It costs €5.', '$5'],
    ['There were 100 people.', '100%'],
    ['Score: under 5.', '>5'],
    ['Score: 5.', '>5'],
    ['Score: over 5.', '<5'],
  ] as const) {
    assert.equal(says(text, claim), false, `"${claim}" in "${text}"`);
  }
  for (const [text, claim] of [
    ['It costs $5.', '$5'],
    ['It costs $5.', '5'],
    ['It costs 5 dollars.', '$5'],
    ['Budget: 1,200 euros in 2024.', '€1,200'],
    ['Budget: EUR 1,200 in 2024.', '€1200'],
    ['酒店800元。', '¥800'],
    ['All 100% of it.', '100%'],
    ['All 100 % of it.', '100%'],
    ['All 100 percent of it.', '100%'],
    ['All 100 per cent of it.', '100 %'],
    ['Score: >5.', '>5'],
    ['Score: > 5.', '>5'],
    ['Score: more than 5.', '>5'],
    ['Score: under 5.', '<5'],
    ['Score: at least 5.', '>=5'],
    ['Score: ≤5.', '<=5'],
    ['超过5人。', '>5'],
  ] as const) {
    assert.equal(says(text, claim), true, `"${claim}" in "${text}"`);
  }
});

test('a possessive states its noun, and an apostrophe inside a word keeps it one word', () => {
  assert.equal(says("Anna's plan won.", 'Anna'), true);
  assert.equal(says('Anna’s plan won.', "Anna's plan"), true);
  assert.equal(says("I don't know, it isn't far.", 'Don'), false);
  assert.equal(says("I don't know.", 'don’t know'), true);
  assert.equal(says("Met O'Brien at noon.", 'Brien'), false);
  assert.equal(says("Met O'Brien at noon.", 'O'), false);
  assert.equal(says('Met Tom O’Brien at noon.', "Tom O'Brien"), true);
});

test('a symbol that carries meaning is part of the claim', () => {
  for (const [text, claim] of [
    ['A comparison of options.', 'A+'],
    ['We wrote it in C.', 'C++'],
    ['We wrote it in C.', 'C#'],
    ['We wrote it in C++.', 'C+'],
    ['pages 1-2', '1/2'],
    ['Due 3/15/2024.', '3/15'],
  ] as const) {
    assert.equal(says(text, claim), false, `"${claim}" in "${text}"`);
  }
  assert.equal(says('She got an A+ in maths.', 'A+'), true);
  assert.equal(says('We wrote it in C++, then C#.', 'C++'), true);
  assert.equal(says('We wrote it in C++, then C#.', 'c#'), true);
  assert.equal(says('Add 1/2 cup of milk.', '1/2 cup'), true);
  assert.equal(says('Due 3/15/2024.', '3/15/2024'), true);
  assert.equal(says('Due 3/15/2024.', '2024'), true);
  assert.equal(says('A steep learning curve.', 'steep/learning curve'), true, 'a slash between words is punctuation');
});

test('a table leaves a head empty where the text does, and a dash the text does not write is an empty cell', () => {
  const rows = [['North', '10', '12'], ['South', '7', '9']];
  const said = { tableHeads: ['', 'Q1', 'Q2'], tableRows: ['North | 10 | 12', 'South | 7 | 9'] };
  assert.deepEqual(kept('| | Q1 | Q2 |\n|---|---|---|\n| North | 10 | 12 |\n| South | 7 | 9 |', said).table, { heads: ['', 'Q1', 'Q2'], rows });
  assert.deepEqual(kept('\tQ1\tQ2\nNorth\t10\t12\nSouth\t7\t9', said).table, { heads: ['', 'Q1', 'Q2'], rows });
  assert.deepEqual(kept('Plan\tPrice\t\nSolo\t$8\t1', { tableHeads: ['Plan', 'Price', ''], tableRows: ['Solo | $8 | 1'] }).table?.heads, ['Plan', 'Price', ''], 'a head the text leaves empty');
  assert.equal(kept('Plan\tPrice\tSeats\nSolo\t$8\t1', { tableHeads: ['Plan', 'Price', ''], tableRows: ['Solo | $8 | 1'] }).table, undefined, 'and none it writes');

  const text = 'Plan\tPrice\tSeats\nPro\t$1,200\t\nTeam Plus\t\t10';
  for (const dash of ['-', '–', '—']) {
    assert.deepEqual(kept(text, { tableHeads: ['Plan', 'Price', 'Seats'], tableRows: [`Pro | $1,200 | ${dash}`, `Team Plus | ${dash} | 10`] }).table?.rows, [['Pro', '$1,200', ''], ['Team Plus', '', '10']], dash);
  }
  assert.deepEqual(kept('Camera | Price\nQ2 | —', { tableHeads: ['Camera', 'Price'], tableRows: ['Q2 | —'] }).table?.rows, [['Q2', '—']], 'a dash the text writes is kept');
  assert.deepEqual(kept('| City | Founded |\n| St. Petersburg | 1703 |', { tableHeads: ['City', 'Founded'], tableRows: ['St Petersburg | 1703'] }).table?.rows, [['St Petersburg', '1703']]);
  assert.equal(kept('| City | State |\n| Paris | Texas |', { tableHeads: ['City', 'State'], tableRows: ['Paris Texas | Texas'] }).table, undefined, 'a cell does not span two cells');
});

test('a hex colour of three, four, six or eight digits is kept', () => {
  const said = { colours: ['#fff', '#ABCD', '#e4572e', '#11223344', '#abcde'].map((value) => ({ name: '', value })) };
  assert.deepEqual(kept('Palette: #FFF, #abcd, #E4572E, #11223344, #abcde.', said).colours?.map((colour: { value: string }) => colour.value), ['#fff', '#ABCD', '#e4572e', '#11223344']);
  assert.equal(kept('Brand #abcd.', { colours: [{ name: '', value: '#abc' }] }).colours, undefined);
});

test('an empty text states nothing', () => {
  const text = grounding('');
  assert.equal(text.says('anything'), false);
  assert.equal(text.shows([{ pieces: [{ text: 'anything', entry: true }] }]), undefined);
  assert.equal(text.writes(0), false);
  assert.equal(text.paints('#fff'), false);
});

test('a tab in a line of prose is white space, and a cell break to a short claim only where lines side by side part cells with it', () => {
  const said = 'The   best  camera\tis the one you have with you, people say.';
  assert.ok(shows(said, [entry('The best camera is the one you have with you, people say.')]));
  assert.equal(shows(said, [entry('The best camera is the one you have with you')]), undefined);
  assert.equal(says('Name\tAge\nAnna\t30', 'Age Anna'), false, 'a pasted table');
  assert.ok(shows('Name\tAge\nAnna\t30', ['Name', 'Age', 'Anna', '30'].map(entry)));
});

test('a degree sign on a claim number must be on the number in the text', () => {
  assert.equal(says('Oslo 5°, Rome 12° at noon.', '12°'), true);
  assert.equal(says('It boils at 100 °C.', '100°C'), true);
  assert.equal(says('Oslo 5, Rome 12 at noon.', '12°'), false);
});

test('a number is measured in a unit when the text sets the unit against it', () => {
  for (const [text, value, unit] of [
    ['Rent 45%, food 25%.', 45, '%'],
    ['Rent 45 %, food 25 %.', 25, '%'],
    ['Basic €5, pro €19 a month.', 19, '€'],
    ['Revenue was $120k in Q1.', 120, 'k'],
    ['Revenue was $120k in Q1.', 120, '$k'],
    ['Oslo 5°, Rome 12°.', 5, '°'],
    ['北京2189万，上海2487万。', 2189, '万'],
    ['北京２１８９万，上海2487万。', 2189, '万'],
    ['产值3亿，利润2千。', 3, '亿'],
    ['It drew 1.5M views and is worth 2bn.', 1.5, 'M'],
    ['It drew 1.5M views and is worth 2bn.', 2, 'bn'],
    ['We found 12 films in 2019.', 12, 'films'],
    ['Sales were 1,200 units in May.', 1200, 'units'],
  ] as const) {
    assert.equal(grounding(text).measures(value, unit), true, `${value} ${unit} in "${text}"`);
  }
  for (const [text, value, unit] of [
    ['Rent 45, food 25.', 45, '%'],
    ['Rent 45%, food 25.', 25, '%'],
    ['Basic $5, pro $19 a month.', 19, '€'],
    ['Revenue was $120 in Q1.', 120, 'k'],
    ['Revenue was €120k in Q1.', 120, '$k'],
    ['北京2189人，上海2487万。', 2189, '万'],
    ['北京2189万。', 189, '万'],
    ['We found 12 dogs and some films.', 12, 'films'],
    ['Rent 45%.', 45, ' '],
  ] as const) {
    assert.equal(grounding(text).measures(value, unit), false, `${value} ${unit} in "${text}"`);
  }
});

test('a number counted in a unit that scales it is written only with that unit against it', () => {
  const cities = grounding('北京2189万，上海2487万，深圳1756人。');
  assert.equal(cities.writes(2189, '万'), true);
  assert.equal(cities.writes(2189), false);
  assert.equal(cities.writes(1756, '万'), false, 'a number the text writes bare is not that many 万');
  assert.equal(cities.writes(2189, '亿'), false);
  assert.equal(cities.writes(1756, '人'), true, 'a unit that scales nothing asks only for the number');
  const revenue = grounding('Revenue was $120k in Q1, $1.5M in Q2 and $90 in Q3.');
  assert.deepEqual([revenue.writes(120, 'k'), revenue.writes(1.5, 'M'), revenue.writes(90, 'k'), revenue.writes(90, '$'), revenue.writes(120)], [true, true, false, true, false]);
  assert.deepEqual([revenue.writes(120, '$k'), revenue.writes(90, '$k'), revenue.writes(120, '€k')], [true, false, false], 'a currency sign may lead the unit');
});


test('a card shows its whole item: every word and mark of the text, in its order, and nothing else', () => {
  const ducks = 'Feed them oats.\nScatter food on the bank.\nNever throw bread.';
  assert.ok(shows(ducks, ['Feed them oats.', 'Scatter food on the bank.', 'Never throw bread.'].map(entry)));
  assert.equal(shows(ducks, ['Feed them oats.', 'Scatter food on the bank.'].map(entry)), undefined, 'a line left out');
  assert.equal(shows(ducks, ['Scatter food on the bank.', 'Feed them oats.', 'Never throw bread.'].map(entry)), undefined, 'lines out of order');
  assert.equal(shows(ducks, ['Feed them oats.', 'Scatter food on the bank.', 'throw bread.'].map(entry)), undefined, 'a line cut');
  assert.equal(shows(ducks, ['Feed them oats.', 'Scatter food on the bank.', 'Never throw bread.', 'Ask a ranger.'].map(entry)), undefined, 'a line added');
  assert.ok(shows('Take two tablets. Rest for a day.', ['Take two tablets.', 'Rest for a day.'].map(entry)), 'sentences of one line are entries of their own');
  assert.equal(shows('Take two tablets. Rest for a day.', ['Take two', 'tablets. Rest for a day.'].map(entry)), undefined, 'an entry begins and ends where a sentence does');
  assert.ok(shows('Height: 330 m', [loose('Height'), loose('330 m')]), 'a loose piece, such as a label, need not');
});

test('the headings, labels and opening prose over the structure are drawn above it, and nothing that stands after any of it', () => {
  assert.deepEqual(above("Pregnancy food\nDon't:\n- Eat raw eggs.\n- Eat liver pâté.", ['Eat raw eggs.', 'Eat liver pâté.'].map(entry), 'Pregnancy food'), ["Don't:"], 'the title is drawn as the title');
  assert.deepEqual(above('## Things to avoid\n### In the kitchen\n- Leave oil on the hob.', [entry('Leave oil on the hob.')]), ['Things to avoid', 'In the kitchen']);
  assert.deepEqual(above('Everything below is wrong.\n\nPut butter on a burn.\n\nMake them sick.', ['Put butter on a burn.', 'Make them sick.'].map(entry)), ['Everything below is wrong.']);
  assert.deepEqual(above('Results: the drug does not work in children.', [entry('the drug does not work in children.')]), ['Results:']);
  assert.equal(shows('## Dosing\nGive 10 ml.\n## Correction\nThe dose above is wrong.', [entry('Give 10 ml.')]), undefined, 'a correction after the structure is no line over it');
  assert.equal(shows('Advice:\n- Sleep babies on their front.\nUpdate:\nWithdrawn in 1991.', [entry('Sleep babies on their front.')]), undefined);
  const lead = `${'A sentence that opens the item and runs on. '.repeat(7)}\n- one\n- two`;
  assert.equal(shows(lead, ['one', 'two'].map(entry)), undefined, 'opening prose past its room is no line over a card');
  assert.deepEqual(above(lead.slice(0, 135) + '\n- one\n- two', ['one', 'two'].map(entry))?.length, 1);
});

test('lines a card already carries over it are read as they are, and only those', () => {
  const text = 'Avoid:\n- Raw oysters\n- Liver pâté';
  const pieces = ['Raw oysters', 'Liver pâté'].map(entry);
  assert.ok(grounding(text).shows([{ pieces }], ['Avoid:']));
  assert.equal(grounding(text).shows([{ pieces }], []), undefined, 'none, where the item has a heading over the list');
  assert.equal(grounding(text).shows([{ pieces }], ['Allowed:']), undefined);
});

test('every mark is a word of its line: ticks, crosses, arrows, signs, brackets, a question mark and quotation marks inside a piece', () => {
  const vaccine = 'Storing the vaccine\n✗ Keep it in the freezer.\n✓ Keep it in the fridge.';
  assert.equal(shows(vaccine, ['Keep it in the freezer.', 'Keep it in the fridge.'].map(entry), 'Storing the vaccine'), undefined, 'a cross left off');
  assert.ok(shows(vaccine, ['✗ Keep it in the freezer.', '✓ Keep it in the fridge.'].map(entry), 'Storing the vaccine'));
  assert.equal(shows('| Metric | Change |\n|---|---|\n| Revenue | ▼ 12% |', ['Metric', 'Change', 'Revenue', '12%'].map(entry)), undefined);
  assert.equal(shows('Net income | (1,234)', [loose('Net income'), loose('1,234')]), undefined);
  assert.ok(shows('Net income | (1,234)', [loose('Net income'), loose('(1234)')]), 'thousands written either way');
  assert.equal(shows('Margin: -3%', [loose('Margin'), loose('3%')]), undefined);
  assert.equal(shows('Ibuprofen is safe in pregnancy?', [entry('Ibuprofen is safe in pregnancy.')]), undefined);
  assert.equal(shows('Doctors call this a "safe" dose.', [entry('Doctors call this a safe dose.')]), undefined, 'scare quotes');
  assert.ok(shows('"Stay hungry, stay foolish." Steve Jobs', [loose('Stay hungry, stay foolish.'), loose('Steve Jobs')]), 'quotation marks around a piece are its card\'s to draw');
  assert.ok(shows('A: I think we should sell.\nB: Absolutely not.', ['A: I think we should sell.', 'B: Absolutely not.'].map(entry)));
  assert.equal(shows('A: I think we should sell.\nB: Absolutely not.', ['I think we should sell.', 'Absolutely not.'].map(entry)), undefined, 'a speaker\'s mark stays on its line');
});

test('a check box is no word: it is read off its line for a checklist, and a tick or a cross written on a line is no check box', () => {
  assert.deepEqual(shows('[x] Tent\n[ ] Head torch', ['Tent', 'Head torch'].map(entry))?.boxes, [true, false]);
  assert.deepEqual(shows('- Tent\n- Head torch', ['Tent', 'Head torch'].map(entry))?.boxes, [undefined, undefined]);
  assert.deepEqual(shows('✓ Tent\n✗ Head torch', ['✓ Tent', '✗ Head torch'].map(entry))?.boxes, [undefined, undefined]);
});

test('a table is every row and cell as written, a cell bound to its row, and a grid of two columns may stand without its heads row', () => {
  const table = '| Medicine | In pregnancy |\n|---|---|\n| Ibuprofen | Avoid after 20 weeks |\n| Paracetamol | Safe |';
  assert.deepEqual(shows(table, ['Medicine', 'In pregnancy', 'Ibuprofen', 'Avoid after 20 weeks', 'Paracetamol', 'Safe'].map(entry))?.rows, [2, 2, 2]);
  assert.equal(shows(table, ['Medicine', 'In pregnancy', 'Ibuprofen', 'Safe', 'Paracetamol', 'Avoid after 20 weeks'].map(entry)), undefined, 'rows rewired');
  assert.equal(shows(table, ['Medicine', 'In pregnancy', 'Ibuprofen Avoid', 'after 20 weeks', 'Paracetamol', 'Safe'].map(entry)), undefined, 'a cell moved');
  const grid = grounding(table).shows([{ pieces: ['Ibuprofen', 'Avoid after 20 weeks', 'Paracetamol', 'Safe'].map(loose), headless: true }]);
  assert.deepEqual(grid?.heads, ['Medicine', 'In pregnancy']);
  assert.ok(shows('Drug\tIn pregnancy\nIbuprofen\tAvoid', ['Drug', 'In pregnancy', 'Ibuprofen', 'Avoid'].map(entry)), 'a pasted tab table');
  assert.ok(shows('country,gdp\nNorway,87900\nKenya,2100', ['country', 'gdp', 'Norway', '87900', 'Kenya', '2100'].map(entry)), 'comma-separated rows');
  assert.equal(grounding('光圈开大还是收小，决定了照片里有多少是清楚的。\n大光圈：背景虚化。\n小光圈：快门要放慢。').shows([{ pieces: [entry('大光圈：背景虚化。')] }])?.rows, undefined, 'a full-width comma parts no cells');
});

test('a slot stands on one heading or label of the item and reads what it says', () => {
  const sides = grounding('For going now:\n- Locks in 4.19%\nAgainst:\n- A fee of £2,100').shows([{ pieces: [{ slot: 'heading' }, entry('Locks in 4.19%'), { slot: 'heading' }, entry('A fee of £2,100')] }]);
  assert.deepEqual(sides?.slots, ['For going now:', 'Against:']);
  assert.equal(grounding('Pros\nFast and cheap.').shows([{ pieces: [{ slot: 'label' }, entry('Fast and cheap.')] }]), undefined, 'a heading line is no label of a line');
  assert.ok(grounding('Parallax: the shift of an object.').shows([{ pieces: [{ slot: 'label', says: 'Parallax' }, entry('the shift of an object.')] }]));
  assert.equal(grounding('Weather: the shift of an object.').shows([{ pieces: [{ slot: 'label', says: 'Parallax' }, entry('the shift of an object.')] }]), undefined);
});

test('a conversation\'s speakers label nothing, and a line that asks heads the answer after it', () => {
  const talk = 'Mum: Has anyone seen the photo?\nBen: It is in the blue album.\nMum: I looked.';
  assert.equal(shows(talk, ['It is in the blue album.', 'I looked.'].map(entry)), undefined);
  assert.deepEqual(above('Can I freeze rice?\n\nYes, within an hour.', [entry('Yes, within an hour.')]), ['Can I freeze rice?']);
});

test('words are set apart only when they are whole sentences, lines or cells, and the count is how far into the text they end', () => {
  const text = grounding('Bath time rules\nDo not:\nLeave a child alone in the bath.\nTest the water first.');
  assert.ok(text.units('Leave a child alone in the bath.')! < text.units('Test the water first.')!);
  assert.equal(text.units('a child alone'), undefined);
  assert.equal(grounding('Honey is not safe for babies.').units('safe for babies'), undefined);
});
