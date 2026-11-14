import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grounding } from '../src/core/grounding.ts';
import { structure } from '../src/core/roles/intake/describe.ts';
import { blank } from '../src/fake/model.ts';

const says = (text: string, claim: string) => grounding(text).says(claim);
const quotes = (text: string, passage: string) => grounding(text).quotes(passage);
const kept = (text: string, reply: Partial<ReturnType<typeof blank>>): Record<string, any> => structure({ ...blank(), ...reply }, text);

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

test('a passage is one stretch of the text: it cannot be stitched across a sentence end, a table row or a table cell', () => {
  const text = grounding('Air scatters short blue wavelengths more than long red ones.\nRayleigh scattering: scattering of light. Dr. Ito agrees, mostly.\nPlan | Price | Seats\nBasic | 5 | 1');
  assert.equal(text.quotes('red ones Rayleigh scattering'), false);
  assert.equal(text.quotes('scattering of light Dr'), false);
  assert.equal(text.quotes('Price Seats'), false);
  assert.equal(text.quotes('Seats Basic'), false);
  assert.equal(text.says('red ones Rayleigh scattering'), true, 'plain words may run over the break');

  assert.equal(text.quotes('short blue wavelengths more than long red ones'), true);
  assert.equal(text.quotes('Rayleigh scattering: scattering of light'), true);
  assert.equal(text.quotes('Ito agrees mostly'), true, 'a comma is not a break');
  assert.equal(text.quotes('scattering of light. Dr. Ito agrees'), true, 'a passage that keeps the sentence end is the text as written');
  assert.equal(text.quotes('long red ones.\nRayleigh scattering'), true);
  assert.equal(text.quotes('Every stair keeps the weight'), false);
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

test('a check mark is read off the line that holds the words', () => {
  const text = grounding('Packing:\n- [x] passport\n- [ ] phone charger\n☑ tent\n☐ stove\nmap ✓\nrain coat\n✔ **boots**');
  assert.equal(text.ticks('passport'), true);
  assert.equal(text.ticks('phone charger'), false);
  assert.equal(text.ticks('tent'), true);
  assert.equal(text.ticks('stove'), false);
  assert.equal(text.ticks('map'), true);
  assert.equal(text.ticks('boots'), true);
  assert.equal(text.ticks('rain coat'), undefined, 'the mark on the line above is not this line\'s');
  assert.equal(text.ticks('umbrella'), undefined);
  assert.equal(grounding('Bring: tent, stove, map.').ticks('tent'), undefined);
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
  assert.equal(grounding('帐篷 ✔️\n炉子 ☐').ticks('帐篷'), true, 'a variation selector is no part of a mark');
});

test('a line break inside a sentence is white space to a passage', () => {
  assert.equal(quotes('"The only way to do great work\nis to love what you do."\n— Steve Jobs', 'The only way to do great work is to love what you do.'), true);
  assert.equal(quotes('他说：我们无法在截止日期之\n前达成一致，所以工作停止了。', '我们无法在截止日期之前达成一致'), true);
  assert.equal(quotes('Line one of the poem\nLine two of the poem', 'Line one of the poem / Line two of the poem'), true);
  assert.equal(quotes('Chapter 3\n\nThe eye is not a camera. It does not record;\nit selects.', 'The eye is not a camera. It does not record; it selects.'), true);
});

test('a passage does not cross a sentence end, an empty line, a table cell, or the start of a list item or table row', () => {
  for (const [text, passage] of [
    ['It was red. Ones were blue.', 'was red ones were'],
    ['A heading\n\nThe first line', 'heading the first'],
    ['Plan | Price', 'Plan Price'],
    ['Name\tAge\nAnna\t30', 'Age Anna'],
    ['- red apples\n- green pears', 'apples green'],
    ['* red apples\n* green pears', 'apples green'],
    ['• red apples\n• green pears', 'apples green'],
    ['1. red apples\n2. green pears', 'apples 2 green'],
    ['[x] red apples\n[ ] green pears', 'apples green'],
    ['☑ red apples\n☐ green pears', 'apples green'],
    ['| red apples |\n| green pears |', 'apples green'],
    ['他去了北京。上海很热。', '北京上海'],
    ['太好了！我们走吧', '好了我们'],
  ] as const) {
    assert.equal(quotes(text, passage), false, `"${passage}" in "${text}"`);
  }
  assert.equal(quotes('It was red. Ones were blue.', 'It was red. Ones were blue.'), true, 'a passage that carries the break may cross it');
  assert.equal(quotes('- red apples\n- green pears', 'red apples\n- green pears'), true);
  assert.equal(quotes('他去了北京。上海很热。', '北京。上海'), true);
  assert.equal(quotes('\tAn indented line that runs\n\tover two lines.', 'runs over two lines'), true, 'a tab that indents a line starts no cell');
});

test('the period of an abbreviation ends no sentence', () => {
  assert.equal(quotes('Then Dr. Smith said the plan was fine.', 'Dr Smith said the plan was fine'), true);
  assert.equal(quotes('It weighs approx. 5 kg and that is fine.', 'approx 5 kg and that is fine'), true);
  assert.equal(quotes('We flew to St. Petersburg in May.', 'flew to St Petersburg in May'), true);
  assert.equal(quotes('The U.S. office is closed.', 'The US office is closed'), true);
  assert.equal(says('Lead: Anna (U.S. office).', 'US office'), true);
  assert.equal(says('Lead: Anna (US office).', 'U.S. office'), true);
  assert.equal(quotes('Signed J. K. Rowling in ink.', 'J K Rowling in ink'), true);
  assert.equal(quotes('We met at 3 p.m. in the hall.', 'at 3 pm in the hall'), true);
  assert.equal(quotes('The plan was fine. Smith said so.', 'fine Smith said'), false);
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
  assert.equal(text.writes(5), true);
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

test('a dash that may be a sign, a bullet or a range states both readings', () => {
  const range = grounding('Pages 5 -10 cover it.');
  assert.equal(range.writes(10), true);
  assert.equal(range.writes(-10), true);
  const bullets = grounding('To buy:\n-5 apples\n-3 pears');
  assert.equal(bullets.says('5 apples'), true);
  assert.equal(bullets.says('-3 pears'), true);
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

test('a check mark belongs to the line whose whole text is the item', () => {
  const longerFirst = grounding('- [x] milk chocolate\n- [ ] milk');
  assert.equal(longerFirst.ticks('milk chocolate'), true);
  assert.equal(longerFirst.ticks('milk'), false);
  const shorterLast = grounding('[ ] Buy milk chocolate\n[x] Buy milk');
  assert.equal(shorterLast.ticks('Buy milk chocolate'), false);
  assert.equal(shorterLast.ticks('Buy milk'), true);
  assert.equal(grounding('[x] tent pegs\n[ ] stove\ntent').ticks('tent'), undefined, 'a plain line takes no mark from a longer one');
  assert.equal(grounding('[x] tent, stove, map').ticks('tent'), undefined);
  assert.equal(grounding('tent [x] stove [ ] map').ticks('stove'), undefined);

  assert.deepEqual(kept('- [x] milk chocolate\n- [ ] milk', { items: ['milk chocolate', 'milk'], checklist: [false, true] }).checklist, [true, false]);
  assert.deepEqual(kept('[x] tent pegs\n[ ] stove\ntent', { items: ['tent', 'stove'], checklist: [true, false] }), { items: ['tent', 'stove'] });
});

test('every usual way to write a check mark is read, before the item, after it, or in the next table cell', () => {
  for (const done of ['✔', '✓', '☑', '[x]', '[X]', '✅']) {
    assert.equal(grounding(`${done} tent\nstove`).ticks('tent'), true, done);
    assert.equal(grounding(`tent ${done}`).ticks('tent'), true, `${done} after`);
  }
  for (const open of ['☐', '[ ]', '[]', '✗', '✘', '☒', '❌']) {
    assert.equal(grounding(`${open} tent\nstove`).ticks('tent'), false, open);
    assert.equal(grounding(`tent ${open}`).ticks('tent'), false, `${open} after`);
  }
  const table = grounding('| tent | ✓ |\n| stove | ☐ |\n| map | 2 |');
  assert.equal(table.ticks('tent'), true);
  assert.equal(table.ticks('stove'), false);
  assert.equal(table.ticks('map'), undefined);
  const numbered = grounding('1. [x] tent\n2. [ ] **stove**');
  assert.equal(numbered.ticks('tent'), true);
  assert.equal(numbered.ticks('stove'), false);
});

test('a table may leave its first head empty, and a dash the text does not write is an empty cell', () => {
  const rows = [['North', '10', '12'], ['South', '7', '9']];
  const said = { tableHeads: ['', 'Q1', 'Q2'], tableRows: ['North | 10 | 12', 'South | 7 | 9'] };
  assert.deepEqual(kept('| | Q1 | Q2 |\n|---|---|---|\n| North | 10 | 12 |\n| South | 7 | 9 |', said).table, { heads: ['', 'Q1', 'Q2'], rows });
  assert.deepEqual(kept('\tQ1\tQ2\nNorth\t10\t12\nSouth\t7\t9', said).table, { heads: ['', 'Q1', 'Q2'], rows });
  assert.equal(kept('Plan\tPrice\t\nSolo\t$8\t1', { tableHeads: ['Plan', 'Price', ''], tableRows: ['Solo | $8 | 1'] }).table, undefined, 'only the first head');

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
  assert.equal(text.quotes('anything'), false);
  assert.equal(text.writes(0), false);
  assert.equal(text.paints('#fff'), false);
});

test('a tab inside a line is white space to a passage and a cell break to a short claim', () => {
  const said = 'The   best  camera\tis the one you have with you, people say.';
  assert.equal(quotes(said, 'The best camera is the one you have with you'), true);
  assert.equal(says(said, 'best camera is the one'), false);
  assert.equal(quotes('Plan | Price', 'Plan Price'), false, 'a "|" still parts two cells');
  assert.equal(quotes('Stay hungry.\n\nStay foolish.', 'Stay hungry. Stay foolish.'), false, 'and an empty line still ends a passage');
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

test('a label names a value when its words stand on the line, in the sentence or in the table row that holds the value', () => {
  const study = grounding('First-period absences fell by 15%. The share of students who fell asleep in class at least once a week dropped from 31% to 19%.');
  assert.equal(study.names('first-period absences', '15%'), true);
  assert.equal(study.names('absences, first period', '15%'), true, 'the words in any order');
  assert.equal(study.names('students asleep in class', '15%'), false, 'words of the next sentence');
  assert.equal(study.names('fell asleep in class', '31%'), true);
  assert.equal(study.names('absent students', '15%'), false, 'a word the sentence does not hold, however close');
  assert.equal(study.names('absences', '51%'), false, 'a value the text does not state');
  assert.equal(study.names('', '15%'), false);
  assert.equal(study.names('%', '15%'), false, 'a label of no word');

  const rows = grounding('Budget\n\n| 房租 | 45% |\n| 吃饭 | 5% |\n\n- Rent: 980 euros. Paid on the first.\n- Food: 240 euros.');
  assert.deepEqual([rows.names('房租', 45, '%'), rows.names('房租', 5, '%'), rows.names('吃饭', 5, '%')], [true, false, true], 'a share belongs to its row');
  assert.deepEqual([rows.names('Rent', '980 euros'), rows.names('Food', '980 euros'), rows.names('Rent, paid on the first', '980 euros')], [true, false, true], 'a list item is one line, whatever sentences it holds');
  assert.equal(rows.names('Budget', '45%'), false, 'the title is a paragraph of its own');

  const plans = grounding('Our plans.\n\nPlan | Price | Seats\nSolo | $8 | 1\nOrg | $1,200 | 100\n\n| | Jan | Feb |\n| Rain | 81 | 60 |');
  assert.deepEqual([plans.names('Price', '$1,200'), plans.names('Seats', 100), plans.names('Seats', '$1,200'), plans.names('Solo', '$1,200')], [true, true, false, false], 'the head of a column names the values under it');
  assert.deepEqual([plans.names('Jan', 81), plans.names('Feb', 81), plans.names('Rain', 60), plans.names('Price', 81)], [true, false, true, false], 'in its own table');
  assert.deepEqual([plans.names('Org price', '$1,200'), plans.names('Solo price', '$1,200')], [true, false], 'a label may take words from the row and from the head of the column');

  const lines = grounding('The tower in short.\nHeight: 330 m\nBuilt: 1889\n2019: 980 euros\n2020: 1,010 euros');
  assert.deepEqual([lines.names('Height', '330 m'), lines.names('Built', '330 m'), lines.names('tower', '330 m')], [true, false, false], 'each line stands alone');
  assert.deepEqual([lines.names('2019', 980), lines.names('2019', 1010), lines.names('2020', 1010, 'euros')], [true, false, true]);
  const cities = grounding('北京的常住人口是2189万。上海是2487万。');
  assert.deepEqual([cities.names('北京人口', 2189, '万'), cities.names('上海', 2189, '万'), cities.names('北京', 2189)], [true, false, false], 'a number is read with its unit, as `writes` reads it');
  const held = grounding('The tower is tall.', ['Height', '330 m']);
  assert.deepEqual([held.says('330 m'), held.names('Height', '330 m'), held.names('tower', '330 m')], [true, false, false], 'a value held beside the words stands beside no word');
});

test('a label and its value stand on one line: a line break that ends no sentence still parts them, and a full stop after a number ends one', () => {
  const unpunctuated = grounding('身高88厘米\n体重12.5公斤\n头围47厘米');
  assert.deepEqual([unpunctuated.names('身高', '12.5公斤'), unpunctuated.names('体重', '12.5公斤')], [false, true]);
  assert.deepEqual([grounding('Rent due on the 1st\nDeposit £900').names('Rent', '£900'), grounding('Rent due on the 1st\nDeposit £900').names('Deposit', '£900')], [false, true]);
  assert.equal(grounding('Churn fell to 4.2% in March,\nthe lowest since launch.').names('lowest churn', '4.2%'), false, 'a wrapped sentence too');
  assert.equal(grounding('Rent is due on the 1st. The deposit is £900.').names('Rent', '£900'), false, 'an ordinal ends a sentence before a capital');
  assert.equal(grounding('Height 330 m. Weight 10,100 tonnes.').names('Height', '10,100 tonnes'), false, 'and so does a unit that may be an abbreviation');
  assert.equal(grounding('The shop opens at 9 a.m. Parking costs £4.').names('shop', '£4'), false);
  assert.equal(grounding('The wall is 6 ft. The gate costs $300.').names('wall', '$300'), false);
  assert.equal(grounding('身高88厘米。体重12.5公斤。').names('身高', '12.5公斤'), false);
  assert.equal(grounding('The fence is 6 ft. tall and costs $300.').names('fence', '$300'), true, 'before a lower-case word the period is an abbreviation');
  assert.equal(grounding('We met at 3 p.m. in the hall and paid £5.').names('hall', '£5'), true);
  assert.equal(grounding('The rent is due on the 1st.').quotes('The rent is due on the 1st.'), true, 'a full stop at the end of the text');
});

test('a label word stands in its other forms: an ending, a past tense, a short month or weekday, a number in words', () => {
  assert.equal(grounding('Finished the Manchester half marathon in 1:52:40.').names('Finish time', '1:52:40'), true);
  assert.equal(grounding('Students slept 34 minutes longer on school nights.').names('Sleep on school nights', '34 minutes longer'), true);
  assert.equal(grounding('Absences fell by 15% after the change.').names('Fall in absences', '15%'), true);
  assert.equal(grounding('Mum lands at 14:35 at Terminal 2.').names('Landing', '14:35'), true);
  assert.equal(grounding('Charge £40 an hour for one-to-one and £25 a head for groups of three.').names('One-to-one, per hour', '£40'), true, 'a word that only ties need not stand');
  assert.equal(grounding('Charge £40 an hour for one-to-one and £25 a head for groups of three.').names('Group of three, per head', '£25'), true);
  assert.equal(grounding('Visitors: 1,200 in January, 1,450 in February.').names('Jan', 1200), true);
  assert.equal(grounding('The temperature reached 31°C on Monday.').names('Mon', 31, '°C'), true);
  assert.equal(grounding('Running went from 18 km in week one to 25 km in week two.').names('Week 1', 18, 'km'), true);
  assert.equal(grounding('Running went from 18 km in week one. It was 25 km in week two.').names('Week 2', 18, 'km'), false);
  assert.equal(grounding('Treatment failure occurred in 12.6% of the five-day group.').names('Treatment failure, five days', '12.6%'), true, 'a hyphen is a space');
  assert.equal(grounding('Absent pupils fell by 15%.').names('absence', '15%'), false, 'a word of the same root is no form of it');
});

test('a label may add a word for the kind of value it names, where the value is of that kind', () => {
  const bridge = grounding('The bridge is 1,280 m long and it weighs 9,000 tonnes. The towers rise 227 m.');
  assert.deepEqual([bridge.names('Length', '1,280 m'), bridge.names('Weight', '9,000 tonnes'), bridge.names('Tower height', '227 m')], [true, true, true]);
  assert.deepEqual([bridge.names('Weight', '1,280 m'), bridge.names('Height', '9,000 tonnes'), bridge.names('Price', '227 m')], [false, false, false], 'a value of another kind');
  const baby = grounding('The baby weighed 3.4 kg at birth and was 51 cm long.');
  assert.deepEqual([baby.names('Birth weight (kg)', '3.4'), baby.names('Length (cm)', '51'), baby.names('Weight', '51')], [true, true, false], 'the kind is read off the words that follow the value');
  assert.equal(grounding('The recipe takes 35 minutes.').names('Total time', '35 minutes'), true);
  assert.deepEqual([grounding('The deposit is £900.').names('Total', '£900'), grounding('The deposit is £900.').names('Deposit total', '£900')], [false, true], 'a word that names any value stands only beside another');
  assert.deepEqual([grounding('这次搬家一共花了4800元。').names('搬家费用', '4800元'), grounding('其中女性占54%。').names('女性比例', '54%'), grounding('身高88厘米，体重12.5公斤。').names('重量', '88厘米')], [true, true, false]);
});

test('a label that opens or ends with a word that only ties is a piece cut out of a phrase', () => {
  assert.equal(grounding('Treatment failure occurred in 12.6% of the five-day group.').names('of the five-day group', '12.6%'), false);
  assert.equal(grounding('First-period absences fell by 15%.').names('First-period absences fell by', '15%'), false);
  assert.equal(grounding('一份午餐平均卖12元，成本却要16元左右。').names('成本却要', '16元左右'), false);
  assert.equal(grounding('一份午餐平均卖12元，成本却要16元左右。').names('成本', '16元左右'), true);
  assert.equal(grounding('医生看了一眼，说已经出了十六颗。').names('说已经出了', '十六颗'), false);
  assert.equal(grounding('注册用户到月底是3200人。').names('注册用户到月底是', '3200人'), false);
  assert.equal(grounding('We aim for 10 hours a week.').names('a week', '10 hours a week'), false, 'an article opening a piece of its own value');
  assert.equal(grounding('We aim for 10 hours a week.').names('Hours a week', '10'), true);
  assert.equal(grounding('A year on Mars lasts 687 days.').names('A year on Mars', '687 days'), true, 'an article may open a name');
  assert.equal(grounding('在线人数达到1200人。').names('在线人数', '1200人'), true, '在 opens a word');
});

test('a whole passage begins and ends where a sentence, a list item or a cell does, or after a marker, and a lead may break off', () => {
  const text = grounding(
    'Do not take ibuprofen while you are on warfarin. Together they raise the risk.\nCaution: the stairs are steep.\nNonna said, "salt it like the sea", and tasted it.\n- Rotate the key\n注意：楼梯很陡。他说那几分钟是他自己的。',
    ['held words'],
  );
  for (const passage of [
    'Do not take ibuprofen while you are on warfarin.',
    'Do not take ibuprofen while you are on warfarin. Together they raise the risk.',
    'Together they raise the risk',
    'Caution: the stairs are steep.',
    'the stairs are steep',
    'Rotate the key',
    '楼梯很陡。',
  ]) {
    assert.equal(text.whole(passage), true, passage);
  }
  for (const passage of ['take ibuprofen while you are on warfarin.', 'Do not take ibuprofen', 'they raise the risk', 'are steep', 'salt it', 'salt it like the sea', 'Nonna said', '那几分钟是他自己的。', 'held words', 'Do not take paracetamol.']) {
    assert.equal(text.whole(passage), false, passage);
  }
  assert.deepEqual([text.leads('Do not take ibuprofen while'), text.leads('take ibuprofen while'), text.leads('Together they'), text.leads('held')], [true, false, true, false]);
  assert.deepEqual([text.begins('Do not take ibuprofen'), text.begins('do not, take'), text.begins('take ibuprofen'), text.begins('')], [true, true, false, false]);
});

test('a passage begins after a colon only where the words before it are a marker', () => {
  for (const [lead, passage] of [
    ['Caution', 'the floor is wet.'], ['Note', 'the office is closed on Monday.'], ['Warning', 'hot oil spits.'], ['Important', 'bring your passport.'],
    ['Reminder', 'the key expires on 3 December.'], ['Tip', 'salt the water.'], ['Please note', 'the office is closed.'], ['Results', 'none of the 40 patients improved.'],
    ['注意', '不要空腹吃药。'], ['提醒', '明天八点出发。'], ['小心', '地滑。'], ['警告', '高压危险。'], ['提示', '先断电。'], ['温馨提示', '不要空腹吃药。'],
  ]) {
    assert.equal(grounding(`${lead}: ${passage}`).whole(passage!), true, `${lead}:`);
  }
  for (const [lead, passage] of [
    ['Wrong', 'store the vaccine in the freezer.'], ['Myth', 'vaccines cause autism.'], ['Claim', 'the drug is safe in pregnancy.'], ["Don't", 'water in full sun.'],
    ['Not recommended', 'giving honey to babies.'], ['Hypothesis', 'the drug halves the risk.'], ['Reminder for whoever is on call', 'the key expires on 3 December.'],
    ['禁止', '在加油站吸烟。'], ['错误', '发烧时多穿衣服捂汗。'], ['谣言', '喝白酒可以杀死病毒。'], ['不要', '把电池扔进火里。'], ['先说结论', '方向没错。'],
  ]) {
    assert.equal(grounding(`${lead}: ${passage} Then more.`).whole(passage!), false, `${lead}:`);
  }
  assert.equal(grounding('Wrong:\nstore the vaccine in the freezer.').whole('store the vaccine in the freezer.'), false, 'a lead on a line of its own');
  assert.equal(grounding('Note:\nthe office is closed.').whole('the office is closed.'), true);
});

test('a line break is a passage edge only after a sentence end or a list item, before a list item, or at an empty line', () => {
  assert.equal(grounding('Do not\ntake ibuprofen while you are on warfarin.').whole('take ibuprofen while you are on warfarin.'), false);
  assert.equal(grounding('服药期间请勿\n饮酒或驾驶机动车，以免发生危险。').whole('饮酒或驾驶机动车，以免发生危险。'), false);
  assert.equal(grounding('You may drive\nonly after the drowsiness has passed.').whole('You may drive'), false, 'nor may one end there');
  assert.equal(grounding('Weekend in Porto\nWe took the early train.').whole('We took the early train.'), false, 'a heading line ends no sentence either');
  assert.equal(grounding('Do not run.\nWalk to the exit.').whole('Walk to the exit.'), true);
  assert.equal(grounding('别碰电线！\n先断电').whole('先断电'), true);
  assert.equal(grounding('Bring:\n- a torch\n- water').whole('a torch'), true);
  assert.equal(grounding('- Rotate the key\nThen clear the accounts').whole('Rotate the key'), true, 'a list item ends at its line');
  assert.equal(grounding('Weekend in Porto\n\nWe took the early train.').whole('We took the early train.'), true);
  assert.equal(grounding('Do not\ntake ibuprofen while you are on warfarin.').quotes('Do not take ibuprofen while you are on warfarin.'), true, 'the sentence runs on over the line');
});

test("someone's words are a whole passage, or quoted words that are a sentence of their own", () => {
  const pass = grounding('At the top of the pass he said, "Same time next year, and you carry the stove." I said yes.');
  assert.deepEqual([pass.said('Same time next year, and you carry the stove.'), pass.whole('Same time next year, and you carry the stove.')], [true, false], 'a quote card may begin at the mark, a callout may not');
  assert.equal(grounding('他说：“那几分钟是只属于他自己的。”').said('那几分钟是只属于他自己的。'), true);
  assert.equal(grounding('“妈妈，云是不是天空盖的被子？”——豆豆，三岁半').said('妈妈，云是不是天空盖的被子？'), true, 'closed by a question mark inside the quote');
  assert.equal(grounding('Nonna said, "salt it like the sea", and tasted it.').said('salt it like the sea'), true, 'closed before a comma');
  assert.equal(grounding('He said "the plan works" was a lie.').said('the plan works'), false, 'words that are part of a sentence of the text');
  assert.equal(grounding('"Sugar makes children hyperactive" is a myth that trials have failed to support.').said('Sugar makes children hyperactive'), false);
  assert.equal(grounding('"Never," she said, "take the pills with alcohol."').said('take the pills with alcohol.'), false, 'the rest of a quotation the sentence broke');
  assert.equal(grounding('"Never," she said, "take the pills with alcohol."').said('Never'), true);
  assert.equal(grounding('He said, "Bring the frame and the photo."').said('Bring the frame'), false, 'the quoted words whole');
});

test('a text defines a term in one sentence that opens with the term: the whole sentence, or the rest of it after a link', () => {
  const text = grounding(
    'Parallax is the apparent shift of an object when the viewer moves. Survivorship bias: looking only at what made it through.\n' +
      'When a factory vents waste into a river, the cost does not vanish. It lands on the people downstream. Costs of this kind are called externalities. A tomato is not a vegetable.\n' +
      '沉没成本，指的是已经付出而且收不回来的成本。',
  );
  assert.equal(text.defines('Parallax', 'the apparent shift of an object when the viewer moves'), true);
  assert.equal(text.defines('Parallax', 'Parallax is the apparent shift of an object when the viewer moves.'), true, 'the whole sentence');
  assert.equal(text.defines('Parallax', 'the apparent shift of an object'), false, 'a meaning cut short');
  assert.equal(text.defines('Parallax', 'shift of an object when the viewer moves.'), false, 'more than a link stands between them');
  assert.equal(text.defines('Survivorship bias', 'looking only at what made it through.'), true);
  assert.equal(text.defines('Parallax', 'looking only at what made it through.'), false, 'the meaning of another term');
  assert.equal(text.defines('externalities', 'Costs of this kind are called externalities.'), false, 'a sentence that holds the term and does not open with it');
  assert.equal(text.defines('externalities', 'It lands on the people downstream.'), false, 'the sentence before');
  assert.equal(text.defines('externalities', 'When a factory vents waste into a river, the cost does not vanish. It lands on the people downstream.'), false);
  assert.equal(text.defines('A tomato', 'a vegetable.'), false);
  assert.equal(text.defines('沉没成本', '已经付出而且收不回来的成本。'), true);
  assert.equal(text.defines('沉没成本', '指的是已经付出而且收不回来的成本。'), true, 'the link may open the meaning');
  assert.equal(text.defines('成本', '已经付出而且收不回来的成本。'), false, 'the last words of the term that opens the sentence are no term of it');
  assert.equal(text.defines('Parallax', ''), false);
  const lines = grounding('Term: Parallax\nDefinition: the apparent shift of an object\nBias: an error of selection');
  assert.equal(lines.defines('Parallax', 'the apparent shift of an object'), false, 'the meaning on another line under a lead of its own');
  assert.equal(grounding('The word sonder means the sense that every passer-by has a life as vivid as your own.').defines('sonder', 'the sense that every passer-by has a life as vivid as your own.'), true);
  assert.equal(grounding('所谓内卷，就是无效的过度竞争。').defines('内卷', '无效的过度竞争。'), true);
  assert.equal(grounding('Note: parallax is the apparent shift.').defines('parallax', 'the apparent shift.'), true);
});

test('a sentence that reports, denies or turns a term around gives it no meaning, and neither does the next sentence', () => {
  for (const text of ['Some say mindfulness is just relaxation.', 'People say mindfulness is just relaxation.', 'It is a myth that mindfulness is just relaxation.', 'It is not true that mindfulness is just relaxation.', 'Contrary to belief, mindfulness is just relaxation.', 'Nobody here believes that mindfulness is just relaxation.']) {
    assert.equal(grounding(text).defines('mindfulness', 'just relaxation.'), false, text);
  }
  for (const text of ['有人说内卷是指努力工作。这是误解。', '据说内卷是指努力工作。', '都说内卷是指努力工作。', '很多人误以为内卷是指努力工作。', '内卷并不是努力工作。']) {
    assert.equal(grounding(text).defines('内卷', '努力工作。'), false, text);
  }
  assert.equal(grounding('The opposite of love is indifference.').defines('love', 'indifference.'), false);
  assert.equal(grounding("A common mistake is thinking that 'literally' means 'figuratively'.").defines('literally', "'figuratively'."), false);
  assert.equal(grounding('Inflation is a general rise in prices. Deflation is the opposite, a general fall.').defines('inflation', 'Deflation is the opposite, a general fall.'), false);
  assert.equal(grounding('Entropy. It measures disorder in a system.').defines('Entropy', 'It measures disorder in a system.'), false);
});

test('an entry is asserted where no sentence that holds it opens with a condition it leaves behind', () => {
  const plan = grounding('Ask Maria whether her team would test it. If she agrees we need the build ready, a short script, and someone to take notes. If she does not, fall back to the five customers.');
  assert.deepEqual([plan.asserts('a short script'), plan.asserts('someone to take notes'), plan.asserts('fall back to the five customers')], [false, false, false]);
  assert.deepEqual([plan.asserts('If she agrees we need the build ready'), plan.asserts('Ask Maria whether her team would test it')], [true, true], 'an entry that carries its condition, or none');
  for (const [text, entry] of [['When you arrive, collect your badge and your key.', 'collect your badge'], ['Unless it rains, bring a hat.', 'bring a hat'], ['如果下雨，带伞和雨衣。', '雨衣'], ['要是她同意，我们需要场地。', '场地'], ['- If it rains: umbrella, coat', 'coat']]) {
    assert.equal(grounding(text!).asserts(entry!), false, text);
  }
  assert.equal(grounding('Bring a hat and a coat.').asserts('a coat'), true);
  assert.equal(grounding('If she agrees we need a script. Write a script anyway.').asserts('a script'), true, 'stated outside the condition too');
  assert.equal(grounding('If she agrees we need a script.', ['a script']).asserts('a script'), true, 'a value held beside the words');
});

test('a conversation is three lines or more that open with a name, of two people at least, one of whom speaks twice', () => {
  assert.equal(grounding('Mum: Has anyone seen the photo?\nBen: I think it is in the blue album\nMum: I looked.').converses(), true);
  assert.equal(grounding('用户：选哪个？\n\n助手：先看她的意愿。\n\n用户：她比较好动。').converses(), true);
  assert.equal(grounding('Height: 330 m\nBuilt: 1889\nFloors: 3').converses(), false, 'no one speaks twice');
  assert.equal(grounding('Note: one\nNote: two\nCaution: three').converses(), false, 'a marker is no speaker');
  assert.equal(grounding('Q: Why is the sky blue?\nA: Air scatters blue light.').converses(), false);
});
