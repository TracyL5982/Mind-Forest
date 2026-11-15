/**
 * Runs the knowledge-base rules live against a copy of a mindstorm: drops a thought, then asks for a tree, and prints where the
 * thought went, the new root's round (what the user already had and what is new) and anything that repeats inside the tree.
 * Given a question, it then asks it about the new root and prints what joined the round and what made room.
 * Usage: MIND_PALACE_DATA=<a copy of a data folder> tsx scripts/mindstorm-check.ts "<a thought>" "<a subject>" ["<a question>"]
 * It writes into that folder, so never point it at the folder a service runs on. Tokens come from each provider's own usage field.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Pipeline } from '../src/core/pipeline.ts';
import { roles } from '../src/core/roles/index.ts';
import { DEFAULT_SETTINGS } from '../src/core/roles/types.ts';
import { isKnown, sameness } from '../src/core/round.ts';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { SqliteStore } from '../src/node/store.ts';
import { makeTools } from '../src/node/tools.ts';

const env = loadEnv();
const dataDir = process.env.MIND_PALACE_DATA;
if (!dataDir || !existsSync(join(dataDir, 'mindstorm.sqlite'))) throw new Error('Set MIND_PALACE_DATA to a copy of a data folder.');
if (existsSync(join(dataDir, 'service.pid'))) throw new Error(`${dataDir} has a service.pid: a service may be running on it. Use a copy.`);
const [thought, subject, question] = [process.argv[2], process.argv[3], process.argv[4]];
if (!thought || !subject) throw new Error('Usage: tsx scripts/mindstorm-check.ts "<a thought>" "<a subject>"');

type Side = { calls: number; input: number; output: number; searches: number };
const tally: { meta: Side; openai: Side; images: number } = { meta: { calls: 0, input: 0, output: 0, searches: 0 }, openai: { calls: 0, input: 0, output: 0, searches: 0 }, images: 0 };
const counting: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const side = url.host === 'api.openai.com' ? tally.openai : /meta\.ai$/.test(url.host) && url.pathname.startsWith('/v1') ? tally.meta : null;
  if (!side || !res.ok) return res;
  const json = (await res.clone().json().catch(() => ({}))) as { usage?: Record<string, number>; output?: { type?: string }[] };
  side.calls++;
  side.input += json.usage?.input_tokens ?? json.usage?.prompt_tokens ?? 0;
  side.output += json.usage?.output_tokens ?? json.usage?.completion_tokens ?? 0;
  side.searches += (json.output ?? []).filter((o) => o.type === 'web_search_call').length;
  if (url.pathname.endsWith('/images/generations')) tally.images++;
  return res;
};

const model = new MetaModel({ apiKey: env.MODEL_API_KEY ?? '', model: env.MUSE_LLM_MODEL || undefined, fetch: counting });
const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
const store = new SqliteStore(join(dataDir, 'mindstorm.sqlite'));
mind.load(store.all());
const assets = new DiskAssets(join(dataDir, 'assets'));
const notes: string[] = [];
const pipeline = new Pipeline({
  mind,
  roles,
  model,
  tools: makeTools({
    model,
    assets,
    fetch: counting,
    keys: {
      YOUTUBE_API_KEY: env.YOUTUBE_API_KEY, TMDB_API_KEY: env.TMDB_API_KEY, EUROPEANA_API_KEY: env.EUROPEANA_API_KEY,
      GUARDIAN_API_KEY: env.GUARDIAN_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, MIND_PALACE_SEARCH_MODEL: env.MIND_PALACE_SEARCH_MODEL,
    },
  }),
  assets,
  store,
  settings: { ...DEFAULT_SETTINGS },
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  emit: (m) => {
    if (m.t === 'note') notes.push(`${m.role}: ${m.message}`);
    if (m.t === 'say') console.log(`  says: ${m.text}`);
  },
  settleMs: 50,
});
const started = Date.now();
const title = (id: string) => mind.itemOf(id).title.slice(0, 80);

const treesBefore = new Set(mind.trees.keys());
const itemsBefore = new Set(mind.items.keys());
console.log(`Mindstorm: ${mind.items.size} items, ${mind.trees.size} trees, ${mind.unplaced().length} unplaced.`);

console.log(`\n1. Dump: "${thought}"`);
await pipeline.dump([{ kind: 'text', text: thought }]);
await pipeline.idle();
const dropped = [...mind.items.values()].filter((i) => !itemsBefore.has(i.id) && i.origin.by === 'user');
const made = [...mind.trees.keys()].filter((id) => !treesBefore.has(id));
console.log(`   new trees: ${made.length}`);
for (const item of dropped) {
  const nodes = mind.nodesOfItem(item.id);
  console.log(nodes.length === 0 ? `   "${item.title}" stays in the knowledge base` : nodes.map((n) => `   "${item.title}" is a ${n.status} under "${title(n.parent!)}" in "${mind.tree(n.treeId).title}" (${n.why})`).join('\n'));
}

console.log(`\n2. Say: "make a tree about ${subject}"`);
const before = new Set(mind.trees.keys());
pipeline.utter(`make a tree about ${subject}`, { selection: [] }, true);
await pipeline.idle();
const tree = [...mind.trees.values()].find((t) => !before.has(t.id));
if (!tree) {
  console.log('   no tree was made');
  process.exit(1);
}
console.log(`   tree "${tree.title}", root "${title(tree.rootId)}" (${mind.itemOf(tree.rootId).source.from})`);
const show = () => {
  const picks = mind.picks(tree.rootId);
  for (const n of picks) console.log(`   ${isKnown(n) ? 'HAD' : 'NEW'} [${n.origin.tool}] ${title(n.id)}  (${n.why}, importance ${n.importance})`);
  const seen = new Map<string, string>();
  const repeats: string[] = [];
  for (const n of mind.treeNodes(tree.id)) {
    for (const key of sameness(mind.item(n.itemId))) {
      if (seen.has(key) && seen.get(key) !== n.id) repeats.push(`${key}: "${title(seen.get(key)!)}" and "${title(n.id)}"`);
      seen.set(key, n.id);
    }
  }
  const known = picks.filter(isKnown).length;
  console.log(`   Round: ${picks.length} picks, ${known} the user already had, ${picks.length - known} new. Repeats in the tree: ${repeats.length ? repeats.join('; ') : 'none'}.`);
  return picks;
};
const first = show();
if (question) {
  console.log(`\n3. Ask about "${title(tree.rootId)}": "${question}"`);
  const before = new Map(first.map((n) => [n.id, title(n.id)]));
  await pipeline.ask(tree.rootId, question);
  await pipeline.idle();
  const after = show();
  const gone = first.filter((n) => !mind.nodes.has(n.id)).map((n) => `"${before.get(n.id)}"`);
  console.log(`   made room: ${gone.join(', ') || 'nothing'}; joined: ${after.filter((n) => !before.has(n.id)).length}`);
}
console.log(`Time: ${Math.round((Date.now() - started) / 1000)} s. Notes: ${notes.length}`);
for (const note of notes) console.log(`   ${note}`);
console.log(`Usage: ${JSON.stringify(tally)}`);
store.close();
