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
 *
 * A line break ends a sentence only where the line ends one or is a list item, or the next line is a list item, a table row or
 * empty: pasted text is often wrapped in the middle of a sentence, as in "Do not⏎take ibuprofen".
 */
export interface Grounding {
  /** The text holds these words or this number, inside one table cell, one list item and one CJK sentence. A claim with no letter or digit must stand in the text as written. */
  says(claim: string): boolean;
  /** As `says`, and no sentence that holds them opens with a condition ("If", "When", "Unless", "如果", "要是") the words leave behind. */
  asserts(claim: string): boolean;
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
   * The words name the value where the text writes it: each word of the label stands, in any order, on the line that holds the value,
   * in its sentence there, or in the head of the value's column. A word stands in its other forms too: "slept" for "sleep", "Jan" for
   * "January", "one" for "1". A label need not hold the words that only tie it together ("of", "per", "的"), and may add a word that
   * says what kind of value it is ("time", "price", "weight") where the value is of that kind. It may not open or end with a word that
   * ties, which makes it a piece cut out of a phrase: "of the five-day group". A number is read as `writes` reads it, with its unit.
   * "fell by 15%" names no "absences".
   */
  names(label: string, value: string | number, unit?: string): boolean;
  /**
   * As `quotes`, and the passage is whole: it begins where a sentence, a table cell or a list item begins, or after a marker such as
   * "Caution:" or "注意：", and ends where one ends. "take the pills" is no whole passage of "Do not take the pills.", and
   * "store it in the freezer." none of "Wrong: store it in the freezer."
   */
  whole(passage: string): boolean;
  /** Someone's words: a whole passage, or quoted words that are a sentence of their own, as in 'He said, "Same time next year."' */
  said(passage: string): boolean;
  /** As `quotes`, and the passage begins where a whole one may. It may break off anywhere. */
  leads(passage: string): boolean;
  /** The text opens with these words. */
  begins(passage: string): boolean;
  /**
   * The text gives the term this meaning, in one sentence that opens with the term: the meaning is the whole sentence, or the
   * rest of it after nothing but punctuation or a linking word, as in "Parallax: the shift…" and "Parallax is the shift…".
   * "Some say that X is Y", "The opposite of X is Y" and "Y. X is something else" give X no meaning Y.
   */
  defines(term: string, meaning: string): boolean;
  /** The text is a conversation: three lines or more open with a name and a colon, of two people at least, one of whom speaks twice. */
  converses(): boolean;
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
  /** A colon after a marker that opens a line or a sentence: "Caution:", "Note:", "注意：". What follows it stands as it is said. */
  Lead = 512,
  /** Any colon. */
  Colon = 2048,
  /** A comma or a semicolon. */
  Pause = 4096,
  /** A mark that may end a sentence, whatever follows it: ".", "!", "?" or "。". */
  Stop = 8192,
  /** The line break after a list item, which ends the item as a full stop would. */
  Close = 16384,
}

const SHORT = Break.FullStop | Break.Cell | Break.Item | Break.Row | Break.Tab;
const PASSAGE = Break.FullStop | Break.Cell | Break.Item | Break.Row | Break.Sentence | Break.Blank;
/** Where one sentence ends and the next begins, to a claim that must stand inside one. A line break inside a sentence does not end it. */
const SENTENCE = Break.Sentence | Break.FullStop | Break.Blank | Break.Item | Break.Row;
const APART = SENTENCE | Break.Cell | Break.Tab | Break.Close;
/**
 * Where a whole passage may begin, where one may begin when a marker may stand before it, and before which one may end.
 * Quoted words are no passage of their own, since the sentence around them may deny them: 'He said "the plan works" was a lie.'
 */
const EDGES = { start: APART, led: APART | Break.Lead, end: APART };

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
const PAUSES = new Set([...',;、']);

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
const ABBREVIATIONS = new Set('dr mr mrs ms mx prof sr jr st mt ft vs approx est fig vol inc ltd corp dept ca cf pp acc incl excl esp'.split(' '));

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
  /** How many cell breaks stand before each token on its line: the column it is in, when the line is a table row. */
  readonly columns: number[] = [];
  private column = 0;
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
  /** This line opens with a bullet, a number or a check box: a list item, which its line break ends as a full stop would. */
  private listed = false;
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
      if (this.listed) this.pending |= Break.Close;
      if (this.lineFrom < 0) this.pending |= Break.Blank;
      this.pending |= Break.Line;
      this.closeRow();
      this.stopped = this.cells = this.listed = false;
      this.column = 0;
      this.lineFrom = -1;
      this.lineHead = this.list.length;
      this.at++;
      return;
    }
    if (this.lineFrom < 0) {
      this.lineFrom = at;
      if (kind !== Char.Letter && kind !== Char.Lone) {
        OPENS_ITEM.lastIndex = at;
        if (OPENS_ITEM.test(text)) {
          this.pending |= Break.Item;
          this.listed = true;
        }
      }
    }
    if (kind === Char.Letter) this.word();
    else if (kind === Char.Lone) {
      if (this.stopped) this.pending |= Break.FullStop;
      const to = at + width(text, at);
      this.push(text.slice(at, to), to);
    } else if (kind === Char.Digit) this.number();
    else {
      if (kind === Char.FullStop) this.pending |= Break.FullStop | Break.Stop;
      else if (kind === Char.Stop) this.pending |= Break.Stop;
      else if (kind === Char.Cell) {
        this.pending |= text[at] === '\t' ? Break.Tab : Break.Cell;
        this.cells = true;
        this.column++;
      } else if (OPENING_MARKS.has(text[at]!) || (EITHER_MARKS.has(text[at]!) && BEFORE_OPENING.test(text[at - 1] ?? ''))) this.pending |= Break.Quote;
      else if (CLOSING_MARKS.has(text[at]!) || EITHER_MARKS.has(text[at]!)) this.pending |= Break.Unquote;
      else if (text[at] === ':' || text[at] === '：') {
        if ((this.pending & ~Break.Unquote) === 0 && this.marker()) this.pending |= Break.Lead;
        this.pending |= Break.Colon;
      } else if (PAUSES.has(text[at]!)) this.pending |= Break.Pause;
      this.stopped = kind === Char.Stop || (kind === Char.Closer && this.stopped);
      this.at += width(text, at);
    }
  }

  /** The words since the start of this sentence or line are a marker, which a colon then closes. */
  private marker(): boolean {
    const size = this.list.length - this.opened;
    return MARKERS.some((marker) => marker.length === size && marker.every((token, n) => this.list[this.opened + n] === token));
  }

  /**
   * A period after a number and its unit or ordinal ends a sentence where a capital, a digit, a CJK character or the end of the
   * text follows it, as in "due on the 1st. The deposit" and "330 m. Weight", although "st" and "m" may be abbreviations.
   */
  private endsAfterNumber(word: number, period: number): boolean {
    const { text, size } = this;
    if (!(typeof this.list[this.list.length - 1] === 'object' && (this.end === word || this.spaces(this.end, word)))) return false;
    let at = period + 1;
    if (at < size && !/\s/.test(text[at]!)) return false;
    while (at < size && /\s/.test(text[at]!)) at++;
    return at >= size || /[\p{Lu}\p{N}]/u.test(text[at]!) || kindAt(text, at) === Char.Lone;
  }

  private push(token: Token, to: number): void {
    if ((this.pending & (SENTENCE | Break.Line)) !== 0) this.opened = this.list.length;
    this.list.push(token);
    this.breaks.push(this.pending);
    this.columns.push(this.column);
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
    if (next === 46 && (initials || single || ABBREVIATIONS.has(written)) && !this.endsAfterNumber(at, to)) to++;
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

const phrases = (...written: string[]): Token[][] => written.map((phrase) => tokenize(phrase).list);

/**
 * The words before a colon after which a passage may begin: each says only that what follows matters. Any other lead may turn
 * what follows it around: "Wrong:", "Myth:", "Don't:", "禁止：", "错误：".
 */
const MARKER_WORDS = [
  ...['caution', 'note', 'please note', 'nb', 'warning', 'important', 'reminder', 'tip', '注意', '提醒', '小心', '警告', '提示', '温馨提示', '重要'],
  // The parts of a paper's abstract, which name a part and say nothing of what it holds.
  ...['background', 'methods', 'results', 'conclusion', 'conclusions', 'findings', 'summary', 'abstract', '背景', '方法', '结果', '结论', '摘要'],
];
const MARKERS = phrases(...MARKER_WORDS);
/** A line that opens with a short name and a colon, as a turn of a conversation does: "Mum: …", "妈妈：…". */
const SPEAKER = /^\s*([^\s:：]{1,12})\s*[:：]/u;

/** The words that may stand between a term and its meaning in one sentence. */
const LINKS = phrases(
  ...['is', 'are', 'was', 'were', 'means', 'mean', 'refers to', 'stands for', 'is when', 'is where', 'is defined as', 'are defined as', 'describes'],
  ...['是', '是指', '指', '指的是', '就是', '即', '也就是', '意思是', '的意思是', '叫', '叫做'],
);
/** The words that may open a sentence before the term it defines. */
const OPENERS = phrases('a', 'an', 'the', 'the word', 'the term', 'the phrase', 'the concept of', 'the idea of', '所谓');
/** The words that open a sentence whose entries hold only under a condition. */
const CONDITIONS = phrases('if', 'when', 'unless', 'only if', '如果', '要是', '假如', '除非', '万一');
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
/** Of those, the ones a label may begin with: an article opens a name ("A year on Mars"), and 在 and 要 open many words, as 在线 and 要求. */
const OPENS_WORDS = new Set(['a', 'an', 'the', '在', '要']);
const TIE_PHRASES = phrases('已经');

/** What kind of value a value is, read off its unit or its form. */
type Kind = 'time' | 'age' | 'year' | 'date' | 'money' | 'share' | 'per' | 'length' | 'mass' | 'area' | 'rank';
/** A numeral, in digits or in Chinese, before the unit that counts it. */
const N = '[\\d一二三四五六七八九十两百千万亿]\\s*';
const KINDS: Record<Kind, RegExp> = {
  money: new RegExp(`[$€£¥₹₩]|\\b(?:dollars?|euros?|pounds?|pence|cents?|yen|yuan|usd|eur|gbp|rmb|cny)\\b|${N}(?:元|块)|美元|欧元|英镑|日元`, 'iu'),
  time: new RegExp(`\\d:\\d\\d|\\d\\s*(?:s|secs?|mins?|h|hrs?|yrs?)\\b|\\b(?:seconds?|minutes?|hours?|days?|nights?|weeks?|months?|years?)\\b|${N}(?:秒|分钟?|小时|钟头|天|周|星期|个?月|年)`, 'iu'),
  age: new RegExp(`\\b(?:years?|yrs?|months?|weeks?)(?: old)?\\b|${N}周?岁`, 'iu'),
  year: /^\D*(?:1[0-9]|20)\d\d\D*$/u,
  date: new RegExp(`\\b(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\b|\\d{1,4}[/.-]\\d{1,2}|\\d(?:st|nd|rd|th)\\b|${N}(?:月|日|号)`, 'iu'),
  share: /%|\bper ?cent\b|\bpct\b|百分之/iu,
  per: /\bper\b|\/|\b(?:an?|each) (?:hour|head|day|night|week|month|year|person)\b|每/iu,
  length: new RegExp(`\\d\\s*(?:mm|cm|m|km|ft|feet|foot|in|inch(?:es)?|miles?|mi|yards?|metres?|meters?|kilometres?|kilometers?|centimetres?|centimeters?)\\b|${N}(?:米|厘米|毫米|公里|千米)`, 'iu'),
  mass: new RegExp(`\\d\\s*(?:mg|g|kg|kgs|lbs?|oz)\\b|\\b(?:kilos?|kilograms?|grams?|ounces?|stones?|tonnes?|tons?)\\b|${N}(?:克|公斤|千克|斤|吨)`, 'iu'),
  area: new RegExp(`\\b(?:sq|square|m2|acres?|hectares?)\\b|m²|${N}(?:平米|平方米?|亩)`, 'iu'),
  rank: /\d(?:st|nd|rd|th)\b|第/iu,
};
/** The kinds of a value. A sum of money is that and nothing else, so "$2.1m" is no length. */
function kindsOf(written: string): Set<Kind> {
  const kinds = new Set((Object.keys(KINDS) as Kind[]).filter((kind) => KINDS[kind].test(written)));
  if (kinds.has('money')) kinds.delete('length');
  return kinds;
}

/**
 * Words a label may add that say what kind of value it names, with the kinds of value each may name. A word for which no kind is
 * given names any value, and may be added only beside a word the text writes: "Total climb".
 */
const MEASURES: [Token[], Kind[]][] = (
  [
    [['time', 'duration', '时间', '时长', '用时'], ['time']],
    [['age', '年龄'], ['age', 'time']],
    [['year', '年份'], ['year']],
    [['date', '日期'], ['date']],
    [['price', 'cost', 'amount', 'fee', '价格', '价钱', '售价', '费用', '成本', '金额'], ['money']],
    [['rate'], ['share', 'per', 'money']],
    [['share', 'proportion', '比例', '比率', '占比'], ['share']],
    [['length', '长度'], ['length', 'time']],
    [['height', 'distance', '高度', '距离'], ['length']],
    [['weight', '重量'], ['mass']],
    [['size', 'area', '面积'], ['area', 'length']],
    [['place', 'rank', 'position', '名次', '排名'], ['rank']],
    [['count', 'number', 'total', '数', '数量', '总数', '次数', '数目', '总计', '合计'], []],
  ] as const
).flatMap(([words, kinds]) => words.map((word): [Token[], Kind[]] => [tokenize(word).list, [...kinds]]));

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

/** A label read into the words that must stand beside its value and the words it may add. Undefined for a label cut out of a phrase. */
interface Label {
  words: Token[];
  measures: { tokens: Token[]; kinds: Kind[] }[];
  /** It opens with an article, as "A year on Mars" and "a week" do. */
  article: boolean;
}

const labelOf = remembered(readLabel, 2_000);

function readLabel(label: string): Label | undefined {
  const { list } = tokenize(uniform(label));
  if (list.length === 0) return undefined;
  const tie = (token: Token | undefined, opening: boolean) => typeof token === 'string' && TIES.has(token) && !(opening && OPENS_WORDS.has(token));
  const tied = (phrase: Token[], at: number) => phrase.every((token, n) => list[at + n] === token);
  if (tie(list[0], true) || tie(list.at(-1), false) || TIE_PHRASES.some((phrase) => tied(phrase, 0) || tied(phrase, list.length - phrase.length))) return undefined;
  const taken = new Set<number>();
  const measures: Label['measures'] = [];
  for (const [tokens, kinds] of MEASURES) {
    for (let at = 0; at + tokens.length <= list.length; at++) {
      const here = tokens.every((token, n) => !taken.has(at + n) && typeof list[at + n] === 'string' && formOf(list[at + n] as string) === formOf(token as string));
      if (!here) continue;
      for (let n = 0; n < tokens.length; n++) taken.add(at + n);
      measures.push({ tokens: list.slice(at, at + tokens.length), kinds });
    }
  }
  for (const phrase of TIE_PHRASES) for (let at = 0; at + phrase.length <= list.length; at++) if (tied(phrase, at)) for (let n = 0; n < phrase.length; n++) taken.add(at + n);
  const words = list.filter((token, at) => !taken.has(at) && !(typeof token === 'string' && TIES.has(token)));
  return words.length + measures.length > 0 ? { words, measures, article: list[0] === 'a' || list[0] === 'an' || list[0] === 'the' } : undefined;
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

  asserts(claim: string): boolean {
    const asked = this.claim(claim);
    if (asked.list.length === 0) return this.says(claim);
    return this.holds(asked, SHORT, (start) => start >= this.tokens.marked || !this.conditional(start), this.tokens.list.length);
  }

  names(label: string, value: string | number, unit?: string): boolean {
    const shape = labelOf(label);
    if (!shape) return false;
    const { words, measures } = shape;
    const asked = typeof value === 'string' ? value : `${value}${unit ?? ''}`;
    const written = this.tokens;
    const { line } = this.spanned();
    const named = (start: number, size: number) => {
      let [from, to] = [start, start + size];
      while (from > 0 && line[from - 1] === line[start]) from--;
      while (to < written.marked && line[to] === line[start]) to++;
      const head = this.head(start);
      const stands = (word: Token) => {
        for (let at = from; at < to; at++) if (like(written, at, word)) return true;
        return head.some((at) => like(written, at, word));
      };
      if (!words.every(stands)) return false;
      // A word that says what kind of value it is may be added where the value is of that kind, read off the value and the words
      // the text sets after it ("3.4 kg"), and a word that says nothing of its kind beside a word that does or a word the text writes.
      const unstated = measures.filter(({ tokens }) => !tokens.every(stands));
      if (unstated.length === 0) return true;
      const after = written.list.slice(start + size, Math.min(to, start + size + 2)).filter((token) => typeof token === 'string');
      const kinds = kindsOf(`${asked} ${after.join(' ')}`);
      const generic = unstated.filter(({ kinds: of }) => of.length === 0).length;
      if (!unstated.every(({ kinds: of }) => of.length === 0 || of.some((kind) => kinds.has(kind)))) return false;
      return generic === 0 || words.length > 0 || measures.length > generic;
    };
    if (typeof value === 'string') {
      const asked = this.claim(value);
      // An article opens a name, and not a piece of the value it labels: "a week" of "10 hours a week".
      if (shape.article && words.every((word) => asked.list.some((_token, at) => like(asked, at, word)))) return false;
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

  said(passage: string): boolean {
    if (this.whole(passage)) return true;
    const asked = this.claim(passage);
    if (asked.list.length === 0) return false;
    const { breaks, marked } = this.tokens;
    const { sentence } = this.spanned();
    return this.holds(asked, PASSAGE, (from) => {
      const after = from + asked.list.length;
      const closed = after >= marked ? 0 : breaks[after]!;
      // The quoted words whole, from the mark that opens them to the mark that closes them.
      if ((breaks[from]! & Break.Quote) === 0 || (after < marked && (closed & Break.Unquote) === 0)) return false;
      for (let at = from + 1; at < after; at++) if ((breaks[at]! & (Break.Quote | Break.Unquote)) !== 0) return false;
      // A sentence of their own: opened where a sentence opens or after a colon or a comma, and closed by a full stop or where a
      // sentence ends, or before a comma. "He said "the plan works" was a lie." quotes words that are part of a sentence of the text's own.
      if (!(this.edge(from, 'start') || (breaks[from]! & (Break.Colon | Break.Pause)) !== 0)) return false;
      if (!(after >= marked || (closed & (EDGES.end | Break.Pause | Break.Stop)) !== 0)) return false;
      // Not the rest of a quotation the sentence broke off, as "take the pills" is of '"Never," she said, "take the pills."'
      for (let at = from; at > 0 && sentence[at - 1] === sentence[from]; at--) if ((breaks[at]! & Break.Unquote) !== 0) return false;
      return true;
    });
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
    const size = named.list.length;
    return this.holds(meant, PASSAGE, (from) => {
      const last = from + meant.list.length - 1;
      if (!this.edge(last + 1, 'end') || sentence[last] !== sentence[from]) return false;
      // The whole sentence, which opens with the term: "Parallax is the apparent shift…".
      if (this.opensWith(from, named) && this.edge(from, 'led')) return true;
      // The rest of the term's sentence after the term, which opens it: "Parallax: the apparent shift…".
      return this.holds(named, SHORT, (at) => {
        if (at + size > from || sentence[at] !== sentence[from] || !this.opensSentence(at)) return false;
        const between = written.list.slice(at + size, from);
        return between.length === 0 || LINKS.some((link) => link.length === between.length && link.every((token, n) => token === between[n]));
      });
    });
  }

  converses(): boolean {
    const speakers = new Map<string, number>();
    for (const line of this.text.slice(0, this.mark).split('\n')) {
      const speaker = SPEAKER.exec(line)?.[1]?.toLowerCase();
      if (speaker && !MARKER_WORDS.includes(speaker)) speakers.set(speaker, (speakers.get(speaker) ?? 0) + 1);
    }
    const lines = [...speakers.values()];
    return lines.length >= 2 && lines.reduce((sum, n) => sum + n, 0) >= 3 && lines.some((n) => n >= 2);
  }

  /** The asked tokens stand at `at`, one after another. */
  private opensWith(at: number, asked: Tokens): boolean {
    return asked.list.every((token, n) => same(this.tokens, at + n, token));
  }

  /** The token opens its sentence, or follows nothing in it but an article or a word that names a term: "The word", "所谓". */
  private opensSentence(at: number): boolean {
    if (this.edge(at, 'led')) return true;
    const { list } = this.tokens;
    return OPENERS.some((opener) => at >= opener.length && this.edge(at - opener.length, 'led') && opener.every((token, n) => list[at - opener.length + n] === token));
  }

  /** The sentence that holds the token opens with a condition the token comes after: "If she agrees we need the build ready". */
  private conditional(at: number): boolean {
    const { breaks, list } = this.tokens;
    const { sentence } = this.spanned();
    let first = at;
    while (first > 0 && sentence[first - 1] === sentence[at]) first--;
    // A marker before it, as in "Note: if it rains", is passed over.
    for (let lead = first + 1; lead <= first + 3 && lead < at; lead++) if ((breaks[lead]! & Break.Lead) !== 0) first = lead;
    return first < at && CONDITIONS.some((condition) => condition.every((token, n) => list[first + n] === token));
  }

  /** The words of the head of the value's column, when it stands in a row of a table under the table's first row. */
  private head(at: number): number[] {
    const { breaks, columns } = this.tokens;
    const { line } = this.spanned();
    const opens = (token: number) => token === 0 || line[token - 1] !== line[token];
    let row = at;
    while (!opens(row)) row--;
    if ((breaks[row]! & Break.Row) === 0) return [];
    // Up to the first row of the table: the rows above, as far as they follow one another with no empty line between.
    let head = row;
    while (head > 0 && (breaks[head]! & Break.Blank) === 0) {
      let above = head - 1;
      while (!opens(above)) above--;
      if ((breaks[above]! & Break.Row) === 0) break;
      head = above;
    }
    const cell: number[] = [];
    for (let token = head; token < row && line[token] === line[head]; token++) if (columns[token] === columns[at]) cell.push(token);
    return cell;
  }

  /** The values a text may write for this number in a unit that scales it, each as a claim. None when the unit does not scale it. */
  private scaled(value: number, unit: string | undefined): Tokens[] {
    return unit === undefined ? [] : this.against(value, unit).filter(({ list: [first] }) => typeof first === 'object' && !Number.isNaN(first.value) && first.value !== value);
  }

  /**
   * The sentence each token stands in, and its line. A list item and a table row are each a sentence of their own, whatever ends
   * them, and a sentence runs on over a line break that ends none. Only an item or a row is a line of its own: a line of prose
   * holds several sentences, and there each sentence counts as a line, so a line is never longer than a sentence.
   */
  private spanned(): { sentence: Int32Array; line: Int32Array } {
    if (this.spans) return this.spans;
    const { breaks } = this.tokens;
    const [sentence, line] = [new Int32Array(breaks.length), new Int32Array(breaks.length)];
    let apart = false;
    for (let from = 0, to = 1; from < breaks.length; from = to++) {
      let listed = (breaks[from]! & (Break.Item | Break.Row)) !== 0;
      for (; to < breaks.length && (breaks[to]! & Break.Line) === 0; to++) listed ||= (breaks[to]! & (Break.Cell | Break.Tab)) !== 0;
      for (let at = Math.max(from, 1); at < to; at++) {
        const ended = (breaks[at]! & SENTENCE) !== 0;
        sentence[at] = sentence[at - 1]! + (ended || (at === from && (apart || listed)) ? 1 : 0);
        line[at] = line[at - 1]! + (at === from || (ended && !listed) ? 1 : 0);
      }
      apart = listed;
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
   * stands among the words, before any held value, at a start that `where` accepts. `within` may let it stand anywhere.
   */
  private holds(asked: Tokens, barred: number, where?: (start: number) => boolean, within = where ? this.tokens.marked : this.tokens.list.length): boolean {
    const written = this.tokens;
    const { list } = written;
    const first = asked.list[0]!;
    const until = within - asked.list.length + 1;
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
