import { HEAD, PAD, grid, squarish } from './shared.js';

export const name = 'Pile';

export const canOpen = true;

export function arrange(group, ids, sizes, open) {
  if (open) return grid(ids, sizes, { columns: squarish(ids.length), gap: 12 });
  const [w, hgt] = sizes.get(ids[0]);
  const fan = 7;
  const shown = Math.min(ids.length, 3);
  const at = new Map();
  ids.forEach((id, i) => {
    const lift = Math.min(i, shown - 1) * fan;
    at.set(id, { x: PAD + w / 2 + lift, y: HEAD + hgt / 2 + lift });
  });
  return { at, w: PAD * 2 + w + (shown - 1) * fan, h: HEAD + hgt + (shown - 1) * fan + PAD, under: new Set(ids.slice(1)), buried: new Set(ids.slice(shown)), cover: [w, hgt] };
}
