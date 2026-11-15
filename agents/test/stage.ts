/** What the browser test and the scripts that drive a real browser share: the browser, the fake service, and two fixture trees. */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import type { Command, Item, Node } from '../src/core/domain.ts';
import { FakeModel } from '../src/fake/model.ts';
import { byRule } from '../src/core/roles/renderer.ts';
import type { Roles } from '../src/core/roles/types.ts';
import { SAMPLES, STRUCTURED_IDS } from '../src/core/samples.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running, type ServerOptions } from '../src/node/server.ts';

export const TOKEN = 'secret';

export function browserPath(): string {
  if (process.env.MIND_PALACE_CHROMIUM) return process.env.MIND_PALACE_CHROMIUM;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).sort().reverse() : [];
  for (const build of builds) {
    for (const inner of [
      'chrome-headless-shell-mac-arm64/chrome-headless-shell',
      'chrome-headless-shell-mac-x64/chrome-headless-shell',
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ]) {
      if (existsSync(join(cache, build, inner))) return join(cache, build, inner);
    }
  }
  throw new Error('No Chromium found. Set MIND_PALACE_CHROMIUM to a browser executable.');
}

/**
 * The service with stand-in agents. Port 0 takes any free port. The stand-in Renderer redraws every card by the rules, as the real one
 * does, so a script that wants to look at a view the rules would not give its item names the trees whose cards stay as they were placed.
 */
export function bootFake({ port = 0, dataDir = mkdtempSync(join(tmpdir(), 'mp-stage-')), clientDir = join(import.meta.dirname, '../client'), asPlaced = (_treeId: string): boolean => false, telegram = undefined as ServerOptions['telegram'] } = {}): Promise<Running> {
  const roles: Roles = {
    ...fakeRoles,
    renderer: (ctx, { nodeIds }) => fakeRoles.renderer(ctx, { nodeIds: nodeIds.filter((id) => !asPlaced(ctx.mind.nodes.get(id)?.treeId ?? '')) }),
  };
  return startServer({ port, host: '127.0.0.1', dataDir, clientDir, model: new FakeModel(), roles, token: TOKEN, telegram });
}

export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAHUlEQVQI12NkYPjPgA0wYRWlqgTj////cRhFJzsAGGgEB+4vOSMAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

type Seed = Partial<Item> & { view?: { component: string; props: Record<string, unknown> } };

/**
 * The commands that build one tree, a card at a time. Ids are `<treeId>-<n>` in the order cards are added. Each card is given the view
 * the Renderer's rules give its item, so the stand-in Renderer finds nothing to change, and a card that names another type than the rules
 * give fails at once. A `view` in the seed is used as it is, for a type no rule gives.
 */
function planting(treeId: string, treeTitle: string) {
  const at = new Date().toISOString();
  const commands: Command[] = [];
  let n = 0;
  const add = (parent: string | null, component: string, title: string, { view, ...extra }: Seed = {}, status: Node['status'] = 'kept'): string => {
    const id = `${treeId}-${n++}`;
    const item: Item = { id: `item-${id}`, kind: 'text', title, text: '', summary: '', tags: [], data: {}, source: { from: 'paste', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0, ...extra };
    const draw = view ?? byRule(item, (asset) => `/assets/${asset}`);
    if (draw.component !== component) throw new Error(`"${title}" is seeded as a ${component} card, and the rules give it a ${draw.component}`);
    const node: Node = { id, treeId, itemId: item.id, parent, status, why: status === 'pick' ? 'Worth a look' : '', importance: 0.5, origin: { by: 'user' }, view: { ...draw, by: 'renderer' }, order: n };
    commands.push({ type: 'addItem', item });
    if (parent === null) commands.push({ type: 'createTree', tree: { id: treeId, title: treeTitle, rootId: id, digest: '', createdAt: at }, root: node });
    else commands.push({ type: 'addNode', node });
    return id;
  };
  const group = (anchor: string, composite: string, title: string, members: string[], props: Record<string, unknown>) =>
    commands.push({ type: 'setGroup', group: { id: `${treeId}-group-${composite}`, treeId, anchor, composite, title, members, props } });
  return { commands, add, group };
}

const SCOUT = { by: 'agent', role: 'scout' } as const;
const picture = (image: string, more: Record<string, unknown> = {}): Partial<Item> => ({ kind: 'image', data: { mediaUrl: image, ...more } });

/** The cards of `showcase` that are drawn from the structure an item carries, by type. */
export const STRUCTURED = Object.fromEntries(STRUCTURED_IDS.map((id, i) => [id, `show-${31 + i}`])) as Record<(typeof STRUCTURED_IDS)[number], string>;

/**
 * One tree that holds every component and every composite, and a link to a card in another tree when one is given. Every item holds
 * what the Renderer's rules draw its card from, so the tree looks the same after the stand-in Renderer has been over it. `structured: false` leaves out the fourteen types drawn from structure.
 */
export function showcase(image: string, other?: string, { structured = true } = {}): Command[] {
  const { commands, add, group } = planting('show', 'Every shape');

  const root = add(null, 'note', 'Every way a card can be drawn', { summary: 'Twenty-five components and six ways to arrange them.', text: 'Twenty-five components and six ways to arrange them.' });
  const quote = add(root, 'quote', 'Lange on seeing', { data: { quote: { text: 'The camera is a tool for learning how to see without a camera.', by: 'Dorothea Lange' } } });
  add(root, 'fact', 'Drop-off in minute one', { data: { facts: [{ label: 'of viewers leave in the first minute', value: '42%' }] } });
  add(root, 'image', 'Beach still', { ...picture(image), summary: 'A still from the beach scene' });
  add(root, 'video', 'Dolly zoom clip', { kind: 'video', data: { mediaUrl: image, thumbnailUrl: image }, summary: 'The dolly zoom, slowed down' });
  add(root, 'link', 'The Vertigo effect, explained', { kind: 'link', summary: 'How one shot changed the grammar of suspense.', source: { from: 'link', url: 'https://example.com/vertigo', capturedAt: new Date().toISOString() } });
  add(root, 'chart', 'Use by decade', { data: { chart: { labels: ['1960', '1980', '2000', '2020'], values: [3, 9, 14, 11], unit: 'films' } } });
  add(root, 'person', 'Who built it', { data: { person: { name: 'Irmin Roberts', role: 'Second-unit cameraman' } } });
  add(root, 'chat', 'Asking about the stretch', {
    kind: 'chat',
    data: { messages: [{ role: 'user', text: 'Why does the room seem to stretch?' }, { role: 'assistant', text: 'The lens zooms in while the camera pulls back, so the subject holds still and the background rushes away.' }] },
    source: { from: 'chat-export:claude', capturedAt: new Date().toISOString() },
  });
  add(root, 'code', 'Field of view', { data: { code: { language: 'js', source: 'const fov = 2 * Math.atan(width / (2 * distance));\ncamera.zoom = base / Math.tan(fov / 2);\nrender();' } } });
  add(root, 'steps', 'How to try it', { data: { steps: ['Pick a subject', 'Move away while zooming in', 'Keep the subject the same size'] } });

  const gallery = [1, 2, 3].map((i) => add(quote, 'image', `Frame ${i}`, picture(image)));
  group(quote, 'gallery', 'Frames', gallery, {});
  const timeline = ['1958', '1975', '1990'].map((year) => add(gallery[0]!, 'note', `Used in ${year}`, { summary: 'A famous use of the shot.' }));
  group(gallery[0]!, 'timeline', 'Through the years', timeline, { labels: Object.fromEntries(timeline.map((id, i) => [id, ['1958', '1975', '1990'][i]])) });
  const compared = ['Zoom lens', 'Prime and a dolly'].map((name) => add(timeline[2]!, 'note', name, { summary: 'One way to get the shot.', origin: SCOUT }, 'pick'));
  group(timeline[2]!, 'comparison', 'Two ways to shoot it', compared, { criteria: ['Cost', 'Look'], cells: { [compared[0]!]: ['Low', 'Slight breathing'], [compared[1]!]: ['High', 'Clean'] } });
  const sequence = ['Frame the subject', 'Start the pull', 'Land the zoom'].map((name) => add(compared[1]!, 'note', name, { text: 'One beat of the move, in the order it is shot.' }));
  group(compared[1]!, 'sequence', 'The move', sequence, {});
  const cluster = ['Unease', 'Vertigo', 'Dread'].map((name) => add(sequence[2]!, 'fact', name, { data: { facts: [{ label: 'what it evokes', value: name }] } }));
  group(sequence[2]!, 'cluster', '', cluster, { theme: 'Feelings' });
  const pile = Array.from({ length: 5 }, (_, i) => add(cluster[2]!, 'note', `Another example ${i + 1}`, { summary: 'One more film that uses it.' }));
  group(cluster[2]!, 'stack', '5 more', pile, {});
  if (other) commands.push({ type: 'link', link: { id: 'show-link', a: quote, b: other, why: 'Same shot', strength: 0.9 } });
  if (!structured) return commands;

  const carried = add(root, 'note', 'What an item can carry', { summary: 'Fourteen more types, each drawn from structure its item holds.', text: 'Fourteen more types, each drawn from structure its item holds.' });
  for (const id of STRUCTURED_IDS) {
    const { title, kind, text, summary, data, source, origin } = SAMPLES[id].item;
    const seed: Seed = { kind, text, summary, data, source: { ...source, asset: undefined }, origin };
    if (id === 'artwork') seed.data = { ...data, mediaUrl: image };
    if (id === 'place') seed.data = { ...data, image };
    if (id === 'callout') {
      seed.text = 'Feed it once a day with equal parts flour and water.\nCaution: anything above 40 °C kills the yeast.';
      seed.view = { component: 'callout', props: { text: 'anything above 40 °C kills the yeast.', tone: 'caution' } };
    }
    if (add(carried, id, title, seed) !== STRUCTURED[id]) throw new Error(`the ${id} card is not ${STRUCTURED[id]}`);
  }
  return commands;
}

/** The ids of the cards in `chipped`, by what each one is there to show. */
export const CHIPPED = { photo: 'chips-1', plainPhoto: 'chips-2', people: 'chips-3', longPlace: 'chips-4', museum: 'chips-5', link: 'chips-6', four: 'chips-7', plainNote: 'chips-8', pileTop: 'chips-12', pileUnder: ['chips-13', 'chips-14'], paper: 'chips-16' } as const;

export const LONG_PLACE = 'The upper reading room of the old municipal library, Vilnius';

/**
 * One tree of cards whose items carry a date, a place, people or an origin, beside twins that carry
 * none, under a first card that has chips too, a timeline whose members have chips, and a pile
 * whose top card has none over cards that do. What the Scout brought holds the `item.data` keys
 * the Scout writes, so a museum's work is drawn as an artwork and a paper as a reference, and
 * neither repeats on a chip what its card already shows.
 */
export function chipped(image: string): Command[] {
  const { commands, add, group } = planting('chips', 'With chips');
  const found = (url: string) => ({ from: 'web', url, capturedAt: new Date().toISOString() });
  /** A note of a few words would be drawn as an idea, so each note here says a little more in its text. */
  const note = (summary: string, data: Record<string, unknown> = {}): Partial<Item> => ({ summary, text: summary, data });
  const root = add(null, 'note', 'Cards that say when, where and who', note('One line of chips under a card, only when its item holds them.', { when: 'Spring 1958', where: 'Sonoma coast' }));
  add(root, 'image', 'Harbour in fog', { ...picture(image, { when: '12 May 1958', where: 'Bodega Bay' }), summary: 'Fog over the harbour' });
  add(root, 'image', 'Harbour in fog, undated', { ...picture(image), summary: 'Fog over the harbour' });
  add(root, 'note', 'The crew at the wrap party', note('Everyone who stayed to the end.', { people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra', 'Barbara Liskov', 'Alan Kay'] }));
  add(root, 'note', 'Where the notes were found', note('A box of index cards under the stairs.', { where: LONG_PLACE }));
  add(root, 'artwork', 'Sudden Shower over Shin-Ohashi Bridge', { ...picture(image, { site: 'metmuseum.org', by: 'Utagawa Hiroshige', date: '1857', from: 'The Metropolitan Museum of Art', kind: 'artwork', medium: 'Woodblock print; ink and color on paper', holder: 'The Metropolitan Museum of Art' }), summary: 'Sudden shower over a bridge', origin: { by: 'agent', role: 'scout', tool: 'met' }, source: found('https://www.metmuseum.org/art/collection/search/36461') }, 'pick');
  add(root, 'link', 'Reading the fog', { kind: 'link', summary: 'Why coastal fog comes in at dusk.', data: { site: 'example.com', by: 'example.com', date: '2019', from: 'The web' }, origin: { by: 'agent', role: 'scout', tool: 'web' }, source: found('https://example.com/fog') }, 'pick');
  add(root, 'quote', 'From the diary', { data: { quote: { text: 'We looked at the water until the water looked back.', by: 'A diary' }, site: 'example.com', by: 'A diary', date: 'Summer 1958', from: 'The web', where: 'Bodega Bay', people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra'], holder: 'Bancroft Library' }, origin: { by: 'agent', role: 'scout', tool: 'web' }, source: found('https://example.com/diary') }, 'pick');
  const plain = add(root, 'note', 'A plain note', note('No date, no place, nobody named.'));
  const years = ['1958', '1963', '1975'];
  const timeline = years.map((year, i) => add(plain, 'note', `The shoot in ${year}`, { summary: 'One visit to the bay.', data: { when: year, where: ['Bodega Bay', 'Point Reyes', 'Tomales'][i], ...(i === 1 ? { people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra'] } : {}) } }));
  group(plain, 'timeline', 'Visits', timeline, { labels: Object.fromEntries(timeline.map((id, i) => [id, years[i]])) });
  const pile = ['', '1958', '1963', '1975'].map((year) => add(CHIPPED.longPlace, 'note', year ? `A roll from ${year}` : 'Rolls not yet dated', year ? { data: { when: year, where: 'Bodega Bay' } } : note('Nobody wrote a year on the tin.')));
  group(CHIPPED.longPlace, 'stack', '4 rolls', pile, {});
  add(root, 'reference', 'Depicting rain in early modern Japanese prints', { summary: 'How printmakers showed weather.', data: { site: 'doi.org', by: 'T. Screech et al.', date: '2019', from: 'Research papers', kind: 'paper', venue: 'Journal of Japanese Studies', authors: ['T. Screech', 'M. Forrer', 'H. Smith'] }, origin: { by: 'agent', role: 'scout', tool: 'papers' }, source: found('https://doi.org/10.1000/xyz123') }, 'pick');
  return commands;
}

/** The tree `unknownShape` makes. A script that boots the service keeps it as placed, or the Renderer redraws its card as a note itself. */
export const PLACED = 'placed';

/** A tree of one card whose view names a type no client has heard of. */
export function unknownShape(): Command[] {
  const { commands, add } = planting(PLACED, 'An unknown shape');
  add(null, 'hologram', 'A shape this client has never heard of', { summary: 'Unknown shapes fall back to a note.', view: { component: 'hologram', props: { depth: 3 } } });
  return commands;
}

/** A tree of `total` note cards. With `chips`, every other card carries a date and a place. */
export function crowd(total: number, { chips = false } = {}): Command[] {
  const at = new Date().toISOString();
  const commands: Command[] = [];
  for (let i = 0; i < total; i++) {
    const data = chips && i % 2 === 0 ? { when: `May ${1900 + i}`, where: 'Bodega Bay' } : {};
    const item: Item = { id: `crowd-item-${i}`, kind: 'text', title: `Thought ${i + 1}`, text: '', summary: 'One of many, to see how the field holds up.', tags: [], data, source: { from: 'paste', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0 };
    const node: Node = { id: `crowd-${i}`, treeId: 'crowd', itemId: item.id, parent: i === 0 ? null : `crowd-${Math.floor((i - 1) / 4)}`, status: i % 3 === 2 ? 'pick' : 'kept', why: i % 3 === 2 ? 'Related' : '', importance: 0.5, origin: { by: 'user' }, view: { component: 'note', props: {}, by: 'default' }, order: i };
    commands.push({ type: 'addItem', item });
    if (i === 0) commands.push({ type: 'createTree', tree: { id: 'crowd', title: 'A crowd', rootId: node.id, digest: '', createdAt: at }, root: node });
    else commands.push({ type: 'addNode', node });
  }
  return commands;
}


/** Every part of a card that reaches past its face, text squeezed to fewer lines than it is allowed, or text wider than its box. */
export function spills(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const card of document.querySelectorAll<HTMLElement>('.card:not(.is-under):not(.is-buried)')) {
      const face = card.querySelector('.card-face')!.getBoundingClientRect();
      const name = `${card.dataset.component} "${card.getAttribute('aria-label') ?? card.textContent!.slice(0, 30)}"`;
      for (const el of card.querySelectorAll<HTMLElement>('.card-body *, .chip-line, .chip-line *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const label = el.getAttribute('class') ?? el.tagName.toLowerCase();
        if (r.left < face.left - 1 || r.right > face.right + 1 || r.top < face.top - 1 || r.bottom > face.bottom + 1) found.push(`${name}: ${label} leaves the card`);
        const lines = Number(/clamp-(\d)/.exec(label)?.[1] ?? 0);
        if (lines > 0 && el.clientHeight < Math.min(el.scrollHeight, lines * parseFloat(getComputedStyle(el).lineHeight)) - 1) found.push(`${name}: ${label} is squeezed below its ${lines} lines`);
        else if (el instanceof HTMLElement && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') found.push(`${name}: ${label} is wider than its box`);
      }
    }
    return found;
  });
}
