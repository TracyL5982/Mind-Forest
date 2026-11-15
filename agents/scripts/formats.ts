/**
 * Scores format choice: the real Renderer over the sample set in test/fixtures/formats.json, against the card a person would pick.
 * Prints agreement for the two groups of samples apart, the reviewers' and the authors', each by activity and language, then by expected card,
 * what the model changed in each group, every miss, and what the model cost. The two groups are never one score: the authors' samples
 * were written for the cards the model was added to draw, so a sum of both says more about the mix than about the model.
 *
 *   npm run formats            the live model, which needs MODEL_API_KEY and spends tokens
 *   npm run formats -- --fake  the fake model, to see that the script runs
 *   npm run formats -- --save out.json   also writes each sample's rule card, the model's reply, the verdict on it and the card drawn
 *   npm run formats -- --replay out.json puts the replies a run saved through the Renderer as it is now, with no model: what a change
 *                                        to a check makes of answers the model already gave
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { ModelClient } from '../src/core/ports.ts';
import { FakeModel } from '../src/fake/model.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { ACTIVITIES, agrees, ORIGINS, replaying, run, type Outcome } from '../test/formats.ts';

const replay = process.argv.indexOf('--replay');
const fake = process.argv.includes('--fake') || replay > 0;
const calls: { ok: boolean; ms: number; tokens: number }[] = [];
let model: Parameters<typeof run>[0];
let name = 'the fake model';
if (replay > 0) {
  const saved = JSON.parse(readFileSync(process.argv[replay + 1]!, 'utf8')) as Parameters<typeof replaying>[0];
  name = `the replies saved in ${process.argv[replay + 1]}`;
  model = (keyOf) => replaying(saved, keyOf);
} else if (fake) model = new FakeModel().choosing();
else {
  const env = loadEnv();
  if (!env.MODEL_API_KEY) {
    console.error('MODEL_API_KEY is not set. Put it in ~/.muse-garden.env, or run with --fake.');
    process.exit(1);
  }
  name = env.MUSE_LLM_MODEL || 'muse-spark-1.3';
  model = new MetaModel({
    apiKey: env.MODEL_API_KEY,
    baseUrl: env.MUSE_LLM_BASE_URL || undefined,
    model: env.MUSE_LLM_MODEL || undefined,
    onCall: (call) => calls.push({ ok: call.ok, ms: call.ms, tokens: call.tokens ?? 0 }),
  });
}

const { outcomes, notes } = await run(model);

const of = (list: Outcome[], right: (outcome: Outcome) => boolean) => `${list.filter(right).length} of ${list.length}`;
const byRules = (outcome: Outcome) => agrees(outcome.sample, outcome.ruled);
const inTheEnd = (outcome: Outcome) => agrees(outcome.sample, outcome.drawn);
const line = (label: string, list: Outcome[]) => console.log(`  ${label.padEnd(16)} rules ${of(list, byRules).padEnd(11)} with the model ${of(list, inTheEnd)}`);
function groups<K extends string, T = Outcome>(key: (one: T) => K, list: T[] = outcomes as T[]): [K, T[]][] {
  const out = new Map<K, T[]>();
  for (const one of list) out.set(key(one), [...(out.get(key(one)) ?? []), one]);
  return [...out];
}

const WROTE = { reviewers: 'written by two independent reviewers', authors: 'written by the authors, for the cards only the model draws' };
const changes = (list: Outcome[]) => list.filter((outcome) => outcome.asked && outcome.drawn !== outcome.ruled);
const judged = (list: Outcome[]) => `${list.filter((o) => !byRules(o) && inTheEnd(o)).length} right, ${list.filter((o) => byRules(o) && !inTheEnd(o)).length} wrong, ${list.filter((o) => byRules(o) === inTheEnd(o)).length} neither by the key`;

console.log(`Format choice over ${outcomes.length} samples, ${new Date().toISOString().slice(0, 10)}, ${name}\n`);
console.log('Agreement with the card a person would pick, or one they would accept');
for (const origin of ORIGINS) {
  const list = outcomes.filter((outcome) => outcome.sample.origin === origin);
  console.log(`\nThe ${origin}' ${list.length} samples, ${WROTE[origin]}`);
  line('all', list);
  console.log(`  ${'exactly as picked'.padEnd(16)} rules ${of(list, (o) => o.ruled === o.sample.expect).padEnd(11)} with the model ${of(list, (o) => o.drawn === o.sample.expect)}`);
  for (const activity of ACTIVITIES) line(activity, list.filter((outcome) => outcome.sample.activity === activity));
  for (const [language, some] of groups((outcome) => outcome.sample.language, list)) line(language, some);
  const asked = list.filter((outcome) => outcome.asked);
  console.log(`  The model was asked about ${asked.length} and answered for ${asked.filter((outcome) => outcome.reply).length}. It changed ${changes(list).length} cards: ${judged(changes(list))}.`);
}
console.log('\nBy expected card, both groups');
for (const [expect, list] of groups((outcome) => outcome.sample.expect).sort(([a], [b]) => a.localeCompare(b))) line(expect, list);

const asked = outcomes.filter((outcome) => outcome.asked);
const answered = asked.filter((outcome) => outcome.reply);
const changed = changes(outcomes);
const refused = answered.filter((outcome) => outcome.verdict && 'refused' in outcome.verdict);
const left = answered.flatMap(({ sample, verdict }) => (verdict?.left ?? []).map((fault) => ({ sample, fault })));
console.log(`\nThe ${changed.length} cards the model changed`);
for (const { sample, ruled, drawn } of changed) console.log(`  ${sample.key.padEnd(6)} ${sample.origin.padEnd(9)} ${ruled} to ${drawn}, expected ${[sample.expect, ...sample.accept].join(' or ')}`);
console.log(`${refused.length} of its answers were refused and the rule's card kept${refused.length > 0 ? ':' : '.'}`);
for (const [why, list] of groups((outcome) => (outcome.verdict as { refused: string }).refused, refused)) {
  console.log(`  ${why}: ${list.length}`);
  for (const { sample, reply, verdict } of list) console.log(`    ${sample.key} ${reply!.component}${'prop' in verdict! && verdict.prop ? ` (${verdict.prop})` : ''}, expected ${sample.expect}`);
}
console.log(`${left.length} figures, entries, rows and sections were left out of a card${left.length > 0 ? ':' : '.'}`);
for (const [why, list] of groups(({ fault }) => fault.why, left)) console.log(`  ${why}: ${list.map(({ sample, fault }) => `${sample.key} ${fault.prop}`).join(', ')}`);

const said = ({ asked: wasAsked, reply, verdict }: Outcome) => {
  if (!wasAsked) return 'by rule';
  if (!reply) return 'asked, no answer';
  return `model said ${reply.component}${verdict && 'refused' in verdict ? `, refused as ${verdict.refused}${verdict.prop ? ` at ${verdict.prop}` : ''}` : ''}`;
};
const misses = outcomes.filter((outcome) => !inTheEnd(outcome));
console.log(`\n${misses.length} misses`);
for (const outcome of misses) {
  const { sample, drawn } = outcome;
  console.log(`  ${sample.key.padEnd(6)} ${sample.origin.padEnd(9)} expected ${[sample.expect, ...sample.accept].join(' or ')}, drawn as ${drawn} (${said(outcome)}): ${sample.what.slice(0, 90)}`);
}

const save = process.argv.indexOf('--save');
if (save > 0 && process.argv[save + 1]) {
  writeFileSync(process.argv[save + 1]!, `${JSON.stringify(outcomes.map(({ sample, ...rest }) => ({ key: sample.key, origin: sample.origin, expect: sample.expect, accept: sample.accept, ...rest })), null, 1)}\n`);
}

if (notes.length > 0) {
  console.log(`\nRun log, ${notes.length} lines`);
  for (const note of notes) console.log(`  ${note}`);
}
if (!fake) {
  const failed = calls.filter((call) => !call.ok).length;
  console.log(`\n${calls.length} model calls${failed ? `, ${failed} failed` : ''}, ${calls.reduce((sum, call) => sum + call.tokens, 0)} tokens in all, the slowest call ${(Math.max(...calls.map((call) => call.ms)) / 1000).toFixed(1)} s.`);
  for (const call of calls) console.log(`  ${call.ok ? `${call.tokens} tokens` : 'failed'}, ${(call.ms / 1000).toFixed(1)} s`);
}
