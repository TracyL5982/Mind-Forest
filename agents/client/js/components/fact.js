import { h, clamp } from '../dom.js';
import { DISPLAY, FRAME, TEXT, TEXT_LETTER, fold, span, text } from './shared.js';

const RULE = 10;

function plan(item, props) {
  const value = text(props.value) || '–';
  const label = text(props.label);
  const width = clamp(Math.ceil(33 + span(value) * 20), 200, 320);
  return {
    value,
    label,
    width,
    labelLines: label ? fold(label, width - 33, TEXT_LETTER, 2) : 0,
    foot: item.title && item.title !== value && item.title !== label ? item.title : '',
  };
}

export function size(item, props) {
  const { width, labelLines, foot } = plan(item, props);
  return [width, FRAME + DISPLAY + RULE + labelLines * TEXT + (foot ? 8 + TEXT : 0)];
}

export function draw(item, props) {
  const { value, label, labelLines, foot } = plan(item, props);
  return [
    h('div', { class: 'fact-value', text: value }),
    h('div', { class: 'fact-rule' }),
    label && h('div', { class: `fact-label clamp-${labelLines}`, text: label }),
    foot && h('div', { class: 'card-foot clamp-1', text: foot }),
  ];
}

export const detail = (item, props) => [
  h('div', { class: 'detail-fact' },
    h('span', { class: 'fact-value', text: text(props.value) }),
    h('span', { class: 'fact-label', text: text(props.label) })),
];
