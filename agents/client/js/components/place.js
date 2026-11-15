import { h, s } from '../dom.js';
import { atOf, drawMap } from '../map.js';
import { COLUMN, FIGURES, MEASURES, WIDTH, drawFace, figureNeed, fit, lay, picture, say, text, titleOf, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The map across the face under the name, and in the opened card. A place card is a town or a sight more often than a street, so both show a few kilometres around it. */
const MAP = { width: WIDTH, height: 88, zoom: 12 };
const OPENED_MAP = { width: 348, height: 200, zoom: 12, link: true };
/** The round pin beside the name, and the gap after it. */
const PIN = 28;
const NAME = COLUMN - PIN - 10;
const MOST_NAME_LINES = 2;
/** Over a map, the face is padded above the name only: the border, 13 px and 2 to spare. The map takes the 13 px under the name as its gap. */
const OVER_MAP = 17;

/** The name is set in a figure's middle size while it fits on one line, and at the title's size on up to two when it does not. */
function plan(item, props) {
  const name = text(props.name).trim() || titleOf(item);
  const large = figureNeed(name, FIGURES[1]) <= NAME * 100;
  const said = item.summary || item.text || '';
  return {
    name, large,
    shown: large ? { words: name, lines: 1, whole: true } : fit(name, NAME, 'title', MOST_NAME_LINES),
    about: said && said !== name && said !== item.title ? said.replace(/\s+/g, ' ') : '',
    src: text(props.src).trim(),
    at: atOf(item.data?.at),
  };
}

/** The name beside its pin, then a map of where it is when the item holds a point, else the words about it and the cue. */
function face(item, props) {
  const { large, shown, about, at } = plan(item, props);
  const name = { tall: Math.max(PIN, large ? MEASURES.middle.lead : shown.lines * MEASURES.title.lead), whole: shown.whole, draw: () => head(shown.words, large) };
  if (at) return lay([name, { tall: MAP.height, gap: 13, draw: () => drawMap({ ...MAP, centre: at, pins: [at] }, 'place-map') }], { words: wordsOf(item), frame: OVER_MAP });
  return lay([name, about && { words: about, gap: 8, draw: wordsIn('card-text') }], { words: wordsOf(item) });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

const pin = () => h('span', { class: 'place-pin', 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 12 12', width: 16, height: 16 },
  s('path', { d: 'M6 10.8C3.9 8.6 2.7 6.8 2.7 5.1a3.3 3.3 0 0 1 6.6 0c0 1.7-1.2 3.5-3.3 5.7ZM6 4.1a1 1 0 1 0 0 2a1 1 0 1 0 0-2' })));

const head = (name, large) => h('div', { class: 'place-head' }, pin(), say('div', large ? `fact-value ${FIGURES[1][0]}` : 'card-title', name));

export const draw = (item, props) => drawFace(face(item, props));

/** The picture whole, a larger map, and the name when neither the opened card's own title nor its `Where` source is already the name. */
export function detail(item, props, ctx) {
  const { name, large, src, at } = plan(item, props);
  const said = name === item.title || name === text(item.data?.where).trim();
  return [
    src && h('div', { class: 'detail-media' }, picture(src, name, ctx)),
    at && drawMap({ ...OPENED_MAP, centre: at, pins: [at] }, 'detail-map'),
    !said && h('div', { class: 'detail-place' }, head(name, large)),
  ];
}
