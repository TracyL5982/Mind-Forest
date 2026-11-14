/**
 * Scores format choice: the real Renderer over the sample set in test/fixtures/formats.json, against the card a person would pick.
 * Prints agreement overall and by activity, language and expected card, what the model changed, every miss, and what the model cost.
 *
 *   npm run formats            the live model, which needs MODEL_API_KEY and spends tokens
 *   npm run formats -- --fake  the fake model, to see that the script runs
 *   npm run formats -- --save out.json   also writes each sample's rule card, the model's reply, the verdict on it and the card drawn
 */
import { writeFileSync } from 'node:fs';
import type { ModelClient } from '../src/core/ports.ts';
import { FakeModel } from '../src/fake/model.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { ACTIVITIES, agrees, run, type Outcome } from '../test/formats.ts';

const fake = process.argv.includes('--fake');
const calls: { ok: boolean; ms: number; tokens: number }[] = [];
let model: ModelClient;
let name = 'the fake model';
if (fake) model = new FakeModel().choosing();
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
function groups<K extends string>(key: (outcome: Outcome) => K, list = outcomes): [K, Outcome[]][] {
  const out = new Map<K, Outcome[]>();
  for (const outcome of list) out.set(key(outcome), [...(out.get(key(outcome)) ?? []), outcome]);
  return [...out];
}

console.log(`Format choice over ${outcomes.length} samples, ${new Date().toISOString().slice(0, 10)}, ${name}\n`);
console.log('Agreement with the card a person would pick, or one they would accept');
line('all', outcomes);
console.log(`  ${'exactly as picked'.padEnd(16)} rules ${of(outcomes, (o) => o.ruled === o.sample.expect).padEnd(11)} with the model ${of(outcomes, (o) => o.drawn === o.sample.expect)}`);
for (const activity of ACTIVITIES) line(activity, outcomes.filter((outcome) => outcome.sample.activity === activity));
for (const [language, list] of groups((outcome) => outcome.sample.language)) line(language, list);
console.log('\nBy expected card');
for (const [expect, list] of groups((outcome) => outcome.sample.expect).sort(([a], [b]) => a.localeCompare(b))) line(expect, list);

const asked = outcomes.filter((outcome) => outcome.asked);
const answered = asked.filter((outcome) => outcome.reply);
const changed = asked.filter((outcome) => outcome.drawn !== outcome.ruled);
const refused = answered.filter((outcome) => outcome.verdict && 'refused' in outcome.verdict);
console.log(`\nThe model was asked about ${asked.length} samples and answered for ${answered.length}.`);
console.log(`It changed ${changed.length} cards: ${changed.filter((o) => !byRules(o) && inTheEnd(o)).length} right, ${changed.filter((o) => byRules(o) && !inTheEnd(o)).length} wrong, ${changed.filter((o) => byRules(o) === inTheEnd(o)).length} neither by the key.`);
for (const { sample, ruled, drawn } of changed) console.log(`  ${sample.key.padEnd(6)} ${ruled} to ${drawn}, expected ${[sample.expect, ...sample.accept].join(' or ')}`);
console.log(`${refused.length} of its answers were refused and the note kept${refused.length > 0 ? ':' : '.'}`);
for (const [why, list] of groups((outcome) => (outcome.verdict as { refused: string }).refused, refused)) {
  console.log(`  ${why}: ${list.length}`);
  for (const { sample, reply, verdict } of list) console.log(`    ${sample.key} ${reply!.component}${'prop' in verdict! && verdict.prop ? ` (${verdict.prop})` : ''}, expected ${sample.expect}`);
}

const said = ({ asked: wasAsked, reply, verdict }: Outcome) => {
  if (!wasAsked) return 'by rule';
  if (!reply) return 'asked, no answer';
  return `model said ${reply.component}${verdict && 'refused' in verdict ? `, refused as ${verdict.refused}${verdict.prop ? ` at ${verdict.prop}` : ''}` : ''}`;
};
const misses = outcomes.filter((outcome) => !inTheEnd(outcome));
console.log(`\n${misses.length} misses`);
for (const outcome of misses) {
  const { sample, drawn } = outcome;
  console.log(`  ${sample.key.padEnd(6)} expected ${[sample.expect, ...sample.accept].join(' or ')}, drawn as ${drawn} (${said(outcome)}): ${sample.what.slice(0, 90)}`);
}

const save = process.argv.indexOf('--save');
if (save > 0 && process.argv[save + 1]) {
  writeFileSync(process.argv[save + 1]!, `${JSON.stringify(outcomes.map(({ sample, ...rest }) => ({ key: sample.key, expect: sample.expect, accept: sample.accept, ...rest })), null, 1)}\n`);
}

if (notes.length > 0) {
  console.log(`\nRun log, ${notes.length} lines`);
  for (const note of notes) console.log(`  ${note}`);
}
if (!fake) {
  const failed = calls.filter((call) => !call.ok).length;
  console.log(`\n${calls.length} model calls${failed ? `, ${failed} failed` : ''}, ${calls.reduce((sum, call) => sum + call.tokens, 0)} tokens in all.`);
  for (const call of calls) console.log(`  ${call.ok ? `${call.tokens} tokens` : 'failed'}, ${(call.ms / 1000).toFixed(1)} s`);
}
