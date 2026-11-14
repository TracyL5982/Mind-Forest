import { h, safeUrl } from '../dom.js';
import { SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, fold, graphemes, picture, say, text, title } from './shared.js';

const BAR = 30;
const THUMB = 64;

const siteOf = (props) => text(props.site) || 'link';
const bar = (props) => h('div', { class: 'link-site' },
  h('span', { class: 'link-dot', text: graphemes(siteOf(props))[0].toUpperCase() }),
  say('span', 'link-host clamp-1', siteOf(props)),
  h('span', { class: 'link-out', 'aria-hidden': 'true', text: '↗' }));

function plan(item, props) {
  const thumb = text(props.image);
  const about = text(props.description) || item.summary || '';
  const width = thumb ? 316 : 272;
  const column = width - SIDES - (thumb ? 96 : 0);
  return {
    thumb,
    about,
    width,
    titleLines: fold(item.title || 'Untitled', column, TITLE_LETTER, 2),
    aboutLines: about ? fold(about, column, TEXT_LETTER, 2) : 0,
  };
}

export const shows = ['site'];

export function size(item, props) {
  const { thumb, width, titleLines, aboutLines } = plan(item, props);
  const main = titleLines * TITLE + (aboutLines ? 4 + aboutLines * TEXT : 0);
  return [width, 3 + BAR + 10 + Math.max(main, thumb ? THUMB : 0) + 13];
}

export function draw(item, props, ctx) {
  const { thumb, about, titleLines, aboutLines } = plan(item, props);
  return [
    bar(props),
    h('div', { class: 'link-row' },
      h('div', { class: 'link-main' },
        title(item, titleLines),
        about && say('div', `card-text clamp-${aboutLines}`, about)),
      thumb && h('div', { class: 'link-thumb' }, picture(thumb, '', ctx))),
  ];
}

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-link' },
    bar(props),
    safeUrl(text(props.url)) && text(props.image) && h('div', { class: 'detail-media' }, picture(props.image, '', ctx)),
    text(props.description) && props.description !== item.summary && say('p', 'detail-caption', props.description)),
];
