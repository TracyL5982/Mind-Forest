import { h, safeUrl } from '../dom.js';
import { TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, fold, picture, text, title } from './shared.js';

const BAR = 30;
const THUMB = 64;

function plan(item, props) {
  const thumb = text(props.image);
  const about = text(props.description) || item.summary || '';
  const width = thumb ? 316 : 272;
  const column = width - 33 - (thumb ? 96 : 0);
  return {
    thumb,
    about,
    width,
    titleLines: fold(item.title || 'Untitled', column, TITLE_LETTER, 2),
    aboutLines: about ? fold(about, column, TEXT_LETTER, 2) : 0,
  };
}

export function size(item, props) {
  const { thumb, width, titleLines, aboutLines } = plan(item, props);
  const main = titleLines * TITLE + (aboutLines ? 4 + aboutLines * TEXT : 0);
  return [width, 3 + BAR + 10 + Math.max(main, thumb ? THUMB : 0) + 13];
}

export function draw(item, props, ctx) {
  const { thumb, about, titleLines, aboutLines } = plan(item, props);
  const site = text(props.site) || 'link';
  return [
    h('div', { class: 'link-site' },
      h('span', { class: 'link-dot', text: site[0].toUpperCase() }),
      h('span', { class: 'link-host clamp-1', text: site }),
      h('span', { class: 'link-out', 'aria-hidden': 'true', text: '↗' })),
    h('div', { class: 'link-row' },
      h('div', { class: 'link-main' },
        title(item, titleLines),
        about && h('div', { class: `card-text clamp-${aboutLines}`, text: about })),
      thumb && h('div', { class: 'link-thumb' }, picture(thumb, '', ctx))),
  ];
}

export const detail = (item, props, ctx) => [
  safeUrl(text(props.url)) && text(props.image) && h('div', { class: 'detail-media' }, picture(props.image, '', ctx)),
];
