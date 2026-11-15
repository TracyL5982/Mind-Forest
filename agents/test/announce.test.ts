import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Id } from '../src/core/domain.ts';
import { announcement } from '../src/core/announce.ts';
import { Pipeline } from '../src/core/pipeline.ts';
import type { Found } from '../src/core/ports.ts';
import { roles } from '../src/core/roles/index.ts';
import { AGENT, makeItem, makeNode, type Settings } from '../src/core/roles/types.ts';
import { kit, type Kit } from './kit.ts';

const PAPERS = { id: 'papers', name: 'Research papers', goodFor: 'What studies found.', query: 'Title words.', show: 1 };
const PAPER: Found = { title: 'Vertigo and the dolly zoom', by: 'A. Researcher', date: '2011', text: 'We measured viewer discomfort.', url: 'https://doi.example/10.1/zoom', kind: 'paper' };

const note = (title: string) => ({ angle: title, format: 'note', title, body: 'Something new.', why: 'new', tags: [], steps: [], images: [], source: '', lookups: [] });
const find = (title: string, lookup: string) => ({ ...note(title), format: 'find', source: 'papers', lookups: [lookup] });

/** The real roles over a scripted model, recording what the agent says and where it moves the view, in order. */
function harness(settings: Partial<Settings> = {}) {
  const k = kit(settings);
  k.model.describing();
  k.world.sources = [PAPERS];
  k.model.on('scout.curate', () => ({ chosen: [{ number: 1, note: '', excerpt: '' }] }));
  const heard: string[] = [];
  const pipeline = new Pipeline({
    mind: k.mind,
    roles: { ...roles, renderer: async () => [] },
    model: k.model,
    tools: k.ctx.tools,
    assets: k.assets,
    store: { append() {}, all: () => [] },
    settings: k.ctx.settings,
    newId: k.ctx.newId,
    now: k.ctx.now,
    emit: (m) => {
      if (m.t === 'say') heard.push(`say: ${m.text}`);
      if (m.t === 'navigate') heard.push(`navigate: ${m.nodeId ?? m.treeId}`);
    },
    settleMs: 5,
    playback: () => k.playback,
  });
  return { k, pipeline, heard };
}

/** Each Scout run thinks of these directions, numbered by the run so every run brings new titles. */
function thinks(k: Kit, directions: (run: number) => unknown[]): void {
  let run = 0;
  k.model.on('scout.ideate', () => ({ reading: '', directions: directions(++run) }));
}

const askedAbout = (anchor: Id, say: string) => () => ({
  anchorId: anchor, kind: 'ask', need: 'why it feels like dread', nodeId: '', treeId: '', request: '', scopeNodeIds: [], scopeTreeIds: [], note: '', text: '', keepNodeIds: [], say,
});

/** A search of the papers that answers only when released, so a test can act while a run is still out looking. */
function heldSearch(k: Kit, query: string): () => void {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const search = k.ctx.tools.sources.search;
  k.ctx.tools.sources.search = async (id, q) => {
    if (q === query) await held;
    return search(id, q);
  };
  k.world.found.set(`papers:${query}`, [{ ...PAPER, title: 'A slow paper', url: 'https://doi.example/slow' }]);
  return release;
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 1));
  assert.ok(done(), 'the run got there');
}

test('a spoken question hears the Conductor first, then one line on what came under the card, and the view moves to it', async () => {
  const { k, pipeline, heard } = harness({ picksPerRun: 2 });
  const [root] = k.seedTree('Film', ['Dolly zoom']).nodeIds as [Id];
  k.world.found.set('papers:dolly zoom', [PAPER]);
  thinks(k, () => [note('A house at night'), find('What the studies measured', 'dolly zoom')]);
  k.model.on('conductor', askedAbout(root, 'Looking into it.'));

  pipeline.utter('why does this feel like dread', { focus: root, selection: [] }, true);
  await pipeline.idle();

  assert.equal(k.mind.picks(root).length, 2);
  assert.deepEqual(heard, [
    'say: Looking into it.',
    `navigate: ${root}`,
    'say: Two new things under Dolly zoom: a paper "Vertigo and the dolly zoom" and an idea "A house at night".',
  ]);
});

test('a typed question and the More button are announced the same way, with no reply before', async () => {
  const { k, pipeline, heard } = harness({ picksPerRun: 1 });
  const [root] = k.seedTree('Film', ['Dolly zoom']).nodeIds as [Id];
  thinks(k, (run) => [note(`Idea ${run}`)]);

  await pipeline.ask(root, 'examples from horror films');
  await pipeline.more(root);
  await pipeline.idle();

  assert.deepEqual(heard, [
    `navigate: ${root}`,
    'say: One new thing under Dolly zoom: an idea "Idea 1".',
    `navigate: ${root}`,
    'say: One new thing under Dolly zoom: an idea "Idea 2".',
  ]);
});

test('"more" said aloud takes the plain rule, and its run is announced after the reply', async () => {
  const { k, pipeline, heard } = harness({ picksPerRun: 1 });
  const [root] = k.seedTree('Film', ['Dolly zoom']).nodeIds as [Id];
  thinks(k, (run) => [note(`Idea ${run}`)]);

  pipeline.utter('more', { focus: root, selection: [] }, true);
  await pipeline.idle();

  assert.ok(!k.model.calls.some((c) => c.role === 'conductor'), 'no model call to route it');
  assert.deepEqual(heard, ['say: Bringing more.', `navigate: ${root}`, 'say: One new thing under Dolly zoom: an idea "Idea 1".']);
});

test('the first round of a tree the user asked for is announced on its root', async () => {
  const { k, pipeline, heard } = harness({ picksPerRun: 3 });
  thinks(k, (run) => [note(`Idea ${run}.1`), note(`Idea ${run}.2`), note(`Idea ${run}.3`)]);

  pipeline.utter('make a tree about the dolly zoom', { selection: [] }, true);
  await pipeline.idle();

  const [tree] = [...k.mind.trees.values()];
  assert.deepEqual(heard, ['say: Starting a tree on that.', `navigate: ${tree!.rootId}`, `say: Three new things under ${k.mind.itemOf(tree!.rootId).title}, including an idea "Idea 1.1".`]);
});

test('a run that brings nothing says so plainly and leaves the view where it is', async () => {
  const { k, pipeline, heard } = harness();
  const [root] = k.seedTree('Film', ['Dolly zoom']).nodeIds as [Id];
  thinks(k, () => []);

  await pipeline.ask(root, 'examples from horror films');
  await pipeline.idle();

  assert.deepEqual(heard, ['say: I found nothing new for Dolly zoom.']);
});

test('a drop the Filer places, and a drop it does not, are not announced', async () => {
  const { k, pipeline, heard } = harness();
  const film = k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  k.model.on('filer', (req) => ({
    placements: [...req.user.matchAll(/item (\S+) \(text\)/g)].map(([, itemId]) => ({ itemId, parentNodeId: film.nodeIds[1]!, strength: 0.9, why: 'the same shot' })),
  }));

  await pipeline.dump([{ kind: 'text', text: 'The Jaws beach shot is a dolly zoom' }]);
  await pipeline.idle();

  assert.equal(k.mind.picks(film.nodeIds[1]!).length, 1, 'the drop was placed');
  assert.deepEqual(heard, []);
});

test('a newer run on the same card silences the older one, which keeps what it already brought', async () => {
  const { k, pipeline, heard } = harness({ picksPerRun: 2 });
  const [root] = k.seedTree('Film', ['Dolly zoom']).nodeIds as [Id];
  const release = heldSearch(k, 'slow');
  thinks(k, (run) => (run === 1 ? [note('First run idea'), find('A slow direction', 'slow')] : [note('Second run idea')]));

  const first = pipeline.ask(root, 'examples from horror films');
  await until(() => k.mind.picks(root).length === 1);
  await pipeline.more(root);
  release();
  await first;
  await pipeline.idle();

  assert.deepEqual(k.mind.picks(root).map((n) => k.mind.itemOf(n.id).title), ['First run idea', 'Second run idea'], "the older run's late find is dropped");
  assert.deepEqual(heard, [`navigate: ${root}`, 'say: One new thing under Dolly zoom: an idea "Second run idea".']);
});

test('when the user has turned to another card since asking, the run is announced and the view stays', async () => {
  const { k, pipeline, heard } = harness({ picksPerRun: 2 });
  const [root, other] = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase']).nodeIds as [Id, Id];
  const release = heldSearch(k, 'slow');
  thinks(k, () => [note('An idea'), find('A slow direction', 'slow')]);

  const run = pipeline.ask(root, 'examples from horror films');
  await until(() => k.mind.picks(root).length === 1);
  pipeline.focus(other);
  release();
  await run;

  assert.deepEqual(heard, ['say: Two new things under Dolly zoom: a paper "A slow paper" and an idea "An idea".']);
});

test('opening the asked-about card again while the run works still moves the view to it at the end', async () => {
  const { k, pipeline, heard } = harness({ picksPerRun: 2 });
  const [root] = k.seedTree('Film', ['Dolly zoom']).nodeIds as [Id];
  const release = heldSearch(k, 'slow');
  thinks(k, () => [note('An idea'), find('A slow direction', 'slow')]);

  const run = pipeline.ask(root, 'examples from horror films');
  await until(() => k.mind.picks(root).length === 1);
  pipeline.focus(root);
  release();
  await run;

  assert.equal(heard[0], `navigate: ${root}`);
});

test('the line stays under about twenty words, drops a subtitle, cuts a long name at a whole word, and counts one as one', () => {
  const k = kit();
  const title = 'A very long card title about generative user interfaces in games';
  const [root] = k.seedTree(title, [title]).nodeIds as [Id];
  const hang = (title: string, tool: string, data: Record<string, unknown> = {}, kind: 'text' | 'video' | 'image' = 'text') => {
    const item = makeItem(k.ctx, { kind, title, text: title, origin: AGENT('scout', tool), source: { from: 'web' }, data });
    const node = makeNode(k.ctx, item, { treeId: k.mind.node(root).treeId, parent: root, status: 'pick', why: 'new', origin: AGENT('scout', tool) });
    k.mind.apply({ origin: AGENT('scout'), label: 'pick', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
    return node.id;
  };
  const talk = hang('Inventing on Principle: a talk on immediate connection between creators and what they create', 'web', {}, 'video');
  const paper = hang('Principles of mixed-initiative user interfaces revisited for the age of large language models', 'papers', { kind: 'paper' });
  const words = (line: string) => line.split(/\s+/).length;

  const both = announcement(k.mind, root, [talk, paper]);
  assert.equal(both, 'Two new things under A very long card title, including a video "Inventing on Principle".');
  assert.ok(words(both) <= 20, both);
  assert.equal(announcement(k.mind, root, [talk]), 'One new thing under A very long card title: a video "Inventing on Principle".');

  const chinese = hang('生成式界面在电子游戏中的十个有趣例子以及它们背后的设计原则', 'idea');
  const line = announcement(k.mind, root, [chinese]);
  assert.match(line, /^One new thing under A very long card title: an idea "生成式界面/);
  assert.ok([...line.replace(/^.*idea "/, '')].length <= 16, line);
});
