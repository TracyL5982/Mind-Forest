import { h } from '../dom.js';
import { initials, picture, text } from './shared.js';

export const size = () => [236, 92];

export function draw(item, props, ctx) {
  const name = text(props.name) || item.title;
  return [
    h('div', { class: 'person-face' }, text(props.image) ? picture(props.image, name, ctx) : initials(name)),
    h('div', { class: 'person-main' },
      h('div', { class: 'card-title clamp-1', text: name }),
      text(props.role) && h('div', { class: 'card-text clamp-1', text: props.role }),
      item.title !== name && h('div', { class: 'card-foot clamp-1', text: item.title }),
    ),
  ];
}

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-person' },
    h('div', { class: 'person-face' }, text(props.image) ? picture(props.image, text(props.name), ctx) : initials(text(props.name) || item.title)),
    h('div', null, h('div', { class: 'card-title', text: text(props.name) }), h('div', { class: 'card-text', text: text(props.role) }))),
];
