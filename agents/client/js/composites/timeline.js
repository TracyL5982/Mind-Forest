import { h } from '../dom.js';
import { HEAD, PAD, row } from './shared.js';

export const name = 'Timeline';

export function arrange(group, ids, sizes) {
  const { at, right, tall } = row(ids, sizes, { gap: 28 });
  const axis = HEAD + tall + 20;
  return {
    at, w: right + PAD, h: axis + 38,
    marks: [
      h('div', { class: 'tl-axis', style: { left: `${PAD}px`, top: `${axis}px`, width: `${right - PAD}px` } }),
      ids.map((id) => h('div', { class: 'tl-tick', style: { left: `${at.get(id).x}px`, top: `${axis}px` } },
        h('span', { text: String(group.props.labels?.[id] ?? '') }))),
    ],
  };
}
