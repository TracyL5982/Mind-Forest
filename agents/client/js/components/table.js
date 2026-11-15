import { h } from '../dom.js';
import { COLUMN, GAP, WIDTH, aboveRows, drawFace, lay, linesOf, list, text, textWidth, titleRow, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/**
 * A number: a sign, a currency (`$`, `US$`, `€`, `HK$`, or a code of three capitals and a space, as
 * `RMB ` and `USD `) and a sign again, each when it is there, then digits with separators and at
 * most one decimal point, a percent sign, and a unit of at most two words.
 */
const NUMERAL = /^(?:[-+−–~≈<>≤≥±]\s?)?(?:[A-Z]{0,3}\p{Sc}\s?|[A-Z]{3}\s)?[-+−–]?\d[\d,'’:/\s]*(?:\.\d[\d,'’:/\s]*)?[%％‰]?(?:\s?[\p{L}\p{Sc}°µ²³/]+(?:\s[\p{L}\p{Sc}°µ²³/]+)?)?$/u;
/** A number is set whole on one line, so a string that reads as one but runs wider than this is read as words, and wraps. */
const NUMBER_MOST = 261;
/** In the opened table a column is at least as wide as its widest early cell, up to this, so its words are not set one to a line. */
const OPENED = { rows: 20, most: 220, text: 15 };

export const isNumber = (cell) => NUMERAL.test(cell) && textWidth(cell) + 1 <= NUMBER_MOST;

/** A column holds numbers when every cell of it that says something is a number. Its numbers are set to the right. */
function numeric(rows, column) {
  const said = rows.map((row) => row[column] ?? '').filter((cell) => cell !== '');
  return said.length > 0 && said.every(isNumber);
}

const grid = (props) => ({
  heads: list(props.heads).map((head) => text(head).trim()),
  rows: list(props.rows).map((row) => list(row).map((cell) => text(cell).trim())),
});

/**
 * The heads as the item writes them, joined by a middle dot for as many as stand whole on one meta line of a column `column` px
 * wide, and how many are left after them as "+N" on the same line. The first head is always there, on lines of its own when it
 * is longer than one.
 */
export function headsLine(heads, column = COLUMN) {
  const said = heads.filter(Boolean);
  const line = (count) => `${said.slice(0, count).join(' · ')}${count < said.length ? ` +${said.length - count}` : ''}`;
  let count = said.length;
  while (count > 1 && linesOf(line(count), column, 'meta') > 1) count -= 1;
  return said.length > 0 ? line(count) : '';
}

/**
 * A designed preview, because no cell of a table reads at the face's sizes: the title, the lines the item writes over the table,
 * the heads in meta, and the cue, which counts the rows the opened card shows.
 */
function face(item, props) {
  const words = wordsOf(item);
  const { heads, rows } = grid(props);
  const named = headsLine(heads);
  return lay([
    titleRow(item),
    ...aboveRows(props),
    named && { words: named, measure: 'meta', most: 2, gap: GAP, draw: wordsIn('table-heads') },
    rows.length > 0 && { tall: 4, draw: () => null },
  ], { words, more: rows.length > 0, cue: () => (rows.length > 0 ? words.cue.rows(rows.length) : '') });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

/**
 * Every row and column, with heads that stay in place and wrap on whole words. The view scrolls
 * both ways inside its own box, and each column is given the width of its widest early cell, so a
 * wide table scrolls sideways and its cells are not squeezed to a word a line. A number is never
 * wrapped, so it is never cut.
 */
export function detail(item, props) {
  const { heads, rows } = grid(props);
  const numbers = heads.map((_, i) => numeric(rows, i));
  const least = heads.map((_, i) => Math.min(OPENED.most, Math.max(0, ...rows.slice(0, OPENED.rows).map((row) => Math.ceil((textWidth(row[i] ?? '') * OPENED.text) / 12.5)))));
  const row = (tag, cells) => h('tr', null, heads.map((_, i) => {
    const words = cells[i] ?? '';
    const number = tag === 'td' && isNumber(words);
    return h(tag, { class: `${numbers[i] ? 'is-right' : ''}${number ? ' is-number' : ''}` || false, dir: number ? false : 'auto', text: words, style: tag === 'th' ? { minWidth: `${least[i] + 24}px` } : null });
  }));
  return [
    h('div', { class: 'detail-table', tabindex: 0 },
      h('table', null, h('thead', null, row('th', heads)), h('tbody', null, rows.map((cells) => row('td', cells))))),
  ];
}
