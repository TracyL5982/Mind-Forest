import { h } from '../dom.js';
import { GAP, WIDTH, drawFace, lay, text, titleRow } from './shared.js';
import { wordsOf } from '../words.js';

const QUOTES = /["'‘’“”«»「」『』`´]/u;
const DASHES = /[‐‑‒–—―−]/u;

/** A string as it is compared with words set apart from it, without quotation marks, with one dash and one space, and where each character of that comes from. */
function folded(str) {
  let out = '';
  const from = [];
  for (let at = 0; at < str.length; ) {
    const ch = String.fromCodePoint(str.codePointAt(at));
    const form = /\s/u.test(ch) ? ' ' : DASHES.test(ch) ? '-' : QUOTES.test(ch) ? '' : ch.normalize('NFKC');
    if (form !== ' ' || (out !== '' && !out.endsWith(' '))) {
      for (const part of form) {
        out += part;
        from.push([at, at + ch.length]);
      }
    }
    at += ch.length;
  }
  return { out, from };
}

/** Where the words stand in the body, as the item writes them, quotation marks and all. */
function find(body, words) {
  const { out, from } = folded(body);
  const wanted = folded(words).out.trim();
  const at = wanted ? out.indexOf(wanted) : -1;
  return at < 0 ? null : [from[at][0], from[at + wanted.length - 1][1]];
}

/**
 * The body is the item's summary, else its text, on the whole lines the face has room for under the title. A note that sets words
 * apart shows its item's own text with the words marked where they stand. When the lines from the start of the text do not reach
 * them, the body starts where they start, so the face shows them marked, and the cue says there is more.
 */
function face(item, props) {
  const emphasis = text(props.emphasis).trim();
  const body = (emphasis && item.text) || item.summary || item.text;
  const shown = body && body !== item.title ? body : '';
  const at = emphasis && shown ? find(shown, emphasis) : null;
  const words = wordsOf(item);
  const from = (start, more) => lay([
    titleRow(item),
    shown && { words: shown.slice(start), gap: GAP, draw: (row) => (at ? marked(row.words, [at[0] - start, at[1] - start]) : say(row.words)) },
  ], { words, more });
  const laid = from(0, false);
  if (!at || (laid.rows[1]?.words.length ?? 0) >= at[1]) return laid;
  return from(at[0], true);
}

export function size(item, props) {
  return [WIDTH, face(item, props).height];
}

const say = (words) => h('div', { class: 'card-text', dir: 'auto', text: words });
const marked = (words, [start, end]) => h('div', { class: 'card-text', dir: 'auto' },
  words.slice(0, start), h('mark', { class: 'note-mark', text: words.slice(start, end) }), words.slice(end));

export const draw = (item, props) => drawFace(face(item, props));

export const detail = () => [];
