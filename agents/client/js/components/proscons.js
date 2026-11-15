import { h, s } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, aboveOf, andMore, drawAbove, list, say, text, wrap, titleOf } from './shared.js';
import { wordsOf } from '../words.js';

const WIDTH = 320;
const COLUMN = WIDTH - SIDES;
/** The room between the two sides, with the rule that parts them. */
const BETWEEN = 17;
/** A dot and the gap after it. */
const MARK = 16;
const HALF = (COLUMN - BETWEEN) / 2;
const SIDE = HALF - MARK;
const SHOWN = 4;
const GAP = 5;
/** The most lines a side's heading is given, and the gap under it. */
const HEAD_LINES = 4;
const UNDER = 4;

/**
 * Each side under the heading or label its item gives it, set in the title's weight at the text size and counted as the lines over a
 * card are. A side has a dot before each point and no sign of its own, so the card says nothing of a side that its item does not.
 * A view with no heads names its sides in the card's own words.
 */
function plan(item, props) {
  const heads = list(props.heads).map((head) => text(head).trim());
  const sides = ['pros', 'cons'].map((key, n) => {
    const head = heads[n] || wordsOf(item)[key];
    const headLines = wrap(head, Math.floor((HALF * 32) / 25), TITLE_LETTER, HEAD_LINES);
    const points = list(props[key]).map((point) => text(point).trim()).filter(Boolean);
    const rows = points.slice(0, SHOWN).map((point) => wrap(point, SIDE, TEXT_LETTER, 3));
    const rest = points.length - rows.length;
    return { key, head, headLines, points, rows, rest, height: headLines * TEXT + UNDER + rows.reduce((sum, lines) => sum + lines * TEXT, 0) + Math.max(0, rows.length - 1) * GAP + (rest ? GAP + TEXT : 0) };
  });
  return { sides, above: aboveOf(props, COLUMN), titleLines: wrap(titleOf(item), COLUMN, TITLE_LETTER, 2) };
}

export const shows = [];

export function size(item, props) {
  const { sides, above, titleLines } = plan(item, props);
  return [WIDTH, FRAME + titleLines * TITLE + above.height + 10 + Math.max(...sides.map((side) => side.height))];
}

const dot = () => s('svg', { class: 'proscons-mark', viewBox: '0 0 10 10', width: 10, height: 10, 'aria-hidden': 'true' }, s('circle', { cx: 5, cy: 5, r: 2 }));
const point = (words, clamped) => h('li', null, dot(), say('span', clamped, words));
const side = (of, rows, rest, item, clamped) => h('div', { class: `proscons-side is-${of.key}` },
  say('div', `proscons-head${clamped ? ` clamp-${of.headLines}` : ''}`, of.head),
  h('ul', null, rows),
  rest > 0 && andMore(rest, item));

export function draw(item, props) {
  const { sides, above, titleLines } = plan(item, props);
  return [
    say('div', `card-title clamp-${titleLines}`, titleOf(item)),
    drawAbove(above),
    h('div', { class: 'proscons' }, sides.map((of) => side(of, of.rows.map((lines, i) => point(of.points[i], `clamp-${lines}`)), of.rest, item, true))),
  ];
}

export function detail(item, props) {
  const { sides } = plan(item, props);
  return [h('div', { class: 'detail-proscons' }, sides.map((of) => side(of, of.points.map((words) => point(words, '')), 0, item, false)))];
}
