import { h } from '../dom.js';
import { FRAME, TEXT, TITLE, fold, text } from './shared.js';

const WIDTH = 288;
const MARK = 22;
/** The serif italic runs narrower than the titles of other cards. */
const LETTER = 8.3;

const lines = (item, props) => fold(words(item, props), WIDTH - 41, LETTER, 5);

const words = (item, props) => text(props.text) || item.text || item.title || '';
const by = (props) => text(props.by) && h('div', { class: 'quote-by' }, h('span', { class: 'clamp-1', text: props.by }));

export const size = (item, props) => [WIDTH, FRAME + MARK + lines(item, props) * TITLE + (text(props.by) ? 8 + TEXT : 0)];

export const draw = (item, props) => [
  h('div', { class: 'quote-mark', text: '“', 'aria-hidden': 'true' }),
  h('blockquote', { class: `quote-text clamp-${lines(item, props)}`, text: words(item, props) }),
  by(props),
];

export const detail = (item, props) => [
  h('blockquote', { class: 'detail-quote', text: text(props.text) }),
  by(props),
];
