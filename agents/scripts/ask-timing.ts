/**
 * Says one thing to the agent about a card, through the whole pipeline as the service runs it, and prints when each piece landed:
 * the Conductor's reply, every delivery of picks, every format choice, every model call, search and download, with tokens per model.
 * Each run starts from the saved mindstorm as it is, and nothing is written to it.
 * Usage: MIND_PALACE_DATA=<a copy of agents/data> tsx scripts/ask-timing.ts [runs, default 3] ["what is said"] ["words from the card's title"] [out.json]
 * QUICK_ROLES=conductor,scout.curate,... sends those roles' requests to the quick model, and MAIN_ROLES to the main one, whatever the roles ask for.
 * COMPARE_ROLES=scout.curate,renderer.components,... asks both models every request of those roles and prints both answers side by side.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Id, Item, Node } from '../src/core/domain.ts';
import { Pipeline, type Outbound } from '../src/core/pipeline.ts';
import type { JsonRequest, ModelClient, Tools } from '../src/core/ports.ts';
import { roles } from '../src/core/roles/index.ts';
import { DEFAULT_SETTINGS } from '../src/core/roles/types.ts';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { SqliteStore } from '../src/node/store.ts';
import { makeTools } from '../src/node/tools.ts';

const env = loadEnv();
const dataDir = env.MIND_PALACE_DATA ?? join(import.meta.dirname, '../data');
const runs = Number(process.argv[2] ?? 3);
const said = process.argv[3] ?? 'Help me find something interesting to look at';
const cardWords = process.argv[4] ?? 'generative UI';
const out = process.argv[5];
const roleList = (name: string) => new Set((process.env[name] ?? '').split(',').map((r) => r.trim()).filter(Boolean));
const quickRoles = roleList('QUICK_ROLES');
const mainRoles = roleList('MAIN_ROLES');
const compareRoles = roleList('COMPARE_ROLES');

let t0 = 0;
const at = () => Math.round(performance.now() - t0);
interface Call { kind: string; role: string; model: string; start: number; end: number; input: number; output: number; reasoning: number; ok: boolean }
interface Span { what: string; start: number; end: number; detail: string }
let calls: Call[] = [];
let spans: Span[] = [];
let openai = { calls: 0, input: 0, output: 0 };
/** Requests still out. A run can be over while a picture is still being made, and it lands after. */
let inflight = 0;
const tracked = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
  inflight++;
  try {
    return await fetch(input, init);
  } finally {
    inflight--;
  }
};
const counting: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const start = at();
  const res = await tracked(input, init);
  if (url.host === 'api.openai.com') {
    const u = res.ok ? (((await res.clone().json().catch(() => ({}))) as { usage?: { input_tokens?: number; output_tokens?: number } }).usage ?? {}) : {};
    openai.calls++;
    openai.input += u.input_tokens ?? 0;
    openai.output += u.output_tokens ?? 0;
    spans.push({ what: 'openai', start, end: at(), detail: url.pathname });
  }
  return res;
};
type Usage = { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
/** The usage a reply reports, read from the body whole or from the last event of a stream. */
function usageOf(body: string): Usage {
  try {
    return ((JSON.parse(body) as { usage?: Usage }).usage ?? {});
  } catch {
    const completed = body.split('\n').filter((l) => l.startsWith('data:') && l.includes('"response.completed"')).at(-1);
    return completed ? ((JSON.parse(completed.slice(5)) as { response?: { usage?: Usage } }).response?.usage ?? {}) : {};
  }
}
const metaFetch: typeof fetch = async (input, init) => {
  const start = at();
  const res = await tracked(input, init);
  const sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { model?: string; text?: { format?: { name?: string } } };
  // The copy is read on the side, so a reply that streams reaches the client as it is written.
  inflight++;
  void res.clone().text().catch(() => '').then((body) => {
    inflight--;
    const u = res.ok ? usageOf(body) : {};
    calls.push({ kind: String(input).replace(/.*\/v1/, ''), role: sent.text?.format?.name ?? '?', model: sent.model ?? '?', start, end: at(), input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, reasoning: u.output_tokens_details?.reasoning_tokens ?? 0, ok: res.ok });
  });
  return res;
};
const meta = new MetaModel({ apiKey: env.MODEL_API_KEY ?? '', baseUrl: env.MUSE_LLM_BASE_URL || undefined, model: env.MUSE_LLM_MODEL || undefined, quickModel: env.MIND_PALACE_QUICK_MODEL || undefined, fetch: metaFetch });
const sideOf = (req: JsonRequest<unknown>): JsonRequest<unknown> =>
  quickRoles.has(req.role) ? { ...req, quick: true } : mainRoles.has(req.role) ? { ...req, quick: false } : req;
interface Pair { role: string; user: string; main: { ms: number; reply: unknown }; quick: { ms: number; reply: unknown } }
let pairs: Pair[] = [];
const answer = async (req: JsonRequest<unknown>) => {
  const started = performance.now();
  const reply = await meta.json(req).catch((err: unknown) => ({ failed: String(err) }));
  return { ms: Math.round(performance.now() - started), reply };
};
const model: ModelClient = {
  json: async <T>(req: JsonRequest<T>): Promise<T> => {
    if (!compareRoles.has(req.role)) return meta.json(sideOf(req) as JsonRequest<T>);
    // Both models answer the same request. The run goes on with the side the role is set to, so the comparison does not steer it.
    const [main, quick] = await Promise.all([answer({ ...req, quick: false }), answer({ ...req, quick: true })]);
    pairs.push({ role: req.role, user: req.user, main, quick });
    const used = sideOf(req).quick ? quick.reply : main.reply;
    if (used && typeof used === 'object' && 'failed' in used) throw new Error(String(used.failed));
    return used as T;
  },
  search: (req) => meta.search(req),
  image: (req) => meta.image(req),
  transcribe: (req) => meta.transcribe(req),
};

const timed = <A extends unknown[], R>(what: string, fn: (...args: A) => Promise<R>, detail: (...args: A) => string) => async (...args: A): Promise<R> => {
  const start = at();
  try {
    return await fn(...args);
  } finally {
    spans.push({ what, start, end: at(), detail: detail(...args) });
  }
};

const assets = new DiskAssets(join(dataDir, 'assets'));
const keys = { YOUTUBE_API_KEY: env.YOUTUBE_API_KEY, TMDB_API_KEY: env.TMDB_API_KEY, EUROPEANA_API_KEY: env.EUROPEANA_API_KEY, GUARDIAN_API_KEY: env.GUARDIAN_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, MIND_PALACE_SEARCH_MODEL: env.MIND_PALACE_SEARCH_MODEL };
const real = makeTools({ model, assets, keys, fetch: counting });
const tools: Tools = {
  ...real,
  web: {
    ...real.web,
    picture: timed('picture', real.web.picture, (url) => url.slice(0, 60)),
    videos: timed('videos', real.web.videos, (q) => q),
  },
  sources: { list: real.sources.list, search: timed('source', real.sources.search, (id, q) => `${id}: ${q}`) },
  images: { generate: timed('image', real.images.generate, (p) => p.slice(0, 50)) },
};

interface Landed { at: number; role: string; label: string; picks: { kind: string; tool: string; title: string; why: string; summary: string }[]; views: string[]; nodeIds: Id[] }
interface Result { pairs: Pair[]; run: number; says: { at: number; text: string }[]; navigates: { at: number; nodeId?: Id; treeId?: Id }[]; landed: Landed[]; notes: string[]; calls: Call[]; spans: Span[]; openai: typeof openai; idle: number; intent: string }
const results: Result[] = [];

for (let run = 1; run <= runs; run++) {
  const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
  const saved = new SqliteStore(join(dataDir, 'mindstorm.sqlite'));
  mind.load(saved.all());
  saved.close();
  const anchor = [...mind.nodes.values()].find((n) => n.status === 'kept' && mind.itemOf(n.id).title.toLowerCase().includes(cardWords.toLowerCase()));
  if (!anchor) throw new Error(`no kept card with "${cardWords}" in its title`);
  calls = [];
  pairs = [];
  spans = [];
  openai = { calls: 0, input: 0, output: 0 };
  const result: Result = { pairs, run, says: [], navigates: [], landed: [], notes: [], calls, spans, openai, idle: 0, intent: '' };
  const emit = (m: Outbound) => {
    if (m.t === 'say') result.says.push({ at: at(), text: m.text });
    if (m.t === 'navigate') result.navigates.push({ at: at(), nodeId: m.nodeId, treeId: m.treeId });
    if (m.t === 'note') result.notes.push(`${at()} ${m.role}: ${m.message}`);
    if (m.t === 'activity' && m.activity.role === 'scout' && m.activity.state === 'start') result.intent = m.activity.message;
    if (m.t !== 'change') return;
    const role = m.set.origin.role ?? 'user';
    const items = new Map(m.set.patches.filter((p) => p.entity === 'item' && p.after).map((p) => [p.id, p.after as Item]));
    const added = m.set.patches.filter((p) => p.entity === 'node' && p.before === null && p.after).map((p) => p.after as Node);
    const viewed = m.set.patches.filter((p) => p.entity === 'node' && p.before && p.after && (p.after as { view: { component: string } }).view.component !== (p.before as { view: { component: string } }).view.component);
    result.landed.push({
      at: at(),
      role,
      label: m.set.label,
      nodeIds: added.map((n) => n.id),
      picks: added.map((n) => {
        const item = items.get(n.itemId) ?? mind.item(n.itemId);
        return { kind: item.kind, tool: n.origin.tool ?? '', title: item.title, why: n.why, summary: item.summary.slice(0, 200) };
      }),
      views: viewed.map((p) => `${mind.nodes.get(p.id) ? mind.itemOf(p.id).title.slice(0, 50) : p.id} -> ${(p.after as { view: { component: string } }).view.component}`),
    });
  };
  const pipeline = new Pipeline({
    mind, roles, model, tools, assets,
    store: { append: () => {}, all: () => [] },
    settings: { ...DEFAULT_SETTINGS },
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    emit,
    playback: () => ({ embeds: false, files: ['mp4', 'm4a', 'mp3'] }),
  });
  t0 = performance.now();
  pipeline.utter(said, { focus: anchor.id, selection: [], treeId: anchor.treeId }, true);
  await pipeline.idle();
  for (let waited = 0; inflight > 0 && waited < 150_000; waited += 200) await new Promise((r) => setTimeout(r, 200));
  await pipeline.idle();
  result.idle = at();
  results.push(result);

  const scoutSets = result.landed.filter((l) => l.role === 'scout' && l.picks.length > 0);
  console.log(`\n=== run ${run}: "${said}" on "${mind.itemOf(anchor.id).title}"${quickRoles.size ? ` (quick: ${[...quickRoles].join(', ')})` : ''}`);
  for (const s of result.says) console.log(`  ${String(s.at).padStart(6)} say "${s.text}"`);
  for (const n of result.navigates) console.log(`  ${String(n.at).padStart(6)} navigate ${n.nodeId ?? n.treeId}`);
  console.log(`  scout: ${result.intent}`);
  for (const l of result.landed) {
    console.log(`  ${String(l.at).padStart(6)} change by ${l.role}: ${l.label} (${l.picks.length} new nodes${l.views.length ? `, ${l.views.length} views` : ''})`);
    for (const p of l.picks) console.log(`           + [${p.kind} via ${p.tool}] ${p.title}  | ${p.why}\n               ${p.summary.replace(/\s+/g, ' ').slice(0, 160)}`);
    for (const v of l.views) console.log(`           ~ ${v}`);
  }
  console.log('  model calls:');
  for (const c of [...calls].sort((a, b) => a.start - b.start)) {
    console.log(`  ${String(c.start).padStart(6)} → ${String(c.end).padStart(6)} (${String(c.end - c.start).padStart(5)} ms) ${c.role.padEnd(20)} ${c.model} ${c.input}+${c.output} (${c.reasoning} r)${c.ok ? '' : ' FAILED'}`);
  }
  console.log('  tools:');
  for (const s of [...spans].sort((a, b) => a.start - b.start)) console.log(`  ${String(s.start).padStart(6)} → ${String(s.end).padStart(6)} (${String(s.end - s.start).padStart(5)} ms) ${s.what} ${s.detail}`);
  for (const n of result.notes) console.log(`  note ${n}`);
  for (const pair of pairs) showPair(pair);
  const byModel = new Map<string, { calls: number; input: number; output: number; reasoning: number }>();
  for (const c of calls) {
    const m = byModel.get(c.model) ?? { calls: 0, input: 0, output: 0, reasoning: 0 };
    byModel.set(c.model, { calls: m.calls + 1, input: m.input + c.input, output: m.output + c.output, reasoning: m.reasoning + c.reasoning });
  }
  const conductorCall = calls.find((c) => c.role === 'conductor');
  console.log(`  SUMMARY run ${run}: conductor ${conductorCall ? conductorCall.end - conductorCall.start : 0} ms, first say ${result.says[0]?.at ?? '-'} ms, ` +
    `first pick ${scoutSets[0]?.at ?? '-'} ms, first find ${scoutSets.find((l) => l.picks.some((p) => p.tool !== 'idea'))?.at ?? '-'} ms, last pick ${scoutSets.at(-1)?.at ?? '-'} ms, ${scoutSets.reduce((s, l) => s + l.picks.length, 0)} picks in ${scoutSets.length} deliveries, ` +
    `last view ${result.landed.filter((l) => l.role === 'renderer').at(-1)?.at ?? '-'} ms, line ${result.says.length > 1 ? result.says.at(-1)!.at : '-'} ms, idle ${result.idle} ms`);
  console.log(`  TOKENS run ${run}: ${[...byModel].map(([m, t]) => `${m} ${t.calls} calls ${t.input} in + ${t.output} out (${t.reasoning} reasoning)`).join('; ')}; openai ${openai.calls} calls ${openai.input} in + ${openai.output} out`);
}
if (out) writeFileSync(out, JSON.stringify(results, null, 2));

function showPair({ role, user, main, quick }: Pair): void {
  const lines = user.split('\n');
  type Chosen = { chosen?: { number: number; note: string; excerpt: string }[] };
  type Drawn = { items?: { id: string; component: string; factValue?: string; quoteText?: string; chartLabels?: string[]; steps?: string[]; emphasis?: string }[] };
  type Grouped = { groups?: { parent: string; composite: string; title: string; members: string[]; theme?: string }[] };
  if (role === 'scout.curate') {
    const records = lines.filter((l) => /^\d+\. "/.test(l)).map((l) => l.replace(/^(\d+)\. "([^"]{0,90}).*$/, '$1. $2'));
    console.log(`\n  PAIR curate: ${lines[0]!.slice(0, 160)}\n    ${lines.find((l) => l.startsWith('A search of')) ?? ''}`);
    for (const r of records) console.log(`      ${r}`);
    for (const [side, got] of [['main', main], ['quick', quick]] as const) {
      const chosen = (got.reply as Chosen).chosen ?? [];
      console.log(`    ${side} ${got.ms} ms chose ${chosen.map((c) => c.number).join(', ') || 'none'}`);
      for (const c of chosen) console.log(`      ${c.number}: ${c.note.slice(0, 220)}${c.excerpt ? ` | excerpt: ${c.excerpt.slice(0, 120)}` : ''}`);
    }
  } else if (role === 'renderer.components') {
    const titles = new Map<string, string>();
    lines.forEach((l, i) => l.startsWith('id: ') && titles.set(l.slice(4), (lines[i + 1] ?? '').replace(/^title: /, '').slice(0, 60)));
    const of = (reply: unknown) => new Map(((reply as Drawn).items ?? []).map((it) => [it.id, `${it.component}${it.factValue ? ` ${it.factValue}` : ''}${it.quoteText ? ` "${it.quoteText.slice(0, 40)}"` : ''}${it.chartLabels?.length ? ` [${it.chartLabels.join(', ')}]` : ''}${it.steps?.length ? ` ${it.steps.length} steps` : ''}${it.emphasis ? ` emphasis "${it.emphasis.slice(0, 40)}"` : ''}`]));
    const [a, b] = [of(main.reply), of(quick.reply)];
    console.log(`\n  PAIR components: main ${main.ms} ms, quick ${quick.ms} ms`);
    for (const [id, title] of titles) console.log(`      ${title.padEnd(60)} main ${a.get(id) ?? '-'} | quick ${b.get(id) ?? '-'}`);
  } else if (role === 'renderer.composites') {
    const groups = (reply: unknown) => ((reply as Grouped).groups ?? []).map((g) => `${g.composite} "${g.title}" (${g.members.length})`).join('; ') || 'none';
    console.log(`\n  PAIR composites: main ${main.ms} ms ${groups(main.reply)} | quick ${quick.ms} ms ${groups(quick.reply)}`);
  } else {
    console.log(`\n  PAIR ${role}: main ${main.ms} ms ${JSON.stringify(main.reply).slice(0, 300)}\n    quick ${quick.ms} ms ${JSON.stringify(quick.reply).slice(0, 300)}`);
  }
}
