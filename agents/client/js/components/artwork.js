import { h } from '../dom.js';
import { chipSources } from '../chips.js';
import { COLUMN, CUE, HEIGHT, TITLE, WIDTH, drawFace, fit, lay, picture, say, text, titleOf, titleRow } from './shared.js';
import { wordsOf } from '../words.js';

/** The face's border, and the plate's padding under the title with 1 px to spare; the 10 px above the title is its gap. */
const BORDER = 2;
const UNDER = 9;
const ABOVE = 10;

function plan(props) {
  const by = [text(props.maker).trim(), text(props.date).trim()].filter(Boolean).join(', ');
  return { by, medium: text(props.medium).trim(), holder: text(props.holder).trim() };
}

/**
 * The work whole on a 6 px mat, as large as the plate leaves room for, over a plate with its title on one line. The maker, the
 * date, the medium and the holder are on the opened card.
 */
function face(item, props, ctx) {
  const head = titleRow(item, { most: 1, gap: ABOVE });
  const plate = ABOVE + TITLE + UNDER;
  const cut = !fit(titleOf(item), COLUMN, 'title', 1).whole;
  return lay([
    { tall: HEIGHT - BORDER - plate - (cut ? CUE : 0), draw: () => h('div', { class: 'artwork-mat' }, picture(text(props.src), item.title, ctx)) },
    head,
  ], { words: wordsOf(item), frame: BORDER + UNDER });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props, ctx) => drawFace(face(item, props, ctx));

/** The picture whole and the label's lines whole, without the holder when the opened card's list of sources names it. */
export function detail(item, props, ctx) {
  const { by, medium, holder: held } = plan(props);
  const holder = chipSources(item).some((source) => source.text === held) ? '' : held;
  return [
    h('div', { class: 'detail-media' }, picture(text(props.src), item.title, ctx)),
    (by || medium || holder) && h('div', { class: 'detail-artwork' },
      by && say('div', 'artwork-by', by),
      medium && say('div', 'artwork-medium', medium),
      holder && say('div', 'artwork-holder', holder)),
  ];
}
