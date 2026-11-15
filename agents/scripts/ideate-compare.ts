/**
 * Asks several models to think of the Scout's directions for the same cards and the same request, alternating, and prints each
 * one's directions side by side with its time and tokens. The rating of ties to what the user has is compared the same way.
 * The request each model gets is the one the Scout itself writes, caught before it is sent. Nothing is written to the mindstorm.
 * Usage: MIND_PALACE_DATA=<a copy of agents/data> tsx scripts/ideate-compare.ts [runs per option, default 2] [out.json]
 * The cases name cards by their titles in the user's mindstorm, so a copy of other data needs other cases.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { JsonRequest, ModelClient } from '../src/core/ports.ts';
import { scout } from '../src/core/roles/scout.ts';
import { DEFAULT_SETTINGS, type RoleContext, type Turn } from '../src/core/roles/types.ts';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel, strictSchema } from '../src/node/model-meta.ts';
import { SqliteStore } from '../src/node/store.ts';
import { makeTools } from '../src/node/tools.ts';

const env = loadEnv();
const dataDir = env.MIND_PALACE_DATA ?? join(import.meta.dirname, '../data');
const runs = Number(process.argv[2] ?? 2);
const out = process.argv[3];

interface Usage { input: number; output: number; reasoning: number }
let usage: Usage | null = null;
const metaFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const u = res.ok ? (((await res.clone().json().catch(() => ({}))) as { usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } } }).usage ?? {}) : {};
  usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, reasoning: u.output_tokens_details?.reasoning_tokens ?? 0 };
  return res;
};
const meta = (model?: string) => new MetaModel({ apiKey: env.MODEL_API_KEY ?? '', baseUrl: env.MUSE_LLM_BASE_URL || undefined, model, fetch: metaFetch });
const spark = meta(env.MUSE_LLM_MODEL || undefined);
const ember = meta('muse-ember-1.0');

function dropNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNulls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, dropNulls(v)]));
}

/** One structured reply from OpenAI's Responses API, the way the Meta client asks for one. */
async function openai<T>(req: JsonRequest<T>, model: string, effort: string): Promise<T> {
  const content: unknown[] = [{ type: 'input_text', text: req.user }, ...(req.images ?? []).map((url) => ({ type: 'input_image', image_url: url }))];
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ role: 'system', content: req.system }, { role: 'user', content }],
      reasoning: { effort },
      text: { format: { type: 'json_schema', name: req.role.replace(/[^a-zA-Z0-9_-]/g, '_'), schema: strictSchema(z.toJSONSchema(req.schema, { io: 'input' })), strict: true } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`OpenAI answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { output?: { type: string; content?: { type: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } } };
  usage = { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0, reasoning: json.usage?.output_tokens_details?.reasoning_tokens ?? 0 };
  const text = (json.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('');
  return req.schema.parse(dropNulls(JSON.parse(text)));
}

type Option = { name: string; ask: (req: JsonRequest<unknown>) => Promise<unknown> };
const every: Option[] = [
  { name: 'spark low (today)', ask: (req) => spark.json(req) },
  { name: 'spark minimal', ask: (req) => spark.json({ ...req, effort: 'minimal' as 'low' }) },
  { name: 'ember low', ask: (req) => ember.json(req) },
  { name: 'ember minimal', ask: (req) => ember.json({ ...req, quick: true }) },
  { name: 'gpt-5.4-mini low', ask: (req) => openai(req, 'gpt-5.4-mini', 'low') },
  { name: 'gpt-5.4-mini minimal', ask: (req) => openai(req, 'gpt-5.4-mini', 'minimal') },
];
const options = every.filter((o) => !process.env.OPTIONS || process.env.OPTIONS.split(',').some((w) => o.name.startsWith(w.trim())));

const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
const saved = new SqliteStore(join(dataDir, 'mindstorm.sqlite'));
mind.load(saved.all());
saved.close();
const assets = new DiskAssets(join(dataDir, 'assets'));
const card = (words: string) => {
  const found = [...mind.nodes.values()].find((n) => n.status === 'kept' && mind.itemOf(n.id).title.toLowerCase().includes(words.toLowerCase()));
  if (!found) throw new Error(`no kept card with "${words}" in its title`);
  return found.id;
};
const cases: { card: string; said: string; need: string }[] = [
  { card: 'generative UI', said: 'Help me find something interesting to look at', need: 'something interesting to look at about generative UI' },
  { card: 'Aerial illustration', said: 'I want to brainstorm world building for this', need: 'world building for this aerial illustration of a car on a winding road through yellow fields' },
  { card: 'The standoff', said: 'Show me examples of standoffs in horror films', need: 'examples of standoffs in horror films' },
];

/** Catches the requests the Scout writes for its directions and its ratings, and sends none. */
async function requestsFor(c: (typeof cases)[number]): Promise<{ ideate: JsonRequest<unknown>; rate?: JsonRequest<unknown> }> {
  const caught: Record<string, JsonRequest<unknown>> = {};
  const catcher: ModelClient = {
    json: async <T>(req: JsonRequest<T>): Promise<T> => {
      caught[req.role] = req as JsonRequest<unknown>;
      if (req.role === 'scout.rate') return req.schema.parse({ ratings: [] });
      throw new Error('caught');
    },
    search: async () => [],
    image: async () => { throw new Error('caught'); },
    transcribe: async () => '',
  };
  const ctx: RoleContext = {
    mind, model: catcher, assets,
    tools: makeTools({ model: catcher, assets }),
    settings: { ...DEFAULT_SETTINGS },
    playback: () => ({ embeds: false, files: ['mp4', 'm4a', 'mp3'] }),
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    note: () => {},
    step: (_role, _label, body) => body(),
  };
  const history: Turn[] = [{ who: 'user', text: c.said }, { who: 'agent', text: 'Looking into that.' }];
  await scout(ctx, { anchor: card(c.card), need: c.need, history });
  if (!caught['scout.ideate']) throw new Error(`the Scout wrote no directions request for "${c.card}"`);
  return { ideate: caught['scout.ideate'], rate: caught['scout.rate'] };
}

type Direction = {
  angle: string; format: string; title: string; body: string; why: string; source: string; lookups: string[]; images: { title: string; prompt: string }[];
  lines: string[]; pros: string[]; cons: string[]; subject: string; passage: string; by: string;
};
type Directions = { reading: string; directions: Direction[] };
/** What a written idea holds beside its body, as one line. */
const contents = (d: Direction) =>
  [d.subject, d.passage && `"${d.passage}"`, d.by && `(${d.by})`, ...d.lines.map((l) => `· ${l}`), ...d.pros.map((p) => `+ ${p}`), ...d.cons.map((c) => `- ${c}`)].filter(Boolean).join(' ');
interface Answer { option: string; run: number; ms: number; usage: Usage | null; reply?: unknown; error?: string }
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const results: { case: (typeof cases)[number]; ideate: Answer[]; rate: Answer[] }[] = [];
for (const c of cases) {
  const { ideate, rate } = await requestsFor(c);
  const ideas: Answer[] = [];
  const rates: Answer[] = [];
  for (let run = 0; run < runs; run++) {
    // Each run starts with a different option, so drift and warm connections favour none.
    const order = options.map((_, i) => options[(i + run + results.length) % options.length]!);
    for (const option of order) {
      usage = null;
      const started = performance.now();
      try {
        const reply = await option.ask(ideate);
        ideas.push({ option: option.name, run, ms: Math.round(performance.now() - started), usage, reply });
      } catch (err) {
        ideas.push({ option: option.name, run, ms: Math.round(performance.now() - started), usage, error: String(err).slice(0, 300) });
      }
    }
    if (rate) {
      for (const option of run % 2 === 0 ? [options[0]!, options.find((o) => o.name === 'ember minimal')!] : [options.find((o) => o.name === 'ember minimal')!, options[0]!]) {
        if (!option) continue;
        usage = null;
        const started = performance.now();
        try {
          const reply = await option.ask(rate);
          rates.push({ option: option.name, run, ms: Math.round(performance.now() - started), usage, reply });
        } catch (err) {
          rates.push({ option: option.name, run, ms: Math.round(performance.now() - started), usage, error: String(err).slice(0, 300) });
        }
      }
    }
  }
  results.push({ case: c, ideate: ideas, rate: rates });

  console.log(`\n######## "${c.said}" on "${c.card}"${ideate.images?.length ? ' (with its picture)' : ''}`);
  for (const option of options) {
    const mine = ideas.filter((a) => a.option === option.name);
    const ms = mine.filter((a) => !a.error).map((a) => a.ms);
    console.log(`\n=== ${option.name}: median ${median(ms)} ms (${ms.join(', ')})`);
    for (const a of mine) {
      console.log(`--- run ${a.run + 1}: ${a.ms} ms, ${a.usage ? `${a.usage.input} in + ${a.usage.output} out (${a.usage.reasoning} reasoning)` : 'no usage'}`);
      if (a.error) {
        console.log(`    FAILED ${a.error}`);
        continue;
      }
      const r = a.reply as Directions;
      console.log(`    reading: ${r.reading}`);
      for (const d of r.directions) {
        const how = d.format === 'find' ? ` [${d.source}: ${d.lookups.join(' / ')}]` : d.format === 'video' ? ` [${d.lookups.join(' / ')}]` : d.images.length ? ` [${d.images.length} picture${d.images.length > 1 ? 's' : ''}]` : '';
        const held = contents(d);
        console.log(`    - ${d.format.padEnd(7)} ${d.title}${how}\n              ${d.angle} | ${d.why}\n              ${d.body.replace(/\s+/g, ' ').slice(0, 220)}${held ? `\n              ${held.slice(0, 400)}` : ''}`);
      }
    }
  }
  if (rates.length > 0) {
    console.log(`\n=== rating ties to what the user has`);
    for (const a of rates) {
      const ratings = ((a.reply as { ratings?: { itemId: string; strength: number; why: string }[] })?.ratings ?? []).filter((r) => r.strength >= 0.5);
      console.log(`--- ${a.option} run ${a.run + 1}: ${a.ms} ms, ${a.usage ? `${a.usage.input} in + ${a.usage.output} out` : ''}${a.error ? ` FAILED ${a.error}` : ''}`);
      for (const r of ratings) console.log(`    ${r.strength.toFixed(2)} ${(mind.items.get(r.itemId.replace(/^item\s+/, ''))?.title ?? r.itemId).slice(0, 60)} | ${r.why}`);
    }
  }
}
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
