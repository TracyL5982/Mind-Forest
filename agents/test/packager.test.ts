import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Item } from '../src/core/domain.ts';
import { packager, type HandoffJson, type HandoffNode } from '../src/core/roles/packager.ts';
import { makeNode } from '../src/core/roles/types.ts';
import { AGENT, kit, type Kit } from './kit.ts';

const SCOUT = AGENT('scout');

function scriptModel(k: Kit) {
  k.model.on('packager', () => ({
    brief: 'The user is studying how the dolly zoom creates unease.',
    nextPrompt: 'Write a one-page shot list that uses the dolly zoom twice.',
    openQuestions: ['Which lens makes the effect strongest?', 'Does it work in a small room?', 'Who used it first?'],
  }));
}

function hang(k: Kit, treeId: string, parent: string, fields: Partial<Item> & { title: string }, status: 'kept' | 'pick'): string {
  const item = k.item({ origin: SCOUT, ...fields });
  const node = makeNode(k.ctx, item, { treeId, parent, status, why: `why ${fields.title}`, origin: SCOUT });
  k.mind.apply({ origin: SCOUT, label: 'pick', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
  return node.id;
}

async function world() {
  const k = kit();
  const film = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase', 'Jaws beach scene'], {
    'Dolly zoom': 'Zoom in while the camera pulls back.',
  });
  const food = k.seedTree('Cooking', ['Bread', 'Sourdough starter']);
  const other = k.seedTree('Unrelated', ['Unrelated', 'Leaf']);
  const [dolly, vertigo, jaws] = film.nodeIds as [string, string, string];
  const { id: photo } = await k.assets.put(new Uint8Array([1, 2, 3]), 'image/jpeg', 'staircase.jpg');
  const source = (url: string) => ({ from: 'web', url, capturedAt: '2026-11-13T00:00:00.000Z' });
  const keptPick = hang(k, film.treeId, vertigo, { title: 'Hitchcock interview', summary: 'He explains the shot.', source: source('https://example.com/hitchcock') }, 'kept');
  const pick = hang(k, film.treeId, vertigo, { title: 'Lens guide', kind: 'link', source: source('https://example.com/lenses') }, 'pick');
  const again = hang(k, food.treeId, food.nodeIds[0]!, { title: 'Lens guide again', source: source('https://example.com/lenses') }, 'pick');
  const still = hang(
    k,
    film.treeId,
    jaws,
    { title: 'Staircase still', kind: 'image', origin: { by: 'user' }, source: { from: 'drop', asset: photo, capturedAt: '2026-11-13T00:00:00.000Z' } },
    'kept',
  );
  const chat = hang(
    k,
    film.treeId,
    dolly,
    { title: 'Chat about lenses', kind: 'chat', origin: { by: 'user' }, data: { messages: [{ role: 'user', text: 'Which lens?' }, { role: 'assistant', text: 'A 35mm.' }] } },
    'kept',
  );
  k.mind.apply({
    origin: SCOUT,
    label: 'links',
    commands: [
      { type: 'link', link: { id: 'inside', a: vertigo, b: jaws, why: 'both use the effect', strength: 0.9 } },
      { type: 'link', link: { id: 'outside', a: vertigo, b: other.nodeIds[1]!, why: 'should not appear', strength: 0.9 } },
    ],
  });
  return { k, film, food, other, dolly, vertigo, jaws, keptPick, pick, again, still, chat, photo };
}

function find(json: HandoffJson, title: string): HandoffNode | undefined {
  const walk = (n: HandoffNode): HandoffNode | undefined => (n.title === title ? n : n.children.map(walk).find(Boolean));
  return json.trees.map((t) => walk(t.root)).find(Boolean);
}

test('a two-tree handoff holds both outlines, plain labels, each URL once, inner links and assets', async () => {
  const w = await world();
  scriptModel(w.k);

  const out = await packager(w.k.ctx, { scope: { treeIds: [w.film.treeId, w.food.treeId], nodeIds: [] } });
  const md = out.markdown;

  assert.match(md, /^# Handoff: Film, Cooking\n/);
  assert.match(md, /### Film\n/);
  assert.match(md, /### Cooking\n/);
  assert.ok(!md.includes('Unrelated'));
  assert.match(md, /\*\*Dolly zoom\*\* \(the user's own, text/);
  assert.match(md, /\*\*Hitchcock interview\*\* \(agent pick, kept by the user/);
  assert.match(md, /\*\*Lens guide\*\* \(agent suggestion, not kept/);
  assert.match(md, /> Zoom in while the camera pulls back\./);
  assert.match(md, /why it is here: why Lens guide/);
  assert.match(md, /summary: He explains the shot\./);
  assert.match(md, /- user: Which lens\?\n\s+- assistant: A 35mm\./);

  const order = ['## What to do next', '## Outline', '## Connections', '## Open questions', '## Sources', '## Pictures and files'].map((h) => md.indexOf(h));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((i) => i > 0));
  assert.match(md, /Write a one-page shot list/);
  assert.match(md, /The user is studying how the dolly zoom creates unease\./);
  assert.match(md, /- Which lens makes the effect strongest\?/);

  assert.match(md, /both use the effect/);
  assert.ok(!md.includes('should not appear'));
  assert.equal(md.split('](https://example.com/lenses)').length - 1, 1, 'a URL is listed once in Sources');
  assert.match(md, /\[Hitchcock interview\]\(https:\/\/example\.com\/hitchcock\)/);
  assert.match(out.bundled, new RegExp(`\`assets/${w.photo}\`: staircase\\.jpg \\(image/jpeg\\)`));
  assert.deepEqual(out.assets, [w.photo]);
  assert.equal(out.name, 'film-and-1-more-handoff-2026-11-13');
});

/** A node's lines in a handoff's Markdown: its bold line and the fields under it, up to the next node. */
function block(md: string, title: string): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trimStart().startsWith(`- **${title}**`));
  assert.ok(start >= 0, `"${title}" is in the outline`);
  const end = lines.findIndex((l, i) => i > start && /^\s*- \*\*/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

test('the file that travels alone names no attached file: each picture is described, with the web address it came from', async () => {
  const w = await world();
  scriptModel(w.k);
  const capturedAt = '2026-11-13T00:00:00.000Z';
  const { id: found } = await w.k.assets.put(new Uint8Array([4]), 'image/jpeg', 'poster.jpg');
  const { id: made } = await w.k.assets.put(new Uint8Array([5]), 'image/png', 'spiral.png');
  hang(w.k, w.film.treeId, w.dolly, { title: 'Vertigo poster', kind: 'image', summary: 'The spiral poster.', source: { from: 'web', url: 'https://example.com/vertigo-poster', asset: found, capturedAt } }, 'kept');
  hang(w.k, w.film.treeId, w.dolly, { title: 'Spiral sketch', kind: 'image', summary: 'A spiral staircase from above.', source: { from: 'image-gen', asset: made, capturedAt } }, 'pick');
  hang(w.k, w.film.treeId, w.dolly, { title: 'Zoom reel', kind: 'video', data: { mediaUrl: 'https://media.example.org/zoom.mp4' }, source: { from: 'web', url: 'https://example.org/zoom', capturedAt } }, 'pick');

  const out = await packager(w.k.ctx, { scope: { treeIds: [w.film.treeId], nodeIds: [] } });

  assert.ok(!out.markdown.includes('assets/'), 'the travelling file names no file of the bundle');
  assert.match(block(out.markdown, 'Staircase still'), /- picture: not attached\. The summary and text here describe it\./);
  const poster = block(out.markdown, 'Vertigo poster');
  assert.match(poster, /- summary: The spiral poster\./);
  assert.match(poster, /- url: https:\/\/example\.com\/vertigo-poster/);
  assert.match(poster, /- picture: not attached\./);
  const sketch = block(out.markdown, 'Spiral sketch');
  assert.match(sketch, /- picture: not attached, made by an image generator\./);
  assert.ok(!/- (url|media):/.test(sketch), 'a generated picture is described only');
  assert.match(block(out.markdown, 'Zoom reel'), /- media: https:\/\/media\.example\.org\/zoom\.mp4/);
  assert.match(out.markdown, /## Pictures and files\n\nNo file comes with this one\. The 3 pictures, videos and files in the outline are described in words/);
  assert.ok(!out.markdown.includes('## Attached files'));

  for (const id of [w.photo, found, made]) assert.ok(out.bundled.includes(`assets/${id}`), 'the bundle still says where each file sits');
  assert.equal(out.title, 'Film');
});

test('the JSON parses and nests nodes under their parents', async () => {
  const w = await world();
  scriptModel(w.k);

  const out = await packager(w.k.ctx, { scope: { treeIds: [w.film.treeId, w.food.treeId], nodeIds: [] } });
  const json = JSON.parse(JSON.stringify(out.json)) as HandoffJson;

  assert.equal(json.format, 'mind-palace-handoff');
  assert.equal(json.version, 1);
  assert.match(json.createdAt, /^2026-11-13T/);
  assert.deepEqual(json.trees.map((t) => [t.id, t.title, t.whole]), [
    [w.film.treeId, 'Film', true],
    [w.food.treeId, 'Cooking', true],
  ]);
  const root = json.trees[0]!.root;
  assert.equal(root.id, w.dolly);
  assert.equal(root.label, 'own');
  assert.equal(root.text, 'Zoom in while the camera pulls back.');
  const vertigo = root.children.find((c) => c.id === w.vertigo)!;
  assert.deepEqual(vertigo.children.map((c) => [c.title, c.label]), [
    ['Hitchcock interview', 'kept'],
    ['Lens guide', 'suggestion'],
  ]);
  assert.equal(find(json, 'Staircase still')!.asset, `assets/${w.photo}`);
  assert.deepEqual(json.links.map((l) => l.id), ['inside']);
  assert.deepEqual(json.sources.map((s) => s.url), ['https://example.com/hitchcock', 'https://example.com/lenses']);
  assert.deepEqual(json.assets, [{ id: w.photo, file: `assets/${w.photo}`, mime: 'image/jpeg', name: 'staircase.jpg' }]);
  assert.equal(json.openQuestions.length, 3);
  assert.equal(json.note, null);
});

test('a subtree scope leaves out siblings and says where the branch came from', async () => {
  const w = await world();
  scriptModel(w.k);

  const out = await packager(w.k.ctx, { scope: { treeIds: [], nodeIds: [w.vertigo, w.keptPick] } });
  const json = out.json as HandoffJson;

  assert.equal(json.trees.length, 1, 'a node under another scoped node is not listed twice');
  assert.equal(json.trees[0]!.whole, false);
  assert.deepEqual(json.trees[0]!.path, ['Dolly zoom']);
  assert.equal(json.trees[0]!.root.id, w.vertigo);
  assert.ok(find(json, 'Hitchcock interview'));
  assert.equal(find(json, 'Jaws beach scene'), undefined);
  assert.ok(!out.markdown.includes('Jaws beach scene'));
  assert.deepEqual(json.links, [], 'a link to a node outside the branch is left out');
  assert.deepEqual(out.assets, []);
  assert.equal(out.name, 'vertigo-staircase-handoff-2026-11-13');
});

test('a tree and a node inside it are packaged once', async () => {
  const w = await world();
  scriptModel(w.k);

  const out = await packager(w.k.ctx, { scope: { treeIds: [w.film.treeId], nodeIds: [w.vertigo] } });

  assert.equal((out.json as HandoffJson).trees.length, 1);
  assert.equal(out.markdown.split("**Vertigo staircase** (the user's own").length - 1, 1);
});

test("the user's note is quoted and reaches the model", async () => {
  const w = await world();
  scriptModel(w.k);

  const out = await packager(w.k.ctx, { scope: { treeIds: [w.film.treeId], nodeIds: [] }, note: 'Turn this into a storyboard.' });

  assert.match(out.markdown, /The user's instruction for you:\n\n> Turn this into a storyboard\./);
  assert.equal((out.json as HandoffJson).note, 'Turn this into a storyboard.');
  assert.match(w.k.model.calls.at(-1)!.detail, /Turn this into a storyboard\./);
});

test('an empty scope packages every tree', async () => {
  const w = await world();
  scriptModel(w.k);

  const out = await packager(w.k.ctx, { scope: { treeIds: [], nodeIds: [] } });

  assert.deepEqual((out.json as HandoffJson).trees.map((t) => t.title), ['Film', 'Cooking', 'Unrelated']);
  assert.equal(out.name, 'mindstorm-handoff-2026-11-13');
  assert.match(out.markdown, /should not appear/, 'with every tree included the cross-tree link is inside the scope');
});

test("the user's long text is trimmed at 3000 characters and the file says so", async () => {
  const k = kit();
  const { treeId } = k.seedTree('Essay', ['Essay'], { Essay: 'x'.repeat(3500) });
  scriptModel(k);

  const out = await packager(k.ctx, { scope: { treeIds: [treeId], nodeIds: [] } });
  const root = (out.json as HandoffJson).trees[0]!.root;

  assert.equal(root.text!.length, 3000);
  assert.equal(root.textTrimmed, true);
  assert.match(out.markdown, /text \(trimmed, the original is longer\):/);
});

test('a model failure still yields a usable bundle with a plain brief and no open questions', async () => {
  const w = await world();
  w.k.model.on('packager', () => {
    throw new Error('model down');
  });

  const out = await packager(w.k.ctx, { scope: { treeIds: [w.film.treeId, w.food.treeId], nodeIds: [] }, note: 'Make a storyboard.' });
  const json = out.json as HandoffJson;

  assert.match(json.brief, /"Film" and "Cooking"/);
  assert.match(json.nextPrompt, /Make a storyboard\./);
  assert.deepEqual(json.openQuestions, []);
  assert.ok(!out.markdown.includes('## Open questions'));
  assert.match(out.markdown, /### Film\n/);
  assert.match(out.markdown, /## Sources/);
  assert.ok(w.k.notes.some((n) => /packager: the model failed/.test(n)));
});
