import { h } from '../dom.js';
import { COLUMN, WIDTH, drawFace, kind, lay, list, say, text, titleRow } from './shared.js';
import { wordsOf } from '../words.js';

/** A bubble is at most 86 percent of the column, less its own padding of 10 px a side. */
const BUBBLE = Math.floor((COLUMN * 86) / 100) - 20;
/** A bubble's padding above and below its lines. */
const PAD = 12;

const bubble = (message, words) => h('div', { class: `bubble ${message.role === 'user' ? 'is-user' : ''}` }, say('div', '', words));

const source = (props) => text(props.source) && h('div', { class: 'chat-source' }, kind(props.source));

/** The title, then each message whole in its bubble on up to two lines, as many as the face has room for. The cue counts the rest. */
function face(item, props) {
  const words = wordsOf(item);
  return lay([
    titleRow(item),
    ...list(props.messages).map((message, i) => ({
      words: text(message.text), column: BUBBLE, most: 2, pad: PAD, unit: true, gap: i === 0 ? 8 : 6,
      draw: (row) => bubble(message, row.words),
    })),
  ], { words, cue: (left) => (left > 0 ? words.cue.left(left) : '') });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

export const detail = (item, props) => [
  h('div', { class: 'detail-chat' }, list(item.data?.messages ?? props.messages).slice(0, 40).map((message) => bubble(message, text(message.text))),
    source(props)),
];
