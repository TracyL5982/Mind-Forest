/** What the browser test and the scripts that drive a real browser share: the browser, the fake service, and two fixture trees. */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import type { Command, Item, Node } from '../src/core/domain.ts';
import { FakeModel } from '../src/fake/model.ts';
import { byRule } from '../src/core/roles/renderer.ts';
import type { Roles } from '../src/core/roles/types.ts';
import { COMPONENT_IDS, SAMPLES, STRUCTURED_IDS } from '../src/core/samples.ts';
import { COMPOSITE_IDS } from '../src/core/views.ts';
import { fit } from '../src/core/map.ts';
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
 * what the Renderer's rules draw its card from, so the tree looks the same after the stand-in Renderer has been over it. `structured: false` leaves out the types
 * of `STRUCTURED_IDS` and the arrangements added after them. `sound` is the address of a recording the service holds, which adds a recording after the types
 * drawn from structure.
 */
export function showcase(image: string, other?: string, { structured = true, sound = '' } = {}): Command[] {
  const { commands, add, group } = planting('show', 'Every shape');

  const counted = `${COMPONENT_IDS.length} components and ${COMPOSITE_IDS.length} ways to arrange them.`;
  const root = add(null, 'note', 'Every way a card can be drawn', { summary: counted, text: counted });
  const quote = add(root, 'quote', 'Lange on seeing', { text: '"The camera is a tool for learning how to see without a camera." Dorothea Lange', data: { quote: { text: 'The camera is a tool for learning how to see without a camera.', by: 'Dorothea Lange' } } });
  const factCard = add(root, 'fact', 'Drop-off in minute one', { text: '42% of viewers leave in the first minute', data: { facts: [{ label: 'of viewers leave in the first minute', value: '42%' }] } });
  const imageCard = add(root, 'image', 'Beach still', { ...picture(image), summary: 'A still from the beach scene' });
  const videoCard = add(root, 'video', 'Dolly zoom clip', { kind: 'video', data: { mediaUrl: image, thumbnailUrl: image }, summary: 'The dolly zoom, slowed down' });
  const linkCard = add(root, 'link', 'The Vertigo effect, explained', { kind: 'link', summary: 'How one shot changed the grammar of suspense.', source: { from: 'link', url: 'https://example.com/vertigo', capturedAt: new Date().toISOString() } });
  const chartCard = add(root, 'chart', 'Use by decade', { text: '1960: 3 films\n1980: 9 films\n2000: 14 films\n2020: 11 films', data: { chart: { labels: ['1960', '1980', '2000', '2020'], values: [3, 9, 14, 11], unit: 'films' } } });
  const personCard = add(root, 'person', 'Who built it', { text: 'Irmin Roberts\nSecond-unit cameraman', data: { person: { name: 'Irmin Roberts', role: 'Second-unit cameraman' } } });
  const chatCard = add(root, 'chat', 'Asking about the stretch', {
    kind: 'chat',
    data: { messages: [{ role: 'user', text: 'Why does the room seem to stretch?' }, { role: 'assistant', text: 'The lens zooms in while the camera pulls back, so the subject holds still and the background rushes away.' }] },
    source: { from: 'chat-export:claude', capturedAt: new Date().toISOString() },
  });
  const codeCard = add(root, 'code', 'Field of view', { data: { code: { language: 'js', source: 'const fov = 2 * Math.atan(width / (2 * distance));\ncamera.zoom = base / Math.tan(fov / 2);\nrender();' } } });
  add(root, 'steps', 'How to try it', { text: 'How to try it:\n1. Pick a subject\n2. Move away while zooming in\n3. Keep the subject the same size', data: { steps: ['Pick a subject', 'Move away while zooming in', 'Keep the subject the same size'] } });

  const gallery = [1, 2, 3].map((i) => add(quote, 'image', `Frame ${i}`, picture(image)));
  group(quote, 'gallery', 'Frames', gallery, {});
  const timeline = ['1958', '1975', '1990'].map((year) => add(gallery[0]!, 'note', `Used in ${year}`, { summary: 'A famous use of the shot.' }));
  group(gallery[0]!, 'timeline', 'Through the years', timeline, { labels: Object.fromEntries(timeline.map((id, i) => [id, ['1958', '1975', '1990'][i]])) });
  const compared = ['Zoom lens', 'Prime and a dolly'].map((name) => add(timeline[2]!, 'note', name, { summary: 'One way to get the shot.', origin: SCOUT }, 'pick'));
  group(timeline[2]!, 'comparison', 'Two ways to shoot it', compared, { criteria: ['Cost', 'Look'], cells: { [compared[0]!]: ['Low', 'Slight breathing'], [compared[1]!]: ['High', 'Clean'] } });
  const sequence = ['Frame the subject', 'Start the pull', 'Land the zoom'].map((name) => add(compared[1]!, 'note', name, { text: 'One beat of the move, in the order it is shot.' }));
  group(compared[1]!, 'sequence', 'The move', sequence, {});
  const cluster = ['Unease', 'Vertigo', 'Dread'].map((name) => add(sequence[2]!, 'fact', name, { text: `What it evokes: ${name}`, data: { facts: [{ label: 'what it evokes', value: name }] } }));
  group(sequence[2]!, 'cluster', '', cluster, { theme: 'Feelings' });
  const pile = Array.from({ length: 5 }, (_, i) => add(cluster[2]!, 'note', `Another example ${i + 1}`, { summary: 'One more film that uses it.' }));
  group(cluster[2]!, 'stack', '5 more', pile, {});
  if (other) commands.push({ type: 'link', link: { id: 'show-link', a: quote, b: other, why: 'Same shot', strength: 0.9 } });
  if (!structured) return commands;

  const more = `${STRUCTURED_IDS.length} more types, each drawn from structure its item holds or assembled from its parts.`;
  const carried = add(root, 'note', 'What an item can carry', { summary: more, text: more });
  for (const id of STRUCTURED_IDS) {
    const { title, kind, text, summary, data, source, origin } = SAMPLES[id].item;
    const seed: Seed = { kind, text, summary, data, source: { ...source, asset: undefined }, origin };
    if (id === 'artwork') seed.data = { ...data, mediaUrl: image };
    if (id === 'place') seed.data = { ...data, image };
    if (id === 'callout') {
      seed.text = 'Feed it once a day with equal parts flour and water.\nCaution: anything above 40 °C kills the yeast.';
      seed.view = { component: 'callout', props: { text: 'Caution: anything above 40 °C kills the yeast.', tone: 'caution', above: ['Feed it once a day with equal parts flour and water.'] } };
    }
    // The stand-in assembles a sheet from a sentence, lines that each set a figure beside its label, and a list under its own label. With the
    // figures alone it would draw the facts card, with the sentence over it: a dedicated type wins.
    if (id === 'sheet') {
      const opening = 'Children aged six months to five years with pneumonia that did not need hospital care were given amoxicillin for five days or for ten.';
      const figures = [{ label: 'Children randomised', value: '824' }, { label: 'Failed in five days', value: '12.6%' }, { label: 'Failed in ten days', value: '12.4%' }];
      const told = ['Five days is enough at home', 'Come back if the fever returns'];
      // A heading line ends no sentence, so an empty line sets it apart from the opening.
      seed.text = [`${title}\n`, opening, ...figures.map(({ label, value }) => `${label}: ${value}`), 'What parents are told:', ...told.map((line) => `- ${line}`)].join('\n');
      seed.view = { component: 'sheet', props: { sections: [{ kind: 'heading', text: title }, { kind: 'text', text: opening }, { kind: 'figures', facts: figures }, { kind: 'list', label: 'What parents are told:', items: told }] } };
    }
    // The stand-in reads a slider from a formula in backticks that names its quantity, and sentences that each write a value and its result.
    if (id === 'explorable') {
      seed.text = 'On a full-frame camera the field of view is `2 * atan(18 / f) * 57.2958` degrees, for a focal length f in mm.\nAt 24 mm the field of view is 73.7°. At 50 mm it is 39.6°. At 200 mm it is 10.3°.';
      seed.view = { component: 'explorable', props: SAMPLES.explorable.props };
    }
    if (add(carried, id, title, seed) !== STRUCTURED[id]) throw new Error(`the ${id} card is not ${STRUCTURED[id]}`);
  }
  if (sound) {
    add(root, 'audio', 'Garden notes for Thursday', {
      kind: 'audio', text: 'Stake the tomatoes by the south wall before the wind, and order two more bags of compost.',
      data: { mediaUrl: sound, sound: { seconds: 4, peaks: [0.2, 0.5, 0.9, 1, 0.6, 0.3, 0.45, 0.8, 0.7, 0.25, 0.1, 0.4] } },
      source: { from: 'drop', capturedAt: new Date().toISOString() },
    });
  }

  const note = (parent: string, title: string, text: string, status: Node['status'] = 'kept') => add(parent, 'note', title, { text, summary: text, ...(status === 'pick' ? { origin: SCOUT } : {}) }, status);
  const lenses = [
    ['A 24 to 70 mm zoom', 'It covers the whole pull in one lens.'],
    ['A 28 to 135 mm zoom', 'It reaches further, and it breathes a little.'],
    ['Two primes and a cut', 'It needs no zoom at all.'],
  ].map(([title, text]) => note(chatCard, title!, text!, 'pick'));
  group(chatCard, 'ranked', 'Lenses to try it with', lenses, { reasons: Object.fromEntries(lenses.map((id, i) => [id, ['It covers the whole pull in one lens.', 'It reaches further, and it breathes a little.', ''][i]])) });
  const takes = [
    ['The storyboard', 'Six frames drawn by hand.'],
    ['The rehearsal', 'The pull was too fast, so it was slowed to four seconds.'],
    ['The take', 'Four seconds, and the subject holds still.'],
  ].map(([title, text]) => note(codeCard, title!, text!));
  group(codeCard, 'beforeafter', 'From board to take', takes, { changes: { [takes[1]!]: 'The pull was too fast, so it was slowed to four seconds.', [takes[2]!]: '' } });
  const support = [
    ['Keep the subject the same size', 'Everything else in the shot follows from this.'],
    ['Mark the floor', 'Tape where the dolly starts and stops.'],
    ['Count the pull', 'Say the seconds out loud.'],
    ['Watch the eyes', 'They should not drift in the frame.'],
  ].map(([title, text]) => note(personCard, title!, text!));
  group(personCard, 'lead', 'What matters most', support, {});
  const shoot = [
    ['Takes', 'Takes: 42', [{ label: 'Takes', value: '42' }]],
    ['Days on set', 'Days on set: 3', [{ label: 'Days on set', value: '3' }]],
    ['Crew', 'Crew: 11', [{ label: 'Crew', value: '11' }]],
  ].map(([title, text, facts]) => add(linkCard, 'fact', title as string, { text: text as string, data: { facts } }));
  const perDay = add(linkCard, 'chart', 'Takes by day', { text: 'Day 1: 9 takes\nDay 2: 21 takes\nDay 3: 12 takes', data: { chart: { labels: ['Day 1', 'Day 2', 'Day 3'], values: [9, 21, 12], unit: 'takes' } } });
  group(linkCard, 'overview', 'The shoot', [...shoot, perDay], {});
  const board = [
    add(videoCard, 'image', 'Low light on the stairs', picture(image)),
    add(videoCard, 'image', 'The bell tower', picture(image)),
    add(videoCard, 'swatch', SAMPLES.swatch.item.title, { kind: SAMPLES.swatch.item.kind, text: SAMPLES.swatch.item.text, summary: SAMPLES.swatch.item.summary, data: SAMPLES.swatch.item.data }),
    add(videoCard, 'idea', 'Paint the stairwell green', { text: 'Paint the stairwell green' }),
  ];
  group(videoCard, 'moodboard', 'The look', board, {});
  const effort = [
    ['Light the background', 'Little effort, and a large impact on the shot.'],
    ['Build a longer track', 'Much effort, and a large impact on the shot.'],
    ['Change the lens cap', 'Little effort and little impact.'],
    ['Repaint the set', 'Much effort for little impact.'],
  ].map(([title, text]) => note(imageCard, title!, text!));
  group(imageCard, 'matrix', 'What to fix first', effort, { x: 'Effort', y: 'Impact', reasons: Object.fromEntries(effort.map((id, i) => [id, i === 0 ? 'Little effort, and a large impact on the shot.' : ''])) });
  const rigs = [
    ['Zoom in on a tripod', 'On a tripod the camera stays put.'],
    ['Pan on a tripod', 'On a tripod the camera turns in place.'],
    ['Push in on a dolly', 'On a dolly the camera moves in.'],
    ['Pull back on a dolly', 'On a dolly the camera moves away.'],
  ].map(([title, text]) => note(chartCard, title!, text!));
  const column = (label: string, ids: string[]) => ({ kind: 'column', label, children: ids.map((id) => ({ kind: 'card', id, role: 'normal' })) });
  group(chartCard, 'layout', 'Two rigs', rigs, { tree: { kind: 'row', children: [column('On a tripod', rigs.slice(0, 2)), column('On a dolly', rigs.slice(2))] } });
  // The map rule fits the same props from the same points, so the stand-in Renderer finds the group as it would make it.
  const located = ([
    ['Shot on the Lisbon tram', 'The pull, on the 28 tram.', { lat: 38.7223, lon: -9.1393 }],
    ['Shot at Porto station', 'The pull, under the tiles.', { lat: 41.1456, lon: -8.6106 }],
    ['Shot on the Lisbon steps', 'The pull, down the steps.', { lat: 38.7139, lon: -9.1334 }],
  ] as const).map(([title, text, at]) => [add(factCard, 'note', title, { text, summary: text, data: { at } }), at] as const);
  const { centre, zoom, pins } = fit(located);
  group(factCard, 'map', 'Where it was shot', pins.flatMap((pin) => pin.members), { centre, zoom, pins });
  return commands;
}

/** The tree of `assembled`: its root, the siblings the stand-in lays out by their facets, and a column of five that is drawn as a cluster. */
export const ASSEMBLED = { root: 'assembled-0', facets: ['assembled-1', 'assembled-2', 'assembled-3', 'assembled-4', 'assembled-5', 'assembled-6'], column: 'assembled-group-layout' } as const;

/**
 * A trip whose kept siblings open with the facets Eat, See and Stay, which the stand-in Renderer lays out as a row of three labelled
 * columns, and under the last of them a layout of one tall column, which fails its shape check and is drawn as a cluster.
 */
export function assembled(): Command[] {
  const { commands, add, group } = planting('assembled', 'Lisbon in three days');
  const root = add(null, 'note', 'Lisbon in three days', { summary: 'A long weekend in June, planned on the train.', text: 'A long weekend in June, planned on the train.' });
  const facets = [
    ['Eat: grilled sardines in Alfama', 'Smoke on every corner in June.'],
    ['Eat: pastéis de nata at Belém', 'Warm from the oven, with cinnamon.'],
    ['See: Tram 28 at dawn', 'Before the crowds get on.'],
    ['See: the tiled station at São Bento', 'Twenty thousand tiles of battles and harvests.'],
    ['Stay: a room above the river', 'Two nights, breakfast on the roof.'],
    ['Stay: the late train home', 'Sunday at nine from Santa Apolónia.'],
  ].map(([title, summary]) => add(root, 'note', title!, { summary, text: summary }));
  const steps = Array.from({ length: 5 }, (_, i) => add(facets[5]!, 'note', `Step ${i + 1} of the walk`, { summary: 'One stop on the river path, with what to look for there.', text: 'One stop on the river path, with what to look for there.' }));
  group(facets[5]!, 'layout', 'The walk', steps, { tree: { kind: 'column', children: steps.map((id) => ({ kind: 'card', id, role: 'normal' })) } });
  return commands;
}

/** Stores a file in the service as a client does, and returns the address it is served from. */
export async function stored(page: Page, run: Running, bytes: Uint8Array, mime: string, name: string): Promise<string> {
  const up = await page.request.post(`${run.url}/api/assets?name=${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': mime }, data: Buffer.from(bytes) });
  return ((await up.json()) as { url: string }).url;
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
  add(root, 'quote', 'From the diary', { text: 'We looked at the water until the water looked back.\n\nA diary, Summer 1958, The web', data: { quote: { text: 'We looked at the water until the water looked back.', by: 'A diary, Summer 1958, The web' }, site: 'example.com', by: 'A diary', date: 'Summer 1958', from: 'The web', where: 'Bodega Bay', people: ['Ada Lovelace', 'Grace Hopper', 'Edsger Dijkstra'], holder: 'Bancroft Library' }, origin: { by: 'agent', role: 'scout', tool: 'web' }, source: found('https://example.com/diary') }, 'pick');
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
        const lines = Number(/clamp-(\d+)/.exec(label)?.[1] ?? 0);
        if (lines > 0 && el.clientHeight < Math.min(el.scrollHeight, lines * parseFloat(getComputedStyle(el).lineHeight)) - 1) found.push(`${name}: ${label} is squeezed below its ${lines} lines`);
        else if (el instanceof HTMLElement && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') found.push(`${name}: ${label} is wider than its box`);
      }
    }
    return found;
  });
}
