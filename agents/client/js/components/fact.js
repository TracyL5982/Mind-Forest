import { h, clamp } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, fold, say, span, text, textWidth, up } from './shared.js';

const NARROW = 200;
const WIDE = 320;
const COLUMN = WIDE - SIDES;
const RULE = 10;
/**
 * The sizes a value can be set in, largest first: the class that sets it, its line height in px,
 * one letter in tenths of a px, and one digit in hundredths of a px. A letter here is the widest
 * any one character runs, because a figure cut short would mislead. Digits are all one width, so
 * each is counted at exactly that.
 */
const STEPS = [['', 36, 210, 2148], ['is-mid', 28, 149, 1506], ['is-small', 21, 105, 1001]];
const DIGIT = 11;

/** A value's width on one line in hundredths of a px. */
const need = (value, letter, digit) => span(value, letter) * letter - (value.match(/[0-9]/g)?.length ?? 0) * (DIGIT * letter - digit);

/**
 * A value takes the largest size that holds it on one line. Past the smallest, it wraps to two.
 * It is drawn whole whatever the estimate: a value wider than it was counted wraps, and is never
 * clamped or ended with an ellipsis.
 */
function plan(item, props) {
  const value = text(props.value) || '–';
  const label = text(props.label);
  const fits = STEPS.find((step) => need(value, step[2], step[3]) <= COLUMN * 100);
  const [cls, lead, letter, digit] = fits ?? STEPS.at(-1);
  const lines = fits ? 1 : fold(value, COLUMN, letter, 2);
  const valueWidth = lines > 1 ? COLUMN : up(need(value, letter, digit), 100);
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
  const { value, label, cls, labelLines, foot } = plan(item, props);
  return [
    say('div', cls ? `fact-value ${cls}` : 'fact-value', value),
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
