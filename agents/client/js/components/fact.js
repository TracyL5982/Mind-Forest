import { h, clamp } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, fold, say, span, text, textWidth, up } from './shared.js';

const NARROW = 200;
const WIDE = 320;
const COLUMN = WIDE - SIDES;
const RULE = 10;
/**
 * The sizes a value can be set in, largest first: the class that sets it, its line height in px,
 * and one letter in tenths of a px. A letter here is the widest any one character runs, because a
 * figure cut short would mislead.
 */
const STEPS = [['', 36, 210], ['is-mid', 28, 149], ['is-small', 21, 99]];

/** A value takes the largest size that holds it on one line. Past the smallest, it wraps to two. */
function plan(item, props) {
  const value = text(props.value) || '–';
  const label = text(props.label);
  const [cls, lead, letter] = STEPS.find((step) => span(value) * step[2] <= COLUMN * 100) ?? STEPS.at(-1);
  const lines = fold(value, COLUMN, letter, 2);
  const valueWidth = lines > 1 ? COLUMN : up(span(value) * letter, 100);
  const width = clamp(SIDES + Math.max(valueWidth, textWidth(label)), NARROW, WIDE);
  return {
    value, label, width, cls, lines,
    valueHeight: lines * lead,
    labelLines: label ? fold(label, width - SIDES, TEXT_LETTER, 2) : 0,
    foot: item.title && item.title !== value && item.title !== label ? item.title : '',
  };
}

export function size(item, props) {
  const { width, valueHeight, labelLines, foot } = plan(item, props);
  return [width, FRAME + valueHeight + RULE + labelLines * TEXT + (foot ? 8 + TEXT : 0)];
}

export function draw(item, props) {
  const { value, label, cls, lines, labelLines, foot } = plan(item, props);
  return [
    say('div', `fact-value ${cls} clamp-${lines}`, value),
    h('div', { class: 'fact-rule' }),
    label && say('div', `fact-label clamp-${labelLines}`, label),
    foot && say('div', 'card-foot clamp-1', foot),
  ];
}

export const detail = (item, props) => [
  h('div', { class: 'detail-fact' },
    say('div', 'fact-value', text(props.value)),
    h('div', { class: 'fact-rule' }),
    say('div', 'fact-label', text(props.label))),
];
