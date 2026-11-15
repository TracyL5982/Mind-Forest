/**
 * A source text, asked whether it states a value, and whether a card's words are the whole of it. Built once per text.
 *
 * A value, such as a number, a date, a name or a label of an arrangement, is stated when its tokens are a run of whole tokens of the text.
 * Case, spacing, quote marks and other punctuation between tokens do not count. A token is a word, a number, or one character of a
 * script written without spaces. A number is one token with its sign and its magnitude: "-3%", "负3%", "(£1.3m)" and "800 thousand"
 * are each one number, and "3%", "£1.3m" and "800" are other numbers. An arrangement sets such values beside its members, so a gain
 * read off a loss would stand beside them: a comparison cell "3%" of "Margin: -3%" is refused for that.
 *
 * A card that shows the item's own words in a structure shows the whole item, in its order, with every mark it writes. Its structure
 * changes how the item is laid out, and never what of it is shown: no part of an item can be shown apart from the rest, because what
 * gives a part its meaning may stand anywhere in it, a heading over it, a sentence after it, a cross before it, or the row it sits in.
 * The card may draw the item's headings, labels and opening prose over its structure, as the item does.
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
  /**
   * How a card's words read as the whole item: the first of the ways whose pieces, one after another and in the item's order, are every
   * word and mark of its text after the lines the card draws above them. `above` are those lines when the card carries them already.
   */
  shows(ways: readonly Way[], above?: readonly string[]): Shown | undefined;
  /** How many characters of the item's text stand up to the end of these words, when they are whole sentences, lines or cells of it. */
  units(words: string): number | undefined;
}

/**
 * One piece of what a card shows. An entry, such as a step or a list line, begins and ends where a sentence, a line or a cell of the
 * item does; a loose piece, such as a figure's label, need not. A slot is one heading or label of the item: any heading or label, or
 * only a label that opens a line, and with `says` only one that says those words. `for` is the prop a piece stands for when the piece
 * adds the mark the card draws in its place, as "Q: " does to a question.
 */
export type Piece = { text: string; entry: boolean; for?: string } | { slot: 'heading' | 'label'; says?: string };

/**
 * One way a card's pieces may read. `drops` are the props this reading leaves out, as a speaker the item does not write where the
 * card would show it. `headless` lets the card stand on a table of two columns without its heads row, which it then draws over itself.
 */
export interface Way {
  pieces: readonly Piece[];
  drops?: readonly string[];
  headless?: boolean;
}

/** The whole item, as a card's way reads it. */
export interface Shown {
  /** Which of the ways it is. */
  way: number;
  /** The item's headings, labels and opening prose that stand over the card's pieces, each as its line writes it. */
  above: string[];
  /** The heads row of the table of two columns the card stands on, when the way is headless and the card leaves it out. */
  heads?: [string, string];
  /** What each slot stands on, as the item writes it. */
  slots: string[];
  /** The check box on the line where each text piece starts: ticked, empty, or none. */
  boxes: (boolean | undefined)[];
  /** Each text piece as the item writes it, which a card draws in place of the words it was given. */
  texts: string[];
  /**
   * What each text piece stands on: lines of a list (`item`), cells of a table (`cell`), or anything else (`prose`), which may say what
   * the lines before it mean. A card that counts the pieces it leaves out reads this, so no unshown piece can turn the shown ones.
   */
  kinds: ('item' | 'cell' | 'prose')[];
  /** How many cells stand in each row of the item, when the card's pieces are a table and nothing else. */
  rows?: number[];
}

/** The most lines a card draws over its structure, and the most characters of opening prose among them. */
export const ABOVE = { lines: 6, lead: { spaced: 280, spaceless: 140 } } as const;

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
const WORD_CHAR = /^[\p{L}\p{M}\p{N}]$/u;
const SPACED_BEFORE = new RegExp(`(?:(?!${SPACELESS})[\\p{L}\\p{N}])$`, 'u');
const SPACED_AFTER = new RegExp(`^(?:(?!${SPACELESS})[\\p{L}\\p{N}])`, 'u');
const HEX = /(?<![\p{L}\p{N}#])#[0-9a-f]+(?![\p{L}\p{N}])/giu;

const MARK = String.raw`\[[ xX✓✔]?\]|[☑☐✓✔✅✗✘☒❌]`;
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

// ---- the whole item

const CJK = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]/u;
const CJK_ALL = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]/gu;

/** The text in the form its marks are compared in: one dash, one apostrophe, one double quote. */
const plain = (text: string): string =>
  text.normalize('NFKC').replace(UNSEEN, '').replace(/[‘’`´]/g, "'").replace(/[“”«»「」『』]/g, '"').replace(/[‐‑‒–—―−]/g, '-');

const MARKS = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?::\d+)+|\d+(?:\.\d+)?)|([\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*)|((?!=)\p{S}|[%‰()[\]?"'])|(-(?=\d))/gu;
/** A quotation mark, which a piece may stand inside or outside of: only one inside it must be as the item writes it. */
const QUOTE = new Set(['"', "'"]);
/** The word that joins the last figure of a series to the one before it, which a card of figures lays out as a list. */
const JOINS = new Set(['and', '和', '与', '及']);

/**
 * Every word, number and mark that may carry meaning, in order: signs, brackets, arrows, ticks, crosses, a percent sign, a question
 * mark and quotation marks are kept, and the rest of the punctuation is not, nor "=" between a label and its value, which says what a colon does. A character of a script written without spaces is a word of
 * its own. Quotation marks around a piece are its card's to draw; those inside it, as in a "safe" dose, are its words'.
 */
function marksOf(text: string): string[] {
  return marksAt(text).map((mark) => mark.word);
}

/**
 * The marks of a text with where each stands in it as written, so a card can draw the item's own characters for words it matched in
 * their plain form. Each character is brought to its plain form alone, which keeps every plain character's place in the text.
 */
function marksAt(text: string): { word: string; from: number; to: number }[] {
  let flat = '';
  const at: number[] = [];
  for (let index = 0; index < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(index)!);
    const made = plain(char).toLowerCase();
    for (let n = 0; n < made.length; n++) at.push(index);
    flat += made;
    index += char.length;
  }
  at.push(text.length);
  const out: { word: string; from: number; to: number }[] = [];
  const push = (word: string, from: number, size: number) => out.push({ word, from: at[from]!, to: at[from + size - 1]! + (text.codePointAt(at[from + size - 1]!)! > 0xffff ? 2 : 1) });
  for (const m of flat.matchAll(MARKS)) {
    const index = m.index!;
    if (m[1]) push(/^\d{1,3}(?:,\d{3})+/.test(m[1]) ? m[1].replaceAll(',', '') : m[1], index, m[1].length);
    else if (m[2] && !CJK.test(m[2])) push(m[2], index, m[2].length);
    else if (m[2]) {
      let run = '';
      let from = index;
      let offset = index;
      for (const char of m[2]) {
        if (!CJK.test(char)) {
          if (!run) from = offset;
          run += char;
        } else {
          if (run) push(run, from, run.length);
          run = '';
          push(char, offset, char.length);
        }
        offset += char.length;
      }
      if (run) push(run, from, run.length);
    } else push(m[0], index, m[0].length);
  }
  return out;
}

const alike = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((word, n) => word === b[n]);

const RUNS = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;
/** How many words or characters a line says: characters in a script written without spaces, words otherwise. */
const sizeOf = (text: string): number => (CJK.test(text) ? (text.match(CJK_ALL)?.length ?? 0) + (text.replace(CJK_ALL, ' ').match(RUNS)?.length ?? 0) : (text.match(RUNS)?.length ?? 0));

/** A line a heading may be: six words at most, or twelve characters in a script written without spaces. */
const short = (text: string): boolean => text.length <= 80 && sizeOf(text) > 0 && sizeOf(text) <= (CJK.test(text) ? 12 : 6);
/** A label before a colon may run longer, as it is always shown over what it labels. */
const labelled = (text: string): boolean => text.length <= 80 && sizeOf(text) > 0 && sizeOf(text) <= (CJK.test(text) ? 20 : 12) && !/[.!?。]/.test(text) && !/\d$/.test(text);

/** A line that ends a sentence or goes on. */
const ENDED = /[.!?。;,:、！？；，：-]["')\]」』”’]*\s*$/u;
/**
 * A bullet, a number, a check box or a step's number, which a list or a steps card draws itself. A ">" or a speaker's "A:" is no layout.
 * A number is an entry's only when white space follows its stop, so "4.2%" and "1.5 cups" are the line's own words.
 */
const LAYOUT = /^\s*(?:(?:[-*•·]\s+|\d+(?:[.)](?=\s)|、)\s*|\(\d+\)\s*)(?:\[[ xX✓✔]?\]\s*|[☐☑]\s*)?|\[[ xX✓✔]?\]\s*|[☐☑]\s*|第[一二三四五六七八九十\d]+步[,，:：、.]?\s*|step\s*\d+[:.)]\s*)/iu;
/** A tick or a cross that opens a line, which is a word of the line and never a check box. */
const TICKED = /^\s*[✓✔✅✗✘❌☒]/u;
const ASKS = /^\s*(q|问)\s*[:：]/iu;
const ANSWERS = /^\s*(a|答)\s*[:：]/iu;
const SPEAKS = /^\s*([^\s:：]{1,12})\s*[:：]/u;

type LineKind = 'blank' | 'divider' | 'row' | 'heading' | 'item' | 'prose';

/** One line of the item. */
interface Line {
  n: number;
  kind: LineKind;
  /** A title line is the item's title, which every card draws. */
  title?: boolean;
  /** What the line says without its bullet, number or check box. A tick, a cross and a speaker's mark are kept. */
  text: string;
  cells?: string[];
  box?: boolean;
  /** A label that opens the line, "Myth:", and where the rest of the line starts. */
  label?: { text: string; rest: number };
}

/** A conversation: three lines or more open with a name and a colon, of two people at least, one of whom speaks twice. Its speakers label nothing. */
function converses(lines: readonly string[]): boolean {
  const speakers = new Map<string, number>();
  for (const line of lines) {
    const speaker = SPEAKS.exec(line)?.[1]?.toLowerCase();
    if (speaker) speakers.set(speaker, (speakers.get(speaker) ?? 0) + 1);
  }
  const counts = [...speakers.values()];
  return counts.length >= 2 && counts.reduce((sum, n) => sum + n, 0) >= 3 && counts.some((n) => n >= 2);
}

/** The sentences of a line, as character ranges: one ends at ".", "!", "?" or "。" before white space, a CJK character or the end. */
const STOPS = /[.!?。！？]/g;
const CLOSING = new Set([...'.!?。！？"\')]」』”’']);
/** A stop that ends a sentence wherever it stands, as a script written without spaces sets it. */
const FULL_STOP = new Set([...'。！？']);

function sentences(text: string): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  STOPS.lastIndex = 0;
  for (let found = STOPS.exec(text); found; found = STOPS.exec(text)) {
    const at = found.index;
    let end = at + 1;
    while (end < text.length && CLOSING.has(text[end]!)) end++;
    const next = text[end];
    if (text[at] === '.' && /\d/.test(text[at - 1] ?? '') && /\d/.test(next ?? '')) continue;
    if (next === undefined || /\s/.test(next) || CJK.test(next) || FULL_STOP.has(text[at]!)) {
      out.push([start, end]);
      start = end;
      STOPS.lastIndex = end;
    }
  }
  if (text.slice(start).trim()) out.push([start, text.length]);
  return out;
}

/** The item's lines as it writes them, which a card draws over itself as they are. Words and marks are compared in their plain form. */
function linesOf(source: string, title: string): Line[] {
  const raws = source.split('\n');
  const lines: Line[] = raws.map((raw, n) => ({ n, kind: 'prose', text: raw.trim() }));
  const tabbed = (n: number) => raws[n]?.includes('\t') ?? false;
  // Comma-separated rows: three lines or more in a row with the same count of commas and no space after any. A full-width comma of
  // Chinese prose is no column, so the commas are counted as written, before they are made one form.
  const commas = raws.map((raw) => (/,\s/.test(raw) || !raw.includes(',') ? -1 : raw.split(',').length));
  const csv = (n: number) => commas[n]! > 1 && [n - 2, n - 1, n].some((from) => [from, from + 1, from + 2].every((at) => commas[at] === commas[n]));
  for (const line of lines) {
    const t = line.text;
    if (t === '') line.kind = 'blank';
    else if ((t.includes('|') || (t.includes('\t') && (tabbed(line.n - 1) || tabbed(line.n + 1)))) && !t.startsWith('#')) {
      if (/^[\s|:+-]*$/.test(t)) line.kind = 'divider';
      else {
        line.kind = 'row';
        // A tab that opens a pasted row is its first cell, left empty, so only spaces are taken off its ends.
        const row = t.includes('|') ? t : raws[line.n]!.replace(/^ +| +$/g, '');
        const inner = /^\|.*\|$/s.test(row) ? row.slice(1, -1) : row;
        line.cells = inner.split(t.includes('|') ? '|' : '\t').map((cell) => cell.trim());
      }
    } else if (csv(line.n)) Object.assign(line, { kind: 'row', cells: t.split(',').map((cell) => cell.trim()) });
    else if (/^#{1,6}\s+/.test(t)) Object.assign(line, { kind: 'heading', text: t.replace(/^#{1,6}\s+/, '') });
    else if (/^(\*\*|__)[^*_]+(\*\*|__)[:：]?$/.test(t) && short(t)) line.kind = 'heading';
    else if (ASKS.test(t)) line.kind = 'heading';
    else if (ANSWERS.test(t)) line.kind = 'item';
    else if (LAYOUT.test(t) && t.replace(LAYOUT, '').trim() && t.replace(LAYOUT, '') !== t) {
      const marker = LAYOUT.exec(t)![0];
      line.kind = 'item';
      line.text = t.slice(marker.length).trim();
      if (/\[[xX✓✔]\]|☑/.test(marker)) line.box = true;
      else if (/\[ ?\]|☐/.test(marker)) line.box = false;
    } else if (TICKED.test(t)) line.kind = 'item';
    else if (/[:：]$/.test(t)) line.kind = 'heading';
  }
  const first = lines.find((line) => line.kind !== 'blank');
  const more = first !== undefined && lines.some((line) => line.n > first.n && line.kind !== 'blank');
  if (first && more && first.kind !== 'row' && title.trim() && alike(marksOf(first.text), marksOf(title))) Object.assign(first, { kind: 'heading', title: true });
  else if (first?.kind === 'prose' && title.trim()) {
    // A first sentence that is the title, as in "Hallway plan for the autumn. Take the old shelf out…", is drawn as the title.
    const [opening, ...rest] = sentences(first.text);
    if (opening && rest.length > 0 && alike(marksOf(first.text.slice(...opening)), marksOf(title))) first.text = first.text.slice(rest[0]![0]).trim();
  }
  // Short lines with no end punctuation are headings, each of a run of them, unless they stand under a heading, end the item, or are all figures.
  const bare = (line: Line) => line.kind === 'prose' && !ENDED.test(line.text) && !/[:：]./u.test(line.text) && short(line.text);
  for (let at = 0; at < lines.length; ) {
    if (!bare(lines[at]!)) {
      at++;
      continue;
    }
    let to = at;
    while (to + 1 < lines.length && bare(lines[to + 1]!)) to++;
    const run = lines.slice(at, to + 1);
    const before = lines.slice(0, at).reverse().find((line) => line.kind !== 'blank');
    const after = lines.slice(to + 1).some((line) => line.kind !== 'blank');
    const figures = run.length >= 2 && run.every((line) => /\d/.test(line.text));
    if (before?.kind !== 'heading' && after && !figures) for (const line of run) line.kind = 'heading';
    at = to + 1;
  }
  // A line that asks a question and has its answer after it heads that answer.
  for (const [n, line] of lines.entries()) {
    if (line.kind !== 'prose' || !/[?？]["')\]」』”’]*$/u.test(line.text)) continue;
    const next = lines.slice(n + 1).find((other) => other.kind !== 'blank');
    if (next && next.kind !== 'heading') line.kind = 'heading';
  }
  if (!converses(raws)) {
    for (const line of lines) {
      if (line.kind !== 'prose' && line.kind !== 'item') continue;
      const m = /^([^:：]{1,80})[:：]\s*(?=\S)/u.exec(line.text);
      if (m && labelled(m[1]!.trim())) line.label = { text: m[0].trim(), rest: m[0].length };
    }
  }
  return lines;
}

/**
 * One whole unit of the item: a heading, a label that opens a line, a sentence of prose or of a list line, or a table cell. The title
 * line is a heading every card draws as the title: a card may leave it out or stand a piece on it, and never draws it over itself.
 */
interface Unit {
  kind: 'heading' | 'label' | 'prose' | 'item' | 'cell';
  title?: boolean;
  line: number;
  /** As the item writes it. */
  text: string;
  /** Where it stands in its line's text, for drawing it over a card. */
  start: number;
  end: number;
  words: string[];
  /** Where each word stands in `of`. */
  spans: [number, number][];
  /** The text `start`, `end` and `spans` count in: its line's, or its cell's. */
  of: string;
}

class Whole {
  private readonly lines: Line[];
  private readonly parts: Unit[] = [];
  /** How many units at the start may stand over a card, at most. */
  private readonly over: number;

  constructor(source: string, title: string) {
    this.lines = linesOf(source, title);
    const add = (kind: Unit['kind'], line: Line, start: number, end: number) => {
      const slice = line.text.slice(start, end);
      const text = slice.trim();
      const lead = start + slice.length - slice.trimStart().length;
      const marks = marksAt(text);
      if (marks.length > 0) this.parts.push({ kind, line: line.n, text, start: lead, end: lead + text.length, words: marks.map((mark) => mark.word), spans: marks.map((mark) => [lead + mark.from, lead + mark.to]), of: line.text });
    };
    for (const line of this.lines) {
      if (line.kind === 'blank' || line.kind === 'divider') continue;
      if (line.title) {
        add('heading', line, 0, line.text.length);
        this.parts.at(-1)!.title = true;
        continue;
      }
      if (line.kind === 'row') for (const cell of line.cells!) add('cell', { ...line, text: cell }, 0, cell.length);
      else if (line.kind === 'heading') add('heading', line, 0, line.text.length);
      else {
        const from = line.label?.rest ?? 0;
        if (line.label) add('label', line, 0, from);
        for (const [start, end] of sentences(line.text.slice(from))) add(line.kind === 'item' ? 'item' : 'prose', line, from + start, from + end);
      }
    }
    let over = 0;
    let lead = 0;
    while (over < this.parts.length) {
      const unit = this.parts[over]!;
      if (unit.kind === 'prose') lead += unit.text.length;
      if (!['heading', 'label', 'prose'].includes(unit.kind) || lead > (CJK.test(unit.text) ? ABOVE.lead.spaceless : ABOVE.lead.spaced)) break;
      if (new Set(this.parts.slice(0, over + 1).map((u) => u.line)).size > ABOVE.lines) break;
      over++;
    }
    this.over = over;
  }

  /** The lines the first `count` units make, each as its line writes it, without the title, which the card draws as its title. */
  private aboveOf(count: number): string[] {
    const out: string[] = [];
    for (let at = this.parts[0]?.title ? 1 : 0; at < count; ) {
      let to = at;
      while (to + 1 < count && this.parts[to + 1]!.line === this.parts[at]!.line) to++;
      const line = this.lines[this.parts[at]!.line]!;
      out.push(line.text.slice(this.parts[at]!.start, this.parts[to]!.end).trim());
      at = to + 1;
    }
    return out;
  }

  shows(ways: readonly Way[], above?: readonly string[]): Shown | undefined {
    const counts = Array.from({ length: this.over + 1 }, (_v, n) => n);
    const given = above?.map((line) => line.trim());
    for (const count of given ? counts.filter((n) => alike(this.aboveOf(n), given)) : counts) {
      for (const [way, reading] of ways.entries()) {
        const fit = this.fits(this.parts.slice(count), reading);
        if (fit) return { way, above: this.aboveOf(count), ...fit };
      }
    }
    return undefined;
  }

  /** How the way's pieces stand on these units, one after another to the last, or nothing. An empty cell is no unit, and still a cell of its row. */
  private fits(tail: Unit[], way: Way): Omit<Shown, 'way' | 'above'> | undefined {
    const cells = tail.length > 0 && tail.every((unit) => unit.kind === 'cell');
    const rows = cells ? [...new Set(tail.map((unit) => unit.line))].map((line) => this.lines[line]!) : [];
    const tries: { units: Unit[]; heads?: [string, string]; rows: Line[] }[] = [{ units: tail, rows }];
    if (way.headless && rows.length >= 2 && rows.every((row) => row.cells!.length === 2)) {
      const [first, ...rest] = rows;
      tries.unshift({ units: tail.filter((unit) => unit.line !== first!.n), heads: [first!.cells![0]!, first!.cells![1]!], rows: rest });
    }
    for (const { units, heads, rows: left } of tries) {
      const read = this.read(units, way, cells);
      if (read) return { ...read, ...(heads && { heads }), ...(cells && { rows: left.map((row) => row.cells!.length) }) };
    }
    return undefined;
  }

  /**
   * The item's own characters from the word at `from` up to the word before `to`: whole units when the piece is an entry, so its marks and
   * stops come with it, and the words alone otherwise. Lines are joined by a line break.
   */
  private written(units: Unit[], owner: number[], spans: [number, number][], from: number, to: number, entry: boolean, stops: boolean): string {
    const [first, last] = [units[owner[from]!]!, units[owner[to - 1]!]!];
    const start = entry ? first.start : spans[from]![0];
    let end = entry ? last.end : spans[to - 1]![1];
    // A piece given with its full stop keeps the item's own, as a quotation does that ends its sentence.
    while (stops && !entry && end < last.end && /[.!?。！？…;；,，:：]/u.test(last.of[end]!)) end++;
    if (first === last || (first.line === last.line && first.kind !== 'cell')) return first.of.slice(start, end);
    const middle = this.lines.slice(first.line + 1, last.line).map((line) => line.text);
    return [first.of.slice(start), ...middle, last.of.slice(0, end)].join('\n');
  }

  private read(units: Unit[], way: Way, cells: boolean): Pick<Shown, 'slots' | 'boxes' | 'texts' | 'kinds'> | undefined {
    if (units.length === 0) return undefined;
    const words: string[] = [];
    /** The unit each word stands in, where it stands in its line, and the units by the word they start at. */
    const owner: number[] = [];
    const spans: [number, number][] = [];
    const starts = new Map<number, number>();
    for (const [n, unit] of units.entries()) {
      starts.set(words.length, n);
      words.push(...unit.words);
      owner.push(...unit.words.map(() => n));
      spans.push(...unit.spans);
    }
    starts.set(words.length, units.length);
    const slots: string[] = [];
    const boxes: (boolean | undefined)[] = [];
    const texts: string[] = [];
    const kinds: Shown['kinds'] = [];
    const kindOf = (from: number, to: number): Shown['kinds'][number] => {
      const covered = new Set(units.slice(owner[from]!, owner[to - 1]! + 1).map((unit) => unit.kind));
      return covered.size === 1 && covered.has('item') ? 'item' : covered.size === 1 && covered.has('cell') ? 'cell' : 'prose';
    };
    let at = 0;
    for (const piece of way.pieces) {
      if ('slot' in piece) {
        const unit = units[starts.get(at) ?? -1];
        if (!unit || (unit.kind !== 'label' && (piece.slot === 'label' || unit.kind !== 'heading'))) return undefined;
        if (piece.says !== undefined && !alike(unit.words, marksOf(piece.says))) return undefined;
        slots.push(unit.text);
        at += unit.words.length;
        continue;
      }
      const asked = marksOf(piece.text);
      while (QUOTE.has(asked[0]!)) asked.shift();
      while (QUOTE.has(asked.at(-1)!)) asked.pop();
      const aligned = piece.entry || cells;
      // A quotation mark before the piece opens it and one after it closes it: a unit may start or end on either side of them.
      const edge = (from: number, step: 1 | -1): boolean => starts.has(from) || (QUOTE.has(words[step < 0 ? from - 1 : from] ?? '') && edge(from + step, step));
      if (aligned && !edge(at, -1) && !edge(at, 1)) return undefined;
      // An empty cell of a card stands on an empty cell of the item, which holds no words.
      if (asked.length === 0) {
        if (!cells) return undefined;
        boxes.push(undefined);
        texts.push('');
        kinds.push('cell');
        continue;
      }
      while (QUOTE.has(words[at] ?? '') && words[at] !== asked[0]) at++;
      // "and" between the last two figures of a series in one sentence is the series' layout: "rent 45%, food 25% and savings 30%".
      if (!aligned && at > 0 && JOINS.has(words[at] ?? '') && words[at] !== asked[0]) at++;
      if (!alike(words.slice(at, at + asked.length), asked)) return undefined;
      const first = units[owner[at] ?? -1];
      boxes.push(first ? this.lines[first.line]!.box : undefined);
      texts.push(this.written(units, owner, spans, at, at + asked.length, aligned && starts.has(at) && starts.has(at + asked.length), /[.!?。！？…;；,，:：]["'”’」』]*\s*$/u.test(piece.text)));
      kinds.push(kindOf(at, at + asked.length));
      at += asked.length;
      while (QUOTE.has(words[at] ?? '') && !(starts.has(at) && piece.entry)) at++;
      if (aligned && !edge(at, -1) && !edge(at, 1)) return undefined;
    }
    while (QUOTE.has(words[at] ?? '')) at++;
    return at === words.length ? { slots, boxes, texts, kinds } : undefined;
  }

  units(asked: string): number | undefined {
    // Words set apart are found by their words: the note draws them as its item writes them, quotation marks and all.
    const bare = (words: string[]) => words.filter((word) => !QUOTE.has(word));
    const wanted = bare(marksOf(asked));
    if (wanted.length === 0) return undefined;
    let size = 0;
    for (let first = 0; first < this.parts.length; first++) {
      let words: string[] = [];
      let length = size;
      for (let last = first; last < this.parts.length && words.length < wanted.length; last++) {
        words = [...words, ...bare(this.parts[last]!.words)];
        length += this.parts[last]!.text.length + 1;
        if (alike(words, wanted)) return length;
      }
      size += this.parts[first]!.text.length + 1;
    }
    return undefined;
  }
}

class Source implements Grounding {
  private readonly text: string;
  /** Where the words end and the held values begin. */
  private readonly mark: number;
  private read: Reader | undefined;
  private numbers: Set<number> | undefined;
  private hexes: Set<string> | undefined;
  private whole: Whole | undefined;
  /** Each claim read so far. A card asks about the same value more than once. */
  private readonly claims = new Map<string, Tokens>();

  constructor(
    private readonly item: { text: string; title: string },
    held: readonly string[],
  ) {
    const words = uniform(item.title.trim() ? `${item.title}\n\n${item.text}` : item.text);
    this.mark = words.length;
    this.text = held.length === 0 ? words : `${words}\n${held.map((value) => `• ${uniform(value)}`).join('\n')}`;
  }

  private get tokens(): Reader {
    return (this.read ??= new Reader(this.text, this.mark));
  }

  /** The item read as lines and units. An item with no text is its title. */
  private get lines(): Whole {
    const { text, title } = this.item;
    return (this.whole ??= text.trim() ? new Whole(text, title) : new Whole(title, ''));
  }

  shows(ways: readonly Way[], above?: readonly string[]): Shown | undefined {
    return this.lines.shows(ways, above);
  }

  units(words: string): number | undefined {
    return this.lines.units(words);
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

  /** The values a text may write for this number in a unit that scales it, each as a claim. None when the unit does not scale it. */
  private scaled(value: number, unit: string | undefined): Tokens[] {
    return unit === undefined ? [] : this.against(value, unit).filter(({ list: [first] }) => typeof first === 'object' && !Number.isNaN(first.value) && first.value !== value);
  }

  /** The asked tokens are a run of the text's tokens that crosses none of the barred breaks. */
  private holds(asked: Tokens, barred: number): boolean {
    const written = this.tokens;
    const { list } = written;
    const first = asked.list[0]!;
    const until = list.length - asked.list.length + 1;
    if (typeof first === 'string') {
      for (let start = list.indexOf(first); start >= 0 && start < until; start = list.indexOf(first, start + 1)) if (runs(written, start, asked, barred)) return true;
      return false;
    }
    for (let start = 0; start < until; start++) if (states(written, start, first) && runs(written, start, asked, barred)) return true;
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
 * The item's text, with its title and the values it holds beside its words, each read as a list item of its own. A value is stated
 * by any of them; the whole item, which `shows` and `units` read, is the text alone under its title.
 */
export const grounding = (text: string, { title = '', held = [] }: { title?: string; held?: readonly string[] } = {}): Grounding =>
  new Source({ text, title }, held);
