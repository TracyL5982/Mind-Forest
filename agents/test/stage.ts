/** What the browser test and the scripts that drive a real browser share: the browser, the fake service, and two fixture trees. */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import type { Command, Item, Node } from '../src/core/domain.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running } from '../src/node/server.ts';

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

/** The service with stand-in agents. Port 0 takes any free port. */
export function bootFake({ port = 0, dataDir = mkdtempSync(join(tmpdir(), 'mp-stage-')), clientDir = join(import.meta.dirname, '../client') } = {}): Promise<Running> {
  return startServer({ port, host: '127.0.0.1', dataDir, clientDir, model: new FakeModel(), roles: fakeRoles, token: TOKEN });
}

export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAHUlEQVQI12NkYPjPgA0wYRWlqgTj////cRhFJzsAGGgEB+4vOSMAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

/** The commands that build one tree, a card at a time. Ids are `<treeId>-<n>` in the order cards are added. */
function planting(treeId: string, treeTitle: string) {
  const at = new Date().toISOString();
  const commands: Command[] = [];
  let n = 0;
  const add = (parent: string | null, component: string, props: Record<string, unknown>, title: string, extra: Partial<Item> = {}, status: Node['status'] = 'kept'): string => {
    const id = `${treeId}-${n++}`;
    const item: Item = { id: `item-${id}`, kind: 'text', title, text: '', summary: '', tags: [], data: {}, source: { from: 'paste', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0, ...extra };
    const node: Node = { id, treeId, itemId: item.id, parent, status, why: status === 'pick' ? 'Worth a look' : '', importance: 0.5, origin: { by: 'user' }, view: { component, props, by: 'renderer' }, order: n };
    commands.push({ type: 'addItem', item });
    if (parent === null) commands.push({ type: 'createTree', tree: { id: treeId, title: treeTitle, rootId: id, digest: '', createdAt: at }, root: node });
    else commands.push({ type: 'addNode', node });
    return id;
  };
  const group = (anchor: string, composite: string, title: string, members: string[], props: Record<string, unknown>) =>
    commands.push({ type: 'setGroup', group: { id: `${treeId}-group-${composite}`, treeId, anchor, composite, title, members, props } });
  return { commands, add, group };
}

/** One tree that holds every component and every composite, and a link to a card in another tree when one is given. */
export function showcase(image: string, other?: string): Command[] {
  const { commands, add, group } = planting('show', 'Every shape');

  const root = add(null, 'note', { emphasis: 'one of each' }, 'Every way a card can be drawn', { summary: 'Eleven components and six ways to arrange them.' });
  const quote = add(root, 'quote', { text: 'The camera is a tool for learning how to see without a camera.', by: 'Dorothea Lange' }, 'Lange on seeing');
  add(root, 'fact', { value: '42%', label: 'of viewers leave in the first minute' }, 'Drop-off in minute one');
  add(root, 'image', { src: image, caption: 'A still from the beach scene' }, 'Beach still');
  add(root, 'video', { src: image, poster: image, caption: 'The dolly zoom, slowed down' }, 'Dolly zoom clip');
  add(root, 'link', { url: 'https://example.com/vertigo', site: 'example.com', description: 'How one shot changed the grammar of suspense.' }, 'The Vertigo effect, explained');
  add(root, 'chart', { chart: 'line', labels: ['1960', '1980', '2000', '2020'], values: [3, 9, 14, 11], unit: 'films', mark: 2 }, 'Use by decade');
  add(root, 'person', { name: 'Irmin Roberts', role: 'Second-unit cameraman' }, 'Who built it');
  add(root, 'chat', { messages: [{ role: 'user', text: 'Why does the room seem to stretch?' }, { role: 'assistant', text: 'The lens zooms in while the camera pulls back, so the subject holds still and the background rushes away.' }], source: 'claude' }, 'Asking about the stretch');
  add(root, 'code', { language: 'js', source: 'const fov = 2 * Math.atan(width / (2 * distance));\ncamera.zoom = base / Math.tan(fov / 2);\nrender();' }, 'Field of view');
  add(root, 'steps', { steps: ['Pick a subject', 'Move away while zooming in', 'Keep the subject the same size'] }, 'How to try it');
  add(root, 'hologram', { depth: 3 }, 'A shape this client has never heard of', { summary: 'Unknown shapes fall back to a note.' });

  const gallery = [1, 2, 3].map((i) => add(quote, 'image', { src: image }, `Frame ${i}`));
  group(quote, 'gallery', 'Frames', gallery, {});
  const timeline = ['1958', '1975', '1990'].map((year) => add(gallery[0]!, 'note', {}, `Used in ${year}`, { summary: 'A famous use of the shot.' }));
  group(gallery[0]!, 'timeline', 'Through the years', timeline, { labels: Object.fromEntries(timeline.map((id, i) => [id, ['1958', '1975', '1990'][i]])) });
  const compared = ['Zoom lens', 'Prime and a dolly'].map((name) => add(timeline[2]!, 'note', {}, name, { summary: 'One way to get the shot.' }, 'pick'));
  group(timeline[2]!, 'comparison', 'Two ways to shoot it', compared, { criteria: ['Cost', 'Look'], cells: { [compared[0]!]: ['Low', 'Slight breathing'], [compared[1]!]: ['High', 'Clean'] } });
  const sequence = ['Frame the subject', 'Start the pull', 'Land the zoom'].map((name) => add(compared[1]!, 'note', {}, name));
  group(compared[1]!, 'sequence', 'The move', sequence, {});
  const cluster = ['Unease', 'Vertigo', 'Dread'].map((name) => add(sequence[2]!, 'fact', { value: name, label: 'what it evokes' }, name));
  group(sequence[2]!, 'cluster', '', cluster, { theme: 'Feelings' });
  const pile = Array.from({ length: 5 }, (_, i) => add(cluster[2]!, 'note', {}, `Another example ${i + 1}`, { summary: 'One more film that uses it.' }));
  group(cluster[2]!, 'stack', '5 more', pile, {});
  if (other) commands.push({ type: 'link', link: { id: 'show-link', a: quote, b: other, why: 'Same shot', strength: 0.9 } });
  return commands;
}

/** The ids of the cards in `chipped`, by what each one is there to show. */
export const CHIPPED = { photo: 'chips-1', plainPhoto: 'chips-2', people: 'chips-3', longPlace: 'chips-4', museum: 'chips-5', link: 'chips-6', four: 'chips-7', plainNote: 'chips-8' } as const;

export const LONG_PLACE = 'The upper reading room of the old municipal library, Vilnius';

/**
 * One tree of cards whose items carry a date, a place, people or an origin, beside twins that carry
 * none, and a timeline whose members have chips. These `item.data` keys are what intake and the
 * Scout write, so the stand-in agents do not have to.
 */
export function chipped(image: string): Command[] {
  const { commands, add, group } = planting('chips', 'With chips');
  const root = add(null, 'note', {}, 'Cards that say when, where and who', { summary: 'One line of chips under a card, only when its item holds them.' });
  add(root, 'image', { src: image, caption: 'Fog over the harbour' }, 'Harbour in fog', { kind: 'image', data: { when: '12 May 1958', where: 'Bodega Bay' } });
  add(root, 'image', { src: image, caption: 'Fog over the harbour' }, 'Harbour in fog, undated', { kind: 'image' });
  add(root, 'note', {}, 'The crew at the wrap party', { summary: 'Everyone who stayed to the end.', data: { people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra', 'Barbara Liskov', 'Alan Kay'] } });
  add(root, 'note', {}, 'Where the notes were found', { summary: 'A box of index cards under the stairs.', data: { where: LONG_PLACE } });
  add(root, 'image', { src: image, caption: 'Sudden shower over a bridge' }, 'Sudden Shower over Shin-Ohashi Bridge', { kind: 'image', data: { when: '1857', from: 'The Metropolitan Museum of Art', site: 'metmuseum.org' }, origin: { by: 'agent', role: 'scout', tool: 'met' } }, 'pick');
  add(root, 'link', { url: 'https://example.com/fog', site: 'example.com', description: 'Why coastal fog comes in at dusk.' }, 'Reading the fog', { kind: 'link', data: { when: '2019', site: 'example.com' }, origin: { by: 'agent', role: 'scout', tool: 'web' } }, 'pick');
  add(root, 'quote', { text: 'We looked at the water until the water looked back.', by: 'A diary' }, 'From the diary', { data: { when: 'Summer 1958', where: 'Bodega Bay', people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra'], holder: 'Bancroft Library' }, origin: { by: 'agent', role: 'scout', tool: 'web' } }, 'pick');
  const plain = add(root, 'note', {}, 'A plain note', { summary: 'No date, no place, nobody named.' });
  const years = ['1958', '1963', '1975'];
  const timeline = years.map((year, i) => add(plain, 'note', {}, `The shoot in ${year}`, { summary: 'One visit to the bay.', data: { when: year, where: ['Bodega Bay', 'Point Reyes', 'Tomales'][i], ...(i === 1 ? { people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra'] } : {}) } }));
  group(plain, 'timeline', 'Visits', timeline, { labels: Object.fromEntries(timeline.map((id, i) => [id, years[i]])) });
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
