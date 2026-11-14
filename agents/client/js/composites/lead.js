import { h } from '../dom.js';
import { HEAD, PAD } from './shared.js';

export const name = 'Lead';

/** The room between the lead and its support, which holds a hairline, the room between two cards that support it, and the most of them in a row. */
const UNDER = 28;
const GAP = 16;
const ACROSS = 4;

/** The first member alone on the first row, the others in rows of up to four beneath it. Each row is centred in the block. */
export function arrange(group, ids, sizes) {
  const [first, ...rest] = ids;
  const rows = [];
  for (let at = 0; at < rest.length; at += ACROSS) rows.push(rest.slice(at, at + ACROSS));
  const wide = (row) => row.reduce((sum, id) => sum + sizes.get(id)[0], 0) + GAP * (row.length - 1);
  const [lw, lh] = sizes.get(first);
  const inner = Math.max(lw, ...rows.map(wide));
  const at = new Map([[first, { x: PAD + inner / 2, y: HEAD + lh / 2 }]]);
  let top = HEAD + Math.ceil(lh) + UNDER;
  for (const row of rows) {
    let x = PAD + (inner - wide(row)) / 2;
    for (const id of row) {
      const [w, hgt] = sizes.get(id);
      at.set(id, { x: x + w / 2, y: top + hgt / 2 });
      x += w + GAP;
    }
    top += Math.ceil(Math.max(...row.map((id) => sizes.get(id)[1]))) + GAP;
  }
  return {
    at, w: PAD * 2 + inner, h: (rows.length ? top - GAP : top - UNDER) + PAD,
    marks: rows.length ? [h('div', { class: 'lead-rule', style: { left: `${PAD}px`, top: `${HEAD + Math.ceil(lh) + UNDER / 2}px`, width: `${inner}px` } })] : [],
  };
}
