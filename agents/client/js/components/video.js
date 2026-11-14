import { h } from '../dom.js';
import { TEXT_LETTER, fold, framed, framedHeight, picture, text } from './shared.js';

const WIDTH = 272;
const POSTER = 153;

const caption = (item, props) => text(props.caption) || item.title || '';
const captionLines = (item, props) => fold(caption(item, props), WIDTH - 27, TEXT_LETTER, 2);

export const size = (item, props) => [WIDTH, framedHeight(POSTER, captionLines(item, props))];

export const draw = (item, props, ctx) => framed(POSTER, caption(item, props), captionLines(item, props),
  text(props.poster)
    ? picture(props.poster, item.title, ctx)
    : h('video', { src: ctx.asset(text(props.src)), preload: 'metadata', muted: true, playsinline: true, tabindex: '-1' }),
  h('div', { class: 'media-play', 'aria-hidden': 'true' }));

export function detail(item, props, ctx) {
  const embed = /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}$/.test(text(item.data?.embed)) ? item.data.embed : '';
  return [
    h('div', { class: 'detail-media' }, embed
      ? h('iframe', { src: embed, title: item.title, allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' })
      : h('video', { src: ctx.asset(text(props.src)), controls: true, playsinline: true, preload: 'metadata' })),
  ];
}
