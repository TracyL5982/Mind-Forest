/**
 * The short facts the opened card lists for an item: when, where, who, and, for an item the agents
 * brought, where it came from. They are read from the item alone, so no model output is involved and
 * a card keeps them when a pick is kept. The small face draws none of them.
 */

/** The first of these the item holds is its date. The Scout writes `date`. */
const WHEN = ['when', 'date'];
/** The first of these the item holds names where the agents found it, the most exact first. */
const ORIGIN = ['holder', 'venue', 'site', 'from'];
/** How many names a people chip writes before it counts the rest. */
const NAMED = 2;

export const LABEL = { when: 'When', where: 'Where', people: 'People', origin: 'Origin' };

const str = (value) => (typeof value === 'string' ? value.trim() : '');
const names = (value) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);

/**
 * The people an item names, and the `item.data` key they were read from. The Scout writes
 * `authors`. Its `by` is not read, because it is as often a site or a score as a person.
 */
function crew(data) {
  const key = ['people', 'authors'].find((name) => names(data[name]).length > 0);
  return { key, found: names(data[key]) };
}

/**
 * Every source the item holds, in chip order: `{ kind, key, text }`, where `key` is the
 * `item.data` key the value was read from, and a people source also holds every name in `names`.
 * What the agents brought says where it came from straight after its date. A source that says
 * what an earlier one said is left out, as when the one author named is the holder.
 */
function sources(item) {
  const data = item?.data ?? {};
  const when = WHEN.find((key) => str(data[key]));
  const origin = item?.origin?.by === 'agent' ? ORIGIN.find((key) => str(data[key])) : undefined;
  const { key, found } = crew(data);
  const held = [
    when && { kind: 'when', key: when, text: str(data[when]) },
    origin && { kind: 'origin', key: origin, text: str(data[origin]) },
    str(data.where) && { kind: 'where', key: 'where', text: str(data.where) },
    found.length > 0 && { kind: 'people', key, text: found.slice(0, NAMED).join(', '), names: found },
  ].filter(Boolean);
  return held.filter((source, i) => !held.slice(0, i).some((earlier) => earlier.text === source.text));
}

/** Every source in full, for the opened card: `{ kind, label, text }`, with each person named. */
export function chipSources(item) {
  return sources(item).map(({ kind, text, names: all }) => ({ kind, label: LABEL[kind], text: all ? all.join(', ') : text }));
}
