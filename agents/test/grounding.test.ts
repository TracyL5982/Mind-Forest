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
