import { h } from '../dom.js';
import { head, text } from './shared.js';

export const size = () => [296, 166];

export const draw = (item, props) => [
  head(item, text(props.language) || 'text'),
  h('pre', { class: 'code-source', text: text(props.source).split('\n').slice(0, 7).join('\n') }),
];

export const detail = (item, props) => [
  h('pre', { class: 'code-source is-full', text: text(props.source) }),
];
