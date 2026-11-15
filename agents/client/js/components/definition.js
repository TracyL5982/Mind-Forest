import { h } from '../dom.js';
import { COLUMN, FIGURES, MEASURES, TITLE_LINES, WIDTH, aboveRows, drawFace, figureNeed, fit, lay, say, text, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The meaning in the serif counts its lines in the whole line box, as an excerpt's passage does. */
const LINE = WIDTH - 32;
/** The short rule under the headword, and the room either side of it. */
const RULE = 10;

/** The headword is set in a figure's middle size while it fits on one line, and at the title's size when it does not, cut as a title is past two lines. */
function plan(props) {
  const term = text(props.term).trim();
  return { term, meaning: text(props.definition).trim(), large: figureNeed(term, FIGURES[1]) <= COLUMN * 100 };
}

/** The lines the item writes over it, the headword over a short rule, then the meaning on as many lines as the face has room for. */
function face(item, props) {
  const { term, meaning, large } = plan(props);
  const above = aboveRows(props, { gap: 0 });
  const shown = large ? { words: term, lines: 1, whole: true } : fit(term, COLUMN, 'title', TITLE_LINES, true);
  return lay([
    ...above,
    { tall: (large ? MEASURES.middle.lead : shown.lines * MEASURES.title.lead) + RULE, whole: shown.whole, gap: above.length > 0 ? 6 : 0,
      draw: () => [headword(shown.words, large), h('div', { class: 'fact-rule' })] },
    { words: meaning, measure: 'passage', column: LINE, draw: wordsIn('definition-text') },
  ], { words: wordsOf(item) });
}

export function size(item, props) {
  return [WIDTH, face(item, props).height];
}

const headword = (term, large) => say('div', large ? `fact-value ${FIGURES[1][0]}` : 'card-title', term);

export const draw = (item, props) => drawFace(face(item, props));

/** The meaning whole, under the term when the opened card's own title is not already the term. */
export function detail(item, props) {
  const { term, meaning, large } = plan(props);
  const named = term === item.title;
  return [h('div', { class: 'detail-definition' }, !named && headword(term, large), !named && h('div', { class: 'fact-rule' }), say('div', 'definition-text', meaning))];
}
