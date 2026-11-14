import { h, s } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, andMore, kind, list, say, text, wrap, titleOf } from './shared.js';
import { wordsOf } from '../words.js';

const WIDTH = 320;
const COLUMN = WIDTH - SIDES;
/** The room between the two sides, with the rule that parts them. */
const BETWEEN = 17;
/** A plus or a minus and the gap after it. */
const MARK = 16;
const SIDE = (COLUMN - BETWEEN) / 2 - MARK;
const SHOWN = 4;
const GAP = 5;
/** The line that names a side, and the gap under it. */
const HEAD = TEXT + 4;
const SIDES_OF = [['pros', 'M5 1.5v7M1.5 5h7'], ['cons', 'M1.5 5h7']];

function plan(item, props) {
  const sides = SIDES_OF.map(([key, glyph]) => {
    const points = list(props[key]).map((point) => text(point).trim()).filter(Boolean);
    const rows = points.slice(0, SHOWN).map((point) => wrap(point, SIDE, TEXT_LETTER, 3));
    const rest = points.length - rows.length;
    return { key, label: wordsOf(item)[key], glyph, points, rows, rest, height: HEAD + rows.reduce((sum, lines) => sum + lines * TEXT, 0) + Math.max(0, rows.length - 1) * GAP + (rest ? GAP + TEXT : 0) };
  });
  return { sides, titleLines: wrap(titleOf(item), COLUMN, TITLE_LETTER, 2) };
}

export const shows = [];

export function size(item, props) {
  const { sides, titleLines } = plan(item, props);
  return [WIDTH, FRAME + titleLines * TITLE + 10 + Math.max(...sides.map((side) => side.height))];
}

const mark = (key, glyph) => s('svg', { class: `proscons-mark is-${key}`, viewBox: '0 0 10 10', width: 10, height: 10, 'aria-hidden': 'true' }, s('path', { d: glyph }));
const point = (side, words, clamped) => h('li', null, mark(side.key, side.glyph), say('span', clamped, words));
const side = (of, rows, rest, item) => h('div', { class: `proscons-side is-${of.key}` },
  kind(of.label),
  h('ul', null, rows),
  rest > 0 && andMore(rest, item));

export function draw(item, props) {
  const { sides, titleLines } = plan(item, props);
  return [
    say('div', `card-title clamp-${titleLines}`, titleOf(item)),
    h('div', { class: 'proscons' }, sides.map((of) => side(of, of.rows.map((lines, i) => point(of, of.points[i], `clamp-${lines}`)), of.rest, item))),
  ];
}

export function detail(item, props) {
  const { sides } = plan(item, props);
  return [h('div', { class: 'detail-proscons' }, sides.map((of) => side(of, of.points.map((words) => point(of, words, '')), 0, item)))];
}
