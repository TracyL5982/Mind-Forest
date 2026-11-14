import { h } from '../dom.js';
import { text } from './shared.js';

export const size = () => [196, 130];

export const draw = (item, props) => [
  h('div', { class: 'fact-value', text: text(props.value) || '–' }),
  h('div', { class: 'fact-label clamp-2', text: text(props.label) }),
  h('div', { class: 'card-foot clamp-1', text: item.title }),
];

export const detail = (item, props) => [
  h('div', { class: 'detail-fact' },
    h('span', { class: 'fact-value', text: text(props.value) }),
    h('span', { class: 'fact-label', text: text(props.label) })),
];
