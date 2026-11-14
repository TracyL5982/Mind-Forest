/** What the browser test and the scripts that drive a real browser share: the browser, the fake service, and two fixture trees. */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
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

/** One tree that holds every component and every composite, and a link to a card in another tree when one is given. */
export function showcase(image: string, other?: string): Command[] {
  const at = new Date().toISOString();
  const commands: Command[] = [];
  let n = 0;
  const add = (parent: string | null, component: string, props: Record<string, unknown>, title: string, extra: Partial<Item> = {}, status: Node['status'] = 'kept'): string => {
    const id = `show-${n++}`;
    const item: Item = { id: `item-${id}`, kind: 'text', title, text: '', summary: '', tags: [], data: {}, source: { from: 'paste', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0, ...extra };
    const node: Node = { id, treeId: 'show', itemId: item.id, parent, status, why: status === 'pick' ? 'Worth a look' : '', importance: 0.5, origin: { by: 'user' }, view: { component, props, by: 'renderer' }, order: n };
    commands.push({ type: 'addItem', item });
    if (parent === null) commands.push({ type: 'createTree', tree: { id: 'show', title: 'Every shape', rootId: id, digest: '', createdAt: at }, root: node });
    else commands.push({ type: 'addNode', node });
    return id;
  };
  const group = (anchor: string, composite: string, title: string, members: string[], props: Record<string, unknown>) =>
    commands.push({ type: 'setGroup', group: { id: `group-${composite}`, treeId: 'show', anchor, composite, title, members, props } });

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

export function crowd(total: number): Command[] {
  const at = new Date().toISOString();
  const commands: Command[] = [];
  for (let i = 0; i < total; i++) {
    const item: Item = { id: `crowd-item-${i}`, kind: 'text', title: `Thought ${i + 1}`, text: '', summary: 'One of many, to see how the field holds up.', tags: [], data: {}, source: { from: 'paste', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0 };
    const node: Node = { id: `crowd-${i}`, treeId: 'crowd', itemId: item.id, parent: i === 0 ? null : `crowd-${Math.floor((i - 1) / 4)}`, status: i % 3 === 2 ? 'pick' : 'kept', why: i % 3 === 2 ? 'Related' : '', importance: 0.5, origin: { by: 'user' }, view: { component: 'note', props: {}, by: 'default' }, order: i };
    commands.push({ type: 'addItem', item });
    if (i === 0) commands.push({ type: 'createTree', tree: { id: 'crowd', title: 'A crowd', rootId: node.id, digest: '', createdAt: at }, root: node });
    else commands.push({ type: 'addNode', node });
  }
  return commands;
}

