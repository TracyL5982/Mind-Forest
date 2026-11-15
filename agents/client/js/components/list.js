import { h, s } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, aboveOf, andMore, drawAbove, list, say, text, textWidth, wrap, titleOf } from './shared.js';
import { wordsOf } from '../words.js';

const WIDTH = 256;
const COLUMN = WIDTH - SIDES;
const SHOWN = 6;
/** A mark and the gap after it. */
const MARK = 20;
const GAP = 5;

/** The lines an entry is given in a column `width` px wide, beside its mark. A sheet's list counts its entries the same way. */
export const entryLines = (entry, width) => wrap(entry, width - MARK, TEXT_LETTER, 2);
/** How tall entries of these many lines stand, one under another. */
export const stacked = (rows) => rows.reduce((sum, lines) => sum + lines * TEXT, 0) + Math.max(0, rows.length - 1) * GAP;

function plan(item, props) {
  const entries = list(props.items).map((entry) => text(entry).trim());
  const marks = list(props.checked);
  const checked = marks.length === entries.length && entries.length > 0 ? marks.map(Boolean) : null;
  const tally = checked ? `${checked.filter(Boolean).length}/${entries.length}` : '';
  return {
    entries, checked, tally,
    above: aboveOf(props, COLUMN),
    titleLines: wrap(titleOf(item), COLUMN - (tally ? 10 + textWidth(tally) : 0), TITLE_LETTER, 2),
    rows: entries.slice(0, SHOWN).map((entry) => entryLines(entry, COLUMN)),
  };
}

/** A tick box shows a mark and takes no click. */
const box = (done, words) => s('svg', { class: done ? 'list-box is-done' : 'list-box', viewBox: '0 0 12 12', width: 12, height: 12, role: 'img', 'aria-label': done ? words.done : words.notDone },
  s('rect', { x: 0.75, y: 0.75, width: 10.5, height: 10.5, rx: 2.5 }),
  done && s('path', { d: 'M3.2 6.2 5.2 8.2 8.9 4' }));

export const entry = (label, done, lines, words) => h('li', { class: done ? 'is-done' : false },
  done === undefined ? h('span', { class: 'list-dot', 'aria-hidden': 'true' }) : box(done, words),
  say('span', lines, label));

export const shows = [];

export function size(item, props) {
  const { entries, above, titleLines, rows } = plan(item, props);
  return [WIDTH, FRAME + titleLines * TITLE + above.height + (rows.length ? 10 + stacked(rows) : 0) + (entries.length > SHOWN ? 8 + TEXT : 0)];
}

export function draw(item, props) {
  const { entries, checked, tally, above, titleLines, rows } = plan(item, props);
  return [
    h('div', { class: 'list-head' },
      say('div', `card-title clamp-${titleLines}`, titleOf(item)),
      tally && h('span', { class: 'card-tag list-tally', title: wordsOf(item).tally(...tally.split('/')), text: tally })),
    drawAbove(above),
    rows.length > 0 && h('ul', { class: 'list' }, rows.map((lines, i) => entry(entries[i], checked?.[i], `clamp-${lines}`, wordsOf(item)))),
    entries.length > SHOWN && andMore(entries.length - SHOWN, item),
  ];
}

/** A pasted line's bullet, number or tick box. */
const BULLET = /^(?:(?:[-*•·]|\d+[.)、]|\[[ xX]\])\s*)+/;

/**
 * Each entry as the item's text writes it: a line of the text that has a bullet and starts with
 * the entry as a whole word, but says more, stands in for it, as `- Her ration book from 1946 (two
 * coupons still attached)` does for `Her ration book from 1946`. So the opened list says it whole, and once.
 */
export function written(item, entries) {
  const lines = text(item.text).split('\n').map((line) => line.trim()).filter((line) => BULLET.test(line)).map((line) => line.replace(BULLET, '').trim());
  return entries.map((label) => (!label || lines.includes(label) ? label : lines.find((line) => line.startsWith(label) && !/[\p{L}\p{N}]/u.test(line[label.length])) ?? label));
}

export function detail(item, props) {
  const { entries, checked } = plan(item, props);
  return [h('ul', { class: 'list is-full' }, written(item, entries).map((label, i) => entry(label, checked?.[i], '', wordsOf(item))))];
}
