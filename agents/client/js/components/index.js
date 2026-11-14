import * as note from './note.js';
import * as quote from './quote.js';
import * as fact from './fact.js';
import * as image from './image.js';
import * as video from './video.js';
import * as link from './link.js';
import * as chart from './chart.js';
import * as person from './person.js';
import * as chat from './chat.js';
import * as code from './code.js';
import * as steps from './steps.js';

/**
 * Every way one card can be drawn, one module per type. `size` works the card's footprint out
 * from the item and the props, so the field can be laid out without measuring the page. `draw`
 * returns the card's contents. `detail` returns the longer form shown when the card is opened,
 * and may return nothing.
 */
export const COMPONENTS = { note, quote, fact, image, video, link, chart, person, chat, code, steps };

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

export function drawCard(node, item, ctx) {
  const { kind, props } = resolve(node);
  return kind.draw(item, props, ctx);
}

export function drawDetail(node, item, ctx) {
  const { kind, props } = resolve(node);
  return kind.detail(item, props, ctx, node);
}
