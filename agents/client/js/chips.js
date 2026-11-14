/**
 * The short facts a card can carry on one line under its content: when, where, who, and for a pick
 * where it came from. They are read from the item alone, so no model output is involved.
 */

export const CHIP_LIMIT = 3;

/** The first of these the item holds names where a pick came from. */
const ORIGIN = ['from', 'holder', 'site'];

const LABEL = { when: 'When', where: 'Where', people: 'People', origin: 'Origin' };

const str = (value) => (typeof value === 'string' ? value.trim() : '');
const names = (value) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);

/** Two names, then how many more: `Ada, Grace +3`. */
const few = (people) => people.slice(0, 2).join(', ') + (people.length > 2 ? ` +${people.length - 2}` : '');

/** Every source the item holds, in chip order. `key` is the `item.data` key the value was read from. */
function sources(item, node) {
  const data = item?.data ?? {};
  const people = names(data.people);
  const origin = node?.status === 'pick' ? ORIGIN.find((key) => str(data[key])) : undefined;
  return [
    str(data.when) && { kind: 'when', key: 'when', text: str(data.when), full: str(data.when) },
    str(data.where) && { kind: 'where', key: 'where', text: str(data.where), full: str(data.where) },
    people.length > 0 && { kind: 'people', key: 'people', text: few(people), full: people.join(', ') },
    origin && { kind: 'origin', key: origin, text: str(data[origin]), full: str(data[origin]) },
  ].filter(Boolean);
}

/**
 * The chips a card draws: at most three `{ kind, text }`, in the order when, where, people, origin.
 * `shown` lists the `item.data` keys the card's type already draws, and those are left out.
 */
export function chips(item, node, shown = []) {
  return sources(item, node)
    .filter((source) => !shown.includes(source.key))
    .slice(0, CHIP_LIMIT)
    .map(({ kind, text }) => ({ kind, text }));
}

/** Every source in full, for the opened card: `{ kind, label, text }`, with each person named. */
export function chipSources(item, node) {
  return sources(item, node).map(({ kind, full }) => ({ kind, label: LABEL[kind], text: full }));
}
