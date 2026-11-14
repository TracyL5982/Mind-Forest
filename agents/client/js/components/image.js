import { h, clamp } from '../dom.js';
import { picture, text } from './shared.js';

export const size = (item, props) => [236, clamp(Math.round(236 / (Number(props.aspect) || 1.35)), 130, 260)];

export const draw = (item, props, ctx) => [
  picture(text(props.src), item.title, ctx),
  h('div', { class: 'media-caption clamp-2', text: text(props.caption) || item.title }),
];

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-media' }, picture(text(props.src), item.title, ctx)),
];
