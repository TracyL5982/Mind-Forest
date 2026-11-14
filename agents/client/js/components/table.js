import { h, clamp } from '../dom.js';
import { FRAME, SIDES, TEXT, TITLE, TITLE_LETTER, graphemes, list, say, spread, text, textWidth, wrap } from './shared.js';

const NARROW = 200;
const WIDE = 360;
const ROOM = WIDE - SIDES;
const BETWEEN = 14;
const MOST_COLUMNS = 5;
const MOST_ROWS = 6;
const ROW = 24;
/** What a column of words is left with at least, when the columns are counted. */
const WORDS_FLOOR = 44;
/** A number is short. Anything longer or wider than this is read as words, and may be cut. */
const NUMBER = { characters: 14, px: 120 };
const NUMERAL = /^[-+−–~≈<>≤≥±]?\s?\p{Sc}?\s?\d[\d.,:/\s]*\s?[\p{L}\p{Sc}%°‰µ²³]{0,5}$/u;

const isNumber = (cell) => graphemes(cell).length <= NUMBER.characters && NUMERAL.test(cell) && textWidth(cell) <= NUMBER.px;

/** A column holds numbers when every cell of it that says something is a number. */
function numeric(rows, column) {
  const said = rows.map((row) => row[column]).filter((cell) => cell !== '');
  return said.length > 0 && said.every(isNumber);
}

const grid = (props) => ({
  heads: list(props.heads).map((head) => text(head).trim()),
  rows: list(props.rows).map((row) => list(row).map((cell) => text(cell).trim())),
});

/**
 * The first rows and columns, as many as fit. A column of numbers is as wide as its widest number,
 * so no number is cut, and the columns of words share what is left. Columns are dropped from the
 * end until every column of words can have `WORDS_FLOOR` px or all it needs.
 */
function plan(item, props) {
  const { heads, rows } = grid(props);
  const shown = rows.slice(0, MOST_ROWS);
  const columns = heads.map((head, i) => {
    const cells = Math.max(0, ...shown.map((row) => textWidth(row[i] ?? '')));
    const number = numeric(shown, i);
    return { number, floor: number ? cells : 0, want: Math.max(textWidth(head), cells) };
  });
  const least = (count) => columns.slice(0, count).reduce((sum, column) => sum + (column.number ? column.floor : Math.min(column.want, WORDS_FLOOR)), BETWEEN * (count - 1));
  let count = Math.min(columns.length, MOST_COLUMNS);
  while (count > 2 && least(count) > ROOM) count -= 1;
  const kept = columns.slice(0, count);
  const floors = kept.reduce((sum, column) => sum + column.floor, 0);
  const extra = spread(kept.map((column) => column.want - column.floor), ROOM - BETWEEN * (count - 1) - floors);
  const widths = kept.map((column, i) => column.floor + extra[i]);
  const width = clamp(SIDES + widths.reduce((sum, wide) => sum + wide, BETWEEN * (count - 1)), NARROW, WIDE);
  const [moreRows, moreColumns] = [rows.length - shown.length, heads.length - count];
  const counted = (n, one) => `${n} more ${one}${n === 1 ? '' : 's'}`;
  return {
    heads: heads.slice(0, count),
    rows: shown.map((row) => row.slice(0, count)),
    numbers: kept.map((column) => column.number),
    widths, width,
    titleLines: wrap(item.title || 'Untitled', width - SIDES, TITLE_LETTER, 2),
    foot: [moreRows > 0 && counted(moreRows, 'row'), moreColumns > 0 && counted(moreColumns, 'column')].filter(Boolean).join(', '),
  };
}

export const shows = [];

export function size(item, props) {
  const { rows, width, titleLines, foot } = plan(item, props);
  return [width, FRAME + titleLines * TITLE + 8 + ROW * (1 + rows.length) + (foot ? 8 + TEXT : 0)];
}

const cell = (words, number, head) => h('div', { class: `table-cell${number ? ' is-number' : ''}${head ? ' is-head' : ''}`, dir: number ? false : 'auto', text: words });

export function draw(item, props) {
  const { heads, rows, numbers, widths, titleLines, foot } = plan(item, props);
  return [
    say('div', `card-title clamp-${titleLines}`, item.title || 'Untitled'),
    h('div', { class: 'table', role: 'table', style: { gridTemplateColumns: widths.map((wide) => `${wide}px`).join(' ') } },
      heads.map((head, i) => cell(head, numbers[i], true)),
      rows.map((row) => row.map((words, i) => cell(words ?? '', numbers[i], false)))),
    foot && h('div', { class: 'card-foot', text: `and ${foot}` }),
  ];
}

/** Every row and column. The view scrolls both ways, under heads that stay in place. */
export function detail(item, props) {
  const { heads, rows } = grid(props);
  const numbers = heads.map((_, i) => numeric(rows, i));
  const row = (tag, cells) => h('tr', null, heads.map((_, i) => h(tag, { class: numbers[i] ? 'is-number' : false, dir: numbers[i] ? false : 'auto', text: cells[i] ?? '' })));
  return [
    h('div', { class: 'detail-table', tabindex: 0 },
      h('table', null, h('thead', null, row('th', heads)), h('tbody', null, rows.map((cells) => row('td', cells))))),
  ];
}
