import { h, clamp } from '../dom.js';
import { FRAME, TEXT, TITLE, head, text } from './shared.js';

const SHOWN = 7;

const lines = (props) => text(props.source).split('\n');

export const size = (item, props) => [304, FRAME + TITLE + 8 + clamp(lines(props).length, 1, SHOWN) * TEXT];

export function draw(item, props) {
  const shown = lines(props).slice(0, SHOWN);
  return [
    head(item, text(props.language) || 'text'),
    h('div', { class: 'code' },
      h('pre', { class: 'code-lines', 'aria-hidden': 'true', text: shown.map((_, i) => i + 1).join('\n') }),
      h('pre', { class: 'code-source', text: shown.join('\n') })),
  ];
}

export const detail = (item, props) => [
  h('pre', { class: 'code-source is-full', text: text(props.source) }),
];
