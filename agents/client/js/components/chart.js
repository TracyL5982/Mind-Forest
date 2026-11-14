import { h } from '../dom.js';
import { FRAME, SIDES, TEXT, TITLE, plot, say, series, text, title } from './shared.js';
import { wordsOf } from '../words.js';

const WIDTH = 300;
const PLOT = 136;

export const shows = [];

export const size = (item, props) => [WIDTH, FRAME + TITLE + (text(props.unit) ? TEXT : 0) + 8 + PLOT];

export const draw = (item, props) => [
  h('div', { class: 'chart-head' },
    title(item, 1),
    text(props.unit) && say('div', 'card-tag clamp-1', props.unit)),
  plot(props, WIDTH - SIDES, PLOT, { words: wordsOf(item) }).el,
];

const exact = (value) => value.toLocaleString('en', { maximumFractionDigits: 6 });

/** Every label and value in full, for a chart whose plot had to thin, cut or round them. */
function table(props) {
  const { values, labels, mark } = series(props);
  return h('table', { class: 'chart-table' }, h('tbody', null, values.map((value, i) =>
    h('tr', { class: i === mark ? 'is-marked' : false },
      say('th', '', labels[i] || String(i + 1)),
      h('td', { text: exact(value) })))));
}

export function detail(item, props) {
  const { el, whole } = plot(props, 324, 200, { opened: true, words: wordsOf(item) });
  return [
    h('div', { class: 'detail-chart' },
      text(props.unit) && say('div', 'card-tag', props.unit),
      el,
      !whole && table(props)),
  ];
}
