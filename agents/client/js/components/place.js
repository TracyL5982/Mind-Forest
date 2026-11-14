import { h, s } from '../dom.js';
import { FIGURES, FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, figureNeed, picture, say, text, wrap } from './shared.js';

const WIDTH = 256;
const COLUMN = WIDTH - SIDES;
const PICTURE = 120;
/** The round pin beside the name, and the gap after it. */
const PIN = 28;
const NAME = COLUMN - PIN - 10;
/** The name is set in a figure's middle size while it fits on one line, and in the title's size on up to two when it does not. */
const [LARGE, LEAD] = FIGURES[1];

function plan(item, props) {
  const name = text(props.name).trim() || item.title || 'Untitled';
  const large = figureNeed(name, FIGURES[1]) <= NAME * 100;
  const nameLines = large ? 1 : wrap(name, NAME, TITLE_LETTER, 2);
  const said = item.summary || item.text || '';
  const about = said && said !== name && said !== item.title ? said : '';
  return {
    name, large, nameLines, about,
    src: text(props.src),
    headHeight: Math.max(PIN, large ? LEAD : nameLines * TITLE),
    aboutLines: about ? wrap(about.replace(/\s+/g, ' '), COLUMN, TEXT_LETTER, 3) : 0,
  };
}

export const shows = ['where'];

export function size(item, props) {
  const { src, headHeight, aboutLines } = plan(item, props);
  return [WIDTH, (src ? PICTURE : 0) + FRAME + headHeight + (aboutLines ? 8 + aboutLines * TEXT : 0)];
}

const pin = () => h('span', { class: 'place-pin', 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 12 12', width: 16, height: 16 },
  s('path', { d: 'M6 10.8C3.9 8.6 2.7 6.8 2.7 5.1a3.3 3.3 0 0 1 6.6 0c0 1.7-1.2 3.5-3.3 5.7ZM6 4.1a1 1 0 1 0 0 2a1 1 0 1 0 0-2' })));

const head = (name, large, lines) => h('div', { class: 'place-head' }, pin(),
  large ? say('div', `fact-value ${LARGE}`, name) : say('div', lines ? `card-title clamp-${lines}` : 'card-title', name));

export function draw(item, props, ctx) {
  const { name, large, nameLines, about, src, aboutLines } = plan(item, props);
  return [
    src && h('div', { class: 'media-frame', style: { height: `${PICTURE}px` } }, picture(src, name, ctx)),
    h('div', { class: 'place-under' },
      head(name, large, nameLines),
      about && say('div', `card-text clamp-${aboutLines}`, about.replace(/\s+/g, ' '))),
  ];
}

export function detail(item, props, ctx) {
  const { name, large, src } = plan(item, props);
  return [src && h('div', { class: 'detail-media' }, picture(src, name, ctx)), h('div', { class: 'detail-place' }, head(name, large, 0))];
}
