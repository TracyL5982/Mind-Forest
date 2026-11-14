import { s } from '../dom.js';
import { FIGURES, FRAME, SIDES, say, wrap, titleOf } from './shared.js';

const WIDTH = 272;
const COLUMN = WIDTH - SIDES;
/** The spark over the thought, and the gap under it. */
const MARK = 22;
/**
 * The thought steps down as it grows: the largest size for up to two lines, the middle size for up
 * to four, then the smallest.
 */
const STEPS = [[FIGURES[0], 2], [FIGURES[1], 4], [FIGURES[2], 5]];

function plan(item) {
  const thought = titleOf(item);
  for (const [[cls, lead, letter], most] of STEPS) {
    const lines = wrap(thought, COLUMN, letter, most + 1);
    if (lines <= most || most === STEPS.at(-1)[1]) return { thought, cls, lead, lines: Math.min(lines, most) };
  }
  return undefined;
}

const spark = () => s('svg', { class: 'idea-spark', viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' },
  s('path', { d: 'M7 .6 8.5 5.5 13.4 7 8.5 8.5 7 13.4 5.5 8.5 .6 7 5.5 5.5Z' }));

export const shows = [];

export function size(item) {
  const { lead, lines } = plan(item);
  return [WIDTH, FRAME + MARK + lines * lead];
}

export function draw(item) {
  const { thought, cls } = plan(item);
  return [spark(), say('div', cls ? `fact-value idea-text ${cls}` : 'fact-value idea-text', thought)];
}

export const detail = () => [];
