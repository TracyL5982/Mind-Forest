import { z } from 'zod';
import { LIMITS, type Flat } from '../core/layout.ts';
import { Unreadable, type JsonRequest, type ModelClient, type WebResult } from '../core/ports.ts';
import { LinkReply, type Description } from '../core/roles/intake/describe.ts';
import type { ComponentsReply, Entry } from '../core/roles/renderer.ts';

type JsonHandler = (req: JsonRequest<unknown>) => unknown;

/**
 * A scripted model for tests. Register a handler per role; a request for a role with none throws.
 * Every reply is checked against the request's schema, as the real model's is, and one that is not of it is `Unreadable`.
 * A handler that throws is a request that got no answer.
 */
export class FakeModel implements ModelClient {
  readonly calls: { kind: 'json' | 'search' | 'image' | 'transcribe'; role: string; detail: string }[] = [];
  private readonly json_ = new Map<string, JsonHandler>();
  private search_: (query: string, max: number) => WebResult[] = () => [];
  private heard: string | Error | undefined;

  on(role: string, handler: JsonHandler): this {
    this.json_.set(role, handler);
    return this;
  }
  onSearch(handler: (query: string, max: number) => WebResult[]): this {
    this.search_ = handler;
    return this;
  }
  /** What every recording is heard to say from now on, or the error transcribing it fails with. */
  onTranscribe(heard: string | Error): this {
    this.heard = heard;
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

  /** Answers the Renderer's question about cards as `choose` does, so the real Renderer runs with no model behind it. */
  choosing(): this {
    return this.on('renderer.components', (req): ComponentsReply => ({
      items: [...req.user.matchAll(/^id: (.+)\ntitle: (.*)\n(now: idea\n)?(?:(?:length|picture): .*\n)*text: ([\s\S]*?)(?=\n\nid: |(?![\s\S]))/gm)].map((asked) => ({
        id: asked[1]!,
        ...choose(asked[4]!, asked[3] ? 'idea' : 'note'),
      })),
    }));
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    this.calls.push({ kind: 'json', role: req.role, detail: req.user });
    const handler = this.json_.get(req.role);
    if (!handler) throw new Error(`FakeModel has no script for role "${req.role}"`);
    const reply = await handler(req as JsonRequest<unknown>);
    const parsed = req.schema.safeParse(reply);
    if (!parsed.success) throw new Unreadable(req.role, parsed.error.issues);
    return parsed.data;
  }
  async search(req: { role: string; query: string; max?: number }): Promise<WebResult[]> {
    this.calls.push({ kind: 'search', role: req.role, detail: req.query });
    return this.search_(req.query, req.max ?? 5).slice(0, req.max ?? 5);
  }
  async image(req: { role: string; prompt: string }): Promise<{ bytes: Uint8Array; mime: string }> {
    this.calls.push({ kind: 'image', role: req.role, detail: req.prompt });
    return { bytes: PIXEL, mime: 'image/png' };
  }
  /** Until it is told otherwise, the fake hears the demo memo in a WAV file, such as one `tones` made, and nothing in any other. */
  async transcribe(req: { audio: Uint8Array; mime: string }): Promise<string> {
    this.calls.push({ kind: 'transcribe', role: 'voice', detail: req.mime });
    if (this.heard instanceof Error) throw this.heard;
    return this.heard ?? (isWave(req.audio) ? DEMO_MEMO : '');
  }
}

/**
 * What the fake hears in a WAV file: a memo with a few things to do, so a dropped recording has words with no model behind it.
 * A transcriber writes each stretch of speech on a line of its own.
 */
export const DEMO_MEMO = [
  'Garden notes for Thursday.',
  'The tomatoes by the south wall need staking before the wind picks up, and the beans can go in once the soil is dry.',
  'Ask Mara about the seed swap, and order two more bags of compost.',
].join('\n');

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
const isWave = (bytes: Uint8Array): boolean => bytes.length >= 12 && ascii(bytes, 0) === 'RIFF' && ascii(bytes, 8) === 'WAVE';

/** A WAV file of `seconds` of soft tones that swell and fade twice a second, louder and quieter in turn as a voice is: mono, 16 bit, at `rate`. */
export function tones(seconds: number, rate = 8000): Uint8Array {
  const count = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + count * 2);
  const wav = new DataView(bytes.buffer);
  const word = (at: number, text: string) => [...text].forEach((ch, i) => wav.setUint8(at + i, ch.charCodeAt(0)));
  word(0, 'RIFF');
  wav.setUint32(4, 36 + count * 2, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true);
  wav.setUint32(28, rate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  word(36, 'data');
  wav.setUint32(40, count * 2, true);
  for (let n = 0; n < count; n++) {
    const t = n / rate;
    const beat = Math.floor(t * 2);
    const loud = 0.2 + 0.7 * Math.abs(Math.sin(beat * 1.7));
    const swell = Math.sin(Math.PI * ((t * 2) % 1));
    wav.setInt16(44 + n * 2, Math.round(loud * swell * Math.sin(2 * Math.PI * (220 + 55 * (beat % 5)) * t) * 32767), true);
  }
  return bytes;
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
/** Words that open a remark and name nothing, so `Note to self: call the plumber` and `Mum said: bring chairs` are no term. */
const LEAD_IN = new Set([
  'note to self', 'notes', 'ingredients', 'budget', 'packing', 'shopping', 'plan', 'plans', 'status', 'meeting', 'agenda', 'tips',
  'today', 'tonight', 'tomorrow', 'yesterday',
]);
const leadsIn = (term: string): boolean => LEAD_IN.has(term.toLowerCase()) || /\b(?:said|says)$/i.test(term);
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

const TITLE_MOST = 60;
/** Where a clause ends inside a line. A full stop is left out, because `Dr.` and `e.g.` end no clause. */
const CLAUSE_END = /[:;,—：；，]/;
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * A title cut from a line, as a model would write one: the line when it is short enough, else its first clause, else as many
 * whole words as fit. A line written without spaces is cut between any two of its characters.
 */
function titleFrom(line: string): string {
  const chars = [...line];
  if (chars.length <= TITLE_MOST) return line;
  const clause = chars.findIndex((ch, i) => i >= 4 && i < TITLE_MOST && CLAUSE_END.test(ch));
  if (clause > 0) return chars.slice(0, clause).join('').trim();
  let end = TITLE_MOST;
  while (end > 1 && !/\s/.test(chars[end]!) && !UNSPACED.test(chars[end - 1]!) && !UNSPACED.test(chars[end]!)) end -= 1;
  return chars.slice(0, end > 1 ? end : TITLE_MOST).join('').trim();
}

/**
 * What a model would say about a text, read by pattern instead. Each kind of structure is read from the plain ways a person writes it:
 *   Where: Lisbon                     People: Ana Lima, Ben Okri
 *   Pros:                             Cons: each followed by bulleted lines, one point each
 *   Plan | Price                      a table: a head line and two rows or more, parted by |, tabs or commas, and by
 *                                     commas only when the head has no word of a sentence and a column is mostly numbers
 *   Q: ...   A: ...                   also 问： and 答：. "Question:" opens no passage, so its answer would be a piece of its line
 *   Parallax means the shift of …     a term and its meaning, the line whole, and so is a one-line entry "Bokeh: the blur …"
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

  // A point is a whole line: one written inline among others is a piece of a sentence.
  const points = (label: string) => (labelled(label) ? [] : list(label));
  const pros = points('pros');
  const cons = points('cons');
  const bullets = pros.length + cons.length > 0 ? [] : lines.filter(isBullet).map((line) => BULLET.exec(line)!);
  const table = tableIn(lines);
  const first = lines.find((line) => line && !line.startsWith('>')) ?? '';
  const series = list('chart').map((entry) => /^(.+?)\s+(-?\d+(?:\.\d+)?)(%?)$/.exec(entry));
  const shares = series.length === 0 ? sharesIn(text) : undefined;
  const said = lines.filter(Boolean);
  const entry = said.length === 1 ? /^(\p{L}[\p{L}\p{N} -]*):\s+(\p{L}.{14,})$/u.exec(said[0]!) : null;
  const told = entry?.[2] ?? '';
  const oneSentence = !/[.!?。！？]\s+\S/.test(told) && (told.match(/[,，、;；]/g)?.length ?? 0) < 2 && !/\d\s?[%％]/.test(told);
  const defined = entry && fewWords(entry[1]!, 4) && !RESERVED.has(entry[1]!.toLowerCase()) && !leadsIn(entry[1]!) && oneSentence ? entry : null;
  const passage = quotedIn(lines).find((words) => words.split(/\s+/).length >= 6 || (words.match(/\p{Script=Han}/gu)?.length ?? 0) >= 12) ?? '';

  return {
    ...blank(),
    title: titleFrom(first),
    summary: text.trim().slice(0, 160),
    tags: first.toLowerCase().split(/\W+/).filter((word) => word.length > 4).slice(0, 3),
    where: /fake:invent/.test(text) ? 'Atlantis' : labelled('where'),
    people: list('people'),
    pros,
    cons,
    ...(table ? { tableHeads: table.heads, tableRows: table.rows } : {}),
    question: labelled('q', '问'),
    answer: labelled('a', '答'),
    // A one-line entry's meaning is its whole line, the term included, because a card shows only whole units of the text.
    ...(defined ? { term: defined[1]!, definition: defined[0] } : meaning(lines)),
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

/** The first line that says what a term means, as "Parallax means the apparent shift of an object" does, the line whole. */
function meaning(lines: string[]): { term: string; definition: string } | Record<string, never> {
  const said = lines.map((line) => /^(\p{L}[\p{L} ]{0,39}?) means (\S.*)$/u.exec(line)).find(Boolean);
  return said ? { term: said[1]!, definition: said[0] } : {};
}

type Control = Entry['controls'][number];
const STATE = /^(\p{L}[\p{L} ]{0,29})[:：]\s*([^\d;；].*[.!?。！？])$/u;
const FORMULA = /`([^`]+)`/;
const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g;
const SPACED = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}]/u;

/**
 * What a model would make an explorable of, read by pattern instead:
 *   Three ways to shoot a dolly zoom            a segmented control, or a toggle for two: two to four lines of a name, a colon and
 *   Zoom only: the lens zooms in, so ….         a sentence, under a first line that names what they contrast
 *   … the field of view is `2 * atan(18 / f) * 57.2958` degrees, for a focal length f in mm.
 *   At 24 mm the field of view is 73.7°. …      a slider: a formula in backticks with one name in it that is no function's,
 *                                               which "for a <label> <name> in <unit>" names, and two or more sentences that each
 *                                               write a value and its result
 * The slider runs from half the least stated value to half as much again as the most.
 */
function explored(text: string, lines: string[]): Omit<Entry, 'id'> | undefined {
  const states = lines.slice(1).map((line) => STATE.exec(line)).filter((found) => found !== null);
  if (states.length >= 2 && states.length <= 4 && states.length === lines.length - 1 && lines[0]!.length <= 40) {
    const label = lines[0]!.replace(/[.。:：]$/, '');
    const control: Control = { kind: states.length === 2 ? 'toggle' : 'segmented', label, states: states.map((found) => found[1]!.trim()), texts: states.map((found) => found[0]), name: '', unit: '', min: 0, max: 0, values: [] };
    return { ...NOTE, component: 'explorable', controls: [control] };
  }
  const formula = FORMULA.exec(text)?.[1];
  if (!formula) return undefined;
  // The formula is passed on as written, so the Renderer's own check reads it, and refuses one it cannot read.
  const named = [...new Set(formula.match(/\b[A-Za-z_]\w*\b(?!\s*\()/g) ?? [])];
  if (named.length !== 1) return undefined;
  const [name] = named as [string];
  const pairs = text.replace(FORMULA, '').split(/(?<=[.!?])\s+|(?<=[。！？])/).flatMap((sentence) => {
    const found = [...sentence.matchAll(NUMBER)];
    if (found.length !== 2) return [];
    const after = sentence.slice(found[1]!.index + found[1]![0].length);
    return [{ at: Number(found[0]![0].replace(/,/g, '')), value: Number(found[1]![0].replace(/,/g, '')), unit: /^\s?([°%‰]|\p{L}+)/u.exec(after)?.[1] ?? '' }];
  });
  if (pairs.length < 2) return undefined;
  const label = new RegExp(`for (?:a|an|the) ([\\p{L} ]+?) ${name}\\b`, 'u').exec(text)?.[1] ?? name;
  const unit = new RegExp(`\\b${name} in ([^\\s.,;]+)`, 'u').exec(text)?.[1] ?? '';
  const subject = /the ([\p{L} ]+?) is `/u.exec(text)?.[1] ?? '';
  const values = pairs.map((pair) => pair.at);
  const slider: Control = { kind: 'slider', label, states: [], texts: [], name, unit, min: Math.floor(Math.min(...values) / 2), max: Math.ceil(Math.max(...values) * 1.5), values };
  return { ...NOTE, component: 'explorable', controls: [slider], formula, subject, unit: SPACED.test(pairs[0]!.unit) ? '' : pairs[0]!.unit, numbers: pairs.map((pair) => pair.value) };
}

const NOTE: Omit<Entry, 'id'> = { component: 'note', subject: '', passage: '', by: '', tone: '', lines: [], labels: [], numbers: [], left: [], right: [], unit: '', emphasis: '', sections: [], controls: [], formula: '' };

const MARKED = /^(caution|warning|note):\s*(\S.*)$/i;
const LABELLED = /^(\p{L}[\p{L} ]{1,29}):\s+(\S.*)$/u;
const NUMBER_FIRST = /^[$€£¥]?\d/;

/**
 * What a model would choose for a text the rules drew as a note or an idea, read by pattern instead:
 *   Caution: hot oil spits            a callout of the whole line, and so is "Warning:". "Note:" makes a remark of it
 *   Cost: €240                        a figure of a sheet, when the value starts with a number
 *   Best:  - the bridge  - the shop   a list of a sheet, a line that ends in a colon with bulleted lines under it
 * A sheet is a text with a figure or a list written so, and a sentence beside them. Its first line is the heading.
 * An explorable is a text in one of two forms, as `explored` reads them.
 * A text holding "fake:invent" is given a figure it never states, to show the content check keeping the note.
 * A text in none of these forms keeps the card it has `now`.
 */
export function choose(text: string, now: 'note' | 'idea' = 'note'): Omit<Entry, 'id'> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (/fake:invent/.test(text)) return { ...NOTE, component: 'fact', subject: 'Share', passage: '99%' };
  const marked = lines.map((line) => MARKED.exec(line)).find(Boolean);
  if (marked) return { ...NOTE, component: 'callout', passage: marked[0], tone: marked[1]!.toLowerCase() === 'note' ? 'note' : 'caution' };
  const explorable = explored(text, lines);
  if (explorable) return explorable;

  const labelled = lines.flatMap((line) => {
    const found = LABELLED.exec(line);
    return found ? [{ label: found[1]!, value: found[2]! }] : [];
  });
  const figures = labelled.filter(({ value }) => NUMBER_FIRST.test(value)).map(({ label, value }) => `${label} | ${value}`);
  const label = lines.findIndex((line) => /:$/.test(line));
  const listed = label < 0 ? [] : lines.slice(label + 1).filter(isBullet).map((line) => BULLET.exec(line)![2]!);
  const prose = lines.slice(1).find((line) => !LABELLED.test(line) && !isBullet(line) && !/:$/.test(line));
  if (figures.length + listed.length === 0 || !prose) return { ...NOTE, component: now };
  const part = (kind: Entry['sections'][number]['kind'], text: string, lines: string[] = []) => ({ kind, text, by: '', lines });
  return {
    ...NOTE,
    component: 'sheet',
    sections: [part('heading', lines[0]!), part('text', prose), ...(figures.length > 0 ? [part('figures', '', figures)] : []), ...(listed.length > 1 ? [part('list', '', listed)] : [])],
  };
}

const FACET = /^(\p{L}[\p{L}\p{N} ]{0,29}?)\s*[:：]\s*\S/u;

/**
 * The structure a model would give siblings whose titles open with one of a few facets, as "Eat: grilled sardines" and "See: Tram 28
 * at dawn" do: a row with a column for each facet two siblings or more open with, labelled with the facet. Other siblings stay out.
 * None when fewer than two facets are shared, or the row would pass the layout's limits.
 */
export function assemble(siblings: readonly { id: string; title: string }[]): Flat[] | null {
  const facets = new Map<string, { label: string; ids: string[] }>();
  for (const { id, title } of siblings) {
    const facet = FACET.exec(title.trim())?.[1];
    if (!facet) continue;
    const had = facets.get(facet.toLowerCase());
    facets.set(facet.toLowerCase(), { label: had?.label ?? facet, ids: [...(had?.ids ?? []), id] });
  }
  const shared = [...facets.values()].filter((facet) => facet.ids.length >= 2);
  if (shared.length < 2 || shared.length + 1 > LIMITS.boxes || shared.reduce((sum, facet) => sum + facet.ids.length, 0) > LIMITS.cards) return null;
  const part = (id: string, parent: string, kind: Flat['kind'], label = ''): Flat => ({ id, parent, kind, role: 'normal', label, join: 'none' });
  return [part('all', '', 'row'), ...shared.flatMap((facet, n) => [part(`facet-${n}`, 'all', 'column', facet.label), ...facet.ids.map((id) => part(id, `facet-${n}`, 'card'))])];
}
