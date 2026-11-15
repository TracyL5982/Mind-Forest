import { h } from '../dom.js';
import { TEXT_LETTER, fold } from '../components/shared.js';
import { HEAD, LINE, PAD, row } from './shared.js';

export const name = 'Comparison';

const LABEL = 116;
/** A cell's side padding, and the room above and below a row's words. */
const INSET = 16;
const ROOM = 10;

export function arrange(group, ids, sizes) {
  const criteria = Array.isArray(group.props.criteria) ? group.props.criteria.map(String) : [];
  const { at, right, tall } = row(ids, sizes, { gap: 16, left: PAD + LABEL });
  const cell = (id, i) => String(group.props.cells?.[id]?.[i] ?? '') || '–';
  /** A row is as tall as the most lines any of its cells needs, up to two. */
  const rows = criteria.map((criterion, i) => ROOM + LINE * Math.max(
    fold(criterion, LABEL - 10, TEXT_LETTER, 2),
    ...ids.map((id) => fold(cell(id, i), Math.floor(sizes.get(id)[0]) - INSET, TEXT_LETTER, 2))));
  const tops = rows.map((_, i) => HEAD + tall + 12 + rows.slice(0, i).reduce((sum, tallness) => sum + tallness, 0));
  return {
    at, w: right + PAD, h: HEAD + tall + 12 + rows.reduce((sum, tallness) => sum + tallness, 0) + (rows.length ? PAD : PAD - 12),
    marks: criteria.map((criterion, i) =>
      h('div', { class: 'cmp-row', style: { left: `${PAD}px`, top: `${tops[i]}px`, width: `${right - PAD}px`, height: `${rows[i]}px` } },
        h('div', { class: 'cmp-label clamp-2', dir: 'auto', style: { width: `${LABEL - 10}px` }, text: criterion }),
        ids.map((id) => h('div', {
          class: 'cmp-cell clamp-2', dir: 'auto',
          style: { left: `${at.get(id).x - sizes.get(id)[0] / 2 - PAD}px`, width: `${sizes.get(id)[0]}px` },
          text: cell(id, i),
        })))),
  };
}
