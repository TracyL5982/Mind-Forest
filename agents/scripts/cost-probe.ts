/**
 * Drops typed thoughts into a fresh mindstorm through the whole pipeline, each asking for a tree, and counts what each provider was asked for.
 * Usage: tsx scripts/cost-probe.ts ["a thought" ...]
 * Token counts come from each provider's own usage field. Prices are passed in, not looked up.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline } from '../src/core/pipeline.ts';
import { roles } from '../src/core/roles/index.ts';
import { DEFAULT_SETTINGS } from '../src/core/roles/types.ts';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { SqliteStore } from '../src/node/store.ts';
import { makeTools } from '../src/node/tools.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data-cost');
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
const env = loadEnv();

type Tally = { calls: number; input: number; cached: number; output: number; searches: number; images: number };
const blank = (): Tally => ({ calls: 0, input: 0, cached: 0, output: 0, searches: 0, images: 0 });
let meta = blank();
let openai = blank();
let others = new Map<string, number>();

type Usage = {
  input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number;
  input_tokens_details?: { cached_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number };
};
const counting: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const tally = url.host === 'api.openai.com' ? openai : /meta\.ai$/.test(url.host) && url.pathname.startsWith('/v1') ? meta : null;
  if (!tally) {
    others.set(url.host, (others.get(url.host) ?? 0) + 1);
    return res;
  }
  if (!res.ok) return res;
  const json = (await res.clone().json().catch(() => ({}))) as { usage?: Usage; output?: { type?: string }[] };
  const u = json.usage ?? {};
  tally.calls++;
  tally.input += u.input_tokens ?? u.prompt_tokens ?? 0;
  tally.output += u.output_tokens ?? u.completion_tokens ?? 0;
  tally.cached += u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  tally.searches += (json.output ?? []).filter((o) => o.type === 'web_search_call').length;
  if (url.pathname.endsWith('/images/generations')) tally.images++;
  return res;
};

const model = new MetaModel({ apiKey: env.MODEL_API_KEY ?? '', model: env.MUSE_LLM_MODEL || undefined, fetch: counting });
const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
const assets = new DiskAssets(join(dataDir, 'assets'));
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
  store: new SqliteStore(join(dataDir, 'mindstorm.sqlite')),
  settings: { ...DEFAULT_SETTINGS },
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  emit: () => {},
  settleMs: 50,
});

const thoughts = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'A reading app for kids that adapts the next story to the words they stumbled on.',
      'Memo: replace parking minimums downtown with maximums and see what developers build.',
      'Ten days in Japan in March, mostly trains, want quiet towns more than cities.',
      'Should we add batteries to the rooftop solar, or is the payback too long?',
      'Why does sourdough rise more slowly in winter, and what do bakers change?',
    ];

const sum = (a: Tally, b: Tally): Tally => ({
  calls: a.calls + b.calls, input: a.input + b.input, cached: a.cached + b.cached, output: a.output + b.output,
  searches: a.searches + b.searches, images: a.images + b.images,
});
let metaAll = blank();
let openaiAll = blank();
const otherAll = new Map<string, number>();
for (const thought of thoughts) {
  meta = blank();
  openai = blank();
  others = new Map();
  const started = Date.now();
  await pipeline.dump([{ kind: 'text', text: `${thought} Start a tree on this.` }]);
  await pipeline.idle();
  const picks = [...mind.nodes.values()].filter((n) => n.status === 'pick').length;
  console.log(JSON.stringify({ thought: thought.slice(0, 50), seconds: Math.round((Date.now() - started) / 1000), picksSoFar: picks, meta, openai, others: Object.fromEntries(others) }));
  metaAll = sum(metaAll, meta);
  openaiAll = sum(openaiAll, openai);
  for (const [h, n] of others) otherAll.set(h, (otherAll.get(h) ?? 0) + n);
}
console.log(JSON.stringify({ total: { thoughts: thoughts.length, meta: metaAll, openai: openaiAll, others: Object.fromEntries(otherAll) } }));
rmSync(dataDir, { recursive: true, force: true });
