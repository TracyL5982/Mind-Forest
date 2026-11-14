import { h } from '../dom.js';
import { initials, picture, say, text } from './shared.js';

const nameOf = (item, props) => text(props.name) || item.title || '';

/** A round face: the picture, or the initials when there is none or it fails to load. */
const face = (name, props, ctx) => h('div', { class: 'person-face' },
  text(props.image) ? picture(props.image, name, ctx, () => initials(name)) : initials(name));

export const shows = [];

export const size = () => [252, 88];

export function draw(item, props, ctx) {
  const name = nameOf(item, props);
  return [
    face(name, props, ctx),
    h('div', { class: 'person-main' },
      say('div', 'card-title clamp-1', name),
      text(props.role) && say('div', 'card-text clamp-1', props.role),
      item.title !== name && say('div', 'card-foot clamp-1', item.title),
    ),
  ];
}

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-person' },
    face(nameOf(item, props), props, ctx),
    h('div', null, say('div', 'card-title', nameOf(item, props)), say('div', 'card-text', text(props.role)))),
];
