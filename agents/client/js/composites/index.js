import * as gallery from './gallery.js';
import * as timeline from './timeline.js';
import * as comparison from './comparison.js';
import * as sequence from './sequence.js';
import * as cluster from './cluster.js';
import * as stack from './stack.js';
import * as layout from './layout.js';

/**
 * Every way several sibling cards can be drawn as one arrangement, one module per arrangement.
 * Each returns the block's size, where each member sits, and the marks drawn behind the cards. One
 * that lays members under another also returns `cover`, the drawn size each of those is cut to, so
 * a card under a smaller one shows only its edge. One drawn as another arrangement instead names it in `label`.
 */
export const COMPOSITES = { gallery, timeline, comparison, sequence, cluster, stack, layout };

export function arrange(group, ids, sizes, open) {
  const kind = Object.hasOwn(COMPOSITES, group.composite) ? COMPOSITES[group.composite] : cluster;
  const made = kind.arrange(group, ids, sizes, open);
  return {
    under: new Set(), buried: new Set(), cover: null, marks: [],
    ...made,
    label: made.label ?? kind.name,
    title: (kind.title ? kind.title(group) : group.title) || kind.name,
    canOpen: Boolean(kind.canOpen),
  };
}
