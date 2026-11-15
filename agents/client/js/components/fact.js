import { h, clamp } from '../dom.js';
import { FIGURES, FRAME, SIDES, TEXT, TEXT_LETTER, aboveOf, aboveWidth, drawAbove, drawHeads, figureNeed, fold, headsOf, say, text, textWidth, up } from './shared.js';
import { figures, grid } from './facts.js';

const NARROW = 200;
const WIDE = 320;
const COLUMN = WIDE - SIDES;
const RULE = 10;
/** The most lines a value is sized for, so a paragraph filed as a value cannot make a tower. */
const MOST_LINES = 8;

/**
 * A value takes the largest size that holds it on one line. Past the smallest, it wraps and the
 * card grows with it, up to `MOST_LINES`. It is drawn whole whatever the estimate: a value wider
 * than it was counted wraps, and is never clamped or ended with an ellipsis. The card is as wide as
 * its value, its label and the lines over them need. A fact from a table under a heads row is set
 * as a facts card sets such a row, its label under the first head and its value under the second.
 */
function plan(item, props) {
  const value = text(props.value) || '–';
  const label = text(props.label);
  const step = FIGURES.find((size) => figureNeed(value, size) <= COLUMN * 100);
  const [cls, lead, letter] = step ?? FIGURES.at(-1);
  const lines = step ? 1 : fold(value, COLUMN, letter, MOST_LINES);
  const valueWidth = lines > 1 ? COLUMN : up(figureNeed(value, step), 100);
  const heads = headsOf(props, COLUMN);
  const width = heads.heads.length > 0 ? WIDE : clamp(SIDES + Math.max(valueWidth, textWidth(label), aboveWidth(props)), NARROW, WIDE);
  return {
    value, label, width, cls, lines, heads,
    above: aboveOf(props, width - SIDES),
    headed: heads.heads.length > 0 ? grid([{ label: label.trim(), value: value.trim() }], true) : null,
    valueHeight: lines * lead,
    labelLines: label ? fold(label, width - SIDES, TEXT_LETTER, 2) : 0,
    foot: item.title && item.title !== value && item.title !== label ? item.title : '',
  };
}

export const shows = [];

export function size(item, props) {
  const { width, above, heads, headed, valueHeight, labelLines, foot } = plan(item, props);
  const body = headed ? heads.height + headed.height : valueHeight + RULE + labelLines * TEXT;
  return [width, FRAME + above.height + body + (foot ? 8 + TEXT : 0)];
}

export function draw(item, props) {
  const { value, label, cls, above, heads, headed, labelLines, foot } = plan(item, props);
  return [
    drawAbove(above),
    headed ? [drawHeads(heads), figures(headed)] : [
      say('div', cls ? `fact-value ${cls}` : 'fact-value', value),
      h('div', { class: 'fact-rule' }),
      label && say('div', `fact-label clamp-${labelLines}`, label),
    ],
    foot && say('div', 'card-foot clamp-1', foot),
  ];
}

export const detail = (item, props) => [
  h('div', { class: 'detail-fact' },
    say('div', 'fact-value', text(props.value)),
    h('div', { class: 'fact-rule' }),
    say('div', 'fact-label', text(props.label))),
];
