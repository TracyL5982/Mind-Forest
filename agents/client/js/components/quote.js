import { h } from '../dom.js';
import { FRAME, QUOTE_LETTER, TEXT, TITLE, aboveOf, drawAbove, fold, say, text } from './shared.js';

const WIDTH = 288;
/** The quote's wider side padding and the border, and 1 px to spare. */
const COLUMN = WIDTH - 41;
const MARK = 22;

const words = (item, props) => text(props.text) || item.text || item.title || '';
const lines = (item, props) => fold(words(item, props), COLUMN, QUOTE_LETTER, 5);
const mark = () => h('div', { class: 'quote-mark', text: '“', 'aria-hidden': 'true' });
const by = (props, clamped) => text(props.by) && h('div', { class: 'quote-by' }, say('span', clamped, props.by));

export const shows = [];

export const size = (item, props) => [WIDTH, FRAME + aboveOf(props, COLUMN).height + MARK + lines(item, props) * TITLE + (text(props.by) ? 8 + TEXT : 0)];

export const draw = (item, props) => [
  drawAbove(aboveOf(props, COLUMN)),
  mark(),
  say('blockquote', `quote-text clamp-${lines(item, props)}`, words(item, props)),
  by(props, 'clamp-1'),
];

export const detail = (item, props) => [
  h('div', { class: 'detail-quote' },
    mark(),
    say('blockquote', 'quote-text', words(item, props)),
    by(props, '')),
];
