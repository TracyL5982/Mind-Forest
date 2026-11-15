import { h } from '../dom.js';
import { GAP, WIDTH, aboveRows, drawFace, headsRow, lay, list, say, text, titleRow, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

const MOST = 8;
/** The one bar that holds every part. */
const BAR = 16;
const PERCENT = new Set(['%', '％']);

const exact = (value) => value.toLocaleString('en', { maximumFractionDigits: 6 });
/** A unit written once under the title: any but a percent sign, which each share carries. */
const named = (props) => {
  const unit = text(props.unit).trim();
  return PERCENT.has(unit) ? '' : unit;
};

/**
 * The parts as they are written. A percent sign is written on each share, and any other unit once,
 * under the title. `bar` is the part's share of the whole, from 0 to 1, so the bars of a card add up
 * to one full track. A part whose share is written as 0 has no bar, and so has every part when the
 * whole is 0.
 */
export function parts(props) {
  const percent = PERCENT.has(text(props.unit).trim());
  const values = list(props.values);
  const rows = list(props.labels).slice(0, MOST).map((label, i) => {
    const value = Number.isFinite(values[i]) && values[i] > 0 ? values[i] : 0;
    return { label: text(label).trim(), value, written: `${exact(value)}${percent ? '%' : ''}` };
  });
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return { rows: rows.map((row) => ({ ...row, bar: exact(row.value) === '0' ? 0 : row.value / total })), unit: named(props), total };
}

/** The one bar split into the parts by their shares, the largest in the accent, with no text. */
const split = (rows, largest) => h('div', { class: 'breakdown-split', 'aria-hidden': 'true' },
  rows.map((row) => row.bar > 0 && h('span', { class: row === largest ? 'is-largest' : '', style: { flexGrow: String(row.bar) } })));

/**
 * A designed preview, because no label of a part reads beside its bar at the face's sizes: the title, the lines the item writes
 * over the parts and the heads row of their table, one bar split into the parts, the largest part as the item writes its label
 * and its share, and the cue, which counts the parts the opened card shows.
 */
function face(item, props) {
  const words = wordsOf(item);
  const { rows, unit } = parts(props);
  const largest = rows.reduce((best, row) => (best && best.value >= row.value ? best : row), null);
  const said = largest && [largest.label, largest.written, unit].filter(Boolean).join(' ');
  return lay([
    titleRow(item),
    ...aboveRows(props),
    headsRow(props),
    largest && { tall: BAR, gap: GAP, draw: () => split(rows, largest) },
    said && { words: said, measure: 'body', most: 2, gap: GAP, draw: wordsIn('breakdown-largest') },
  ], { words, more: rows.length > 0, cue: () => (rows.length > 0 ? words.cue.parts(rows.length) : '') });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

const bars = (rows, columns) => h('div', { class: 'breakdown', style: { gridTemplateColumns: columns } }, rows.map((row) => [
  say('div', 'breakdown-label', row.label),
  h('div', { class: 'breakdown-track' }, row.bar > 0 && h('div', { class: 'breakdown-bar', style: { width: `${row.bar * 100}%` } })),
  h('div', { class: 'breakdown-share', text: row.written }),
]));

/** Each part's bar with its label whole, and each share of the whole beside a value that is no percentage. */
export function detail(item, props) {
  const { rows, unit, total } = parts(props);
  const percent = rows.some((row) => row.written.endsWith('%'));
  const shared = rows.map((row) => ({ ...row, written: percent ? row.written : `${row.written} · ${exact(Number(((row.value / (total || 1)) * 100).toFixed(1)))}%` }));
  return [
    h('div', { class: 'detail-chart detail-breakdown' },
      unit && say('div', 'card-tag', unit),
      bars(shared, 'fit-content(45%) minmax(48px, 1fr) auto')),
  ];
}
