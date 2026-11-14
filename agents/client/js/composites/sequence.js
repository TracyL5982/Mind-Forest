import { h } from '../dom.js';
import { HEAD, PAD, row } from './shared.js';

export const name = 'In order';

export function arrange(group, ids, sizes) {
  const gap = 44;
  const { at, right, tall } = row(ids, sizes, { gap });
  const short = Math.min(...ids.map((id) => sizes.get(id)[1]));
  return {
    at, w: right + PAD, h: HEAD + tall + PAD,
    marks: ids.slice(1).map((id) =>
      h('div', { class: 'seq-arrow', style: { left: `${at.get(id).x - sizes.get(id)[0] / 2 - gap}px`, top: `${HEAD + short / 2}px`, width: `${gap}px` }, text: '→' })),
  };
}
