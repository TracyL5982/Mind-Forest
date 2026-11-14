import { h, clamp } from '../dom.js';
import { FRAME, SIDES, TEXT, TITLE, TITLE_LETTER, list, say, spread, text, textWidth, titleOf, wrap } from './shared.js';
import { wordsOf } from '../words.js';

const NARROW = 200;
const WIDE = 352;
const ROOM = WIDE - SIDES;
const BETWEEN = 14;
const MOST_COLUMNS = 5;
const MOST_ROWS = 6;
const ROW = 24;
/** What a column of words is left with at least, when the columns are counted. */
const WORDS_FLOOR = 44;
/** What the first column is given at least, or all it needs when that is less, because it names each row. */
const FIRST_FLOOR = 120;
/** A number is never cut, so it is no wider than this. Anything wider is read as words. */
const NUMBER_MOST = 160;
const NUMERAL = /^[-+−–~≈<>≤≥±]?\s?\p{Sc}?\s?\d[\d.,:/\s]*\s?[\p{L}\p{Sc}%°‰µ²³]{0,5}$/u;
/** In the opened table a column is at least as wide as its widest early cell, up to this, so its words are not set one to a line. */
const OPENED = { rows: 20, most: 220, text: 13 };

const isNumber = (cell) => NUMERAL.test(cell) && textWidth(cell) <= NUMBER_MOST;

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
 * The first rows and columns, as many as fit. No number is cut, in a column of numbers or beside
 * words: a column is at least as wide as the widest number it shows, and the words share what is
 * left. The first column, which names each row, is at least `FIRST_FLOOR` px wide or as wide as it
 * needs. Columns are dropped from the end until each one that holds words can have `WORDS_FLOOR`
 * px or all it needs, and the card counts the columns it drops as it does the rows. `room` is the
 * column the cells share: a table card's, or a sheet's.
 */
export function plan(item, props, room = ROOM) {
  const { heads, rows } = grid(props);
  const shown = rows.slice(0, MOST_ROWS);
  const columns = heads.map((head, i) => {
    const cells = shown.map((row) => row[i] ?? '');
    const want = Math.max(textWidth(head), ...cells.map(textWidth));
    const numbers = Math.max(0, ...cells.filter(isNumber).map(textWidth));
    const floor = i === 0 ? Math.max(numbers, Math.min(want, FIRST_FLOOR)) : numbers;
    const number = numeric(shown, i);
    return { number, floor, want, least: number ? floor : Math.max(floor, Math.min(want, WORDS_FLOOR)) };
  });
  const least = (count) => columns.slice(0, count).reduce((sum, column) => sum + column.least, BETWEEN * (count - 1));
  let count = Math.min(columns.length, MOST_COLUMNS);
  while (count > 1 && least(count) > room) count -= 1;
  const kept = columns.slice(0, count);
  const floors = kept.reduce((sum, column) => sum + column.floor, 0);
  const extra = spread(kept.map((column) => column.want - column.floor), room - BETWEEN * (count - 1) - floors);
  const widths = kept.map((column, i) => column.floor + extra[i]);
  const width = clamp(SIDES + widths.reduce((sum, wide) => sum + wide, BETWEEN * (count - 1)), NARROW, WIDE);
  const [moreRows, moreColumns] = [rows.length - shown.length, heads.length - count];
  return {
    heads: heads.slice(0, count),
    rows: shown.map((row) => kept.map((_, i) => row[i] ?? '')),
    numbers: kept.map((column) => column.number),
    widths, width,
    titleLines: wrap(titleOf(item), width - SIDES, TITLE_LETTER, 2),
    foot: moreRows > 0 || moreColumns > 0 ? wordsOf(item).moreOf(moreRows, moreColumns) : '',
  };
}

/** How tall the rows `plan` shows stand under their heads, with the line that counts what is left out. */
export const ruledHeight = ({ rows, foot }) => ROW * (1 + rows.length) + (foot ? 8 + TEXT : 0);

export const shows = [];

export function size(item, props) {
  const planned = plan(item, props);
  return [planned.width, FRAME + planned.titleLines * TITLE + 8 + ruledHeight(planned)];
}

/** A cell. A number is drawn whole wherever it stands, and to the right in a column of numbers. */
const cell = (words, right, head) => h('div', { class: `table-cell${right ? ' is-right' : ''}${head ? ' is-head' : isNumber(words) ? ' is-number' : ''}`, dir: !head && isNumber(words) ? false : 'auto', text: words });

/** The heads and the rows `plan` shows, in the columns it gives them. */
export const ruled = ({ heads, rows, numbers, widths }) => h('div', { class: 'table', role: 'table', style: { gridTemplateColumns: widths.map((wide) => `${wide}px`).join(' ') } },
  heads.map((head, i) => cell(head, numbers[i], true)),
  rows.map((row) => row.map((words, i) => cell(words, numbers[i], false))));

export function draw(item, props) {
  const planned = plan(item, props);
  return [
    say('div', `card-title clamp-${planned.titleLines}`, titleOf(item)),
    ruled(planned),
    planned.foot && h('div', { class: 'card-foot', text: planned.foot }),
  ];
}

/**
 * Every row and column, with heads that stay in place and wrap on whole words. The view scrolls
 * both ways inside its own box, and each column is given the width of its widest early cell, so a
 * wide table scrolls sideways and its cells are not squeezed to a word a line.
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
