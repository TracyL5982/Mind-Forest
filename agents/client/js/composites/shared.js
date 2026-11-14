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

/** Members in rows of `columns`. Columns share one width. Each row is as tall as its tallest card. */
export function grid(ids, sizes, { columns, gap }) {
  const cellW = Math.max(...ids.map((id) => sizes.get(id)[0]));
  const at = new Map();
  let top = HEAD;
  for (let start = 0; start < ids.length; start += columns) {
    const row = ids.slice(start, start + columns);
    const rowH = Math.max(...row.map((id) => sizes.get(id)[1]));
    row.forEach((id, i) => at.set(id, { x: PAD + i * (cellW + gap) + cellW / 2, y: top + rowH / 2 }));
    top += rowH + gap;
  }
  const used = Math.min(columns, ids.length);
  return { at, w: PAD * 2 + used * cellW + (used - 1) * gap, h: top - gap + PAD };
}

export const squarish = (n) => (n <= 3 ? n : n === 4 ? 2 : 3);
