import { h } from '../dom.js';
import { text, textWidth } from '../components/shared.js';
import { HEAD, LINE, PAD, linesOf } from './shared.js';

export const name = 'Matrix';

/** The room between two cells, the gutter that holds the upright axis, the band under the cells that holds the level one, and the room between a card and its line. */
const GAP = 20;
const AXIS = 24;
const UNDER = 18;
const BELOW = 8;

/**
 * Four members on a 2 by 2, in the order top left, top right, bottom left, bottom right, each card with its line under it. A column
 * is as wide as its widest card and a row as tall as its tallest card and line, and each card and its line sit in the middle of
 * their cell. The upright axis runs up the left side with its name above it, and the level one runs along the bottom with its name
 * under its right end.
 */
export function arrange(group, ids, sizes) {
  const [x, y] = [text(group.props.x).trim(), text(group.props.y).trim()];
  const placed = ids.slice(0, 4).map((id) => {
    const [w, hgt] = sizes.get(id);
    const reason = text(group.props.reasons?.[id]).trim();
    const lines = linesOf(reason, w);
    return { id, w, hgt, reason, lines, tall: hgt + (lines ? BELOW + lines * LINE : 0) };
  });
  const at = (i) => placed[i] ?? { w: 0, tall: 0 };
  const cols = [0, 1].map((c) => Math.ceil(Math.max(at(c).w, at(c + 2).w)));
  const rows = [0, 1].map((r) => Math.ceil(Math.max(at(2 * r).tall, at(2 * r + 1).tall)));
  const left = PAD + AXIS;
  const top = HEAD + (y ? LINE + 6 : 0);
  const gridW = cols[0] + GAP + cols[1];
  const gridH = rows[0] + GAP + rows[1];
  const centres = new Map();
  const lines = [];
  placed.forEach(({ id, w, hgt, reason, lines: count, tall }, i) => {
    const [c, r] = [i % 2, Math.floor(i / 2)];
    const cellLeft = left + (c ? cols[0] + GAP : 0) + (cols[c] - w) / 2;
    const cellTop = top + (r ? rows[0] + GAP : 0) + (rows[r] - tall) / 2;
    centres.set(id, { x: cellLeft + w / 2, y: cellTop + hgt / 2 });
    if (count) lines.push(h('div', { class: 'arr-words mx-why', dir: 'auto', style: { left: `${cellLeft}px`, top: `${cellTop + hgt + BELOW}px`, width: `${w}px`, height: `${count * LINE}px` }, text: reason }));
  });
  const bottom = top + gridH;
  const inner = Math.max(AXIS + gridW, textWidth(y), textWidth(x));
  return {
    at: centres, w: PAD * 2 + inner, h: bottom + UNDER + (x ? LINE : 0) + PAD,
    marks: [
      h('div', { class: 'mx-split is-across', style: { left: `${left}px`, top: `${top + rows[0] + GAP / 2}px`, width: `${gridW}px` } }),
      h('div', { class: 'mx-split is-down', style: { left: `${left + cols[0] + GAP / 2}px`, top: `${top}px`, height: `${gridH}px` } }),
      h('div', { class: 'mx-axis is-up', style: { left: `${PAD + AXIS / 2}px`, top: `${top}px`, height: `${gridH + UNDER / 2}px` } }),
      h('div', { class: 'mx-axis is-right', style: { left: `${PAD + AXIS / 2}px`, top: `${bottom + UNDER / 2}px`, width: `${AXIS / 2 + gridW}px` } }),
      y && h('div', { class: 'arr-words mx-name', dir: 'auto', style: { left: `${PAD}px`, top: `${HEAD}px`, width: `${textWidth(y)}px` }, text: y }),
      x && h('div', { class: 'arr-words mx-name', dir: 'auto', style: { left: `${PAD + Math.max(AXIS + gridW, textWidth(x)) - textWidth(x)}px`, top: `${bottom + UNDER}px`, width: `${textWidth(x)}px` }, text: x }),
      lines,
    ],
  };
}
