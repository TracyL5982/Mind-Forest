import { h } from '../dom.js';
import { FRAME, PADDING, PASSAGE_LETTER, SIDES, TEXT, TEXT_LETTER, TITLE, TITLE_LETTER, aboveOf, andMore, drawAbove, list, picture, say, text, titleOf, wrap } from './shared.js';
import { figures, grid, listed, pairs } from './facts.js';
import { entry, entryLines, stacked, written } from './list.js';
import { detail as opened, plan as tableOf, ruled, ruledHeight } from './table.js';

const WIDTH = 320;
const COLUMN = WIDTH - SIDES;
/** A picture leads the card in a band this tall, across its whole width. */
const PICTURE = 140;
const TITLE_LINES = 3;
const TEXT_LINES = 6;
/** As many entries as a sheet's list may hold. A list sent with more counts the rest. */
const ENTRIES = 8;
const PASSAGE_LINES = 5;
/**
 * The text counts its lines in the whole line box, without the px to spare: a character set with Han draws exactly 12.5 px in the
 * text face, so twenty-three of them fill the 288 px line to the last half px, and a px held back would push the last onto a line of its own.
 */
const LINE = WIDTH - PADDING;
/** A passage's line: the whole line box less the rule down its left side and the gap after it, as on an excerpt card. */
const PASSAGE = LINE - 14;
/** The line of who said the words, less the short rule before them and the gap after it. */
const BY = COLUMN - 22;
/** A part after the first is set apart by a hairline, with this much room above it and below it. */
const ABOVE = 10;
const BELOW = 10;
const RULED = ABOVE + 1 + BELOW;

const flat = (words) => words.replace(/\s+/g, ' ');
const said = (words) => flat(words).trim().toLowerCase();

/** A text cut short with an ellipsis, as the rest of the line of the item's text that it opens, so the opened card has it whole. */
function whole(item, words) {
  const cut = words.replace(/(?:…|\.\.\.)$/, '').trimEnd();
  if (cut === words || !cut) return words;
  for (const line of text(item.text).split('\n').map(flat)) {
    const at = line.indexOf(cut);
    if (at >= 0) return line.slice(at).trim();
  }
  return words;
}

const saidBy = (by, lines) => h('div', { class: 'sheet-by' }, say('span', lines ? `clamp-${lines}` : '', by));

/**
 * Each kind of section the column holds, laid out and drawn as the card of its own kind does it. `lead` is how far under the
 * title the part sits when it comes first, as on that card. `plan` gives what the part draws and how tall it is, or nothing when
 * the section has nothing to show. `says` is every string the part draws on the card, and `detail` the part on the opened card.
 */
const PARTS = {
  text: {
    lead: 6,
    plan(section) {
      const words = flat(text(section.text).trim());
      const lines = wrap(words, LINE, TEXT_LETTER, TEXT_LINES);
      return words && { words, lines, height: lines * TEXT };
    },
    says: ({ words }) => [words],
    draw: ({ words, lines }) => say('div', `card-text clamp-${lines}`, words),
    detail: ({ words }, item) => say('p', 'detail-sheet-text', whole(item, words)),
  },
  figures: {
    lead: 12,
    plan(section) {
      const facts = pairs(section);
      const laid = grid(facts);
      return facts.length > 0 && { facts, laid, height: laid.height };
    },
    says: ({ facts }) => facts.flatMap(({ label, value }) => [label, value]),
    draw: ({ laid }) => figures(laid),
    detail: ({ facts }) => listed(facts),
  },
  list: {
    lead: 10,
    plan(section) {
      const entries = list(section.items).map((one) => text(one).trim());
      const rows = entries.slice(0, ENTRIES).map((one) => entryLines(one, COLUMN));
      const more = entries.length - rows.length;
      return rows.length > 0 && { entries, rows, more, height: stacked(rows) + (more > 0 ? 8 + TEXT : 0) };
    },
    says: ({ entries, rows }) => entries.slice(0, rows.length),
    draw: ({ entries, rows, more }, item, words) => [
      h('ul', { class: 'list' }, rows.map((lines, i) => entry(entries[i], undefined, `clamp-${lines}`, words))),
      more > 0 && andMore(more, item),
    ],
    detail: ({ entries }, item, words) => h('ul', { class: 'list is-full' }, written(item, entries).map((label) => entry(label, undefined, '', words))),
  },
  table: {
    lead: 8,
    plan(section, item) {
      const laid = tableOf(item, section, COLUMN);
      return laid.heads.length > 0 && { section, laid, height: ruledHeight(laid) };
    },
    says: ({ laid }) => [...laid.heads, ...laid.rows.flat()],
    draw: ({ laid }) => [ruled(laid), laid.foot && h('div', { class: 'card-foot', text: laid.foot })],
    detail: ({ section }, item) => opened(item, section),
  },
  excerpt: {
    lead: 10,
    plan(section) {
      const passage = text(section.text).trim();
      const words = flat(passage);
      const by = text(section.by).trim();
      const lines = wrap(words, PASSAGE, PASSAGE_LETTER, PASSAGE_LINES);
      const byLines = by ? wrap(by, BY, TEXT_LETTER, 2) : 0;
      return words && { passage, words, by, lines, byLines, height: lines * TITLE + (by ? 4 + byLines * TEXT : 0) };
    },
    says: ({ words, by }) => [words, by],
    draw: ({ words, by, lines, byLines }) => [say('blockquote', `excerpt-text clamp-${lines}`, words), by && saidBy(by, byLines)],
    detail: ({ passage, by }) => h('div', { class: 'detail-excerpt' }, say('blockquote', 'excerpt-text', passage), by && saidBy(by, 0)),
  },
};

/**
 * The card's one title is its heading, or the item's title when it has none. Its first picture leads the card. Every other
 * section is a part of the column, in the order given, each after the first under a hairline.
 */
function plan(item, props) {
  const sections = list(props.sections).filter((section) => section !== null && typeof section === 'object');
  const first = (kind, key) => text(sections.find((section) => section.kind === kind)?.[key]).trim();
  const heading = first('heading', 'text');
  const title = heading || titleOf(item);
  const parts = sections.flatMap((section) => {
    const kind = Object.hasOwn(PARTS, section.kind) ? PARTS[section.kind] : undefined;
    const part = kind?.plan(section, item);
    if (!part) return [];
    // The item's own label of the figures, list or table, "Best:", stands over the part as the lines over a card stand over its structure.
    const label = aboveOf({ above: section.label ? [section.label] : [] }, COLUMN);
    return [{ ...part, kind, label, height: part.height + label.height }];
  });
  return { heading, title, src: first('picture', 'src'), titleLines: wrap(title, COLUMN, TITLE_LETTER, TITLE_LINES), above: aboveOf(props, COLUMN), parts };
}

const before = (part, i) => (i === 0 ? part.kind.lead : RULED);

/** The `item.data` keys whose value the card draws as one of its strings, a list of names when it draws each name, so no chip says it again. */
export function shows(item, props) {
  const { title, above, parts } = plan(item, props);
  const drawn = new Set([title, ...above.lines.map((line) => line.words), ...parts.flatMap((part) => [...part.label.lines.map((line) => line.words), ...part.kind.says(part)])].map((words) => words.trim()).filter(Boolean));
  const isDrawn = (value) => typeof value === 'string' && drawn.has(value.trim());
  return Object.entries(item?.data ?? {}).flatMap(([key, value]) => {
    const names = Array.isArray(value) ? value.filter((name) => typeof name === 'string' && name.trim()) : [];
    return isDrawn(value) || (names.length > 0 && names.every(isDrawn)) ? [key] : [];
  });
}

export function size(item, props) {
  const { src, titleLines, above, parts } = plan(item, props);
  return [WIDTH, (src ? PICTURE : 0) + FRAME + titleLines * TITLE + above.height + parts.reduce((sum, part, i) => sum + before(part, i) + part.height, 0)];
}

export function draw(item, props, ctx) {
  const { title, src, titleLines, above, parts } = plan(item, props);
  return [
    src && h('div', { class: 'media-frame', style: { height: `${PICTURE}px` } }, picture(src, title, ctx)),
    h('div', { class: 'sheet-under' },
      say('div', `card-title clamp-${titleLines}`, title),
      drawAbove(above),
      parts.map((part, i) => h('div', { class: i === 0 ? 'sheet-part' : 'sheet-part is-ruled', style: i === 0 ? { marginTop: `${part.kind.lead}px` } : { marginTop: `${ABOVE}px`, paddingTop: `${BELOW}px` } },
        drawAbove(part.label), part.kind.draw(part, item, ctx.words)))),
  ];
}

/** The picture whole, the heading when the opened card's title is not already it, and each part whole, in order. */
export function detail(item, props, ctx) {
  const { heading, title, src, parts } = plan(item, props);
  return [
    src && h('div', { class: 'detail-media' }, picture(src, title, ctx)),
    heading && said(heading) !== said(text(item.title)) && say('div', 'card-title detail-sheet-heading', heading),
    parts.map((part) => [drawAbove(part.label), part.kind.detail(part, item, ctx.words)]),
  ];
}
