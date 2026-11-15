import { h } from '../dom.js';
import { FRAME, SIDES, TEXT, TITLE, aboveOf, andMore, drawAbove, list, say, title } from './shared.js';

const WIDTH = 256;
const SHOWN = 5;
const ROW = 20;
const GAP = 8;

const step = (label, i, lines) => h('li', null, h('span', { class: 'step-n', text: String(i + 1) }), say('span', lines, String(label)));

export const shows = [];

export function size(item, props) {
  const n = list(props.steps).length;
  const rows = Math.min(n, SHOWN);
  return [WIDTH, FRAME + TITLE + aboveOf(props, WIDTH - SIDES).height + (rows ? 10 + rows * ROW + (rows - 1) * GAP : 0) + (n > SHOWN ? 8 + TEXT : 0)];
}

export function draw(item, props) {
  const steps = list(props.steps);
  return [
    title(item, 1),
    drawAbove(aboveOf(props, WIDTH - SIDES)),
    steps.length > 0 && h('ol', { class: 'steps' }, steps.slice(0, SHOWN).map((label, i) => step(label, i, 'clamp-1'))),
    steps.length > SHOWN && andMore(steps.length - SHOWN, item),
  ];
}

export const detail = (item, props) => [
  h('ol', { class: 'steps is-full' }, list(props.steps).map((label, i) => step(label, i, ''))),
];
