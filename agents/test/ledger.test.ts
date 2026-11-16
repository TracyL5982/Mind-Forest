import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_LIMITS, Ledger, limitsFrom, type Limits } from '../src/node/hosted/ledger.ts';

const A = 'device-aaaaaaaaaaaa';
const B = 'device-bbbbbbbbbbbb';

function ledgerAt(limits: Partial<Limits>, alerts: string[] = []) {
  const clock = { now: new Date('2026-11-15T20:00:00Z') };
  const ledger = new Ledger({ file: join(mkdtempSync(join(tmpdir(), 'mp-ledger-')), 'ledger.json'), limits: { ...DEFAULT_LIMITS, ...limits }, now: () => clock.now, alert: (t) => alerts.push(t) });
  return { ledger, clock };
}

test("Meta's tokens for the whole service are a day's budget: past it no costly work, and the next day it starts again", () => {
  const { ledger, clock } = ledgerAt({ tokensPerDay: 1000, deviceTokens: 10_000 });
  ledger.metaTokens(600, A);
  assert.equal(ledger.paused(), null);
  ledger.metaTokens(400, B);
  assert.equal(ledger.paused(), 'budget');
  assert.equal(ledger.refusal(A, 'searches'), 'budget');
  assert.equal(ledger.held(B), 'budget');
  clock.now = new Date('2026-11-16T08:01:00Z');
  assert.equal(ledger.paused(), null, 'a new day in San Francisco, without a restart');
  assert.equal(ledger.refusal(A, 'searches'), null);
});

test("with no cap nothing is ever refused for the day's spend, and the status says none", () => {
  const { ledger } = ledgerAt({ dollarsPerDay: null, deviceDollars: 1e9 });
  for (let n = 0; n < 100; n++) ledger.spend(50, n % 2 ? A : B);
  assert.equal(ledger.paused(), null);
  assert.equal(ledger.refusal(A, 'searches'), null);
  assert.equal(ledger.held(B), null);
  assert.equal(ledger.status().cap, 'none');
  assert.equal(ledger.status().spentToday, 5000);
});

test("the chat hears when the day's spend passes $25, $50, $100 and every $100 after, each once", () => {
  const alerts: string[] = [];
  const { ledger } = ledgerAt({ dollarsPerDay: null }, alerts);
  // The day comes to 24, 26, 36, 56, 106, 107, 257, 347, then 597, which passes $400 and $500 in one spend.
  for (const dollars of [24, 2, 10, 20, 50, 1, 150, 90, 250]) ledger.spend(dollars);
  assert.deepEqual(alerts.map((a) => /passed \$(\d+)/.exec(a)?.[1]), ['25', '50', '100', '200', '300', '500'], 'two amounts passed at once are told as the higher');
  ledger.spend(1);
  assert.equal(alerts.length, 6, 'an amount already told is not told again');
});

test("a device past its share is stopped alone, with no cap", () => {
  const { ledger } = ledgerAt({ dollarsPerDay: null, deviceDollars: 23 });
  ledger.spend(23, A);
  assert.equal(ledger.refusal(A, 'searches'), 'share');
  assert.equal(ledger.held(A), 'share');
  assert.equal(ledger.refusal(B, 'searches'), null);
  assert.equal(ledger.held(B), null);
});

/** deploy/testing.env as the service's environment would hold it, over no other setting. */
function testingEnv(): Record<string, string> {
  const file = readFileSync(join(import.meta.dirname, '../deploy/testing.env'), 'utf8');
  return Object.fromEntries(file.split('\n').filter((line) => line.trim() && !line.startsWith('#')).map((line) => line.split('=') as [string, string]));
}

test('with the testing mode, nothing is refused for voice, searches, web answers or the shares, and the token budget stays', () => {
  const limits = limitsFrom(testingEnv());
  assert.deepEqual([limits.voiceMinutes, limits.searches, limits.webAnswers, limits.deviceDollars, limits.deviceTokens], [null, null, null, null, null]);
  assert.equal(limits.tokensPerDay, DEFAULT_LIMITS.tokensPerDay);
  const { ledger } = ledgerAt(limits);
  ledger.used(A, 'voiceMs', 600 * 60_000);
  ledger.used(A, 'searches', 1000);
  ledger.used(A, 'webAnswers', 1000);
  ledger.spend(500, A);
  ledger.metaTokens(50_000_000, A);
  for (const kind of ['voiceMs', 'searches', 'webAnswers'] as const) assert.equal(ledger.refusal(A, kind), null, `no ${kind} limit`);
  assert.equal(ledger.held(A), null, 'no share');
  ledger.metaTokens(limits.tokensPerDay, B);
  assert.equal(ledger.held(B), 'budget', 'the daily token budget is on in both modes');
});

test('a limit not set keeps its judging value, 0 switches it off, and a setting that is no number stops the service', () => {
  assert.deepEqual(limitsFrom({}), DEFAULT_LIMITS);
  assert.deepEqual(limitsFrom({ MIND_PALACE_LIMIT_SEARCHES: '0', MIND_PALACE_LIMIT_VOICE_MINUTES: '45' }), { ...DEFAULT_LIMITS, searches: null, voiceMinutes: 45 });
  assert.throws(() => limitsFrom({ MIND_PALACE_LIMIT_DEVICE_DOLLARS: 'twenty' }), /MIND_PALACE_LIMIT_DEVICE_DOLLARS is "twenty"/);
});
