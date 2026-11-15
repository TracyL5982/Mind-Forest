import { TEXT_LETTER, wrap } from '../components/shared.js';

export const PAD = 18;
export const HEAD = 40;
/** The line of the words an arrangement sets beside its cards, in the field's text size, `--lead-text` in style.css. */
export const LINE = 17;

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

/**
 * Members in rows of `columns`. Columns share one width, and each row is as tall as its tallest
 * card. Every card sits at the top left of its cell, and each cell starts on a whole px.
 */
export function grid(ids, sizes, { columns, gap }) {
  const cellW = Math.ceil(Math.max(...ids.map((id) => sizes.get(id)[0])));
  const at = new Map();
  let top = HEAD;
  for (let start = 0; start < ids.length; start += columns) {
    const row = ids.slice(start, start + columns);
    row.forEach((id, i) => {
      const [w, hgt] = sizes.get(id);
      at.set(id, { x: PAD + i * (cellW + gap) + w / 2, y: top + hgt / 2 });
    });
    top += Math.ceil(Math.max(...row.map((id) => sizes.get(id)[1]))) + gap;
  }
  const used = Math.min(columns, ids.length);
  return { at, w: PAD * 2 + used * cellW + (used - 1) * gap, h: top - gap + PAD };
}

export const squarish = (n) => (n <= 3 ? n : n === 4 ? 2 : 3);

/** The lines a line of words set beside a card takes in a column `width` px wide, counted as the structured cards count theirs. None for no words. */
export const linesOf = (str, width) => (str ? wrap(str, Math.floor(width), TEXT_LETTER, Infinity) : 0);
