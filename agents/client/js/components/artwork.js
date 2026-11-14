import { h } from '../dom.js';
import { SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, picture, say, text, wrap } from './shared.js';

const WIDTH = 264;
const COLUMN = WIDTH - SIDES;
/** The mat the work is shown whole on. */
const MAT = 196;
/** The border, the plate's padding above and below its lines, and 2 px to spare. */
const PLATE = 26;

function plan(item, props) {
  const by = [text(props.maker).trim(), text(props.date).trim()].filter(Boolean).join(', ');
  const medium = text(props.medium).trim();
  const holder = text(props.holder).trim();
  return {
    by, medium, holder,
    titleLines: wrap(item.title || 'Untitled', COLUMN, TITLE_LETTER, 2),
    byLines: by ? wrap(by, COLUMN, TEXT_LETTER, 2) : 0,
    mediumLines: medium ? wrap(medium, COLUMN, TEXT_LETTER, 2) : 0,
  };
}

export const shows = ['holder', 'date'];

export function size(item, props) {
  const { holder, titleLines, byLines, mediumLines } = plan(item, props);
  return [WIDTH, MAT + PLATE + titleLines * TITLE + (byLines ? 2 + byLines * TEXT : 0) + mediumLines * TEXT + (holder ? TEXT : 0)];
}

export function draw(item, props, ctx) {
  const { by, medium, holder, titleLines, byLines, mediumLines } = plan(item, props);
  return [
    h('div', { class: 'artwork-mat', style: { height: `${MAT}px` } }, picture(text(props.src), item.title, ctx)),
    h('div', { class: 'artwork-plate' },
      say('div', `card-title clamp-${titleLines}`, item.title || 'Untitled'),
      by && say('div', `artwork-by clamp-${byLines}`, by),
      medium && say('div', `artwork-medium clamp-${mediumLines}`, medium),
      holder && say('div', 'artwork-holder clamp-1', holder)),
  ];
}

export function detail(item, props, ctx) {
  const { by, medium, holder } = plan(item, props);
  return [
    h('div', { class: 'detail-media' }, picture(text(props.src), item.title, ctx)),
    (by || medium || holder) && h('div', { class: 'detail-artwork' },
      by && say('div', 'artwork-by', by),
      medium && say('div', 'artwork-medium', medium),
      holder && say('div', 'artwork-holder', holder)),
  ];
}
