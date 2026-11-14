import { h } from '../dom.js';
import { textWidth } from '../components/shared.js';
import { cardsOf, measure, place, shapeOk } from '../core/layout.js';
import * as cluster from './cluster.js';
import { HEAD, PAD } from './shared.js';

export const name = 'Layout';

/** The structure as placed from the top left of the block's content, or null when it is to be drawn as a cluster. */
export function laidOut(group, ids, sizes) {
  const tree = group.props.tree;
  const named = tree ? cardsOf(tree) : [];
  if (named.length !== ids.length || !named.every((id) => ids.includes(id) && sizes.has(id))) return null;
  const placed = place(measure(tree, (id) => sizes.get(id), textWidth));
  return shapeOk(placed) ? placed : null;
}

/** A mark is placed inside the pane's 1 px border, and cards are not, so a mark moves 1 px up and left to line up with them. */
const BORDER = 1;
const box = ({ x, y, w, h: tall }) => ({ left: `${PAD + x - BORDER}px`, top: `${HEAD + y - BORDER}px`, width: `${w}px`, height: `${tall}px` });

const MARKS = {
  label: (mark) => h('div', { class: 'lay-label', dir: 'auto', style: box(mark.at), text: mark.text }),
  frame: (mark) => h('div', { class: 'lay-frame', style: box(mark.at) }),
  join: (mark) => h('div', { class: `lay-join is-${mark.join}${mark.across ? ' is-across' : ''}`, style: box(mark.at), text: mark.join === 'arrow' ? (mark.across ? '→' : '↓') : '' }),
};

/** A structure that does not hold for these members, or whose block would look wrong, is drawn as a cluster. */
export function arrange(group, ids, sizes) {
  const placed = laidOut(group, ids, sizes);
  if (!placed) return { ...cluster.arrange(group, ids, sizes), label: cluster.name };
  const at = new Map([...placed.cards].map(([id, card]) => [id, { x: PAD + card.x + card.w / 2, y: HEAD + card.y + card.h / 2 }]));
  return { at, w: placed.w + 2 * PAD, h: HEAD + placed.h + PAD, marks: placed.marks.map((mark) => MARKS[mark.kind](mark)) };
}
