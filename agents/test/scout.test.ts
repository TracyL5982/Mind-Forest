import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command, Id, Item, Node } from '../src/core/domain.ts';
import { scout } from '../src/core/roles/scout.ts';
import { makeNode, type Settings } from '../src/core/roles/types.ts';
import { AGENT, kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };

type Format = 'note' | 'steps' | 'image' | 'gallery' | 'reference' | 'video';

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
    lookup: '',
    ...more,
  };
}

const NOTE = direction('note', 'The house at the bend');
const STEPS = direction('steps', 'Shoot it yourself', { steps: ['Pick a subject', 'Pull back while zooming in', 'Hold the subject size'] });
const IMAGE = direction('image', 'The same shot at night', { images: [{ title: 'Night', prompt: 'the same staircase at night, flat illustration' }] });
const REFERENCE = direction('reference', 'Vertigo, the film that named it', { lookup: 'Vertigo (film)' });
const VIDEO = direction('video', 'Watch the Jaws beach shot', { lookup: 'Jaws beach dolly zoom' });
const MIX = [NOTE, STEPS, IMAGE, REFERENCE, VIDEO];

/** A film tree, an encyclopedia that knows Vertigo, a web that knows one video, and a model that proposes the five-way mix. */
function setup(settings: Partial<Settings> = {}, directions: unknown[] = MIX) {
  const k = kit(settings);
  const film = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase']);
  k.world.references.set('Vertigo (film)', { title: 'Vertigo (film)', url: 'https://en.wikipedia.org/wiki/Vertigo_(film)', extract: 'A 1958 film by Alfred Hitchcock.', image: 'https://img.example/vertigo.jpg' });
  k.world.pictures.add('https://img.example/vertigo.jpg');
  k.world.web = [
    { title: 'An article', url: 'https://example.com/article', snippet: '' },
    { title: 'Jaws beach scene', url: 'https://www.youtube.com/watch?v=abcdefghijk', snippet: '' },
  ];
  k.world.videos.set('https://www.youtube.com/watch?v=abcdefghijk', { title: 'Jaws beach scene', url: 'https://www.youtube.com/watch?v=abcdefghijk', embed: 'https://www.youtube.com/embed/abcdefghijk', poster: 'https://img.example/jaws.jpg' });
  k.model.on('scout.ideate', () => ({ directions })).on('scout.check', () => ({ fits: true }));
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

test('each direction becomes content of its own kind, shown in place', async () => {
  const { k, anchor } = setup();

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  const byTitle = new Map(picked(k, anchor).map((i) => [i.title, i]));
  assert.equal(byTitle.size, 5);

  const note = byTitle.get(NOTE.title)!;
  assert.equal(note.kind, 'text');
  assert.equal(note.text, 'Body of The house at the bend.');

  assert.deepEqual(byTitle.get(STEPS.title)!.data.steps, STEPS.steps);

  const image = byTitle.get(IMAGE.title)!;
  assert.equal(image.kind, 'image');
  assert.ok(k.assets.files.has(image.source.asset!), 'the generated picture is stored');

  const reference = byTitle.get(REFERENCE.title)!;
  assert.equal(reference.kind, 'image', 'a reference with a picture is shown as that picture');
  assert.ok(k.assets.files.has(reference.source.asset!), 'the picture was brought in, not pointed at');
  assert.equal(reference.source.url, 'https://en.wikipedia.org/wiki/Vertigo_(film)');
  assert.match(reference.text, /1958 film by Alfred Hitchcock/);

  const video = byTitle.get(VIDEO.title)!;
  assert.equal(video.kind, 'video');
  assert.equal(video.data.embed, 'https://www.youtube.com/embed/abcdefghijk');
  assert.equal(video.data.thumbnailUrl, 'https://img.example/jaws.jpg');
});

test('no pick is ever a bare link out of the app', async () => {
  const { k, anchor } = setup();

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.deepEqual(picked(k, anchor).filter((i) => i.kind === 'link'), []);
});

test('the thread to each pick names its direction', async () => {
  const { k, anchor } = setup();

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.deepEqual(k.mind.picks(anchor).map((n) => n.why).sort(), MIX.map((d) => d.why).sort());
});

test('picks arrive kept when the setting says immediate', async () => {
  const { k, anchor } = setup({ picksMode: 'immediate' });

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.equal(k.mind.picks(anchor).length, 0);
  assert.equal(k.mind.children(anchor).filter((n) => n.origin.role === 'scout').length, 5);
});

test('a refresh replaces unkept picks and leaves kept children alone', async () => {
  const { k, anchor, film } = setup();
  const old = hang(k, anchor, 'An earlier pick', 'pick');
  const kept = hang(k, anchor, 'A kept one', 'kept');

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.ok(!k.mind.nodes.has(old.id));
  assert.ok(k.mind.nodes.has(kept.id));
  assert.ok(k.mind.nodes.has(film.nodeIds[1]!));
  assert.equal(k.mind.picks(anchor).length, 5);
});

test('"more" deletes nothing and is told what already hangs there', async () => {
  const { k, anchor } = setup();
  const old = hang(k, anchor, 'An earlier pick', 'pick');
  let prompt = '';
  k.model.on('scout.ideate', (req) => {
    prompt = req.user;
    return { directions: MIX };
  });

  const commands = await scout(k.ctx, { anchor, mode: 'more' });
  apply(k, commands);

  assert.equal(commands.filter((c) => c.type === 'deleteNode').length, 0);
  assert.ok(k.mind.nodes.has(old.id));
  assert.equal(k.mind.picks(anchor).length, 6);
  assert.match(prompt, /Do not repeat these[\s\S]*An earlier pick/);
});

test('written ideas are delivered first and the made ones follow', async () => {
  const { k, anchor } = setup();
  const old = hang(k, anchor, 'An earlier pick', 'pick');
  const early: Command[][] = [];

  const rest = await scout(k.ctx, {
    anchor,
    mode: 'refresh',
    deliver: (commands) => {
      early.push(commands);
      apply(k, commands);
    },
  });

  assert.equal(early.length, 1);
  assert.ok(!k.mind.nodes.has(old.id), 'the old picks leave with the first delivery');
  assert.deepEqual(picked(k, anchor).map((i) => i.title).sort(), [NOTE.title, STEPS.title].sort());
  apply(k, rest);
  assert.equal(k.mind.picks(anchor).length, 5);
});

test('a reference nothing confirms is left out, and so is one the mindstorm already holds', async () => {
  const invented = direction('reference', 'A film that does not exist', { lookup: 'The Spiral Hour (film)' });
  const { k, anchor } = setup({}, [NOTE, REFERENCE, invented]);
  hang(k, anchor, 'Vertigo, saved earlier', 'kept', { source: { from: 'web', url: 'https://en.wikipedia.org/wiki/Vertigo_(film)', capturedAt: '' } });

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title), [NOTE.title]);
  assert.ok(k.notes.some((n) => n.includes('The Spiral Hour')));
});

test('a reference without a usable picture is still brought, as text', async () => {
  const { k, anchor } = setup({}, [REFERENCE]);
  k.world.pictures.clear();

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  const [reference] = picked(k, anchor);
  assert.equal(reference!.kind, 'text');
  assert.match(reference!.text, /1958 film/);
});

test('a picture that shows a different thing of the same name is not used', async () => {
  const { k, anchor } = setup({}, [REFERENCE]);
  k.model.on('scout.check', () => ({ fits: false }));

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.equal(picked(k, anchor)[0]!.kind, 'text');
});

test('a video that cannot be played in place is left out', async () => {
  const { k, anchor } = setup({}, [NOTE, VIDEO]);
  k.world.videos.clear();

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.deepEqual(picked(k, anchor).map((i) => i.title), [NOTE.title]);
});

test('a gallery becomes one picture per entry, and a run never generates more than four pictures', async () => {
  const set = (title: string) =>
    direction('gallery', title, { images: ['one', 'two', 'three'].map((t) => ({ title: `${title} ${t}`, prompt: `${title} ${t}, flat illustration` })) });
  const { k, anchor } = setup({}, [set('Places'), set('Moods')]);

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

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
    return { directions: [NOTE] };
  });

  await scout(k.ctx, { anchor: tree.nodeIds[0]!, mode: 'refresh' });
  await scout(k.ctx, { anchor: tree.nodeIds[1]!, mode: 'refresh' });

  assert.deepEqual(shown, [['data:image/png;base64,BwcH'], ['data:image/png;base64,BwcH']]);
});

test('the request and the conversation reach the model with the card they are about', async () => {
  const { k, anchor } = setup();
  let prompt = '';
  k.model.on('scout.ideate', (req) => {
    prompt = req.user;
    return { directions: [NOTE] };
  });

  await scout(k.ctx, { anchor, need: 'world building', mode: 'refresh', history: [{ who: 'user', text: 'I like the staircase' }] });

  assert.match(prompt, /looking at: "Dolly zoom"/);
  assert.match(prompt, /asked for "world building"/);
  assert.match(prompt, /user: I like the staircase/);
});

test('with the model down nothing changes and the user is told', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Dolly zoom']);
  const anchor = film.nodeIds[0]!;
  const old = hang(k, anchor, 'An earlier pick', 'pick');

  const commands = await scout(k.ctx, { anchor, mode: 'refresh' });

  assert.deepEqual(commands, []);
  assert.ok(k.mind.nodes.has(old.id));
  assert.ok(k.notes.some((n) => n.startsWith('scout:')));
});

test('a node that is gone yields nothing', async () => {
  const { k } = setup();

  assert.deepEqual(await scout(k.ctx, { anchor: 'nope', mode: 'refresh' }), []);
});

test('an unrelated existing item is never linked, and the model is not even asked', async () => {
  const { k, anchor } = setup();
  k.seedTree('Baking', ['Sourdough starter', 'Rye bread']);

  const commands = await scout(k.ctx, { anchor, mode: 'refresh' });
  apply(k, commands);

  assert.equal(commands.filter((c) => c.type === 'link').length, 0);
  assert.ok(!k.model.calls.some((c) => c.role === 'scout.links'));
  assert.equal(k.mind.picks(anchor).length, 5);
});

test('a strongly related existing item is linked at 0.9 and not at 0.6', async () => {
  for (const [strength, expected] of [
    [0.9, 1],
    [0.6, 0],
  ] as const) {
    const { k, anchor, film } = setup();
    const lenses = k.seedTree('Lenses', ['Lens notes', 'Dolly zoom lens choice']);
    const related = k.mind.node(lenses.nodeIds[1]!).itemId;
    k.model.on('scout.links', (req) => {
      assert.ok(!req.user.includes(`item ${k.mind.node(film.nodeIds[1]!).itemId}`), 'what hangs under the anchor is not a link candidate');
      return { ratings: [{ itemId: related, strength, why: 'same technique' }] };
    });

    apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

    assert.equal(k.mind.links.size, expected, `rated ${strength}`);
    assert.equal(k.mind.picks(anchor).length, 5, 'links never cost a pick');
    if (expected) {
      const link = [...k.mind.links.values()][0]!;
      assert.deepEqual([link.a, link.b], [anchor, lenses.nodeIds[1]]);
      assert.equal(link.why, 'same technique');

      const again = await scout(k.ctx, { anchor, mode: 'more' });
      assert.equal(again.filter((c) => c.type === 'link').length, 0, 'what is already linked is not linked twice');
    }
  }
});

test('never more links than the setting allows, and only to items that were offered', async () => {
  const { k, anchor } = setup({ maxLinksPerRun: 2 });
  const lenses = k.seedTree('Lenses', ['Lens notes', 'Dolly zoom lens', 'Dolly zoom history', 'Dolly zoom rig', 'Zoom dolly track']);
  const rated = lenses.nodeIds.slice(1).map((id) => k.mind.node(id).itemId);
  k.model.on('scout.links', () => ({
    ratings: [
      ...rated.map((itemId, i) => ({ itemId, strength: 0.85 + i * 0.03, why: 'same technique' })),
      { itemId: 'item-that-is-not-there', strength: 1, why: 'invented' },
    ],
  }));

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.equal(k.mind.links.size, 2);
  assert.deepEqual(
    [...k.mind.links.values()].map((l) => l.b).sort(),
    [lenses.nodeIds[3], lenses.nodeIds[4]].sort(),
    'the two strongest are the ones drawn',
  );
});
