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
import { CHIP_LINE, TEXT_LETTER, cut, say, textWidth } from './shared.js';

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

/** A chip that is cut is never given less than this, in px. */
const CHIP_FLOOR = 84;
/** A chip's glyph and padding, and the gap between two chips. */
const CHIP_PAD = 28;
const CHIP_GAP = 6;
/** The card's border plus the margin each side of the line, which is `.chip-line` in style.css. */
const CHIP_SIDES = { quote: 40, image: 26, video: 26, person: 40 };
const CHIP_SIDES_ELSE = 32;

const needOf = (chip) => CHIP_PAD + textWidth(chip.text);

/**
 * The chips that go on a line `room` px wide: the first, then each next one while every chip can
 * still have its whole text or CHIP_FLOOR, whichever is less. The rest are left to the opened card.
 */
function fitting(line, room) {
  let left = room + CHIP_GAP;
  return line.filter((chip, i) => {
    left -= CHIP_GAP + Math.min(CHIP_FLOOR, needOf(chip));
    return i === 0 || left >= 0;
  });
}

/**
 * How wide each chip is drawn when the line has `room` px for them. The room is shared out
 * equally. A chip that needs no more than its share takes what it needs, and the others share
 * what is left, so a short date is whole beside a long place that is cut.
 */
function shares(needs, room) {
  const widths = needs.map(() => 0);
  let open = needs.map((_, i) => i);
  while (open.length > 0) {
    const each = Math.floor(room / open.length);
    const whole = open.filter((i) => needs[i] <= each);
    if (whole.length === 0) {
      for (const i of open) widths[i] = each;
      break;
    }
    for (const i of whole) {
      widths[i] = needs[i];
      room -= needs[i];
    }
    open = open.filter((i) => !whole.includes(i));
  }
  return widths;
}

/** The chip as it is drawn in `wide` px: whole, or its start with an ellipsis. A count is never cut. */
function trimmed({ kind, text, keep = '' }, wide) {
  const start = text.slice(0, text.length - keep.length);
  const drawn = needOf({ text }) <= wide ? text : cut(start, wide - CHIP_PAD - textWidth(keep), TEXT_LETTER) + keep;
  return { kind, text: drawn, full: text, ...(keep && { keep }) };
}

function lineOf(node, item) {
  const { kind, props } = resolve(node);
  const room = kind.size(item, props)[0] - (CHIP_SIDES[componentOf(node)] ?? CHIP_SIDES_ELSE);
  const line = fitting(chips(item, kind.shows), room);
  const widths = shares(line.map(needOf), room - CHIP_GAP * (line.length - 1));
  return line.map((chip, i) => trimmed(chip, widths[i]));
}

/**
 * The chips under a card's content, as they are drawn: `{ kind, text, full }`, where `text` is cut
 * to the chip's share of the line and `full` is not. Any type may carry them, so they are worked
 * out here and not by a type.
 */
export const chipsOf = lineOf;

export function sizeOf(node, item) {
  const { kind, props } = resolve(node);
  const [wide, tall] = kind.size(item, props);
  return [wide, tall + (chips(item, kind.shows).length > 0 ? CHIP_LINE : 0)];
}

const CHIP = {
  when: { says: 'When', glyph: 'M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M6 3.6V6l1.7 1.2' },
  where: { says: 'Where', glyph: 'M6 10.8C3.9 8.6 2.7 6.8 2.7 5.1a3.3 3.3 0 0 1 6.6 0c0 1.7-1.2 3.5-3.3 5.7ZM6 4.1a1 1 0 1 0 0 2a1 1 0 1 0 0-2' },
  people: { says: 'People', glyph: 'M6 1.8a2 2 0 1 0 0 4a2 2 0 1 0 0-4M2.2 10.4c.3-2 1.8-3 3.8-3s3.5 1 3.8 3' },
  origin: { says: 'From', glyph: 'M2.5 2v4.5h6.5M6.8 4.2 9.2 6.5 6.8 8.8' },
};

function chipLine(line) {
  return h('div', { class: 'chip-line' }, line.map(({ kind, text, full, keep = '' }) => h('span', { class: 'chip', data: { kind }, title: `${CHIP[kind].says}: ${full}` },
    s('svg', { class: 'chip-glyph', viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true' }, s('path', { d: CHIP[kind].glyph })),
    say('span', 'chip-text', text.slice(0, text.length - keep.length)),
    keep && h('span', { class: 'chip-keep', text: keep.trim() }))));
}

/** What goes on a card's face: its body, drawn by its type, and under that its chips when it has any. */
export function drawCard(node, item, ctx) {
  const name = componentOf(node);
  const { kind, props } = resolve(node);
  const line = lineOf(node, item);
  return [
    h('div', { class: `card-body c-${name}` }, kind.draw(item, props, ctx)),
    line.length > 0 && chipLine(line),
  ];
}

export function drawDetail(node, item, ctx) {
  const { kind, props } = resolve(node);
  return kind.detail(item, props, ctx, node);
}
