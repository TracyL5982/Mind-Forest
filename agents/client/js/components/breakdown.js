import { h } from '../dom.js';
import { FRAME, SIDES, TEXT, TITLE, TITLE_LETTER, list, say, text, textWidth, wrap, titleOf } from './shared.js';

const WIDTH = 300;
const COLUMN = WIDTH - SIDES;
const MOST = 8;
const GAP = 7;
/** The gap either side of a bar, the least a bar is left, and the least and the most a label may take. */
const BESIDE = 8;
const BAR = 72;
const LABEL = { least: 48, most: 128 };
const PERCENT = new Set(['%', '％']);

const exact = (value) => value.toLocaleString('en', { maximumFractionDigits: 6 });

/**
 * The parts as they are written. A percent sign is written on each share, and any other unit once,
 * under the title. `bar` is the part's share of the whole, from 0 to 1, so the bars of a card add up
 * to one full track. A part whose share is written as 0 has no bar, and so has every part when the
 * whole is 0.
 */
export function parts(props) {
  const unit = text(props.unit).trim();
  const percent = PERCENT.has(unit);
  const values = list(props.values);
  const rows = list(props.labels).slice(0, MOST).map((label, i) => {
    const value = Number.isFinite(values[i]) && values[i] > 0 ? values[i] : 0;
    return { label: text(label).trim(), value, written: `${exact(value)}${percent ? '%' : ''}` };
  });
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return { rows: rows.map((row) => ({ ...row, bar: exact(row.value) === '0' ? 0 : row.value / total })), unit: percent ? '' : unit, total };
}

export const shows = [];

export function size(item, props) {
  const { rows, unit } = parts(props);
  return [WIDTH, FRAME + wrap(titleOf(item), COLUMN, TITLE_LETTER, 2) * TITLE + (unit ? TEXT : 0) + (rows.length ? 10 + rows.length * TEXT + (rows.length - 1) * GAP : 0)];
}

const bars = (rows, columns, clamped) => h('div', { class: 'breakdown', style: { gridTemplateColumns: columns } }, rows.map((row) => [
  say('div', `breakdown-label ${clamped}`, row.label),
  h('div', { class: 'breakdown-track' }, row.bar > 0 && h('div', { class: 'breakdown-bar', style: { width: `${row.bar * 100}%` } })),
  h('div', { class: 'breakdown-share', text: row.written }),
]));

/** Every share is written whole, so the labels give way first and then the bars. */
export function draw(item, props) {
  const { rows, unit } = parts(props);
  const shares = Math.max(0, ...rows.map((row) => textWidth(row.written)));
  const labels = Math.min(Math.max(0, ...rows.map((row) => textWidth(row.label))), LABEL.most, Math.max(LABEL.least, COLUMN - 2 * BESIDE - shares - BAR));
  return [
    h('div', { class: 'chart-head' },
      say('div', `card-title clamp-${wrap(titleOf(item), COLUMN, TITLE_LETTER, 2)}`, titleOf(item)),
      unit && say('div', 'card-tag clamp-1', unit)),
    rows.length > 0 && bars(rows, `${labels}px minmax(0, 1fr) ${shares}px`, 'clamp-1'),
  ];
}

/** The same bars with every label whole, and each share of the whole beside a value that is no percentage. */
export function detail(item, props) {
  const { rows, unit, total } = parts(props);
  const percent = rows.some((row) => row.written.endsWith('%'));
  const shared = rows.map((row) => ({ ...row, written: percent ? row.written : `${row.written} · ${exact(Number(((row.value / (total || 1)) * 100).toFixed(1)))}%` }));
  return [
    h('div', { class: 'detail-chart detail-breakdown' },
      unit && say('div', 'card-tag', unit),
      bars(shared, 'fit-content(45%) minmax(48px, 1fr) auto', '')),
  ];
}
