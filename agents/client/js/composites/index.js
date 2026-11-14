import * as gallery from './gallery.js';
import * as timeline from './timeline.js';
import * as comparison from './comparison.js';
import * as sequence from './sequence.js';
import * as cluster from './cluster.js';
import * as stack from './stack.js';

/**
 * Every way several sibling cards can be drawn as one arrangement, one module per arrangement.
 * Each returns the block's size, where each member sits, and the marks drawn behind the cards.
 */
export const COMPOSITES = { gallery, timeline, comparison, sequence, cluster, stack };

export function arrange(group, ids, sizes, open) {
  const kind = Object.hasOwn(COMPOSITES, group.composite) ? COMPOSITES[group.composite] : cluster;
  const made = kind.arrange(group, ids, sizes, open);
  return {
    under: new Set(), buried: new Set(), marks: [],
    ...made,
    label: kind.name,
    title: (kind.title ? kind.title(group) : group.title) || kind.name,
    canOpen: Boolean(kind.canOpen),
  };
}
