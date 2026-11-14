/**
 * Runs the same web searches through Meta's model search and OpenAI's, and prints time, tokens and the pages each returns.
 * Usage: tsx scripts/search-compare.ts <openai model> "<query>" ["<query>" ...]
 */
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';

const env = loadEnv();
const PREFER =
  'Prefer pages with substance: original reporting, studies, official and first-hand sources, case studies, and long pieces by people who know the subject. ' +
  'Leave out listicles, "best of" roundups, affiliate reviews, pages written to rank in search, shops, and encyclopedia entries.';
const host = (url: string) => new URL(url).hostname.replace(/^www\./, '');

let metaTokens = 0;
const meta = new MetaModel({ apiKey: env.MODEL_API_KEY ?? '', onCall: (c) => (metaTokens = c.tokens ?? 0) });

async function openai(model: string, query: string) {
  const started = Date.now();
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: `Search the web for: ${query}\nList the 8 most useful and varied pages you found, one per line, as: title | URL\n${PREFER}\nRun exactly one search. Do not open any page.`,
      tools: [{ type: 'web_search' }],
      include: ['web_search_call.action.sources'],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json()) as any;
  if (!res.ok) return { ms: Date.now() - started, error: `${res.status} ${JSON.stringify(json.error?.message ?? json).slice(0, 200)}` };
  const cited = new Map<string, string>();
  let searches = 0;
  let sources = 0;
  for (const item of json.output ?? []) {
    if (item.type === 'web_search_call') {
      searches++;
      sources += item.action?.sources?.length ?? 0;
    }
    for (const c of item.content ?? []) {
      for (const a of c.annotations ?? []) if (a.url) cited.set(a.url.split('?utm_')[0], a.title ?? '');
      for (const line of String(c.text ?? '').split('\n')) {
        const m = /^[\s\d.*-]*(.+?)\s*\|\s*\(?\[?(https?:\/\/[^\s)\]]+)/.exec(line);
        if (m) cited.set(m[2]!.split('?utm_')[0]!, m[1]!.replace(/[*\[\]]/g, ''));
      }
    }
  }
  return { ms: Date.now() - started, tokens: json.usage?.total_tokens, searches, sources, hits: [...cited].map(([url, title]) => ({ url, title })) };
}

const [model, ...queries] = process.argv.slice(2);
for (const query of queries) {
  console.log(`\n=== ${query}`);
  const started = Date.now();
  const [m, o] = await Promise.all([
    meta.search({ role: 'compare', query, max: 8, prefer: PREFER }).then((hits) => ({ ms: Date.now() - started, hits }), (err) => ({ ms: Date.now() - started, hits: [], error: String(err).slice(0, 200) })),
    openai(model!, query),
  ]);
  console.log(`META   ${(m.ms / 1000).toFixed(1)}s ${metaTokens} tokens ${'error' in m ? m.error : ''}`);
  for (const h of m.hits) console.log(`   ${host(h.url).padEnd(34)} ${h.title.slice(0, 80)}`);
  console.log(`OPENAI ${(o.ms / 1000).toFixed(1)}s ${o.tokens ?? ''} tokens, ${o.searches ?? 0} searches, ${o.sources ?? 0} sources ${o.error ?? ''}`);
  for (const h of o.hits ?? []) console.log(`   ${host(h.url).padEnd(34)} ${h.title.slice(0, 80)}`);
}
