import { h } from '../dom.js';
import { text, title } from './shared.js';

export const size = () => [232, 126];

export const draw = (item, props) => [
  title(item),
  text(props.emphasis) && h('div', { class: 'note-emphasis clamp-1', text: props.emphasis }),
  (item.summary || item.text) !== item.title && h('div', { class: `card-text ${text(props.emphasis) ? 'clamp-2' : 'clamp-3'}`, text: item.summary || item.text }),
];

export const detail = () => [];
