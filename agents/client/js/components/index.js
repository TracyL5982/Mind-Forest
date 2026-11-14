import * as note from './note.js';
import * as quote from './quote.js';
import * as fact from './fact.js';
import * as image from './image.js';
import * as video from './video.js';
import * as link from './link.js';
import * as chart from './chart.js';
import * as person from './person.js';
import * as chat from './chat.js';
import * as code from './code.js';
import * as steps from './steps.js';
import { h, s } from '../dom.js';
import { chips } from '../chips.js';
import { CHIP_LINE, textWidth } from './shared.js';

/**
 * Every way one card can be drawn, one module per type. `size` works the card's footprint out
 * from the item and the props, so the field can be laid out without measuring the page. `draw`
 * returns the card's contents. `detail` returns the longer form shown when the card is opened,
 * and may return nothing. `shows` lists the chip sources the type already draws, as `item.data`
 * keys, so no chip repeats them.
 */
export const COMPONENTS = { note, quote, fact, image, video, link, chart, person, chat, code, steps };

export const componentOf = (node) => (Object.hasOwn(COMPONENTS, node.view?.component) ? node.view.component : 'note');

/** An unknown component is drawn as a note, and a note reads none of the props meant for it. */
function resolve(node) {
  const name = componentOf(node);
  return { kind: COMPONENTS[name], props: name === node.view?.component ? (node.view.props ?? {}) : {} };
}

/** A chip is cut no narrower than this, in px. */
const CHIP_FLOOR = 84;
/** A chip's glyph and padding, the gap between two chips, and the widest margin a type gives the line. */
const CHIP_PAD = 28;
const CHIP_GAP = 6;
const CHIP_INSET = 38;

/**
 * The chips that go on a card `wide` px wide: the first, then each next one while every chip can
 * still have its whole text or CHIP_FLOOR, whichever is less. The rest are left to the opened card.
 */
function fitting(line, wide) {
  let room = wide - CHIP_INSET + CHIP_GAP;
  return line.filter((chip, i) => {
    room -= CHIP_GAP + Math.min(CHIP_FLOOR, CHIP_PAD + textWidth(chip.text));
    return i === 0 || room >= 0;
  });
}

const lineOf = (kind, node, item, wide) => fitting(chips(item, node, kind.shows), wide);

/** The chips under a card's content. Any type may carry them, so they are drawn here and not by a type. */
export function chipsOf(node, item) {
  const { kind, props } = resolve(node);
  return lineOf(kind, node, item, kind.size(item, props)[0]);
}

export function sizeOf(node, item) {
  const { kind, props } = resolve(node);
  const [wide, tall] = kind.size(item, props);
  return [wide, tall + (lineOf(kind, node, item, wide).length > 0 ? CHIP_LINE : 0)];
}

const CHIP = {
  when: { says: 'When', glyph: 'M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M6 3.6V6l1.7 1.2' },
  where: { says: 'Where', glyph: 'M6 10.8C3.9 8.6 2.7 6.8 2.7 5.1a3.3 3.3 0 0 1 6.6 0c0 1.7-1.2 3.5-3.3 5.7ZM6 4.1a1 1 0 1 0 0 2a1 1 0 1 0 0-2' },
  people: { says: 'People', glyph: 'M6 1.8a2 2 0 1 0 0 4a2 2 0 1 0 0-4M2.2 10.4c.3-2 1.8-3 3.8-3s3.5 1 3.8 3' },
  origin: { says: 'From', glyph: 'M2.5 2v4.5h6.5M6.8 4.2 9.2 6.5 6.8 8.8' },
};

function chipLine(line) {
  return h('div', { class: 'chip-line' }, line.map(({ kind, text, keep = '' }) => h('span', { class: 'chip', data: { kind }, title: `${CHIP[kind].says}: ${text}` },
    s('svg', { class: 'chip-glyph', viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true' }, s('path', { d: CHIP[kind].glyph })),
    h('span', { class: 'chip-text', text: text.slice(0, text.length - keep.length) }),
    keep && h('span', { class: 'chip-keep', text: keep.trim() }))));
}

/** What goes on a card's face: its body, drawn by its type, and under that its chips when it has any. */
export function drawCard(node, item, ctx) {
  const name = componentOf(node);
  const { kind, props } = resolve(node);
  const line = chipsOf(node, item);
  return [
    h('div', { class: `card-body c-${name}` }, kind.draw(item, props, ctx)),
    line.length > 0 && chipLine(line),
  ];
}

export function drawDetail(node, item, ctx) {
  const { kind, props } = resolve(node);
  return kind.detail(item, props, ctx, node);
}
