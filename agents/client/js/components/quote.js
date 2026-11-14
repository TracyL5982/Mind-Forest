import { h } from '../dom.js';
import { text } from './shared.js';

export const size = () => [276, 156];

export const draw = (item, props) => [
  h('div', { class: 'quote-mark', text: '“', 'aria-hidden': 'true' }),
  h('blockquote', { class: 'quote-text clamp-4', text: text(props.text) || item.text || item.title }),
  text(props.by) && h('div', { class: 'quote-by clamp-1', text: `— ${props.by}` }),
];

export const detail = (item, props) => [
  h('blockquote', { class: 'detail-quote', text: text(props.text) }),
  text(props.by) && h('div', { class: 'quote-by', text: `— ${props.by}` }),
];
