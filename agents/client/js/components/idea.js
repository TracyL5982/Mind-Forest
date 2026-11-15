import { s } from '../dom.js';
import { FIGURES, WIDTH, drawFace, lay, linesOf, titleOf, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The spark over the thought, and the gap under it. */
const MARK = 22;
const COLUMN = WIDTH - 33;
/**
 * The thought steps down as it grows: the largest size for up to two lines, the middle size for up to three, then the smallest
 * for three, where a longer thought shows its first three lines and the cue.
 */
const STEPS = [['display', 2, FIGURES[0][0]], ['middle', 3, FIGURES[1][0]], ['figure', 3, FIGURES[2][0]]];

function face(item) {
  const thought = titleOf(item);
  const [measure, most, cls] = STEPS.find(([step, lines]) => linesOf(thought, COLUMN, step) <= lines) ?? STEPS.at(-1);
  return lay([
    { tall: MARK, draw: spark },
    { words: thought, measure, column: COLUMN, most, draw: wordsIn(`fact-value idea-text ${cls}`) },
  ], { words: wordsOf(item) });
}

const spark = () => s('svg', { class: 'idea-spark', viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' },
  s('path', { d: 'M7 .6 8.5 5.5 13.4 7 8.5 8.5 7 13.4 5.5 8.5 .6 7 5.5 5.5Z' }));

export const size = (item) => [WIDTH, face(item).height];

export const draw = (item) => drawFace(face(item));

export const detail = () => [];
