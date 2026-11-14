import { h } from '../dom.js';
import { FRAME, TEXT, TEXT_LETTER, TITLE, fold, head, list, text } from './shared.js';

const WIDTH = 288;
/** A bubble is at most 86 percent of the card's column, less its own padding. */
const COLUMN = Math.floor((WIDTH - 33) * 0.86) - 20;

const bubble = (message, lines) => h('div', { class: `bubble ${message.role === 'user' ? 'is-user' : ''}` },
  h('div', { class: lines ? `clamp-${lines}` : false, text: text(message.text) }));

const shown = (props) => list(props.messages).slice(0, 3);
const linesOf = (message) => fold(text(message.text), COLUMN, TEXT_LETTER, 2);

export function size(item, props) {
  const bubbles = shown(props).map((message) => 12 + linesOf(message) * TEXT);
  return [WIDTH, FRAME + TITLE + bubbles.reduce((sum, tall) => sum + 6 + tall, bubbles.length ? 2 : 0)];
}

export const draw = (item, props) => [
  head(item, text(props.source)),
  shown(props).map((message) => bubble(message, linesOf(message))),
];

export const detail = (item, props) => [
  h('div', { class: 'detail-chat' }, list(item.data?.messages ?? props.messages).slice(0, 40).map((message) => bubble(message, 0))),
];
