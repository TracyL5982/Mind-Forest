import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import type { JsonRequest } from '../src/core/ports.ts';
import { brief, questions } from '../src/core/roles/questions.ts';
import { AGENT, makeNode } from '../src/core/roles/types.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running } from '../src/node/server.ts';
import { kit } from './kit.ts';

interface Msg {
  t: string;
  [k: string]: unknown;
}

test('the questions are written from the card, where it stands, the cards round it and the conversation', async () => {
  const k = kit();
  const { treeId, nodeIds } = k.seedTree('Film', ['Dread in cinema', 'Dolly zoom', 'Vertigo staircase'], { 'Dolly zoom': 'The camera pulls back while the lens zooms in.' });
  const [, dolly] = nodeIds as [string, string, string];
  k.mind.apply({ origin: { by: 'user' }, label: 'why', commands: [{ type: 'setWhy', id: dolly, why: 'The shot that makes the floor fall away' }] });
  const pick = k.item({ title: 'Hitchcock on the zoom', origin: AGENT('scout') });
  k.mind.apply({ origin: AGENT('scout'), label: 'pick', commands: [{ type: 'addItem', item: pick }, { type: 'addNode', node: makeNode(k.ctx, pick, { treeId, parent: dolly, status: 'pick', why: 'History', origin: AGENT('scout') }) }] });
  const prompts: string[] = [];
  k.model.on('questions', (req) => {
    prompts.push(req.user);
    return { questions: ['How did Spielberg use it in Jaws?', 'Show me the Vertigo staircase shot', 'Dolly zoom on a phone camera?'] };
  });

  const got = await questions(k.ctx, { card: brief(k.mind, dolly), history: [{ who: 'user', text: 'I am shooting a short horror film' }] });

  assert.deepEqual(got, ['How did Spielberg use it in Jaws?', 'Show me the Vertigo staircase shot', 'Dolly zoom on a phone camera?']);
  const [prompt] = prompts as [string];
  for (const part of ['Dolly zoom', 'The camera pulls back while the lens zooms in.', 'The shot that makes the floor fall away', 'Dread in cinema', 'Vertigo staircase', 'Hitchcock on the zoom', 'I am shooting a short horror film']) {
    assert.ok(prompt.includes(part), `the model is told "${part}"`);
  }
});

test('only questions a client can show come back: short, distinct, at most four, never filler', async () => {
  const k = kit();
  const { nodeIds } = k.seedTree('Film', ['Dolly zoom']);
  k.model.on('questions', () => ({
    questions: [
      '1. How did Hitchcock use it?',
      '"Show me Vertigo"',
      'Tell me more about this',
      'How did Hitchcock use it?',
      '',
      'A very long question that goes on and on far past the eight words it was given',
      '- Dolly zoom in Jaws?',
      'Who named the dolly zoom?',
      'Which lens suits it best?',
    ],
  }));
  assert.deepEqual(await questions(k.ctx, { card: brief(k.mind, nodeIds[0]!), history: [] }), [
    'How did Hitchcock use it?',
    'Show me Vertigo',
    'Dolly zoom in Jaws?',
    'Who named the dolly zoom?',
  ]);
});

async function boot(model: FakeModel): Promise<Running> {
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-questions-'));
  return startServer({ port: 0, host: '127.0.0.1', dataDir, clientDir: join(import.meta.dirname, '../client'), model, roles: { ...fakeRoles, questions }, token: 'secret', settings: { scoutOnDump: false } });
}

interface Client {
  ws: WebSocket;
  seen: Msg[];
  /** Asks for a card's questions and resolves with the reply. */
  ask(nodeId: string): Promise<string[]>;
}

function connect(run: Running): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=secret`);
    const seen: Msg[] = [];
    const waiting: ((m: Msg) => void)[] = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as Msg;
      seen.push(m);
      for (const hear of [...waiting]) hear(m);
    });
    const ask = (nodeId: string) =>
      new Promise<string[]>((done) => {
        const hear = (m: Msg) => {
          if (m.t !== 'questions' || m.nodeId !== nodeId) return;
          waiting.splice(waiting.indexOf(hear), 1);
          done(m.questions as string[]);
        };
        waiting.push(hear);
        ws.send(JSON.stringify({ t: 'questions', nodeId }));
      });
    ws.on('open', () => resolve({ ws, seen, ask }));
    ws.on('error', reject);
  });
}

/** A model whose questions name the card and the last thing the user said, so a reply shows what it was written from. */
function scripted(model: FakeModel): FakeModel {
  return model.on('questions', (req: JsonRequest<unknown>) => {
    const card = /The open card: "([^"]+)"/.exec(req.user)![1]!;
    const said = /\nuser: (.+)$/m.exec(req.user)?.[1];
    return { questions: [`Where did ${card} start?`, said ? `And ${said}` : `Who uses ${card}?`] };
  });
}

const calls = (model: FakeModel) => model.calls.filter((c) => c.role === 'questions').length;

/** A tree grown from a dropped thought. A drop alone only joins the knowledge base, so the test asks for the tree, without a word said. */
async function rootOf(run: Running, text: string): Promise<string> {
  const dropped = await run.pipeline.dump([{ kind: 'text', text }]);
  await run.pipeline.idle();
  await run.pipeline.makeTree(text, dropped.items.map((i) => i.id));
  await run.pipeline.idle();
  return [...run.mind.trees.values()].find((t) => run.mind.itemOf(t.rootId).text === text)!.rootId;
}

test('only the connection that asked hears the questions', async () => {
  const model = scripted(new FakeModel());
  const run = await boot(model);
  const root = await rootOf(run, 'Dolly zoom');
  const asker = await connect(run);
  const other = await connect(run);

  assert.deepEqual(await asker.ask(root), ['Where did Dolly zoom start?', 'Who uses Dolly zoom?']);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(other.seen.filter((m) => m.t === 'questions').length, 0, 'the other connection heard nothing');
  assert.deepEqual(await other.ask(root), ['Where did Dolly zoom start?', 'Who uses Dolly zoom?'], 'it hears its own answer when it asks');
  assert.equal(asker.seen.filter((m) => m.t === 'questions').length, 1, 'and the first connection does not hear that one');
  asker.ws.close();
  other.ws.close();
  await run.close();
});

test('the questions are kept until the conversation moves on or the card changes', async () => {
  const model = scripted(new FakeModel());
  const run = await boot(model);
  const dolly = await rootOf(run, 'Dolly zoom');
  const bread = await rootOf(run, 'Sourdough starters');
  const c = await connect(run);

  const first = await c.ask(dolly);
  assert.deepEqual(await c.ask(dolly), first);
  assert.equal(calls(model), 1, 'asked again, the card is answered from what was written');

  c.ws.send(JSON.stringify({ t: 'ask', nodeId: bread, need: 'rye or wheat flour?' }));
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await c.ask(dolly), ['Where did Dolly zoom start?', 'And rye or wheat flour?'], 'what the user asked joins the conversation');
  assert.equal(calls(model), 2);

  c.ws.send(JSON.stringify({ t: 'commands', label: 'Rename', commands: [{ type: 'editItem', id: run.mind.node(dolly).itemId, patch: { title: 'Contra-zoom' } }] }));
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await c.ask(dolly), ['Where did Contra-zoom start?', 'And rye or wheat flour?'], 'a changed card is written for again');
  assert.equal(calls(model), 3);

  while (!c.seen.some((m) => m.t === 'activity' && (m.activity as { role: string; state: string }).role === 'scout' && (m.activity as { state: string }).state === 'done')) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await run.pipeline.idle();
  c.ws.close();
  await run.close();
});

test('a malformed answer gives no questions, the service carries on, and the next open asks again', async () => {
  const model = new FakeModel().on('questions', () => ({ questions: 'not a list' }));
  const run = await boot(model);
  const root = await rootOf(run, 'Dolly zoom');
  const c = await connect(run);

  assert.deepEqual(await c.ask(root), []);
  assert.deepEqual(await c.ask('no-such-card'), []);
  assert.equal(calls(model), 1, 'a card that is not there costs no model call');

  scripted(model);
  assert.deepEqual(await c.ask(root), ['Where did Dolly zoom start?', 'Who uses Dolly zoom?']);
  assert.equal(calls(model), 2, 'the failure was not kept');
  c.ws.close();
  await run.close();
});
