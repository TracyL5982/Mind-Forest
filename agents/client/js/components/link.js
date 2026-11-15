import { h, safeUrl } from '../dom.js';
import { WIDTH, drawFace, graphemes, lay, picture, say, text, titleRow, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The address bar, and the padding and borders round the part under it. */
const FRAME = 30 + 26;

const siteOf = (item, props) => text(props.site) || wordsOf(item).link;
const bar = (item, props) => h('div', { class: 'link-site' },
  h('span', { class: 'link-dot', 'aria-hidden': 'true', text: graphemes(siteOf(item, props))[0].toUpperCase() }),
  say('span', 'link-host', siteOf(item, props)),
  h('span', { class: 'link-out', 'aria-hidden': 'true', text: '↗' }));

/** Under the page's address bar, its title and what it is about, on as many lines as the face has room for. No thumbnail. */
function face(item, props) {
  return lay([
    titleRow(item),
    { words: text(props.description) || item.summary || '', gap: 4, draw: wordsIn('card-text') },
  ], { words: wordsOf(item), frame: FRAME });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => [bar(item, props), h('div', { class: 'link-row' }, drawFace(face(item, props)))];

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-link' },
    bar(item, props),
    safeUrl(text(props.url)) && text(props.image) && h('div', { class: 'detail-media' }, picture(props.image, '', ctx)),
    text(props.description) && props.description !== item.summary && say('p', 'detail-caption', props.description)),
];
