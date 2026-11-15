/**
 * Routes the same utterances through the Conductor on the main model and on the quick model, alternating, and prints each one's
 * intent, reply, time and tokens, then the medians and every disagreement. Nothing is written to the mindstorm.
 * Usage: MIND_PALACE_DATA=<a copy of agents/data> tsx scripts/conductor-compare.ts [runs per side, default 2] [out.json]
 * The cases name cards by their titles in the user's mindstorm, so a copy of other data needs other cases.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Id } from '../src/core/domain.ts';
import type { JsonRequest, ModelClient } from '../src/core/ports.ts';
import { conductor } from '../src/core/roles/conductor.ts';
import { DEFAULT_SETTINGS, type Conducted, type RoleContext, type Scene, type Turn } from '../src/core/roles/types.ts';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { SqliteStore } from '../src/node/store.ts';
import { makeTools } from '../src/node/tools.ts';

const env = loadEnv();
const dataDir = env.MIND_PALACE_DATA ?? join(import.meta.dirname, '../data');
const runs = Number(process.argv[2] ?? 2);
const out = process.argv[3];

type Usage = { model: string; input: number; output: number; reasoning: number };
let usage: Usage[] = [];
const counting: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { model?: string };
  const u = res.ok ? (((await res.clone().json().catch(() => ({}))) as { usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } } }).usage ?? {}) : {};
  usage.push({ model: sent.model ?? '?', input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, reasoning: u.output_tokens_details?.reasoning_tokens ?? 0 });
  return res;
};
const main = new MetaModel({ apiKey: env.MODEL_API_KEY ?? '', baseUrl: env.MUSE_LLM_BASE_URL || undefined, model: env.MUSE_LLM_MODEL || undefined, quickModel: env.MIND_PALACE_QUICK_MODEL || undefined, fetch: counting });
const quick: ModelClient = { ...main, json: <T>(req: JsonRequest<T>) => main.json({ ...req, quick: true }), search: main.search.bind(main), image: main.image.bind(main), transcribe: main.transcribe.bind(main) };

const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
const saved = new SqliteStore(join(dataDir, 'mindstorm.sqlite'));
mind.load(saved.all());
saved.close();
const assets = new DiskAssets(join(dataDir, 'assets'));
const context = (model: ModelClient): RoleContext => ({
  mind, model, assets,
  tools: makeTools({ model, assets }),
  settings: { ...DEFAULT_SETTINGS },
  playback: () => ({ embeds: true, files: [] }),
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  note: (role, message) => console.log(`  note ${role}: ${message}`),
});

const card = (words: string): Id => {
  const found = [...mind.nodes.values()].find((n) => mind.itemOf(n.id).title.toLowerCase().includes(words.toLowerCase()));
  if (!found) throw new Error(`no card with "${words}" in its title`);
  return found.id;
};
const tree = (words: string): Id => [...mind.trees.values()].find((t) => t.title.toLowerCase().includes(words.toLowerCase()))!.id;
const genui = card('generative UI');
const at = (id: Id): Scene => ({ focus: id, selection: [], treeId: mind.node(id).treeId });
const nowhere: Scene = { selection: [] };
const found: Turn[] = [{ who: 'user', text: 'help me find something interesting' }, { who: 'agent', text: "I'll find something interesting for you." }];

interface Case { expect: string; utterance: string; scene: Scene; history?: Turn[] }
const cases: Case[] = [
  { expect: 'ask', utterance: 'Help me find something interesting to look at', scene: at(genui) },
  { expect: 'ask', utterance: 'Why do people say Clippy was the first generative UI?', scene: at(card('Clippy was the first')) },
  { expect: 'ask', utterance: 'I need examples of generative UI in video games', scene: at(genui) },
  { expect: 'ask', utterance: "Let's think about the soundtrack for this", scene: at(mind.tree(tree('Rural Travel')).rootId) },
  { expect: 'more', utterance: 'Could you bring a few more like the Starbucks one', scene: at(genui) },
  { expect: 'more', utterance: 'More of these, but only things from the last two years', scene: at(genui), history: found },
  { expect: 'navigate', utterance: 'Go to my standoffs tree', scene: nowhere },
  { expect: 'navigate', utterance: 'Open the one about mixed-initiative interfaces', scene: at(genui) },
  { expect: 'organize', utterance: 'Group the two code repos together', scene: at(genui) },
  { expect: 'organize', utterance: 'Rename this card to Generative interfaces', scene: at(genui) },
  { expect: 'handoff', utterance: 'Package this tree up for Claude Code so it can build a prototype', scene: at(genui) },
  { expect: 'capture', utterance: 'Note to self, ask Tracy about the json-render demo', scene: nowhere },
  { expect: 'capture', utterance: 'Remember that the Starbucks ordering flow only uses three components', scene: nowhere },
  { expect: 'keep', utterance: 'Keep the second and the fourth ones', scene: at(genui) },
  { expect: 'undo', utterance: 'Actually take back what you just did', scene: at(genui), history: [{ who: 'user', text: 'rename this card to Generative interfaces' }, { who: 'agent', text: 'On it.' }] },
  { expect: 'tree', utterance: "I'd love a whole new tree mapping out Hitchcock's films", scene: nowhere },
  { expect: 'tree', utterance: 'Grow a tree out of this one', scene: at(card('json-render')) },
  { expect: 'reply', utterance: "Thanks Momo, that's great", scene: at(genui), history: found },
  { expect: 'reply', utterance: 'Hello, are you there?', scene: nowhere },
  { expect: 'ask', utterance: '帮我找一些关于生成式界面的有趣例子', scene: at(genui) },
  { expect: 'navigate', utterance: '带我去乡村旅行插画那棵树', scene: nowhere },
  { expect: 'organize', utterance: 'Delete the roguelikes one', scene: at(genui) },
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const titleOf = (id?: Id) => (id && mind.nodes.has(id) ? `"${mind.itemOf(id).title.slice(0, 40)}"` : id && mind.trees.has(id) ? `tree "${mind.tree(id).title}"` : '');
const target = ({ intent: i }: Conducted): string => {
  switch (i.kind) {
    case 'ask': case 'more': return titleOf(i.anchor);
    case 'navigate': return titleOf(i.nodeId ?? i.treeId);
    case 'keep': return i.nodeIds.map((id) => mind.picks(genui).findIndex((n) => n.id === id) + 1).join('+');
    case 'organize': case 'handoff': return [...i.scope.treeIds.map(titleOf), ...i.scope.nodeIds.map(titleOf)].join(', ') || 'everything';
    case 'tree': return i.subject ? `"${i.subject}"` : i.itemIds.map((id) => `"${mind.item(id).title.slice(0, 40)}"`).join(', ');
    default: return '';
  }
};
const words = ({ intent: i }: Conducted): string =>
  i.kind === 'ask' || i.kind === 'more' ? (i.need ?? '') : i.kind === 'organize' ? i.request : i.kind === 'capture' ? i.text : i.kind === 'handoff' ? i.note : '';

interface Row { side: 'main' | 'quick'; ms: number; usage: Usage[]; kind: string; target: string; words: string; say: string }
const results: { case: Case; rows: Row[] }[] = [];
const sides = { main: context(main), quick: context(quick) };
for (const [n, c] of cases.entries()) {
  const rows: Row[] = [];
  for (let r = 0; r < runs; r++) {
    // Each run alternates which side goes first, so drift and warm connections favour neither.
    const order: ('main' | 'quick')[] = (n + r) % 2 === 0 ? ['main', 'quick'] : ['quick', 'main'];
    for (const side of order) {
      usage = [];
      const started = performance.now();
      const got = await conductor(sides[side], { utterance: c.utterance, scene: c.scene, history: c.history ?? [] });
      const ms = Math.round(performance.now() - started);
      if (usage.length !== 1) throw new Error(`"${c.utterance}" made ${usage.length} model calls on ${side}, expected 1: it took a plain rule or failed`);
      rows.push({ side, ms, usage, kind: got.intent.kind, target: target(got), words: words(got), say: got.say });
    }
  }
  results.push({ case: c, rows });
  console.log(`\n${n + 1}. [${c.expect}] "${c.utterance}"`);
  for (const row of rows) console.log(`   ${row.side.padEnd(5)} ${String(row.ms).padStart(6)} ms  ${row.usage[0]!.model} ${row.usage[0]!.input}+${row.usage[0]!.output} (${row.usage[0]!.reasoning} r)  ${row.kind} ${row.target}${row.words ? ` | ${row.words}` : ''} | says "${row.say}"`);
}

const all = results.flatMap((r) => r.rows);
for (const side of ['main', 'quick'] as const) {
  const mine = all.filter((r) => r.side === side);
  const ms = mine.map((r) => r.ms);
  const tokens = mine.flatMap((r) => r.usage);
  const right = results.filter((r) => r.rows.filter((x) => x.side === side).every((x) => x.kind === r.case.expect)).length;
  console.log(`\n${side}: ${mine.length} calls, median ${median(ms)} ms, range ${Math.min(...ms)} to ${Math.max(...ms)} ms; ` +
    `tokens in ${tokens.reduce((s, u) => s + u.input, 0)}, out ${tokens.reduce((s, u) => s + u.output, 0)} (reasoning ${tokens.reduce((s, u) => s + u.reasoning, 0)}); ` +
    `${right} of ${results.length} cases routed to the expected kind on every run`);
}
console.log('\nDisagreements (kind or target differs between any two runs of a case):');
for (const r of results) {
  const shapes = new Set(r.rows.map((x) => `${x.kind} ${x.target}`));
  if (shapes.size > 1) console.log(`- "${r.case.utterance}": ${r.rows.map((x) => `${x.side}=${x.kind} ${x.target}`).join('; ')}`);
}
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
