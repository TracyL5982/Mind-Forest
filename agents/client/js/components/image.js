import { h, clamp } from '../dom.js';
import { COLUMN, CUE, HEIGHT, TEXT, WIDTH, drawFace, lay, linesOf, picture, say, text, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The face's border, and under the caption the plate's padding with 1 px to spare; the 9 px above the caption is its gap. */
const BORDER = 2;
const UNDER = 10;
const ABOVE = 9;
const MOST_LINES = 2;
/** The least a picture is given, so a long caption never squeezes it to a strip. */
const LEAST = 81;

const caption = (item, props) => text(props.caption) || item.title || '';

/**
 * The picture across the face and its caption on a plate below, on up to two lines, else one line and the cue. The picture takes
 * its own proportions up to the room the caption leaves, and never less than `LEAST`.
 */
function face(item, props, ctx) {
  const words = caption(item, props);
  const lines = words ? linesOf(words, COLUMN, 'body') : 0;
  const plate = lines === 0 ? 0 : ABOVE + Math.min(lines, lines > MOST_LINES ? 1 : MOST_LINES) * TEXT + UNDER + (lines > MOST_LINES ? CUE : 0);
  const tall = clamp(Math.round(WIDTH / (Number(props.aspect) || 1.35)), LEAST, HEIGHT - BORDER - plate);
  return lay([
    { tall, draw: () => h('div', { class: 'media-frame' }, picture(text(props.src), item.title, ctx)) },
    words && { words, most: MOST_LINES, gap: ABOVE, draw: wordsIn('media-caption') },
  ], { words: wordsOf(item), frame: BORDER + (words ? UNDER : 0) });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props, ctx) => drawFace(face(item, props, ctx));

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-media' }, picture(text(props.src), item.title, ctx)),
  text(props.caption) && props.caption !== item.title && props.caption !== item.summary && say('p', 'detail-caption', props.caption),
];
