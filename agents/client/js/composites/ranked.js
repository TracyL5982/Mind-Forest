import { h } from '../dom.js';
import { text } from '../components/shared.js';
import { HEAD, LINE, PAD, linesOf, row } from './shared.js';

export const name = 'Ranked';

/** The band above the cards that holds each one's number, the room between a card and its reason, and the room between two cards. */
const NUMBER = 30;
const BELOW = 8;
const GAP = 16;

export function arrange(group, ids, sizes) {
  const reason = (id) => text(group.props.reasons?.[id]).trim();
  const { at, right, tall } = row(ids, sizes, { gap: GAP, top: HEAD + NUMBER });
  const lines = new Map(ids.map((id) => [id, linesOf(reason(id), sizes.get(id)[0])]));
  const most = Math.max(0, ...lines.values());
  const below = HEAD + NUMBER + tall + BELOW;
  return {
    at, w: right + PAD, h: most > 0 ? below + most * LINE + PAD : HEAD + NUMBER + tall + PAD,
    marks: ids.map((id, i) => {
      const [w] = sizes.get(id);
      const left = at.get(id).x - w / 2;
      return [
        h('div', { class: `rank-n ${i === 0 ? 'is-first' : ''}`, style: { left: `${left}px`, top: `${HEAD}px` }, text: String(i + 1) }),
        lines.get(id) > 0 && h('div', { class: 'arr-words rank-why', dir: 'auto', style: { left: `${left}px`, top: `${below}px`, width: `${w}px`, height: `${lines.get(id) * LINE}px` }, text: reason(id) }),
      ];
    }),
  };
}
