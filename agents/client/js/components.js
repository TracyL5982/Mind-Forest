import { h, s, clamp, safeUrl } from './dom.js';

const text = (value) => (typeof value === 'string' ? value : '');
const list = (value) => (Array.isArray(value) ? value : []);
const title = (item, lines = 2) => h('div', { class: `card-title clamp-${lines}`, text: item.title || 'Untitled' });
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('') || '?';

function picture(src, alt, ctx) {
  const img = h('img', { src: ctx.asset(src), alt, loading: 'lazy', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'media-missing', text: 'Picture unavailable' })));
  return img;
}

function chart(props, width, height) {
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

/**
 * Every way one card can be drawn. `size` is the card's fixed footprint, so the field can be laid
 * out without measuring the page. `draw` returns the card's contents from the item plus the props.
 */
export const COMPONENTS = {
  note: {
    size: () => [232, 126],
    draw: (item, props) => [
      title(item),
      text(props.emphasis) && h('div', { class: 'note-emphasis clamp-1', text: props.emphasis }),
      (item.summary || item.text) !== item.title && h('div', { class: `card-text ${text(props.emphasis) ? 'clamp-2' : 'clamp-3'}`, text: item.summary || item.text }),
    ],
  },
  quote: {
    size: () => [276, 156],
    draw: (item, props) => [
      h('div', { class: 'quote-mark', text: '“', 'aria-hidden': 'true' }),
      h('blockquote', { class: 'quote-text clamp-4', text: text(props.text) || item.text || item.title }),
      text(props.by) && h('div', { class: 'quote-by clamp-1', text: `— ${props.by}` }),
    ],
  },
  fact: {
    size: () => [196, 130],
    draw: (item, props) => [
      h('div', { class: 'fact-value', text: text(props.value) || '–' }),
      h('div', { class: 'fact-label clamp-2', text: text(props.label) }),
      h('div', { class: 'card-foot clamp-1', text: item.title }),
    ],
  },
  image: {
    size: (item, props) => [236, clamp(Math.round(236 / (Number(props.aspect) || 1.35)), 130, 260)],
    draw: (item, props, ctx) => [
      picture(text(props.src), item.title, ctx),
      h('div', { class: 'media-caption clamp-2', text: text(props.caption) || item.title }),
    ],
  },
  video: {
    size: () => [264, 172],
    draw: (item, props, ctx) => [
      text(props.poster)
        ? picture(props.poster, item.title, ctx)
        : h('video', { src: ctx.asset(text(props.src)), preload: 'metadata', muted: true, playsinline: true, tabindex: '-1' }),
      h('div', { class: 'media-play', 'aria-hidden': 'true' }),
      h('div', { class: 'media-caption clamp-2', text: text(props.caption) || item.title }),
    ],
  },
  link: {
    size: (item, props) => [text(props.image) ? 304 : 264, 126],
    draw: (item, props, ctx) => {
      const site = text(props.site) || 'link';
      return [
        h('div', { class: 'link-main' },
          h('div', { class: 'link-site' }, h('span', { class: 'link-dot', text: site[0].toUpperCase() }), h('span', { class: 'clamp-1', text: site })),
          title(item),
          h('div', { class: 'card-text clamp-2', text: text(props.description) || item.summary }),
        ),
        text(props.image) && h('div', { class: 'link-thumb' }, picture(props.image, '', ctx)),
      ];
    },
  },
  chart: {
    size: () => [276, 180],
    draw: (item, props) => [
      h('div', { class: 'chart-head' }, title(item, 1), text(props.unit) && h('span', { class: 'chart-unit', text: props.unit })),
      chart(props, 244, 112),
    ],
  },
  person: {
    size: () => [236, 92],
    draw: (item, props, ctx) => {
      const name = text(props.name) || item.title;
      return [
        h('div', { class: 'person-face' }, text(props.image) ? picture(props.image, name, ctx) : initials(name)),
        h('div', { class: 'person-main' },
          h('div', { class: 'card-title clamp-1', text: name }),
          text(props.role) && h('div', { class: 'card-text clamp-1', text: props.role }),
          item.title !== name && h('div', { class: 'card-foot clamp-1', text: item.title }),
        ),
      ];
    },
  },
  chat: {
    size: (item, props) => [276, 56 + 46 * clamp(list(props.messages).length, 1, 3)],
    draw: (item, props) => [
      h('div', { class: 'chart-head' }, title(item, 1), text(props.source) && h('span', { class: 'chart-unit', text: props.source })),
      list(props.messages).slice(0, 3).map((message) =>
        h('div', { class: `bubble clamp-2 ${message.role === 'user' ? 'is-user' : ''}`, text: text(message.text) })),
    ],
  },
  code: {
    size: () => [296, 166],
    draw: (item, props) => [
      h('div', { class: 'chart-head' }, title(item, 1), h('span', { class: 'chart-unit', text: text(props.language) || 'text' })),
      h('pre', { class: 'code-source', text: text(props.source).split('\n').slice(0, 7).join('\n') }),
    ],
  },
  steps: {
    size: (item, props) => {
      const n = list(props.steps).length;
      return [244, 52 + 27 * clamp(n, 1, 5) + (n > 5 ? 20 : 0)];
    },
    draw: (item, props) => {
      const steps = list(props.steps).map(String);
      return [
        title(item, 1),
        h('ol', { class: 'steps' }, steps.slice(0, 5).map((step, i) =>
          h('li', null, h('span', { class: 'step-n', text: String(i + 1) }), h('span', { class: 'clamp-1', text: step })))),
        steps.length > 5 && h('div', { class: 'card-foot', text: `and ${steps.length - 5} more` }),
      ];
    },
  },
};

export const componentOf = (node) => (COMPONENTS[node.view?.component] ? node.view.component : 'note');

export function sizeOf(node, item) {
  return COMPONENTS[componentOf(node)].size(item, node.view?.props ?? {});
}

export function drawCard(node, item, ctx) {
  const name = componentOf(node);
  const props = name === node.view?.component ? (node.view.props ?? {}) : {};
  return COMPONENTS[name].draw(item, props, ctx);
}

/** The longer form shown when a card is opened: the parts a small card had to cut. */
export function drawDetail(node, item, ctx) {
  const name = componentOf(node);
  const props = node.view?.props ?? {};
  const parts = [];
  if (name === 'image') parts.push(h('div', { class: 'detail-media' }, picture(text(props.src), item.title, ctx)));
  if (name === 'video') {
    const embed = /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}$/.test(text(item.data?.embed)) ? item.data.embed : '';
    parts.push(h('div', { class: 'detail-media' }, embed
      ? h('iframe', { src: embed, title: item.title, allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' })
      : h('video', { src: ctx.asset(text(props.src)), controls: true, playsinline: true, preload: 'metadata' })));
  }
  if (name === 'quote') parts.push(h('blockquote', { class: 'detail-quote', text: text(props.text) }), text(props.by) && h('div', { class: 'quote-by', text: `— ${props.by}` }));
  if (name === 'fact') parts.push(h('div', { class: 'detail-fact' }, h('span', { class: 'fact-value', text: text(props.value) }), h('span', { class: 'fact-label', text: text(props.label) })));
  if (name === 'chart') parts.push(h('div', { class: 'detail-chart' }, chart(props, 320, 150), text(props.unit) && h('div', { class: 'chart-unit', text: props.unit })));
  if (name === 'steps') parts.push(h('ol', { class: 'steps is-full' }, list(props.steps).map((step, i) => h('li', null, h('span', { class: 'step-n', text: String(i + 1) }), h('span', { text: String(step) })))));
  if (name === 'chat') parts.push(h('div', { class: 'detail-chat' }, list(item.data?.messages ?? props.messages).slice(0, 40).map((m) => h('div', { class: `bubble ${m.role === 'user' ? 'is-user' : ''}`, text: text(m.text) }))));
  if (name === 'code') parts.push(h('pre', { class: 'code-source is-full', text: text(props.source) }));
  if (name === 'person') parts.push(h('div', { class: 'detail-person' }, h('div', { class: 'person-face' }, text(props.image) ? picture(props.image, text(props.name), ctx) : initials(text(props.name) || item.title)), h('div', null, h('div', { class: 'card-title', text: text(props.name) }), h('div', { class: 'card-text', text: text(props.role) }))));
  if (name === 'link' && safeUrl(text(props.url)) && text(props.image)) parts.push(h('div', { class: 'detail-media' }, picture(props.image, '', ctx)));
  return parts;
}
