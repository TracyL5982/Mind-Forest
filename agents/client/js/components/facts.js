import { h } from '../dom.js';
import { FIGURES, FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, andMore, figureNeed, fold, list, say, text, wrap } from './shared.js';

const WIDTH = 320;
const COLUMN = WIDTH - SIDES;
const BETWEEN = 17;
const HALF = (COLUMN - BETWEEN) / 2;
const ROW_GAP = 12;
/** A row of figures is set in the middle size or the smallest, never the largest, which is a lone fact's. */
const SIZES = FIGURES.slice(1);
/** The most lines a value is sized for, as on a fact card. */
const MOST_LINES = 8;

const pairs = (props) => list(props.facts).map((fact) => ({ label: text(fact?.label), value: text(fact?.value) }));

/**
 * Facts sit two to a row, and a last one left alone has the whole row. A row is set in the largest
 * size that holds each of its values on one line. Past the smallest a value wraps and the row grows
 * with it. The smallest size is the title's, set a little tighter, so its lines are counted in the
 * title face. A value is drawn whole whatever the estimate, and never ended with an ellipsis.
 */
function plan(item, props) {
  const facts = pairs(props);
  const rows = [];
  for (let i = 0; i < facts.length; i += 2) {
    const cells = facts.slice(i, i + 2);
    const room = cells.length === 1 ? COLUMN : HALF;
    const size = SIZES.find((step) => cells.every((cell) => figureNeed(cell.value, step) <= room * 100));
    const [cls, lead] = size ?? SIZES.at(-1);
    const drawn = cells.map((cell) => {
      const lines = size ? 1 : wrap(cell.value, room, TITLE_LETTER, MOST_LINES);
      const labelLines = wrap(cell.label, room, TEXT_LETTER, 2);
      return { ...cell, lines, labelLines, height: lines * lead + labelLines * TEXT, most: MOST_LINES * lead };
    });
    rows.push({ cls, cells: drawn, height: Math.max(...drawn.map((cell) => cell.height)) });
  }
  const more = Number.isInteger(props.more) && props.more > 0 ? props.more : 0;
  return { rows, more, titleLines: fold(item.title || 'Untitled', COLUMN, TITLE_LETTER, 2) };
}

export const shows = [];

export function size(item, props) {
  const { rows, more, titleLines } = plan(item, props);
  const grid = rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * ROW_GAP;
  return [WIDTH, FRAME + titleLines * TITLE + (rows.length ? 12 + grid : 0) + (more ? 8 + TEXT : 0)];
}

export function draw(item, props) {
  const { rows, more, titleLines } = plan(item, props);
  return [
    say('div', `card-title clamp-${titleLines}`, item.title || 'Untitled'),
    rows.length > 0 && h('div', { class: 'figures' }, rows.map((row) => row.cells.map((cell) =>
      h('div', { class: row.cells.length === 1 ? 'figure is-alone' : 'figure' },
        h('div', { class: `fact-value ${row.cls}`, dir: 'auto', text: cell.value, style: { maxHeight: `${cell.most}px` } }),
        say('div', `fact-label clamp-${cell.labelLines}`, cell.label))))),
    more > 0 && andMore(more),
  ];
}

/** Every fact the item holds, when the card shows only the first of them. */
function every(item, props) {
  const held = list(item.data?.facts).map((fact) => ({ label: text(fact?.label), value: text(fact?.value) })).filter((fact) => fact.label.trim() && fact.value.trim());
  const shown = pairs(props);
  return held.length > shown.length ? held : shown;
}

export const detail = (item, props) => [
  h('dl', { class: 'detail-figures' }, every(item, props).map((fact) => [say('dt', '', fact.label), say('dd', '', fact.value)])),
];
