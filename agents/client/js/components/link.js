import { h, safeUrl } from '../dom.js';
import { picture, text, title } from './shared.js';

export const size = (item, props) => [text(props.image) ? 304 : 264, 126];

export function draw(item, props, ctx) {
  const site = text(props.site) || 'link';
  return [
    h('div', { class: 'link-main' },
      h('div', { class: 'link-site' }, h('span', { class: 'link-dot', text: site[0].toUpperCase() }), h('span', { class: 'clamp-1', text: site })),
      title(item),
      h('div', { class: 'card-text clamp-2', text: text(props.description) || item.summary }),
    ),
    text(props.image) && h('div', { class: 'link-thumb' }, picture(props.image, '', ctx)),
  ];
}

export const detail = (item, props, ctx) => [
  safeUrl(text(props.url)) && text(props.image) && h('div', { class: 'detail-media' }, picture(props.image, '', ctx)),
];
