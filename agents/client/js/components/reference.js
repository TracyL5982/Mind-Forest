import { h } from '../dom.js';
import { chipSources } from '../chips.js';
import { GAP, META, WIDTH, drawFace, kind, lay, list, say, text, titleRow, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The rule under the kind and the year, and the room either side of it. */
const RULE = 14;
const KINDS = ['paper', 'book'];

function plan(item, props) {
  const names = list(props.authors).map((name) => text(name).trim()).filter(Boolean);
  return {
    names,
    authors: names.length > 0 ? `${names.join(', ')}${props.more === true ? wordsOf(item).others : ''}` : '',
    venue: text(props.venue).trim(),
    label: wordsOf(item)[KINDS.includes(props.kind) ? props.kind : 'paper'],
    year: text(props.year).trim() || text(item.data?.date).trim(),
  };
}

/** A library card: its kind and year in meta over a rule, the title on up to two lines, and the first author. The venue is on the opened card. */
function face(item, props) {
  const { names, label, year } = plan(item, props);
  const words = wordsOf(item);
  return lay([
    { tall: META + RULE, draw: () => head(label, year) },
    titleRow(item, { most: 2 }),
    names.length > 0 && { words: words.firstAuthor(names[0], names.length - 1, props.more === true), measure: 'meta', most: 1, gap: GAP, draw: wordsIn('reference-authors') },
  ], { words });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

const head = (label, year) => h('div', { class: 'reference-head' }, kind(label), year && h('span', { class: 'reference-year', text: year }));

export const draw = (item, props) => drawFace(face(item, props));

/**
 * The kind and the year, and under them the authors and the venue whole. A line the opened card's
 * list of sources says in the same words is left to that list. A list of authors that was cut
 * stays, because only this line says so.
 */
export function detail(item, props) {
  const { authors: names, venue: where, label, year } = plan(item, props);
  const listed = chipSources(item).map((source) => source.text);
  const [authors, venue] = [names, where].map((line) => (listed.includes(line) ? '' : line));
  return [
    h('div', { class: 'detail-reference' },
      head(label, year),
      authors && say('div', 'reference-authors', authors),
      venue && say('div', 'reference-venue', venue)),
  ];
}
