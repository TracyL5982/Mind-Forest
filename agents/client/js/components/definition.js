import { h } from '../dom.js';
import { FIGURES, FRAME, PASSAGE_LETTER, SIDES, TITLE, TITLE_LETTER, figureNeed, say, text, wrap } from './shared.js';

const WIDTH = 272;
const COLUMN = WIDTH - SIDES;
const RULE = 10;
/** The headword is set in a figure's middle size while it fits on one line, and in the title's size on up to two when it does not. */
const [LARGE, LEAD] = FIGURES[1];

function plan(props) {
  const term = text(props.term).trim();
  const meaning = text(props.definition).trim();
  const large = figureNeed(term, FIGURES[1]) <= COLUMN * 100;
  const termLines = large ? 1 : wrap(term, COLUMN, TITLE_LETTER, 2);
  return { term, meaning, large, termLines, termHeight: large ? LEAD : termLines * TITLE, lines: wrap(meaning, COLUMN, PASSAGE_LETTER, 6) };
}

export const shows = [];

export function size(item, props) {
  const { termHeight, lines } = plan(props);
  return [WIDTH, FRAME + termHeight + RULE + lines * TITLE];
}

const headword = (term, large, lines) => (large ? say('div', `fact-value ${LARGE}`, term) : say('div', lines ? `card-title clamp-${lines}` : 'card-title', term));

export function draw(item, props) {
  const { term, meaning, large, termLines, lines } = plan(props);
  return [headword(term, large, termLines), h('div', { class: 'fact-rule' }), say('div', `definition-text clamp-${lines}`, meaning)];
}

export function detail(item, props) {
  const { term, meaning, large } = plan(props);
  return [h('div', { class: 'detail-definition' }, headword(term, large, 0), h('div', { class: 'fact-rule' }), say('div', 'definition-text', meaning))];
}
