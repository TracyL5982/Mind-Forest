import { createHash } from 'node:crypto';
import type { Edit, Item, ItemData, Node, Origin } from '../core/domain.ts';
import { byRule } from '../core/roles/renderer.ts';
import { withShortTitle } from '../core/roles/types.ts';
import { MINDSTORM } from '../core/round.ts';
import type { ScriptCard } from './script.ts';

/**
 * A card of the script as the service keeps one: an item, and the node that hangs it in the tree. They are made the way the roles
 * make theirs, so the rules choose each card's look from what the item holds, and the headset draws it as it draws any card.
 */

export interface Making {
  /** The stored copy of a file of the media folder, or nothing when the folder does not hold it. */
  media: (file: string) => { id: string; url: string } | undefined;
  assetUrl: (id: string) => string;
  now: () => string;
}

const USER: Origin = { by: 'user' };
const scout = (tool: string): Origin => ({ by: 'agent', role: 'scout', tool });

/** The cards the agents write, as against the pictures they make. */
const WRITTEN = new Set<ScriptCard['kind']>(['facts', 'person', 'list', 'note', 'link']);

/**
 * Who made the item, who hung it, and how the opened card says it arrived. What is the user's own was dropped or written by
 * them and is brought by the Scout from their mindstorm; what is from outside the Scout found; the rest the agents made.
 */
function origins(card: ScriptCard): { item: Origin; node: Origin; from: string } {
  if (card.origin === 'ocean') return { item: USER, node: scout(MINDSTORM), from: card.kind === 'note' ? 'paste' : 'drop' };
  if (card.origin === 'generated') {
    const written = WRITTEN.has(card.kind);
    const made = scout(written ? 'idea' : 'images');
    return { item: made, node: made, from: written ? 'idea' : 'image-gen' };
  }
  const found = scout(card.kind === 'paper' ? 'papers' : card.kind === 'artwork' ? 'museums' : 'web');
  return { item: found, node: found, from: 'web' };
}

const siteOf = (url: string | undefined): string | undefined => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : undefined;
  } catch {
    return undefined;
  }
};

/** The source's name on the card: the one given, a paper's journal, the place that holds a work, or the site it is on. */
const fromOf = (card: ScriptCard): string | undefined => card.from ?? (card.kind === 'paper' ? (card.venue ?? 'Research papers') : (card.holder ?? siteOf(card.href)));

/**
 * An id that changes when the card's words or files do, so an edited script never meets its older self in a kept data folder.
 * `set` says whose card it is: `demo` for the walkthrough's, `show-<tree>` for a showcase tree's.
 */
export function itemIdOf(card: ScriptCard, set = 'demo'): string {
  return `${set}-${card.id}-${createHash('sha1').update(JSON.stringify(card)).digest('hex').slice(0, 8)}`;
}

/** The few words on the thread to a card: the turn of thought its text ends on, or its beginning. */
export function whyOf(card: ScriptCard): string {
  const text = card.text.trim();
  const tail = text.includes(': ') ? text.slice(text.lastIndexOf(': ') + 2).replace(/[.。]$/, '') : '';
  if (tail.length >= 8 && tail.length <= 64) return tail.charAt(0).toUpperCase() + tail.slice(1);
  const first = (text.split(/(?<=[.!?])\s/)[0] ?? '').replace(/[.。]$/, '');
  if (first.length <= 64) return first;
  return `${first.slice(0, 62).replace(/\s+\S*$/, '')}…`;
}

export function itemOf(card: ScriptCard, making: Making, set = 'demo'): Item {
  const { item: origin, from } = origins(card);
  const picture = card.image ? making.media(card.image) : undefined;
  const film = card.video ? making.media(card.video) : undefined;
  const label = [card.by, card.date, card.from ?? card.holder].filter(Boolean).join(', ');
  const said = [card.text.trim(), card.credit?.trim()].filter(Boolean).join('\n');
  const common: ItemData = {
    ...(card.by && { by: card.by }),
    ...(card.date && { date: card.date }),
    ...(fromOf(card) && { from: fromOf(card) }),
    ...(card.holder && { holder: card.holder }),
    ...(siteOf(card.href) && { site: card.site ?? siteOf(card.href) }),
    // As a source's credit line is kept on the items the Scout brings (DECISIONS 63), with the page it is on.
    ...(card.credit?.trim() && { credit: { text: card.credit.trim(), ...(card.href && { url: card.href }) } }),
    ...(card.licence && { licence: card.licence }),
  };
  const base = { title: card.title, summary: card.text.trim(), tags: [card.origin, card.kind], origin, archived: false, revision: 0, id: itemIdOf(card, set) };
  const source = (extra: { asset?: string } = {}): Item['source'] => ({ from, ...(card.href && { url: card.href }), ...extra, capturedAt: making.now() });
  const withLabel = (text: string) => (label ? `${text}\n\n${label}` : text);
  const finish = (item: Omit<Item, 'data'> & { data: ItemData }): Item => ({ ...item, data: withShortTitle(item.data, item.title) });

  switch (card.kind) {
    case 'picture':
    case 'artwork':
      return finish({ ...base, kind: 'image', text: withLabel(said), data: { ...common, ...(card.kind === 'artwork' && { kind: 'artwork' }) }, source: source(picture && { asset: picture.id }) });
    case 'film':
      // A film with its file plays from the service. One the user saved as a link is that link, with its still.
      if (film) return finish({ ...base, kind: 'video', text: withLabel(said), data: { ...common, ...(picture && { thumbnailUrl: picture.url }), ...(card.start && { cutFrom: card.start }) }, source: source({ asset: film.id }) });
      return finish({ ...base, kind: 'link', text: withLabel(said), data: { ...common, kind: 'film', ...(picture && { image: picture.url }) }, source: source() });
    case 'paper': {
      const authors = card.authors ?? [];
      const by = authors.length > 2 ? `${authors[0]} et al.` : authors.join(' and ');
      const data = { ...common, kind: 'paper', authors, ...(by && { by }), ...(card.venue && { venue: card.venue }), ...(picture && { image: picture.url }) };
      const cited = [by, card.date, card.venue].filter(Boolean).join(', ');
      return finish({ ...base, kind: 'text', text: cited ? `${said}\n\n${cited}` : said, data, source: source() });
    }
    case 'link':
      return finish({ ...base, kind: 'link', text: said, data: { ...common, ...(card.site && { site: card.site }) }, source: source() });
    case 'facts': {
      const facts = (card.facts ?? []).map(([label, value]) => ({ label, value }));
      return finish({ ...base, kind: 'text', text: [card.text.trim(), ...facts.map((f) => `${f.label}: ${f.value}`)].filter(Boolean).join('\n'), data: { ...common, facts }, source: source() });
    }
    case 'person': {
      const person = card.person ?? { name: card.title };
      return finish({ ...base, kind: 'text', text: [person.name, person.role, card.text.trim()].filter(Boolean).join('\n'), data: { ...common, person }, source: source() });
    }
    case 'list': {
      const items = card.items ?? [];
      return finish({ ...base, kind: 'text', text: [card.text.trim(), ...items.map((line) => `- ${line}`)].filter(Boolean).join('\n'), data: { ...common, items }, source: source() });
    }
    case 'note':
      return finish({ ...base, kind: 'text', text: said || card.title, data: common, source: source() });
  }
}

export interface Hanging {
  id: string;
  treeId: string;
  parent: string;
  status: Node['status'];
  order: number;
  /** Its place among the cards of its round, the first the most related. */
  rank: number;
}

export function nodeOf(card: ScriptCard, item: Item, hang: Hanging, making: Making): Node {
  const { node: origin } = origins(card);
  const draw = byRule(item, making.assetUrl);
  // A picture's shape is told with it, so its card takes its size before the picture has come.
  const props = draw.component === 'image' && card.w && card.h ? { ...draw.props, aspect: Math.round((card.w / card.h) * 1000) / 1000 } : draw.props;
  const edits: Edit[] = (card.mark ?? [])
    .filter((points) => points.length >= 4 && points.length % 2 === 0)
    .map((points, n) => ({ id: `${hang.id}-mark-${n}`, kind: 'stroke', points }));
  return {
    id: hang.id,
    treeId: hang.treeId,
    itemId: item.id,
    parent: hang.parent,
    status: hang.status,
    why: whyOf(card),
    importance: Math.max(0.3, Math.round((0.92 - hang.rank * 0.04) * 100) / 100),
    origin,
    view: { component: draw.component, props, by: 'renderer' },
    order: hang.order,
    ...(edits.length > 0 && { edits }),
  };
}
