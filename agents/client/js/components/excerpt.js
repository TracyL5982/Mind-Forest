import { h } from '../dom.js';
import { WIDTH, aboveRows, drawFace, lay, say, text, wordsIn } from './shared.js';
import { wordsOf } from '../words.js';

/** The rule down the passage's left side and the gap after it. */
const RULE = 14;
/**
 * A passage in the serif counts its lines in the whole line box, without the px a padded face holds back, because a character
 * set with Han draws exactly 16 px there, and a px held back would push the last that fits onto a line of its own.
 */
const LINE = WIDTH - 32 - RULE;

/** The line the Scout ends a page's text with: who made it, when, and the source it searched. */
function label(item) {
  return [...new Set([item.data?.by, item.data?.date, item.data?.from].filter((part) => typeof part === 'string' && part.trim()))].join(', ');
}

/** The passage without that line, which the chips and the source line say again. */
function passage(item, props) {
  const whole = text(props.text).trim();
  const ending = label(item);
  return ending && whole.endsWith(`\n\n${ending}`) ? whole.slice(0, -ending.length).trim() : whole;
}

const flat = (words) => words.replace(/\s+/g, ' ');

/** The passage, and the item's title and where it is from on one line under it, without a part that is the title again. */
function plan(item, props) {
  const title = item.title || '';
  const where = [text(props.at).trim(), text(props.source).trim()].filter((part) => part && part !== title.trim());
  return { words: flat(passage(item, props)), where: where.join(' · '), source: [title, ...where].filter(Boolean).join(' · ') };
}

/** The lines the item writes over it, the passage on as many lines as the face has room for, and its source, which it keeps, without a dot left at the end of the line. */
function face(item, props) {
  const { words, source } = plan(item, props);
  const above = aboveRows(props, { gap: 0 });
  return lay([
    ...above,
    { words, measure: 'passage', column: LINE, gap: above.length > 0 ? 6 : 0, draw: wordsIn('excerpt-text') },
    source && { words: source, measure: 'meta', most: 1, gap: 10, keep: true, draw: (row) => say('div', 'excerpt-from', row.words.replace(/\s*·$/u, '')) },
  ], { words: wordsOf(item) });
}

export function size(item, props) {
  return [WIDTH, face(item, props).height];
}

const from = (title, where) => (title || where) && h('div', { class: 'excerpt-from' },
  title && say('div', 'excerpt-title', title),
  where && say('div', 'excerpt-where', where));

export const draw = (item, props) => drawFace(face(item, props));

/** The passage whole. The maker the Scout's closing line named has a line of its own, because nothing else on the opened card says it. */
export function detail(item, props) {
  const { where } = plan(item, props);
  const by = text(item.data?.by).trim();
  return [h('div', { class: 'detail-excerpt' }, say('blockquote', 'excerpt-text', passage(item, props)), from(where.includes(by) ? '' : by, where))];
}
