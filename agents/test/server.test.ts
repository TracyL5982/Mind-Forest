import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { startServer, type Running, type ServerOptions } from '../src/node/server.ts';
import { openaiSpeech, type Hints } from '../src/node/speech-openai.ts';

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

test('a plain dump joins the knowledge base with no tree; asked for a tree it grows one with dashed picks, a kept pick turns solid, and it all survives a restart', async () => {
  const { run, dataDir } = await boot();
  const c = await connect(run);
  const hello = await c.until((m) => m.t === 'hello');
  assert.equal((hello.snapshot as { nodes: unknown[] }).nodes.length, 0);

  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Remember the lens cap' }] }));
  const added = await c.until((m) => m.t === 'change');
  assert.deepEqual((added.set as { patches: { entity: string }[] }).patches.map((p) => p.entity), ['item'], 'the item arrives, and no node');
  await run.pipeline.idle();
  assert.equal(run.mind.trees.size, 0);
  assert.deepEqual(run.mind.unplaced().map((i) => i.title), ['Remember the lens cap']);

  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'The dolly zoom makes dread out of geometry. Start a tree on this.' }] }));
  await run.pipeline.idle();
  await c.until((m) => m.t === 'activity' && (m.activity as { role: string; state: string }).role === 'scout' && (m.activity as { state: string }).state === 'done');
  await run.pipeline.idle();

  assert.equal(run.mind.trees.size, 1);
  const root = [...run.mind.trees.values()][0]!.rootId;
  const picks = run.mind.picks(root);
  assert.equal(picks.length, 4);
  const chart = picks.find((p) => p.view.component === 'chart')!;
  const landed = c.seen
    .flatMap((m) => (m.t === 'change' ? (m.set as { patches: { entity: string; id: string; before: unknown; after: { view: { component: string } } }[] }).patches : []))
    .find((p) => p.entity === 'node' && p.id === chart.id && p.before === null);
  assert.equal(landed?.after.view.component, 'chart', 'the chart pick lands as the chart it stays');

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
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: Lenses and how they bend space' }] }));
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
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: Jaws beach scene' }] }));
  await run.pipeline.idle();
  await c.until((m) => m.t === 'change');
  await run.pipeline.idle();
  const root = [...run.mind.trees.values()][0]!.rootId;
  const scene = { focus: root, selection: [] };
  await c.until((m) => m.t === 'say' && /under Jaws beach scene/.test(String(m.text)));
  const before = c.seen.filter((m) => m.t === 'say').length;
  run.pipeline.utter('why does this scene feel so wrong', scene, false);
  await new Promise((r) => setTimeout(r, 1000));
  run.pipeline.utter('why does this scene feel so wrong', scene, true);
  await run.pipeline.idle();
  await new Promise((r) => setTimeout(r, 50));
  const said = c.seen.filter((m) => m.t === 'say').slice(before).map((m) => String(m.text));
  assert.equal(said.length, 2, `one reply, then one line on what the run brought: ${JSON.stringify(said)}`);
  assert.match(said[1]!, /new things? under|found nothing new/);
  c.ws.close();
  await run.close();
});

test('the fake service files pasted structure as item data, and brings a museum work or a paper when asked for one', async () => {
  const { run } = await boot();
  const c = await connect(run);
  const settled = async () => {
    await run.pipeline.idle();
    await new Promise((r) => setTimeout(r, 1200));
    await run.pipeline.idle();
  };
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this:\nMoving the service to Rust\nPros:\n- no data races\n- one binary\nCons:\n- slow builds' }] }));
  await c.until((m) => m.t === 'change');
  await settled();

  const state = (await (await fetch(`${run.url}/api/state`, { headers: { Authorization: 'Bearer secret' } })).json()) as { snapshot: { items: { title: string; data: Record<string, unknown> }[] } };
  const pasted = state.snapshot.items.find((i) => i.title === 'Moving the service to Rust')!;
  assert.deepEqual(pasted.data, { pros: ['no data races', 'one binary'], cons: ['slow builds'] });

  const root = [...run.mind.trees.values()][0]!.rootId;
  c.ws.send(JSON.stringify({ t: 'ask', nodeId: root, need: 'a museum work with a staircase' }));
  await c.until(() => run.mind.picks(root).some((p) => run.mind.itemOf(p.id).data.kind === 'artwork'));
  const work = run.mind.picks(root).map((p) => run.mind.itemOf(p.id)).find((i) => i.data.kind === 'artwork')!;
  assert.deepEqual(
    { by: work.data.by, date: work.data.date, medium: work.data.medium, holder: work.data.holder },
    { by: 'Ilse Brandt', date: '1928', medium: 'Gelatin silver print', holder: 'The Example Museum of Art' },
  );
  assert.equal(work.kind, 'image');
  assert.equal(run.mind.picks(root).length, 8, 'the work comes with the usual picks, and joins the four already there');
  assert.equal((await fetch(`${run.url}/assets/${work.source.asset}`, { headers: { Authorization: 'Bearer secret' } })).headers.get('content-type'), 'image/svg+xml');

  c.ws.send(JSON.stringify({ t: 'more', nodeId: root, need: 'a research paper on it' }));
  await c.until(() => run.mind.picks(root).some((p) => run.mind.itemOf(p.id).data.kind === 'paper'));
  const paper = run.mind.picks(root).map((p) => run.mind.itemOf(p.id)).find((i) => i.data.kind === 'paper')!;
  assert.deepEqual(paper.data.authors, ['M. Okafor', 'L. Haas', 'R. Itō']);
  assert.equal(paper.data.venue, 'Journal of Example Vision');
  c.ws.close();
  await run.close();
});

test('one undo takes back one real change, along with the format choices that followed it', async () => {
  const { run } = await boot();
  const c = await connect(run);
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: Rack focus pulls the eye across the frame' }] }));
  await c.until((m) => m.t === 'change');
  await run.pipeline.idle();
  await new Promise((r) => setTimeout(r, 1200));
  await run.pipeline.idle();
  const tree = [...run.mind.trees.values()][0]!;
  const root = tree.rootId;
  assert.equal(run.mind.picks(root).length, 4);
  const restyled = c.seen
    .filter((m) => m.t === 'change' && (m.set as { label: string }).label === 'Choose formats')
    .flatMap((m) => (m.set as { patches: { id: string }[] }).patches.map((p) => p.id));
  assert.ok(run.mind.picks(root).every((p) => !restyled.includes(p.id)), 'the picks land in their final look, so no format change follows them');

  const text = 'A rack focus moves the plane of focus from one subject to another during a shot, so the eye follows it without a cut.';
  const item = { id: 'note-rack', kind: 'text', title: 'Rack focus', text, summary: '', tags: [], data: {}, origin: { by: 'user' }, source: { from: 'paste', capturedAt: '2026-11-15T00:00:00.000Z' }, archived: false, revision: 0 };
  const view = { component: 'note', props: {}, by: 'default', composing: true };
  const node = { id: 'node-rack', treeId: tree.id, itemId: item.id, parent: root, status: 'kept', why: '', importance: 0.5, origin: { by: 'user' }, view, order: 9 };
  c.ws.send(JSON.stringify({ t: 'commands', label: 'Add a note', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] }));
  const settled = await c.until((m) => (m.t === 'change' && (m.set as { label: string; patches: { id: string }[] }).label === 'Choose formats' && (m.set as { patches: { id: string }[] }).patches.some((p) => p.id === 'node-rack')) || m.t === 'error');
  assert.equal(settled.t, 'change', JSON.stringify(settled));
  assert.equal(run.mind.node('node-rack').view.composing, undefined, 'the composing note lands');
  const last = c.seen.filter((m) => m.t === 'change').at(-1)!;
  assert.equal((last.set as { label: string }).label, 'Choose formats', 'the latest change is housekeeping');
  assert.equal(last.undo, 'Add a note', 'but undo names the real change before it');
  c.ws.send(JSON.stringify({ t: 'undo' }));
  await c.until((m) => m.t === 'change' && typeof (m.set as { undoes?: string }).undoes === 'string');
  assert.equal(run.mind.nodes.has('node-rack'), false, 'the note is gone in one press, with its format');

  c.ws.send(JSON.stringify({ t: 'undo' }));
  await c.until((m) => m.t === 'change' && (m.set as { undoes?: string }).undoes !== undefined && run.mind.picks(root).length === 0);
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
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
  await run.pipeline.idle();
  const tree = [...run.mind.trees.values()][0]!;
  const res = await fetch(`${run.url}/api/transcribe?tree=${tree.id}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'audio/webm;codecs=opus' },
    body: new Uint8Array([1, 2, 3]),
  });
  assert.deepEqual(await res.json(), { text: 'Undo that, I meant the sourdough tree', named: true });
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

test('a recording that a wake began is made nothing of unless it begins with the name; one the user began by hand is taken as it is', async () => {
  let heard = '';
  const { run } = await boot(undefined, { transcribe: async () => heard });
  const post = async (query: string) => (await fetch(`${run.url}/api/transcribe${query}`, { method: 'POST', headers: { Authorization: 'Bearer secret', 'Content-Type': 'audio/wav' }, body: new Uint8Array([1, 2, 3]) })).json();
  heard = 'Hey mama, are you coming tonight?';
  assert.deepEqual(await post('?woke=1'), { text: '', named: false }, 'the spotter woke on what only sounded like the name');
  assert.deepEqual(await post(''), { text: 'Hey mama, are you coming tonight?', named: true }, 'a press of the microphone needs no name');
  heard = 'Hi, Mo-mo. Show me more like this.';
  assert.deepEqual(await post('?woke=1&tree=t1'), { text: 'Show me more like this.', named: true });
  heard = 'So I said to her, and then she said, well, hey Momo is a funny name for it.';
  assert.deepEqual(await post('?woke=1'), { text: '', named: false }, 'the name far into the recording is not what woke it');
  await run.close();
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

test('a spoken reply that OpenAI never starts answering is given up', { timeout: 2000 }, async () => {
  const stalled: typeof fetch = (_url, init) => new Promise((_, failed) => init!.signal!.addEventListener('abort', () => failed(init!.signal!.reason)));
  const speak = openaiSpeech(stalled, { apiKey: 'key', firstByteMs: 50 });
  const started = Date.now();
  await assert.rejects(speak('Looking into that.', new AbortController().signal), /did not answer in time/);
  assert.ok(Date.now() - started < 1000);
});

test('a linked file and a linked remote file are streamed through the service, by byte range, with the token', async () => {
  const bytes = new Uint8Array(Array.from({ length: 64 }, (_v, i) => i));
  const remote = createServer((req, res) => {
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '') ?? [];
    if (!from) {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': bytes.length });
      return void res.end(bytes);
    }
    res.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${from}-${to}/${bytes.length}`, 'Accept-Ranges': 'bytes' });
    res.end(bytes.subarray(Number(from), Number(to) + 1));
  });
  await new Promise<void>((ready) => remote.listen(0, '127.0.0.1', ready));
  const port = (remote.address() as { port: number }).port;
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-'));
  const films = join(dataDir, 'films');
  mkdirSync(films);
  const file = join(films, 'clip.mp4');
  writeFileSync(file, bytes);
  const assets = new DiskAssets(join(dataDir, 'assets'), '', films);
  const film = await assets.link(file, 'video/mp4');
  const episode = await assets.link(`http://127.0.0.1:${port}/episode.mp3`, 'audio/mpeg');
  const { run } = await boot(dataDir, { films });

  assert.equal((await fetch(`${run.url}${assets.url(film.id)}`)).status, 401);
  const whole = await fetch(`${run.url}${assets.url(film.id)}?token=secret`);
  assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(new Uint8Array(await whole.arrayBuffer()), bytes);
  const part = await fetch(`${run.url}${assets.url(film.id)}?token=secret`, { headers: { Range: 'bytes=10-13' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-13/64');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [10, 11, 12, 13]);

  const relayed = await fetch(`${run.url}${assets.url(episode.id)}?token=secret`, { headers: { Range: 'bytes=60-63' } });
  assert.equal(relayed.status, 206);
  assert.equal(relayed.headers.get('content-range'), 'bytes 60-63/64');
  assert.deepEqual([...new Uint8Array(await relayed.arrayBuffer())], [60, 61, 62, 63]);
  assert.equal(await assets.get(episode.id), null, 'a remote file is never copied into the service');
  const asked = await fetch(`${run.url}/assets/${encodeURIComponent(`http://127.0.0.1:${port}/episode.mp3`)}?token=secret&url=${encodeURIComponent(`http://127.0.0.1:${port}/episode.mp3`)}`);
  assert.equal(asked.status, 404, 'an address in the request is never fetched');

  await run.close();
  remote.close();
});

test('the service knows while a client that cannot show an embedded player is connected', async () => {
  const { run } = await boot();
  const browser = await connect(run);
  browser.ws.send(JSON.stringify({ t: 'client', media: { embeds: true, files: ['mp4', 'webm', 'mp3'] } }));
  const headset = await connect(run);
  headset.ws.send(JSON.stringify({ t: 'client', media: { embeds: false, files: ['mp4', 'mp3'] } }));
  const said = await settled(() => run.pipeline.ctx.playback().embeds === false);
  headset.ws.close();
  const left = await settled(() => run.pipeline.ctx.playback().embeds === true);
  browser.ws.close();
  await run.close();

  assert.deepEqual(said, { embeds: false, files: ['mp4', 'mp3'] });
  assert.deepEqual(left, { embeds: true, files: ['mp4', 'webm', 'mp3'] });

  async function settled(done: () => boolean) {
    for (let waited = 0; !done() && waited < 2000; waited += 10) await new Promise((r) => setTimeout(r, 10));
    return run.pipeline.ctx.playback();
  }
});

test('a linked file is served only from the films folder, however its record names it', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-'));
  const films = join(dataDir, 'films');
  mkdirSync(films);
  writeFileSync(join(films, 'clip.mp4'), 'film');
  writeFileSync(join(dataDir, 'secret.txt'), 'not for clients');
  const assets = new DiskAssets(join(dataDir, 'assets'), '', films);
  await assert.rejects(assets.link(join(dataDir, 'secret.txt'), 'video/mp4'), /films/);
  await assert.rejects(assets.link(join(films, '../secret.txt'), 'video/mp4'), /films/);
  const film = await assets.link(join(films, 'clip.mp4'), 'video/mp4');
  const record = join(dataDir, 'assets', readdirSync(join(dataDir, 'assets')).find((f) => f.endsWith('.json'))!);
  writeFileSync(record, readFileSync(record, 'utf8').replace(join(films, 'clip.mp4'), join(films, '../secret.txt')));
  const { run } = await boot(dataDir, { films });

  const res = await fetch(`${run.url}${assets.url(film.id)}?token=secret`);

  assert.equal(res.status, 404);
  await run.close();
});

test('the seq a client receives rises by exactly one from hello, also across changes that changed nothing', async () => {
  const { run } = await boot();
  const c = await connect(run);
  const hello = await c.until((m) => m.t === 'hello');
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Rack focus pulls the eye across the frame' }]);
  await run.pipeline.idle();
  const tree = [...run.mind.trees.values()][0]!;
  const rename = (title: string) => c.ws.send(JSON.stringify({ t: 'commands', label: 'Rename', commands: [{ type: 'renameTree', id: tree.id, title }] }));
  rename('Focus');
  rename('Focus');
  rename('Rack focus');
  await c.until((m) => m.t === 'change' && (m.set as { patches: { after: { title?: string } }[] }).patches.some((p) => p.after?.title === 'Rack focus'));
  await run.pipeline.idle();
  c.ws.close();
  await run.close();

  const seqs = c.seen.filter((m) => m.t === 'change').map((m) => (m.set as { seq: number }).seq);
  const from = (hello.snapshot as { seq: number }).seq;
  assert.deepEqual(seqs, seqs.map((_s, i) => from + 1 + i));
});

test('a change is marked yours only on the connection whose request made it, so a client can tell the tree it asked for from one asked for elsewhere', { timeout: 20000 }, async () => {
  const { run } = await boot();
  const headset = await connect(run);
  const page = await connect(run);
  const createsTree = (m: Msg) => m.t === 'change' && (m.set as { patches: { entity: string; before: unknown }[] }).patches.some((p) => p.entity === 'tree' && p.before === null);
  const trees = (c: { seen: Msg[] }) => c.seen.filter(createsTree);
  const until = async (n: number) => {
    while (trees(headset).length < n || trees(page).length < n) await new Promise((r) => setTimeout(r, 20));
  };

  headset.ws.send(JSON.stringify({ t: 'utter', text: 'Hey Momo, make a tree about dolly zooms', final: true, scene: { selection: [] } }));
  await until(1);
  await run.pipeline.idle();
  page.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: the long take in Children of Men' }] }));
  await until(2);
  await run.pipeline.idle();
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: rack focus' }]);
  await until(3);
  await run.pipeline.idle();

  assert.equal(run.mind.trees.size, 3);
  assert.deepEqual(trees(headset).map((m) => m.yours), [true, undefined, undefined], 'the headset asked for the first tree alone');
  assert.deepEqual(trees(page).map((m) => m.yours), [undefined, true, undefined], 'the page asked for the second alone');
  headset.ws.close();
  page.ws.close();
  await run.close();
});

test('the navigate that ends a run is marked yours only on the connection that asked for the run, so the headset is not moved by a run asked for on the web page', { timeout: 20000 }, async () => {
  const { run } = await boot();
  const headset = await connect(run);
  const page = await connect(run);
  try {
    const navigates = (c: { seen: Msg[] }) => c.seen.filter((m) => m.t === 'navigate');
    page.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: the long take in Children of Men' }] }));
    for (let i = 0; i < 500 && (navigates(page).length < 1 || navigates(headset).length < 1); i++) await new Promise((r) => setTimeout(r, 20));
    await run.pipeline.idle();
    assert.deepEqual(navigates(page).map((m) => m.yours), [true], 'the page asked for the tree whose first round brought the card into view');
    assert.deepEqual(navigates(headset).map((m) => m.yours), [undefined], 'the headset hears it unmarked');
  } finally {
    headset.ws.close();
    page.ws.close();
    await run.close();
  }
});

for (const [asker, ask] of [
  ['the web page', (page: { ws: WebSocket }) => page.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: the long take in Children of Men' }] }))],
  ['Telegram', (_page: unknown, run: Running) => void run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: the long take in Children of Men' }])],
] as const) {
  test(`a first round asked for on ${asker} that waits for a headset round to end is still marked yours only where it was asked`, { timeout: 20000 }, async () => {
    const slow = { ...fakeRoles, scout: async (...args: Parameters<typeof fakeRoles.scout>) => (await new Promise((r) => setTimeout(r, 400)), fakeRoles.scout(...args)) };
    const { run } = await boot(undefined, { roles: slow });
    const headset = await connect(run);
    const page = await connect(run);
    const trees = async (n: number) => {
      while (run.mind.trees.size < n) await new Promise((r) => setTimeout(r, 5));
    };
    try {
      headset.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: dolly zooms' }] }));
      await trees(1);
      page.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: rack focus' }] }));
      await trees(2);
      ask(page, run);
      await trees(3);
      await run.pipeline.idle();
      const told = (m: Msg) => m.t === 'say' && String(m.text).includes('the long take');
      await Promise.all([headset.until(told), page.until(told)]);
      const navigates = (c: { seen: Msg[] }) => c.seen.filter((m) => m.t === 'navigate').map((m) => ({ to: run.mind.itemOf(m.nodeId as string).title, yours: m.yours }));
      const last = { to: 'the long take in Children of Men', yours: undefined };
      assert.deepEqual(navigates(headset), [last], 'the headset round that ended first does not lend the queued round its connection');
      assert.deepEqual(navigates(page), [{ ...last, yours: asker === 'the web page' ? true : undefined }]);
    } finally {
      headset.ws.close();
      page.ws.close();
      await run.close();
    }
  });
}
