import { h } from '../dom.js';
import { SIDES, TEXT, TITLE, TITLE_LETTER, andMore, list, say, text, wrap, titleOf } from './shared.js';

const WIDTH = 256;
const COLUMN = WIDTH - SIDES;
/** The band of colours across the top of the card. */
const STRIP = 44;
const STRIP_MOST = 12;
/** The border, the padding above and below what is under the band, and 2 px to spare. */
const FRAME_UNDER = 29;
const SHOWN = 6;
const GAP = 5;

const colours = (props) => list(props.colours).map((colour) => ({ name: text(colour?.name).trim(), value: text(colour?.value).trim() }));

/** A block of one colour. A value the page cannot paint leaves the hatching behind it showing. */
function paint(cls, value) {
  const el = h('span', { class: cls });
  el.style.backgroundColor = value;
  return el;
}

const row = (colour, clamped) => h('li', null, paint('swatch-dot', colour.value), say('span', `swatch-name ${clamped}`, colour.name), h('span', { class: 'swatch-value', text: colour.value }));

export const shows = [];

export function size(item, props) {
  const all = colours(props);
  const rows = Math.min(all.length, SHOWN);
  return [WIDTH, STRIP + FRAME_UNDER + wrap(titleOf(item), COLUMN, TITLE_LETTER, 2) * TITLE + (rows ? 8 + rows * TEXT + (rows - 1) * GAP : 0) + (all.length > SHOWN ? 8 + TEXT : 0)];
}

export function draw(item, props) {
  const all = colours(props);
  return [
    h('div', { class: 'swatch-strip', style: { height: `${STRIP}px` }, 'aria-hidden': 'true' }, all.slice(0, STRIP_MOST).map((colour) => paint('swatch-block', colour.value))),
    h('div', { class: 'swatch-under' },
      say('div', `card-title clamp-${wrap(titleOf(item), COLUMN, TITLE_LETTER, 2)}`, titleOf(item)),
      all.length > 0 && h('ul', { class: 'swatch-rows' }, all.slice(0, SHOWN).map((colour) => row(colour, 'clamp-1'))),
      all.length > SHOWN && andMore(all.length - SHOWN, item)),
  ];
}

export const detail = (item, props) => [h('ul', { class: 'swatch-rows is-full' }, colours(props).map((colour) => row(colour, '')))];
