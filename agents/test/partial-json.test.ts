import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeElements } from '../src/core/partial-json.ts';

test('the elements of an array that are whole in the start of a reply are read, in order, and the one still open is not', () => {
  const whole = JSON.stringify({ reading: 'x', directions: [{ title: 'A {brace} "quoted"', n: [1, { deep: true }] }, { title: 'B' }, { title: 'C' }] });
  const cut = whole.indexOf('"C"');
  assert.deepEqual(completeElements(whole.slice(0, cut), 'directions'), [{ title: 'A {brace} "quoted"', n: [1, { deep: true }] }, { title: 'B' }]);
  assert.deepEqual(completeElements(whole, 'directions'), [{ title: 'A {brace} "quoted"', n: [1, { deep: true }] }, { title: 'B' }, { title: 'C' }]);
  assert.deepEqual(completeElements('{"reading": "still thinking', 'directions'), []);
  assert.deepEqual(completeElements('{"directions": [ {"title": "A"}, {"title": "B\\"}"', 'directions'), [{ title: 'A' }]);
});
