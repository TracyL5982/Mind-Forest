import { h } from '../dom.js';
import { text } from '../components/shared.js';
import { HEAD, LINE, PAD, linesOf, row } from './shared.js';

export const name = 'Before and after';

/** The room between two states, which holds the arrow and the change, its side padding, and the arrow's line. */
const STEP = 148;
const INSET = 12;
const ARROW = 24;

export function arrange(group, ids, sizes) {
  const change = (id) => text(group.props.changes?.[id]).trim();
  const { at, right, tall } = row(ids, sizes, { gap: STEP });
  const steps = ids.slice(1).map((id, i) => {
    const lines = linesOf(change(id), STEP - 2 * INSET);
    const height = ARROW + lines * LINE;
    // A step sits in the middle of the shorter of the two states it joins, and from the top when it is taller than that.
    const short = Math.min(sizes.get(ids[i])[1], sizes.get(id)[1]);
    return { id, lines, height, top: HEAD + Math.max(0, (short - height) / 2) };
  });
  const inner = Math.max(tall, ...steps.map((step) => step.top - HEAD + step.height));
  return {
    at, w: right + PAD, h: HEAD + inner + PAD,
    marks: steps.map(({ id, lines, height, top }) =>
      h('div', { class: 'ba-step', style: { left: `${at.get(id).x - sizes.get(id)[0] / 2 - STEP}px`, top: `${top}px`, width: `${STEP}px`, height: `${height}px` } },
        h('div', { class: 'ba-arrow', text: '→' }),
        lines > 0 && h('div', { class: 'arr-words ba-change', dir: 'auto', style: { height: `${lines * LINE}px` }, text: change(id) }))),
  };
}
