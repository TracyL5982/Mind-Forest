import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conductor, isFastPath } from '../src/core/roles/conductor.ts';
import { AGENT, makeNode, type Scene } from '../src/core/roles/types.ts';
import { kit, type Kit } from './kit.ts';

const EMPTY = {
  anchorId: '',
  need: '',
  nodeId: '',
  treeId: '',
  request: '',
  scopeNodeIds: [] as string[],
  scopeTreeIds: [] as string[],
  note: '',
  text: '',
  keepNodeIds: [] as string[],
  say: '',
};

function film(k: Kit) {
  const { treeId, nodeIds } = k.seedTree('Film', ['Dread in cinema', 'Dolly zoom', 'Vertigo staircase', 'Jaws beach scene']);
  const [root, dolly, vertigo, jaws] = nodeIds as [string, string, string, string];
  return { treeId, root, dolly, vertigo, jaws };
}

function addPicks(k: Kit, treeId: string, parent: string, titles: string[]): string[] {
  return titles.map((title) => {
    const item = k.item({ title, origin: AGENT('scout') });
    const node = makeNode(k.ctx, item, { treeId, parent, status: 'pick', why: 'related', origin: AGENT('scout') });
    k.mind.apply({
      origin: AGENT('scout'),
      label: 'pick',
      commands: [
        { type: 'addItem', item },
        { type: 'addNode', node },
      ],
    });
    return node.id;
  });
}

const hear = (k: Kit, utterance: string, scene: Scene) => conductor(k.ctx, { utterance, scene, history: [] });

test('instant commands resolve without the model', async () => {
  const k = kit();
  const f = film(k);
  const picks = addPicks(k, f.treeId, f.dolly, ['Contra-zoom in Goodfellas', 'Hitchcock on the zoom', 'Spielberg interview']);
  const scene: Scene = { focus: f.dolly, selection: [], treeId: f.treeId };

  for (const phrase of ['more', 'More!', 'show me more', 'keep going', 'more like this', 'Okay, more please.']) {
    assert.deepEqual((await hear(k, phrase, scene)).intent, { kind: 'more', anchor: f.dolly }, phrase);
  }
  for (const phrase of ['undo', 'Undo that.', 'put it back', 'no, revert that']) {
    assert.deepEqual((await hear(k, phrase, scene)).intent, { kind: 'undo' }, phrase);
  }
  assert.deepEqual((await hear(k, 'keep all of these', scene)).intent, { kind: 'keep', nodeIds: picks });
  assert.deepEqual((await hear(k, 'keep all', scene)).intent, { kind: 'keep', nodeIds: picks });
  assert.deepEqual((await hear(k, 'keep the first 1', scene)).intent, { kind: 'keep', nodeIds: [picks[0]] });
  assert.deepEqual((await hear(k, 'Go up.', scene)).intent, { kind: 'navigate', nodeId: f.root });
  assert.deepEqual((await hear(k, 'back to the start', scene)).intent, { kind: 'navigate', nodeId: f.root });

  const said = await hear(k, 'more', scene);
  assert.ok(said.say.length > 0 && !said.say.includes('?'));
  assert.deepEqual(k.model.calls, []);
});

test('isFastPath is true only for the instant commands', () => {
  for (const phrase of ['more', 'Show me more.', 'undo', 'keep that', 'keep the first two', 'go up', 'back to the start']) {
    assert.equal(isFastPath(phrase), true, phrase);
  }
  for (const phrase of ['more, but older films', 'why does this feel like dread?', 'keep the first banana', 'go to my lenses tree', 'delete that', '']) {
    assert.equal(isFastPath(phrase), false, phrase);
  }
});

test('"keep the first two" keeps the first two picks by order', async () => {
  const k = kit();
  const f = film(k);
  const picks = addPicks(k, f.treeId, f.dolly, ['A', 'B', 'C']);
  const out = await hear(k, 'Keep the first two.', { focus: f.dolly, selection: [] });
  assert.deepEqual(out.intent, { kind: 'keep', nodeIds: [picks[0], picks[1]] });
  assert.deepEqual(k.model.calls, []);
});

test('"keep that" keeps the pick the user is looking at, and asks when it cannot tell which', async () => {
  const k = kit();
  const f = film(k);
  const picks = addPicks(k, f.treeId, f.dolly, ['A', 'B']);
  assert.deepEqual((await hear(k, 'keep that', { focus: picks[1], selection: [] })).intent, { kind: 'keep', nodeIds: [picks[1]] });
  assert.deepEqual((await hear(k, 'keep that', { focus: f.dolly, selection: [picks[0]!] })).intent, { kind: 'keep', nodeIds: [picks[0]] });
  assert.deepEqual((await hear(k, 'keep all', { focus: picks[1], selection: [] })).intent, { kind: 'keep', nodeIds: picks });

  const unsure = await hear(k, 'keep that', { focus: f.dolly, selection: [] });
  assert.equal(unsure.intent.kind, 'reply');
  assert.match(unsure.say, /\?$/);
  assert.equal((await hear(k, 'keep all', { focus: f.vertigo, selection: [] })).intent.kind, 'reply');
  assert.deepEqual(k.model.calls, []);
});

test('instant commands with nothing to act on ask the user to point', async () => {
  const k = kit();
  const f = film(k);
  for (const phrase of ['more', 'go up', 'back to the start']) {
    assert.equal((await hear(k, phrase, { selection: [] })).intent.kind, 'reply', phrase);
  }
  assert.equal((await hear(k, 'go up', { focus: f.root, selection: [] })).intent.kind, 'reply');
  assert.deepEqual(k.model.calls, []);
});

test('a question becomes an ask with the restated need, and the model sees the scene', async () => {
  const k = kit();
  const f = film(k);
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'ask', anchorId: f.dolly, need: 'why the dolly zoom creates dread', say: 'Looking into the dread.' }));
  const out = await conductor(k.ctx, {
    utterance: 'Why does this feel like dread?',
    scene: { focus: f.dolly, selection: [], treeId: f.treeId },
    history: [{ who: 'user', text: 'tell me about camera moves' }],
  });
  assert.deepEqual(out, { intent: { kind: 'ask', anchor: f.dolly, need: 'why the dolly zoom creates dread' }, say: 'Looking into the dread.' });

  assert.equal(k.model.calls.length, 1);
  const seen = k.model.calls[0]!.detail;
  assert.ok(seen.includes('Why does this feel like dread?'));
  assert.ok(seen.includes(`${f.dolly}: Dolly zoom`));
  assert.ok(seen.includes('Dread in cinema > Dolly zoom'));
  assert.ok(seen.includes('tell me about camera moves'));
  assert.ok(seen.includes(`${f.treeId}: Film`));
});

test('an ask that names a node that does not exist falls back to the focus', async () => {
  const k = kit();
  const f = film(k);
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'ask', anchorId: 'node-that-is-not-there', need: 'horror film examples', say: 'Looking for horror examples.' }));
  const out = await hear(k, 'I need examples from horror films', { focus: f.vertigo, selection: [] });
  assert.deepEqual(out.intent, { kind: 'ask', anchor: f.vertigo, need: 'horror film examples' });
});

test('the selection outranks the focus as the default anchor', async () => {
  const k = kit();
  const f = film(k);
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'more', need: 'older films', say: 'Finding older ones.' }));
  const out = await hear(k, 'more, but older films', { focus: f.dolly, selection: [f.jaws] });
  assert.deepEqual(out.intent, { kind: 'more', anchor: f.jaws, need: 'older films' });
});

test('the shortlist offers the node the utterance names', async () => {
  const k = kit();
  const f = film(k);
  k.model.on('conductor', (req) => {
    assert.ok(req.user.includes(`${f.jaws}: Jaws beach scene`));
    return { ...EMPTY, kind: 'navigate', nodeId: f.jaws, say: 'Opening Jaws.' };
  });
  const out = await hear(k, 'open the one about Jaws', { focus: f.dolly, selection: [] });
  assert.deepEqual(out.intent, { kind: 'navigate', nodeId: f.jaws });
});

test('"go to my lenses tree" navigates to that tree', async () => {
  const k = kit();
  const f = film(k);
  const lenses = k.seedTree('Lenses', ['Lens choices', 'Anamorphic']);
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'navigate', treeId: lenses.treeId, say: 'Going to Lenses.' }));
  const out = await hear(k, 'go to my lenses tree', { focus: f.dolly, selection: [] });
  assert.deepEqual(out, { intent: { kind: 'navigate', treeId: lenses.treeId }, say: 'Going to Lenses.' });

  k.model.on('conductor', () => ({ ...EMPTY, kind: 'navigate', treeId: 'made-up', say: 'Going there.' }));
  assert.deepEqual((await hear(k, 'go to my lenses tree', { focus: f.dolly, selection: [] })).intent, { kind: 'navigate', treeId: lenses.treeId });

  const lost = await hear(k, 'go to my wardrobe tree', { focus: f.dolly, selection: [] });
  assert.equal(lost.intent.kind, 'reply');
  assert.notEqual(lost.say, 'Going there.');
});

test('organize uses the selection as scope when the model returns none', async () => {
  const k = kit();
  const f = film(k);
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'organize', request: 'group Dolly zoom and Vertigo staircase together', say: 'On it.' }));
  const out = await hear(k, 'put these two together', { focus: f.root, selection: [f.dolly, f.vertigo], treeId: f.treeId });
  assert.deepEqual(out.intent, {
    kind: 'organize',
    request: 'group Dolly zoom and Vertigo staircase together',
    scope: { treeIds: [], nodeIds: [f.dolly, f.vertigo] },
  });

  const focused = await hear(k, 'delete that', { focus: f.jaws, selection: [] });
  assert.deepEqual(focused.intent.kind === 'organize' && focused.intent.scope, { treeIds: [], nodeIds: [f.jaws] });
  const whole = await hear(k, 'clean this up', { selection: [], treeId: f.treeId });
  assert.deepEqual(whole.intent.kind === 'organize' && whole.intent.scope, { treeIds: [f.treeId], nodeIds: [] });
});

test('handoff takes the named tree, the thing pointed at, or everything', async () => {
  const k = kit();
  const f = film(k);
  const scene: Scene = { focus: f.dolly, selection: [], treeId: f.treeId };
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'handoff', scopeTreeIds: [f.treeId, 'gone'], note: 'turn it into a shot list', say: 'Packaging the Film tree.' }));
  assert.deepEqual((await hear(k, 'export this tree so Claude can make a shot list', scene)).intent, {
    kind: 'handoff',
    scope: { treeIds: [f.treeId], nodeIds: [] },
    note: 'turn it into a shot list',
  });

  k.model.on('conductor', () => ({ ...EMPTY, kind: 'handoff', say: 'Packaging it.' }));
  assert.deepEqual((await hear(k, 'package this for Claude', scene)).intent, { kind: 'handoff', scope: { treeIds: [], nodeIds: [f.dolly] }, note: '' });
  assert.deepEqual((await hear(k, 'hand off everything to ChatGPT', scene)).intent, { kind: 'handoff', scope: { treeIds: [], nodeIds: [] }, note: '' });
});

test('a dictated thought is captured and a model keep is limited to real picks', async () => {
  const k = kit();
  const f = film(k);
  const picks = addPicks(k, f.treeId, f.dolly, ['A', 'B', 'C']);
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'capture', text: 'dread comes from the background moving', say: 'Noted.' }));
  assert.deepEqual((await hear(k, 'Note to self: dread comes from the background moving', { selection: [] })).intent, {
    kind: 'capture',
    text: 'dread comes from the background moving',
  });

  k.model.on('conductor', () => ({ ...EMPTY, kind: 'keep', keepNodeIds: [picks[2]!, f.jaws, 'nope', picks[1]!], say: 'Kept those.' }));
  assert.deepEqual((await hear(k, 'keep the second and third', { focus: f.dolly, selection: [] })).intent, { kind: 'keep', nodeIds: [picks[1], picks[2]] });
});

test('with nothing to resolve against, an intent that needs an anchor becomes a reply', async () => {
  const k = kit();
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'ask', need: 'horror film examples', say: 'Looking for horror examples.' }));
  const asked = await hear(k, 'I need examples from horror films', { selection: [] });
  assert.equal(asked.intent.kind, 'reply');
  assert.match(asked.say, /point/i);

  k.model.on('conductor', () => ({ ...EMPTY, kind: 'organize', request: 'tidy up', say: 'On it.' }));
  assert.equal((await hear(k, 'tidy this up', { focus: 'stale-id', selection: ['also-stale'] })).intent.kind, 'reply');
});

test('a spoken line that is too long or asks a question is replaced', async () => {
  const k = kit();
  const f = film(k);
  const scene: Scene = { focus: f.dolly, selection: [] };
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'ask', need: 'x', say: 'Shall I look for some examples of that for you?' }));
  assert.equal((await hear(k, 'what about sound design', scene)).say.includes('?'), false);
  k.model.on('conductor', () => ({ ...EMPTY, kind: 'ask', need: 'x', say: Array(20).fill('word').join(' ') }));
  assert.ok((await hear(k, 'what about sound design', scene)).say.split(' ').length < 15);
});

test('when the model fails, a question is still asked about the focus', async () => {
  const k = kit();
  const f = film(k);
  k.model.on('conductor', () => {
    throw new Error('model down');
  });
  const out = await hear(k, 'Why does this feel like dread?', { focus: f.dolly, selection: [] });
  assert.deepEqual(out.intent, { kind: 'ask', anchor: f.dolly, need: 'Why does this feel like dread?' });
  assert.ok(out.say.length > 0);
  assert.equal(k.notes.length, 1);
  assert.match(k.notes[0]!, /^conductor: .*model down/);

  assert.deepEqual((await hear(k, 'the zoom works because the background moves', { selection: [] })).intent, {
    kind: 'capture',
    text: 'the zoom works because the background moves',
  });
  assert.equal((await hear(k, 'what is the opposite of this?', { selection: [] })).intent.kind, 'reply');
  assert.equal((await hear(k, 'horror examples', { focus: f.dolly, selection: [] })).intent.kind, 'ask');
});

test('a model reply that breaks the schema is treated as a failure', async () => {
  const k = kit();
  const f = film(k);
  k.model.on('conductor', () => ({ kind: 'ask' }));
  const out = await hear(k, 'what is the opposite of this?', { focus: f.dolly, selection: [] });
  assert.deepEqual(out.intent, { kind: 'ask', anchor: f.dolly, need: 'what is the opposite of this?' });
  assert.equal(k.notes.length, 1);
});

test('the model is told what the user calls the agent', async () => {
  const k = kit({ agentName: 'juno' });
  const f = film(k);
  let system = '';
  k.model.on('conductor', (req) => ((system = req.system), { ...EMPTY, kind: 'reply', say: "I'm Juno." }));
  const heard = await hear(k, 'What should I call you?', { selection: [], treeId: f.treeId });
  assert.match(system, /the user calls you Juno\b/);
  assert.equal(heard.say, "I'm Juno.");
});

test('"make a tree about X" is heard without the model, and "start a tree on this" means what was just dropped, or else the open card', async () => {
  const k = kit();
  const f = film(k);
  const dropped = k.item({ title: 'Kubrick hated small talk' });
  k.mind.apply({ origin: { by: 'user' }, label: 'drop', commands: [{ type: 'addItem', item: dropped }] });
  const conduct = (utterance: string, scene: Scene, ids: string[] = []) => conductor(k.ctx, { utterance, scene, history: [], dropped: ids });

  assert.deepEqual((await conduct('Make me a new tree about Stanley Kubrick.', { focus: f.dolly, selection: [] })).intent, { kind: 'tree', subject: 'Stanley Kubrick', itemIds: [] });
  assert.deepEqual((await conduct('start a tree on this', { focus: f.dolly, selection: [] }, [dropped.id])).intent, { kind: 'tree', subject: '', itemIds: [dropped.id] });
  assert.deepEqual((await conduct('start a tree on this', { focus: f.dolly, selection: [] })).intent, { kind: 'tree', subject: '', itemIds: [k.mind.node(f.dolly).itemId] });
  const lost = await conduct('make a tree from this', { selection: [] });
  assert.deepEqual([lost.intent.kind, lost.say], ['reply', 'What should the tree be about?']);
  assert.deepEqual(k.model.calls, []);
});

test('a tree asked for in other words is the model\'s call, and a topic alone with a card open is still a question about it', async () => {
  const k = kit();
  const f = film(k);
  k.model.on('conductor', (req) => (/Hitchcock/.test(req.user) ? { ...EMPTY, kind: 'tree', text: "Hitchcock's films", say: 'Starting it.' } : { ...EMPTY, kind: 'ask', need: 'soundtracks for this', say: 'Looking.' }));

  assert.deepEqual((await hear(k, "grow me something around Hitchcock's films", { selection: [] })).intent, { kind: 'tree', subject: "Hitchcock's films", itemIds: [] });
  assert.equal((await hear(k, "let's think about the soundtrack", { focus: f.dolly, selection: [] })).intent.kind, 'ask');
  assert.match(k.model.calls[0]!.detail, /Hitchcock/);
});
