/**
 * A source text, asked whether it states a claim. Built once per text; each question reads the same token list.
 *
 * A claim is stated when its tokens are a run of whole tokens of the text. Case, spacing, quote marks and other
 * punctuation between tokens do not count. A number is one token with its sign, thousands separators and decimal
 * point, so "5" is not in "1950" and "1,200" is "1200". Scripts written without spaces have one token per
 * character, which makes a claim in them match as a substring.
 */
export interface Grounding {
  /** The text holds these words or this number. A claim with no letter or digit must stand in the text as written. */
  says(claim: string): boolean;
  /** As `says`, and the words are one stretch of the text: where the text breaks off (a sentence end, a line, a table cell), the passage breaks too. */
  quotes(passage: string): boolean;
  /** The text writes this number, in any grouping. */
  writes(value: number): boolean;
  /** The text writes this hex colour, with its "#", as a whole value. */
  paints(hex: string): boolean;
  /** The check mark the text puts beside these words on their line: done, not done, or none. */
  ticks(words: string): boolean | undefined;
}

const SPACELESS = String.raw`(?=[\p{L}\p{M}\p{N}])[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]`;
const SPACELESS_CHAR = new RegExp(`^${SPACELESS}$`, 'u');
const WORD_CHAR = /^[\p{L}\p{M}\p{N}]$/u;
const SPACED_BEFORE = new RegExp(`(?:(?!${SPACELESS})[\\p{L}\\p{N}])$`, 'u');
const SPACED_AFTER = new RegExp(`^(?:(?!${SPACELESS})[\\p{L}\\p{N}])`, 'u');
const HEX = /(?<![\p{L}\p{N}#])#[0-9a-f]+(?![\p{L}\p{N}])/giu;
const MARK = String.raw`\[[ xX✓✔]\]|[☑☐✓✔✅]`;
const MARK_BEFORE = new RegExp(`(${MARK})[^\\p{L}\\p{N}]*$`, 'u');
const MARK_AFTER = new RegExp(`^[^\\p{L}\\p{N}]*?(${MARK})\\s*$`, 'u');
const NOT_DONE = new Set(['[ ]', '☐']);

interface Tokens {
  words: string[];
  /** Whether the text breaks off between a token and the one before it. */
  broken: boolean[];
  /** Where each token starts and ends in the text, as pairs. Kept only when asked for. */
  spans: number[];
}

const enum Char {
  Other,
  Letter,
  /** One character of a script written without spaces: a token by itself. */
  Lone,
  Digit,
  Minus,
  /** Ends a line, a table cell or a CJK sentence wherever it stands. */
  Break,
  /** Ends a sentence when white space follows it, with or without a closing quote or bracket between. */
  Stop,
  Closer,
  Space,
}

const ASCII = Array.from({ length: 128 }, (_v, code): Char => {
  const char = String.fromCharCode(code);
  if (/[a-z]/i.test(char)) return Char.Letter;
  if (/\d/.test(char)) return Char.Digit;
  if (char === '-') return Char.Minus;
  if ('\n\r\t|'.includes(char)) return Char.Break;
  if ('.!?'.includes(char)) return Char.Stop;
  if ('"\')]'.includes(char)) return Char.Closer;
  return /\s/.test(char) ? Char.Space : Char.Other;
});
const BEYOND_ASCII = new Map<string, Char>([
  ...[...'｜。！？'].map((char): [string, Char] => [char, Char.Break]),
  ['…', Char.Stop],
  ...[...'”’»'].map((char): [string, Char] => [char, Char.Closer]),
  ['−', Char.Minus],
]);

const beyondAscii = (char: string): Char =>
  BEYOND_ASCII.get(char) ?? (SPACELESS_CHAR.test(char) ? Char.Lone : WORD_CHAR.test(char) ? Char.Letter : /^\s$/u.test(char) ? Char.Space : Char.Other);

const isDigit = (text: string, at: number) => ASCII[text.charCodeAt(at)] === Char.Digit;

/** How many code units the character here takes: two for one outside the basic plane. */
function width(text: string, at: number): number {
  return text.codePointAt(at)! > 0xffff ? 2 : 1;
}

function kindAt(text: string, at: number): Char {
  const code = text.charCodeAt(at);
  return code < 128 ? ASCII[code]! : beyondAscii(String.fromCodePoint(text.codePointAt(at)!));
}

/**
 * The text as tokens: a word, a number, or one character of a script written without spaces.
 * Read by hand, one character at a time: a pattern over Unicode classes took several times as long on plain Latin text.
 */
function tokenize(text: string, placed = false): Tokens {
  const words: string[] = [];
  const broken: boolean[] = [];
  const spans: number[] = [];
  let breaks = false;
  let stopped = false;
  let end = -1;
  let at = 0;
  while (at < text.length) {
    const from = at;
    let kind = kindAt(text, at);
    let word: string | undefined;

    if (kind === Char.Lone) {
      at += width(text, at);
      word = text.slice(from, at);
    } else if (kind === Char.Letter) {
      do {
        at += width(text, at);
        kind = at < text.length ? kindAt(text, at) : Char.Other;
      } while (kind === Char.Letter);
      word = text.slice(from, at).toLowerCase();
    } else if (kind === Char.Digit || (kind === Char.Minus && end !== at && isDigit(text, at + 1))) {
      if (kind === Char.Minus) at++;
      const whole = at;
      let grouped = false;
      while (isDigit(text, at)) at++;
      // Groups of three after a comma belong to the number: "1,200" is one number and "1,2,3" is three.
      if (at - whole <= 3) {
        while (text[at] === ',' && isDigit(text, at + 1) && isDigit(text, at + 2) && isDigit(text, at + 3) && !isDigit(text, at + 4)) {
          at += 4;
          grouped = true;
        }
      }
      if (text[at] === '.' && isDigit(text, at + 1)) {
        at++;
        while (isDigit(text, at)) at++;
      }
      word = text.slice(whole, at);
      if (grouped) word = word.replace(/,/g, '');
      if (kind === Char.Minus) word = `-${word}`;
    } else {
      if (kind === Char.Break || (kind === Char.Space && stopped)) breaks = true;
      stopped = kind === Char.Stop || (kind === Char.Closer && stopped);
      at += width(text, at);
      continue;
    }

    words.push(word);
    broken.push(breaks);
    if (placed) spans.push(from, at);
    breaks = stopped = false;
    end = at;
  }
  return { words, broken, spans };
}

export function grounding(text: string): Grounding {
  let read: Tokens | undefined;
  let numbers: Set<number> | undefined;
  let hexes: Set<string> | undefined;
  const source = () => (read ??= tokenize(text, true));

  /** Where in the text each run of the claim's tokens starts. */
  function runs(claim: Tokens, unbroken: boolean): number[] {
    const { words, broken } = source();
    const starts: number[] = [];
    scan: for (let start = words.indexOf(claim.words[0]!); start >= 0; start = words.indexOf(claim.words[0]!, start + 1)) {
      for (let n = 1; n < claim.words.length; n++) {
        if (words[start + n] !== claim.words[n]) continue scan;
        if (unbroken && broken[start + n] && !claim.broken[n]) continue scan;
      }
      starts.push(start);
    }
    return starts;
  }

  function standsAlone(symbols: string): boolean {
    for (let at = text.indexOf(symbols); at >= 0; at = text.indexOf(symbols, at + 1)) {
      const before = text.slice(Math.max(0, at - 2), at);
      const after = text.slice(at + symbols.length, at + symbols.length + 2);
      if (!SPACED_BEFORE.test(before) && !SPACED_AFTER.test(after)) return true;
    }
    return false;
  }

  function stated(claim: string, unbroken: boolean): boolean {
    const asked = tokenize(claim);
    if (asked.words.length > 0) return runs(asked, unbroken).length > 0;
    const symbols = claim.trim();
    return symbols.length > 0 && standsAlone(symbols);
  }

  return {
    says: (claim) => stated(claim, false),
    quotes: (passage) => stated(passage, true),
    writes: (value) => Number.isFinite(value) && (numbers ??= new Set(source().words.map(Number))).has(value),
    paints: (hex) => (hexes ??= new Set(text.match(HEX)?.map((written) => written.toLowerCase()))).has(hex.trim().toLowerCase()),
    ticks(words) {
      const asked = tokenize(words);
      if (asked.words.length === 0) return undefined;
      const { spans } = source();
      for (const start of runs(asked, false)) {
        const first = spans[start * 2]!;
        const last = spans[(start + asked.words.length) * 2 - 1]!;
        const line = text.lastIndexOf('\n', first - 1) + 1;
        const lineEnd = text.indexOf('\n', last);
        const mark = MARK_BEFORE.exec(text.slice(line, first))?.[1] ?? MARK_AFTER.exec(text.slice(last, lineEnd < 0 ? undefined : lineEnd))?.[1];
        if (mark) return !NOT_DONE.has(mark);
      }
      return undefined;
    },
  };
}
