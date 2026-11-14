/**
 * A source text, asked whether it states a claim. Built once per text; each question reads the same token list, and the same units.
 *
 * The text and every claim are first brought to one written form (Unicode NFKC, invisible characters removed), so a
 * full-width digit or a decomposed accent is the character it looks like.
 *
 * A short claim, such as a value, a name or a label, is stated when its tokens are a run of whole tokens of the text. Case, spacing,
 * quote marks and other punctuation between tokens do not count. A token is a word, a number, or one character of a script written
 * without spaces, which makes a claim in such a script match as a substring. A number is one token with its sign and its magnitude:
 * "-3%", "负3%", "(£1.3m)" and "800 thousand" are each one number, and "3%", "£1.3m" and "800" are other numbers.
 *
 * A passage, an entry of a list or a step is stated only as whole units of the text, verbatim once white space is folded. A unit is one
 * whole sentence, one whole list line, one whole table cell, or a line that stands by itself: a heading, or a label ending in a colon.
 * No part of a unit is a passage, because no check on strings can tell when a part keeps what the whole says: "take ibuprofen with
 * warfarin" is part of "Do not take ibuprofen with warfarin."
 */
export interface Grounding {
  /** The text holds these words or this number, inside one table cell, one list item and one CJK sentence. A claim with no letter or digit must stand in the text as written. */
  says(claim: string): boolean;
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
   * The words name the value where the text writes it: each word of the label stands, in any order, in the unit that holds the value,
   * and for a table cell in its row or the head of its column. A word stands in its other forms too: "slept" for "sleep", "Jan" for
   * "January", "one" for "1". A label need not hold the words that only tie it together ("of", "per", "的"), and may not open or end
   * with one, which makes it a piece cut out of a phrase: "of the five-day group". "Height" names no "330 m long".
   */
  names(label: string, value: string | number, unit?: string): boolean;
  /** How the passage stands: as one or more whole units one after another, and then whether a reversing word stands beside them. */
  passage(passage: string): Passage;
  /** As `passage`, for a passage cut short: it opens where a unit opens and may end anywhere inside the units after it. */
  leads(passage: string): Passage;
  /** Someone's words: whole units, or the whole of a quotation inside one sentence that says who said it, as in 'He said, "Same time next year."' */
  said(passage: string): Passage;
  /** The meaning is whole units, the first of which opens with the term: "Parallax is the shift…", "Parallax: the shift…". */
  defines(term: string, meaning: string): Passage | 'apart';
  /** The text opens with these words. */
  begins(passage: string): boolean;
  /** The text is a conversation: three lines or more open with a name and a colon, of two people at least, one of whom speaks twice. */
  converses(): boolean;
}

/**
 * How a passage stands in a text.
 * - `whole`: it is one or more whole units, one after another.
 * - `turned`: it is, and a unit beside it, or the heading or label it sits under, holds a word of `REVERSING`.
 * - `cut`: the text holds its words, but not as whole units.
 * - `unstated`: the text does not hold its words.
 */
export type Passage = 'whole' | 'turned' | 'cut' | 'unstated';

/**
 * Words that may turn around what stands beside them: "That claim is false.", "Myth:", "Do not", "谣言", "别". A unit beside one,
 * or under one, is never shown without it. The table over-refuses on purpose, since a refused card falls back to the rules' card.
 */
export const REVERSING = {
  en: ['not true', 'untrue', 'false', 'myth', 'wrong', 'incorrect', 'mistaken', 'out of date', 'outdated', 'debunked', 'overturned', 'disproved', 'rumour', 'rumor', "don't", 'do not', 'never', 'avoid', 'not recommended', 'no longer'],
  zh: ['谣言', '不对', '错误', '误解', '被推翻', '推翻', '过时', '不要', '别', '禁止', '千万别', '并非', '不是真的', '已被证伪', '勿'],
} as const;

const enum Break {
  /** "。", or "!" or "?" set straight against a character of a script written without spaces. */
  FullStop = 2,
  /** A "|" between two cells of a table row. */
  Cell = 8,
  /** The start of a line that opens with a bullet, a number and a dot, a check box or "|". */
  Item = 16,
  /** The line break before or after a line that holds table cells. */
  Row = 32,
  /** A tab inside a line: a cell break to a short claim. */
  Tab = 64,
}

const SHORT = Break.FullStop | Break.Cell | Break.Item | Break.Row | Break.Tab;

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
const HAS_SPACELESS = new RegExp(SPACELESS, 'u');
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

const MAGNITUDES = new Map([['千', 1e3], ['万', 1e4], ['萬', 1e4], ['亿', 1e8], ['億', 1e8]]);
/** A magnitude written as a word after the number, which is part of it: "800 thousand" is 800000. */
const MAGNITUDE_WORD = /\s?(thousand|million|billion|trillion)(?![\p{L}\p{N}])/iuy;
const MAGNITUDE_WORDS: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
/** A word or words before a number that are its minus sign: "负3%", "零下5度", "minus 3". */
const SIGN_WORDS: Token[][] = [['负'], ['零', '下'], ['minus']];

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
  /** Where each token starts in the text. */
  readonly starts: number[] = [];
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
      this.stopped = false;
      this.at++;
      return;
    }
    if (kind === Char.Newline) {
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
      this.push(text.slice(at, to), at, to);
    } else if (kind === Char.Digit) this.number();
    else {
      if (kind === Char.FullStop) this.pending |= Break.FullStop;
      else if (kind === Char.Cell) {
        this.pending |= text[at] === '\t' ? Break.Tab : Break.Cell;
        this.cells = true;
      }
      this.stopped = kind === Char.Stop || (kind === Char.Closer && this.stopped);
      this.at += width(text, at);
    }
  }

  private push(token: Token, from: number, to: number): void {
    this.list.push(token);
    this.breaks.push(this.pending);
    this.starts.push(from);
    this.pending = 0;
    this.stopped = false;
    this.at = this.end = to;
  }

  /** Takes back the last `count` tokens, which a number reads as its sign, and gives where the first of them started. */
  private unpush(count: number): number {
    let from = this.at;
    for (let n = 0; n < count; n++) {
      this.list.pop();
      this.pending |= this.breaks.pop()!;
      from = this.starts.pop()!;
    }
    return from;
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
    let initials = false;
    let apostrophe = false;
    let next = text.charCodeAt(to);
    // "U.S." is the word "us": single letters joined by periods.
    if (to - at === 1) {
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
      }
    }
    this.push(written, at, to);
  }

  /** A dash set against the number after it is its minus sign, unless it follows a token straight: "GPT-4", "10-12". */
  private sign(index: number): boolean {
    const char = this.text[index];
    return (char === '-' || char === '−' || char === '–') && index !== this.end;
  }

  /** How many tokens before here are words that make the number after them negative: "负", "零下", "minus". */
  private signWords(first: number): number {
    const { list } = this;
    for (const words of SIGN_WORDS) {
      const at = list.length - words.length;
      if (at < 0 || !words.every((word, n) => list[at + n] === word)) continue;
      if (this.end === first || (words[0] === 'minus' && this.spaces(this.end, first))) return words.length;
    }
    return 0;
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
    let first = before + 1;
    glued += this.comparator(before);
    const signWords = minus ? 0 : this.signWords(first);
    if (signWords > 0) {
      minus = true;
      first = this.unpush(signWords);
    }

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

    let magnitude: number | undefined;
    if (!Number.isNaN(value)) {
      // "5k", "3万" and "800 thousand" state five thousand, thirty thousand and eight hundred thousand, not five, three and eight hundred.
      // "5km" is still five, and so is "5m" unless money is counted: "£1.3m" is 1.3 million.
      const char = text[to];
      const han = char === ' ' ? to + 1 : to;
      MAGNITUDE_WORD.lastIndex = to;
      const word = MAGNITUDE_WORD.exec(text);
      magnitude = MAGNITUDES.get(text[han]!);
      if (magnitude) to = han + 1;
      else if (word) {
        magnitude = MAGNITUDE_WORDS[word[1]!.toLowerCase()];
        to += word[0].length;
      } else if ((char === 'k' || char === 'K' || char === 'M' || (char === 'm' && isCurrency(glued[0]))) && !this.inWord(to + 1)) {
        magnitude = char === 'k' || char === 'K' ? 1e3 : 1e6;
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
    }

    const after = text[to] === ' ' ? to + 1 : to;
    if (text[after] === '%' || text[after] === '°' || (isCurrency(text[after]) && !isDigit(text, after + 1))) {
      glued += text[after];
      to = after + 1;
    }
    // An amount of money in brackets is a loss, as accounts write one: "(£1.3m)".
    if (!minus && (isCurrency(glued[0]) || magnitude) && /\(\s*$/.test(text.slice(Math.max(0, first - 3), first)) && /^[a-z]{0,3}\s*\)/i.test(text.slice(to, to + 6))) minus = true;
    if (minus && !Number.isNaN(value)) {
      value = -value;
      readings = readings.map((reading) => -reading);
    }
    this.push({ value, readings, literal, glued }, first, to);
  }
}

const tokenize = (text: string): Tokens => new Reader(text);

const phrases = (...written: string[]): Token[][] => written.map((phrase) => tokenize(phrase).list);

/** The words before a colon that open a remark and name no speaker: "Note:", "注意：". */
const MARKERS = ['caution', 'note', 'please note', 'nb', 'warning', 'important', 'reminder', 'tip', '注意', '提醒', '小心', '警告', '提示', '温馨提示', '重要'];
/** A line that opens with a short name and a colon, as a turn of a conversation does: "Mum: …", "妈妈：…". */
const SPEAKER = /^\s*([^\s:：]{1,12})\s*[:：]/u;

const TURNS = phrases(...REVERSING.en, ...REVERSING.zh);
/** The words of a sentence that say someone said what it quotes. */
const SPEECH = phrases(...['say', 'ask', 'tell', 'write', 'reply', 'add', 'explain', 'answer', 'recall', 'according to', 'put it'], ...['说', '问', '写道', '说道', '问道', '答道', '表示', '称', '回答', '讲']);
/** The words that may open a sentence before the term it defines. */
const OPENERS = phrases('', 'a', 'an', 'the', 'the word', 'the term', 'the phrase', 'the concept of', 'the idea of', '所谓');
/** The words that open a line that is no heading but the start of a sentence the next line goes on with. */
const CONDITIONS = phrases('if', 'when', 'unless', 'only if', '如果', '要是', '假如', '除非', '万一');
/** The words that open a line that goes on with the line before it. */
const GOES_ON = phrases(
  ...['and', 'or', 'but', 'nor', 'only', 'unless', 'until', 'because', 'than'],
  ...['但', '而', '并', '或', '以及', '和', '与', '及', '才', '就', '再', '否则', '除非', '只有', '只要', '以免', '以便', '不过', '可是', '然后', '所以', '因此', '也', '还', '的', '地', '得'],
);
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

/** Words a label needs no text to write, since they only tie its other words together. A label that opens or ends with one is cut out of a phrase. */
const TIES = new Set('a an the of per for to in at on by and or is are was were be with from as its 的 了 是 在 却 要 说 和 与 及 也 都'.split(' '));
/** Of those, the characters that also open words in a script written without spaces, as 在线 and 要求, which a label may begin with. */
const OPENS_WORDS = new Set(['在', '要']);
const TIE_PHRASES = phrases('已经');

const NUMBER_WORDS = new Map('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ').map((word, n) => [word, n + 1]));
/** Each month and weekday by its name, under the short forms a label may give it. */
const CALENDAR = new Map(
  'january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday'
    .split(' ')
    .flatMap((name) => [name, name.slice(0, 3), ...(name === 'september' ? ['sept'] : name === 'tuesday' ? ['tues'] : name === 'thursday' ? ['thur', 'thurs'] : [])].map((short): [string, string] => [short, name])),
);

/** The past forms of common verbs that no ending makes: "fell" is a form of "fall", as "slept" of "sleep". */
const IRREGULAR = new Map(
  Object.entries({
    fall: 'fell fallen', rise: 'rose risen', grow: 'grew grown', run: 'ran', take: 'took taken', make: 'made', pay: 'paid', sell: 'sold', buy: 'bought',
    spend: 'spent', win: 'won', lose: 'lost', give: 'gave given', go: 'went gone', come: 'came', see: 'saw seen', hold: 'held', leave: 'left', meet: 'met',
    bring: 'brought', think: 'thought', build: 'built', send: 'sent', begin: 'began begun', drive: 'drove driven', write: 'wrote written', eat: 'ate eaten',
    fly: 'flew flown', swim: 'swam swum', ride: 'rode ridden', feel: 'felt', find: 'found', get: 'got gotten', have: 'had', know: 'knew known', say: 'said',
    sit: 'sat', stand: 'stood', teach: 'taught', tell: 'told', wear: 'wore worn',
  }).flatMap(([base, past]) => past.split(' ').map((form): [string, string] => [form, base])),
);

/**
 * A Latin word with its endings taken off, so that its forms meet: "slept" and "sleep", "lands" and "landing", "groups" and "group".
 */
function stem(word: string): string {
  const irregular = IRREGULAR.get(word);
  if (irregular) return stem(irregular);
  if (word.length <= 3 || !/^[a-z]+$/.test(word)) return word;
  let w = word;
  if (/ie[sd]$/.test(w) && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (/(?:s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.endsWith('ept')) w = `${w.slice(0, -3)}eep`;
  if (/([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1);
  return w;
}
/** What is read once of a word or a label and kept, each up to a bound past which it starts again. */
function remembered<T>(read: (key: string) => T, bound: number): (key: string) => T {
  const kept = new Map<string, T>();
  return (key) => {
    if (kept.has(key)) return kept.get(key)!;
    if (kept.size >= bound) kept.clear();
    const value = read(key);
    kept.set(key, value);
    return value;
  };
}

/** The one form a label word and a text word are compared in. */
const formOf = remembered((word) => CALENDAR.get(word) ?? stem(word), 20_000);

/** The reversing phrases by the form of their first word, so a run of tokens is read once against the whole table. */
const TURNS_BY_FIRST = new Map<string, Token[][]>();
for (const phrase of TURNS) {
  const first = formOf(phrase[0] as string);
  TURNS_BY_FIRST.set(first, [...(TURNS_BY_FIRST.get(first) ?? []), phrase]);
}

/** The words of a label that must stand beside its value. Undefined for a label cut out of a phrase. */
const labelOf = remembered(readLabel, 2_000);

function readLabel(label: string): Token[] | undefined {
  const { list } = tokenize(uniform(label));
  const tie = (token: Token | undefined, opening: boolean) => typeof token === 'string' && TIES.has(token) && !(opening && OPENS_WORDS.has(token));
  const tied = (phrase: Token[], at: number) => phrase.every((token, n) => list[at + n] === token);
  if (list.length === 0 || tie(list[0], true) || tie(list.at(-1), false) || TIE_PHRASES.some((phrase) => tied(phrase, 0) || tied(phrase, list.length - phrase.length))) return undefined;
  const taken = new Set<number>();
  for (const phrase of TIE_PHRASES) for (let at = 0; at + phrase.length <= list.length; at++) if (tied(phrase, at)) for (let n = 0; n < phrase.length; n++) taken.add(at + n);
  const words = list.filter((token, at) => !taken.has(at) && !(typeof token === 'string' && TIES.has(token)));
  return words.length > 0 ? words : undefined;
}

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

/** As `same`, for a word of a label: another form of the word, or a number written in words or in digits, stands for it. */
function like(text: Tokens, at: number, asked: Token): boolean {
  const written = text.list[at]!;
  if (typeof asked === 'string') {
    if (typeof written === 'string') return written === asked || formOf(written) === formOf(asked);
    const value = NUMBER_WORDS.get(asked);
    return value !== undefined && written.readings.includes(value);
  }
  return typeof written === 'string' ? NUMBER_WORDS.get(written) === asked.value : states(text, at, asked);
}

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

// ---- units

/** One whole unit of a text: a sentence, a list line, a table cell, or a line that stands by itself, as a heading or a label does. */
interface Unit {
  from: number;
  to: number;
  /** Units an empty line apart are not beside each other. */
  paragraph: number;
  /** The heading, or the label line ending in a colon, that the unit sits under, by index, or -1. */
  under: number;
  /** A cell's row, the row of its table's heads and its column, or -1. */
  row: number;
  head: number;
  column: number;
}

/** Words whose period is part of the word. After most of them a full stop ends a sentence only before a capital that opens no other one. */
const ABBREVIATIONS = new Set('dr mr mrs ms mx prof sr jr st mt ft vs approx est fig vol inc ltd corp dept ca cf pp acc incl excl esp etc eg ie'.split(' '));
/** Those that always stand before what they name, so that their period never ends a sentence: "Dr. Smith", "e.g. Paris". */
const BEFORE_A_NAME = new Set('dr mr mrs ms mx prof st mt vs approx fig vol ca cf pp eg ie'.split(' '));
const CLOSERS = /["'”’»」』)\]]/u;
/**
 * What opens a line of a list and is no part of its unit: a bullet, a number, a check box, a step's number in words ("第一步，",
 * "Step 2:"), the "Q:" and "A:" of a question and its answer, or the ">" of a quoted line. A ">" before a number is "more than".
 */
const ITEM_LINE = new RegExp(
  `^\\s*(?:(?:[-*•]\\s+|\\d+[.)]\\s+)(?:(?:${MARK})\\s*)?|(?:${MARK})\\s*|第[一二三四五六七八九十\\d]+步[，,:、.]?\\s*|[Ss]tep\\s*\\d+[:.)]\\s*|(?:[QqAa]|问|答)\\s*:\\s*|>\\s+(?=\\D))`,
  'u',
);
const HEADING_LINE = /^\s*#{1,6}\s+/;
const ROW_DIVIDER = /^[\s|:\-–—+]*$/;
/** A line that ends in one of these goes on, or ends a sentence: no heading. */
const LINE_END = /[.!?。;,:、\-–—]["'”’»」』)\]]*\s*$/u;

/** Where a period at `at` ends a sentence: before white space or the end, and after an abbreviation only before a capital that opens no other one. */
function endsAtPeriod(text: string, at: number, to: number): boolean {
  if (at + 1 < to && !/\s/.test(text[at + 1]!) && !CLOSERS.test(text[at + 1]!)) return false;
  const before = /([\p{L}.]+)$/u.exec(text.slice(Math.max(0, at - 12), at))?.[1] ?? '';
  const word = before.replaceAll('.', '').toLowerCase();
  // After a number and its unit or ordinal, a sentence ends before a capital, a digit or a CJK character: "330 m. Weight", "the 1st. The
  // deposit", and not "6 ft. tall".
  if (/\d\s?\p{L}{1,3}$/u.test(text.slice(Math.max(0, at - 6), at))) return at + 1 >= to || new RegExp(`^\\s+(?:[\\p{Lu}\\d]|${SPACELESS})`, 'u').test(text.slice(at + 1, to));
  const abbreviation = word !== '' && (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word) || /^(?:\p{L}\.)+\p{L}$/u.test(before));
  if (!abbreviation) return true;
  if (BEFORE_A_NAME.has(word)) return false;
  const next = /^\s+(\p{Lu}\p{L}*)(\.?)/u.exec(text.slice(at + 1, to));
  return next !== null && !(next[2] === '.' && (ABBREVIATIONS.has(next[1]!.toLowerCase()) || next[1]!.length === 1));
}

/** The sentences of a stretch of prose, as offsets into the text. */
function sentences(text: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let start = from;
  const marks = /[.!?。]/g;
  for (let at = from; at < to; at++) {
    marks.lastIndex = at;
    const found = marks.exec(text);
    if (!found || found.index >= to) break;
    at = found.index;
    const char = text[at]!;
    const next = text[at + 1];
    const ends =
      char === '。' ||
      ((char === '!' || char === '?') && (at + 1 >= to || /\s/.test(next!) || CLOSERS.test(next!) || SPACELESS_CHAR.test(next!))) ||
      (char === '.' && endsAtPeriod(text, at, to));
    if (!ends) continue;
    let end = at + 1;
    while (end < to && CLOSERS.test(text[end]!)) end++;
    out.push([start, end]);
    start = at = end;
    at--;
  }
  out.push([start, to]);
  return out;
}

/** The first words of a line and its last, read off its two ends alone: a line may be a long stretch of prose. */
const firstWords = (line: string) => tokenize(line.slice(0, 24)).list;
const lastWord = (line: string) => tokenize(line.slice(-16)).list.at(-1);
const opensWith = (list: Token[], phrase: Token[]) => phrase.length > 0 && phrase.every((token, n) => list[n] === token);

/** Ties that may also end a sentence in a script written without spaces, as 的 and 了 do: "是我想做的", "我们到了". */
const ENDS_SENTENCE = new Set(['的', '了']);

/**
 * A line with no end punctuation ends its unit at the line break, as "Store below 25°C" does, unless what it holds goes on into the
 * next line: it opens with a condition or ends with a word that ties, or the next line opens as no sentence does, in lower case or
 * with a word that joins it to what came before. Splitting a sentence in two would make each half a whole unit; joining two lines
 * only makes a bigger one.
 */
function endsAtLine(run: string, next: string): boolean {
  if (LINE_END.test(run.slice(-8)) || /^\p{Ll}/u.test(next)) return false;
  const [opening, following, last] = [firstWords(run), firstWords(next), lastWord(run)];
  if (GOES_ON.some((words) => opensWith(following, words)) || CONDITIONS.some((condition) => opensWith(opening, condition))) return false;
  return !(typeof last === 'string' && TIES.has(last) && !ENDS_SENTENCE.has(last));
}

/** A line that is a unit by itself is a heading when it is short: at most six words, or twelve characters in a script written without spaces. */
function short(line: string): boolean {
  if (line.length > 80) return false;
  const size = HAS_SPACELESS.test(line) ? [...line].filter((char) => WORD_CHAR.test(char)).length : tokenize(line).list.length;
  return size > 0 && size <= (HAS_SPACELESS.test(line) ? 12 : 6);
}

/** The whole units of a text, in order. */
function unitsOf(text: string): Unit[] {
  const units: Unit[] = [];
  let paragraph = 0;
  let under = -1;
  let row = 0;
  let head = -1;
  let prose: [number, number] | undefined;
  const add = (from: number, to: number, cell?: { column: number }) => {
    while (from < to && /\s/.test(text[from]!)) from++;
    while (to > from && /\s/.test(text[to - 1]!)) to--;
    if (to <= from) return -1;
    units.push({ from, to, paragraph, under, row: cell ? row : -1, head: cell ? head : -1, column: cell?.column ?? -1 });
    return units.length - 1;
  };
  const flush = () => {
    if (prose) for (const [from, to] of sentences(text, ...prose)) add(from, to);
    prose = undefined;
  };
  const lines = text.split('\n');
  let from = 0;
  for (const [n, line] of lines.entries()) {
    const to = from + line.length;
    const trimmed = line.trim();
    // A tab parts cells where the line beside it holds one too, as a pasted table's rows do. In a line of prose it is white space.
    const tabbed = (other: string | undefined) => other !== undefined && other.trim().includes('\t');
    const rowLine = trimmed.includes('|') || (trimmed.includes('\t') && (tabbed(lines[n - 1]) || tabbed(lines[n + 1])));
    if (!rowLine) head = -1;
    if (trimmed === '') {
      flush();
      paragraph++;
    } else if (rowLine) {
      flush();
      if (!ROW_DIVIDER.test(trimmed)) {
        if (head < 0) head = row;
        const inner = line.replace(/^\s*\|/, (fence) => ' '.repeat(fence.length)).replace(/\|\s*$/, (fence) => ' '.repeat(fence.length));
        let start = from;
        let column = 0;
        for (let at = 0; at <= inner.length; at++) {
          if (at < inner.length && inner[at] !== '|' && inner[at] !== '\t') continue;
          add(start, from + at, { column: column++ });
          start = from + at + 1;
        }
        row++;
      }
    } else if (ITEM_LINE.test(line)) {
      flush();
      add(from + ITEM_LINE.exec(line)![0].length, to);
    } else if (HEADING_LINE.test(line)) {
      flush();
      const at = add(from + HEADING_LINE.exec(line)![0].length, to);
      if (at >= 0) under = at;
    } else if (/:$/.test(trimmed)) {
      // A line that ends in a colon labels the lines after it, and its last sentence is the label.
      prose = prose ? [prose[0], to] : [from, to];
      flush();
      under = units.length - 1;
    } else {
      const alone = !prose;
      prose = prose ? [prose[0], to] : [from, to];
      const next = lines[n + 1]?.trim();
      if (next !== undefined && (next === '' ? !LINE_END.test(trimmed) : endsAtLine(text.slice(...prose), next))) {
        flush();
        if (alone && short(trimmed) && endsAtLine(trimmed, '')) under = units.length - 1;
      }
    }
    from = to + 1;
  }
  flush();
  return units;
}

/** One written form for comparing passages: straight quotes, one space for any run of white space, one case. */
const fold = (text: string): string => uniform(text).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
const OPEN_QUOTES = /^["'«「『]+/u;
const CLOSE_QUOTES = /["'»」』]+$/u;
/** A passage without the marks around it that change nothing it says: quotation marks, and a closing full stop, comma or semicolon. */
const bare = (folded: string): string =>
  folded.replace(OPEN_QUOTES, '').replace(CLOSE_QUOTES, '').trim().replace(/[.。,;、]$/u, '').replace(CLOSE_QUOTES, '').trim();
/** A mark that may open a unit and that `bare` takes off, and one that may open a quotation. */
const OPEN_MARK = /["'‘“«「『]/u;
const QUOTE_MARK = /["“”«「『]/u;
/** Each quotation inside a sentence: the words between an opening mark and its closing one, and where they start and end. */
const QUOTATION = /"([^"]+)"|「([^」]+)」|『([^』]+)』|«([^»]+)»/gu;

class Source implements Grounding {
  private readonly text: string;
  /** Where the words end and the held values begin. */
  private readonly mark: number;
  private read: Reader | undefined;
  private numbers: Set<number> | undefined;
  private hexes: Set<string> | undefined;
  private lines: ReturnType<typeof marked> | undefined;
  private split: { units: Unit[]; folded: (string | undefined)[]; bared: (string | undefined)[]; unitOf: Int32Array; first: Int32Array; last: Int32Array; turns: Int8Array } | undefined;
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
   * The units of the words, each folded and bare once asked for; the unit each token stands in, or -1; the first token of each unit and
   * the one past its last; and which units hold a reversing word, or -1 before that is read.
   */
  private get units() {
    if (this.split) return this.split;
    const units = unitsOf(this.text.slice(0, this.mark));
    const { starts, marked } = this.tokens;
    const unitOf = new Int32Array(marked).fill(-1);
    const [first, last] = [new Int32Array(units.length), new Int32Array(units.length)];
    for (let at = 0, unit = 0; at < marked; at++) {
      while (unit < units.length && units[unit]!.to <= starts[at]!) unit++;
      if (unit >= units.length || units[unit]!.from > starts[at]!) continue;
      if (last[unit] === 0) first[unit] = at;
      last[unit] = at + 1;
      unitOf[at] = unit;
    }
    return (this.split = { units, folded: [], bared: [], unitOf, first, last, turns: new Int8Array(units.length).fill(-1) });
  }

  private folded(unit: number): string {
    const { folded, units } = this.units;
    return (folded[unit] ??= fold(this.text.slice(units[unit]!.from, units[unit]!.to)));
  }

  private bared(unit: number): string {
    return (this.units.bared[unit] ??= bare(this.folded(unit)));
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
    const asked = this.claim(claim);
    if (asked.list.length > 0) return this.holds(asked, SHORT);
    const symbols = uniform(claim).trim();
    return symbols.length > 0 && this.standsAlone(symbols);
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
    const words = labelOf(label);
    if (!words) return false;
    const written = this.tokens;
    const named = (start: number) => {
      const scope = this.scope(start);
      return words.every((word) => scope.some(([from, to]) => {
        for (let at = from; at < to; at++) if (like(written, at, word)) return true;
        return false;
      }));
    };
    if (typeof value === 'string') {
      const asked = this.claim(value);
      return asked.list.length > 0 && this.holds(asked, SHORT, named);
    }
    if (!Number.isFinite(value)) return false;
    const scaled = this.scaled(value, unit);
    if (scaled.length > 0) return scaled.some((asked) => this.holds(asked, SHORT, named));
    for (let at = 0; at < written.marked; at++) {
      const token = written.list[at]!;
      if (typeof token === 'object' && token.readings.includes(value) && named(at)) return true;
    }
    return false;
  }

  passage(passage: string): Passage {
    const run = this.run(passage);
    if (run) return this.turned(...run) ? 'turned' : 'whole';
    return this.held(passage);
  }

  leads(passage: string): Passage {
    const asked = fold(passage).replace(OPEN_QUOTES, '');
    if (asked === '') return 'unstated';
    const { units } = this.units;
    for (let first = 0; first < units.length; first++) {
      const opening = fold(this.text.slice(units[first]!.from, Math.min(this.mark, units[first]!.from + passage.length * 2 + 8))).replace(OPEN_QUOTES, '');
      if (!opening.startsWith(asked)) continue;
      let last = first;
      while (last + 1 < units.length && fold(this.text.slice(units[first]!.from, units[last]!.to)).length < asked.length) last++;
      return this.turned(first, last) ? 'turned' : 'whole';
    }
    return this.held(passage);
  }

  said(passage: string): Passage {
    const run = this.run(passage);
    if (run) return this.turned(...run) ? 'turned' : 'whole';
    const asked = bare(fold(passage));
    const { units } = this.units;
    for (let at = 0; at < units.length; at++) {
      if (!QUOTE_MARK.test(this.text.slice(units[at]!.from, units[at]!.to))) continue;
      const sentence = this.folded(at);
      for (const quotation of sentence.matchAll(QUOTATION)) {
        if (bare(quotation.slice(1).find(Boolean) ?? '') !== asked) continue;
        // The rest of the sentence only says who said it: before the quotation with nothing after it, or after it in four words at
        // most, as "she said" and "said my grandmother" do. 'He said "the plan works" was a lie.' says more. The rest may turn the
        // quotation around too: "He said, though it is a myth, …".
        const [before, after] = [tokenize(sentence.slice(0, quotation.index)), tokenize(sentence.slice(quotation.index! + quotation[0].length))];
        const speaks = (words: Tokens) => SPEECH.some((speech) => this.within(words, 0, words.list.length, speech));
        if (!((after.list.length === 0 && speaks(before)) || (before.list.length === 0 && after.list.length <= 4 && speaks(after)))) continue;
        return this.turned(at, at) || this.turnsIn(before) || this.turnsIn(after) ? 'turned' : 'whole';
      }
    }
    return this.held(passage);
  }

  defines(term: string, meaning: string): Passage | 'apart' {
    const run = this.run(meaning);
    if (!run) return this.held(meaning);
    const named = this.claim(term);
    const { units } = this.units;
    const opening = tokenize(this.text.slice(units[run[0]]!.from, units[run[0]]!.to));
    const opens = named.list.length > 0 && OPENERS.some((opener) => opener.every((token, n) => opening.list[n] === token) && named.list.every((token, n) => same(opening, opener.length + n, token)));
    if (!opens) return 'apart';
    return this.turned(...run) ? 'turned' : 'whole';
  }

  begins(passage: string): boolean {
    const asked = this.claim(passage);
    return asked.list.length > 0 && same(this.tokens, 0, asked.list[0]!) && runs(this.tokens, 0, asked, 0);
  }

  converses(): boolean {
    const speakers = new Map<string, number>();
    for (const line of this.text.slice(0, this.mark).split('\n')) {
      const speaker = SPEAKER.exec(line)?.[1]?.toLowerCase();
      if (speaker && !MARKERS.includes(speaker)) speakers.set(speaker, (speakers.get(speaker) ?? 0) + 1);
    }
    const lines = [...speakers.values()];
    return lines.length >= 2 && lines.reduce((sum, n) => sum + n, 0) >= 3 && lines.some((n) => n >= 2);
  }

  /** The first and last of the whole units, one after another, whose text is the passage, once folded and bare. */
  private run(passage: string): [number, number] | undefined {
    const asked = bare(fold(passage));
    if (asked === '') return undefined;
    const { units } = this.units;
    for (let first = 0; first < units.length; first++) {
      // A unit that opens with another letter opens no run of this passage, and is never folded for it.
      const head = this.text[units[first]!.from]!;
      if (!OPEN_MARK.test(head) && head.toLowerCase() !== asked[0]) continue;
      const opening = this.bared(first);
      if (opening === '' || !asked.startsWith(opening.slice(0, 12))) continue;
      for (let last = first; last < units.length; last++) {
        const span = last === first ? opening : bare(fold(this.text.slice(units[first]!.from, units[last]!.to)));
        if (span === asked) return [first, last];
        if (span.length > asked.length) break;
      }
    }
    return undefined;
  }

  /** The unit before the run or after it in the same paragraph, or the heading or label it sits under, holds a reversing word. */
  private turned(first: number, last: number): boolean {
    const { units } = this.units;
    const beside = [first - 1, last + 1].filter((at) => at >= 0 && at < units.length && units[at]!.paragraph === units[first]!.paragraph);
    return [...beside, units[first]!.under].some((at) => at >= 0 && this.reverses(at));
  }

  /** The unit holds a word of `REVERSING`. */
  private reverses(unit: number): boolean {
    const { turns, first, last } = this.units;
    if (turns[unit]! < 0) turns[unit] = this.turnsIn(this.tokens, first[unit]!, last[unit]!) ? 1 : 0;
    return turns[unit] === 1;
  }

  /** A word of `REVERSING` stands among the tokens from `from` up to `to`. */
  private turnsIn(text: Tokens, from = 0, to = text.list.length): boolean {
    for (let at = from; at < to; at++) {
      const token = text.list[at];
      if (typeof token !== 'string') continue;
      for (const words of TURNS_BY_FIRST.get(formOf(token)) ?? []) if (this.within(text, at, Math.min(to, at + words.length), words)) return true;
    }
    return false;
  }


  /** These words stand, one after another, among the tokens from `from` up to `to`. A Latin word stands in its other forms too. */
  private within(text: Tokens, from: number, to: number, words: Token[]): boolean {
    for (let at = from; at + words.length <= to; at++) {
      if (words.every((word, n) => typeof word === 'string' && typeof text.list[at + n] === 'string' && (text.list[at + n] === word || formOf(text.list[at + n] as string) === formOf(word)))) return true;
    }
    return false;
  }

  /** What a passage that is no run of whole units is: words the text holds, or not. */
  private held(passage: string): Passage {
    const asked = this.claim(passage);
    return asked.list.length > 0 && this.holds(asked, 0, () => true) ? 'cut' : 'unstated';
  }

  /** The tokens a label may be read from, as runs: those of the value's unit, and for a table cell those of its row and of the head of its column. */
  private scope(at: number): [number, number][] {
    const { units, unitOf, first, last } = this.units;
    const unit = units[unitOf[at]!];
    if (!unit) return [[at, at + 1]];
    if (unit.row < 0) return [[first[unitOf[at]!]!, last[unitOf[at]!]!]];
    return units.flatMap((other, n) => (other.row === unit.row || (other.row === unit.head && other.column === unit.column) ? [[first[n]!, last[n]!] as [number, number]] : []));
  }

  /** The values a text may write for this number in a unit that scales it, each as a claim. None when the unit does not scale it. */
  private scaled(value: number, unit: string | undefined): Tokens[] {
    return unit === undefined ? [] : this.against(value, unit).filter(({ list: [first] }) => typeof first === 'object' && !Number.isNaN(first.value) && first.value !== value);
  }

  /**
   * The asked tokens are a run of the text's tokens that crosses none of the barred breaks. With `where`, the run is one that
   * stands among the words, before any held value, at a start that `where` accepts.
   */
  private holds(asked: Tokens, barred: number, where?: (start: number) => boolean): boolean {
    const written = this.tokens;
    const { list } = written;
    const first = asked.list[0]!;
    const until = (where ? written.marked : list.length) - asked.list.length + 1;
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
 * together, which `names`, `passage`, `said`, `leads` and `defines` are, is read against the words alone.
 */
export const grounding = (source: string, held: readonly string[] = []): Grounding => new Source(source, held);
