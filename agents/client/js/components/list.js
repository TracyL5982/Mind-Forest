import { h, s } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, andMore, fold, list, say, textWidth } from './shared.js';

const WIDTH = 256;
const COLUMN = WIDTH - SIDES;
const SHOWN = 6;
/** A mark and the gap after it. */
const MARK = 20;
const GAP = 5;

function plan(item, props) {
  const entries = list(props.items).map(String);
  const marks = list(props.checked);
  const checked = marks.length === entries.length && entries.length > 0 ? marks.map(Boolean) : null;
  const tally = checked ? `${checked.filter(Boolean).length}/${entries.length}` : '';
  return {
    entries, checked, tally,
    titleLines: fold(item.title || 'Untitled', COLUMN - (tally ? 10 + textWidth(tally) : 0), TITLE_LETTER, 2),
    rows: entries.slice(0, SHOWN).map((entry) => fold(entry, COLUMN - MARK, TEXT_LETTER, 2)),
  };
}

/** A tick box shows a mark and takes no click. */
const box = (done) => s('svg', { class: done ? 'list-box is-done' : 'list-box', viewBox: '0 0 12 12', width: 12, height: 12, role: 'img', 'aria-label': done ? 'Done' : 'Not done' },
  s('rect', { x: 0.75, y: 0.75, width: 10.5, height: 10.5, rx: 2.5 }),
  done && s('path', { d: 'M3.2 6.2 5.2 8.2 8.9 4' }));

const entry = (label, done, lines) => h('li', { class: done ? 'is-done' : false },
  done === undefined ? h('span', { class: 'list-dot', 'aria-hidden': 'true' }) : box(done),
  say('span', lines, label));

export const shows = [];

export function size(item, props) {
  const { entries, titleLines, rows } = plan(item, props);
  const tall = rows.reduce((sum, lines) => sum + lines * TEXT, 0) + Math.max(0, rows.length - 1) * GAP;
  return [WIDTH, FRAME + titleLines * TITLE + (rows.length ? 10 + tall : 0) + (entries.length > SHOWN ? 8 + TEXT : 0)];
}

export function draw(item, props) {
  const { entries, checked, tally, titleLines, rows } = plan(item, props);
  return [
    h('div', { class: 'list-head' },
      say('div', `card-title clamp-${titleLines}`, item.title || 'Untitled'),
      tally && h('span', { class: 'card-tag list-tally', title: `${tally.replace('/', ' of ')} done`, text: tally })),
    rows.length > 0 && h('ul', { class: 'list' }, rows.map((lines, i) => entry(entries[i], checked?.[i], `clamp-${lines}`))),
    entries.length > SHOWN && andMore(entries.length - SHOWN),
  ];
}

export function detail(item, props) {
  const { entries, checked } = plan(item, props);
  return [h('ul', { class: 'list is-full' }, entries.map((label, i) => entry(label, checked?.[i], '')))];
}
