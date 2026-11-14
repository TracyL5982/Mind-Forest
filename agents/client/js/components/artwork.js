import { h } from '../dom.js';
import { chipSources } from '../chips.js';
import { SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, picture, say, text, wrap, titleOf } from './shared.js';

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
    titleLines: wrap(titleOf(item), COLUMN, TITLE_LETTER, 2),
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
      say('div', `card-title clamp-${titleLines}`, titleOf(item)),
      by && say('div', `artwork-by clamp-${byLines}`, by),
      medium && say('div', `artwork-medium clamp-${mediumLines}`, medium),
      holder && say('div', 'artwork-holder clamp-1', holder)),
  ];
}

/** The picture whole and the label's lines whole, without the holder when the opened card's list of sources names it. */
export function detail(item, props, ctx) {
  const { by, medium, holder: held } = plan(item, props);
  const holder = chipSources(item).some((source) => source.text === held) ? '' : held;
  return [
    h('div', { class: 'detail-media' }, picture(text(props.src), item.title, ctx)),
    (by || medium || holder) && h('div', { class: 'detail-artwork' },
      by && say('div', 'artwork-by', by),
      medium && say('div', 'artwork-medium', medium),
      holder && say('div', 'artwork-holder', holder)),
  ];
}
