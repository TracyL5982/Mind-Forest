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
const FIGURE = /^[\d$€£¥]/;
const fewWords = (label: string, most: number): boolean => label.length <= 30 && label.split(/\s+/).length <= most;

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
  return said.every((line) => line.split(',').length >= 3 && line.length <= 80 && !/[.!?]$/.test(line)) ? from(said, ',', 3) : undefined;
}

/** Shares of a whole written in one sentence, "Rent 45%, food 25% and savings 30%", when every part of it is a name and a share and they sum to 100. */
function sharesIn(text: string): { labels: string[]; values: number[] } | undefined {
  for (const sentence of text.split(/[.。\n]+(?!\d)/)) {
    const parts = sentence.split(/[,，、;；]|\band\b|和/).map((part) => /^\s*(\p{L}[\p{L} ]{0,30}?)\s*(\d+(?:\.\d+)?)\s?[%％]\s*$/u.exec(part));
    if (parts.length < 2 || !parts.every(Boolean)) continue;
    const values = parts.map((part) => Number(part![2]));
    const sum = values.reduce((total, value) => total + value, 0);
    if (sum >= 99 && sum <= 101) return { labels: parts.map((part) => part![1]!.trim()), values };
  }
  return undefined;
}

/**
 * What a model would say about a text, read by pattern instead. Each kind of structure is read from the plain ways a person writes it:
 *   Where: Lisbon                     People: Ana Lima, Ben Okri
 *   Pros: fast, small                 Cons: (or either label followed by bulleted lines)
 *   Plan | Price                      a table: a head line and two rows or more, parted by |, tabs or commas
 *   Q: ...   A: ...                   also Question: and Answer:, 问： and 答：
 *   Term: ...   Definition: ...       or one line, "Bokeh: the quality of the blur in a picture"
 *   - one / - two                     a list, and a checklist when every line starts [ ] or [x]
 *   Ember #E4572E                     a colour, named by the capitalised word before it
 *   > a passage of six words or more  an excerpt, with an optional line "At: Chapter 3"
 *   Height = 330 m   Height: 330 m    a fact for each such line, whose value opens with a digit or a currency sign
 *   Chart: Rent 50%, Food 30%         a series, in percent when every entry is
 *   Rent 45%, food 25%, other 30%     shares of a whole, when they sum to 100
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
  const defined = entry && fewWords(entry[1]!, 3) && !RESERVED.has(entry[1]!.toLowerCase()) ? entry : null;
  const passage = lines.map((line) => /^> (\p{L}.*)$/u.exec(line)?.[1]?.trim() ?? '').find((words) => words.split(/\s+/).length >= 6 || (words.match(/\p{Script=Han}/gu)?.length ?? 0) >= 12) ?? '';

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
      return fact && FIGURE.test(fact[2]!) && fewWords(fact[1]!, 4) && !RESERVED.has(fact[1]!.toLowerCase()) ? [{ label: fact[1]!, value: fact[2]! }] : [];
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
