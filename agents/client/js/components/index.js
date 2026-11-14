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
import * as list from './list.js';
import * as facts from './facts.js';
import * as table from './table.js';
import * as excerpt from './excerpt.js';
import * as idea from './idea.js';
import * as reference from './reference.js';
import * as artwork from './artwork.js';
import * as breakdown from './breakdown.js';
import { h, s } from '../dom.js';
import { LABEL, chips } from '../chips.js';
import { CHIP_LINE, say, textWidth } from './shared.js';

/**
 * Every way one card can be drawn, one module per type. `size` works the card's footprint out
 * from the item and the props, so the field can be laid out without measuring the page. `draw`
 * returns the card's contents. `detail` returns the longer form shown when the card is opened,
 * and may return nothing. `shows` lists the chip sources the type already draws, as `item.data`
 * keys, so no chip repeats them.
 */
export const COMPONENTS = {
  note, quote, fact, image, video, link, chart, person, chat, code, steps,
  list, facts, table, excerpt, idea, reference, artwork, breakdown,
};

export const componentOf = (node) => (Object.hasOwn(COMPONENTS, node.view?.component) ? node.view.component : 'note');

/** An unknown component is drawn as a note, and a note reads none of the props meant for it. */
function resolve(node) {
  const name = componentOf(node);
  return { kind: COMPONENTS[name], props: name === node.view?.component ? (node.view.props ?? {}) : {} };
}

/** A chip that is not the date is drawn only while each such chip can have this many px, or its whole text. */
const CHIP_FLOOR = 72;
/** A chip's glyph and padding, and the gap between two chips. */
const CHIP_PAD = 28;
const CHIP_GAP = 6;
/** The margin each side of the line, inside the card's 1 px border. `drawCard` hands it to style.css. */
const CHIP_INSET = { quote: 19, image: 12, video: 12 };
const CHIP_INSET_ELSE = 15;

/** How a people chip writes the people it leaves unnamed. */
const counted = (chip) => `+${chip.count}`;
/** What a chip takes beside its text: the glyph and padding, and a count, which is never clipped. */
const padOf = (chip) => CHIP_PAD + (chip.count ? textWidth(` ${counted(chip)}`) : 0);
const needOf = (chip) => padOf(chip) + textWidth(chip.text);

/**
 * The chips that go on a line `room` px wide: the first `must`, then each next one while the
 * text of every chip can still be whole or have what CHIP_FLOOR leaves it, whichever is less. The
 * rest are left to the opened card.
 */
function fitting(line, room, must) {
  let left = room + CHIP_GAP;
  return line.filter((chip, i) => {
    left -= CHIP_GAP + padOf(chip) + Math.min(CHIP_FLOOR - CHIP_PAD, textWidth(chip.text));
    return i < must || left >= 0;
  });
}

/**
 * How wide each chip's box is when the line has `room` px for them. What the chips do not take
 * beside their text is shared out equally among the texts. A text that needs no more than its
 * share takes what it needs, and the others share what is left, so a short place is whole beside
 * a long one that is clipped.
 */
function shares(line, room) {
  const needs = line.map((chip) => textWidth(chip.text));
  const widths = line.map(padOf);
  room -= widths.reduce((sum, pad) => sum + pad, 0);
  let open = needs.map((_, i) => i);
  while (open.length > 0) {
    const each = Math.floor(room / open.length);
    const whole = open.filter((i) => needs[i] <= each);
    for (const i of whole.length > 0 ? whole : open) {
      const given = whole.length > 0 ? needs[i] : each;
      widths[i] += given;
      room -= given;
    }
    open = whole.length > 0 ? open.filter((i) => !whole.includes(i)) : [];
  }
  return widths;
}

const insetOf = (node) => CHIP_INSET[componentOf(node)] ?? CHIP_INSET_ELSE;

/**
 * The chips under a card's content, as they are drawn: `{ kind, text, width }`, and `count` on a
 * people chip that leaves some unnamed. `width` is the chip's box in px, and the page clips `text`
 * inside it, so no text is cut here. A date that is clipped says little, so a `when` chip takes
 * what its whole text needs, or the whole line when it needs more, before the others are fitted to
 * what is left. Any type may carry chips, so they are worked out here and not by a type.
 */
export function chipsOf(node, item) {
  const { kind, props } = resolve(node);
  const room = kind.size(item, props)[0] - 2 - 2 * insetOf(node);
  const all = chips(item, kind.shows);
  const dated = all[0]?.kind === 'when' ? [all[0]] : [];
  const taken = dated.map((chip) => Math.min(needOf(chip), room));
  const rest = room - taken.reduce((sum, wide) => sum + wide + CHIP_GAP, 0);
  const others = fitting(all.slice(dated.length), rest, 1 - dated.length);
  const widths = [...taken, ...shares(others, rest - CHIP_GAP * (others.length - 1))];
  return [...dated, ...others].map(({ kind: of, text, count }, i) => ({ kind: of, text, width: widths[i], ...(count && { count }) }));
}

export function sizeOf(node, item) {
  const { kind, props } = resolve(node);
  const [wide, tall] = kind.size(item, props);
  return [wide, tall + (chips(item, kind.shows).length > 0 ? CHIP_LINE : 0)];
}

const GLYPH = {
  when: 'M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M6 3.6V6l1.7 1.2',
  where: 'M6 10.8C3.9 8.6 2.7 6.8 2.7 5.1a3.3 3.3 0 0 1 6.6 0c0 1.7-1.2 3.5-3.3 5.7ZM6 4.1a1 1 0 1 0 0 2a1 1 0 1 0 0-2',
  people: 'M6 1.8a2 2 0 1 0 0 4a2 2 0 1 0 0-4M2.2 10.4c.3-2 1.8-3 3.8-3s3.5 1 3.8 3',
  origin: 'M2.5 2v4.5h6.5M6.8 4.2 9.2 6.5 6.8 8.8',
};

function chipLine(line, inset) {
  const el = h('div', { class: 'chip-line' }, line.map((chip) => h('span', { class: 'chip', data: { kind: chip.kind }, title: `${LABEL[chip.kind]}: ${chip.text}${chip.count ? ` ${counted(chip)}` : ''}`, style: { flexBasis: `${chip.width}px` } },
    s('svg', { class: 'chip-glyph', viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true' }, s('path', { d: GLYPH[chip.kind] })),
    say('span', 'chip-text', chip.text),
    chip.count && h('span', { class: 'chip-count', text: counted(chip) }))));
  el.style.setProperty('--chip-inset', `${inset}px`);
  return el;
}

/** What goes on a card's face: its body, drawn by its type, and under that its chips when it has any. */
export function drawCard(node, item, ctx) {
  const name = componentOf(node);
  const { kind, props } = resolve(node);
  const line = chipsOf(node, item);
  return [
    h('div', { class: `card-body c-${name}` }, kind.draw(item, props, ctx)),
    line.length > 0 && chipLine(line, insetOf(node)),
  ];
}

export function drawDetail(node, item, ctx) {
  const { kind, props } = resolve(node);
  return kind.detail(item, props, ctx, node);
}
