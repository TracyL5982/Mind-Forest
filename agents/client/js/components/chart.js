import { h, s, clamp } from '../dom.js';
import { COLUMN, GAP, HEIGHT, META, WIDTH, aboveRows, drawFace, headsRow, lay, linesOf, plot, say, series, text, titleRow, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The least and the most the shape is drawn. It takes the room the rows over it leave, between these. */
const SHAPE = { least: 38, most: 62 };
/** Room inside the shape above and below the highest and lowest values, so a stroke or the marked dot is drawn whole. */
const PAD = 5;

/** The bars or the line of the values, the marked one in the accent, with no text, as a preview of the chart the opened card draws. */
function shape(props, width, height) {
  const { values, mark } = series(props);
  const root = s('svg', { class: 'chart chart-shape', viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  const [lo, hi] = [Math.min(0, ...values), Math.max(0, ...values)];
  const y = (v) => PAD + (height - 2 * PAD) * (1 - (v - lo) / (hi - lo || 1));
  const step = width / values.length;
  const x = (i) => step * (i + 0.5);
  root.append(s('line', { class: 'chart-axis', x1: 0, x2: width, y1: y(0), y2: y(0) }));
  if (props.chart === 'line') {
    if (values.length > 1) root.append(s('polyline', { class: 'chart-line', points: values.map((v, i) => `${x(i)},${y(v)}`).join(' ') }));
    const dot = mark >= 0 ? mark : values.length === 1 ? 0 : -1;
    if (dot >= 0) root.append(s('circle', { class: 'chart-dot is-marked', cx: x(dot), cy: y(values[dot]), r: 3 }));
  } else {
    const bar = clamp(step * 0.62, 2, 28);
    values.forEach((v, i) => root.append(s('rect', {
      class: i === mark ? 'chart-bar is-marked' : 'chart-bar', x: x(i) - bar / 2, y: Math.min(y(v), y(0)), width: bar, height: Math.max(1, Math.abs(y(v) - y(0))), rx: Math.min(2, bar / 2),
    })));
  }
  return root;
}

/**
 * A designed preview, because no label or value of a chart reads at the face's sizes: the title, the lines the item writes over
 * the chart and the heads row of its table, the shape of the values with no text, as tall as the room they leave allows, and one
 * meta line with the count of points and the first and last labels, as the item writes them, when they fit it. When the face has
 * no room for the shape, that line is the cue, since the points are what it leaves out.
 */
function face(item, props) {
  const words = wordsOf(item);
  const { values, labels } = series(props);
  const n = values.length;
  const top = [titleRow(item), ...aboveRows(props), headsRow(props)];
  const tall = clamp(HEIGHT - lay(top, { words }).height - GAP - GAP - META, SHAPE.least, SHAPE.most);
  const ranged = words.cue.points(n, ...(n > 1 && labels[0] && labels[n - 1] ? [labels[0], labels[n - 1]] : []));
  const said = n === 0 ? words.noData : linesOf(ranged, COLUMN, 'meta') === 1 ? ranged : words.cue.points(n);
  return lay([
    ...top,
    n > 0 && { tall, gap: GAP, draw: () => shape(props, COLUMN, tall) },
    { words: said, measure: 'meta', most: 1, gap: GAP, draw: wordsIn('chart-meta') },
  ], { words, cue: () => said });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

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
