export const PAD = 18;
export const HEAD = 40;

/** Members side by side, tops aligned. Offsets are card centres from the block's top-left corner. */
export function row(ids, sizes, { gap, left = PAD, top = HEAD }) {
  const at = new Map();
  let x = left;
  let tall = 0;
  for (const id of ids) {
    const [w, hgt] = sizes.get(id);
    at.set(id, { x: x + w / 2, y: top + hgt / 2 });
    x += w + gap;
    tall = Math.max(tall, hgt);
  }
  return { at, right: x - gap, tall };
}

export function grid(ids, sizes, { columns, gap }) {
  const cellW = Math.max(...ids.map((id) => sizes.get(id)[0]));
  const cellH = Math.max(...ids.map((id) => sizes.get(id)[1]));
  const at = new Map();
  ids.forEach((id, i) => {
    at.set(id, { x: PAD + (i % columns) * (cellW + gap) + cellW / 2, y: HEAD + Math.floor(i / columns) * (cellH + gap) + cellH / 2 });
  });
  const rows = Math.ceil(ids.length / columns);
  const used = Math.min(columns, ids.length);
  return { at, w: PAD * 2 + used * cellW + (used - 1) * gap, h: HEAD + rows * cellH + (rows - 1) * gap + PAD };
}

export const squarish = (n) => (n <= 3 ? n : n === 4 ? 2 : 3);
