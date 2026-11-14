import { h, clamp } from '../dom.js';
import { list, title } from './shared.js';

const step = (label, i, lines) => h('li', null, h('span', { class: 'step-n', text: String(i + 1) }), h('span', { class: lines, text: String(label) }));

export function size(item, props) {
  const n = list(props.steps).length;
  return [244, 56 + 27 * clamp(n, 1, 5) + (n > 5 ? 24 : 0)];
}

export function draw(item, props) {
  const steps = list(props.steps);
  return [
    title(item, 1),
    h('ol', { class: 'steps' }, steps.slice(0, 5).map((label, i) => step(label, i, 'clamp-1'))),
    steps.length > 5 && h('div', { class: 'card-foot', text: `and ${steps.length - 5} more` }),
  ];
}

export const detail = (item, props) => [
  h('ol', { class: 'steps is-full' }, list(props.steps).map((label, i) => step(label, i, false))),
];
