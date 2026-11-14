import { h } from '../dom.js';
import { initials, picture, text } from './shared.js';

const face = (name, props, ctx) => h('div', { class: 'person-face' }, text(props.image) ? picture(props.image, name, ctx) : initials(name));

export const size = () => [252, 88];

export function draw(item, props, ctx) {
  const name = text(props.name) || item.title || '';
  return [
    face(name, props, ctx),
    h('div', { class: 'person-main' },
      h('div', { class: 'card-title clamp-1', text: name }),
      text(props.role) && h('div', { class: 'card-text clamp-1', text: props.role }),
      item.title !== name && h('div', { class: 'card-foot clamp-1', text: item.title }),
    ),
  ];
}

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-person' },
    face(text(props.name) || item.title || '', props, ctx),
    h('div', null, h('div', { class: 'card-title', text: text(props.name) }), h('div', { class: 'card-text', text: text(props.role) }))),
];
