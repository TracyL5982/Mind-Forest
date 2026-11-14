import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grounding } from '../src/core/grounding.ts';

const says = (text: string, claim: string) => grounding(text).says(claim);

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
  assert.equal(says('北京是中国的首都，人口2189万。', '2189'), true);
  assert.equal(says('北京是中国的首都，人口2189万。', '上海'), false);
  assert.equal(says('北京是中国的首都，人口2189万。', '京国'), false);
  assert.equal(says('北京是中国的首都，人口2189万。', '189'), false);
  assert.equal(says('東京タワーへ行きました。', 'タワー'), true);
  assert.equal(says('我爱🌍', '🌍'), true);
  assert.equal(says('서울에서 만났다', '서울'), true);
  assert.equal(says('ไปเที่ยวกรุงเทพ', 'กรุงเทพ'), true);
});

test('a passage is one stretch of the text: it cannot be stitched across a sentence end, a line or a table cell', () => {
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

test('an empty text states nothing', () => {
  const text = grounding('');
  assert.equal(text.says('anything'), false);
  assert.equal(text.quotes('anything'), false);
  assert.equal(text.writes(0), false);
  assert.equal(text.paints('#fff'), false);
});
