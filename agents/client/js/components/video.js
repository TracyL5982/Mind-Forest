import { h } from '../dom.js';
import { picture, text } from './shared.js';

export const size = () => [264, 172];

export const draw = (item, props, ctx) => [
  text(props.poster)
    ? picture(props.poster, item.title, ctx)
    : h('video', { src: ctx.asset(text(props.src)), preload: 'metadata', muted: true, playsinline: true, tabindex: '-1' }),
  h('div', { class: 'media-play', 'aria-hidden': 'true' }),
  h('div', { class: 'media-caption clamp-2', text: text(props.caption) || item.title }),
];

export function detail(item, props, ctx) {
  const embed = /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}$/.test(text(item.data?.embed)) ? item.data.embed : '';
  return [
    h('div', { class: 'detail-media' }, embed
      ? h('iframe', { src: embed, title: item.title, allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' })
      : h('video', { src: ctx.asset(text(props.src)), controls: true, playsinline: true, preload: 'metadata' })),
  ];
}
