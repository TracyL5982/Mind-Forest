import { h, s, clamp } from '../dom.js';
import { FIGURES, FRAME, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, cut, figureNeed, kind, list, say, text, title, titleOf, wrap } from './shared.js';
import { wordsOf } from '../words.js';

const WIDTH = 288;
const COLUMN = WIDTH - SIDES;
/** The mark that says the card can be explored, and the room under it. */
const MARK = TEXT + 4;
/** The room above what the controls change, and above each control's row. */
const OUT_GAP = 10;
const ROW_GAP = 8;
/** A control's row on the card: its states as pills, or a slider's reading beside its track. */
const ROW = 28;
const PILL_GAP = 4;
const PILL_PAD = 12;
const TRACK = 96;
/** Each state's text on the card, and the room between two controls' texts. */
const STATE_LINES = 4;
const TEXT_GAP = 6;
/** A result's label, the room under its figure, and the curve under that. */
const LABEL_LINES = 2;
const FIGURE_GAP = 2;
const PLOT = 96;
const PLOT_GAP = 8;
const [, MID_LEAD, MID_LETTER] = FIGURES[1];
const [SMALL_CLASS, SMALL_LEAD, SMALL_LETTER] = FIGURES[2];
const VALUE_LINES = 3;

const ARITY = { '+': 2, '-': 2, '*': 2, '/': 2, '^': 2, neg: 1, min: 2, max: 2, round: 1, sqrt: 1, exp: 1, ln: 1, atan: 1 };
const APPLY = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => (b === 0 ? Number.NaN : a / b),
  '^': (a, b) => a ** b,
  neg: (a) => -a,
  min: Math.min,
  max: Math.max,
  round: (a) => Math.floor(a + 0.5),
  sqrt: Math.sqrt,
  exp: Math.exp,
  ln: (a) => (a > 0 ? Math.log(a) : Number.NaN),
  atan: Math.atan,
};

/** A formula's value where its quantities have these values, or `undefined` where it has none: docs/libraries.md gives the steps. */
export function evaluate(program, values) {
  const stack = [];
  for (const token of list(program)) {
    let value = Number.NaN;
    if (typeof token === 'number') value = token;
    else if (typeof token === 'string' && Object.hasOwn(ARITY, token)) {
      const args = stack.splice(Math.max(0, stack.length - ARITY[token]));
      if (args.length === ARITY[token]) value = APPLY[token](...args);
    } else if (typeof token === 'string' && Object.hasOwn(values, token)) value = values[token];
    if (!Number.isFinite(value)) return undefined;
    stack.push(value);
  }
  return stack.length === 1 ? stack[0] : undefined;
}

const numbers = (value) => list(value).filter((n) => typeof n === 'number' && Number.isFinite(n));

/** The controls in props that can be drawn, each with what it needs. */
function controlsOf(props) {
  return list(props.controls).flatMap((control) => {
    if (!control || typeof control !== 'object') return [];
    const label = text(control.label).trim();
    if (control.kind === 'toggle' || control.kind === 'segmented') {
      const states = list(control.states).filter((state) => state && typeof state === 'object').map((state) => ({ name: text(state.name).trim(), text: text(state.text).trim() }));
      return states.length >= 2 ? [{ kind: control.kind, label, states }] : [];
    }
    if (control.kind === 'slider') {
      const values = numbers(control.values);
      const [min, max, step] = [control.min, control.max, control.step].map(Number);
      return values.length > 0 && min < max && step > 0 ? [{ kind: 'slider', name: text(control.name), label, unit: text(control.unit).trim(), min, max, step, values }] : [];
    }
    return [];
  });
}

/** What the controls change: the text of each state, or a formula's result as a figure or a curve. */
function outputOf(props) {
  const output = props.output && typeof props.output === 'object' ? props.output : {};
  if (output.kind !== 'figure' && output.kind !== 'chart') return { kind: 'text' };
  return { kind: output.kind, label: text(output.label).trim(), unit: text(output.unit).trim(), formula: list(output.formula), values: numbers(output.values) };
}

const decimalsOf = (value) => Math.min(6, (String(Math.abs(value)).split('.')[1] ?? '').replace(/e.*$/, '').length);
const SPACED_UNIT = /^(?![぀-ヿ㐀-鿿가-힯])[\p{L}\p{N}]/u;

/** A number with `decimals` places and a comma between thousands, and its unit after a space when the unit starts with a letter. */
export function written(value, decimals, unit) {
  const number = value.toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return !unit ? number : SPACED_UNIT.test(unit) ? `${number} ${unit}` : `${number}${unit}`;
}

/** The value at a slider's nth step, to twelve significant digits. */
const stopAt = (slider, n) => Number((slider.min + n * slider.step).toPrecision(12));
const stopsOf = (slider) => Math.round((slider.max - slider.min) / slider.step);
const near = (slider, a, b) => Math.abs(a - b) <= slider.step * 1e-6;

/**
 * The result where the sliders stand at `at`: the value the item states, written as it states it, when every slider stands on the
 * values the item states together, and otherwise the formula's value with as many decimals as the most any stated result has, and
 * `computed` set.
 */
export function resultAt(sliders, output, at) {
  const n = output.values.findIndex((_, i) => sliders.every((slider) => slider.values[i] !== undefined && near(slider, at[slider.name], slider.values[i])));
  if (n >= 0) return { value: output.values[n], shown: written(output.values[n], decimalsOf(output.values[n]), output.unit), computed: false };
  const value = evaluate(output.formula, at);
  const decimals = Math.max(0, ...output.values.map(decimalsOf));
  return value === undefined ? { value, shown: '–', computed: true } : { value, shown: written(value, decimals, output.unit), computed: true };
}

const firstAt = (sliders) => Object.fromEntries(sliders.map((slider) => [slider.name, slider.values[0]]));

/** How the card lays out its default state: every state first, every slider on the first value the item states. */
function plan(item, props) {
  const controls = controlsOf(props);
  const output = outputOf(props);
  const sliders = controls.filter((control) => control.kind === 'slider');
  const switches = controls.filter((control) => control.kind !== 'slider');
  const titleLines = wrap(titleOf(item), COLUMN, TITLE_LETTER, 2);
  if (output.kind === 'text' || sliders.length === 0) {
    const texts = switches.map((control) => ({ words: control.states[0].text, lines: wrap(control.states[0].text, COLUMN, TEXT_LETTER, STATE_LINES) }));
    const height = texts.reduce((sum, { lines }) => sum + lines * TEXT, 0) + TEXT_GAP * Math.max(0, texts.length - 1);
    return { controls: switches, output: { kind: 'text' }, titleLines, texts, height };
  }
  const result = resultAt(sliders, output, firstAt(sliders));
  const mid = figureNeed(result.shown, FIGURES[1]) <= COLUMN * 100;
  const valueLines = mid ? 1 : wrap(result.shown, COLUMN, SMALL_LETTER, VALUE_LINES);
  const figure = { cls: mid ? 'is-mid' : SMALL_CLASS, lead: mid ? MID_LEAD : SMALL_LEAD, valueLines, labelLines: output.label ? wrap(output.label, COLUMN, TEXT_LETTER, LABEL_LINES) : 0 };
  const height = figure.valueLines * figure.lead + FIGURE_GAP + figure.labelLines * TEXT + (output.kind === 'chart' ? PLOT_GAP + PLOT : 0);
  return { controls: sliders, output, titleLines, result, figure, height };
}

export const shows = [];

export function size(item, props) {
  const { controls, titleLines, height } = plan(item, props);
  return [WIDTH, FRAME + MARK + titleLines * TITLE + OUT_GAP + height + controls.length * (ROW_GAP + ROW)];
}

const GLYPH = 'M1.5 4h11M1.5 10h11M4.5 2.2v3.6M9.5 8.2v3.6';
const mark = (words) => h('div', { class: 'explore-mark' },
  s('svg', { class: 'explore-glyph', viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' }, s('path', { d: GLYPH })),
  kind(words.explore));

/** A slider's value with its unit, with the decimals the value has. */
const reading = (slider, value) => written(value, decimalsOf(value), slider.unit);

/** The curve of the result across the first slider, the others where they stand, with a dot at each stated value and a ring where it stands now. */
function curve(sliders, output, at, width, height) {
  const [first] = sliders;
  const root = s('svg', { class: 'chart explore-plot', viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  const steps = Math.min(stopsOf(first), 120);
  const points = Array.from({ length: steps + 1 }, (_, n) => {
    const x = first.min + ((first.max - first.min) * n) / steps;
    return [x, evaluate(output.formula, { ...at, [first.name]: x })];
  }).filter(([, y]) => y !== undefined);
  const ys = [...points.map(([, y]) => y), ...output.values];
  const [lo, hi] = [Math.min(0, ...ys), Math.max(...ys)];
  const [left, right, top, bottom] = [4, 4, 8, 20];
  const x = (v) => left + ((width - left - right) * (v - first.min)) / (first.max - first.min);
  const y = (v) => top + (height - top - bottom) * (1 - (v - lo) / (hi - lo || 1));
  root.append(
    s('line', { class: 'chart-axis', x1: left, x2: width - right, y1: y(lo), y2: y(lo) }),
    s('polyline', { class: 'chart-line', points: points.map(([px, py]) => `${x(px)},${y(py)}`).join(' ') }),
    ...first.values.flatMap((v, i) => (output.values[i] === undefined ? [] : [s('circle', { class: 'chart-dot', cx: x(v), cy: y(output.values[i]), r: 2.5 })])),
  );
  const now = s('circle', { class: 'chart-dot is-marked', r: 4.5 });
  const place = (where) => {
    const value = evaluate(output.formula, where);
    now.setAttribute('cx', x(where[first.name]));
    now.setAttribute('cy', value === undefined ? y(lo) : y(clamp(value, lo, hi)));
  };
  place(at);
  const ends = [[first.min, left, 'start'], [first.max, width - right, 'end']];
  root.append(now, ...ends.map(([v, ex, anchor]) => s('text', { class: 'chart-tick', x: ex, y: height - 5, 'text-anchor': anchor, text: reading(first, v) })));
  return { el: root, place };
}

/** One control's row on the card, as it stands by default. Nothing on it responds: a drag on the field moves the card. */
function row(control) {
  if (control.kind === 'slider') {
    const share = (control.values[0] - control.min) / (control.max - control.min);
    const words = `${control.label} ${reading(control, control.values[0])}`.trim();
    return h('div', { class: 'explore-row' },
      say('span', 'explore-reading', cut(words, COLUMN - TRACK - 8, TEXT_LETTER)),
      h('span', { class: 'explore-track', style: { width: `${TRACK}px` } }, h('span', { class: 'explore-knob', style: { left: `${share * 100}%` } })));
  }
  const pill = Math.floor((COLUMN - PILL_GAP * (control.states.length - 1)) / control.states.length);
  return h('div', { class: 'explore-row' }, control.states.map((state, i) =>
    say('span', `explore-pill${i === 0 ? ' is-on' : ''}`, cut(state.name, pill - PILL_PAD, TEXT_LETTER))));
}

const figureOf = (figure, result, label) => h('div', { class: 'explore-figure' },
  say('div', `fact-value ${figure.cls}`, result.shown),
  label && say('div', `fact-label clamp-${figure.labelLines}`, label));

export function draw(item, props) {
  const layout = plan(item, props);
  const words = wordsOf(item);
  const sliders = layout.controls.filter((control) => control.kind === 'slider');
  return [
    mark(words),
    title(item, layout.titleLines),
    h('div', { class: 'explore-out' },
      layout.output.kind === 'text'
        ? layout.texts.map(({ words: said, lines }) => say('div', `explore-text clamp-${lines}`, said))
        : [figureOf(layout.figure, layout.result, layout.output.label), layout.output.kind === 'chart' && curve(sliders, layout.output, firstAt(sliders), COLUMN, PLOT).el]),
    layout.controls.map(row),
  ];
}

/** A row of buttons of which one is chosen, moved along by the arrow keys, Home and End. */
function segmented(control, choose) {
  const buttons = control.states.map((state) => h('button', { class: 'explore-option', type: 'button', role: 'radio', dir: 'auto', text: state.name }));
  const pick = (n, focus) => {
    buttons.forEach((button, i) => {
      button.setAttribute('aria-checked', String(i === n));
      button.tabIndex = i === n ? 0 : -1;
    });
    if (focus) buttons[n].focus();
    choose(n);
  };
  const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  buttons.forEach((button, i) => {
    button.addEventListener('click', () => pick(i, false));
    button.addEventListener('keydown', (e) => {
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Object.hasOwn(moves, e.key) ? (i + moves[e.key] + buttons.length) % buttons.length : -1;
      if (n < 0) return;
      e.preventDefault();
      pick(n, true);
    });
  });
  const group = h('div', { class: 'explore-segmented', role: 'radiogroup', 'aria-label': control.label || null }, buttons);
  pick(0, false);
  return group;
}

/** A switch between a toggle's two states, which names the state it is in. */
function toggle(control, choose) {
  const named = say('span', 'explore-state', control.states[0].name);
  const button = h('button', { class: 'explore-switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': control.label || null },
    h('span', { class: 'explore-switch-track', 'aria-hidden': 'true' }, h('span', { class: 'explore-switch-thumb' })), named);
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(on));
    named.textContent = control.states[on ? 1 : 0].name;
    choose(on ? 1 : 0);
  });
  return button;
}

/** Every control working, and what they change. Each state's text is in the view, and only the chosen one shows. */
export function detail(item, props) {
  const layout = plan(item, props);
  const words = wordsOf(item);
  const labelled = (control, input) => h('div', { class: 'explore-control' },
    control.label && control.label !== item.title && say('div', 'explore-name', control.label), input);

  if (layout.output.kind === 'text') {
    const texts = layout.controls.map((control) => control.states.map((state, i) => h('p', { class: 'explore-state-text', dir: 'auto', text: state.text, hidden: i !== 0 })));
    const show = (c) => (n) => texts[c].forEach((el, i) => { el.hidden = i !== n; });
    return [h('div', { class: 'detail-explorable' },
      layout.controls.map((control, c) => labelled(control, control.kind === 'toggle' ? toggle(control, show(c)) : segmented(control, show(c)))),
      h('div', { class: 'explore-out', 'aria-live': 'polite' }, texts))];
  }

  const sliders = layout.controls;
  const { output } = layout;
  const at = firstAt(sliders);
  const value = say('div', 'fact-value', layout.result.shown);
  const computed = h('span', { class: 'explore-computed', text: words.computed, hidden: true });
  const plot = output.kind === 'chart' ? curve(sliders, output, at, 300, 150) : null;
  const update = () => {
    const result = resultAt(sliders, output, at);
    value.textContent = result.shown;
    computed.hidden = !result.computed;
    plot?.place(at);
  };
  const inputs = sliders.map((slider) => {
    const shown = say('output', 'explore-reading', reading(slider, at[slider.name]));
    const range = h('input', { class: 'explore-range', type: 'range', min: slider.min, max: slider.max, step: slider.step, value: at[slider.name], 'aria-label': slider.label || null, 'aria-valuetext': reading(slider, at[slider.name]) });
    range.addEventListener('input', () => {
      const n = clamp(Math.round((Number(range.value) - slider.min) / slider.step), 0, stopsOf(slider));
      at[slider.name] = stopAt(slider, n);
      shown.textContent = reading(slider, at[slider.name]);
      range.setAttribute('aria-valuetext', shown.textContent);
      update();
    });
    return labelled(slider, h('div', { class: 'explore-slider' }, range, shown));
  });
  return [h('div', { class: 'detail-explorable' },
    h('div', { class: 'explore-out', 'aria-live': 'polite' },
      h('div', { class: 'explore-figure' }, h('div', { class: 'explore-value' }, value, computed), output.label && say('div', 'fact-label', output.label)),
      plot?.el),
    inputs)];
}
