/**
 * A source text, asked whether it states a claim. Built once per text; each question reads the same token list.
 *
 * The text and every claim are first brought to one written form (Unicode NFKC, invisible characters removed), so a
 * full-width digit or a decomposed accent is the character it looks like.
 *
 * A claim is stated when its tokens are a run of whole tokens of the text. Case, spacing, quote marks and other
 * punctuation between tokens do not count. A token is a word, a number, or one character of a script written
 * without spaces, which makes a claim in such a script match as a substring. A number is one token that knows every
 * value its written form may be read as, and a claim number is stated by a token that holds its value.
 *
 * Between two tokens the text may break off: at a sentence end, an empty line, a table cell, a list item. Each kind
 * of claim names the breaks it may not run across. A claim that itself carries the break at that place may.
 */
export interface Grounding {
  /** The text holds these words or this number, inside one table cell, one list item and one CJK sentence. A claim with no letter or digit must stand in the text as written. */
  says(claim: string): boolean;
  /** As `says`, and the words are one stretch of the text: a sentence end or an empty line breaks the passage too. A line break inside a sentence does not. */
  quotes(passage: string): boolean;
  /** The text writes this number, in any grouping. */
  writes(value: number): boolean;
  /** The text writes this hex colour, with its "#", as a whole value. */
  paints(hex: string): boolean;
  /** The check mark on the line whose own text is these words: done, not done, or none. */
  ticks(words: string): boolean | undefined;
}

const enum Break {
  /** ".", "!" or "?" before white space, unless the period closes an abbreviation. */
  Sentence = 1,
  /** "。", or "!" or "?" set straight against a character of a script written without spaces. */
  FullStop = 2,
  /** An empty line. */
  Blank = 4,
  /** A tab or "|" between two cells of a table row. */
  Cell = 8,
  /** The start of a line that opens with a bullet, a number and a dot, a check box or "|". */
  Item = 16,
  /** The line break before or after a line that holds table cells. */
  Row = 32,
}

const SHORT = Break.FullStop | Break.Cell | Break.Item | Break.Row;
const PASSAGE = SHORT | Break.Sentence | Break.Blank;

/** A number as a text writes it. */
interface Num {
  /** The value a claim written this way asks for. NaN for a form with no one value, such as a dotted date. */
  value: number;
  /** Every value the written form may be read as: "100,200" is one number or two. */
  readings: number[];
  /** The groups of a form with no one value, without their leading zeros: "2024.3.15". Empty otherwise. */
  literal: string;
  /** The currency sign, percent sign and comparator written against the number, which a claim that carries them asks for. */
  glued: string;
}

/** A word in lower case, one character of a script written without spaces, or a number. */
type Token = string | Num;

interface Tokens {
  list: Token[];
  /** The kinds of break that stand between each token and the one before it. */
  breaks: number[];
}

const SPACELESS = String.raw`(?=[\p{L}\p{M}\p{N}])[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]`;
const SPACELESS_CHAR = new RegExp(`^${SPACELESS}$`, 'u');
const WORD_CHAR = /^[\p{L}\p{M}\p{N}]$/u;
const SPACED_BEFORE = new RegExp(`(?:(?!${SPACELESS})[\\p{L}\\p{N}])$`, 'u');
const SPACED_AFTER = new RegExp(`^(?:(?!${SPACELESS})[\\p{L}\\p{N}])`, 'u');
const HEX = /(?<![\p{L}\p{N}#])#[0-9a-f]+(?![\p{L}\p{N}])/giu;

const MARK = String.raw`\[[ xX✓✔]?\]|[☑☐✓✔✅✗✘☒❌]`;
const NOT_DONE = new Set(['[ ]', '[]', '☐', '✗', '✘', '☒', '❌']);
const ONLY_MARK = new RegExp(`^(?:${MARK})$`, 'u');
const MARK_FIRST = new RegExp(`^(?:\\s*\\d+[.)])?[^\\p{L}\\p{N}]*?(${MARK})(.*)$`, 'u');
const MARK_LAST = new RegExp(`^(.*?)(${MARK})\\s*$`, 'u');
const OPENS_ITEM = new RegExp(`[-*•|]|\\d+[.)]\\s|${MARK}`, 'uy');

const ASCII_ONLY = /^[\x00-\x7f]*$/;
const UNSEEN = /[­​-‍⁠️﻿]/g;

/** The text in one written form: compatibility characters as their plain ones, accents composed, nothing invisible. */
const uniform = (text: string): string => (ASCII_ONLY.test(text) ? text : text.normalize('NFKC').replace(UNSEEN, ''));

const enum Char {
  Other,
  Letter,
  /** One character of a script written without spaces: a token by itself. */
  Lone,
  Digit,
  Newline,
  /** A tab or "|". */
  Cell,
  /** "。", which ends a sentence wherever it stands. */
  FullStop,
  /** Ends a sentence when white space follows it, with or without a closing quote or bracket between. */
  Stop,
  Closer,
  Space,
}

const ASCII = Array.from({ length: 128 }, (_v, code): Char => {
  const char = String.fromCharCode(code);
  if (/[a-z]/i.test(char)) return Char.Letter;
  if (/\d/.test(char)) return Char.Digit;
  if (char === '\n') return Char.Newline;
  if (char === '\t' || char === '|') return Char.Cell;
  if ('.!?'.includes(char)) return Char.Stop;
  if ('"\')]'.includes(char)) return Char.Closer;
  return /\s/.test(char) ? Char.Space : Char.Other;
});
const BEYOND_ASCII = new Map<string, Char>([
  ['。', Char.FullStop],
  ...[...'”’»」』'].map((char): [string, Char] => [char, Char.Closer]),
]);

const beyondAscii = (char: string): Char =>
  BEYOND_ASCII.get(char) ?? (SPACELESS_CHAR.test(char) ? Char.Lone : WORD_CHAR.test(char) ? Char.Letter : /^\s$/u.test(char) ? Char.Space : Char.Other);

const isDigit = (text: string, at: number) => ASCII[text.charCodeAt(at)] === Char.Digit;
const isCurrency = (char: string | undefined) => char === '$' || (char !== undefined && char > '\x7f' && /^\p{Sc}$/u.test(char));

/** How many code units the character here takes: two for one outside the basic plane. */
function width(text: string, at: number): number {
  return text.codePointAt(at)! > 0xffff ? 2 : 1;
}

function kindAt(text: string, at: number): Char {
  const code = text.charCodeAt(at);
  return code < 128 ? ASCII[code]! : beyondAscii(String.fromCodePoint(text.codePointAt(at)!));
}

/** Words whose period is part of the word and ends no sentence. A single letter and a run of initials are read the same way. */
const ABBREVIATIONS = new Set('dr mr mrs ms mx prof sr jr st mt ft vs approx est fig vol inc ltd corp dept ca cf pp'.split(' '));

const MAGNITUDES = new Map([['千', 1e3], ['万', 1e4], ['萬', 1e4], ['亿', 1e8], ['億', 1e8]]);

const DIGIT_GROUPS = /\d+(?:(?:\/\d+)+|(?:[.,]\d+)*)/y;
const DIGITS_AND_DOTS = /\d+(?:\.\d+)*/y;
const SPACED_THOUSANDS = /(?: \d{3})+(?!\d)/y;
const THOUSANDS = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const DECIMAL_COMMA = /^\d+,\d+$/;
const DOTTED_THOUSANDS = /^\d{1,3}(?:\.\d{3})+,\d+$/;

type Written = Pick<Num, 'value' | 'readings' | 'literal'>;

const valued = (value: number, readings = [value]): Written => ({ value, readings, literal: '' });

/** A form that is several numbers and no one value, such as a date, a version or a fraction: it states itself and each group. */
function grouped(groups: string[], by: string): Written {
  const readings = groups.map(Number);
  return { value: NaN, readings, literal: readings.join(by) };
}

const dotted = (digits: string): Written => (digits.split('.').length > 2 ? grouped(digits.split('.'), '.') : valued(Number(digits)));

/**
 * What digit groups joined by commas, dots or slashes state, and how many of their characters are the one number.
 * Fewer than all of them means a list: the first entry is read here and the rest are numbers of their own.
 */
function read(written: string): Written & { taken: number } {
  const taken = written.length;
  if (written.includes('/')) return { ...grouped(written.split('/'), '/'), taken };
  const parts = written.split(',');
  if (parts.length === 1) return { ...dotted(written), taken };
  if (THOUSANDS.test(written)) {
    const whole = Number(written.replaceAll(',', ''));
    // "1,200" can only be twelve hundred. "100,200" may also be a hundred and two hundred, so it states all three.
    return { ...valued(whole, parts[0]!.length === 3 ? [whole, ...parts.map(Number)] : [whole]), taken };
  }
  if (DECIMAL_COMMA.test(written)) return { ...valued(Number(written.replace(',', '.')), [Number(written.replace(',', '.')), ...parts.map(Number)]), taken };
  if (DOTTED_THOUSANDS.test(written)) return { ...valued(Number(written.replaceAll('.', '').replace(',', '.'))), taken };
  return { ...dotted(parts[0]!), taken: parts[0]!.length };
}

/** The value times a magnitude, without the stray digits binary multiplication leaves: 1.1 thousand is 1100. */
const times = (value: number, magnitude: number) => Number((value * magnitude).toPrecision(15));

/**
 * Reads a text into tokens, with the breaks between them.
 * Read by hand, one character at a time: a pattern over Unicode classes took several times as long on plain Latin text.
 * A class and not a function with helpers inside it, because a claim is read for every field and each helper would be made anew.
 */
class Reader implements Tokens {
  readonly list: Token[] = [];
  readonly breaks: number[] = [];
  private readonly size: number;
  private at = 0;
  /** The breaks met since the last token. */
  private pending = 0;
  private stopped = false;
  /** Where the last token ended. */
  private end = -1;
  /** Where this line's first character that is not white space stands, or -1 before it. */
  private lineFrom = -1;
  /** The index this line's first token has, or will have. */
  private lineHead = 0;
  private cells = false;
  /** Numbers that start before here are entries of a comma list, so a comma groups nothing. */
  private listEnd = 0;

  constructor(private readonly text: string) {
    this.size = text.length;
    while (this.at < this.size) this.step();
    this.closeRow();
  }

  private step(): void {
    const { text, at } = this;
    const kind = kindAt(text, at);
    // A tab that indents a line separates no cells.
    if (kind === Char.Space || (kind === Char.Cell && this.lineFrom < 0 && text[at] === '\t')) {
      if (this.stopped) this.pending |= Break.Sentence;
      this.stopped = false;
      this.at++;
      return;
    }
    if (kind === Char.Newline) {
      if (this.stopped) this.pending |= Break.Sentence;
      if (this.lineFrom < 0) this.pending |= Break.Blank;
      this.closeRow();
      this.stopped = this.cells = false;
      this.lineFrom = -1;
      this.lineHead = this.list.length;
      this.at++;
      return;
    }
    if (this.lineFrom < 0) {
      this.lineFrom = at;
      if (kind !== Char.Letter && kind !== Char.Lone) {
        OPENS_ITEM.lastIndex = at;
        if (OPENS_ITEM.test(text)) this.pending |= Break.Item;
      }
    }
    if (kind === Char.Letter) this.word();
    else if (kind === Char.Lone) {
      if (this.stopped) this.pending |= Break.FullStop;
      const to = at + width(text, at);
      this.push(text.slice(at, to), to);
    } else if (kind === Char.Digit) this.number();
    else {
      if (kind === Char.FullStop) this.pending |= Break.FullStop;
      else if (kind === Char.Cell) {
        this.pending |= Break.Cell;
        this.cells = true;
      }
      this.stopped = kind === Char.Stop || (kind === Char.Closer && this.stopped);
      this.at += width(text, at);
    }
  }

  private push(token: Token, to: number): void {
    this.list.push(token);
    this.breaks.push(this.pending);
    this.pending = 0;
    this.stopped = false;
    this.at = this.end = to;
  }

  private closeRow(): void {
    if (!this.cells) return;
    if (this.lineHead < this.list.length) this.breaks[this.lineHead]! |= Break.Row;
    this.pending |= Break.Row;
  }

  private inWord(index: number): boolean {
    if (index >= this.size) return false;
    const kind = kindAt(this.text, index);
    return kind === Char.Letter || kind === Char.Digit || kind === Char.Lone;
  }

  private lettersEnd(from: number): number {
    const { text, size } = this;
    let to = from;
    while (to < size) {
      const code = text.charCodeAt(to);
      if (code < 128) {
        if (ASCII[code] !== Char.Letter) break;
        to++;
      } else if (kindAt(text, to) === Char.Letter) to += width(text, to);
      else break;
    }
    return to;
  }

  private spaces(from: number, to: number): boolean {
    for (let index = from; index < to; index++) if (this.text[index] !== ' ') return false;
    return to > from;
  }

  private word(): void {
    const { text, at, size } = this;
    // Most words are plain lower case already, and those are sliced out as they stand.
    let to = at;
    let code = text.charCodeAt(to);
    while (code >= 97 && code <= 122) code = text.charCodeAt(++to);
    const lower = !(code < 128 ? ASCII[code] === Char.Letter : to < size && kindAt(text, to) === Char.Letter);
    if (!lower) to = this.lettersEnd(to);
    const single = to - at === 1;
    let initials = false;
    let apostrophe = false;
    let next = text.charCodeAt(to);
    // "U.S." is the word "us": single letters joined by periods, with the period that closes them.
    if (single) {
      while (next === 46 && to + 1 < size && kindAt(text, to + 1) === Char.Letter && !this.inWord(to + 2)) {
        to += 2;
        initials = true;
        next = text.charCodeAt(to);
      }
    }
    while (!initials && (next === 39 || next === 0x2019) && to + 1 < size && kindAt(text, to + 1) === Char.Letter) {
      to = this.lettersEnd(to + 1);
      apostrophe = true;
      next = text.charCodeAt(to);
    }
    let written = lower && !initials && !apostrophe ? text.slice(at, to) : text.slice(at, to).toLowerCase();
    if (initials) written = written.replaceAll('.', '');
    if (apostrophe) {
      written = written.replaceAll('’', "'");
      if (written.endsWith("'s")) written = written.slice(0, -2);
    }
    // "C++", "A+" and "C#" are words of their own, so "C" and "a" do not state them.
    if (next === 43 || next === 35) {
      const after = next === 43 && text[to + 1] === '+' ? to + 2 : to + 1;
      if (!this.inWord(after) && text[after] !== '+' && text[after] !== '#') {
        written += text.slice(to, after);
        to = after;
        next = text.charCodeAt(to);
      }
    }
    if (next === 46 && (initials || single || ABBREVIATIONS.has(written))) to++;
    this.push(written, to);
  }

  /** How a dash set against the number after it reads: 0 for no sign, 1 for a minus, 2 for a minus or no sign. */
  private sign(index: number): 0 | 1 | 2 {
    const char = this.text[index];
    // Straight after a token it is a hyphen or a range: "GPT-4", "10-12".
    if ((char !== '-' && char !== '−' && char !== '–') || index === this.end) return 0;
    // At the start of a line it may be a bullet, and after a number and a space it may be a range.
    return index === this.lineFrom || this.afterNumber(index) ? 2 : 1;
  }

  /** Only spaces stand between the last token, a number, and here. */
  private afterNumber(index: number): boolean {
    return typeof this.list[this.list.length - 1] === 'object' && this.spaces(this.end, index);
  }

  private comparator(index: number): string {
    const { text } = this;
    const from = text[index] === ' ' ? index - 1 : index;
    const char = text[from];
    if (char === '≥' || char === '≤') return char;
    if (char === '=' && (text[from - 1] === '>' || text[from - 1] === '<')) return text[from - 1] === '>' ? '≥' : '≤';
    return (char === '>' || char === '<') && text[from - 1] !== '-' && text[from - 1] !== '=' ? char : '';
  }

  private number(): void {
    const { text, at: start } = this;
    let before = start - 1;
    let minus = this.sign(before);
    if (minus) before--;
    let glued = '';
    if (isCurrency(text[before])) {
      glued = text[before--]!;
      if (!minus && (minus = this.sign(before))) before--;
    }
    const first = before + 1;
    glued += this.comparator(before);

    // After a letter the digits are part of a name, as in "Q1,120", and group nothing.
    const free = start >= this.listEnd && !(start === this.end && kindAt(text, start - 1) === Char.Letter);
    const groups = free ? DIGIT_GROUPS : DIGITS_AND_DOTS;
    groups.lastIndex = start;
    const written = groups.exec(text)![0];
    let { value, readings, literal, taken } = read(written);
    if (taken < written.length) this.listEnd = start + written.length;
    let to = start + taken;

    // "1 200" is twelve hundred, unless it follows a number and a space, which makes a row of numbers.
    if (free && text[to] === ' ' && written.length <= 3 && String(value) === written.replace(/^0+(?=\d)/, '') && !this.afterNumber(first)) {
      SPACED_THOUSANDS.lastIndex = to;
      const more = SPACED_THOUSANDS.exec(text)?.[0];
      if (more) {
        const each = more.trim().split(' ');
        value = Number(written + each.join(''));
        readings = written.length === 3 ? [value, Number(written), ...each.map(Number)] : [value];
        to += more.length;
      }
    }

    if (!Number.isNaN(value)) {
      // "5k" and "3万" state five thousand and thirty thousand, not five and three. "5km" is still five.
      const char = text[to];
      const han = char === ' ' ? to + 1 : to;
      let magnitude = MAGNITUDES.get(text[han]!);
      if (magnitude) to = han + 1;
      else if ((char === 'k' || char === 'K' || char === 'M') && !this.inWord(to + 1)) {
        magnitude = char === 'M' ? 1e6 : 1e3;
        to += 1;
      } else if ((char === 'b' || char === 'B') && (text[to + 1] === 'n' || text[to + 1] === 'N') && !this.inWord(to + 2)) {
        magnitude = 1e9;
        to += 2;
      }
      if (magnitude) {
        const by = magnitude;
        value = times(value, by);
        readings = readings.map((reading) => times(reading, by));
      }
      if (minus) {
        const below = readings.map((reading) => -reading);
        value = -value;
        readings = minus === 2 ? [...below, ...readings] : below;
      }
    }

    const after = text[to] === ' ' ? to + 1 : to;
    if (text[after] === '%' || (isCurrency(text[after]) && !isDigit(text, after + 1))) {
      glued += text[after];
      to = after + 1;
    }
    this.push({ value, readings, literal, glued }, to);
  }
}

const tokenize = (text: string): Tokens => new Reader(text);

const phrases = (...written: string[]): Token[][] => written.map((phrase) => tokenize(phrase).list);
const MONEY: Record<string, Token[][]> = {
  $: phrases('dollars', 'dollar', 'usd', '美元'),
  '€': phrases('euros', 'euro', 'eur', '欧元'),
  '£': phrases('pounds', 'pound', 'gbp', '英镑'),
  '¥': phrases('yen', 'yuan', 'jpy', 'cny', 'rmb', '元', '円', '日元', '人民币'),
  '₹': phrases('rupees', 'rupee', 'inr'),
  '₩': phrases('won', 'krw', '원'),
};
/** The words that say what a sign glued to a number says, where they stand before the number and where after it. */
const WORDS_BEFORE: Record<string, Token[][]> = {
  ...MONEY,
  '%': phrases('百分之'),
  '>': phrases('more than', 'greater than', 'over', 'above', '超过', '大于', '多于', '高于'),
  '<': phrases('less than', 'fewer than', 'under', 'below', '不到', '小于', '少于', '低于', '不足'),
  '≥': phrases('at least', 'no less than', 'no fewer than', '至少', '不少于', '不低于'),
  '≤': phrases('at most', 'up to', 'no more than', '至多', '最多', '不超过'),
};
const WORDS_AFTER: Record<string, Token[][]> = { ...MONEY, '%': phrases('percent', 'per cent', 'pct') };

/** The token at `at` is a number that states what the asked number states, with every sign the asked one carries. */
function states({ list }: Tokens, at: number, asked: Num): boolean {
  const written = list[at];
  if (typeof written !== 'object') return false;
  if (Number.isNaN(asked.value)) return written.literal === asked.literal;
  if (!written.readings.includes(asked.value)) return false;
  for (const symbol of asked.glued) {
    if (written.glued.includes(symbol)) continue;
    const before = WORDS_BEFORE[symbol]?.some((phrase) => phrase.every((token, n) => list[at - phrase.length + n] === token));
    if (!before && !WORDS_AFTER[symbol]?.some((phrase) => phrase.every((token, n) => list[at + 1 + n] === token))) return false;
  }
  return true;
}

const same = (text: Tokens, at: number, asked: Token) => (typeof asked === 'string' ? text.list[at] === asked : states(text, at, asked));

/** After a first token that matches at `start`, the rest of the asked tokens follow it there and cross none of the barred breaks. */
function runs(text: Tokens, start: number, asked: Tokens, barred: number): boolean {
  for (let n = 1; n < asked.list.length; n++) {
    if (!same(text, start + n, asked.list[n]!) || (text.breaks[start + n]! & barred & ~asked.breaks[n]!) !== 0) return false;
  }
  return true;
}

/** Each line that carries one check mark, as the mark and the line's own text without it. A table row gives its other cells. */
function marked(text: string): { item: Tokens; done: boolean }[] {
  const lines: { item: Tokens; done: boolean }[] = [];
  for (const line of text.split('\n')) {
    const cells = /[|\t]/.test(line) ? line.split(/[|\t]/).map((cell) => cell.trim()) : [];
    const marks = cells.filter((cell) => ONLY_MARK.test(cell));
    if (marks.length === 1) {
      for (const cell of cells) if (cell && cell !== marks[0]) lines.push({ item: tokenize(cell), done: !NOT_DONE.has(marks[0]!) });
      continue;
    }
    const first = MARK_FIRST.exec(line);
    const last = first ? null : MARK_LAST.exec(line);
    const mark = first?.[1] ?? last?.[2];
    if (mark) lines.push({ item: tokenize(first?.[2] ?? last![1]!), done: !NOT_DONE.has(mark) });
  }
  return lines;
}

class Source implements Grounding {
  private readonly text: string;
  private read: Tokens | undefined;
  private numbers: Set<number> | undefined;
  private hexes: Set<string> | undefined;
  private lines: ReturnType<typeof marked> | undefined;

  constructor(source: string) {
    this.text = uniform(source);
  }

  private get tokens(): Tokens {
    return (this.read ??= tokenize(this.text));
  }

  says(claim: string): boolean {
    return this.stated(claim, SHORT);
  }

  quotes(passage: string): boolean {
    return this.stated(passage, PASSAGE);
  }

  writes(value: number): boolean {
    this.numbers ??= new Set(this.tokens.list.flatMap((token) => (typeof token === 'object' ? token.readings : [])));
    return Number.isFinite(value) && this.numbers.has(value);
  }

  paints(hex: string): boolean {
    this.hexes ??= new Set(this.text.match(HEX)?.map((written) => written.toLowerCase()));
    return this.hexes.has(hex.trim().toLowerCase());
  }

  ticks(words: string): boolean | undefined {
    const asked = tokenize(uniform(words));
    if (asked.list.length === 0) return undefined;
    this.lines ??= marked(this.text);
    return this.lines.find(({ item }) => item.list.length === asked.list.length && asked.list.every((token, n) => same(item, n, token)))?.done;
  }

  private stated(claim: string, barred: number): boolean {
    const written = uniform(claim);
    const asked = tokenize(written);
    if (asked.list.length > 0) return this.holds(asked, barred);
    const symbols = written.trim();
    return symbols.length > 0 && this.standsAlone(symbols);
  }

  /** The asked tokens are a run of the text's tokens that crosses none of the barred breaks. */
  private holds(asked: Tokens, barred: number): boolean {
    const written = this.tokens;
    const { list } = written;
    const first = asked.list[0]!;
    if (typeof first === 'string') {
      for (let start = list.indexOf(first); start >= 0; start = list.indexOf(first, start + 1)) if (runs(written, start, asked, barred)) return true;
      return false;
    }
    for (let start = 0; start < list.length; start++) if (states(written, start, first) && runs(written, start, asked, barred)) return true;
    return false;
  }

  private standsAlone(symbols: string): boolean {
    const { text } = this;
    for (let at = text.indexOf(symbols); at >= 0; at = text.indexOf(symbols, at + 1)) {
      const before = text.slice(Math.max(0, at - 2), at);
      const after = text.slice(at + symbols.length, at + symbols.length + 2);
      if (!SPACED_BEFORE.test(before) && !SPACED_AFTER.test(after)) return true;
    }
    return false;
  }
}

export const grounding = (source: string): Grounding => new Source(source);
