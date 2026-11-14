import { h } from '../dom.js';
import { FRAME, TEXT, TITLE, chart, text, title } from './shared.js';

const WIDTH = 300;
const PLOT = 136;

export const size = (item, props) => [WIDTH, FRAME + TITLE + (text(props.unit) ? TEXT : 0) + 8 + PLOT];

export const draw = (item, props) => [
  h('div', { class: 'chart-head' },
    title(item, 1),
    text(props.unit) && h('div', { class: 'card-tag clamp-1', text: props.unit })),
  chart(props, WIDTH - 33, PLOT),
];

export const detail = (item, props) => [
  h('div', { class: 'detail-chart' },
    text(props.unit) && h('div', { class: 'card-tag', text: props.unit }),
    chart(props, 324, 200, { every: true })),
];
