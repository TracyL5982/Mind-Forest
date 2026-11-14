/**
 * The short facts a card can carry on one line under its content: when, where, who, and, for an
 * item the agents brought, where it came from. They are read from the item alone, so no model
 * output is involved and a card keeps its chips when a pick is kept.
 */

const CHIP_LIMIT = 3;

/** The first of these the item holds is its date. The Scout writes `date`. */
const WHEN = ['when', 'date'];
/** The first of these the item holds names where the agents found it, the most exact first. */
const ORIGIN = ['holder', 'venue', 'site', 'from'];
/** How many names a people chip writes before it counts the rest. */
const NAMED = 2;

export const LABEL = { when: 'When', where: 'Where', people: 'People', origin: 'Origin' };

const str = (value) => (typeof value === 'string' ? value.trim() : '');
const names = (value) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);

/** The people an item names, and the `item.data` key they were read from. The Scout writes `authors` and `by`. */
function crew(data) {
  for (const key of ['people', 'authors']) {
    const found = names(data[key]);
    if (found.length > 0) return { key, found };
  }
  return { key: 'by', found: names([data.by]) };
}

/**
 * Every source the item holds, in chip order: `{ kind, key, text }`, where `key` is the
 * `item.data` key the value was read from, and a people source also holds every name in `names`.
 * What the agents brought says where it came from straight after its date. A source that says
 * what an earlier one said is left out, as when a page's author is its site.
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

/**
 * The chips a card may draw: at most three `{ kind, text }`, in the order when, origin, where,
 * people. `shown` lists the `item.data` keys the card's type already draws. A source read from one
 * of them, or that says the same as one of them, is left out. A people chip for more than two
 * people also has `count`, how many it leaves unnamed.
 */
export function chips(item, shown = []) {
  const said = shown.map((key) => str(item?.data?.[key])).filter(Boolean);
  return sources(item)
    .filter((source) => !shown.includes(source.key) && !said.includes(source.text))
    .slice(0, CHIP_LIMIT)
    .map(({ kind, text, names: all }) => (all?.length > NAMED ? { kind, text, count: all.length - NAMED } : { kind, text }));
}

/** Every source in full, for the opened card: `{ kind, label, text }`, with each person named. */
export function chipSources(item) {
  return sources(item).map(({ kind, text, names: all }) => ({ kind, label: LABEL[kind], text: all ? all.join(', ') : text }));
}
