import { h, s, clamp } from '../dom.js';

/**
 * The line heights and card padding in style.css, in px. A card's footprint is worked out from
 * these and never measured, so they change together with `--lead-*` and `.card-body`.
 */
export const DISPLAY = 36;
export const TITLE = 21;
export const TEXT = 17;
/** Top and bottom padding plus the border of a padded card, and 2 px to spare. */
export const FRAME = 30;
/** Left and right padding plus the border of a padded card, and 1 px to spare. */
export const SIDES = 33;

export const text = (value) => (typeof value === 'string' ? value : '');
export const list = (value) => (Array.isArray(value) ? value : []);

/**
 * How wide each character is, in tenths of an average lowercase letter. Rows are
 * `[first code point, last code point, tenths]` and the first row that holds a code point wins.
 * A code point in no row counts 10. docs/libraries.md repeats this table for other clients, and
 * test/footprints.json holds the footprints it must give.
 */
const WIDTHS = [
  // Marks that join or change the character before them take no room.
  [0x0300, 0x036f, 0], [0x200b, 0x200f, 0], [0x2060, 0x2064, 0], [0xfe00, 0xfe0f, 0], [0x1f3fb, 0x1f3ff, 0], [0xe0000, 0xe007f, 0],
  // Spaces, thin punctuation, and i j l.
  [0x09, 0x0d, 5], [0x20, 0x21, 5], [0x27, 0x27, 5], [0x2c, 0x2c, 5], [0x2e, 0x2f, 5], [0x3a, 0x3b, 5], [0x5c, 0x5c, 5], [0x69, 0x6a, 5], [0x6c, 0x6c, 5], [0x7c, 0x7c, 5],
  [0xa0, 0xa0, 5], [0x2000, 0x200a, 5], [0x2018, 0x2019, 5], [0x2028, 0x2029, 5], [0x202f, 0x202f, 5], [0x205f, 0x205f, 5],
  // Brackets, the hyphen, and f r t.
  [0x28, 0x29, 7], [0x2d, 0x2d, 7], [0x5b, 0x5b, 7], [0x5d, 0x5d, 7], [0x7b, 0x7b, 7], [0x7d, 0x7d, 7], [0x66, 0x66, 7], [0x72, 0x72, 7], [0x74, 0x74, 7],
  // Digits and the signs set as wide as a digit.
  [0x30, 0x39, 11], [0x23, 0x24, 11], [0x2b, 0x2b, 11], [0x3c, 0x3e, 11], [0x5e, 0x5e, 11], [0x7e, 0x7e, 11], [0xa3, 0xa3, 11], [0xd7, 0xd7, 11], [0x20ac, 0x20ac, 11],
  // The widest letters and signs.
  [0x25, 0x25, 15], [0x40, 0x40, 15], [0x4d, 0x4d, 15], [0x6d, 0x6d, 15], [0x77, 0x77, 15], [0x2014, 0x2014, 15], [0x2026, 0x2026, 15],
  [0x57, 0x57, 17],
  // Capitals and the ampersand.
  [0x26, 0x26, 12], [0x41, 0x5a, 12],
  // Arrows, symbols and emoji. Two regional indicators draw one flag.
  [0x2190, 0x2bff, 22], [0x1f1e6, 0x1f1ff, 11], [0x1f000, 0x1faff, 22],
  // Han, kana, hangul, full-width forms, and everything above them.
  [0x2e80, 0x10ffff, 20],
];
const JOINER = 0x200d;
const LOW = 0x250;
const low = new Uint8Array(LOW).fill(10);
for (const [first, last, tenths] of [...WIDTHS].reverse()) {
  for (let cp = first; cp <= Math.min(last, LOW - 1); cp++) low[cp] = tenths;
}
const tenthsOf = (cp) => (cp < LOW ? low[cp] : (WIDTHS.find(([first, last]) => cp >= first && cp <= last)?.[2] ?? 10));

/**
 * A string's width in tenths of an average lowercase letter, always a whole number. A code point
 * that follows a zero-width joiner counts nothing, so a joined emoji counts once.
 */
export function span(str) {
  let tenths = 0;
  let joined = false;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (!joined) tenths += tenthsOf(cp);
    joined = cp === JOINER;
  }
  return tenths;
}

/**
 * How wide one average lowercase letter is at the title size and at the text size, in tenths of a
 * px. Each is the widest ratio of drawn width to `span` over a set of sample strings, so most
 * strings run short. `span` times one of these is a width in hundredths of a px.
 */
export const TITLE_LETTER = 93;
export const TEXT_LETTER = 72;

/** a / b rounded up, for whole numbers. */
export const up = (a, b) => Math.floor((a + b - 1) / b);

/** The px a string is given at the text size. Most strings draw a little narrower. */
export const textWidth = (str) => up(span(str) * TEXT_LETTER, 100);

/**
 * How many lines a string is given in a column `width` px wide, when one letter is `letter` tenths
 * of a px wide. A card draws the string clamped to this many lines, so a wrong guess shows an
 * ellipsis or a blank line and never spills. Two letters a line are allowed for breaking between
 * words. Every step is in whole hundredths of a px.
 */
export function fold(str, width, letter, max) {
  const need = span(str) * letter;
  const room = width * 100;
  return need <= room ? 1 : clamp(up(need, room - 20 * letter), 1, max);
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** A string as the characters a reader sees, so a cut never lands inside an emoji or an accent. */
export function graphemes(str) {
  if (segmenter) return Array.from(segmenter.segment(str), (part) => part.segment);
  const parts = [];
  let joined = false;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (parts.length > 0 && (joined || tenthsOf(cp) === 0)) parts[parts.length - 1] += ch;
    else parts.push(ch);
    joined = cp === JOINER;
  }
  return parts;
}

/** The string, or as much of its start as fits `room` px with an ellipsis, counted like `fold`. */
export function cut(str, room, letter) {
  if (span(str) * letter <= room * 100) return str;
  const budget = room * 100 - span('…') * letter;
  let used = 0;
  let kept = '';
  for (const part of graphemes(str)) {
    used += span(part) * letter;
    if (used > budget && kept) break;
    kept += part;
  }
  return `${kept.trimEnd()}…`;
}

export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => graphemes(word)[0].toUpperCase()).join('') || '?';

/** Text in its own element. `dir` lets Arabic and Hebrew align and shorten from their own side. */
export const say = (tag, cls, str) => h(tag, { class: cls, dir: 'auto', text: str });

export const title = (item, lines = 2) => say('div', `card-title clamp-${lines}`, item.title || 'Untitled');

/** A short label that names what a card is: a language, where a chat came from, a kind of group. */
export const kind = (label) => h('span', { class: 'kind', text: label });

/** A picture. When it fails to load, `missing()` is drawn in its place. */
export function picture(src, alt, ctx, missing = () => h('div', { class: 'media-missing', text: 'Picture unavailable' })) {
  const img = h('img', { src: ctx.asset(src), alt, loading: 'lazy', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(missing()));
  return img;
}

/** A picture or poster at a fixed height, with its caption, when it has one, on a plate below. */
export const framed = (height, caption, lines, media) => [
  h('div', { class: 'media-frame', style: { height: `${height}px` } }, media),
  caption && h('div', { class: 'media-plate' }, say('div', `media-caption clamp-${lines}`, caption)),
];

/** The height `framed` takes: the picture and the border, and the plate's padding and caption. */
export const framedHeight = (height, lines) => height + 2 + (lines ? 19 + lines * TEXT : 0);

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });
const short = (value) => compact.format(value);

/** Round gridline values that cover min to max in about three steps. */
function gridValues(min, max) {
  if (max === min) max = min + 1;
  const rough = (max - min) / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((size) => size >= rough);
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step);
  return Array.from({ length: last - first + 1 }, (_, i) => Number(((first + i) * step).toPrecision(12)));
}

/** What a chart holds, as numbers and the label of each. A value that is not a number is left out. */
export function series(props) {
  const values = list(props.values).map(Number).filter(Number.isFinite);
  const given = list(props.labels);
  const labels = values.map((_, i) => (given[i] === undefined || given[i] === null ? '' : String(given[i])));
  const mark = Number.isInteger(props.mark) && props.mark >= 0 && props.mark < values.length ? props.mark : -1;
  return { values, labels, mark };
}

/**
 * A bar or line chart with gridlines and a scale. Labels and values are written level, in short
 * form, and only where they fit. When a slot is narrower than the labels, or than 44 px for long
 * labels, every nth label is written, the marked, first and last ones before the rest, and a
 * label longer than its slots is cut. On a card, values are
 * written for six points or fewer. `whole` says every label and value is on the plot in full.
 */
export function plot(props, width, height, { opened = false } = {}) {
  const { values, labels, mark } = series(props);
  const n = values.length;
  const root = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Chart' });
  if (n === 0) {
    root.append(s('text', { class: 'chart-empty', x: width / 2, y: height / 2 + 4, 'text-anchor': 'middle', text: 'No data' }));
    return { el: root, whole: true };
  }
  const line = props.chart === 'line';
  const grid = gridValues(Math.min(...values, 0), Math.max(...values, 0));
  const lo = grid[0];
  const hi = grid.at(-1);
  const gridText = grid.map(short);

  const left = 10 + Math.max(...gridText.map(textWidth));
  const right = 4;
  const top = 20;
  const bottom = 22;
  const step = (width - left - right) / n;
  const y = (v) => top + (height - top - bottom) * (1 - (v - lo) / (hi - lo));
  const x = (i) => left + step * (i + 0.5);
  const is = (i) => (i === mark ? ' is-marked' : '');

  grid.forEach((v, i) => {
    root.append(
      s('line', { class: v === 0 ? 'chart-axis' : 'chart-grid', x1: left, x2: width - right, y1: y(v), y2: y(v) }),
      s('text', { class: 'chart-tick', x: left - 6, y: y(v) + 4, 'text-anchor': 'end', text: gridText[i] }),
    );
  });
  if (line && mark >= 0) root.append(s('line', { class: 'chart-guide', x1: x(mark), x2: x(mark), y1: y(values[mark]), y2: y(lo) }));
  if (line && n > 1) root.append(s('polyline', { class: 'chart-line', points: values.map((v, i) => `${x(i)},${y(v)}`).join(' ') }));
  values.forEach((v, i) => {
    if (line) {
      if (i === mark || n <= 16) root.append(s('circle', { class: `chart-dot${is(i)}`, cx: x(i), cy: y(v), r: i === mark ? 4.5 : 2.5 }));
    } else {
      const barWidth = clamp(step * 0.62, 3, 44);
      root.append(s('rect', { class: `chart-bar${is(i)}`, x: x(i) - barWidth / 2, y: Math.min(y(v), y(0)), width: barWidth, height: Math.max(2, Math.abs(y(v) - y(0))), rx: 2 }));
    }
  });

  /** Writes `str` centred on `at` and pulled inside `from` and `to`, unless it would touch a string already in `row`. */
  const write = (row, cls, str, at, from, to, baseline) => {
    const wide = textWidth(str);
    const ideal = at - wide / 2;
    const start = clamp(ideal, from, Math.max(from, to - wide));
    if (row.some(([a, b]) => start < b + 6 && a < start + wide + 6)) return false;
    row.push([start, start + wide]);
    const [anchor, ax] = start > ideal ? ['start', from] : start < ideal ? ['end', to] : ['middle', at];
    root.append(s('text', { class: cls, x: ax, y: baseline, 'text-anchor': anchor, text: str }));
    return true;
  };
  const markedFirst = [...new Set([mark, 0, n - 1, ...values.keys()])].filter((i) => i >= 0);

  /** On a line, a point lower than both its neighbours has the line above it, so its value goes below. */
  const dips = (i) => line && n > 1 && (values[i - 1] ?? Infinity) > values[i] && (values[i + 1] ?? Infinity) > values[i] && y(values[i]) + 22 <= height - bottom;
  const valueText = values.map(short);
  const allFit = Math.max(...valueText.map(textWidth)) <= step - 4;
  const valued = values.map((_, i) => i === mark || (allFit && (opened || n <= 6)));
  const valueRow = [];
  for (const i of markedFirst) {
    if (valued[i]) write(valueRow, `chart-value${is(i)}`, valueText[i], x(i), left, width, dips(i) ? y(values[i]) + 18 : Math.max(12, Math.min(y(values[i]), y(0)) - (line ? 9 : 6)));
  }

  const widest = Math.max(...labels.map(textWidth));
  const stride = Math.max(1, Math.ceil((Math.min(widest, 44) + 6) / step));
  const room = Math.floor(stride * step - 6);
  const labelRow = [];
  const written = new Set(markedFirst
    .filter((i) => labels[i] && (i % stride === 0 || i === mark || i === n - 1))
    .filter((i) => write(labelRow, `chart-label${is(i)}`, cut(labels[i], room, TEXT_LETTER), x(i), 0, width, height - 5)));

  const whole = values.every((v, i) => valued[i] && Number(v.toPrecision(3)) === v && (!labels[i] || (written.has(i) && span(labels[i]) * TEXT_LETTER <= room * 100)));
  return { el: root, whole };
}
