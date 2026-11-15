import { h, s } from '../dom.js';
import { GAP, WIDTH, aboveRows, drawFace, lay, list, say, text, titleRow } from './shared.js';
import { wordsOf } from '../words.js';

const SIDE_LINES = 2;
/** A head that ends in a stop set with Han runs into its point with no space, as Chinese is written. */
const WIDE_STOP = /[　-〿＀-￯]$/u;

/**
 * Each side under the heading or label its item gives it. A side has a dot before each point and no sign of its own, so the card
 * says nothing of a side that its item does not. A view with no heads names its sides in the card's own words.
 */
function plan(item, props) {
  const heads = list(props.heads).map((head) => text(head).trim());
  return ['pros', 'cons'].map((key, n) => ({
    key,
    head: heads[n] || wordsOf(item)[key],
    points: list(props[key]).map((point) => text(point).trim()).filter(Boolean),
  }));
}

/**
 * A designed preview: the title, the lines the item writes over the sides, then each side as one row of words on up to two lines,
 * its head in the title's weight running into its first point, counted in the title's weight throughout. The cue counts each side's points, in the card's words.
 */
function face(item, props) {
  const words = wordsOf(item);
  const sides = plan(item, props);
  const shown = sides.filter((side) => side.points.length > 0);
  const lead = (side) => `${side.head}${WIDE_STOP.test(side.head) ? '' : ' '}`;
  return lay([
    titleRow(item),
    ...aboveRows(props),
    ...shown.map((side, i) => ({
      words: `${lead(side)}${side.points[0]}`, measure: 'head', most: SIDE_LINES, gap: i === 0 ? GAP : 0,
      draw: (row) => h('div', { class: 'proscons-line', dir: 'auto' }, say('span', 'proscons-head', row.words.slice(0, lead(side).length)), row.words.slice(lead(side).length)),
    })),
  ], { words, more: sides.some((side) => side.points.length > 1), cue: () => words.cue.sides(sides[0].points.length, sides[1].points.length) });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

const dot = () => s('svg', { class: 'proscons-mark', viewBox: '0 0 10 10', width: 10, height: 10, 'aria-hidden': 'true' }, s('circle', { cx: 5, cy: 5, r: 2 }));

export const detail = (item, props) => [h('div', { class: 'detail-proscons' }, plan(item, props).map((side) => h('div', { class: `proscons-side is-${side.key}` },
  say('div', 'proscons-head', side.head),
  h('ul', null, side.points.map((words) => h('li', null, dot(), say('span', '', words)))))))];
