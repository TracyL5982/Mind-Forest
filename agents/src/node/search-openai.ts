import type { WebResult } from '../core/ports.ts';

interface Output {
  type: string;
  action?: { sources?: { url?: string }[] };
  content?: { text?: string; annotations?: { url?: string; title?: string }[] }[];
}

const bare = (url: string): string => url.replace(/[?&]utm_[^#]*/, '').replace(/[/#?]+$/, '');

/**
 * One web search through OpenAI's Responses API. Measured against the Meta model's search on six queries:
 * about 4 s where that took about 10 s, and more primary sources among the pages.
 */
export async function openaiSearch(
  send: typeof fetch,
  opts: { apiKey: string; model?: string },
  req: { query: string; max?: number; prefer?: string },
): Promise<WebResult[]> {
  const max = req.max ?? 8;
  const res = await send('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model ?? 'gpt-5.4-mini',
      input:
        `Search the web for: ${req.query}\n` +
        `List the ${max} most useful and varied pages you found, one per line, as: title | URL\n` +
        (req.prefer ? `${req.prefer}\n` : '') +
        'Run exactly one search. Do not open any page.',
      tools: [{ type: 'web_search' }],
      include: ['web_search_call.action.sources'],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`OpenAI search answered ${res.status}`);
  const json = (await res.json()) as { output?: Output[] };
  // A page is only used when the search itself returned its address, so the model cannot invent one.
  const real = new Set<string>();
  const listed = new Map<string, WebResult>();
  for (const item of json.output ?? []) {
    for (const source of item.action?.sources ?? []) if (source.url) real.add(bare(source.url));
    for (const part of item.content ?? []) {
      for (const cite of part.annotations ?? []) {
        if (cite.url && !listed.has(bare(cite.url))) listed.set(bare(cite.url), { title: cite.title ?? '', url: bare(cite.url), snippet: '' });
      }
      for (const line of (part.text ?? '').split('\n')) {
        const m = /^[\s\d.*-]*(.+?)\s*\|\s*[([]*(https?:\/\/[^\s)\]]+)/.exec(line);
        if (m) listed.set(bare(m[2]!), { title: m[1]!.replace(/[*[\]]/g, '').trim(), url: bare(m[2]!), snippet: '' });
      }
    }
  }
  return [...listed.values()].filter((hit) => real.size === 0 || real.has(hit.url)).slice(0, max);
}
