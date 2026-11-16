import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_LIMITS, Ledger, type Limits } from '../src/node/hosted/ledger.ts';

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
