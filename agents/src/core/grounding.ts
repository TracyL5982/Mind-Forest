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
const NUMBER = String.raw`(?:(?<![\p{L}\p{N}])[-−])?(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?`;
const WORD = String.raw`(?:(?!\d|${SPACELESS})[\p{L}\p{M}\p{N}])+`;
const TOKEN = new RegExp(`(${NUMBER})|${SPACELESS}|${WORD}`, 'gu');

const BREAK = /[\n\r\t|｜。！？]|[.!?…]["'”’»)\]]*\s/;
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
  from: number[];
  to: number[];
  numbers: Set<number>;
}

function tokenize(text: string): Tokens {
  const tokens: Tokens = { words: [], broken: [], from: [], to: [], numbers: new Set() };
  let end = 0;
  for (const match of text.matchAll(TOKEN)) {
    const gap = match.index - end;
    tokens.broken.push(gap > 0 && !(gap === 1 && text[end] === ' ') && BREAK.test(text.slice(end, match.index)));
    end = match.index + match[0].length;
    tokens.from.push(match.index);
    tokens.to.push(end);
    if (match[1] === undefined) {
      tokens.words.push(match[0].toLowerCase());
    } else {
      const number = match[1].replace(/,/g, '').replace('−', '-');
      tokens.words.push(number);
      tokens.numbers.add(Number(number));
    }
  }
  return tokens;
}

export function grounding(text: string): Grounding {
  let read: (Tokens & { places: Map<string, number[]> }) | undefined;
  let hexes: Set<string> | undefined;

  const source = () => {
    if (read) return read;
    const tokens = tokenize(text);
    const places = new Map<string, number[]>();
    tokens.words.forEach((word, n) => {
      const at = places.get(word);
      if (at) at.push(n);
      else places.set(word, [n]);
    });
    return (read = { ...tokens, places });
  };

  /** Where in the text each run of the claim's tokens starts. */
  function runs(claim: Tokens, unbroken: boolean): number[] {
    const { words, broken, places } = source();
    return (places.get(claim.words[0]!) ?? []).filter((start) => {
      for (let n = 1; n < claim.words.length; n++) {
        if (words[start + n] !== claim.words[n]) return false;
        if (unbroken && broken[start + n] && !claim.broken[n]) return false;
      }
      return true;
    });
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
    writes: (value) => Number.isFinite(value) && source().numbers.has(value),
    paints: (hex) => (hexes ??= new Set(text.match(HEX)?.map((written) => written.toLowerCase()))).has(hex.trim().toLowerCase()),
    ticks(words) {
      const asked = tokenize(words);
      if (asked.words.length === 0) return undefined;
      const { from, to } = source();
      for (const start of runs(asked, false)) {
        const first = from[start]!;
        const last = to[start + asked.words.length - 1]!;
        const line = text.lastIndexOf('\n', first - 1) + 1;
        const lineEnd = text.indexOf('\n', last);
        const mark = MARK_BEFORE.exec(text.slice(line, first))?.[1] ?? MARK_AFTER.exec(text.slice(last, lineEnd < 0 ? undefined : lineEnd))?.[1];
        if (mark) return !NOT_DONE.has(mark);
      }
      return undefined;
    },
  };
}
