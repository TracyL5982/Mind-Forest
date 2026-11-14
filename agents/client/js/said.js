/**
 * What an opened card still has to print of its item's text, once the title, the card's own opened
 * form and the list of sources have said most of it. No page is read here, so the rule can be
 * tested without one.
 */

const fold = (str) => str.replace(/\s+/g, ' ').trim();
const lower = (str) => (str.toLowerCase().length === str.length ? str.toLowerCase() : str);
/** Scripts written without spaces, where a word may start or end anywhere and a character says as much as two letters. */
const UNSPACED = /[぀-ヿ㐀-鿿가-힯]/;
const isLetter = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const weight = (str) => [...str].reduce((sum, ch) => sum + (UNSPACED.test(ch) ? 2 : isLetter(ch) ? 1 : 0), 0);
/** A word may end beside this character. */
const edge = (ch) => !isLetter(ch) || UNSPACED.test(ch);
/** A pasted line's bullet, number or tick box, which the card's own form draws in its own way. */
const BULLET = /^\s*(?:(?:[-*•·+]|\d+[.)、]|\[[ xX✓]\])\s*)+/;
/** Words before a colon that only name what follows, as `Pros:` and `优点：` do, when they weigh at most `MARK`. */
const LABEL = /\p{L}[\p{L}\p{N} ]*(?=\s*[:：])/gu;
const MARK = 16;
/** Words that only join the drawn strings around them. */
const JOINERS = new Set(['and', 'or', '和', '与', '以及']);
/** A sentence this long that is already drawn is cut out of a line that says more. */
const STRETCH = 20;
const OPENS = /["'“‘«「『（(]/;
const CLOSES = /["'”’»」』）).!?。！？,，;；:：]/;
const ENDS = /[.!?。！？:：;；]/;
/** An aside in brackets after a drawn sentence stays, without the sentence, as `(n = 212)` does after a caption the title says. */
const ASIDE = /^\s*[(（]/;

/** Whether `words` are already among `said`, whole or shortened with an ellipsis. */
export function isSaid(words, said) {
  const needle = lower(fold(words.replace(/(…|\.\.\.)\s*$/, '')));
  return needle === '' || said.some((part) => lower(fold(part)).includes(needle));
}

/**
 * What an opened card prints of its item under the type's own opened form, where `said` is every
 * string the title, the form and the sources draw: the lines of the text they leave unsaid, and the
 * summary only when neither they nor the text say it. A summary clipped from the text, as one made
 * without the model is, is said by the text.
 */
export function leftover(item, said) {
  const text = rest(item.text, said);
  const summary = isSaid(item.summary, [item.text, ...said]) || rest(item.summary, said, false) === '' ? '' : item.summary;
  return { summary, text };
}

/** The words of `remains`, a line with each drawn string taken out, that are not marks. */
function unmarked(remains) {
  const words = remains.replace(BULLET, '').replace(LABEL, (label) => (weight(label) <= MARK ? '' : label)).match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((word) => !JOINERS.has(lower(word)));
}

/**
 * The lines of `text` that `said` does not already say, where `said` is every string the opened
 * card draws. A string is matched as whole words, whatever its case and however its white space
 * runs. A line is left out when one of those strings holds it, or when what is left once they are
 * taken out is only marks: a bullet, number or tick box at its start, labels before a colon,
 * joining words such as `and`, punctuation and brackets. So `Pros: no data races. Cons: slow
 * builds` and a pasted table row are left out once the card draws their words, and `(n = 212)`
 * after a drawn title keeps its line. Any other line is printed, without each sentence of twenty
 * characters or more that is already drawn. A character of a script written without spaces counts
 * as two letters. With `marks` false nothing is a mark, so a line is left out only when every
 * letter and digit of it is drawn.
 */
export function rest(text, said, marks = true) {
  const shown = [...new Set(said.map((part) => lower(fold(part))).filter(Boolean))].sort((a, b) => b.length - a.length);
  const kept = [];
  for (const raw of text.split('\n')) {
    const line = fold(raw);
    const low = lower(line);
    if (weight(line) === 0) {
      kept.push('');
      continue;
    }
    if (shown.some((part) => part.includes(low))) continue;
    const drawn = new Array(line.length).fill(false);
    for (const part of shown) {
      for (let at = low.indexOf(part); at >= 0; at = low.indexOf(part, at + part.length)) {
        const end = at + part.length;
        if ((edge(part[0]) || edge(low[at - 1])) && (edge(part.at(-1)) || edge(low[end]))) drawn.fill(true, at, end);
      }
    }
    const remains = line.split('').map((ch, i) => (!drawn[i] ? ch : drawn[i - 1] ? '' : '\n')).join('');
    const left = marks ? unmarked(remains) : (remains.match(/[\p{L}\p{N}]+/gu) ?? []);
    if (drawn.includes(true) && left.length === 0) continue;
    kept.push(withoutSentences(line, drawn) ?? raw.trim());
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * `line` without each run of drawn characters that is a sentence of its own: twenty characters or
 * more, from the start of the line or of a sentence to the end of one or to an opening bracket. The
 * quote marks around it and the stop after it go with it. Nothing is returned when no run is one.
 */
function withoutSentences(line, drawn) {
  let out = '';
  let from = 0;
  for (let at = 0; at < line.length; at++) {
    if (!drawn[at] || drawn[at - 1]) continue;
    let end = at;
    while (drawn[end]) end += 1;
    let [start, stop] = [at, end];
    while (start > from && OPENS.test(line[start - 1])) start -= 1;
    while (stop < line.length && CLOSES.test(line[stop])) stop += 1;
    const before = line.slice(from, start).trimEnd();
    const begins = before === '' || ENDS.test(before.at(-1));
    const finishes = stop === line.length || stop > end || ENDS.test(line[end - 1]) || ASIDE.test(line.slice(stop));
    if (end - at >= STRETCH && begins && finishes) {
      out += line.slice(from, start);
      from = stop;
    }
    at = end;
  }
  return from === 0 ? undefined : fold(out + line.slice(from));
}
