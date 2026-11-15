import { h } from '../dom.js';
import { COLUMN, CUE, GAP, HEIGHT, WIDTH, aboveRows, drawFace, lay, list, picture, say, text, titleRow, wordsIn } from './shared.js';
import { UNDER_TITLE, figureRows, listed, pairs } from './facts.js';
import { entry, written } from './list.js';
import { detail as opened, headsLine } from './table.js';
import { wordsOf } from '../words.js';

/** A list's mark and the gap after it, as on a list card. */
const MARK = 20;
/** A passage's column: the column less the rule down its left side and the gap after it. */
const PASSAGE = COLUMN - 14;
const ENTRY_LINES = 2;

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

const saidBy = (by) => h('div', { class: 'sheet-by' }, say('span', '', by));

/**
 * Each kind of section the column holds. `plan` gives what the part holds, or nothing when the section has nothing to show.
 * `lead` is how far under the title the part sits, as on the card of its own kind. `rows` is the part's own preview as rows of the
 * face, as many as it has room for, which under a title of one line and the cue is 68 px: three lines of text, a row of figures,
 * two entries, the heads of a table and the count of its rows, or a passage over who said it, who is always shown. The first row
 * of figures stands in the `room` px the face leaves it. `detail` is the whole part on the opened card.
 */
const PARTS = {
  text: {
    lead: GAP,
    plan: (section) => {
      const words = flat(text(section.text).trim());
      return words && { words };
    },
    rows: ({ words }, gap) => [{ words, gap, draw: wordsIn('card-text') }],
    detail: ({ words }, item) => say('p', 'detail-sheet-text', whole(item, words)),
  },
  figures: {
    lead: UNDER_TITLE,
    plan: (section) => {
      const facts = pairs(section);
      return facts.length > 0 && { facts };
    },
    rows: ({ facts }, gap, words, room) => figureRows(facts, { gap, room }),
    detail: ({ facts }) => listed(facts),
  },
  list: {
    lead: 10,
    plan: (section) => {
      const entries = list(section.items).map((one) => text(one).trim()).filter(Boolean);
      return entries.length > 0 && { entries };
    },
    rows: ({ entries }, gap, words) => entries.map((label, i) => ({
      words: label, column: COLUMN - MARK, most: ENTRY_LINES, unit: true, gap: i === 0 ? gap : 5,
      draw: (row) => entry(row.words, undefined, '', words, 'div'),
    })),
    detail: ({ entries }, item, words) => h('ul', { class: 'list is-full' }, written(item, entries).map((label) => entry(label, undefined, '', words))),
  },
  table: {
    lead: GAP,
    plan: (section) => {
      const named = headsLine(list(section.heads).map((head) => text(head).trim()));
      return named && { section, named, count: list(section.rows).length };
    },
    rows: ({ named, count }, gap, words) => [
      { words: named, measure: 'meta', most: 2, gap, draw: wordsIn('table-heads') },
      count > 0 && { words: words.cue.rows(count), measure: 'meta', most: 1, gap: 4, draw: wordsIn('sheet-count') },
    ],
    detail: ({ section }, item) => opened(item, section),
  },
  excerpt: {
    lead: GAP,
    plan: (section) => {
      const passage = text(section.text).trim();
      return passage && { passage, words: flat(passage), by: text(section.by).trim() };
    },
    rows: ({ words, by }, gap) => [
      { words, measure: 'passage', column: PASSAGE, gap, draw: wordsIn('sheet-passage') },
      by && { words: by, measure: 'meta', column: COLUMN - 22, most: 1, gap: 4, keep: true, draw: (row) => saidBy(row.words) },
    ],
    detail: ({ passage, by }) => h('div', { class: 'detail-excerpt' }, say('blockquote', 'excerpt-text', passage), by && saidBy(by)),
  },
};

/**
 * The card's one title is its heading, or the item's title when it has none. Its first picture leads the opened card, and every
 * other section is a part, in the order given; the item's own label of a part, "Best:", stands over it as the lines over a card
 * stand over its structure.
 */
function plan(item, props) {
  const sections = list(props.sections).filter((section) => section !== null && typeof section === 'object');
  const src = sections.filter((section) => section.kind === 'picture').map((section) => text(section.src).trim()).find(Boolean) ?? '';
  const heading = text(sections.find((section) => section.kind === 'heading')?.text).trim();
  const parts = sections.flatMap((section) => {
    const kind = Object.hasOwn(PARTS, section.kind) ? PARTS[section.kind] : undefined;
    const part = kind?.plan(section);
    return part ? [{ ...part, kind, label: text(section.label).trim() }] : [];
  });
  return { heading, title: heading || text(item.data?.shortTitle).trim() || text(item.title).trim() || wordsOf(item).untitled, src, parts };
}

/**
 * The title, the lines the item writes over the card, then its first part as its own preview. The cue counts the other parts the
 * opened card shows, its picture among them.
 */
function face(item, props) {
  const words = wordsOf(item);
  const { title, src, parts } = plan(item, props);
  const [first] = parts;
  const others = Math.max(0, parts.length - 1) + (src ? 1 : 0);
  const label = first?.label ? aboveRows({ above: [first.label] }, { gap: first.kind.lead }) : [];
  const top = [{ ...titleRow(item), words: title }, ...aboveRows(props), ...label];
  const gap = label.length > 0 ? GAP : first?.kind.lead;
  return lay([
    ...top,
    ...(first ? first.kind.rows(first, gap, words, HEIGHT - lay(top, { words }).height - gap - CUE) : []),
  ], { words, more: others > 0, cue: () => (others > 0 ? words.cue.parts(others) : '') });
}

export const size = (item, props) => [WIDTH, face(item, props).height];

export const draw = (item, props) => drawFace(face(item, props));

/** The picture whole, the heading when the opened card's title is not already it, and each part whole, in order, under its label. */
export function detail(item, props, ctx) {
  const { heading, title, src, parts } = plan(item, props);
  return [
    src && h('div', { class: 'detail-media' }, picture(src, title, ctx)),
    heading && said(heading) !== said(text(item.title)) && say('div', 'card-title detail-sheet-heading', heading),
    parts.map((part) => [part.label && say('div', 'detail-sheet-label', part.label), part.kind.detail(part, item, ctx.words)]),
  ];
}
