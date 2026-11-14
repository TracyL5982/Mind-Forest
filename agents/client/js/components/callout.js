import { h, s } from '../dom.js';
import { FRAME, SIDES, TEXT, TITLE, TITLE_LETTER, kind, say, text, wrap } from './shared.js';
import { wordsOf } from '../words.js';

const WIDTH = 256;
/** The band down the left edge takes this much of the column. */
const BAND = 6;
const COLUMN = WIDTH - SIDES - BAND;
const TONE = {
  caution: { glyph: 'M7 1.6 13 12.2H1ZM7 5.6v3.2M7 10.4v.2' },
  note: { glyph: 'M7 1.2a5.8 5.8 0 1 0 0 11.6a5.8 5.8 0 1 0 0-11.6M7 6.2v3.6M7 4.1v.2' },
};

function plan(item, props) {
  const words = text(props.text).trim();
  return {
    words,
    tone: Object.hasOwn(TONE, props.tone) ? props.tone : 'note',
    lines: wrap(words, COLUMN, TITLE_LETTER, 5),
    foot: item.title && item.title !== words ? item.title : '',
  };
}

export const shows = [];

export function size(item, props) {
  const { lines, foot } = plan(item, props);
  return [WIDTH, FRAME + TEXT + 6 + lines * TITLE + (foot ? 8 + TEXT : 0)];
}

const head = (tone, item) => h('div', { class: 'callout-head' },
  s('svg', { class: 'callout-glyph', viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' }, s('path', { d: TONE[tone].glyph })),
  kind(wordsOf(item)[tone]));

export function draw(item, props) {
  const { words, tone, lines, foot } = plan(item, props);
  return [
    h('div', { class: `callout is-${tone}` }, head(tone, item), say('div', `callout-text clamp-${lines}`, words)),
    foot && say('div', 'card-foot clamp-1', foot),
  ];
}

export function detail(item, props) {
  const { words, tone } = plan(item, props);
  return [h('div', { class: `detail-callout callout is-${tone}` }, head(tone, item), say('div', 'callout-text', words))];
}
