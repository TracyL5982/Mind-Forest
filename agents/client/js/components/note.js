import { h } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, fold, say, text, title, titleOf } from './shared.js';

const WIDTH = 240;
const COLUMN = WIDTH - SIDES;
const LINES = 3;
/** The most lines a body is given to reach the end of the words it sets apart. The Renderer keeps words that end within 180 characters of the text, or 90 in a script written without spaces, which take eight lines at most. */
const REACH = 8;

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
 * The body is the item's summary, else its text. A note that sets words apart shows its item's own text, with the words marked
 * where they stand, on as many lines as reach the end of them.
 */
function plan(item, props) {
  const emphasis = text(props.emphasis).trim();
  const body = (emphasis && item.text) || item.summary || item.text;
  const shown = body && body !== item.title ? body : '';
  const at = emphasis && shown ? find(shown, emphasis) : null;
  const most = at ? Math.max(LINES, fold(shown.slice(0, at[1]), COLUMN, TEXT_LETTER, REACH)) : LINES;
  return {
    body: shown,
    at,
    titleLines: fold(titleOf(item), COLUMN, TITLE_LETTER, 2),
    bodyLines: shown ? fold(shown, COLUMN, TEXT_LETTER, most) : 0,
  };
}

export const shows = [];

export function size(item, props) {
  const { titleLines, bodyLines } = plan(item, props);
  return [WIDTH, FRAME + titleLines * TITLE + (bodyLines ? 6 + bodyLines * TEXT : 0)];
}

const marked = (body, [start, end], lines) => h('div', { class: `card-text clamp-${lines}`, dir: 'auto' },
  body.slice(0, start), h('mark', { class: 'note-mark', text: body.slice(start, end) }), body.slice(end));

export function draw(item, props) {
  const { body, at, titleLines, bodyLines } = plan(item, props);
  return [
    title(item, titleLines),
    body && (at ? marked(body, at, bodyLines) : say('div', `card-text clamp-${bodyLines}`, body)),
  ];
}

export const detail = () => [];
