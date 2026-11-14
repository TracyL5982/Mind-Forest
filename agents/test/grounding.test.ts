import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grounding, REVERSING } from '../src/core/grounding.ts';
import { structure } from '../src/core/roles/intake/describe.ts';
import { blank } from '../src/fake/model.ts';

const says = (text: string, claim: string) => grounding(text).says(claim);
const passage = (text: string, words: string) => grounding(text).passage(words);
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

test('a passage is one or more whole units of the text, one after another, as the text writes them once white space is folded', () => {
  const text = grounding('Air scatters short blue wavelengths more than long red ones.\nRayleigh scattering is the name for it. Dr. Ito agrees, mostly.\n\nPlan | Price | Seats\nBasic | 5 | 1');
  for (const words of [
    'Air scatters short blue wavelengths more than long red ones.',
    'air scatters  short blue wavelengths\nmore than long red ones',
    'Rayleigh scattering is the name for it. Dr. Ito agrees, mostly.',
    '"Dr. Ito agrees, mostly."',
    'Basic',
  ]) {
    assert.equal(text.passage(words), 'whole', words);
  }
  for (const words of ['short blue wavelengths more than long red ones.', 'Air scatters short blue wavelengths', 'Dr. Ito agrees mostly.', 'red ones Rayleigh scattering', 'Plan Price']) {
    assert.equal(text.passage(words), 'cut', words);
  }
  assert.deepEqual([text.passage('Every stair keeps the weight.'), text.passage(''), text.passage('Rayleigh scattering is the name for it?')], ['unstated', 'unstated', 'cut']);
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

test('a sentence ends at a full stop, a question mark or an exclamation mark, and at a period after an abbreviation only before a capital that opens no other one', () => {
  for (const [text, first] of [
    ['We ship to the U.S. If you live in Canada, add $15.', 'We ship to the U.S.'],
    ['Rent is due on the 1st. The deposit is £900.', 'Rent is due on the 1st.'],
    ['Height 330 m. Weight 10,100 tonnes.', 'Height 330 m.'],
    ['他去了北京。上海很热。', '他去了北京。'],
    ['别碰电线！先拉下电闸。', '别碰电线！'],
    ['为什么天空是蓝色的？因为散射。', '为什么天空是蓝色的？'],
    ['Is it safe? No, it is not.', 'Is it safe?'],
  ] as const) {
    assert.equal(passage(text, first), 'whole', text);
  }
  for (const [text, part] of [
    ['You can give children ibuprofen, paracetamol, etc. only after checking the dose.', 'You can give children ibuprofen, paracetamol, etc.'],
    ['Then Dr. Smith said the plan was fine.', 'Then Dr.'],
    ['It weighs approx. 5 kg and that is fine.', 'It weighs approx.'],
    ['Look at e.g. Paris first.', 'Look at e.g.'],
    ['We met at 3 p.m. in the hall.', 'We met at 3 p.m.'],
  ] as const) {
    assert.equal(passage(text, part), 'cut', text);
  }
  assert.equal(passage('Then Dr. Smith said the plan was fine.', 'Then Dr. Smith said the plan was fine.'), 'whole');
  assert.equal(passage('The U.S. Dept. of Energy said so.', 'The U.S. Dept. of Energy said so.'), 'whole', 'a capital that opens another abbreviation');
});

test('a list line, a table cell and a line that stands by itself are each a unit, without the bullet or number that opens the line', () => {
  for (const [text, unit] of [
    ['- red apples\n- green pears', 'green pears'],
    ['1. Preheat the oven. Grease the tin.\n2. Mix.', 'Preheat the oven. Grease the tin.'],
    ['[x] tent\n[ ] stove', 'stove'],
    ['- [x] tent\n1. [ ] stove', 'stove'],
    ['第一步，五花肉切块。\n第二步，焯水。', '五花肉切块。'],
    ['Step 2: grease the tin\nStep 3: bake', 'grease the tin'],
    ['Plan | Price\nSolo | $8', '$8'],
    ['Store below 25°C\nKeep away from children', 'Store below 25°C'],
    ['Refund policy\nIf you cancel within 14 days, you get a full refund.', 'If you cancel within 14 days, you get a full refund.'],
    ['1998 to 2003: Leeds, the flat over the bakery\n2003 to 2010: Bristol, Ashley Road', '1998 to 2003: Leeds, the flat over the bakery'],
    ['好处：\n团队做的方向是我想做的\n离父母近一些', '团队做的方向是我想做的'],
  ] as const) {
    assert.equal(passage(text, unit), 'whole', text);
  }
  assert.equal(passage('1. Preheat the oven. Grease the tin.', 'Preheat the oven.'), 'cut', 'a list line is one unit, whatever sentences it holds');
  assert.equal(passage('- red apples\n- green pears', '- green pears'), 'cut');
  assert.equal(passage('Plan | Price\nSolo | $8', 'Solo $8'), 'cut');
});

test('a line goes on into the next when the next opens as no sentence does, or the line opens with a condition or ends with a word that ties', () => {
  for (const [text, part] of [
    ['Do not\ntake ibuprofen while you are on warfarin.', 'take ibuprofen while you are on warfarin.'],
    ['You may drive\nonly after the drowsiness has passed.', 'You may drive'],
    ['Take two tablets every four hours but never\non an empty stomach.', 'Take two tablets every four hours but never'],
    ['Never mix bleach with\nAmmonia.', 'Never mix bleach with'],
    ['If you cancel within 14 days\nYou get a full refund.', 'You get a full refund.'],
    ['你可以开车\n但要等困意过去以后。', '你可以开车'],
  ] as const) {
    assert.equal(passage(text, part), 'cut', text);
  }
  assert.equal(passage('Do not\ntake ibuprofen while you are on warfarin.', 'Do not take ibuprofen while you are on warfarin.'), 'whole', 'the sentence runs on over the line');
  assert.equal(passage('"The only way to do great work\nis to love what you do."\n— Steve Jobs', 'The only way to do great work is to love what you do.'), 'whole');
  assert.equal(passage('Chapter 3\n\nThe eye is not a camera. It does not record;\nit selects.', 'The eye is not a camera. It does not record; it selects.'), 'whole');
});

test('a unit beside a reversing word, or under one, is turned: every word of the table, in English and in Chinese', () => {
  for (const word of REVERSING.en) {
    assert.equal(passage(`Some say this one: ${word}. Keep the jar cold.`, 'Keep the jar cold.'), 'turned', `${word} before`);
    assert.equal(passage(`Keep the jar cold. Some say this one: ${word}.`, 'Keep the jar cold.'), 'turned', `${word} after`);
  }
  for (const word of REVERSING.zh) {
    assert.equal(passage(`有人这样说：${word}。罐子要放在阴凉处。`, '罐子要放在阴凉处。'), 'turned', `${word} before`);
    assert.equal(passage(`罐子要放在阴凉处。有人这样说：${word}。`, '罐子要放在阴凉处。'), 'turned', `${word} after`);
  }
  assert.equal(passage('Some say this one: true. Keep the jar cold.', 'Keep the jar cold.'), 'whole', 'a sentence with no word of the table');
  assert.deepEqual([passage('These are myths. Keep the jar cold.', 'Keep the jar cold.'), passage('He avoided it. Keep the jar cold.', 'Keep the jar cold.')], ['turned', 'turned'], 'a word in another of its forms');
  assert.equal(passage('Myths\n\nCracking your knuckles causes arthritis.\n\nIt does not.', 'Cracking your knuckles causes arthritis.'), 'turned', 'the heading it sits under');
  assert.equal(passage("Don't:\n- store the vaccine in the freezer\n- shake the vial", 'shake the vial'), 'turned', 'the label of its list');
  assert.equal(passage('That claim is false.\n\nKeep the jar cold.', 'Keep the jar cold.'), 'whole', 'a unit a paragraph away is not beside it');
  assert.equal(passage('Do not take ibuprofen with warfarin. Ask a pharmacist.', 'Do not take ibuprofen with warfarin.'), 'whole', 'a word of the table in the unit itself is shown with it');
  assert.equal(passage('服药期间请勿\n饮酒或驾驶机动车，以免发生危险。', '饮酒或驾驶机动车，以免发生危险。'), 'turned');
  assert.equal(passage('Background: daily aspirin prevents a first heart attack. Results: it did not.', 'daily aspirin prevents a first heart attack.'), 'cut', 'a marker is part of its unit');
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
  assert.equal(text.passage('anything'), 'unstated');
  assert.equal(text.writes(0), false);
  assert.equal(text.paints('#fff'), false);
});

test('a tab in a line of prose is white space to a passage and a cell break to a short claim, and tabs on lines side by side part cells', () => {
  const said = 'The   best  camera\tis the one you have with you, people say.';
  assert.equal(passage(said, 'The best camera is the one you have with you, people say.'), 'whole');
  assert.equal(passage(said, 'The best camera is the one you have with you'), 'cut');
  assert.equal(says(said, 'best camera is the one'), false);
  assert.equal(passage('Stay hungry.\n\nStay foolish.', 'Stay hungry. Stay foolish.'), 'whole', 'an empty line between two units is white space too');
  assert.deepEqual([passage('Name\tAge\nAnna\t30', 'Anna'), says('Name\tAge\nAnna\t30', 'Age Anna')], ['whole', false], 'a pasted table');
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
  assert.equal(grounding('Churn fell to 4.2% in March,\nthe lowest since launch.').names('lowest churn', '4.2%'), true, 'a sentence wrapped over two lines is one unit');
  assert.equal(grounding('Rent is due on the 1st. The deposit is £900.').names('Rent', '£900'), false, 'an ordinal ends a sentence before a capital');
  assert.equal(grounding('Height 330 m. Weight 10,100 tonnes.').names('Height', '10,100 tonnes'), false, 'and so does a unit that may be an abbreviation');
  assert.equal(grounding('The shop opens at 9 a.m. Parking costs £4.').names('shop', '£4'), false);
  assert.equal(grounding('The wall is 6 ft. The gate costs $300.').names('wall', '$300'), false);
  assert.equal(grounding('身高88厘米。体重12.5公斤。').names('身高', '12.5公斤'), false);
  assert.equal(grounding('The fence is 6 ft. tall and costs $300.').names('fence', '$300'), true, 'before a lower-case word the period is an abbreviation');
  assert.equal(grounding('We met at 3 p.m. in the hall and paid £5.').names('hall', '£5'), true);
  assert.equal(grounding('The rent is due on the 1st.').passage('The rent is due on the 1st.'), 'whole', 'a full stop at the end of the text');
});

test('a label word stands in its other forms: an ending, a past tense, a short month or weekday, a number in words', () => {
  assert.equal(grounding('Finished the Manchester half marathon in 1:52:40.').names('Finish', '1:52:40'), true);
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

test('a label names a value only in words of its unit: a word for the kind of value the unit does not write is no exception', () => {
  const ship = grounding('The ship is 330 m long and weighs 9,000 tonnes.');
  assert.deepEqual([ship.names('Height', '330 m'), ship.names('Length', '330 m'), ship.names('Weight', '9,000 tonnes')], [false, false, false]);
  assert.deepEqual([ship.names('Ship', '330 m'), ship.names('Ship, long', '330 m'), ship.names('Weighs', '9,000 tonnes')], [true, true, true]);
  assert.deepEqual([grounding('The lease runs for 3 years.').names('Age', '3 years'), grounding('We paid a deposit of £900.').names('Price', '£900'), grounding('We paid a deposit of £900.').names('Deposit', '£900')], [false, false, true]);
  assert.deepEqual([grounding('这艘船长330米，重9000吨。').names('高度', '330米'), grounding('租期3年，月租4500元。').names('年龄', '3年'), grounding('租期3年，月租4500元。').names('租期', '3年')], [false, false, true]);
  assert.deepEqual([grounding('上个月\n电费320元\n\n这个月\n电费410元').names('这个月电费', '320元'), grounding('上个月\n电费320元').names('电费', '320元')], [false, true], 'a heading is a unit of its own');
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
  assert.equal(grounding('A year on Mars lasts 687 days.').names('A year on Mars', '687 days'), false, 'nor with an article');
  assert.equal(grounding('A year on Mars lasts 687 days.').names('Year on Mars', '687 days'), true);
  assert.equal(grounding('在线人数达到1200人。').names('在线人数', '1200人'), true, '在 opens a word');
});

test('a passage cut short opens where a unit opens, and the text opens with its own first words', () => {
  const text = grounding('Do not take ibuprofen while you are on warfarin. Together they raise the risk.\nCaution: the stairs are steep.', ['held words']);
  assert.deepEqual([text.leads('Do not take ibuprofen while'), text.leads('take ibuprofen while'), text.leads('Together they'), text.leads('Caution: the'), text.leads('held')], ['whole', 'cut', 'turned', 'whole', 'unstated']);
  assert.deepEqual([text.passage('held words'), text.says('held words')], ['unstated', true], 'a value held beside the words is no unit of them');
  assert.deepEqual([text.begins('Do not take ibuprofen'), text.begins('do not, take'), text.begins('take ibuprofen'), text.begins('')], [true, true, false, false]);
  assert.equal(grounding('It is a myth. Do not take ibuprofen while you are on warfarin.').leads('Do not take'), 'turned');
});

test("someone's words are whole units, or the whole of a quotation inside one sentence that says who said it", () => {
  const pass = grounding('At the top of the pass he said, "Same time next year, and you carry the stove." I said yes.');
  assert.deepEqual([pass.said('Same time next year, and you carry the stove.'), pass.passage('Same time next year, and you carry the stove.')], ['whole', 'cut'], 'a quote card may be the words inside the marks, a callout may not');
  assert.equal(grounding('他说：“那几分钟是只属于他自己的。”').said('那几分钟是只属于他自己的。'), 'whole');
  assert.equal(grounding('Nonna said, "salt it like the sea", and tasted it.').said('salt it like the sea'), 'cut', 'a sentence that goes on after the words says more than who said them');
  assert.equal(grounding('He said "the plan works" was a lie.').said('the plan works'), 'cut', 'a sentence that says more than who said it');
  assert.equal(grounding('He said, though it is a myth, "the plan works."').said('the plan works.'), 'turned', 'a reversing word in the rest of its sentence');
  assert.equal(grounding('"Same time next year," he said.').said('Same time next year,'), 'whole', 'the speaker after the words');
  assert.equal(grounding('"Sugar makes children hyperactive" is a myth that trials have failed to support.').said('Sugar makes children hyperactive'), 'cut', 'no word in its sentence says who said it');
  assert.equal(grounding('It is not true that "the vaccine changes your DNA." It does not.').said('the vaccine changes your DNA.'), 'cut');
  assert.equal(grounding('My uncle always said, "Cold weather gives you a cold." Doctors say that is false.').said('Cold weather gives you a cold.'), 'turned', 'the sentence after it');
  assert.equal(grounding('He said, "Bring the frame and the photo."').said('Bring the frame'), 'cut', 'the quoted words whole');
  assert.equal(grounding('"The vaccine changes your DNA." That claim is false.').said('The vaccine changes your DNA.'), 'turned');
});

test('a meaning is whole units, the first of which opens with the term', () => {
  const text = grounding(
    'Parallax is the apparent shift of an object when the viewer moves. Survivorship bias: looking only at what made it through.\n' +
      'Costs of this kind are called externalities. A moraine, or glacial till, is the rock a glacier leaves behind.\n' +
      '沉没成本，指的是已经付出而且收不回来的成本。',
  );
  for (const [term, meaning] of [
    ['Parallax', 'Parallax is the apparent shift of an object when the viewer moves.'],
    ['Survivorship bias', 'Survivorship bias: looking only at what made it through.'],
    ['moraine', 'A moraine, or glacial till, is the rock a glacier leaves behind.'],
    ['沉没成本', '沉没成本，指的是已经付出而且收不回来的成本。'],
  ] as const) {
    assert.equal(text.defines(term, meaning), 'whole', term);
  }
  assert.deepEqual(
    [text.defines('Parallax', 'the apparent shift of an object when the viewer moves'), text.defines('Survivorship bias', 'looking only at what made it through.'), text.defines('沉没成本', '已经付出而且收不回来的成本。')],
    ['cut', 'cut', 'cut'],
    'the rest of the sentence after the term is cut out of it',
  );
  assert.equal(text.defines('externalities', 'Costs of this kind are called externalities.'), 'apart', 'a sentence that holds the term and does not open with it');
  assert.equal(text.defines('Parallax', 'Survivorship bias: looking only at what made it through.'), 'apart');
  assert.equal(grounding('Weather\nClimate is the average of the weather over thirty years.').defines('Weather', 'Climate is the average of the weather over thirty years.'), 'apart');
  assert.equal(grounding('The word sonder means the sense that every passer-by has a life as vivid as your own.').defines('sonder', 'The word sonder means the sense that every passer-by has a life as vivid as your own.'), 'whole');
  assert.equal(grounding("The term 'theory' means a hunch. Scientists would say that is wrong.").defines('theory', "The term 'theory' means a hunch."), 'turned');
  assert.equal(grounding('所谓内卷是指努力工作。其实不对，它指的是无效的竞争。').defines('内卷', '所谓内卷是指努力工作。'), 'turned');
  assert.equal(text.defines('Parallax', ''), 'unstated');
});

test('a conversation is three lines or more that open with a name, of two people at least, one of whom speaks twice', () => {
  assert.equal(grounding('Mum: Has anyone seen the photo?\nBen: I think it is in the blue album\nMum: I looked.').converses(), true);
  assert.equal(grounding('用户：选哪个？\n\n助手：先看她的意愿。\n\n用户：她比较好动。').converses(), true);
  assert.equal(grounding('Height: 330 m\nBuilt: 1889\nFloors: 3').converses(), false, 'no one speaks twice');
  assert.equal(grounding('Note: one\nNote: two\nCaution: three').converses(), false, 'a marker is no speaker');
  assert.equal(grounding('Q: Why is the sky blue?\nA: Air scatters blue light.').converses(), false);
});
