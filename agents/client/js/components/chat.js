import { h } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, fold, kind, list, say, text, title } from './shared.js';

const WIDTH = 288;
const SHOWN = 3;
/** A bubble is at most 86 percent of the card's column, less its own padding. */
const COLUMN = Math.floor(((WIDTH - SIDES) * 86) / 100) - 20;

const bubble = (message, lines) => h('div', { class: `bubble ${message.role === 'user' ? 'is-user' : ''}` },
  say('div', lines ? `clamp-${lines}` : '', text(message.text)));

const shown = (props) => list(props.messages).slice(0, SHOWN);
const linesOf = (message) => fold(text(message.text), COLUMN, TEXT_LETTER, 2);

export function size(item, props) {
  const bubbles = shown(props).map((message) => 12 + linesOf(message) * TEXT);
  return [WIDTH, FRAME + TITLE + bubbles.reduce((sum, tall) => sum + 6 + tall, bubbles.length ? 2 : 0) + (text(props.source) ? 6 + TEXT : 0)];
}

export const draw = (item, props) => [
  title(item, 1),
  shown(props).map((message) => bubble(message, linesOf(message))),
  text(props.source) && h('div', { class: 'chat-source' }, kind(props.source)),
];

export const detail = (item, props) => [
  h('div', { class: 'detail-chat' }, list(item.data?.messages ?? props.messages).slice(0, 40).map((message) => bubble(message, 0))),
];
