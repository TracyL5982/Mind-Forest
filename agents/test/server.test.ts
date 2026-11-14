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

test('the fake service files pasted structure as item data, and brings a museum work or a paper when asked for one', async () => {
  const { run } = await boot();
  const c = await connect(run);
  const settled = async () => {
    await run.pipeline.idle();
    await new Promise((r) => setTimeout(r, 1200));
    await run.pipeline.idle();
  };
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this:\nMoving the service to Rust\nPros: no data races, one binary\nCons: slow builds' }] }));
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
  assert.equal(run.mind.picks(root).length, 4, 'the work is one of the usual picks, not the only one');
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

test('recorded speech is transcribed with the card titles as hints, and the client is told who hears', async () => {
  const asked: { mime: string; context: string }[] = [];
  const { run } = await boot(undefined, {
    transcribe: async (_audio, mime, context) => {
      asked.push({ mime, context });
      return 'undo that, I meant the sourdough tree';
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
  assert.deepEqual(await res.json(), { text: 'undo that, I meant the sourdough tree' });
  assert.equal(asked[0]!.mime, 'audio/webm;codecs=opus');
  assert.match(asked[0]!.context, /sourdough/i);
  c.ws.close();
  await run.close();

  const { run: plain } = await boot();
  const p = await connect(plain);
  assert.equal((await p.until((m) => m.t === 'hello')).hearing, 'browser');
  p.ws.close();
  await plain.close();
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
