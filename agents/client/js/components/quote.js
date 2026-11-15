import { h } from '../dom.js';
import { WIDTH, aboveRows, drawFace, lay, say, text, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The quote's wider side padding and the border, and 1 px to spare. */
const COLUMN = WIDTH - 41;
/** The quotation mark over the words, and the gap under it. */
const MARK = 22;
/** The dash before the speaker, and the gap after it. */
const DASH = 22;

const words = (item, props) => text(props.text) || item.text || item.title || '';
const mark = () => h('div', { class: 'quote-mark', text: '“', 'aria-hidden': 'true' });
const by = (said) => said && h('div', { class: 'quote-by' }, say('span', '', said));

/** The lines the item writes over it, the mark, the quotation upright in the serif, and the speaker, which the face keeps. */
function face(item, props) {
  const above = aboveRows(props, { column: COLUMN, gap: 0 });
  return lay([
    ...above,
    { tall: MARK, gap: above.length > 0 ? 6 : 0, draw: mark },
    { words: words(item, props), measure: 'passage', column: COLUMN, draw: wordsIn('quote-text') },
    text(props.by) && { words: text(props.by), measure: 'meta', column: COLUMN - DASH, most: 2, gap: 8, keep: true, draw: (row) => by(row.words) },
  ], { words: wordsOf(item) });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

export const detail = (item, props) => [
  h('div', { class: 'detail-quote' },
    mark(),
    say('blockquote', 'quote-text', words(item, props)),
    by(text(props.by))),
];
