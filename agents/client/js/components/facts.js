import { h } from '../dom.js';
import { COLUMN, CUE, FIGURES, GAP, HEIGHT, META, WIDTH, aboveRows, drawFace, figureNeed, fit, headsRow, lay, list, say, text, titleRow } from './shared.js';
import { wordsOf } from '../words.js';

const BETWEEN = 17;
const HALF = Math.floor((COLUMN - BETWEEN) / 2);
/** Between two rows of figures. */
const ROW_GAP = 12;
/** Under the title: 4 px, so a row of figures over its label and the cue stand whole under a title of two lines. */
export const UNDER_TITLE = 4;
/** A row of figures is set in the middle size or the smallest, never the largest, which is a lone fact's. */
const [, MIDDLE, SMALL] = FIGURES;
/** The most lines a value takes at the smallest size: as many as a face holds over its cue. */
const VALUE_LINES = 4;
const LABEL_LINES = 2;

export const pairs = (props) => list(props.facts).map((fact) => ({ label: text(fact?.label).trim(), value: text(fact?.value).trim() }));

/**
 * A value at the largest of `sizes` that holds it on one line in `room` px, else at the smallest on its whole lines, up to `most`.
 * Within the Renderer's 32 characters a value always stands whole on a fact card, because a figure cut short would mislead.
 */
export function figureIn(value, room, sizes, most = VALUE_LINES) {
  const one = sizes.find((size) => figureNeed(value, size) <= room * 100);
  if (one) return { cls: one[0], words: value, lines: 1, whole: true, height: one[1] };
  const shown = fit(value, room, 'figure', most);
  return { cls: SMALL[0], ...shown, height: shown.lines * SMALL[1] };
}

const valueIn = (shown) => say('div', `fact-value ${shown.cls}`.trim(), shown.words);

/** The most lines of a value and of its label the first row of figures tries, in order, when it is taller than the room it has. */
const SHORTER = [4, 3, 2, 1].flatMap((value) => [[value, 2], [value, 1]]);

/**
 * Facts as rows of a face, each a unit the cue counts, the first `gap` under what comes before them and the rest `ROW_GAP` apart.
 * Two facts share a row when both values fit half of it at the middle size, each over its label in meta; any other has the row.
 * Figures from a table under a heads row are `headed`: one to a row, the label in the half under the first head and the value
 * in the half under the second, so a value reads under its head. The first row stands in `room` px: when it is taller, it shows
 * its value on the most whole lines that leave room for a line of its label. A value is never shown without its label.
 */
export function figureRows(facts, { headed = false, gap = ROW_GAP, room = Infinity } = {}) {
  const fits = (fact) => figureNeed(fact.value, MIDDLE) <= HALF * 100;
  const groups = [];
  for (let i = 0; i < facts.length; i += groups.at(-1).length) {
    const paired = !headed && i + 1 < facts.length && fits(facts[i]) && fits(facts[i + 1]);
    groups.push(facts.slice(i, i + (paired ? 2 : 1)));
  }
  return groups.map((cells, i) => {
    const width = headed || cells.length > 1 ? HALF : COLUMN;
    const laid = (values, labels) => {
      const shown = cells.map((cell) => ({ value: figureIn(cell.value, width, [MIDDLE, SMALL], values), label: fit(cell.label, width, 'meta', labels) }));
      return { shown, tall: Math.max(...shown.map(({ value, label }) => (headed ? Math.max(value.height, label.lines * META) : value.height + label.lines * META))) };
    };
    const whole = laid(VALUE_LINES, LABEL_LINES);
    const { shown, tall } = i > 0 || whole.tall <= room ? whole : SHORTER.map(([values, labels]) => laid(values, labels)).find((one) => one.tall <= room) ?? whole;
    const label = (cell) => say('div', 'figure-label', cell.label.words);
    return {
      tall, cells, gap: i === 0 ? gap : ROW_GAP, unit: true, whole: shown.every(({ value, label }) => value.whole && label.whole),
      draw: () => (headed
        ? h('div', { class: 'figures is-headed', dir: 'auto' }, label(shown[0]), valueIn(shown[0].value))
        : h('div', { class: 'figures' }, shown.map((cell) => h('div', { class: 'figure', dir: 'auto' }, valueIn(cell.value), label(cell))))),
    };
  });
}

/**
 * The title, the lines the item writes over its figures, the heads row of their table, then the figures, a row at a time, as many
 * rows as the face has room for. The cue counts the facts left out, with those the item holds past the ones the view gives.
 */
function face(item, props) {
  const words = wordsOf(item);
  const more = Number.isInteger(props.more) && props.more > 0 ? props.more : 0;
  const heads = headsRow(props);
  const top = [titleRow(item), ...aboveRows(props), heads];
  const gap = heads ? GAP : UNDER_TITLE;
  const rows = figureRows(pairs(props), { headed: heads !== null, gap, room: HEIGHT - lay(top, { words }).height - gap - CUE });
  return lay([...top, ...rows], {
    words,
    more: more > 0,
    cue: (left) => {
      const count = rows.slice(rows.length - left).reduce((sum, row) => sum + row.cells.length, more);
      return count > 0 ? words.cue.left(count) : '';
    },
  });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

/** Every figure with its label, whole, as the opened card lists them. */
export const listed = (facts) => h('dl', { class: 'detail-figures' }, facts.map((fact) => [say('dt', '', fact.label.trim()), say('dd', '', fact.value.trim())]));

/** Every fact the item holds, when the card shows only the first of them. */
function every(item, props) {
  const held = list(item.data?.facts).map((fact) => ({ label: text(fact?.label), value: text(fact?.value) })).filter((fact) => fact.label.trim() && fact.value.trim());
  const shown = pairs(props);
  return held.length > shown.length ? held : shown;
}

export const detail = (item, props) => [listed(every(item, props))];
