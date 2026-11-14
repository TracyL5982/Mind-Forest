import { h } from '../dom.js';
import { FIGURES, FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, andMore, figureNeed, list, say, text, wrap, titleOf } from './shared.js';

const WIDTH = 320;
const COLUMN = WIDTH - SIDES;
const BETWEEN = 17;
const HALF = (COLUMN - BETWEEN) / 2;
const ROW_GAP = 12;
/** A row of figures is set in the middle size or the smallest, never the largest, which is a lone fact's. */
const SIZES = FIGURES.slice(1);
const SMALL_LETTER = FIGURES[2][2];
/** The most lines a value is given, as on a fact card. */
const MOST_LINES = 8;

const pairs = (props) => list(props.facts).map((fact) => ({ label: text(fact?.label).trim(), value: text(fact?.value).trim() }));

/** A value that needs more than two lines in half a row is given a row of its own. */
const isLong = (fact) => wrap(fact.value, HALF, SMALL_LETTER, 3) > 2;

/**
 * Facts sit two to a row. One with a long value, or with no short neighbour after it, has the
 * whole row. Every figure of a card is set in one size: the largest that holds each value on one
 * line of its room, so figures side by side and one under another are the same size. At the
 * smallest size a value that needs more wraps and its row grows with it, up to `MOST_LINES`. A
 * value that needs more lines still is a passage, not a figure: it is cut there with an ellipsis,
 * and the opened card has it whole.
 */
function plan(item, props) {
  const facts = pairs(props);
  const rows = [];
  for (let i = 0; i < facts.length; i += rows.at(-1).cells.length) {
    const paired = i + 1 < facts.length && !isLong(facts[i]) && !isLong(facts[i + 1]);
    rows.push({ room: paired ? HALF : COLUMN, cells: facts.slice(i, i + (paired ? 2 : 1)) });
  }
  const fits = (step, row, cell) => figureNeed(cell.value, step) <= row.room * 100;
  const size = SIZES.find((step) => rows.every((row) => row.cells.every((cell) => fits(step, row, cell)))) ?? SIZES.at(-1);
  const [cls, lead] = size;
  const drawn = rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const needs = fits(size, row, cell) ? 1 : wrap(cell.value, row.room, SMALL_LETTER, MOST_LINES + 1);
      const lines = Math.min(needs, MOST_LINES);
      const labelLines = wrap(cell.label, row.room, TEXT_LETTER, 2);
      return { ...cell, cut: needs > MOST_LINES, labelLines, height: lines * lead + labelLines * TEXT };
    });
    return { cells, height: Math.max(...cells.map((cell) => cell.height)) };
  });
  const more = Number.isInteger(props.more) && props.more > 0 ? props.more : 0;
  return { cls, rows: drawn, more, titleLines: wrap(titleOf(item), COLUMN, TITLE_LETTER, 2) };
}

export const shows = [];

export function size(item, props) {
  const { rows, more, titleLines } = plan(item, props);
  const grid = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * ROW_GAP;
  return [WIDTH, FRAME + titleLines * TITLE + (rows.length ? 12 + grid : 0) + (more ? 8 + TEXT : 0)];
}

export function draw(item, props) {
  const { cls, rows, more, titleLines } = plan(item, props);
  return [
    say('div', `card-title clamp-${titleLines}`, titleOf(item)),
    rows.length > 0 && h('div', { class: 'figures' }, rows.map((row) => row.cells.map((cell) =>
      h('div', { class: row.cells.length === 1 ? 'figure is-alone' : 'figure', dir: 'auto' },
        h('div', { class: `fact-value ${cls}${cell.cut ? ` clamp-${MOST_LINES}` : ''}`, text: cell.value }),
        h('div', { class: `fact-label clamp-${cell.labelLines}`, text: cell.label }))))),
    more > 0 && andMore(more, item),
  ];
}

/** Every fact the item holds, when the card shows only the first of them. */
function every(item, props) {
  const held = list(item.data?.facts).map((fact) => ({ label: text(fact?.label), value: text(fact?.value) })).filter((fact) => fact.label.trim() && fact.value.trim());
  const shown = pairs(props);
  return held.length > shown.length ? held : shown;
}

export const detail = (item, props) => [
  h('dl', { class: 'detail-figures' }, every(item, props).map((fact) => [say('dt', '', fact.label.trim()), say('dd', '', fact.value.trim())])),
];
