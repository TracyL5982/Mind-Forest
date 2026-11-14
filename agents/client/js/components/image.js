import { h, clamp } from '../dom.js';
import { SIDES, TEXT_LETTER, fold, framed, framedHeight, picture, say, text } from './shared.js';

const WIDTH = 240;

const pictureHeight = (props) => clamp(Math.round(WIDTH / (Number(props.aspect) || 1.35)), 130, 260);
const caption = (item, props) => text(props.caption) || item.title || '';
const captionLines = (item, props) => (caption(item, props) ? fold(caption(item, props), WIDTH - SIDES, TEXT_LETTER, 2) : 0);

export const shows = [];

export const size = (item, props) => [WIDTH, framedHeight(pictureHeight(props), captionLines(item, props))];

export const draw = (item, props, ctx) => framed(pictureHeight(props), caption(item, props), captionLines(item, props),
  picture(text(props.src), item.title, ctx));

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-media' }, picture(text(props.src), item.title, ctx)),
  text(props.caption) && props.caption !== item.title && props.caption !== item.summary && say('p', 'detail-caption', props.caption),
];
