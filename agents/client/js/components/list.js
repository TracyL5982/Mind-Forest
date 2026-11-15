import { h, s } from '../dom.js';
import { COLUMN, WIDTH, aboveRows, drawFace, lay, list, metaWidth, say, text, titleRow } from './shared.js';
import { wordsOf } from '../words.js';

/** A mark and the gap after it. */
const MARK = 20;
const GAP = 5;
/** The most lines an entry is given on the face. */
const ENTRY_LINES = 2;

function plan(props) {
  const entries = list(props.items).map((entry) => text(entry).trim());
  const marks = list(props.checked);
  const checked = marks.length === entries.length && entries.length > 0 ? marks.map(Boolean) : null;
  return { entries, checked, tally: checked ? `${checked.filter(Boolean).length}/${entries.length}` : '' };
}

/**
 * The title, with a checklist's tally beside it, the lines the item writes over the list, then each entry whole on up to two
 * lines beside its mark, as many as the face has room for. The cue counts the entries left out.
 */
function face(item, props) {
  const { entries, checked, tally } = plan(props);
  const words = wordsOf(item);
  const room = tally ? 10 + metaWidth(tally) : 0;
  const head = titleRow(item, { column: COLUMN - room });
  return lay([
    { ...head, draw: (row) => h('div', { class: 'list-head' }, head.draw(row), tally && h('span', { class: 'card-tag list-tally', title: words.tally(...tally.split('/')), text: tally })) },
    ...aboveRows(props),
    ...entries.map((label, i) => ({
      words: label, column: COLUMN - MARK, most: ENTRY_LINES, unit: true, gap: i === 0 ? 10 : GAP,
      draw: (row) => entry(row.words, checked?.[i], '', words, 'div'),
    })),
  ], { words, cue: (left) => (left > 0 ? words.cue.left(left) : '') });
}

export function size(item, props) {
  return [WIDTH, face(item, props).height];
}

export const draw = (item, props) => drawFace(face(item, props));

/** A tick box shows a mark and takes no click. */
const box = (done, words) => s('svg', { class: done ? 'list-box is-done' : 'list-box', viewBox: '0 0 12 12', width: 12, height: 12, role: 'img', 'aria-label': done ? words.done : words.notDone },
  s('rect', { x: 0.75, y: 0.75, width: 10.5, height: 10.5, rx: 2.5 }),
  done && s('path', { d: 'M3.2 6.2 5.2 8.2 8.9 4' }));

export const entry = (label, done, cls, words, tag = 'li') => h(tag, { class: done ? 'list-entry is-done' : 'list-entry' },
  done === undefined ? h('span', { class: 'list-dot', 'aria-hidden': 'true' }) : box(done, words),
  say('span', cls, label));

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
  const { entries, checked } = plan(props);
  return [h('ul', { class: 'list is-full' }, written(item, entries).map((label, i) => entry(label, checked?.[i], '', wordsOf(item))))];
}
