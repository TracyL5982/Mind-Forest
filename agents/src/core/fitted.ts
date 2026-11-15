import { COLUMN, FRAME, GAP, HEIGHT, TEXT, TITLE, linesOf } from '../../client/js/components/shared.js';

/**
 * What the service writes for a card's small face is held to the face's own rule, the web client's letter widths, so a title and a
 * summary stand on the face whole and the Quest client, which shares the rule, shows the same words. Nothing here ends in an
 * ellipsis: a cut falls where a sentence, a clause or a word ends.
 */

/** The most lines a title takes on a small face. A longer one is cut there, at a whole word, with an ellipsis. */
export const TITLE_LINES = 2;

/** Where a sentence ends: after a stop and the quotation marks or brackets that close on it, before white space or the end. A stop set with Han needs no space after it. */
const SENTENCE = /[.!?…]["'”’)\]]*(?=\s|$)|[。！？][”’」』）]*/gu;
/** Where a clause ends inside a sentence: before a comma, a semicolon, a colon or a dash. */
const CLAUSE = /\s*(?:[,;:，；：、]|\s[–—-]\s)/gu;
/** Where a word ends: before white space, before a hyphen that joins two words, and after each character of a script written without spaces. */
const WORD = /\S(?=\s)|\p{L}(?=-\p{L})|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
/** A clause that stands for the whole says something: three words, or six characters of a script written without spaces. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const SAYS = (words: string) => words.split(/\s+/).filter(Boolean).length >= 3 || (words.match(UNSPACED)?.length ?? 0) >= 6;
/** What a cut leaves at its end that only joins it to what was cut. */
const TRAILING = /[\s,;:，；：、–—-]+$/u;

/** The starts of `words` that end where `pattern` ends a piece of them, longest first, without what joins them to the rest. */
const starts = (words: string, pattern: RegExp, end: (m: RegExpMatchArray) => number) =>
  [...words.matchAll(pattern)].map((m) => words.slice(0, end(m)).replace(TRAILING, '')).filter(Boolean).reverse();

/**
 * A title the model writes, held to the two lines of the 177 px column a small face gives a title, counted at the title's size. A
 * longer one keeps its first whole clause that fits and says something, else its first whole words that fit, or for a script
 * written without spaces its first characters. It never ends in an ellipsis.
 */
export function fittedTitle(title: string): string {
  const fits = (words: string) => linesOf(words, COLUMN, 'title') <= TITLE_LINES;
  if (!title || fits(title)) return title;
  const clause = starts(title, CLAUSE, (m) => m.index!).find((words) => SAYS(words) && fits(words));
  if (clause) return clause;
  const word = starts(title, WORD, (m) => m.index! + m[0].length).find(fits);
  if (word !== undefined) return word;
  let kept = '';
  for (const ch of title) {
    if (!fits(kept + ch)) break;
    kept += ch;
  }
  return kept;
}

/**
 * The title a small face shows for an item whose title is a source's own, a paper's, a work's, a page's or a file's, which is never
 * rewritten: its `fittedTitle`, when that is shorter than the title. Nothing when the whole title fits.
 */
export const shortTitleOf = (title: string): string | undefined => {
  const short = fittedTitle(title);
  return short !== title ? short : undefined;
};

/**
 * The summary as a note's small face holds it whole under the title: on as many lines of the 177 px column as are left under the
 * title's lines, which is three under a title of one line and two under a title of two. A summary that runs longer keeps its
 * first whole sentences that fit, else its first whole clause that fits and says something, without the mark that ends the clause.
 * When neither fits, it is dropped, and the note shows the item's own first lines instead. It never ends in an ellipsis. The
 * opened card shows the item's text whole either way.
 */
export function fittedSummary(summary: string, title: string): string {
  const titleLines = Math.min(TITLE_LINES, linesOf(fittedTitle(title), COLUMN, 'title'));
  const room = Math.floor((HEIGHT - FRAME - titleLines * TITLE - GAP) / TEXT);
  const fits = (words: string) => room > 0 && linesOf(words, COLUMN, 'body') <= room;
  if (!summary || fits(summary)) return summary;
  const sentence = starts(summary, SENTENCE, (m) => m.index! + m[0].length).find(fits);
  if (sentence) return sentence;
  return starts(summary, CLAUSE, (m) => m.index!).find((clause) => SAYS(clause) && fits(clause)) ?? '';
}
