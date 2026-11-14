import { h, s, clamp } from '../dom.js';

export const text = (value) => (typeof value === 'string' ? value : '');
export const list = (value) => (Array.isArray(value) ? value : []);
export const title = (item, lines = 2) => h('div', { class: `card-title clamp-${lines}`, text: item.title || 'Untitled' });
export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';

/** A one-line title with a short tag at its right: a unit, a language, where a chat came from. */
export const head = (item, tag) => h('div', { class: 'chart-head' }, title(item, 1), tag && h('span', { class: 'chart-unit', text: tag }));

export function picture(src, alt, ctx) {
  const img = h('img', { src: ctx.asset(src), alt, loading: 'lazy', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'media-missing', text: 'Picture unavailable' })));
  return img;
}

export function chart(props, width, height) {
  const values = list(props.values).map(Number).filter(Number.isFinite);
  const labels = list(props.labels).map(String);
  const n = values.length;
  const top = 16;
  const bottom = 16;
  const plot = height - top - bottom;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const y = (v) => top + plot * (1 - (v - min) / span);
  const step = width / Math.max(n, 1);
  const x = (i) => step * (i + 0.5);
  const root = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Chart' });
  root.append(s('line', { class: 'chart-axis', x1: 0, x2: width, y1: y(0), y2: y(0) }));
  if (props.chart === 'line' && n > 1) {
    root.append(s('polyline', { class: 'chart-line', points: values.map((v, i) => `${x(i)},${y(v)}`).join(' ') }));
  }
  values.forEach((v, i) => {
    const marked = props.mark === i ? ' is-marked' : '';
    if (props.chart === 'line') {
      root.append(s('circle', { class: `chart-dot${marked}`, cx: x(i), cy: y(v), r: 3.5 }));
    } else {
      const barWidth = clamp(step * 0.62, 6, 46);
      const y0 = Math.min(y(v), y(0));
      root.append(s('rect', { class: `chart-bar${marked}`, x: x(i) - barWidth / 2, y: y0, width: barWidth, height: Math.max(2, Math.abs(y(v) - y(0))), rx: 3 }));
    }
    if (n <= 8) {
      root.append(s('text', { class: 'chart-value', x: x(i), y: Math.min(y(v), y(0)) - 4, 'text-anchor': 'middle', text: String(v) }));
      root.append(s('text', { class: 'chart-label', x: x(i), y: height - 3, 'text-anchor': 'middle', text: (labels[i] ?? '').slice(0, Math.max(3, Math.floor(step / 6))) }));
    }
  });
  return root;
}
