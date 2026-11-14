import { h } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, kind, list, say, text, wrap } from './shared.js';

const WIDTH = 288;
const COLUMN = WIDTH - SIDES;
/** The line that names the kind and the year, with the rule under it. */
const HEAD = 24;
const KIND = { paper: 'Paper', book: 'Book' };

function plan(item, props) {
  const names = list(props.authors).map((name) => text(name).trim()).filter(Boolean);
  const authors = names.length > 0 ? `${names.join(', ')}${props.more === true ? ' and others' : ''}` : '';
  const venue = text(props.venue).trim();
  return {
    authors, venue,
    label: KIND[props.kind] ?? KIND.paper,
    year: text(props.year).trim(),
    titleLines: wrap(item.title || 'Untitled', COLUMN, TITLE_LETTER, 3),
    authorLines: authors ? wrap(authors, COLUMN, TEXT_LETTER, 2) : 0,
    venueLines: venue ? wrap(venue, COLUMN, TEXT_LETTER, 2) : 0,
  };
}

export const shows = ['venue', 'date', 'authors'];

export function size(item, props) {
  const { titleLines, authorLines, venueLines } = plan(item, props);
  return [WIDTH, FRAME + HEAD + 8 + titleLines * TITLE + (authorLines ? 6 + authorLines * TEXT : 0) + (venueLines ? 2 + venueLines * TEXT : 0)];
}

const head = (label, year) => h('div', { class: 'reference-head' }, kind(label), year && h('span', { class: 'reference-year', text: year }));

export function draw(item, props) {
  const { authors, venue, label, year, titleLines, authorLines, venueLines } = plan(item, props);
  return [
    head(label, year),
    say('div', `card-title clamp-${titleLines}`, item.title || 'Untitled'),
    authors && say('div', `reference-authors clamp-${authorLines}`, authors),
    venue && say('div', `reference-venue clamp-${venueLines}`, venue),
  ];
}

export function detail(item, props) {
  const { authors, venue, label, year } = plan(item, props);
  return [
    h('div', { class: 'detail-reference' },
      head(label, year),
      authors && say('div', 'reference-authors', authors),
      venue && say('div', 'reference-venue', venue)),
  ];
}
