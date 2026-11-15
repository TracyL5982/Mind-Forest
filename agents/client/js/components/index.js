import * as note from './note.js';
import * as quote from './quote.js';
import * as fact from './fact.js';
import * as image from './image.js';
import * as video from './video.js';
import * as audio from './audio.js';
import * as link from './link.js';
import * as chart from './chart.js';
import * as person from './person.js';
import * as chat from './chat.js';
import * as code from './code.js';
import * as steps from './steps.js';
import * as facts from './facts.js';
import * as table from './table.js';
import * as list from './list.js';
import * as breakdown from './breakdown.js';
import * as qa from './qa.js';
import * as callout from './callout.js';
import * as excerpt from './excerpt.js';
import * as definition from './definition.js';
import * as idea from './idea.js';
import * as proscons from './proscons.js';
import * as swatch from './swatch.js';
import * as artwork from './artwork.js';
import * as reference from './reference.js';
import * as place from './place.js';
import * as sheet from './sheet.js';
import * as explorable from './explorable.js';
import { h } from '../dom.js';
import { wordsOf } from '../words.js';

/**
 * Every way one card can be drawn, one module per type. `size` works the small face's footprint out from the item and the props,
 * so the field can be laid out without measuring the page: 210 px wide and at most 146 px tall. `draw` returns the face's
 * contents, which are whole lines and a cue when the face leaves something out. `detail` returns the longer form shown when the
 * card is opened, which holds everything and scrolls, and may return nothing.
 */
export const COMPONENTS = {
  note, quote, fact, image, video, audio, link, chart, person, chat, code, steps,
  facts, table, list, breakdown, qa, callout, excerpt, definition, idea, proscons, swatch, artwork, reference, place, sheet, explorable,
};

export const componentOf = (node) => (Object.hasOwn(COMPONENTS, node.view?.component) ? node.view.component : 'note');

/** An unknown component is drawn as a note, and a note reads none of the props meant for it. */
function resolve(node) {
  const name = componentOf(node);
  return { kind: COMPONENTS[name], props: name === node.view?.component ? (node.view.props ?? {}) : {} };
}

export function sizeOf(node, item) {
  const { kind, props } = resolve(node);
  return kind.size(item, props);
}

/** What goes on a card's face: its body, drawn by its type. The chips are on the opened card. */
export function drawCard(node, item, ctx) {
  const name = componentOf(node);
  const { kind, props } = resolve(node);
  return h('div', { class: `card-body c-${name}` }, kind.draw(item, props, { ...ctx, words: wordsOf(item) }));
}

export function drawDetail(node, item, ctx) {
  const { kind, props } = resolve(node);
  return kind.detail(item, props, { ...ctx, words: wordsOf(item) }, node);
}
