import { h, clamp } from '../dom.js';
import { head, list, text } from './shared.js';

const bubble = (message, lines) => h('div', { class: `bubble ${lines} ${message.role === 'user' ? 'is-user' : ''}`, text: text(message.text) });

export const size = (item, props) => [276, 49 + 53 * clamp(list(props.messages).length, 1, 3)];

export const draw = (item, props) => [
  head(item, text(props.source)),
  list(props.messages).slice(0, 3).map((message) => bubble(message, 'clamp-2')),
];

export const detail = (item, props) => [
  h('div', { class: 'detail-chat' }, list(item.data?.messages ?? props.messages).slice(0, 40).map((message) => bubble(message, ''))),
];
