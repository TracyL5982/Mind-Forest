import { h } from '../dom.js';
import { COLUMN, WIDTH, aboveRows, drawFace, lay, say, text } from './shared.js';
import { wordsOf } from '../words.js';

/** The letter that names each voice, and the gap after it. */
const MARK = 22;
/** The rule between the question and the answer, and the room either side of it. */
const RULE = 17;

function plan(props) {
  return { question: text(props.question).trim(), answer: text(props.answer).trim() };
}

/** The lines the item writes over it, then the question at the title's size and, under a rule, the answer. */
function face(item, props) {
  const { question, answer } = plan(props);
  const words = wordsOf(item);
  const above = aboveRows(props, { gap: 0 });
  return lay([
    ...above,
    { words: question, measure: 'title', column: COLUMN - MARK, gap: above.length > 0 ? 6 : 0, draw: (row) => voice(words.question, 'is-question', say('div', 'card-title', row.words)) },
    { words: answer, column: COLUMN - MARK, gap: RULE, draw: (row) => voice(words.answer, 'is-answer', say('div', 'qa-answer', row.words)) },
  ], { words });
}

export function size(item, props) {
  return [WIDTH, face(item, props).height];
}

export const draw = (item, props) => drawFace(face(item, props));

const voice = (mark, cls, words) => h('div', { class: `qa-voice ${cls}` }, h('span', { class: 'qa-mark', 'aria-hidden': 'true', text: mark }), words);

/** Both whole. A question that is the opened card's own title is not asked again. */
export function detail(item, props) {
  const { question, answer } = plan(props);
  return [
    h('div', { class: 'detail-qa' },
      question !== item.title && voice(wordsOf(item).question, 'is-question', say('div', 'card-title', question)),
      voice(wordsOf(item).answer, 'is-answer', say('div', 'qa-answer', answer))),
  ];
}
