import { h, s, clamp } from '../dom.js';

/**
 * The line heights and card padding in style.css, in px. A card's footprint is worked out from
 * these and never measured, so they change together with `--lead-*` and `.card-body`.
 */
export const DISPLAY = 36;
export const TITLE = 21;
export const TEXT = 17;
/** Top and bottom padding plus the border of a padded card. */
export const FRAME = 30;

export const text = (value) => (typeof value === 'string' ? value : '');
export const list = (value) => (Array.isArray(value) ? value : []);
export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';

/**
 * How wide one average lowercase letter is, in px, at the title size and at the text size. Each is
 * the widest ratio of drawn width to `span` over a set of sample strings, so most strings run short.
 */
export const TITLE_LETTER = 9.5;
export const TEXT_LETTER = 7.4;

const letter = (ch) => {
  if (ch.codePointAt(0) >= 0x2e80) return 2;
  if (/[\s.,:;'!|()[\]fijlrt]/.test(ch)) return 0.5;
  if (/[mwMW@]/.test(ch)) return 1.5;
  return /[A-Z]/.test(ch) ? 1.2 : 1;
};

/** A string's width in average lowercase letters. Han, kana and hangul count double. */
export const span = (str) => [...str].reduce((n, ch) => n + letter(ch), 0);

/**
 * How many lines a string is given in a column `width` px wide, when one letter is `letterPx`
 * wide. A card draws the string clamped to this many lines, so a wrong guess shows an ellipsis
 * or a blank line and never spills. Two letters a line are allowed for breaking between words.
 */
export function fold(str, width, letterPx, max) {
  const perLine = width / letterPx;
  const letters = span(str);
  return letters <= perLine ? 1 : clamp(Math.ceil(letters / (perLine - 2)), 1, max);
}

export const title = (item, lines = 2) => h('div', { class: `card-title clamp-${lines}`, text: item.title || 'Untitled' });

/** A short label that names what a card is: a clip, a language, where a chat came from. */
export const kind = (label) => h('span', { class: 'kind', text: label });

/** A one-line title with the card's kind at its right. */
export const head = (item, label) => h('div', { class: 'card-head' }, title(item, 1), kind(label));

export function picture(src, alt, ctx) {
  const img = h('img', { src: ctx.asset(src), alt, loading: 'lazy', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'media-missing', text: 'Picture unavailable' })));
  return img;
}

/** A picture or poster at a fixed height, with its caption on a plate below it. */
export const framed = (height, caption, lines, media, label) => [
  h('div', { class: 'media-frame', style: { height: `${height}px` } }, media),
  h('div', { class: 'media-plate' }, h('div', { class: `media-caption clamp-${lines}`, text: caption }), label && kind(label)),
];

/** The height `framed` takes: the picture, the plate's padding, the caption, the border. */
export const framedHeight = (height, lines) => height + 18 + lines * TEXT + 3;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

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

const cut = (label, room) => (label.length > room ? `${label.slice(0, Math.max(1, room - 1))}…` : label);

/**
 * A bar or line chart with gridlines. On a card, labels are thinned to what fits. With `every`,
 * for the opened card, each label and each value is drawn, slanted when they are crowded.
 */
export function chart(props, width, height, { every = false } = {}) {
  const values = list(props.values).map(Number).filter(Number.isFinite);
  const labels = list(props.labels).map(String);
  const n = values.length;
  const marked = Number.isInteger(props.mark) && props.mark >= 0 && props.mark < n ? props.mark : -1;
  const line = props.chart === 'line';
  const grid = gridValues(Math.min(...values, 0), Math.max(...values, 0));
  const lo = grid[0];
  const hi = grid.at(-1);
  const gridText = grid.map((v) => compact.format(v));

  const left = 10 + Math.max(...gridText.map((t) => t.length)) * 7;
  const right = 4;
  const step = (width - left - right) / Math.max(n, 1);
  const longest = Math.max(0, ...labels.slice(0, n).map((label) => label.length));
  const slant = every && longest * 7 > step - 4;
  const top = 20;
  const bottom = slant ? 16 + Math.min(longest, 14) * 4.6 : 22;
  const y = (v) => top + (height - top - bottom) * (1 - (v - lo) / (hi - lo));
  const x = (i) => left + step * (i + 0.5);

  const root = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Chart' });
  grid.forEach((v, i) => {
    root.append(
      s('line', { class: v === 0 ? 'chart-axis' : 'chart-grid', x1: left, x2: width - right, y1: y(v), y2: y(v) }),
      s('text', { class: 'chart-tick', x: left - 6, y: y(v) + 4, 'text-anchor': 'end', text: gridText[i] }),
    );
  });
  if (line && marked >= 0) root.append(s('line', { class: 'chart-guide', x1: x(marked), x2: x(marked), y1: y(values[marked]), y2: y(lo) }));
  if (line && n > 1) root.append(s('polyline', { class: 'chart-line', points: values.map((v, i) => `${x(i)},${y(v)}`).join(' ') }));

  const thinned = !every && n > 8;
  const labelRoom = Math.max(2, Math.floor((thinned ? (width - left - right) / 3 : step - 4) / 7));
  const valued = (i) => i === marked || (step >= 30 && (every || n <= 6));
  const labelled = (i) => !thinned || i === 0 || i === n - 1 || (i === marked && i > n * 0.25 && i < n * 0.7);

  values.forEach((v, i) => {
    const is = i === marked ? ' is-marked' : '';
    if (line) {
      if (is || n <= 16) root.append(s('circle', { class: `chart-dot${is}`, cx: x(i), cy: y(v), r: is ? 4.5 : 2.5 }));
    } else {
      const barWidth = clamp(step * 0.62, 3, 44);
      root.append(s('rect', { class: `chart-bar${is}`, x: x(i) - barWidth / 2, y: Math.min(y(v), y(0)), width: barWidth, height: Math.max(2, Math.abs(y(v) - y(0))), rx: 2 }));
    }
    if (valued(i)) root.append(s('text', { class: `chart-value${is}`, x: x(i), y: Math.min(y(v), y(0)) - (line ? 9 : 6), 'text-anchor': 'middle', text: v.toLocaleString('en') }));
    if (!labelled(i) || !labels[i]) return;
    const at = { class: `chart-label${is}`, text: cut(labels[i], slant ? 14 : labelRoom) };
    if (slant) root.append(s('text', { ...at, 'text-anchor': 'end', transform: `translate(${x(i) + 3} ${height - bottom + 13}) rotate(-40)` }));
    else if (thinned && i === 0) root.append(s('text', { ...at, x: left, y: height - 5, 'text-anchor': 'start' }));
    else if (thinned && i === n - 1) root.append(s('text', { ...at, x: width - right, y: height - 5, 'text-anchor': 'end' }));
    else root.append(s('text', { ...at, x: x(i), y: height - 5, 'text-anchor': 'middle' }));
  });
  return root;
}
