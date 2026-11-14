import { HEAD, PAD } from './shared.js';

export const name = 'Moodboard';

const GAP = 12;

/**
 * Members in columns, each card at its own footprint. Each card goes under the shortest column so far, the leftmost of equals, and
 * a column is as wide as its widest card. Two columns for up to four members, three for up to nine, four past that.
 */
export function arrange(group, ids, sizes) {
  const count = Math.min(ids.length, ids.length <= 4 ? 2 : ids.length <= 9 ? 3 : 4);
  const columns = Array.from({ length: count }, () => ({ ids: [], tall: 0, wide: 0 }));
  for (const id of ids) {
    const [w, hgt] = sizes.get(id);
    const column = columns.reduce((low, next) => (next.tall < low.tall ? next : low));
    column.ids.push(id);
    column.tall += Math.ceil(hgt) + GAP;
    column.wide = Math.max(column.wide, Math.ceil(w));
  }
  const at = new Map();
  let left = PAD;
  for (const column of columns) {
    let top = HEAD;
    for (const id of column.ids) {
      const [w, hgt] = sizes.get(id);
      at.set(id, { x: left + w / 2, y: top + hgt / 2 });
      top += Math.ceil(hgt) + GAP;
    }
    left += column.wide + GAP;
  }
  return { at, w: left - GAP + PAD, h: HEAD + Math.max(...columns.map((column) => column.tall)) - GAP + PAD };
}
