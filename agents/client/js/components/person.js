import { h } from '../dom.js';
import { COLUMN, MEASURES, WIDTH, drawFace, fit, initials, lay, picture, say, text } from './shared.js';
import { wordsOf } from '../words.js';

/** The round face and the gap beside it. */
const FACE = 48;
const BESIDE = 12;
const MOST_LINES = 2;

const nameOf = (item, props) => text(props.name) || item.title || '';

/** A round face: the picture, or the initials when there is none or it fails to load. */
const portrait = (name, props, ctx) => h('div', { class: 'person-face' },
  text(props.image) ? picture(props.image, name, ctx, () => initials(name)) : initials(name));

/** The face beside the name at the title's size and the role under it, each whole on up to two lines. */
function face(item, props, ctx) {
  const name = fit(nameOf(item, props), COLUMN - FACE - BESIDE, 'title', MOST_LINES);
  const role = fit(text(props.role).trim(), COLUMN - FACE - BESIDE, 'body', MOST_LINES);
  return lay([{
    tall: Math.max(FACE, name.lines * MEASURES.title.lead + role.lines * MEASURES.body.lead), whole: name.whole && role.whole,
    draw: () => h('div', { class: 'person-row' }, portrait(nameOf(item, props), props, ctx),
      h('div', { class: 'person-main' }, say('div', 'card-title', name.words), role.words && say('div', 'card-text', role.words))),
  }], { words: wordsOf(item) });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props, ctx) => drawFace(face(item, props, ctx));

export const detail = (item, props, ctx) => [
  h('div', { class: 'detail-person' },
    portrait(nameOf(item, props), props, ctx),
    h('div', null, say('div', 'card-title', nameOf(item, props)), say('div', 'card-text', text(props.role)))),
];
