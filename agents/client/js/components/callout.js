import { h, s } from '../dom.js';
import { COLUMN, GAP, META, WIDTH, aboveRows, drawFace, kind, lay, text, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The band down the left edge takes this much of the column. */
const BAND = 6;
const TONE = {
  caution: { glyph: 'M7 1.6 13 12.2H1ZM7 5.6v3.2M7 10.4v.2' },
  note: { glyph: 'M7 1.2a5.8 5.8 0 1 0 0 11.6a5.8 5.8 0 1 0 0-11.6M7 6.2v3.6M7 4.1v.2' },
};

function plan(props) {
  return { words: text(props.text).trim(), tone: Object.hasOwn(TONE, props.tone) ? props.tone : 'note' };
}

/** The lines the item writes over it, its tone named in meta, then its words at the title's size. */
function face(item, props) {
  const { words, tone } = plan(props);
  const above = aboveRows(props, { column: COLUMN - BAND, gap: 0 });
  return lay([
    ...above,
    { tall: META, gap: above.length > 0 ? GAP : 0, draw: () => h('div', { class: `callout is-${tone}` }, head(tone, item)) },
    { words, measure: 'title', column: COLUMN - BAND, gap: GAP, draw: wordsIn('callout-text') },
  ], { words: wordsOf(item) });
}

export function size(item, props) {
  return [WIDTH, face(item, props).height];
}

const head = (tone, item) => h('div', { class: 'callout-head' },
  s('svg', { class: 'callout-glyph', viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' }, s('path', { d: TONE[tone].glyph })),
  kind(wordsOf(item)[tone]));

export const draw = (item, props) => drawFace(face(item, props));

export function detail(item, props) {
  const { words, tone } = plan(props);
  return [h('div', { class: `detail-callout callout is-${tone}` }, head(tone, item), h('div', { class: 'callout-text', dir: 'auto', text: words }))];
}
