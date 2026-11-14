import { h, clamp } from '../dom.js';
import { FIGURES, FRAME, SIDES, TEXT, TEXT_LETTER, figureNeed, fold, say, text, textWidth, up } from './shared.js';

const NARROW = 200;
const WIDE = 320;
const COLUMN = WIDE - SIDES;
const RULE = 10;
/** The most lines a value is sized for, so a paragraph filed as a value cannot make a tower. */
const MOST_LINES = 8;

/**
 * A value takes the largest size that holds it on one line. Past the smallest, it wraps and the
 * card grows with it, up to `MOST_LINES`. It is drawn whole whatever the estimate: a value wider
 * than it was counted wraps, and is never clamped or ended with an ellipsis.
 */
function plan(item, props) {
  const value = text(props.value) || '–';
  const label = text(props.label);
  const step = FIGURES.find((size) => figureNeed(value, size) <= COLUMN * 100);
  const [cls, lead, letter] = step ?? FIGURES.at(-1);
  const lines = step ? 1 : fold(value, COLUMN, letter, MOST_LINES);
  const valueWidth = lines > 1 ? COLUMN : up(figureNeed(value, step), 100);
  const width = clamp(SIDES + Math.max(valueWidth, textWidth(label)), NARROW, WIDE);
  return {
    value, label, width, cls, lines,
    valueHeight: lines * lead,
    labelLines: label ? fold(label, width - SIDES, TEXT_LETTER, 2) : 0,
    foot: item.title && item.title !== value && item.title !== label ? item.title : '',
  };
}

export const shows = [];

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
