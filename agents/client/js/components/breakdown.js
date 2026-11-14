import { h } from '../dom.js';
import { FRAME, SIDES, TEXT, TITLE, TITLE_LETTER, list, say, text, textWidth, wrap } from './shared.js';

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

/** The parts as they are written. A percent sign is written on each share, and any other unit once, under the title. */
function parts(props) {
  const unit = text(props.unit).trim();
  const percent = PERCENT.has(unit);
  const values = list(props.values);
  const rows = list(props.labels).slice(0, MOST).map((label, i) => {
    const value = Number.isFinite(values[i]) && values[i] > 0 ? values[i] : 0;
    return { label: text(label), value, written: `${exact(value)}${percent ? '%' : ''}` };
  });
  return { rows, unit: percent ? '' : unit, largest: Math.max(0, ...rows.map((row) => row.value)), total: rows.reduce((sum, row) => sum + row.value, 0) };
}

export const shows = [];

export function size(item, props) {
  const { rows, unit } = parts(props);
  return [WIDTH, FRAME + wrap(item.title || 'Untitled', COLUMN, TITLE_LETTER, 2) * TITLE + (unit ? TEXT : 0) + (rows.length ? 10 + rows.length * TEXT + (rows.length - 1) * GAP : 0)];
}

/** Every share is written whole, so the labels give way first and then the bars. */
export function draw(item, props) {
  const { rows, unit, largest } = parts(props);
  const shares = Math.max(0, ...rows.map((row) => textWidth(row.written)));
  const labels = Math.min(Math.max(0, ...rows.map((row) => textWidth(row.label))), LABEL.most, Math.max(LABEL.least, COLUMN - 2 * BESIDE - shares - BAR));
  return [
    h('div', { class: 'chart-head' },
      say('div', `card-title clamp-${wrap(item.title || 'Untitled', COLUMN, TITLE_LETTER, 2)}`, item.title || 'Untitled'),
      unit && say('div', 'card-tag clamp-1', unit)),
    rows.length > 0 && h('div', { class: 'breakdown', style: { gridTemplateColumns: `${labels}px minmax(0, 1fr) ${shares}px` } }, rows.map((row) => [
      say('div', 'breakdown-label clamp-1', row.label),
      h('div', { class: 'breakdown-track' }, row.value > 0 && h('div', { class: 'breakdown-bar', style: { width: `${(row.value / largest) * 100}%` } })),
      h('div', { class: 'breakdown-share', text: row.written }),
    ])),
  ];
}

/** Every label whole beside its value, and beside its share of the whole when the values are not percentages. */
export function detail(item, props) {
  const { rows, unit, total } = parts(props);
  const share = (value) => (unit || !rows.some((row) => row.written.endsWith('%')) ? ` · ${exact(Number(((value / (total || 1)) * 100).toFixed(1)))}%` : '');
  return [
    h('div', { class: 'detail-chart' },
      unit && say('div', 'card-tag', unit),
      h('table', { class: 'chart-table' }, h('tbody', null, rows.map((row) =>
        h('tr', null, say('th', '', row.label), h('td', { text: `${row.written}${share(row.value)}` })))))),
  ];
}
