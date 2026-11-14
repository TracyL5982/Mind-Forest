import { h } from '../dom.js';
import { HEAD, PAD, row } from './shared.js';

export const name = 'Comparison';

export function arrange(group, ids, sizes) {
  const label = 116;
  const rowH = 44;
  const criteria = Array.isArray(group.props.criteria) ? group.props.criteria : [];
  const { at, right, tall } = row(ids, sizes, { gap: 16, left: PAD + label });
  const top = HEAD + tall + 12;
  return {
    at, w: right + PAD, h: top + criteria.length * rowH + PAD,
    marks: criteria.map((criterion, i) =>
      h('div', { class: 'cmp-row', style: { left: `${PAD}px`, top: `${top + i * rowH}px`, width: `${right - PAD}px`, height: `${rowH}px` } },
        h('div', { class: 'cmp-label clamp-2', style: { width: `${label - 10}px` }, text: String(criterion) }),
        ids.map((id) => h('div', {
          class: 'cmp-cell clamp-2',
          style: { left: `${at.get(id).x - sizes.get(id)[0] / 2 - PAD}px`, width: `${sizes.get(id)[0]}px` },
          text: String(group.props.cells?.[id]?.[i] ?? '') || '–',
        })))),
  };
}
