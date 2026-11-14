import { h, clamp } from '../dom.js';
import { TEXT_LETTER, fold, framed, framedHeight, picture, text } from './shared.js';

const WIDTH = 240;

const pictureHeight = (props) => clamp(Math.round(WIDTH / (Number(props.aspect) || 1.35)), 130, 260);
const caption = (item, props) => text(props.caption) || item.title || '';
const captionLines = (item, props) => fold(caption(item, props), WIDTH - 27, TEXT_LETTER, 2);

export const size = (item, props) => [WIDTH, framedHeight(pictureHeight(props), captionLines(item, props))];

export const draw = (item, props, ctx) => framed(pictureHeight(props), caption(item, props), captionLines(item, props),
  picture(text(props.src), item.title, ctx));

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-media' }, picture(text(props.src), item.title, ctx)),
];
