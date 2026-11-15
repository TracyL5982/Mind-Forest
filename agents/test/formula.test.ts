import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, LONGEST, parse, wellFormed, type Program } from '../src/core/formula.ts';

const program = (source: string, known: string[] = []): Program => {
  const read = parse(source, known);
  if ('error' in read) assert.fail(`${source}: ${read.error}`);
  return read.program;
};
const value = (source: string, values: Record<string, number> = {}) => evaluate(program(source, Object.keys(values)), values);
const error = (source: string, known: string[] = []) => {
  const read = parse(source, known);
  assert.ok('error' in read, `${source} reads as ${JSON.stringify(read)}`);
  return read.error;
};

test('operators bind as in arithmetic: ^ before a sign before * and / before + and -, ^ to the right, the rest to the left', () => {
  assert.equal(value('1 + 2 * 3'), 7);
  assert.equal(value('(1 + 2) * 3'), 9);
  assert.equal(value('10 - 4 - 3'), 3);
  assert.equal(value('24 / 4 / 2'), 3);
  assert.equal(value('2 ^ 3 ^ 2'), 512);
  assert.equal(value('-2 ^ 2'), -4);
  assert.equal(value('(-2) ^ 2'), 4);
  assert.equal(value('2 ^ -1'), 0.5);
  assert.equal(value('2 * -3'), -6);
  assert.equal(value('--3'), 3);
  assert.equal(value('+3 - -3'), 6);
  assert.equal(value('1.5e2 + .5'), 150.5);
  assert.deepEqual(program('2 * atan(18 / f)', ['f']), [2, 18, 'f', '/', 'atan', '*']);
});

test('each function gives its value', () => {
  assert.equal(value('min(3, 1, 2)'), 1);
  assert.equal(value('max(3, 1, 2)'), 3);
  assert.equal(value('min(4, 9)'), 4);
  assert.equal(value('round(2.5)'), 3);
  assert.equal(value('round(-2.5)'), -2, 'round is floor(x + 0.5)');
  assert.equal(value('round(2.49)'), 2);
  assert.equal(value('sqrt(16)'), 4);
  assert.equal(value('exp(0)'), 1);
  assert.equal(value('ln(exp(2))'), 2);
  assert.ok(Math.abs(value('atan(1) * 4')! - Math.PI) < 1e-12, 'atan is in radians');
  assert.ok(Math.abs(value('2 * atan(18 / f) * 57.2958', { f: 50 })! - 39.6) < 0.05, 'the field of view of a 50 mm lens on full frame');
});

test('a value with no result has none: division by zero, a negative root, a log of zero, an overflow', () => {
  assert.equal(value('1 / 0'), undefined);
  assert.equal(value('1 / x', { x: 0 }), undefined);
  assert.equal(value('1 / (1 / x)', { x: 0 }), undefined, 'no step past a division by zero has a value either');
  assert.equal(value('0 / 5'), 0);
  assert.equal(value('sqrt(-1)'), undefined);
  assert.equal(value('ln(0)'), undefined);
  assert.equal(value('ln(-3)'), undefined);
  assert.equal(value('exp(1000)'), undefined);
  assert.equal(value('0 ^ -1'), undefined);
  assert.equal(value('(-8) ^ (1 / 3)'), undefined);
});

test('a formula that reads an unknown name or function, or is not one formula, cannot be read and says why', () => {
  assert.equal(error('2 * d', ['f']), 'it reads the unknown name "d"');
  assert.equal(error('atan2(1, f)', ['f']), 'it calls the unknown function "atan2"');
  assert.equal(error('Math.atan(f)', ['f']), '"." is not part of the language');
  assert.equal(error('sqrt 4'), 'sqrt needs its arguments in brackets');
  assert.equal(error('round(1, 2)'), 'round takes one argument, and is given 2');
  assert.equal(error('max(1)'), 'max takes two or more arguments, and is given 1');
  assert.equal(error('2f', ['f']), '"f" follows a whole formula');
  assert.equal(error('(1 + 2'), '")" is missing after a bracket\'s contents');
  assert.equal(error('1 +'), 'it ends where a value should be');
  assert.equal(error('* 2'), '"*" stands where a value should be');
  assert.equal(error('2 % 3'), '"%" is not part of the language');
  assert.equal(error('f = 2'), '"=" is not part of the language');
  assert.equal(error('alert(1)'), 'it calls the unknown function "alert"');
  assert.equal(error('   '), 'it is empty');
  assert.equal(error('1e999'), 'Infinity is too large');
});

test(`a formula of up to ${LONGEST} characters is read, and a 500 character one is not`, () => {
  const longest = `${'1+'.repeat(149)}11`;
  assert.equal(longest.length, LONGEST);
  assert.equal(value(longest), 160);
  const nested = `${'('.repeat(149)}1${')'.repeat(149)}`;
  assert.equal(nested.length, 299);
  assert.equal(value(nested), 1, 'deep brackets are read');
  const long = `${'1+'.repeat(249)}1 `;
  assert.equal(long.length, 500);
  assert.equal(error(long), `it is longer than ${LONGEST} characters`);
  assert.equal(error(`${'('.repeat(250)}${')'.repeat(250)}`), `it is longer than ${LONGEST} characters`);
});

test('a program stands only when each token is a number, a known name or a step, and it leaves one value', () => {
  assert.ok(wellFormed([2, 18, 'f', '/', 'atan', '*'], ['f']));
  assert.ok(!wellFormed([2, 18, 'g', '/'], ['f']), 'an unknown name');
  assert.ok(!wellFormed([2, '/'], []), 'a step short of its arguments');
  assert.ok(!wellFormed([1, 2], []), 'two values left');
  assert.ok(!wellFormed([], []), 'no value');
  assert.ok(!wellFormed([Number.POSITIVE_INFINITY], []));
  assert.ok(!wellFormed([1, 'constructor'], []), 'no name a program does not hold');
  assert.equal(evaluate([1, 'constructor', '+'], {}), undefined);
});
