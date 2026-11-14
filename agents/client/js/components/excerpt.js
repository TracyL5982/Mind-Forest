import { h } from '../dom.js';
import { FRAME, PADDING, PASSAGE_LETTER, TEXT, TITLE, say, text, wrap } from './shared.js';

const WIDTH = 288;
/** The rule down the passage's left side and the gap after it. */
const RULE = 14;
const LINE = WIDTH - PADDING - RULE;
const MOST_LINES = 6;

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

/** The passage, the item's title under it, and where it is from, without a part that is the title again. */
function plan(item, props) {
  const words = flat(passage(item, props));
  const title = item.title || '';
  return {
    words,
    lines: wrap(words, LINE, PASSAGE_LETTER, MOST_LINES),
    title,
    where: [text(props.at).trim(), text(props.source).trim()].filter((part) => part && part !== title.trim()).join(' · '),
  };
}

export const shows = ['site', 'from'];

export function size(item, props) {
  const { lines, title, where } = plan(item, props);
  return [WIDTH, FRAME + lines * TITLE + (title || where ? 10 + (title ? TEXT : 0) + (where ? TEXT : 0) : 0)];
}

const from = (title, where, clamped) => (title || where) && h('div', { class: 'excerpt-from' },
  title && say('div', `excerpt-title ${clamped}`, title),
  where && say('div', `excerpt-where ${clamped}`, where));

export function draw(item, props) {
  const { words, lines, title, where } = plan(item, props);
  return [say('blockquote', `excerpt-text clamp-${lines}`, words), from(title, where, 'clamp-1')];
}

/** The passage whole. The maker the Scout's closing line named has a line of its own, because nothing else on the opened card says it. */
export function detail(item, props) {
  const { where } = plan(item, props);
  const by = text(item.data?.by).trim();
  return [h('div', { class: 'detail-excerpt' }, say('blockquote', 'excerpt-text', passage(item, props)), from(where.includes(by) ? '' : by, where, ''))];
}
