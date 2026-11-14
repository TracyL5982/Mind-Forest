import { h } from '../dom.js';
import { SIDES, TEXT_LETTER, fold, framed, framedHeight, picture, say, text } from './shared.js';

const WIDTH = 272;
const POSTER = 153;

const caption = (item, props) => text(props.caption) || item.title || '';
const captionLines = (item, props) => (caption(item, props) ? fold(caption(item, props), WIDTH - SIDES, TEXT_LETTER, 2) : 0);

export const shows = [];

export const size = (item, props) => [WIDTH, framedHeight(POSTER, captionLines(item, props))];

export const draw = (item, props, ctx) => framed(POSTER, caption(item, props), captionLines(item, props), [
  text(props.poster)
    ? picture(props.poster, item.title, ctx)
    : h('video', { src: ctx.asset(text(props.src)), preload: 'metadata', muted: true, playsinline: true, tabindex: '-1' }),
  h('div', { class: 'media-play', 'aria-hidden': 'true' }),
]);

function player(item, props, ctx) {
  const embed = /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}$/.test(text(item.data?.embed)) ? item.data.embed : '';
  if (embed) return h('iframe', { src: embed, title: item.title, allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' });
  const poster = text(props.poster) && ctx.asset(props.poster);
  if (text(props.src)) return h('video', { src: ctx.asset(props.src), poster, controls: true, playsinline: true, preload: 'metadata' });
  return [poster && picture(props.poster, item.title, ctx), h('div', { class: 'detail-note', text: 'This clip has no file to play.' })];
}

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-media' }, player(item, props, ctx)),
  text(props.caption) && props.caption !== item.title && props.caption !== item.summary && say('p', 'detail-caption', props.caption),
];
