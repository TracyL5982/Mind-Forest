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
  /** The text writes this number, in any grouping. Counted in a unit that scales it, as 万, 亿, 千, k, M and bn do, it is written with that unit against it: 2189 in 万 is "2189万". */
  writes(value: number, unit?: string): boolean;
  /** The text writes this number with this unit set against it, before or after: "45%", "$120", "12 films", and "2189万" for 2189 in 万. */
  measures(value: number, unit: string): boolean;
  /** The text writes every number these words write. Words that write no number tally. */
  tallies(words: string): boolean;
  /** The text writes this hex colour, with its "#", as a whole value. */
  paints(hex: string): boolean;
  /** The check mark on the line whose own text is these words: done, not done, or none. */
  ticks(words: string): boolean | undefined;
  /**
   * The words name the value where the text writes it: every word of the label stands, in any order, in one sentence, one line or
   * one table row that also holds the value. A number is read as `writes` reads it, with its unit. "fell by 15%" names no "absences".
   */
  names(label: string, value: string | number, unit?: string): boolean;
  /**
   * As `quotes`, and the passage is whole: it begins where a sentence, a line, a table cell or quoted words begin, and ends where
   * one ends. "take the pills" is no whole passage of "Do not take the pills."
   */
  whole(passage: string): boolean;
  /** As `quotes`, and the passage begins where a sentence, a line, a table cell or quoted words begin. It may break off anywhere. */
  leads(passage: string): boolean;
  /** The text opens with these words. */
  begins(passage: string): boolean;
  /**
   * The text gives the term this meaning. The meaning is a passage that ends where a sentence or a line ends. It is whole and the
   * term stands in one of its sentences or in the sentence before or after, or it follows the term in the term's own sentence with
   * nothing between them but punctuation or a linking word, as in "Parallax: the shift…" and "Parallax is the shift…".
   * A meaning that follows another lead, as in "Bias: an error…", is not whole, and is the meaning of that lead alone.
   */
  defines(term: string, meaning: string): boolean;
}

const enum Break {
  /** ".", "!" or "?" before white space, unless the period closes an abbreviation. */
  Sentence = 1,
  /** "。", or "!" or "?" set straight against a character of a script written without spaces. */
  FullStop = 2,
  /** An empty line. */
  Blank = 4,
  /** A "|" between two cells of a table row. */
  Cell = 8,
  /** The start of a line that opens with a bullet, a number and a dot, a check box or "|". */
  Item = 16,
  /** The line break before or after a line that holds table cells. */
  Row = 32,
  /** A tab inside a line: a cell break to a short claim. Prose holds tabs too, so a passage reads one as white space. */
  Tab = 64,
  /** A line break of any kind. */
  Line = 128,
  /** A quotation mark that opens words the text itself sets apart. */
  Quote = 256,
  /** A quotation mark that closes them. */
  Unquote = 1024,
  /** A colon after the first few words of a line or a sentence, which are then a marker or a speaker: "Caution:", "Dad:". */
  Lead = 512,
}

const SHORT = Break.FullStop | Break.Cell | Break.Item | Break.Row | Break.Tab;
const PASSAGE = Break.FullStop | Break.Cell | Break.Item | Break.Row | Break.Sentence | Break.Blank;
/** Where one sentence ends and the next begins, to a claim that must stand inside one. A line break inside a sentence does not end it. */
const SENTENCE = Break.Sentence | Break.FullStop | Break.Blank | Break.Item | Break.Row;
const APART = SENTENCE | Break.Line | Break.Cell | Break.Tab;
/** Where a whole passage may begin, where one may begin when a lead may stand before it, and before which one may end. */
const EDGES = { start: APART | Break.Quote, led: APART | Break.Quote | Break.Lead, end: APART | Break.Unquote };
/** The most words a lead has. */
const LEAD_WORDS = 3;

/** A number as a text writes it. */
interface Num {
  /** The value a claim written this way asks for. NaN for a form with no one value, such as a dotted date. */
  value: number;
  /** Every value the written form may be read as: "100,200" is one number or two. */
  readings: number[];
  /** The groups of a form with no one value, without their leading zeros: "2024.3.15". Empty otherwise. */
  literal: string;
  /** The currency sign, percent sign, degree sign and comparator written against the number, which a claim that carries them asks for. */
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

const OPENING_MARKS = new Set([...'“„‘«「『']);
const CLOSING_MARKS = new Set([...'”»」』']);
/** A mark that opens words when it follows white space or an opening bracket, and closes them otherwise. */
const EITHER_MARKS = new Set([...'"\'’']);
const BEFORE_OPENING = /^[\s([{]?$/u;

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
  /** The index of the first token of this sentence or line. */
  private opened = 0;
  /** How many tokens stand before the character at `mark`. */
  readonly marked: number;

  constructor(private readonly text: string, mark = text.length) {
    this.size = text.length;
    while (this.at < mark) this.step();
    this.marked = this.list.length;
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
      this.pending |= Break.Line;
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
        this.pending |= text[at] === '\t' ? Break.Tab : Break.Cell;
        this.cells = true;
      } else if (OPENING_MARKS.has(text[at]!) || (EITHER_MARKS.has(text[at]!) && BEFORE_OPENING.test(text[at - 1] ?? ''))) this.pending |= Break.Quote;
      else if (CLOSING_MARKS.has(text[at]!) || EITHER_MARKS.has(text[at]!)) this.pending |= Break.Unquote;
      else if ((text[at] === ':' || text[at] === '：') && (this.pending & ~Break.Unquote) === 0 && this.list.length > this.opened && this.list.length - this.opened <= LEAD_WORDS) this.pending |= Break.Lead;
      this.stopped = kind === Char.Stop || (kind === Char.Closer && this.stopped);
      this.at += width(text, at);
    }
  }

  private push(token: Token, to: number): void {
    if ((this.pending & (SENTENCE | Break.Line)) !== 0) this.opened = this.list.length;
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
    if (text[after] === '%' || text[after] === '°' || (isCurrency(text[after]) && !isDigit(text, after + 1))) {
      glued += text[after];
      to = after + 1;
    }
    this.push({ value, readings, literal, glued }, to);
  }
}

const tokenize = (text: string): Tokens => new Reader(text);

/** The words that may stand between a term and its meaning in one sentence. */
const LINKS = ['is', 'are', 'was', 'were', 'means', 'mean', 'refers to', 'stands for', 'is when', 'is where', '是', '是指', '指', '指的是', '就是', '即', '意思是', '的意思是', '叫', '叫做'].map(
  (phrase) => tokenize(phrase).list,
);

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
  /** Where the words end and the held values begin. */
  private readonly mark: number;
  private read: Reader | undefined;
  private numbers: Set<number> | undefined;
  private hexes: Set<string> | undefined;
  private lines: ReturnType<typeof marked> | undefined;
  private spans: { sentence: Int32Array; line: Int32Array } | undefined;
  /** Each claim read so far. A card asks about the same value more than once: as a value, and as what its label names. */
  private readonly claims = new Map<string, Tokens>();

  constructor(source: string, held: readonly string[]) {
    const words = uniform(source);
    this.mark = words.length;
    this.text = held.length === 0 ? words : `${words}\n${held.map((value) => `• ${uniform(value)}`).join('\n')}`;
  }

  private get tokens(): Reader {
    return (this.read ??= new Reader(this.text, this.mark));
  }

  /**
   * The ways a text may set a unit against a number, each as a claim: the unit after the number, before it,
   * and around it when a currency sign leads the unit, as "$120k" writes 120 in "$k".
   */
  private against(value: number, unit: string): Tokens[] {
    const sign = uniform(unit).trim();
    if (sign === '') return [];
    const written = [`${value}${sign}`, `${sign}${value}`];
    if (sign.length > 1 && isCurrency(sign[0])) written.push(`${sign[0]}${value}${sign.slice(1)}`);
    return written.map((form) => this.claim(form)).filter((asked) => asked.list.length > 0);
  }

  private claim(words: string): Tokens {
    let asked = this.claims.get(words);
    if (!asked) this.claims.set(words, (asked = tokenize(uniform(words))));
    return asked;
  }

  says(claim: string): boolean {
    return this.stated(claim, SHORT);
  }

  quotes(passage: string): boolean {
    return this.stated(passage, PASSAGE);
  }

  writes(value: number, unit?: string): boolean {
    if (!Number.isFinite(value)) return false;
    const scaled = this.scaled(value, unit);
    if (scaled.length > 0) return scaled.some((asked) => this.holds(asked, SHORT));
    this.numbers ??= new Set(this.tokens.list.flatMap((token) => (typeof token === 'object' ? token.readings : [])));
    return this.numbers.has(value);
  }

  measures(value: number, unit: string): boolean {
    if (!Number.isFinite(value)) return false;
    return this.against(value, unit).some((asked) => {
      const [only] = asked.list;
      // A sign the reading drops, as "%" before a number, leaves the bare number, which is measured in nothing.
      const bare = asked.list.length === 1 && typeof only === 'object' && only.glued === '' && only.value === value;
      return !bare && this.holds(asked, SHORT);
    });
  }

  tallies(words: string): boolean {
    // A form with no one value, such as a date, tallies when each of its groups is written.
    return this.claim(words).list.every((token) => typeof token !== 'object' || (Number.isNaN(token.value) ? token.readings : [token.value]).every((value) => this.writes(value)));
  }

  paints(hex: string): boolean {
    this.hexes ??= new Set(this.text.match(HEX)?.map((written) => written.toLowerCase()));
    return this.hexes.has(hex.trim().toLowerCase());
  }

  ticks(words: string): boolean | undefined {
    const asked = this.claim(words);
    if (asked.list.length === 0) return undefined;
    this.lines ??= marked(this.text);
    return this.lines.find(({ item }) => item.list.length === asked.list.length && asked.list.every((token, n) => same(item, n, token)))?.done;
  }

  names(label: string, value: string | number, unit?: string): boolean {
    const words = this.claim(label).list;
    if (words.length === 0) return false;
    const written = this.tokens;
    const within = (from: number, to: number) =>
      words.every((word) => {
        for (let at = from; at < to; at++) if (same(written, at, word)) return true;
        return false;
      });
    const named = (start: number, size: number) => {
      const { sentence, line } = this.spanned();
      for (const span of [sentence, line]) {
        let [from, to] = [start, start + size];
        while (from > 0 && span[from - 1] === span[start]) from--;
        while (to < written.marked && span[to] === span[start]) to++;
        if (within(from, to)) return true;
      }
      return false;
    };
    if (typeof value === 'string') {
      const asked = this.claim(value);
      return asked.list.length > 0 && this.holds(asked, SHORT, (start) => named(start, asked.list.length));
    }
    if (!Number.isFinite(value)) return false;
    const scaled = this.scaled(value, unit);
    if (scaled.length > 0) return scaled.some((asked) => this.holds(asked, SHORT, (start) => named(start, asked.list.length)));
    for (let at = 0; at < written.marked; at++) {
      const token = written.list[at]!;
      if (typeof token === 'object' && token.readings.includes(value) && named(at, 1)) return true;
    }
    return false;
  }

  whole(passage: string): boolean {
    return this.passage(passage, true, true);
  }

  leads(passage: string): boolean {
    return this.passage(passage, true, false);
  }

  begins(passage: string): boolean {
    const asked = this.claim(passage);
    return asked.list.length > 0 && same(this.tokens, 0, asked.list[0]!) && runs(this.tokens, 0, asked, 0);
  }

  defines(term: string, meaning: string): boolean {
    const [named, meant] = [this.claim(term), this.claim(meaning)];
    if (named.list.length === 0 || meant.list.length === 0) return false;
    const written = this.tokens;
    const { sentence } = this.spanned();
    return this.holds(meant, PASSAGE, (from) => {
      const last = from + meant.list.length - 1;
      if (!this.edge(last + 1, 'end')) return false;
      const whole = this.edge(from, 'start');
      const led = (written.breaks[from]! & Break.Lead) !== 0;
      return this.holds(named, SHORT, (at) => {
        const end = at + named.list.length;
        // Two lines that each open with a lead pair what follows the leads, as "Term: Parallax" and "Definition: the shift…" do.
        const paired = led && (written.breaks[at]! & Break.Lead) !== 0;
        if ((whole || paired) && sentence[at]! >= sentence[from]! - 1 && sentence[at]! <= sentence[last]! + 1) return true;
        if (end > from || sentence[at] !== sentence[from]) return false;
        const between = written.list.slice(end, from);
        return between.length === 0 || LINKS.some((link) => link.length === between.length && link.every((token, n) => token === between[n]));
      });
    });
  }

  /** The values a text may write for this number in a unit that scales it, each as a claim. None when the unit does not scale it. */
  private scaled(value: number, unit: string | undefined): Tokens[] {
    return unit === undefined ? [] : this.against(value, unit).filter(({ list: [first] }) => typeof first === 'object' && !Number.isNaN(first.value) && first.value !== value);
  }

  /**
   * The sentence each token stands in, and its line. A list item, a table row and a line that opens with a lead, as "Height: 330 m"
   * does, are each a sentence of their own, whatever ends them. Only an item or a row is a line of its own: a line of prose holds
   * several sentences, and there each sentence counts as a line.
   */
  private spanned(): { sentence: Int32Array; line: Int32Array } {
    if (this.spans) return this.spans;
    const { breaks } = this.tokens;
    const [sentence, line] = [new Int32Array(breaks.length), new Int32Array(breaks.length)];
    let apart = false;
    for (let from = 0, to = 1; from < breaks.length; from = to++) {
      let listed = (breaks[from]! & (Break.Item | Break.Row)) !== 0;
      let led = false;
      for (; to < breaks.length && (breaks[to]! & Break.Line) === 0; to++) {
        listed ||= (breaks[to]! & (Break.Cell | Break.Tab)) !== 0;
        led ||= to - from <= LEAD_WORDS && (breaks[to]! & Break.Lead) !== 0;
      }
      for (let at = Math.max(from, 1); at < to; at++) {
        const ended = (breaks[at]! & SENTENCE) !== 0;
        sentence[at] = sentence[at - 1]! + (ended || (at === from && (apart || listed || led)) ? 1 : 0);
        line[at] = line[at - 1]! + (at === from || (ended && !listed) ? 1 : 0);
      }
      apart = listed || led;
    }
    return (this.spans = { sentence, line });
  }

  /** A whole passage may begin at this token, or end before it: it is the first word, stands past the last, or follows such an edge. */
  private edge(at: number, as: keyof typeof EDGES): boolean {
    const { breaks, marked } = this.tokens;
    return at === 0 || at >= marked || (breaks[at]! & EDGES[as]) !== 0;
  }

  private passage(passage: string, fromEdge: boolean, toEdge: boolean): boolean {
    const asked = this.claim(passage);
    return asked.list.length > 0 && this.holds(asked, PASSAGE, (start) => (!fromEdge || this.edge(start, 'led')) && (!toEdge || this.edge(start + asked.list.length, 'end')));
  }

  private stated(claim: string, barred: number): boolean {
    const asked = this.claim(claim);
    if (asked.list.length > 0) return this.holds(asked, barred);
    const symbols = uniform(claim).trim();
    return symbols.length > 0 && this.standsAlone(symbols);
  }

  /**
   * The asked tokens are a run of the text's tokens that crosses none of the barred breaks. With `where`, the run is one that
   * stands among the words, before any held value, at a start that `where` accepts.
   */
  private holds(asked: Tokens, barred: number, where?: (start: number) => boolean): boolean {
    const written = this.tokens;
    const { list } = written;
    const first = asked.list[0]!;
    const until = where ? written.marked - asked.list.length + 1 : list.length;
    const found = (start: number) => runs(written, start, asked, barred) && (where === undefined || where(start));
    if (typeof first === 'string') {
      for (let start = list.indexOf(first); start >= 0 && start < until; start = list.indexOf(first, start + 1)) if (found(start)) return true;
      return false;
    }
    for (let start = 0; start < until; start++) if (states(written, start, first) && found(start)) return true;
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

/**
 * `held` are values the source holds beside its words, each read as a list item of its own. A claim about how words stand
 * together, which `names`, `whole`, `leads` and `defines` are, is read against the words alone.
 */
export const grounding = (source: string, held: readonly string[] = []): Grounding => new Source(source, held);
