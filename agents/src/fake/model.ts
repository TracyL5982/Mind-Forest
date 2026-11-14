import { z } from 'zod';
import type { JsonRequest, ModelClient, WebResult } from '../core/ports.ts';
import { LinkReply, type Description } from '../core/roles/intake/describe.ts';

type JsonHandler = (req: JsonRequest<unknown>) => unknown;

/**
 * A scripted model for tests. Register a handler per role; a request for a role with none throws.
 * Every reply is checked against the request's schema, as the real model's is.
 */
export class FakeModel implements ModelClient {
  readonly calls: { kind: 'json' | 'search' | 'image' | 'transcribe'; role: string; detail: string }[] = [];
  private readonly json_ = new Map<string, JsonHandler>();
  private search_: (query: string, max: number) => WebResult[] = () => [];
  private transcript = '';

  on(role: string, handler: JsonHandler): this {
    this.json_.set(role, handler);
    return this;
  }
  onSearch(handler: (query: string, max: number) => WebResult[]): this {
    this.search_ = handler;
    return this;
  }
  onTranscribe(text: string): this {
    this.transcript = text;
    return this;
  }

  /**
   * Answers Intake as `describe` does, so the real Intake runs with no model behind it.
   * A file is described from its name, which is all this fake can read of it.
   */
  describing(): this {
    const quoted = (user: string) => /"""\n([\s\S]*?)\n"""/.exec(user)?.[1] ?? '';
    const named: JsonHandler = (req) => ({ ...describe(req.user.replace(/^File name: /, '')), description: '' });
    return this.on('intake.text', (req) => ({
      entries: [...req.user.matchAll(/Dump (\d+)[^\n]*:\n"""\n([\s\S]*?)\n"""/g)].map((dump) => ({ dump: Number(dump[1]), text: '', ...describe(dump[2]!) })),
    }))
      .on('intake.link', (req) => describe(quoted(req.user)))
      .on('intake.image', named)
      .on('intake.video', named);
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    this.calls.push({ kind: 'json', role: req.role, detail: req.user });
    const handler = this.json_.get(req.role);
    if (!handler) throw new Error(`FakeModel has no script for role "${req.role}"`);
    return req.schema.parse(handler(req as JsonRequest<unknown>));
  }
  async search(req: { role: string; query: string; max?: number }): Promise<WebResult[]> {
    this.calls.push({ kind: 'search', role: req.role, detail: req.query });
    return this.search_(req.query, req.max ?? 5).slice(0, req.max ?? 5);
  }
  async image(req: { role: string; prompt: string }): Promise<{ bytes: Uint8Array; mime: string }> {
    this.calls.push({ kind: 'image', role: req.role, detail: req.prompt });
    return { bytes: PIXEL, mime: 'image/png' };
  }
  async transcribe(): Promise<string> {
    this.calls.push({ kind: 'transcribe', role: 'voice', detail: '' });
    return this.transcript;
  }
}

/** A 1×1 transparent PNG. */
const PIXEL = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

/** A description with every key present and nothing in it. Read off the schema, so it stays valid as the schema grows. */
export function blank(): Description {
  return LinkReply.parse(Object.fromEntries(Object.entries(LinkReply.shape).map(([key, type]) => [key, type instanceof z.ZodArray ? [] : ''])));
}

const BULLET = /^(?:[-*•]\s+)?(?:\[([ xX])\]\s+)?(.+)$/;
const isBullet = (line: string) => /^(?:[-*•]\s|\[[ xX]\]\s)/.test(line);

const SENTENCE_MARK = /[.!?;:。！？；：]/;
/** Words that open a line of some other structure or of a plain remark, so `Where: 3 km north` is no fact and `Remember: ...` no definition. */
const RESERVED = new Set([
  'where', 'people', 'pros', 'cons', 'q', 'a', 'question', 'answer', 'term', 'definition', 'at', 'chart', 'palette', 'caution', 'warning', 'note', 'when', '问', '答',
  'remember', 'reminder', 'todo', 'to do', 'tip', 'idea', 'update', 'ps', 'fyi', 're', 'subject', 'title', 'summary',
]);
/** Words that open a remark and name nothing, so `Note to self: call the plumber` and `Mum said: bring chairs` are no term. */
const LEAD_IN = new Set([
  'note to self', 'notes', 'ingredients', 'budget', 'packing', 'shopping', 'plan', 'plans', 'status', 'meeting', 'agenda', 'tips',
  'today', 'tonight', 'tomorrow', 'yesterday',
]);
const leadsIn = (term: string): boolean => LEAD_IN.has(term.toLowerCase()) || /\b(?:said|says)$/i.test(term);
/**
 * A figure: a number, with a sign or a currency before it, and after it a unit or at most two words, as `330 m`, `€29.40`,
 * `2.1 million` and `7/10`. A clock time and a date are no figure, and neither is a clause, as in `6 is better`.
 */
const FIGURE = /^[~≈<>±+−-]?\s?[$€£¥]?\s?\d[\d.,/:]*(?:\s?[-–]\s?\d[\d.,]*)?\s?[%‰°℃]?((?:\s?[\p{L}²³°/]+){0,2})$/u;
const TIME_OR_DATE = /^\d{1,2}(?::\d{2})?\s?(?:[ap]\.?m\.?|(?:st|nd|rd|th)?\s?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)$|^\d{1,2}:\d{2}$|^\d{1,4}\/\d{1,2}\/\d{1,4}$/i;
const CLAUSE = new Set(['is', 'are', 'was', 'were', 'be', 'am', 'will', 'would', 'can', 'could', 'should', 'must', 'do', 'does', 'did', 'has', 'have', 'had', 'and', 'or', 'but', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'it', 'me', 'you', 'we', 'then']);
function isFigure(value: string): boolean {
  const words = FIGURE.exec(value)?.[1];
  return words !== undefined && !TIME_OR_DATE.test(value) && !words.trim().split(/\s+/).some((word) => CLAUSE.has(word));
}
const fewWords = (label: string, most: number): boolean => label.length <= 30 && label.split(/\s+/).length <= most;
/** Words a sentence has and a row of heads does not. */
const SENTENCE_WORD = /^(?:then|what|when|so|the|a|an|and|but|is|are|was|were|i|we|you|it|truly|really)$/i;
const NUMBER_CELL = /^[~≈<>±+−-]?\s?[$€£¥]?\s?\d[\d.,/:]*\s?\S{0,6}$/;

/**
 * The rows of a table a person typed: a head line and at least two rows, every line with the same number of cells, and a head
 * that is no sentence. Cells are parted by `|`, by tabs, or by commas when every line has at least two.
 */
function tableIn(lines: string[]): { heads: string[]; rows: string[] } | undefined {
  const cells = (line: string, by: string | RegExp): string[] => line.replace(/^\||\|$/g, '').split(by).map((cell) => cell.trim());
  const from = (rows: string[], by: string | RegExp, least: number) => {
    const grid = rows.map((row) => cells(row, by));
    const [head] = grid;
    if (rows.length < 3 || !head || head.length < least || grid.some((row) => row.length !== head.length) || head.some((cell) => !cell || SENTENCE_MARK.test(cell))) return undefined;
    return { heads: head, rows: grid.slice(1).map((row) => row.join(' | ')) };
  };
  const piped = lines.filter((line) => line.includes('|'));
  if (piped.length > 0) return from(piped, '|', 2);
  const said = lines.filter(Boolean);
  if (said.every((line) => line.includes('\t'))) return from(said, '\t', 2);
  if (!said.every((line) => line.split(',').length >= 3 && line.length <= 80 && !/[.!?]$/.test(line))) return undefined;
  const table = from(said, ',', 3);
  if (!table || table.heads.some((head) => head.split(/\s+/).some((word) => SENTENCE_WORD.test(word)))) return undefined;
  const grid = table.rows.map((row) => row.split(' | '));
  return table.heads.some((_, i) => grid.filter((row) => NUMBER_CELL.test(row[i]!)).length * 2 > grid.length) ? table : undefined;
}

/**
 * Shares of a whole written in one sentence, "Rent 45%, food 25% and savings 30%", when every part of it is a name and a share
 * and they sum to 100. A label before them, as in "Our budget this year: rent is 45%, …", is not part of the first name.
 */
function sharesIn(text: string): { labels: string[]; values: number[] } | undefined {
  for (const sentence of text.split(/[.。\n]+(?!\d)/)) {
    const shares = sentence.replace(/^[^:：]{1,40}[:：]\s*/, '');
    const parts = shares.split(/[,，、;；]|\band\b|和/).map((part) => /^\s*(\p{L}[\p{L} ]{0,30}?)(?:\s+(?:is|are|was|were))?\s*(\d+(?:\.\d+)?)\s?[%％]\s*$/u.exec(part));
    if (parts.length < 2 || !parts.every(Boolean)) continue;
    const values = parts.map((part) => Number(part![2]));
    const sum = values.reduce((total, value) => total + value, 0);
    if (sum >= 99 && sum <= 101) return { labels: parts.map((part) => part![1]!.trim()), values };
  }
  return undefined;
}

/**
 * The passages quoted with `>`, each run of such lines joined into one. A passage opens with a letter that is no small letter,
 * so `> 5 means the test passed` and a reply's `> not sure about this` are no quote.
 */
function quotedIn(lines: string[]): string[] {
  const passages: string[] = [];
  lines.forEach((line, i) => {
    const words = /^>\s?(.*)$/.exec(line)?.[1]?.trim();
    if (words === undefined) return;
    if (i > 0 && lines[i - 1]!.startsWith('>')) passages[passages.length - 1] += ` ${words}`;
    else passages.push(words);
  });
  return passages.filter((words) => /^(?!\p{Ll})\p{L}/u.test(words));
}

/**
 * What a model would say about a text, read by pattern instead. Each kind of structure is read from the plain ways a person writes it:
 *   Where: Lisbon                     People: Ana Lima, Ben Okri
 *   Pros: fast, small                 Cons: (or either label followed by bulleted lines)
 *   Plan | Price                      a table: a head line and two rows or more, parted by |, tabs or commas, and by
 *                                     commas only when the head has no word of a sentence and a column is mostly numbers
 *   Q: ...   A: ...                   also Question: and Answer:, 问： and 答：
 *   Term: ...   Definition: ...       or one line, "Bokeh: the quality of the blur in a picture", when the term is no
 *                                     lead-in such as "Note to self" or "Mum said" and the meaning one sentence with no list"
 *   - one / - two                     a list, and a checklist when every line starts [ ] or [x]
 *   Ember #E4572E                     a colour, named by the capitalised word before it
 *   > a passage of six words or more  an excerpt over one or more such lines, with an optional line "At: Chapter 3"
 *   Height = 330 m   Height: 330 m    a fact for each such line whose value is a figure, a number with a unit or two words
 *   Chart: Rent 50%, Food 30%         a series, in percent when every entry is
 *   Rent 45%, food 25%, other 30%     shares of a whole, when they sum to 100, also after a label: "Budget: rent 45%, …"
 * A text holding "fake:invent" is also given a place it never names, to show the grounding check dropping it.
 */
export function describe(text: string): Description {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const labelled = (...labels: string[]): string => {
    for (const label of labels) {
      const line = lines.find((each) => new RegExp(`^${label}[:：]`, 'i').test(each));
      if (line) return line.slice(label.length + 1).trim();
    }
    return '';
  };
  const list = (label: string): string[] => {
    const at = lines.findIndex((line) => line.toLowerCase().startsWith(`${label}:`));
    if (at < 0) return [];
    const inline = lines[at]!.slice(label.length + 1).trim();
    if (inline) return inline.split(/[,;]\s*/).map((entry) => entry.replace(/\.$/, '').trim()).filter(Boolean);
    const end = lines.findIndex((line, n) => n > at && !isBullet(line));
    return lines.slice(at + 1, end < 0 ? undefined : end).map((line) => BULLET.exec(line)![2]!);
  };

  const pros = list('pros');
  const cons = list('cons');
  const bullets = pros.length + cons.length > 0 ? [] : lines.filter(isBullet).map((line) => BULLET.exec(line)!);
  const table = tableIn(lines);
  const first = lines.find(Boolean) ?? '';
  const series = list('chart').map((entry) => /^(.+?)\s+(-?\d+(?:\.\d+)?)(%?)$/.exec(entry));
  const shares = series.length === 0 ? sharesIn(text) : undefined;
  const said = lines.filter(Boolean);
  const entry = said.length === 1 ? /^(\p{L}[\p{L}\p{N} -]*):\s+(\p{L}.{14,})$/u.exec(said[0]!) : null;
  const meaning = entry?.[2] ?? '';
  const oneSentence = !/[.!?。！？]\s+\S/.test(meaning) && (meaning.match(/[,，、;；]/g)?.length ?? 0) < 2 && !/\d\s?[%％]/.test(meaning);
  const defined = entry && fewWords(entry[1]!, 4) && !RESERVED.has(entry[1]!.toLowerCase()) && !leadsIn(entry[1]!) && oneSentence ? entry : null;
  const passage = quotedIn(lines).find((words) => words.split(/\s+/).length >= 6 || (words.match(/\p{Script=Han}/gu)?.length ?? 0) >= 12) ?? '';

  return {
    ...blank(),
    title: first.slice(0, 60),
    summary: text.trim().slice(0, 160),
    tags: first.toLowerCase().split(/\W+/).filter((word) => word.length > 4).slice(0, 3),
    where: /fake:invent/.test(text) ? 'Atlantis' : labelled('where'),
    people: list('people'),
    pros,
    cons,
    ...(table ? { tableHeads: table.heads, tableRows: table.rows } : {}),
    question: labelled('q', 'question', '问'),
    answer: labelled('a', 'answer', '答'),
    term: labelled('term') || (defined?.[1] ?? ''),
    definition: labelled('definition') || (defined?.[2] ?? ''),
    ...(bullets.length >= 2 ? { items: bullets.map((b) => b[2]!), checklist: bullets.every((b) => b[1]) ? bullets.map((b) => b[1] !== ' ') : [] } : {}),
    colours: [...text.matchAll(/(?:([A-Z][\w-]*) )?(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))\b/g)].map((m) => ({ name: m[1] ?? '', value: m[2]! })),
    facts: lines.flatMap((line) => {
      const fact = /^([^=|:：]+?)\s*(?:=|[:：]\s)\s*(\S.*)$/.exec(line);
      return fact && isFigure(fact[2]!) && fewWords(fact[1]!, 4) && !RESERVED.has(fact[1]!.toLowerCase()) ? [{ label: fact[1]!, value: fact[2]! }] : [];
    }),
    ...(series.length >= 2 && series.every(Boolean)
      ? { chartLabels: series.map((entry) => entry![1]!), chartValues: series.map((entry) => Number(entry![2])), chartUnit: series.every((entry) => entry![3]) ? '%' : '' }
      : shares
        ? { chartLabels: shares.labels, chartValues: shares.values, chartUnit: '%' }
        : {}),
    excerptText: passage,
    excerptAt: labelled('at'),
  };
}
