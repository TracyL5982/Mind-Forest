import { h } from '../dom.js';
import { COLUMN, GAP, WIDTH, aboveRows, drawFace, lay, list, say, text, titleRow } from './shared.js';
import { wordsOf } from '../words.js';

/** A step's number, round, and the gap after it. */
const NUMBER = 32;
const STEP_LINES = 2;

const step = (label, i, tag, cls) => h(tag, { class: cls }, h('span', { class: 'step-n', text: String(i + 1) }), say('span', '', label));

/**
 * The title, the lines the item writes over its steps, then each step whole on up to two lines beside its number, as many as the
 * face has room for. The cue counts the steps left out.
 */
function face(item, props) {
  const words = wordsOf(item);
  return lay([
    titleRow(item),
    ...aboveRows(props),
    ...list(props.steps).map((label, i) => ({
      words: text(label).trim(), column: COLUMN - NUMBER, most: STEP_LINES, unit: true, gap: i === 0 ? GAP : 8,
      draw: (row) => step(row.words, i, 'div', i > 0 ? 'step is-after' : 'step'),
    })),
  ], { words, cue: (left) => (left > 0 ? words.cue.left(left) : '') });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

export const detail = (item, props) => [
  h('ol', { class: 'steps is-full' }, list(props.steps).map((label, i) => step(String(label), i, 'li', ''))),
];
