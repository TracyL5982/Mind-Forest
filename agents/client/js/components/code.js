import { h } from '../dom.js';
import { GAP, WIDTH, drawFace, lay, text, titleRow, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The Renderer sends `text` when it does not know the language, and that names nothing. */
const language = (props) => (text(props.language) && props.language !== 'text' ? props.language : '');

/** A line of source at 16 px holds about 18 characters, so the face says how long the code is and in what, and shows none of it. */
function face(item, props) {
  const words = wordsOf(item);
  return lay([
    titleRow(item),
    { words: words.cue.lines(text(props.source).split('\n').length, language(props)), measure: 'meta', gap: GAP, draw: wordsIn('card-foot') },
  ], { words });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

export const detail = (item, props) => [
  h('pre', { class: 'code-source is-full', text: text(props.source) }),
];
