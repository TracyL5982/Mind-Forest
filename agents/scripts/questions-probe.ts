/**
 * Asks the live model for the suggested questions of a few cards in a saved mindstorm, as a client opening them would,
 * and prints each card's questions, the time to answer and the tokens. Nothing is written to the mindstorm.
 * Usage: MIND_PALACE_DATA=<a copy of agents/data> tsx scripts/questions-probe.ts ["words from a card title" ...]
 * With no titles it takes three kept cards from different trees that have cards under them.
 * QUESTIONS_SAID="..." also asks for the first card as if the user had just said that.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Id } from '../src/core/domain.ts';
import { Pipeline } from '../src/core/pipeline.ts';
import { roles } from '../src/core/roles/index.ts';
import { brief, questions } from '../src/core/roles/questions.ts';
import { DEFAULT_SETTINGS } from '../src/core/roles/types.ts';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { SqliteStore } from '../src/node/store.ts';
import { makeTools } from '../src/node/tools.ts';

const env = loadEnv();
const dataDir = env.MIND_PALACE_DATA ?? join(import.meta.dirname, '../data');

type Usage = { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
let usage: Usage[] = [];
const counting: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.ok) usage.push(((await res.clone().json().catch(() => ({}))) as { usage?: Usage }).usage ?? {});
  return res;
};
const model = new MetaModel({ apiKey: env.MODEL_API_KEY ?? '', baseUrl: env.MUSE_LLM_BASE_URL || undefined, model: env.MUSE_LLM_MODEL || undefined, quickModel: env.MIND_PALACE_QUICK_MODEL || undefined, fetch: counting });
const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
const saved = new SqliteStore(join(dataDir, 'mindstorm.sqlite'));
mind.load(saved.all());
saved.close();
const assets = new DiskAssets(join(dataDir, 'assets'));
const pipeline = new Pipeline({
  mind, roles, model, assets,
  tools: makeTools({ model, assets }),
  store: { append: () => {}, all: () => [] },
  settings: { ...DEFAULT_SETTINGS },
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  emit: (m) => m.t === 'note' && console.log(`  note ${m.role}: ${m.message}`),
});

const kept = [...mind.nodes.values()].filter((n) => n.status === 'kept');
const wanted = process.argv.slice(2);
const cards: Id[] = wanted.length > 0
  ? wanted.map((words) => kept.find((n) => mind.itemOf(n.id).title.toLowerCase().includes(words.toLowerCase()))?.id ?? '').filter(Boolean)
  : [...new Map(kept.filter((n) => mind.children(n.id).length > 0).map((n) => [n.treeId, n.id])).values()].slice(0, 3);

const measure = async (ask: () => Promise<string[]>) => {
  usage = [];
  const started = performance.now();
  const got = await ask();
  const ms = Math.round(performance.now() - started);
  const input = usage.reduce((s, u) => s + (u.input_tokens ?? 0), 0);
  const output = usage.reduce((s, u) => s + (u.output_tokens ?? 0), 0);
  const reasoning = usage.reduce((s, u) => s + (u.output_tokens_details?.reasoning_tokens ?? 0), 0);
  return { got, ms, calls: usage.length, input, output, reasoning };
};

for (const id of cards) {
  const card = brief(mind, id);
  console.log(`\n## "${card.title}" (${card.kind})\n   above: ${card.path.join(' > ') || '(root)'}\n   under: ${card.under.length}, beside: ${card.beside.length}`);
  const first = await measure(() => pipeline.questions(id));
  console.log(`   opened:   ${first.ms} ms, ${first.calls} call, ${first.input} in + ${first.output} out (${first.reasoning} reasoning) tokens`);
  for (const q of first.got) console.log(`     - ${q}`);
  const again = await measure(() => pipeline.questions(id));
  console.log(`   reopened: ${again.ms} ms, ${again.calls} calls, ${again.got.length === first.got.length ? 'same questions' : 'DIFFERENT'}`);
  const fresh = await measure(() => questions(pipeline.ctx, { card, history: [] }));
  console.log(`   rewritten: ${fresh.ms} ms, ${fresh.input} in + ${fresh.output} out (${fresh.reasoning} reasoning) tokens`);
  for (const q of fresh.got) console.log(`     - ${q}`);
}

const said = process.env.QUESTIONS_SAID;
if (said && cards[0]) {
  const after = await measure(() => questions(pipeline.ctx, { card: brief(mind, cards[0]!), history: [{ who: 'user', text: said }] }));
  console.log(`\n## "${brief(mind, cards[0]).title}" after the user said "${said}"\n   ${after.ms} ms, ${after.input} in + ${after.output} out (${after.reasoning} reasoning) tokens`);
  for (const q of after.got) console.log(`     - ${q}`);
}
