import { h } from '../dom.js';
import { COLUMN, FIGURES, GAP, WIDTH, aboveRows, drawFace, headsRow, lay, say, text, wordsIn } from './shared.js';
import { figureIn, figureRows } from './facts.js';
import { wordsOf } from '../words.js';

/**
 * The lines the item writes over its figure, then the value at the largest size that holds it on one line, 34, 24 or 18 px, and
 * past that on whole lines at 18 px, underlined once; its label on up to two lines; and the item's title under them in meta. The
 * value is never cut, because a cut number misleads: it is drawn whole or, when the lines over it leave no room, not at all. A
 * fact from a table under a heads row is set as a facts card sets such a row, its label under the first head and its value
 * under the second.
 */
function face(item, props) {
  const value = text(props.value).trim() || '–';
  const label = text(props.label).trim();
  const above = aboveRows(props, { gap: 0 });
  const heads = headsRow(props, { gap: above.length > 0 ? GAP : 0 });
  const gap = above.length > 0 || heads ? GAP : 0;
  const shown = figureIn(value, COLUMN, FIGURES);
  const title = text(item.title).trim();
  return lay([
    ...above,
    heads,
    ...(heads ? figureRows([{ label, value }], { headed: true, gap }) : [
      { tall: shown.height, whole: shown.whole, gap, draw: () => say('div', `fact-value ${shown.cls}`.trim(), shown.words) },
      { tall: 2, gap: 1, draw: () => h('div', { class: 'fact-rule' }) },
      label && { words: label, measure: 'body', most: 2, gap: 1, draw: wordsIn('fact-label') },
    ]),
    title && title !== value && title !== label && { words: title, measure: 'meta', most: 2, gap: 8, draw: wordsIn('fact-foot') },
  ], { words: wordsOf(item) });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

export const detail = (item, props) => [
  h('div', { class: 'detail-fact' },
    say('div', 'fact-value', text(props.value)),
    h('div', { class: 'fact-rule' }),
    say('div', 'fact-label', text(props.label))),
];
