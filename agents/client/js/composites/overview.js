import { HEAD, PAD, row } from './shared.js';

export const name = 'Overview';

const GAP = 12;

/** The figures side by side, and under them the chart, which is the last member. */
export function arrange(group, ids, sizes) {
  const plot = ids.at(-1);
  const { at, right, tall } = row(ids.slice(0, -1), sizes, { gap: GAP });
  const [w, hgt] = sizes.get(plot);
  const top = ids.length > 1 ? HEAD + Math.ceil(tall) + GAP : HEAD;
  at.set(plot, { x: PAD + w / 2, y: top + hgt / 2 });
  return { at, w: Math.max(right, PAD + w) + PAD, h: top + hgt + PAD };
}
