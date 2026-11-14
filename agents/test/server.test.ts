import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running, type ServerOptions } from '../src/node/server.ts';
import type { Hints } from '../src/node/speech-openai.ts';

interface Msg {
  t: string;
  [k: string]: unknown;
}

async function boot(dataDir = mkdtempSync(join(tmpdir(), 'mp-')), extra: Partial<ServerOptions> = {}): Promise<{ run: Running; dataDir: string }> {
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir, clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret', ...extra });
  return { run, dataDir };
}

function connect(run: Running, token = 'secret'): Promise<{ ws: WebSocket; seen: Msg[]; until: (pred: (m: Msg) => boolean) => Promise<Msg> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=${token}`);
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

test('a wrong token is refused on the socket and on the API', async () => {
  const { run } = await boot();
  await assert.rejects(connect(run, 'wrong'));
  assert.equal((await fetch(`${run.url}/api/state`)).status, 401);
  assert.equal((await fetch(`${run.url}/api/health`)).status, 200);
  await run.close();
});

test('a dump becomes a tree with dashed picks, a kept pick turns solid, and it all survives a restart', async () => {
  const { run, dataDir } = await boot();
  const c = await connect(run);
  const hello = await c.until((m) => m.t === 'hello');
  assert.equal((hello.snapshot as { nodes: unknown[] }).nodes.length, 0);

  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'The dolly zoom makes dread out of geometry' }] }));
  await run.pipeline.idle();
  await c.until((m) => m.t === 'activity' && (m.activity as { role: string; state: string }).role === 'scout' && (m.activity as { state: string }).state === 'done');
  await run.pipeline.idle();

  assert.equal(run.mind.trees.size, 1);
  const root = [...run.mind.trees.values()][0]!.rootId;
  const picks = run.mind.picks(root);
  assert.equal(picks.length, 4);
  assert.equal(picks.find((p) => p.view.component === 'chart')?.view.by, 'renderer', 'the Renderer upgraded the default view');

  c.ws.send(JSON.stringify({ t: 'keep', nodeIds: [picks[0]!.id] }));
  await c.until((m) => m.t === 'change' && (m.set as { label: string }).label === 'Keep a pick');
  assert.equal(run.mind.node(picks[0]!.id).status, 'kept');

  c.ws.send(JSON.stringify({ t: 'undo' }));
  await c.until((m) => m.t === 'change' && typeof (m.set as { undoes?: string }).undoes === 'string');
  assert.equal(run.mind.node(picks[0]!.id).status, 'pick');

  c.ws.send(JSON.stringify({ t: 'nonsense' }));
  await c.until((m) => m.t === 'error');

  const before = run.mind.snapshot();
  c.ws.close();
  await run.close();
  const again = await boot(dataDir);
  assert.deepEqual(again.run.mind.snapshot(), before);
  await again.run.close();
});

test('an uploaded file is served back with byte ranges, and a handoff downloads as a zip', async () => {
  const { run } = await boot();
  const auth = { Authorization: 'Bearer secret' };
  const up = await fetch(`${run.url}/api/assets?name=a.png`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: new Uint8Array([1, 2, 3, 4, 5]) });
  const { url } = (await up.json()) as { url: string };
  const part = await fetch(`${run.url}${url}`, { headers: { ...auth, Range: 'bytes=1-2' } });
  assert.equal(part.status, 206);
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [2, 3]);

  const c = await connect(run);
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Lenses and how they bend space' }] }));
  await c.until((m) => m.t === 'change');
  c.ws.send(JSON.stringify({ t: 'handoff', scope: { treeIds: [], nodeIds: [] }, note: 'continue this' }));
  const made = await c.until((m) => m.t === 'handoff');
  const zipped = new Uint8Array(await (await fetch(`${run.url}${made.url as string}`, { headers: auth })).arrayBuffer());
  assert.deepEqual([...zipped.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok((made.markdown as string).includes('Lenses'));
  await run.pipeline.idle();
  c.ws.close();
  await run.close();
});

test('speech that settles is acted on once, and the final transcript does not repeat it', async () => {
  const { run } = await boot();
  const c = await connect(run);
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Jaws beach scene' }] }));
  await run.pipeline.idle();
  await c.until((m) => m.t === 'change');
  await run.pipeline.idle();
  const root = [...run.mind.trees.values()][0]!.rootId;
  const scene = { focus: root, selection: [] };
  const before = c.seen.filter((m) => m.t === 'say').length;
  run.pipeline.utter('why does this scene feel so wrong', scene, false);
  await new Promise((r) => setTimeout(r, 1000));
  run.pipeline.utter('why does this scene feel so wrong', scene, true);
  await run.pipeline.idle();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(c.seen.filter((m) => m.t === 'say').length - before, 1);
  c.ws.close();
  await run.close();
});

test('one undo takes back one real change, along with the format choices that followed it', async () => {
  const { run } = await boot();
  const c = await connect(run);
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Rack focus pulls the eye across the frame' }] }));
  await c.until((m) => m.t === 'change');
  await run.pipeline.idle();
  await new Promise((r) => setTimeout(r, 1200));
  await run.pipeline.idle();
  const root = [...run.mind.trees.values()][0]!.rootId;
  assert.equal(run.mind.picks(root).length, 4);
  const last = c.seen.filter((m) => m.t === 'change').at(-1)!;
  assert.equal((last.set as { label: string }).label, 'Choose formats', 'the latest change is housekeeping');
  assert.match(last.undo as string, /^Picks for/, 'but undo names the real change before it');

  c.ws.send(JSON.stringify({ t: 'undo' }));
  await c.until((m) => m.t === 'change' && typeof (m.set as { undoes?: string }).undoes === 'string');
  assert.equal(run.mind.picks(root).length, 0, 'the picks are gone in one press');
  assert.equal(run.mind.trees.size, 1);
  await run.pipeline.idle();
  c.ws.close();
  await run.close();
});

test('a reply is read aloud by the service voice when it has one, and the client is told when it has none', async () => {
  const heard: string[] = [];
  const { run } = await boot(undefined, {
    speak: async (text) => {
      heard.push(text);
      return new Blob([new Uint8Array([1, 2]), new Uint8Array([3])]).stream();
    },
  });
  assert.equal((await fetch(`${run.url}/api/speak?text=hello`)).status, 401);
  const res = await fetch(`${run.url}/api/speak?token=secret&text=${encodeURIComponent('Filed under Japan.')}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(heard, ['Filed under Japan.']);
  const voiced = await connect(run);
  assert.equal((await voiced.until((m) => m.t === 'hello')).voice, true);
  voiced.ws.close();
  await run.close();

  const { run: silent } = await boot();
  const quiet = await connect(silent);
  assert.equal((await quiet.until((m) => m.t === 'hello')).voice, false);
  quiet.ws.close();
  assert.equal((await fetch(`${silent.url}/api/speak?token=secret&text=hello`)).status, 404);
  await silent.close();
});

test('recorded speech is transcribed with the name and the card titles as hints, and the client is told who hears', async () => {
  const asked: { mime: string; hints: Hints }[] = [];
  const { run } = await boot(undefined, {
    transcribe: async (_audio, mime, hints) => {
      asked.push({ mime, hints });
      return 'Hey Momo, undo that, I meant the sourdough tree';
    },
  });
  const c = await connect(run);
  assert.equal((await c.until((m) => m.t === 'hello')).hearing, 'service');
  await run.pipeline.dump([{ kind: 'text', text: 'Sourdough rises slowly in winter' }]);
  await run.pipeline.idle();
  const tree = [...run.mind.trees.values()][0]!;
  const res = await fetch(`${run.url}/api/transcribe?tree=${tree.id}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'audio/webm;codecs=opus' },
    body: new Uint8Array([1, 2, 3]),
  });
  assert.deepEqual(await res.json(), { text: 'Undo that, I meant the sourdough tree' });
  assert.equal(asked[0]!.mime, 'audio/webm;codecs=opus');
  assert.equal(asked[0]!.hints.name, 'Momo');
  assert.match(asked[0]!.hints.words, /sourdough/i);
  c.ws.close();
  await run.close();

  const { run: plain } = await boot();
  const p = await connect(plain);
  assert.equal((await p.until((m) => m.t === 'hello')).hearing, 'browser');
  p.ws.close();
  await plain.close();
});

test('the agent is called Momo until renamed, and a leading "hey" and its name are dropped from what it acts on', async () => {
  const acted: string[] = [];
  const { run } = await boot(undefined, {
    roles: { ...fakeRoles, conductor: async (ctx, input) => (acted.push(input.utterance), fakeRoles.conductor(ctx, input)) },
  });
  const c = await connect(run);
  assert.equal(((await c.until((m) => m.t === 'hello')).settings as { agentName: string }).agentName, 'momo');
  const scene = { selection: [] };
  const said = async (text: string) => {
    c.ws.send(JSON.stringify({ t: 'utter', text, final: true, scene }));
    await new Promise((r) => setTimeout(r, 50));
    await run.pipeline.idle();
  };

  await said('Hey Momo, remember the onsen in Kiso.');
  await said('Hey Momo.');
  c.ws.send(JSON.stringify({ t: 'settings', patch: { agentName: 'Juno' } }));
  assert.equal(((await c.until((m) => m.t === 'settings')).settings as { agentName: string }).agentName, 'Juno');
  await said('hi juno: remember the night train');
  await said('Hey Momo, remember the ferry.');
  assert.deepEqual(acted, ['Remember the onsen in Kiso.', 'Remember the night train', 'Hey Momo, remember the ferry.']);
  assert.deepEqual(c.seen.filter((m) => m.t === 'heard').map((m) => m.text), acted);

  c.ws.send(JSON.stringify({ t: 'settings', patch: { agentName: '  ' } }));
  assert.match(String((await c.until((m) => m.t === 'error')).message), /bad message/);
  const later = await connect(run);
  assert.equal(((await later.until((m) => m.t === 'hello')).settings as { agentName: string }).agentName, 'Juno');
  later.ws.close();
  c.ws.close();
  await run.close();
});
