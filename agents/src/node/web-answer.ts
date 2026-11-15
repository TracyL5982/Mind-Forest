/**
 * Momo's quick web answer: OpenAI's Responses API with its web search at low reasoning, a few spoken sentences back. With no
 * reasoning it answered sooner (2.5 s against 3.0 s at the median, 18 runs each, 15 Nov 2026) but twice dated a launch wrong, and
 * Momo's lead-in covers the wait (DECISIONS 59); `minimal` effort is refused with web search.
 */

export const WEB_MODEL = 'gpt-5.4-mini';
const WAIT_MS = 10_000;

/** Dollars per million tokens and per search call, as listed in Oct 2026 (the search fee is an estimate). */
const PRICE = { input: 0.75, cached: 0.075, output: 4.5, search: 0.01 };

export type WebAnswer = (question: string) => Promise<string>;

export interface Answered {
  text: string;
  searches: number;
  dollars: number;
}

/** Markdown links, bare addresses and the brackets they leave: the model adds them despite being told not to (26 of 72 answers). */
export function withoutLinks(text: string): string {
  return text
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function instructions(today: string): string {
  return `You answer questions for a voice assistant that talks with its user like a knowledgeable friend. Today is ${today}.
Answer in one or two short sentences meant to be heard: no lists, no markdown, no links, no addresses, no sources named in brackets.
Search the web when the answer depends on anything recent, current or scheduled; otherwise answer from what you know.
Say plainly when something has not happened yet, is only planned or announced, or is not certain. Never state a planned event as done.
Give the date of each event you name. Asked about this week, month or year, name only what the sources date within it, and nothing that happened earlier.`;
}

/** Asks once. `log` hears what it cost. */
export function openaiWebAnswer(send: typeof fetch, opts: { apiKey: string; model?: string; effort?: string; now?: () => Date; log?: (line: string) => void }): WebAnswer {
  return async (question) => {
    const answered = await ask(send, opts, question);
    opts.log?.(`[voice] web answer, ${answered.searches} search${answered.searches === 1 ? '' : 'es'}, $${answered.dollars.toFixed(4)}: ${answered.text}`);
    return answered.text;
  };
}

export async function ask(send: typeof fetch, opts: { apiKey: string; model?: string; effort?: string; now?: () => Date }, question: string): Promise<Answered> {
  const today = (opts.now?.() ?? new Date()).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const res = await send('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model || WEB_MODEL,
      instructions: instructions(today),
      input: question,
      tools: [{ type: 'web_search' }],
      reasoning: { effort: opts.effort || 'low' },
    }),
    signal: AbortSignal.timeout(WAIT_MS),
  });
  if (!res.ok) throw new Error(`OpenAI web answer answered ${res.status}`);
  const body = (await res.json()) as {
    output?: { type: string; content?: { type: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  };
  const output = body.output ?? [];
  const text = output.flatMap((o) => (o.type === 'message' ? (o.content ?? []).flatMap((c) => (c.type === 'output_text' && c.text ? [c.text] : [])) : [])).join(' ');
  const searches = output.filter((o) => o.type === 'web_search_call').length;
  const u = body.usage ?? {};
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  const dollars = (((u.input_tokens ?? 0) - cached) * PRICE.input + cached * PRICE.cached + (u.output_tokens ?? 0) * PRICE.output) / 1e6 + searches * PRICE.search;
  return { text: withoutLinks(text), searches, dollars };
}
