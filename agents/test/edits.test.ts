import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import type { Edit } from '../src/core/domain.ts';
import { packager, type HandoffJson } from '../src/core/roles/packager.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running } from '../src/node/server.ts';
import { kit } from './kit.ts';
import { tempDir } from './temp.ts';

interface Msg {
  t: string;
  [k: string]: unknown;
}

async function boot(dataDir = tempDir('mp-edits-')): Promise<{ run: Running; dataDir: string }> {
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir, clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret', settings: { scoutOnDump: false } });
  return { run, dataDir };
}

function connect(run: Running): Promise<{ ws: WebSocket; seen: Msg[]; until: (pred: (m: Msg) => boolean) => Promise<Msg> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`);
    const seen: Msg[] = [];
    const waiters: { pred: (m: Msg) => boolean; done: (m: Msg) => void }[] = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as Msg;
      seen.push(m);
      for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.done(m));
    });
    const until = (pred: (m: Msg) => boolean) =>
      new Promise<Msg>((done) => {
        const hit = seen.find(pred);
        if (hit) done(hit);
        else waiters.push({ pred, done });
      });
    ws.on('open', () => resolve({ ws, seen, until }));
    ws.on('error', reject);
  });
}

const label = (m: Msg) => (m.t === 'change' ? (m.set as { label: string }).label : '');

test('highlights and lines drawn on a card are kept with it, come back after a restart, and one undo takes back the last', async () => {
  const { run, dataDir } = await boot();
  const c = await connect(run);
  await c.until((m) => m.t === 'hello');
  const text = 'The dolly zoom pulls the camera back while the lens zooms in, so the room stretches around a still face.';
  run.pipeline.userCommands('Add a note', [
    { type: 'addItem', item: { id: 'item-dz', kind: 'text', title: 'Dolly zoom', text, summary: '', tags: [], data: {}, origin: { by: 'user' }, source: { from: 'paste', capturedAt: '2026-11-15T00:00:00.000Z' }, archived: false, revision: 0 } },
  ]);
  run.pipeline.userCommands('Start a tree', [
    {
      type: 'createTree',
      tree: { id: 'tree-dz', title: 'Dolly zoom', rootId: 'node-dz', digest: '', createdAt: '2026-11-15T00:00:00.000Z' },
      root: { id: 'node-dz', treeId: 'tree-dz', itemId: 'item-dz', parent: null, status: 'kept', why: '', importance: 1, origin: { by: 'user' }, view: { component: 'note', props: {}, by: 'renderer' }, order: 0 },
    },
  ]);
  await run.pipeline.idle();
  const before = c.seen.length;

  const highlight: Edit = { id: 'e1', kind: 'highlight', quote: 'the room stretches', at: text.indexOf('the room stretches') };
  const stroke: Edit = { id: 'e2', kind: 'stroke', points: [0.1, 0.2, 0.15, 0.22, 0.3, 0.25] };
  c.ws.send(JSON.stringify({ t: 'commands', label: 'Highlight', commands: [{ type: 'addEdit', id: 'node-dz', edit: highlight }] }));
  await c.until((m) => label(m) === 'Highlight');
  c.ws.send(JSON.stringify({ t: 'commands', label: 'Draw', commands: [{ type: 'addEdit', id: 'node-dz', edit: stroke }] }));
  const drawn = await c.until((m) => label(m) === 'Draw');
  assert.equal(drawn.undo, 'Draw', 'undo names the line just drawn');
  assert.deepEqual(run.mind.node('node-dz').edits, [highlight, stroke], 'both edits are on the card, oldest first');
  const patch = (drawn.set as { patches: { entity: string; after: { edits?: Edit[] } }[] }).patches;
  assert.deepEqual(patch.map((p) => p.entity), ['node'], 'a client hears it as a change to the node');
  assert.deepEqual(patch[0]!.after.edits, [highlight, stroke]);
  await run.pipeline.idle();
  const after = c.seen.slice(before);
  assert.ok(!after.some((m) => m.t === 'activity' && (m.activity as { role: string }).role === 'renderer'), 'an edit lays out no card');
  assert.ok(!after.some((m) => ['Choose formats', 'Update tree digests'].includes(label(m))), 'and changes no format or digest');

  c.ws.send(JSON.stringify({ t: 'commands', label: 'Odd', commands: [{ type: 'addEdit', id: 'node-dz', edit: { id: 'e3', kind: 'stroke', points: [0.1, 0.2, 0.3] } }] }));
  await c.until((m) => m.t === 'error');
  c.ws.send(JSON.stringify({ t: 'commands', label: 'Off the card', commands: [{ type: 'addEdit', id: 'node-dz', edit: { id: 'e3', kind: 'stroke', points: [0.1, 0.2, 1.3, 0.2] } }] }));
  await c.until((m) => m.t === 'error' && c.seen.filter((e) => e.t === 'error').length === 2);
  assert.equal(run.mind.node('node-dz').edits?.length, 2, 'points in odd number or off the card are refused');

  const snapshot = run.mind.snapshot();
  c.ws.close();
  await run.close();
  const again = await boot(dataDir);
  assert.deepEqual(again.run.mind.node('node-dz').edits, [highlight, stroke], 'they come back after a restart');
  assert.deepEqual(again.run.mind.snapshot(), snapshot);
  const d = await connect(again.run);
  const hello = await d.until((m) => m.t === 'hello');
  const sent = (hello.snapshot as { nodes: { id: string; edits?: Edit[] }[] }).nodes.find((n) => n.id === 'node-dz');
  assert.deepEqual(sent?.edits, [highlight, stroke], 'and reach a client that joins, as another headset would');

  d.ws.send(JSON.stringify({ t: 'undo' }));
  await d.until((m) => m.t === 'change' && (m.set as { undoes?: string }).undoes !== undefined);
  assert.deepEqual(again.run.mind.node('node-dz').edits, [highlight], 'one undo takes back the line drawn last');

  d.ws.send(JSON.stringify({ t: 'commands', label: 'Erase', commands: [{ type: 'removeEdit', id: 'node-dz', editId: 'e1' }] }));
  await d.until((m) => label(m) === 'Erase');
  assert.equal('edits' in again.run.mind.node('node-dz'), false, 'erasing the last edit leaves the card with none');
  const quiet = d.seen.length;
  d.ws.send(JSON.stringify({ t: 'commands', label: 'Erase', commands: [{ type: 'removeEdit', id: 'node-dz', editId: 'e1' }] }));
  await again.run.pipeline.idle();
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!d.seen.slice(quiet).some((m) => m.t === 'change'), 'erasing what is not there changes nothing');
  d.ws.close();
  await again.run.close();
});

test('a handoff lists the words highlighted on each card', async () => {
  const k = kit();
  k.model.on('packager', () => ({ brief: 'A brief.', nextPrompt: 'Go on.', openQuestions: [] }));
  const film = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase'], { 'Dolly zoom': 'The camera pulls back while the lens zooms in.' });
  const [dolly] = film.nodeIds as [string];
  k.mind.apply({
    origin: { by: 'user' },
    label: 'Highlight',
    commands: [
      { type: 'addEdit', id: dolly, edit: { id: 'h1', kind: 'highlight', quote: 'the lens zooms in', at: 30 } },
      { type: 'addEdit', id: dolly, edit: { id: 's1', kind: 'stroke', points: [0, 0, 1, 1] } },
      { type: 'addEdit', id: dolly, edit: { id: 'h2', kind: 'highlight', quote: 'camera pulls back' } },
    ],
  });
  const out = await packager(k.ctx, { scope: { treeIds: [film.treeId], nodeIds: [] } });
  const node = (out.json as HandoffJson).trees[0]!.root;
  assert.deepEqual(node.highlights, ['the lens zooms in', 'camera pulls back'], 'the JSON keeps the highlighted words, oldest first, and no line');
  assert.deepEqual(node.children[0]!.highlights, [], 'a card with none has an empty list');
  for (const md of [out.markdown, out.bundled]) {
    assert.match(md, /- highlighted by the user:\n\s+- "the lens zooms in"\n\s+- "camera pulls back"/);
    assert.equal(md.split('highlighted by the user').length - 1, 1, 'only the card with highlights says so');
  }
});

test('a card keeps one video stretch: a new one replaces it in one change, and a stretch past the video or ending first is refused', async () => {
  const { run, dataDir } = await boot();
  const c = await connect(run);
  await c.until((m) => m.t === 'hello');
  run.pipeline.userCommands('Add a film', [
    { type: 'addItem', item: { id: 'item-film', kind: 'video', title: 'Vertigo staircase', text: '', summary: '', tags: [], data: { sound: { seconds: 40 } }, origin: { by: 'user' }, source: { from: 'drop', capturedAt: '2026-11-15T00:00:00.000Z' }, archived: false, revision: 0 } },
  ]);
  run.pipeline.userCommands('Start a tree', [
    {
      type: 'createTree',
      tree: { id: 'tree-film', title: 'Vertigo', rootId: 'node-film', digest: '', createdAt: '2026-11-15T00:00:00.000Z' },
      root: { id: 'node-film', treeId: 'tree-film', itemId: 'item-film', parent: null, status: 'kept', why: '', importance: 1, origin: { by: 'user' }, view: { component: 'note', props: {}, by: 'renderer' }, order: 0 },
    },
  ]);
  await run.pipeline.idle();

  const line: Edit = { id: 'l1', kind: 'stroke', points: [0.1, 0.1, 0.2, 0.2] };
  const first: Edit = { id: 's1', kind: 'stretch', from: 12, to: 20 };
  const second: Edit = { id: 's2', kind: 'stretch', from: 25.5, to: 31 };
  const send = (lbl: string, edit: unknown) => c.ws.send(JSON.stringify({ t: 'commands', label: lbl, commands: [{ type: 'addEdit', id: 'node-film', edit }] }));
  send('Draw', line);
  await c.until((m) => label(m) === 'Draw');
  send('Mark a stretch', first);
  await c.until((m) => label(m) === 'Mark a stretch');
  assert.deepEqual(run.mind.node('node-film').edits, [line, first], 'the stretch is kept beside the line');
  send('Mark another stretch', second);
  await c.until((m) => label(m) === 'Mark another stretch');
  assert.deepEqual(run.mind.node('node-film').edits, [line, second], 'a new stretch takes the old one\'s place');

  // (The schema refuses the first as a bad message; the second is a command the state refuses, said in a note.)
  send('Backwards', { id: 's3', kind: 'stretch', from: 20, to: 12 });
  await c.until((m) => m.t === 'error' && /a stretch ends after it begins/.test(String(m.message)));
  send('Past the end', { id: 's3', kind: 'stretch', from: 30, to: 45 });
  await c.until((m) => m.t === 'note' && /past the video's 40 s/.test(String(m.message)));
  assert.deepEqual(run.mind.node('node-film').edits, [line, second], 'a stretch that ends before it begins, or past the video, is refused');

  c.ws.send(JSON.stringify({ t: 'undo' }));
  await c.until((m) => m.t === 'change' && (m.set as { undoes?: string }).undoes !== undefined);
  assert.deepEqual(run.mind.node('node-film').edits, [line, first], 'one undo brings the old stretch back');

  c.ws.close();
  await run.close();
  const again = await boot(dataDir);
  const d = await connect(again.run);
  const hello = await d.until((m) => m.t === 'hello');
  const sent = (hello.snapshot as { nodes: { id: string; edits?: Edit[] }[] }).nodes.find((n) => n.id === 'node-film');
  assert.deepEqual(sent?.edits, [line, first], 'the stretch comes back after a restart, and reaches a client that joins');
  d.ws.close();
  await again.run.close();
});

test('the eraser\'s one press takes every mark off a card in one change, and one undo brings them all back', async () => {
  const { run } = await boot();
  const c = await connect(run);
  await c.until((m) => m.t === 'hello');
  run.pipeline.userCommands('Add a note', [
    { type: 'addItem', item: { id: 'item-n', kind: 'text', title: 'Glazes', text: 'Slow oil glazes over a dead-colour layer.', summary: '', tags: [], data: {}, origin: { by: 'user' }, source: { from: 'paste', capturedAt: '2026-11-15T00:00:00.000Z' }, archived: false, revision: 0 } },
  ]);
  run.pipeline.userCommands('Start a tree', [
    {
      type: 'createTree',
      tree: { id: 'tree-n', title: 'Glazes', rootId: 'node-n', digest: '', createdAt: '2026-11-15T00:00:00.000Z' },
      root: { id: 'node-n', treeId: 'tree-n', itemId: 'item-n', parent: null, status: 'kept', why: '', importance: 1, origin: { by: 'user' }, view: { component: 'note', props: {}, by: 'renderer' }, order: 0 },
    },
  ]);
  await run.pipeline.idle();
  const marks: Edit[] = [
    { id: 'h1', kind: 'highlight', quote: 'Slow oil glazes', at: 0 },
    { id: 'l1', kind: 'stroke', points: [0.1, 0.1, 0.2, 0.2] },
    { id: 'h2', kind: 'highlight', quote: 'dead-colour layer', at: 23 },
  ];
  for (const edit of marks) {
    c.ws.send(JSON.stringify({ t: 'commands', label: `Mark ${edit.id}`, commands: [{ type: 'addEdit', id: 'node-n', edit }] }));
    await c.until((m) => label(m) === `Mark ${edit.id}`);
  }
  c.ws.send(JSON.stringify({ t: 'commands', label: 'Erase the marks', commands: marks.map((e) => ({ type: 'removeEdit', id: 'node-n', editId: e.id })) }));
  const erased = await c.until((m) => label(m) === 'Erase the marks');
  assert.equal('edits' in run.mind.node('node-n'), false, 'every mark is off the card');
  assert.equal(erased.undo, 'Erase the marks', 'as one change');
  c.ws.send(JSON.stringify({ t: 'undo' }));
  await c.until((m) => m.t === 'change' && (m.set as { undoes?: string }).undoes !== undefined);
  assert.deepEqual(run.mind.node('node-n').edits, marks, 'one undo brings them all back, in their order');
  c.ws.close();
  await run.close();
});

test('a handoff names the stretch of a video the user marked', async () => {
  const k = kit();
  k.model.on('packager', () => ({ brief: 'A brief.', nextPrompt: 'Go on.', openQuestions: [] }));
  const film = k.seedTree('Film', ['Dolly zoom', 'Vertigo staircase']);
  const [dolly] = film.nodeIds as [string];
  k.mind.apply({ origin: { by: 'user' }, label: 'Mark a stretch', commands: [{ type: 'addEdit', id: dolly, edit: { id: 's1', kind: 'stretch', from: 12, to: 20.4 } }] });
  const out = await packager(k.ctx, { scope: { treeIds: [film.treeId], nodeIds: [] } });
  const node = (out.json as HandoffJson).trees[0]!.root;
  assert.deepEqual(node.stretch, { from: 12, to: 20.4 }, 'the JSON keeps the stretch in seconds');
  assert.equal(node.children[0]!.stretch, null, 'a card with none has null');
  for (const md of [out.markdown, out.bundled]) assert.match(md, /- marked by the user: the stretch from 0:12 to 0:20\n/);
});
