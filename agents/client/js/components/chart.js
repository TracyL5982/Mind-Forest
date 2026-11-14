import { h } from '../dom.js';
import { chart, head, text } from './shared.js';

export const size = () => [276, 180];

export const draw = (item, props) => [
  head(item, text(props.unit)),
  chart(props, 244, 112),
];

export const detail = (item, props) => [
  h('div', { class: 'detail-chart' }, chart(props, 320, 150), text(props.unit) && h('div', { class: 'chart-unit', text: props.unit })),
];
