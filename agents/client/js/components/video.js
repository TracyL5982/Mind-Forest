import { h } from '../dom.js';
import { COLUMN, CUE, HEIGHT, TEXT, WIDTH, drawFace, lay, linesOf, picture, say, text, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** As an image's: the border, the plate's padding under the caption and the gap above it. */
const BORDER = 2;
const UNDER = 10;
const ABOVE = 9;
const MOST_LINES = 2;

const caption = (item, props) => text(props.caption) || item.title || '';

/** The poster at 16:9, as large as the caption leaves room for, over its caption on up to two lines, else one line and the cue. */
function face(item, props, ctx) {
  const words = caption(item, props);
  const lines = words ? linesOf(words, COLUMN, 'body') : 0;
  const plate = lines === 0 ? 0 : ABOVE + Math.min(lines, lines > MOST_LINES ? 1 : MOST_LINES) * TEXT + UNDER + (lines > MOST_LINES ? CUE : 0);
  const tall = Math.min(Math.round((WIDTH * 9) / 16), HEIGHT - BORDER - plate);
  const wide = Math.round((tall * 16) / 9);
  return lay([
    { tall, draw: () => h('div', { class: 'media-frame' }, h('div', { class: 'media-poster', style: { width: `${wide}px` } },
      text(props.poster)
        ? picture(props.poster, item.title, ctx)
        : h('video', { src: ctx.asset(text(props.src)), preload: 'metadata', muted: true, playsinline: true, tabindex: '-1' }),
      h('div', { class: 'media-play', 'aria-hidden': 'true' }))) },
    words && { words, most: MOST_LINES, gap: ABOVE, draw: wordsIn('media-caption') },
  ], { words: wordsOf(item), frame: BORDER + (words ? UNDER : 0) });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props, ctx) => drawFace(face(item, props, ctx));

function player(item, props, ctx) {
  const embed = /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}$/.test(text(item.data?.embed)) ? item.data.embed : '';
  if (embed) return h('iframe', { src: embed, title: item.title, allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' });
  const poster = text(props.poster) && ctx.asset(props.poster);
  if (text(props.src)) return h('video', { src: ctx.asset(props.src), poster, controls: true, playsinline: true, preload: 'metadata' });
  return [poster && picture(props.poster, item.title, ctx), h('div', { class: 'detail-note', text: wordsOf(item).noClip })];
}

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-media' }, player(item, props, ctx)),
  text(props.caption) && props.caption !== item.title && props.caption !== item.summary && say('p', 'detail-caption', props.caption),
];
