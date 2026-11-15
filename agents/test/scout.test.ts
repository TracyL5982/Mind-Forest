import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command, Id, Item, Node } from '../src/core/domain.ts';
import { scout } from '../src/core/roles/scout.ts';
import { makeNode, type Settings } from '../src/core/roles/types.ts';
import { AGENT, kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };

type Format = 'note' | 'steps' | 'image' | 'gallery' | 'find' | 'video';

function direction(format: Format, title: string, more: Record<string, unknown> = {}) {
  return {
    angle: `angle of ${title}`,
    format,
    title,
    body: `Body of ${title}.`,
    why: `toward ${title}`,
    tags: ['Film'],
    steps: [],
    images: [],
    source: '',
    lookups: [],
    ...more,
  };
}

const NOTE = direction('note', 'The house at the bend');
const STEPS = direction('steps', 'Shoot it yourself', { steps: ['Pick a subject', 'Pull back while zooming in', 'Hold the subject size'] });
const IMAGE = direction('image', 'The same shot at night', { images: [{ title: 'Night', prompt: 'the same staircase at night, flat illustration' }] });
const ARTWORK = direction('find', 'Staircases that pull the eye down', { source: 'museums', lookups: ['spiral staircase'] });
const work = (n: number, title: string) => ({ title, by: `Maker ${n}`, date: '1920', text: 'Gelatin silver print', from: 'A Museum', url: `https://museum.example/works/${n}`, image: `https://img.example/work-${n}.jpg` });
const MUSEUMS = { id: 'museums', name: 'Museum collections', goodFor: 'Works to look at.', query: 'Catalogue words.', show: 3, visual: true };
const PAPERS = { id: 'papers', name: 'Research papers', goodFor: 'What studies found.', query: 'Title words.', show: 2 };
const WEB = { id: 'web', name: 'The web', goodFor: 'Anything current.', query: 'A web search.', show: 1 };
const PAPER = { title: 'Vertigo and the dolly zoom', by: 'A. Researcher', date: '2011', text: 'We measured viewer discomfort. Discomfort peaked when the background grew by half. The effect faded after two seconds.', url: 'https://doi.example/10.1/zoom' };
const WORKS = [work(1, 'Stairwell, Berlin'), work(2, 'Teapot with spiral handle'), work(3, 'The Long Descent')];
const VIDEO = direction('video', 'Watch the Jaws beach shot', { lookups: ['Jaws beach dolly zoom'] });
const MIX = [NOTE, STEPS, IMAGE, ARTWORK, VIDEO];

/** A film tree, a museum that holds three works, a web that knows one video, and a model that proposes the five-way mix. */
function setup(settings: Partial<Settings> = {}, directions: unknown[] = MIX) {
  const k = kit(settings);
  const film = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase']);
  k.world.sources = [WEB, PAPERS, MUSEUMS];
  k.world.found.set('museums:spiral staircase', WORKS);
  for (const w of WORKS) k.world.pictures.add(w.image);
  k.world.web = [
    { title: 'An article', url: 'https://example.com/article', snippet: '' },
    { title: 'Jaws beach scene', url: 'https://www.youtube.com/watch?v=abcdefghijk', snippet: '' },
  ];
  k.world.videos.set('https://www.youtube.com/watch?v=abcdefghijk', { title: 'Jaws beach scene', url: 'https://www.youtube.com/watch?v=abcdefghijk', embed: 'https://www.youtube.com/embed/abcdefghijk', poster: 'https://img.example/jaws.jpg' });
  k.world.pictures.add('https://img.example/jaws.jpg');
  k.model.on('scout.ideate', () => ({ reading: 'A film technique the user is studying.', directions })).on('scout.curate', () => ({ chosen: [{ number: 1, note: 'The rail leads the eye to the floor.', excerpt: '' }] }));
  return { k, film, anchor: film.nodeIds[0]! };
}

function apply(k: Kit, commands: Command[]): void {
  k.mind.apply({ origin: AGENT('scout'), label: 'scout', commands });
}

function hang(k: Kit, anchor: Id, title: string, status: Node['status'], fields: Partial<Item> = {}): Node {
  const item = k.item({ title, ...fields });
  const node = makeNode(k.ctx, item, { treeId: k.mind.node(anchor).treeId, parent: anchor, status, why: 'earlier', origin: AGENT('scout') });
  k.mind.apply({ origin: USER, label: 'hang', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
  return node;
}

function picked(k: Kit, anchor: Id): Item[] {
  return k.mind.picks(anchor).map((n) => k.mind.itemOf(n.id));
}

/** The asset behind a service address, so a test can say what the service holds or streams there. */
function served(k: Kit, address: unknown): string {
  assert.equal(typeof address, 'string');
  const id = /^\/assets\/(.+)$/.exec(address as string)?.[1];
  assert.ok(id && (k.assets.files.has(id) || k.assets.links.has(id)), `${String(address)} is an asset of the service`);
  return id;
}

test('each direction becomes content of its own kind, shown in place', async () => {
  const { k, anchor } = setup();

  apply(k, await scout(k.ctx, { anchor }));

  const byTitle = new Map(picked(k, anchor).map((i) => [i.title, i]));
  assert.equal(byTitle.size, 5);

  const note = byTitle.get(NOTE.title)!;
  assert.equal(note.kind, 'text');
  assert.equal(note.text, 'Body of The house at the bend.');

  assert.deepEqual(byTitle.get(STEPS.title)!.data.steps, STEPS.steps);

  const image = byTitle.get(IMAGE.title)!;
  assert.equal(image.kind, 'image');
  assert.ok(k.assets.files.has(image.source.asset!), 'the generated picture is stored');

  const artwork = byTitle.get('Stairwell, Berlin')!;
  assert.equal(artwork.kind, 'image');
  assert.ok(k.assets.files.has(artwork.source.asset!), 'the picture was brought in, not pointed at');
  assert.equal(artwork.source.url, 'https://museum.example/works/1');
  assert.equal(artwork.summary, 'The rail leads the eye to the floor.');
  assert.match(artwork.text, /Gelatin silver print\n\nMaker 1, 1920, A Museum/);

  const video = byTitle.get(VIDEO.title)!;
  assert.equal(video.kind, 'video');
  assert.equal(video.data.embed, 'https://www.youtube.com/embed/abcdefghijk');
  assert.ok(k.assets.files.has(served(k, video.data.thumbnailUrl)), 'its still was brought in, not pointed at');
});

test('no pick is ever a bare link out of the app', async () => {
  const { k, anchor } = setup();

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor).filter((i) => i.kind === 'link'), []);
});

test('the thread to each pick names its direction', async () => {
  const { k, anchor } = setup();

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(k.mind.picks(anchor).map((n) => n.why).sort(), MIX.map((d) => d.why).sort());
});

test('picks arrive kept when the setting says immediate', async () => {
  const { k, anchor } = setup({ picksMode: 'immediate' });

  apply(k, await scout(k.ctx, { anchor }));

  assert.equal(k.mind.picks(anchor).length, 0);
  assert.equal(k.mind.children(anchor).filter((n) => n.origin.role === 'scout').length, 5);
});

test('a run takes nothing away, and is told what already hangs there', async () => {
  const { k, anchor } = setup();
  const old = hang(k, anchor, 'An earlier pick', 'pick');
  let prompt = '';
  k.model.on('scout.ideate', (req) => {
    prompt = req.user;
    return { reading: '', directions: MIX };
  });

  const commands = await scout(k.ctx, { anchor, need: 'something else entirely' });
  apply(k, commands);

  assert.equal(commands.filter((c) => c.type === 'deleteNode').length, 0);
  assert.ok(k.mind.nodes.has(old.id));
  assert.equal(k.mind.picks(anchor).length, 6);
  assert.ok(!k.model.calls.some((c) => c.role === 'scout.rate'), 'with room in the round, nothing already there is rated');
  assert.match(prompt, /Do not repeat these[\s\S]*An earlier pick/);
});

test('written ideas are delivered first, then each made direction as it is ready', async () => {
  const { k, anchor } = setup();
  const early: string[][] = [];

  const rest = await scout(k.ctx, {
    anchor,
    deliver: (commands) => {
      early.push(commands.flatMap((c) => (c.type === 'addItem' ? [c.item.title] : [])));
      apply(k, commands);
    },
  });

  assert.deepEqual(early[0]!.sort(), [NOTE.title, STEPS.title].sort());
  assert.equal(early.length, 4, 'the picture, the museum work and the video each arrive on their own');
  assert.ok(early.slice(1).every((titles) => titles.length === 1));
  apply(k, rest);
  assert.equal(k.mind.picks(anchor).length, 5);
});

test('a find that comes back with nothing is tried once on the web', async () => {
  const find = direction('find', 'What the studies measured', { source: 'papers', lookups: ['dolly zoom'] });
  const { k, anchor } = setup({}, [find]);
  k.world.found.set('papers:dolly zoom', [{ ...PAPER, title: 'Off the subject', url: 'https://doi.example/10.1/off' }]);
  k.world.found.set('web:What the studies measured', [PAPER]);
  let asked = 0;
  k.model.on('scout.curate', () => ({ chosen: asked++ === 0 ? [] : [{ number: 1, note: '', excerpt: '' }] }));

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title), [PAPER.title]);
  assert.equal(picked(k, anchor)[0]!.origin.tool, 'web');
});

test('a museum search with no match is left out, and so is a work the mindstorm already holds', async () => {
  const unmatched = direction('find', 'Works nobody holds', { source: 'museums', lookups: ['nothing at all'] });
  const { k, anchor } = setup({}, [NOTE, ARTWORK, unmatched]);
  hang(k, anchor, 'Stairwell, saved earlier', 'kept', { source: { from: 'web', url: 'https://museum.example/works/1', capturedAt: '' } });
  k.model.on('scout.curate', () => ({ chosen: [{ number: 1, note: '', excerpt: '' }] }));

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title).sort(), [NOTE.title, 'Teapot with spiral handle'].sort(), 'the held work was never offered to the model');
  assert.ok(k.notes.some((n) => n.includes('nothing at all')));
});

test('only the works the model chooses are shown, up to three, each once', async () => {
  const { k, anchor } = setup({}, [ARTWORK]);
  k.model.on('scout.curate', () => ({ chosen: [{ number: 3, note: 'a', excerpt: '' }, { number: 1, note: 'b', excerpt: '' }, { number: 3, note: 'again', excerpt: '' }, { number: 9, note: 'not in the list', excerpt: '' }] }));

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title).sort(), ['Stairwell, Berlin', 'The Long Descent']);
  assert.match(k.model.calls.find((c) => c.role === 'scout.curate')!.detail, /Teapot with spiral handle.*Maker 2/);
});

test('no work is shown when the model finds none that fit, or cannot be asked', async () => {
  const { k, anchor } = setup({}, [NOTE, ARTWORK]);
  k.model.on('scout.curate', () => ({ chosen: [] }));
  apply(k, await scout(k.ctx, { anchor }));
  assert.deepEqual(picked(k, anchor).map((i) => i.title), [NOTE.title]);

  k.model.on('scout.curate', () => { throw new Error('down'); });
  apply(k, await scout(k.ctx, { anchor }));
  assert.deepEqual(picked(k, anchor).map((i) => i.title), [NOTE.title]);
});

test('a record is shown in its own words, and only words that are really in it', async () => {
  const find = direction('find', 'What the studies measured', { source: 'papers', lookups: ['dolly zoom discomfort'] });
  const { k, anchor } = setup({}, [find]);
  k.world.found.set('papers:dolly zoom discomfort', [PAPER, { ...PAPER, title: 'A second study', url: 'https://doi.example/10.1/second' }]);
  k.model.on('scout.curate', () => ({
    chosen: [
      { number: 1, note: 'The effect has a measured peak.', excerpt: 'Discomfort peaked when the   background grew by half.' },
      { number: 2, note: 'A replication.', excerpt: 'Viewers fainted in the aisles.' },
    ],
  }));

  apply(k, await scout(k.ctx, { anchor }));

  const [first, second] = picked(k, anchor);
  assert.equal(first!.kind, 'text', 'a record with no picture is still brought');
  assert.equal(first!.summary, 'The effect has a measured peak.');
  assert.match(first!.text, /^Discomfort peaked when the {3}background grew by half\.\n\nA\. Researcher, 2011, Research papers$/);
  assert.equal(first!.source.url, PAPER.url);
  assert.ok(!second!.text.includes('fainted'), 'an excerpt the record does not contain is not shown as its words');
  assert.match(second!.text, /^We measured viewer discomfort/);
});

test('what a museum catalogues about a work reaches the pick: maker, date, medium and holder', async () => {
  const { k, anchor } = setup({}, [ARTWORK]);
  k.world.found.set('museums:spiral staircase', [{ ...work(1, 'Stairwell, Berlin'), kind: 'artwork', medium: 'Gelatin silver print', holder: 'A Museum' }, work(2, 'Teapot with spiral handle')]);
  k.model.on('scout.curate', () => ({ chosen: [1, 2].map((number) => ({ number, note: '', excerpt: '' })) }));

  apply(k, await scout(k.ctx, { anchor }));

  const [catalogued, bare] = picked(k, anchor);
  assert.deepEqual(catalogued!.data, { site: 'museum.example', by: 'Maker 1', date: '1920', from: 'A Museum', kind: 'artwork', medium: 'Gelatin silver print', holder: 'A Museum' });
  assert.deepEqual(bare!.data, { site: 'museum.example', by: 'Maker 2', date: '1920', from: 'A Museum' }, 'a record whose source catalogued nothing more gains no keys');
});

test('a paper reaches the pick with every author and its venue', async () => {
  const find = direction('find', 'What the studies measured', { source: 'papers', lookups: ['dolly zoom discomfort'] });
  const { k, anchor } = setup({}, [find]);
  const authors = ['A. Researcher', 'B. Scholar', 'C. Fellow'];
  k.world.found.set('papers:dolly zoom discomfort', [{ ...PAPER, by: 'A. Researcher et al.', kind: 'paper', authors, venue: 'Journal of Vision' }]);

  apply(k, await scout(k.ctx, { anchor }));

  const [paper] = picked(k, anchor);
  assert.deepEqual(paper!.data, { site: 'doi.example', by: 'A. Researcher et al.', date: '2011', from: 'Research papers', kind: 'paper', authors, venue: 'Journal of Vision' });
  assert.match(paper!.text, /A\. Researcher et al\., 2011, Research papers$/, 'the words under the passage are as they were');
});

test('a paper whose source cut its author list short reaches the pick marked as cut', async () => {
  const find = direction('find', 'What the studies measured', { source: 'papers', lookups: ['dolly zoom discomfort'] });
  const { k, anchor } = setup({}, [find]);
  k.world.found.set('papers:dolly zoom discomfort', [{ ...PAPER, kind: 'paper', authors: ['A. Researcher', 'B. Scholar'], authorsCut: true }]);

  apply(k, await scout(k.ctx, { anchor }));

  const [paper] = picked(k, anchor);
  assert.deepEqual([paper!.data.authors, paper!.data.authorsCut], [['A. Researcher', 'B. Scholar'], true]);
});

test('a chart, steps and a recording a source returns reach the card', async () => {
  const find = direction('find', 'The numbers', { source: 'papers', lookups: ['numbers'] });
  const { k, anchor } = setup({}, [find]);
  k.world.pictures.add('https://img.example/cover.jpg');
  k.world.found.set('papers:numbers', [
    { ...PAPER, title: 'The numbers by decade', url: 'https://x.example/chart', chart: { labels: ['2000', '2010'], values: [1, 2], unit: 'billions' } },
    { ...PAPER, title: 'Two steps', url: 'https://x.example/steps', steps: ['Chop', 'Stir'] },
    { ...PAPER, title: 'An episode', url: 'https://x.example/episode', media: 'https://cdn.example/episode.mp3', image: 'https://img.example/cover.jpg' },
  ]);
  k.world.sources = [{ ...PAPERS, show: 3 }];
  k.model.on('scout.curate', () => ({ chosen: [1, 2, 3].map((number) => ({ number, note: '', excerpt: '' })) }));

  apply(k, await scout(k.ctx, { anchor }));

  const [chart, steps, episode] = picked(k, anchor);
  assert.deepEqual(chart!.data.chart, { labels: ['2000', '2010'], values: [1, 2], unit: 'billions' });
  assert.deepEqual(steps!.data.steps, ['Chop', 'Stir']);
  assert.equal(episode!.kind, 'video');
  assert.equal(k.assets.links.get(served(k, episode!.data.mediaUrl)), 'https://cdn.example/episode.mp3', 'the recording streams through the service');
  assert.ok(k.assets.files.has(served(k, episode!.data.thumbnailUrl)), 'its cover was brought in');
});

test('a search that finds little is tried in other words, and the records are pooled without repeats', async () => {
  const find = direction('find', 'What the studies measured', { source: 'papers', lookups: ['dolly zoom', 'vertigo effect', 'zoom discomfort', 'a fourth wording'] });
  const { k, anchor } = setup({}, [find]);
  const second = { ...PAPER, title: 'A second study', url: 'https://doi.example/10.1/second' };
  k.world.found.set('papers:vertigo effect', [PAPER, second]);
  k.world.found.set('papers:zoom discomfort', [second]);
  k.world.found.set('papers:a fourth wording', [{ ...PAPER, title: 'Never searched', url: 'https://doi.example/10.1/never' }]);
  k.model.on('scout.curate', () => ({ chosen: [{ number: 1, note: '', excerpt: '' }, { number: 2, note: '', excerpt: '' }, { number: 3, note: '', excerpt: '' }] }));

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title).sort(), ['A second study', PAPER.title].sort());
});

test('a source that cannot be reached is reported as that, not as having nothing', async () => {
  const find = direction('find', 'What the studies measured', { source: 'papers', lookups: ['dolly zoom'] });
  const { k, anchor } = setup({}, [NOTE, find]);
  k.ctx.tools.sources.search = async () => { throw new Error('refused'); };

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title), [NOTE.title]);
  assert.ok(k.notes.some((n) => /Research papers could not be reached \(refused\)/.test(n)));
});

test('a direction that names no known source is searched on the web', async () => {
  const find = direction('find', 'A case study', { source: 'encyclopedia', lookups: ['dolly zoom case study'] });
  const { k, anchor } = setup({}, [find]);
  k.world.found.set('web:dolly zoom case study', [PAPER]);

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title), [PAPER.title]);
});

test('the model is told which sources exist and how to search each', async () => {
  const { k, anchor } = setup();

  await scout(k.ctx, { anchor });

  const asked = k.model.calls.find((c) => c.role === 'scout.ideate')!.detail;
  assert.match(asked, /papers: Research papers\. What studies found\. Search: Title words\./);
  assert.match(asked, /museums: Museum collections/);
});

test('a work whose picture cannot be brought in is left out', async () => {
  const { k, anchor } = setup({}, [ARTWORK]);
  k.world.pictures.clear();

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor), []);
});

test('a video that cannot be played in place is left out', async () => {
  const { k, anchor } = setup({}, [NOTE, VIDEO]);
  k.world.videos.clear();

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title), [NOTE.title]);
});

test('a gallery becomes one picture per entry, and a run never generates more than four pictures', async () => {
  const set = (title: string) =>
    direction('gallery', title, { images: ['one', 'two', 'three'].map((t) => ({ title: `${title} ${t}`, prompt: `${title} ${t}, flat illustration` })) });
  const { k, anchor } = setup({}, [set('Places'), set('Moods')]);

  apply(k, await scout(k.ctx, { anchor }));

  const titles = picked(k, anchor).map((i) => i.title);
  assert.deepEqual(titles, ['Places one', 'Places two', 'Places three', 'Moods one']);
  assert.equal(k.model.calls.filter((c) => c.kind === 'image').length, 4);
});

test('the model is shown the picture the user dropped, also when asked about a card under it', async () => {
  const k = kit();
  const tree = k.seedTree('Road', ['Car on a winding road', 'A note under it']);
  const dropped = await k.assets.put(new Uint8Array([7, 7, 7]), 'image/png');
  const root = k.mind.itemOf(tree.nodeIds[0]!);
  Object.assign(root, { kind: 'image', source: { ...root.source, asset: dropped.id } });
  const shown: (string[] | undefined)[] = [];
  k.model.on('scout.ideate', (req) => {
    shown.push(req.images);
    return { reading: '', directions: [NOTE] };
  });

  await scout(k.ctx, { anchor: tree.nodeIds[0]! });
  await scout(k.ctx, { anchor: tree.nodeIds[1]! });

  assert.deepEqual(shown, [['data:image/png;base64,BwcH'], ['data:image/png;base64,BwcH']]);
});

test('the request and the conversation reach the model with the card they are about', async () => {
  const { k, anchor } = setup();
  let prompt = '';
  k.model.on('scout.ideate', (req) => {
    prompt = req.user;
    return { reading: '', directions: [NOTE] };
  });

  await scout(k.ctx, { anchor, need: 'world building', history: [{ who: 'user', text: 'I like the staircase' }] });

  assert.match(prompt, /looking at: "Dolly zoom"/);
  assert.match(prompt, /asked for "world building"/);
  assert.match(prompt, /user: I like the staircase/);
});

test('with the model down nothing changes and the user is told', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Dolly zoom']);
  const anchor = film.nodeIds[0]!;
  const old = hang(k, anchor, 'An earlier pick', 'pick');

  const commands = await scout(k.ctx, { anchor });

  assert.deepEqual(commands, []);
  assert.ok(k.mind.nodes.has(old.id));
  assert.ok(k.notes.some((n) => n.startsWith('scout:')));
});

test('a node that is gone yields nothing', async () => {
  const { k } = setup();

  assert.deepEqual(await scout(k.ctx, { anchor: 'nope' }), []);
});

test('an unrelated thing the user has never comes into the round, and the model is not even asked', async () => {
  const { k, anchor } = setup();
  k.seedTree('Baking', ['Sourdough starter', 'Rye bread']);

  const commands = await scout(k.ctx, { anchor });
  apply(k, commands);

  assert.ok(!k.model.calls.some((c) => c.role === 'scout.rate'));
  assert.equal(k.mind.picks(anchor).length, 5);
  assert.ok(k.mind.picks(anchor).every((n) => k.mind.itemOf(n.id).origin.by === 'agent'));
});

test('a card of another tree strongly tied to the card comes into its round at 0.9 and not at 0.6, as itself and not a copy', async () => {
  for (const [strength, shown] of [
    [0.9, true],
    [0.6, false],
  ] as const) {
    const { k, anchor, film } = setup();
    const lenses = k.seedTree('Lenses', ['Lens notes', 'Dolly zoom lens choice']);
    const related = k.mind.node(lenses.nodeIds[1]!).itemId;
    k.model.on('scout.rate', (req) => {
      assert.ok(!req.user.includes(`item ${k.mind.node(film.nodeIds[1]!).itemId}`), 'what the tree already holds is not offered');
      return { ratings: [{ itemId: related, strength, why: 'same technique' }] };
    });

    const commands = await scout(k.ctx, { anchor });
    apply(k, commands);

    const there = k.mind.picks(anchor).filter((n) => n.itemId === related);
    assert.equal(there.length, shown ? 1 : 0, `rated ${strength}`);
    assert.equal(k.mind.picks(anchor).length - there.length, 5, 'the new picks all came');
    assert.ok(!commands.some((c) => c.type === 'addItem' && c.item.id === related), 'it is shown, not copied');
    assert.equal(k.mind.links.size, 0, 'no line is drawn to the other tree');
    if (shown) {
      assert.deepEqual([there[0]!.why, there[0]!.origin], ['same technique', AGENT('scout', 'mindstorm')]);
      const again = await scout(k.ctx, { anchor });
      assert.ok(!again.some((c) => c.type === 'addNode' && c.node.itemId === related), 'what the tree holds is not brought twice');
    }
  }
});

test('what the user has comes first in a round, the strongest first, at most eight, and new content still comes', async () => {
  const { k, anchor } = setup({}, [NOTE, ARTWORK, STEPS, IMAGE, VIDEO]);
  const lenses = k.seedTree('Lenses', ['Lens notes', ...Array.from({ length: 11 }, (_, i) => `Dolly zoom note ${i + 1}`)]);
  const rated = lenses.nodeIds.slice(1).map((id) => k.mind.node(id).itemId);
  k.model.on('scout.rate', () => ({
    ratings: [
      ...rated.map((itemId, i) => ({ itemId, strength: 0.8 + i * 0.01, why: `tie ${i + 1}` })),
      { itemId: 'item-that-is-not-there', strength: 1, why: 'invented' },
    ],
  }));
  const early: Command[][] = [];

  const rest = await scout(k.ctx, { anchor, deliver: (commands) => (early.push(commands), apply(k, commands)) });
  apply(k, rest);

  const known = k.mind.picks(anchor).filter((n) => n.origin.tool === 'mindstorm');
  assert.deepEqual(known.map((n) => n.why), ['tie 11', 'tie 10', 'tie 9', 'tie 8', 'tie 7', 'tie 6', 'tie 5', 'tie 4']);
  assert.ok(early[0]!.some((c) => c.type === 'addNode' && c.node.origin.tool === 'mindstorm'), 'they arrive with the first delivery');
  const fresh = k.mind.picks(anchor).filter((n) => n.origin.tool !== 'mindstorm');
  assert.equal(fresh.length, 2, 'the round keeps room for two new things');
  assert.equal(k.mind.picks(anchor).length, 10);
});

test('a new find that repeats what the tree holds by address or by title is left out', async () => {
  const find = direction('find', 'What the studies measured', { source: 'papers', lookups: ['dolly zoom'] });
  const { k, anchor } = setup({}, [NOTE, find]);
  hang(k, anchor, 'The house at the bend', 'kept');
  k.world.sources = [{ ...PAPERS, show: 3 }];
  k.world.found.set('papers:dolly zoom', [
    { ...PAPER, title: 'Vertigo  and the Dolly-Zoom', url: 'https://doi.example/10.1/other' },
    { ...PAPER, title: 'A second study', url: 'https://doi.example/10.1/second' },
  ]);
  k.model.on('scout.curate', () => ({ chosen: [1, 2].map((number) => ({ number, note: '', excerpt: '' })) }));
  k.seedTree('Reading', ['Papers', 'Vertigo and the dolly zoom']);
  const held = [...k.mind.items.values()].find((i) => i.title === 'Vertigo and the dolly zoom')!;
  k.mind.apply({ origin: USER, label: 'pin', commands: [{ type: 'addNode', node: makeNode(k.ctx, held, { treeId: k.mind.node(anchor).treeId, parent: anchor, status: 'kept', why: '', origin: USER }) }] });

  apply(k, await scout(k.ctx, { anchor }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title), ['A second study'], 'the note of the same title and the paper of the same title are both left out');
});

test('every picture and recording a pick shows is fetched from the service, never from where it was found', async () => {
  const podcast = direction('find', 'Hear it explained', { source: 'podcasts', lookups: ['dolly zoom'] });
  const { k, anchor } = setup({ picksPerRun: 6 }, [...MIX, podcast]);
  k.world.sources.push({ id: 'podcasts', name: 'Podcasts', goodFor: 'Episodes.', query: 'Topic words.', show: 1 });
  k.world.found.set('podcasts:dolly zoom', [{ ...PAPER, url: 'https://podcasts.example/ep', media: 'https://cdn.example/ep.mp3', image: 'https://img.example/ep.jpg' }]);
  k.world.pictures.add('https://img.example/ep.jpg');

  apply(k, await scout(k.ctx, { anchor }));

  const items = picked(k, anchor);
  assert.equal(items.length, 6);
  for (const item of items) {
    for (const address of [item.data.thumbnailUrl, item.data.mediaUrl].filter((a) => a !== undefined)) served(k, address);
    if (item.source.asset) served(k, `/assets/${item.source.asset}`);
    for (const node of k.mind.nodesOfItem(item.id)) {
      for (const key of ['poster', 'image'] as const) if (node.view.props[key] !== undefined) served(k, node.view.props[key]);
    }
  }
  assert.ok(items.some((i) => i.data.mediaUrl), 'the episode plays');
});

const ARCHIVE = { id: 'archive', name: 'Internet Archive', goodFor: 'Old films that play as a file.', query: 'Title words.', show: 1 };
const REEL = { title: 'Jaws, the beach', by: 'A film school', date: '1975', text: 'The dolly zoom on the beach, frame by frame.', from: 'Internet Archive', url: 'https://archive.example/details/jaws', media: 'https://archive.example/download/jaws/jaws.mp4', image: 'https://archive.example/img/jaws' };

function headsetSetup(files: string[] = ['mp4', 'mp3']) {
  const { k, anchor } = setup({}, [VIDEO]);
  k.world.sources.push(ARCHIVE);
  k.world.pictures.add(REEL.image);
  k.playback.embeds = false;
  k.playback.files = files;
  return { k, anchor };
}

test('while a client that cannot show an embedded player is connected, a video comes as a film that plays from the service', async () => {
  const { k, anchor } = headsetSetup();
  k.world.found.set('archive:Jaws beach dolly zoom', [REEL]);

  apply(k, await scout(k.ctx, { anchor }));

  const [film] = picked(k, anchor);
  assert.equal(film!.kind, 'video');
  assert.equal(film!.data.embed, undefined);
  assert.equal(k.assets.links.get(served(k, film!.data.mediaUrl)), REEL.media);
  assert.ok(k.assets.files.has(served(k, film!.data.thumbnailUrl)));
});

test('a browser alone gets the embedded player, and the archive is not searched for it', async () => {
  const { k, anchor } = setup({}, [VIDEO]);
  k.world.sources.push(ARCHIVE);
  k.world.found.set('archive:Jaws beach dolly zoom', [REEL]);
  const searched: string[] = [];
  const search = k.ctx.tools.sources.search;
  k.ctx.tools.sources.search = (id, query) => (searched.push(id), search(id, query));

  apply(k, await scout(k.ctx, { anchor }));

  assert.equal(picked(k, anchor)[0]!.data.embed, 'https://www.youtube.com/embed/abcdefghijk');
  assert.deepEqual(searched, []);
});

test('when no film plays as a file, the embedded video still comes, shown to the headset by its still', async () => {
  const { k, anchor } = headsetSetup();

  apply(k, await scout(k.ctx, { anchor }));

  const [video] = picked(k, anchor);
  assert.equal(video!.data.embed, 'https://www.youtube.com/embed/abcdefghijk');
  assert.ok(k.assets.files.has(served(k, video!.data.thumbnailUrl)));
});

test('a recording that a connected client cannot play is left out', async () => {
  const { k, anchor } = headsetSetup(['mp4']);
  k.world.found.set('archive:Jaws beach dolly zoom', [{ ...REEL, media: 'https://archive.example/download/jaws/jaws.ogv' }, { ...REEL, url: 'https://archive.example/details/jaws2', media: 'https://archive.example/download/jaws2/jaws2.mp4' }]);

  apply(k, await scout(k.ctx, { anchor }));

  const [film] = picked(k, anchor);
  assert.equal(k.assets.links.get(served(k, film!.data.mediaUrl)), 'https://archive.example/download/jaws2/jaws2.mp4');
});

function libraryFilm(k: Kit, title: string, text: string, tags: string[]): Item {
  const film = k.item({ title, text, kind: 'video', tags, source: { from: 'library', capturedAt: '' }, data: { library: { kind: 'film', key: 25 }, mediaUrl: '/assets/vertigo.mp4' } });
  k.mind.apply({ origin: USER, label: 'library', commands: [{ type: 'addItem', item: film }] });
  return film;
}

test('a library film that no tree holds is hung under the card only for a strong tie, and the new picks still come', async () => {
  for (const [strength, shown] of [
    [0.9, true],
    [0.6, false],
  ] as const) {
    const { k, anchor } = setup();
    const vertigo = libraryFilm(k, 'Vertigo', 'Scottie climbs the bell tower stairs: the dolly zoom.', ['dolly zoom']);
    k.model.on('scout.rate', () => ({ ratings: [{ itemId: vertigo.id, strength, why: 'where the dolly zoom began' }] }));

    const commands = await scout(k.ctx, { anchor });
    apply(k, commands);

    const hung = k.mind.picks(anchor).filter((n) => n.itemId === vertigo.id);
    assert.equal(hung.length, shown ? 1 : 0, `rated ${strength}`);
    assert.equal(k.mind.picks(anchor).length - hung.length, 5, 'the new picks all came');
    assert.ok(!commands.some((c) => c.type === 'addItem' && c.item.id === vertigo.id), 'the film is shown, not copied');
    if (shown) assert.deepEqual([hung[0]!.why, hung[0]!.origin.tool], ['where the dolly zoom began', 'library']);
  }
});

test('a library film is brought when the model writes its id back as it was shown, "item library:film:25"', async () => {
  const { k, anchor } = setup();
  const vertigo = libraryFilm(k, 'Vertigo', 'Scottie climbs the bell tower stairs: the dolly zoom.', ['dolly zoom']);
  k.model.on('scout.rate', () => ({ ratings: [{ itemId: `item ${vertigo.id}`, strength: 0.9, why: 'where it began' }] }));

  apply(k, await scout(k.ctx, { anchor }));

  assert.equal(k.mind.picks(anchor).filter((n) => n.itemId === vertigo.id).length, 1);
});

test('a library film that shares nothing with the card is never offered to the model', async () => {
  const { k, anchor } = setup();
  libraryFilm(k, 'The Gold Rush', 'Chaplin eats his boot.', ['comedy']);

  apply(k, await scout(k.ctx, { anchor }));

  assert.ok(!k.model.calls.some((c) => c.role === 'scout.rate'), 'the model was not asked to rate it');
});

test('a library pick taken away leaves the film in the library', async () => {
  const { k, anchor } = setup();
  const vertigo = libraryFilm(k, 'Vertigo', 'Scottie climbs the bell tower stairs: the dolly zoom.', ['dolly zoom']);
  k.model.on('scout.rate', () => ({ ratings: [{ itemId: vertigo.id, strength: 0.9, why: 'where it began' }] }));
  apply(k, await scout(k.ctx, { anchor }));
  const [hung] = k.mind.picks(anchor).filter((n) => n.itemId === vertigo.id);

  apply(k, [{ type: 'deleteNode', id: hung!.id }]);

  assert.equal(k.mind.picks(anchor).filter((n) => n.itemId === vertigo.id).length, 0);
  assert.equal(k.mind.item(vertigo.id).archived, false);
  assert.deepEqual(k.mind.unplaced(), []);
});

test('a card deleted while the Scout works on it ends the run without an unhandled failure', async () => {
  const { k, anchor } = setup();
  k.model.on('scout.ideate', () => {
    k.mind.apply({ origin: USER, label: 'cut', commands: [{ type: 'deleteNode', id: anchor }] });
    return { reading: 'A film technique the user is studying.', directions: MIX };
  });
  // A real run waits on the network between steps; the failure only goes unhandled across such a wait.
  const search = k.ctx.tools.sources.search.bind(k.ctx.tools.sources);
  k.ctx.tools.sources.search = async (id, query) => {
    await new Promise((r) => setTimeout(r, 20));
    return search(id, query);
  };
  const unhandled: unknown[] = [];
  const listen = (err: unknown) => unhandled.push(err);
  process.on('unhandledRejection', listen);
  try {
    await scout(k.ctx, { anchor, deliver: () => {} }).catch(() => {});
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  } finally {
    process.off('unhandledRejection', listen);
  }
  assert.deepEqual(unhandled.map(String), [], 'no failure is left for the process to die of');
});
