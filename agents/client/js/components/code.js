import { h, clamp } from '../dom.js';
import { FRAME, TEXT, TITLE, kind, text, title } from './shared.js';

const SHOWN = 7;

const lines = (props) => text(props.source).split('\n');
/** The Renderer sends `text` when it does not know the language, and that names nothing. */
const language = (props) => (text(props.language) && props.language !== 'text' ? props.language : '');

export const shows = [];

export const size = (item, props) => [304, FRAME + TITLE + 8 + clamp(lines(props).length, 1, SHOWN) * TEXT];

export function draw(item, props) {
  const shown = lines(props).slice(0, SHOWN);
  return [
    h('div', { class: 'card-head' }, title(item, 1), language(props) && kind(language(props))),
    h('div', { class: 'code' },
      h('pre', { class: 'code-lines', 'aria-hidden': 'true', text: shown.map((_, i) => i + 1).join('\n') }),
      h('pre', { class: 'code-source', text: shown.join('\n') })),
  ];
}

export const detail = (item, props) => [
  h('pre', { class: 'code-source is-full', text: text(props.source) }),
];
