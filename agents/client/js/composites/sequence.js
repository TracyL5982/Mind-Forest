import { h } from '../dom.js';
import { HEAD, PAD, row } from './shared.js';

export const name = 'In order';

export function arrange(group, ids, sizes) {
  const gap = 44;
  const { at, right, tall } = row(ids, sizes, { gap });
  return {
    at, w: right + PAD, h: HEAD + tall + PAD,
    marks: ids.slice(1).map((id) => {
      const [w, hgt] = sizes.get(id);
      return h('div', { class: 'seq-arrow', style: { left: `${at.get(id).x - w / 2 - gap}px`, top: `${at.get(id).y - hgt / 2 + 34}px`, width: `${gap}px` }, text: '→' });
    }),
  };
}
