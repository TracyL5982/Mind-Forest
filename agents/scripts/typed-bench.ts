/**
 * Routes the tree-or-layer requests of scripts/live-requests.ts (`INTENT`) through the Conductor as typed requests, each where it
 * is said, on the service's own models, and prints the right kind of N per group, the questions asked back, and every miss.
 * Nothing is written to the mindstorm.
 * The Meta key is shared, so requests go `--pace` ms apart.
 * Usage: node --no-warnings --import tsx scripts/typed-bench.ts --data <a copy of agents/data> [--runs 3] [--pace 2500] [--out results.jsonl] [--only l1,u3]
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { conductor } from '../src/core/roles/conductor.ts';
import { DEFAULT_SETTINGS, type Conducted, type RoleContext } from '../src/core/roles/types.ts';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { SqliteStore } from '../src/node/store.ts';
import { makeTools } from '../src/node/tools.ts';
import { INTENT, sceneAt } from './live-requests.ts';

const { values: flags } = parseArgs({ options: { data: { type: 'string' }, runs: { type: 'string', default: '3' }, pace: { type: 'string', default: '2500' }, out: { type: 'string' }, only: { type: 'string' } } });
if (!flags.data) {
  console.error('usage: typed-bench.ts --data <a copy of agents/data> [--runs 3] [--out results.jsonl] [--only ids]');
  process.exit(1);
}
const env = loadEnv();
let calls = 0;
const model = new MetaModel({
  apiKey: env.MODEL_API_KEY ?? '',
  baseUrl: env.MUSE_LLM_BASE_URL || undefined,
  model: env.MUSE_LLM_MODEL || undefined,
  quickModel: env.MIND_PALACE_QUICK_MODEL || undefined,
  onCall: () => calls++,
});
const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
const saved = new SqliteStore(join(flags.data, 'mindstorm.sqlite'));
mind.load(saved.all());
saved.close();
const assets = new DiskAssets(join(flags.data, 'assets'));
const ctx: RoleContext = {
  mind, model, assets,
  tools: makeTools({ model, assets }),
  settings: { ...DEFAULT_SETTINGS },
  playback: () => ({ embeds: true, files: [] }),
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  note: (role, message) => console.log(`  note ${role}: ${message}`),
  step: (_role, _label, body) => body(),
};

const named = (id?: string) => (id && mind.nodes.has(id) ? `"${mind.itemOf(id).title.slice(0, 40)}"` : '');
const target = ({ intent: i }: Conducted): string =>
  i.kind === 'ask' || i.kind === 'more' ? `${named(i.anchor)}${i.need ? ` | ${i.need}` : ''}` : i.kind === 'tree' ? (i.subject ? `"${i.subject}"` : i.itemIds.map((id) => `"${mind.item(id).title.slice(0, 40)}"`).join(', ')) : '';

const requests = INTENT.filter((r) => r.typed && (!flags.only || flags.only.split(',').includes(r.id)));
const runs = Number(flags.runs);
const rows: { id: string; group: string; run: number; kind: string; right: boolean; say: string; target: string; ms: number; calls: number }[] = [];
for (let run = 1; run <= runs; run++) {
  for (const r of requests) {
    const scene = sceneAt(mind, r.where ?? 'nothing');
    if (!scene) throw new Error(`${r.id} is said where the data has nothing: ${JSON.stringify(r.where)}`);
    if (rows.length > 0) await new Promise((ok) => setTimeout(ok, Number(flags.pace)));
    const before = calls;
    const started = performance.now();
    const got = await conductor(ctx, { utterance: r.text, scene, history: [] });
    const kind = got.intent.kind;
    const right = r.typed!.includes(kind) && (kind !== 'reply' || got.say.includes('?'));
    const row = { id: r.id, group: r.group, run, kind, right, say: got.say, target: target(got), ms: Math.round(performance.now() - started), calls: calls - before };
    rows.push(row);
    if (flags.out) appendFileSync(flags.out, `${JSON.stringify({ ...row, text: r.text, expected: r.typed, at: new Date().toISOString() })}\n`);
    console.log(`${run} ${r.id.padEnd(4)} ${right ? 'right' : 'WRONG'} ${kind.padEnd(6)} ${String(row.ms).padStart(5)} ms ${row.calls} call ${row.target} | says "${got.say}"`);
  }
}

console.log('');
for (let run = 1; run <= runs; run++) {
  const mine = rows.filter((x) => x.run === run);
  const groups = [...new Set(mine.map((x) => x.group))];
  console.log(`run ${run}: ${groups.map((g) => `${g} ${mine.filter((x) => x.group === g && x.right).length} of ${mine.filter((x) => x.group === g).length}`).join(', ')}`);
}
const unsure = rows.filter((x) => x.group === 'layer or tree' || x.group === 'no card');
console.log(`asked back where a question was expected: ${unsure.filter((x) => x.kind === 'reply' && x.say.includes('?')).length} of ${unsure.length}; trees started there: ${unsure.filter((x) => x.kind === 'tree').length}`);
console.log(`model calls: ${calls}`);
for (const x of rows.filter((y) => !y.right)) console.log(`  wrong: run ${x.run} ${x.id} ${x.kind} ${x.target} | "${x.say}"`);
