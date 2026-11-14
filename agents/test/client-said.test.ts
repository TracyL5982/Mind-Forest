import assert from 'node:assert/strict';
import { test } from 'node:test';

type Said = {
  rest: (text: string, said: string[]) => string;
  isSaid: (words: string, said: string[]) => boolean;
  leftover: (item: { text: string; summary: string }, said: string[]) => { summary: string; text: string };
};
const { rest, isSaid, leftover } = (await import(new URL('../client/js/said.js', import.meta.url).href)) as Said;

test('an opened card does not print again the lines of its text that its own form has drawn', () => {
  assert.equal(rest('Plan | Price\nSolo | $8\nTeam | $20', ['Plans', 'Plan', 'Price', 'Solo', '$8', 'Team', '$20']), '');
  assert.equal(rest('周末露营清单\n[x] 帐篷\n[ ] 头灯', ['周末露营清单', '帐篷', '头灯']), '');
  assert.equal(rest('Term: Bokeh\nDefinition: the look of what is out of focus', ['Bokeh', 'the look of what is out of focus']), '');
  assert.equal(rest('Q: Why is the sky blue?\nA: Air scatters short waves most.', ['Q', 'A', 'Why is the sky blue?', 'Air scatters short waves most.']), '');
  assert.equal(rest('硬装40%\n备用金5%', ['硬装', '40%', '备用金', '5%']), '');
  assert.equal(rest('const a = 1;\n\nrun(a);', ['const a = 1;\n\nrun(a);']), '', 'a line inside a longer drawn string');
});

test('an opened card still prints what its text says beyond its form', () => {
  const table = ['City', 'Rent', 'Lisbon', '900'];
  assert.equal(rest('City | Rent\nLisbon | 900\n\nI would rather live by the river.', table), 'I would rather live by the river.');
  assert.equal(rest('200 g red lentils\n1 onion\n1. Rinse the lentils.', ['1', 'Rinse the lentils.']), '200 g red lentils\n1 onion', 'a short line nothing has drawn stays');
  assert.equal(rest('milk and eggs are in the fridge door\n- milk\n- eggs', ['milk', 'eggs']), 'milk and eggs are in the fridge door');
  assert.equal(rest('There are 53 stations on the road, each drawn in rain.', ['53', 'stations on the road']), 'There are 53 stations on the road, each drawn in rain.', 'words lifted from inside a sentence leave it whole');
  assert.equal(rest('“妈妈，云是不是天空盖的被子？”——豆豆，三岁半，早上去幼儿园的路上', ['妈妈，云是不是天空盖的被子？', '豆豆']), '“妈妈，云是不是天空盖的被子？”——豆豆，三岁半，早上去幼儿园的路上');
  assert.equal(rest('Catalogue', ['cat']), 'Catalogue', 'a drawn string is matched as whole words');
  assert.equal(rest('Table 2. Mean recall by hours of sleep (n = 212)', ['Mean recall by hours of sleep']), 'Table 2. (n = 212)', 'words after what is drawn are not a mark');
  assert.equal(rest('Eiffel Tower notes for the trip\nHeight: 330 m', ['Eiffel Tower notes', 'Height', '330 m']), 'Eiffel Tower notes for the trip');
});

test('a sentence the form has drawn is cut out of a line that says more', () => {
  assert.equal(rest('Feed it once a day. Never rinse the jar. Anything above 40 °C kills the yeast.', ['Anything above 40 °C kills the yeast.']), 'Feed it once a day. Never rinse the jar.');
  assert.equal(rest('"A map is not the territory it represents." Korzybski said this in 1933 and I keep coming back to it.', ['A map is not the territory it represents.']), 'Korzybski said this in 1933 and I keep coming back to it.');
  assert.equal(rest('Hallway plan for the autumn. Take the old shelf out and move the hooks.', ['Hallway plan for the autumn']), 'Take the old shelf out and move the hooks.');
  assert.equal(rest('Mean recall by hours of sleep (n = 212)', ['Mean recall by hours of sleep']), '(n = 212)', 'an aside in brackets after it stays');
});

test('a summary the opened card already says is not printed again', () => {
  assert.ok(isSaid('The house shelters day-dreaming…', ['Bachelard', 'The house  shelters day-dreaming, the house protects the dreamer.']));
  assert.ok(isSaid('gelatin silver print', ['Gelatin silver print']));
  assert.equal(isSaid('Bachelard on how rooms hold memory.', ['The house shelters day-dreaming.']), false);
});

test('a summary clipped from the text is said by the text, and the text prints only what the form leaves unsaid', () => {
  const text = 'Q: Why is the sky blue?\nA: Air scatters short waves most.\n\nMira asked this at breakfast.';
  const said = ['Why is the sky blue?', 'Q', 'Why is the sky blue?', 'A', 'Air scatters short waves most.'];
  const printed = { summary: '', text: 'Mira asked this at breakfast.' };
  assert.deepEqual(leftover({ text, summary: 'Q: Why is the sky blue? A: Air scatters short waves most. Mira asked…' }, said), printed, 'a clip of the folded text with an ellipsis');
  assert.deepEqual(leftover({ text, summary: text.slice(0, 40) }, said), printed, 'the first characters of the text, cut inside a word');
  assert.deepEqual(leftover({ text, summary: text }, said), printed, 'a summary that is the text');
  assert.deepEqual(leftover({ text: '周末露营要带的东西。\n- 帐篷', summary: '周末露营要带的东西。 - 帐篷' }, ['周末露营清单', '帐篷']), { summary: '', text: '周末露营要带的东西。' });
  assert.deepEqual(leftover({ text, summary: 'A question a child asked.' }, said), { summary: 'A question a child asked.', text: 'Mira asked this at breakfast.' }, 'a summary of its own is printed');
});
