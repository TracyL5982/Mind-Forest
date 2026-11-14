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

/** A hex colour of 3, 4, 6 or 8 digits, or a colour name: the only values the service sends, and the only ones painted. */
const PAINTS = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{1,30})$/i;

/** A block of one colour. Any value but a hex colour or a colour name, and a name the page does not know, leaves the hatching behind it showing. */
function paint(cls, value) {
  const el = h('span', { class: cls });
  if (PAINTS.test(value)) el.style.backgroundColor = value;
  return el;
}

/** A colour by name with its value at the right. A colour pasted without a name has its value for a name, and is written once. */
const row = (colour, clamped) => h('li', null, paint('swatch-dot', colour.value), say('span', `swatch-name ${clamped}`, colour.name),
  colour.name !== colour.value && h('span', { class: 'swatch-value', text: colour.value }));

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
