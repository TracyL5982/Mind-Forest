import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Command, Id, Node } from '../src/core/domain.ts';
import type { WebResult } from '../src/core/ports.ts';
import { scout } from '../src/core/roles/scout.ts';
import { makeNode, type Settings } from '../src/core/roles/types.ts';
import { AGENT, kit, type Kit } from './kit.ts';

const USER = { by: 'user' as const };

function results(n: number, prefix = 'r'): WebResult[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `Result ${prefix}${i}`,
    url: `https://example.com/${prefix}${i}`,
    snippet: `What ${prefix}${i} says.`,
  }));
}

const PLAN = { queries: ['dolly zoom how it works', 'dolly zoom famous shots'], imagePrompt: '', codePrompt: '', instagram: false };

function pick(index: number, more: Record<string, unknown> = {}) {
  return {
    index,
    title: `Chosen ${index}`,
    summary: `Summary ${index}.`,
    tags: ['film'],
    why: `angle ${index}`,
    importance: 0.7,
    quote: '',
    quoteBy: '',
    personName: '',
    personRole: '',
    when: '',
    facts: [],
    steps: [],
    ...more,
  };
}

/** A mindstorm with one film tree, the web answering with ten results, and a model that plans and takes the first four. */
function setup(settings: Partial<Settings> = {}) {
  const k = kit(settings);
  const film = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase']);
  k.world.web = results(10);
  k.model.on('scout.plan', () => PLAN).on('scout.choose', () => ({ picks: [0, 1, 2, 3].map((i) => pick(i)) }));
  return { k, film, anchor: film.nodeIds[0]! };
}

function apply(k: Kit, commands: Command[]): void {
  k.mind.apply({ origin: AGENT('scout'), label: 'scout', commands });
}

function hang(k: Kit, anchor: Id, title: string, url: string, status: Node['status']): Node {
  const item = { ...k.item({ title, kind: 'link' }), source: { from: 'web', url, capturedAt: k.ctx.now() } };
  const node = makeNode(k.ctx, item, { treeId: k.mind.node(anchor).treeId, parent: anchor, status, why: 'earlier', origin: AGENT('scout', 'web') });
  k.mind.apply({ origin: USER, label: 'hang', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
  return node;
}

function urlsUnder(k: Kit, anchor: Id): string[] {
  return k.mind.children(anchor).map((n) => k.mind.itemOf(n.id).source.url ?? '');
}

function modelRoles(k: Kit): string[] {
  return k.model.calls.filter((c) => c.kind === 'json').map((c) => c.role);
}

test('a refresh hangs exactly the asked number of new picks off the anchor', async () => {
  const { k, anchor } = setup();

  const commands = await scout(k.ctx, { anchor, mode: 'refresh' });
  apply(k, commands);

  const picks = k.mind.picks(anchor);
  assert.equal(picks.length, k.ctx.settings.picksPerRun);
  assert.equal(new Set(picks.map((n) => n.order)).size, picks.length);
  for (const node of picks) {
    const item = k.mind.itemOf(node.id);
    assert.equal(item.kind, 'link');
    assert.equal(item.source.from, 'web');
    assert.match(item.source.url!, /^https:\/\/example\.com\/r\d$/, 'the URL is one the search returned');
    assert.deepEqual(item.origin, AGENT('scout', 'web'));
    assert.deepEqual(node.origin, AGENT('scout', 'web'));
    assert.match(node.why, /^angle \d$/);
    assert.equal(node.importance, 0.7);
    assert.equal(item.data.site, 'example.com');
  }
  assert.deepEqual(modelRoles(k), ['scout.plan', 'scout.choose']);

  const two = await scout(k.ctx, { anchor, mode: 'more', count: 2 });
  assert.equal(two.filter((c) => c.type === 'addNode').length, 2);
});

test('picks arrive kept when the setting says immediate', async () => {
  const { k, anchor } = setup({ picksMode: 'immediate' });

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  const fresh = k.mind.children(anchor).filter((n) => n.origin.role === 'scout');
  assert.equal(fresh.length, 4);
  assert.ok(fresh.every((n) => n.status === 'kept'));
});

test('a refresh replaces unkept picks and leaves kept children alone', async () => {
  const { k, anchor, film } = setup();
  const oldPick = hang(k, anchor, 'Old pick', 'https://old.example/pick', 'pick');
  const keptPick = hang(k, anchor, 'Kept pick', 'https://example.com/r0', 'kept');

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.equal(k.mind.nodes.has(oldPick.id), false);
  assert.equal(k.mind.nodes.has(keptPick.id), true);
  assert.equal(k.mind.nodes.has(film.nodeIds[1]!), true);
  assert.equal(k.mind.picks(anchor).length, 4);
  assert.equal(urlsUnder(k, anchor).filter((u) => u === 'https://example.com/r0').length, 1, 'what the user kept is not brought again');
});

test('"more" deletes nothing and repeats no URL', async () => {
  const { k, anchor } = setup();
  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));
  const first = k.mind.picks(anchor).map((n) => n.id);

  const commands = await scout(k.ctx, { anchor, mode: 'more' });
  assert.equal(commands.filter((c) => c.type === 'deleteNode').length, 0);
  apply(k, commands);

  const picks = k.mind.picks(anchor);
  assert.equal(picks.length, 8);
  assert.ok(first.every((id) => k.mind.nodes.has(id)));
  const urls = urlsUnder(k, anchor).filter(Boolean);
  assert.equal(new Set(urls).size, urls.length);
});

test('the same page reached by two searches, or already in another tree, is offered once at most', async () => {
  const { k, anchor } = setup();
  const other = k.seedTree('Reading list', ['Saved pages']);
  hang(k, other.nodeIds[0]!, 'Saved earlier', 'https://www.example.com/r1/', 'kept');
  k.world.web = [];
  k.model.onSearch((query) => (query.includes('famous') ? results(3) : [...results(2), ...results(3, 'x')]));

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh', count: 10 }));

  assert.deepEqual(urlsUnder(k, anchor).filter(Boolean).sort(), [
    'https://example.com/r0',
    'https://example.com/r2',
    'https://example.com/x0',
    'https://example.com/x1',
    'https://example.com/x2',
  ]);
});

test('an unrelated existing item is never linked, and the model is not even asked', async () => {
  const { k, anchor } = setup();
  k.seedTree('Baking', ['Sourdough starter', 'Rye bread']);

  const commands = await scout(k.ctx, { anchor, mode: 'refresh' });
  apply(k, commands);

  assert.equal(commands.filter((c) => c.type === 'link').length, 0);
  assert.ok(!modelRoles(k).includes('scout.links'));
  assert.equal(k.mind.picks(anchor).length, 4);
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

    const commands = await scout(k.ctx, { anchor, mode: 'refresh' });
    apply(k, commands);

    assert.equal(k.mind.links.size, expected, `rated ${strength}`);
    assert.equal(k.mind.picks(anchor).length, 4, 'links never cost a pick');
    if (expected) {
      const link = [...k.mind.links.values()][0]!;
      assert.deepEqual([link.a, link.b], [anchor, lenses.nodeIds[1]]);
      assert.equal(link.why, 'same technique');
      assert.equal(link.strength, 0.9);

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

test('with the model down, picks still come from the search results in order', async () => {
  const k = kit();
  const film = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase']);
  k.seedTree('Lenses', ['Lens notes', 'Dolly zoom lens choice']);
  k.world.web = results(10);
  const anchor = film.nodeIds[0]!;

  const commands = await scout(k.ctx, { anchor, need: 'who invented it', mode: 'refresh' });
  apply(k, commands);

  assert.deepEqual(urlsUnder(k, anchor).filter(Boolean), [0, 1, 2, 3].map((i) => `https://example.com/r${i}`));
  const first = k.mind.itemOf(k.mind.picks(anchor)[0]!.id);
  assert.equal(first.title, 'Result r0');
  assert.equal(first.summary, 'What r0 says.');
  assert.equal(k.mind.links.size, 0);
  assert.deepEqual(
    k.model.calls.filter((c) => c.kind === 'search').map((c) => c.detail),
    ['Dolly zoom who invented it', 'who invented it'],
  );
  assert.equal(k.notes.filter((n) => n.startsWith('scout: ')).length, 3, 'each fallback is noted');
});

test('a choice with bad indexes is topped up to the full count', async () => {
  const { k, anchor } = setup();
  k.model.on('scout.choose', () => ({ picks: [pick(2), pick(2), pick(99), pick(1.5)] }));

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  assert.deepEqual(urlsUnder(k, anchor).filter(Boolean), [2, 0, 1, 3].map((i) => `https://example.com/r${i}`));
});

test('an empty web brings nothing and deletes nothing', async () => {
  const { k, anchor } = setup();
  const oldPick = hang(k, anchor, 'Old pick', 'https://old.example/pick', 'pick');
  k.world.web = [];

  const commands = await scout(k.ctx, { anchor, mode: 'refresh' });

  assert.deepEqual(commands, []);
  assert.equal(k.mind.nodes.has(oldPick.id), true);
  assert.equal(k.notes.filter((n) => n.startsWith('scout: ')).length, 1);
});

test('a refresh may bring back a discarded pick only when the web has nothing else', async () => {
  const { k, anchor } = setup();
  k.world.web = results(4);
  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));
  const before = k.mind.picks(anchor).map((n) => n.id);

  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));

  const after = k.mind.picks(anchor);
  assert.equal(after.length, 4);
  assert.ok(after.every((n) => !before.includes(n.id)));

  k.world.web = [...results(4), ...results(4, 'new')];
  apply(k, await scout(k.ctx, { anchor, mode: 'refresh' }));
  assert.ok(urlsUnder(k, anchor).filter(Boolean).every((u) => u.includes('/new')), 'unseen results win over ones shown before');
});

test('a generated picture, a code sketch and the user’s own posts become picks of the right kind', async () => {
  const { k, anchor } = setup();
  k.world.web = results(1);
  k.world.posts = [
    { id: 'p1', url: 'https://instagram.com/p/1', caption: 'Dolly zoom test in the hallway', mediaType: 'video', mediaUrl: 'https://cdn.example/1.mp4', postedAt: '2026-10-01' },
    { id: 'p2', url: 'https://instagram.com/p/2', caption: 'Storyboard frame', mediaType: 'album', thumbnailUrl: 'https://cdn.example/2.jpg', postedAt: '2026-10-02' },
  ];
  k.model
    .on('scout.plan', () => ({ queries: ['dolly zoom'], imagePrompt: 'a hallway stretching away', codePrompt: 'compute focal length against distance', instagram: true }))
    .on('scout.choose', () => ({
      picks: [
        pick(0),
        pick(1),
        pick(2, { quote: 'It feels like falling', quoteBy: 'A director', facts: [{ label: 'Year', value: '1958' }, { label: '', value: '' }] }),
        pick(3),
        pick(4),
      ],
    }));

  apply(k, await scout(k.ctx, { anchor, need: 'show me what this could look like', mode: 'refresh', count: 5 }));

  const byTool = new Map(k.mind.picks(anchor).map((n) => [n.origin.tool, k.mind.itemOf(n.id)]));
  const picture = byTool.get('image-gen')!;
  assert.equal(picture.kind, 'image');
  assert.equal(picture.source.from, 'image-gen');
  assert.ok(await k.assets.get(picture.source.asset!));

  const code = byTool.get('muse-code')!;
  assert.equal(code.kind, 'code');
  assert.equal(code.source.from, 'muse-code');
  assert.deepEqual(code.data.code, { language: 'js', source: '// compute focal length against distance' });

  const page = byTool.get('web')!;
  assert.deepEqual(page.data.quote, { text: 'It feels like falling', by: 'A director' });
  assert.deepEqual(page.data.facts, [{ label: 'Year', value: '1958' }]);

  const posts = k.mind.picks(anchor).filter((n) => n.origin.tool === 'instagram').map((n) => k.mind.itemOf(n.id));
  assert.deepEqual(posts.map((p) => [p.kind, p.source.url, p.data.mediaUrl]), [
    ['video', 'https://instagram.com/p/1', 'https://cdn.example/1.mp4'],
    ['image', 'https://instagram.com/p/2', 'https://cdn.example/2.jpg'],
  ]);
});

test('a missing anchor is a quiet no-op', async () => {
  const { k } = setup();
  assert.deepEqual(await scout(k.ctx, { anchor: 'gone', mode: 'refresh' }), []);
});
