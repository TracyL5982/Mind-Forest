import { h } from '../dom.js';
import { COLUMN, WIDTH, drawFace, lay, list, metaWidth, say, text, titleRow } from './shared.js';
import { wordsOf } from '../words.js';

/** The band of colours across the top of the card. */
const STRIP = 44;
const STRIP_MOST = 12;
/** The border, the padding above and below what is under the band, and 2 px to spare. */
const FRAME_UNDER = 29;
/** A row's dot and the gap after it, and the gap before its value. */
const DOT = 18;
const BEFORE_VALUE = 8;
const NAME_LINES = 2;

const colours = (props) => list(props.colours).map((colour) => {
  const value = text(colour?.value).trim();
  return { name: text(colour?.name).trim() || value, value };
});

/** A hex colour of 3, 4, 6 or 8 digits, or a colour name: the only values the service sends, and the only ones painted. */
const PAINTS = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{1,30})$/i;

/** A block of one colour. Any value but a hex colour or a colour name, and a name the page does not know, leaves the hatching behind it showing. */
function paint(cls, value) {
  const el = h('span', { class: cls });
  if (PAINTS.test(value)) el.style.backgroundColor = value;
  return el;
}

/** A colour sent without a name has its value for a name, and is written once. */
const valueOf = (colour) => (colour.name !== colour.value ? colour.value : '');

/** A colour by name with its value at the right. */
const row = (tag, colour, name) => h(tag, { class: 'swatch-row' }, paint('swatch-dot', colour.value), say('span', 'swatch-name', name),
  valueOf(colour) && h('span', { class: 'swatch-value', text: valueOf(colour) }));

/**
 * The band of the first colours, then under it the title and each colour by name with its value in meta, as many as the face has
 * room for. The cue counts the colours left out.
 */
function face(item, props) {
  const words = wordsOf(item);
  return lay([
    titleRow(item),
    ...colours(props).map((colour, i) => ({
      words: colour.name, column: COLUMN - DOT - (valueOf(colour) ? BEFORE_VALUE + metaWidth(valueOf(colour)) : 0), most: NAME_LINES, unit: true, gap: i === 0 ? 8 : 5,
      draw: (shown) => row('div', colour, shown.words),
    })),
  ], { words, frame: STRIP + FRAME_UNDER, cue: (left) => (left > 0 ? words.cue.left(left) : '') });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => [
  h('div', { class: 'swatch-strip', style: { height: `${STRIP}px` }, 'aria-hidden': 'true' }, colours(props).slice(0, STRIP_MOST).map((colour) => paint('swatch-block', colour.value))),
  h('div', { class: 'swatch-under' }, drawFace(face(item, props))),
];

export const detail = (item, props) => [h('ul', { class: 'swatch-rows is-full' }, colours(props).map((colour) => row('li', colour, colour.name)))];
