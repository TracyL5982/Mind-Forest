import { h } from '../dom.js';
import { FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, say, text, wrap } from './shared.js';
import { wordsOf } from '../words.js';

const WIDTH = 272;
/** The letter that names each voice, and the gap after it. */
const MARK = 22;
const COLUMN = WIDTH - SIDES - MARK;
/** The rule between the question and the answer, and the room either side of it. */
const RULE = 17;

function plan(props) {
  const question = text(props.question).trim();
  const answer = text(props.answer).trim();
  return { question, answer, questionLines: wrap(question, COLUMN, TITLE_LETTER, 4), answerLines: wrap(answer, COLUMN, TEXT_LETTER, 6) };
}

export const shows = [];

export function size(item, props) {
  const { questionLines, answerLines } = plan(props);
  return [WIDTH, FRAME + questionLines * TITLE + RULE + answerLines * TEXT];
}

const voice = (mark, cls, words) => h('div', { class: `qa-voice ${cls}` }, h('span', { class: 'qa-mark', 'aria-hidden': 'true', text: mark }), words);

export function draw(item, props) {
  const { question, answer, questionLines, answerLines } = plan(props);
  return [
    voice(wordsOf(item).question, 'is-question', say('div', `card-title clamp-${questionLines}`, question)),
    voice(wordsOf(item).answer, 'is-answer', say('div', `qa-answer clamp-${answerLines}`, answer)),
  ];
}

/** Both whole. A question that is the opened card's own title is not asked again. */
export function detail(item, props) {
  const { question, answer } = plan(props);
  return [
    h('div', { class: 'detail-qa' },
      question !== item.title && voice(wordsOf(item).question, 'is-question', say('div', 'card-title', question)),
      voice(wordsOf(item).answer, 'is-answer', say('div', 'qa-answer', answer))),
  ];
}
