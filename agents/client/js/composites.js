import { h } from './dom.js';

const PAD = 18;
const HEAD = 40;

/** Members side by side, tops aligned. Offsets are card centres from the block's top-left corner. */
function row(ids, sizes, { gap, left = PAD, top = HEAD }) {
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

function grid(ids, sizes, { columns, gap }) {
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

const squarish = (n) => (n <= 3 ? n : n === 4 ? 2 : 3);

/**
 * Every way several sibling cards can be drawn as one arrangement.
 * Each returns the block's size, where each member sits, and the marks drawn behind the cards.
 */
export const COMPOSITES = {
  gallery: {
    name: 'Gallery',
    arrange: (group, ids, sizes) => grid(ids, sizes, { columns: Number(group.props.columns) || squarish(ids.length), gap: 12 }),
  },
  timeline: {
    name: 'Timeline',
    arrange(group, ids, sizes) {
      const { at, right, tall } = row(ids, sizes, { gap: 28 });
      const axis = HEAD + tall + 20;
      return {
        at, w: right + PAD, h: axis + 38,
        marks: [
          h('div', { class: 'tl-axis', style: { left: `${PAD}px`, top: `${axis}px`, width: `${right - PAD}px` } }),
          ids.map((id) => h('div', { class: 'tl-tick', style: { left: `${at.get(id).x}px`, top: `${axis}px` } },
            h('span', { text: String(group.props.labels?.[id] ?? '') }))),
        ],
      };
    },
  },
  comparison: {
    name: 'Comparison',
    arrange(group, ids, sizes) {
      const label = 116;
      const rowH = 44;
      const criteria = Array.isArray(group.props.criteria) ? group.props.criteria : [];
      const { at, right, tall } = row(ids, sizes, { gap: 16, left: PAD + label });
      const top = HEAD + tall + 12;
      return {
        at, w: right + PAD, h: top + criteria.length * rowH + PAD,
        marks: criteria.map((criterion, i) =>
          h('div', { class: 'cmp-row', style: { left: `${PAD}px`, top: `${top + i * rowH}px`, width: `${right - PAD}px`, height: `${rowH}px` } },
            h('div', { class: 'cmp-label clamp-2', style: { width: `${label - 10}px` }, text: String(criterion) }),
            ids.map((id) => h('div', {
              class: 'cmp-cell clamp-2',
              style: { left: `${at.get(id).x - sizes.get(id)[0] / 2 - PAD}px`, width: `${sizes.get(id)[0]}px` },
              text: String(group.props.cells?.[id]?.[i] ?? '') || '–',
            })))),
      };
    },
  },
  sequence: {
    name: 'In order',
    arrange(group, ids, sizes) {
      const gap = 44;
      const { at, right, tall } = row(ids, sizes, { gap });
      return {
        at, w: right + PAD, h: HEAD + tall + PAD,
        marks: ids.slice(1).map((id) => {
          const [w, hgt] = sizes.get(id);
          return h('div', { class: 'seq-arrow', style: { left: `${at.get(id).x - w / 2 - gap}px`, top: `${at.get(id).y - hgt / 2 + 34}px`, width: `${gap}px` }, text: '→' });
        }),
      };
    },
  },
  cluster: {
    name: 'Cluster',
    title: (group) => group.props.theme || group.title,
    arrange: (group, ids, sizes) => grid(ids, sizes, { columns: ids.length <= 4 ? 2 : 3, gap: 8 }),
  },
  stack: {
    name: 'Pile',
    canOpen: true,
    arrange(group, ids, sizes, open) {
      if (open) return grid(ids, sizes, { columns: squarish(ids.length), gap: 12 });
      const w = Math.max(...ids.map((id) => sizes.get(id)[0]));
      const hgt = Math.max(...ids.map((id) => sizes.get(id)[1]));
      const fan = 7;
      const shown = Math.min(ids.length, 3);
      const at = new Map();
      ids.forEach((id, i) => {
        const lift = Math.min(i, shown - 1) * fan;
        at.set(id, { x: PAD + w / 2 + lift, y: HEAD + hgt / 2 + lift });
      });
      return { at, w: PAD * 2 + w + (shown - 1) * fan, h: HEAD + hgt + (shown - 1) * fan + PAD, under: new Set(ids.slice(1)), buried: new Set(ids.slice(shown)) };
    },
  },
};

export function arrange(group, ids, sizes, open) {
  const kind = COMPOSITES[group.composite] ?? COMPOSITES.cluster;
  const made = kind.arrange(group, ids, sizes, open);
  return {
    under: new Set(), buried: new Set(), marks: [],
    ...made,
    label: kind.name,
    title: (kind.title ? kind.title(group) : group.title) || kind.name,
    canOpen: Boolean(kind.canOpen),
  };
}
