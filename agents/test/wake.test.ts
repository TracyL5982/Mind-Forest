import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spokenName, withoutWakePhrase } from '../src/core/wake.ts';

test('a leading "hey" or "hi" and the name are dropped, however they were written down', () => {
  const cases: [string, string][] = [
    ['Hey Momo, show me more like this.', 'Show me more like this.'],
    ['hi momo undo that', 'Undo that'],
    ['Hi, Momo! Go back to the start.', 'Go back to the start.'],
    ['HEY MOMO: keep the first two', 'Keep the first two'],
    ['Hey Mo-mo. Find papers on spaced repetition.', 'Find papers on spaced repetition.'],
    ['  hey mo mo, more', 'More'],
    ['"Hey Momo," package this tree.', 'Package this tree.'],
    ['Hey Momo.', ''],
  ];
  for (const [said, meant] of cases) assert.equal(withoutWakePhrase(said, 'momo'), meant, said);
});

test('the phrase is left alone when it is not a greeting to the agent at the start', () => {
  for (const said of [
    'Hey mama, undo that.',
    "Momo's bakery closes at six.",
    "Hey Momo's bakery is closed.",
    'Hey Momoko, are you there?',
    'Show me more, hey Momo.',
    'They said hi to Momo.',
    'Hello Momo, more please.',
    'Momo, more please.',
  ]) {
    assert.equal(withoutWakePhrase(said, 'momo'), said, said);
  }
});

test('another name works the same way, and the old one no longer wakes anything', () => {
  assert.equal(withoutWakePhrase('Hi Juno, more like this.', 'Juno'), 'More like this.');
  assert.equal(withoutWakePhrase('Hey Momo, more like this.', 'Juno'), 'Hey Momo, more like this.');
  assert.equal(withoutWakePhrase('hey mister pickle, undo', 'Mister Pickle'), 'Undo');
  assert.equal(spokenName('momo'), 'Momo');
  assert.equal(spokenName('mister pickle'), 'Mister Pickle');
});
