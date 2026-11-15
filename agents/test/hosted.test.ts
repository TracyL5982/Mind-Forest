import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import type { JsonRequest, ModelClient, Priority } from '../src/core/ports.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startHosted, type Hosted, type HostedOptions } from '../src/node/hosted/hosted.ts';
import { DEFAULT_LIMITS, Ledger, LINES, type Limits } from '../src/node/hosted/ledger.ts';
import { Overflow, Paused } from '../src/node/hosted/overflow.ts';
import type { LiveDeps, VoiceFrame } from '../src/node/live.ts';
import { startServer } from '../src/node/server.ts';

interface Msg {
  t: string;
  [k: string]: unknown;
}

const KEY = 'app-key';
const ADMIN = 'admin-token';
const A = 'device-aaaaaaaaaaaa';
const B = 'device-bbbbbbbbbbbb';

/** A data folder with one tree, made by the service itself, as the starter script's output is. */
async function starterFolder(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'mp-starter-'));
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, clientDir: '', model: new FakeModel(), roles: fakeRoles, token: 'x' });
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
  await run.pipeline.idle();
  await run.close();
  return dir;
}

async function host(limits: Partial<Limits> = {}, extra: Partial<HostedOptions> = {}): Promise<{ hosted: Hosted; ledger: Ledger; dataDir: string; lines: string[] }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-hosted-'));
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: { ...DEFAULT_LIMITS, ...limits } });
  const lines: string[] = [];
  const hosted = await startHosted({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    starter: await starterFolder(),
    appKey: KEY,
    adminToken: ADMIN,
    ledger,
    shared: { clientDir: '', model: new Paused(new FakeModel(), () => ledger.paused()), roles: fakeRoles },
    log: (line) => lines.push(line),
    ...extra,
  });
  return { hosted, ledger, dataDir, lines };
}

function connect(hosted: Hosted, token: string, path = '/ws'): Promise<{ ws: WebSocket; seen: Msg[]; until: (pred: (m: Msg) => boolean) => Promise<Msg> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${hosted.url.replace('http', 'ws')}${path}${path.includes('?') ? '&' : '?'}token=${token}`);
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

const treesOf = (hello: Msg) => (hello.snapshot as { trees: { id: string; title: string; rootId: string }[] }).trees;
const admin = (hosted: Hosted, query = '', method = 'GET') => fetch(`${hosted.url}/admin${query}`, { method, headers: { Authorization: `Bearer ${ADMIN}` } }).then((r) => r.json() as Promise<Record<string, unknown>>);

test('a device needs the app key; two devices get separate spaces, each starting with the starter trees', { timeout: 20000 }, async () => {
  const { hosted, dataDir } = await host();
  assert.equal((await fetch(`${hosted.url}/api/health`)).status, 200, 'the health check needs no key');
  assert.equal((await fetch(`${hosted.url}/api/state?token=wrong.${A}`)).status, 401);
  assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}`)).status, 401, 'a key without a device is refused');
  assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}.short`)).status, 401, 'a device id must be 16 characters or more');
  await assert.rejects(connect(hosted, `wrong.${A}`), /401/);
  assert.equal((await fetch(`${hosted.url}/`)).status, 404, 'the web page is off');
  assert.equal((await fetch(`${hosted.url}/admin`)).status, 401, 'the admin endpoint needs its own token');

  const a = await connect(hosted, `${KEY}.${A}`);
  const helloA = await a.until((m) => m.t === 'hello');
  assert.deepEqual(treesOf(helloA).map((t) => t.title), ['Sourdough rises slowly in winter']);
  a.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: Lighthouses of Maine' }] }));
  await a.until((m) => m.t === 'change' && JSON.stringify(m).includes('Lighthouses of Maine'));

  const b = await connect(hosted, `${KEY}.${B}`);
  const helloB = await b.until((m) => m.t === 'hello');
  assert.deepEqual(treesOf(helloB).map((t) => t.title), ['Sourdough rises slowly in winter'], "B starts with the starter trees and never sees A's");
  assert.ok(existsSync(join(dataDir, 'spaces', A, 'mindstorm.sqlite')) && existsSync(join(dataDir, 'spaces', B, 'mindstorm.sqlite')));
  const status = await admin(hosted);
  assert.equal(status.spaces, 2);
  assert.equal(status.devicesOnline, 2);
  a.ws.close();
  b.ws.close();
  await hosted.close();
});

test('a version 1 client works against hosted mode: the same hello, and every message it sends today', { timeout: 30000 }, async () => {
  const { hosted } = await host();
  const c = await connect(hosted, `${KEY}.${A}`);
  const hello = await c.until((m) => m.t === 'hello');
  for (const field of ['protocol', 'snapshot', 'settings', 'maps', 'undo', 'voice', 'hearing', 'live', 'connection']) assert.ok(field in hello, `hello has ${field}`);
  assert.equal(hello.protocol, 1);
  const root = treesOf(hello)[0]!.rootId;
  const changes = () => c.seen.filter((m) => m.t === 'change').length;

  c.ws.send(JSON.stringify({ t: 'client', media: { embeds: false, files: ['mp4', 'jpg'] } }));
  c.ws.send(JSON.stringify({ t: 'focus', nodeId: root }));
  c.ws.send(JSON.stringify({ t: 'questions', nodeId: root }));
  await c.until((m) => m.t === 'questions' && m.nodeId === root);
  const before = changes();
  c.ws.send(JSON.stringify({ t: 'ask', nodeId: root, need: 'a museum work with bread in it' }));
  await c.until((m) => m.t === 'activity' && (m.activity as { role: string; state: string }).role === 'scout' && (m.activity as { state: string }).state === 'done');
  assert.ok(changes() > before, 'an ask brings picks');
  const pick = (await fetch(`${hosted.url}/api/state?token=${KEY}.${A}`).then((r) => r.json()) as { snapshot: { nodes: { id: string; parent: string | null; status: string }[] } }).snapshot.nodes.find((n) => n.parent === root && n.status === 'pick')!;
  c.ws.send(JSON.stringify({ t: 'keep', nodeIds: [pick.id] }));
  c.ws.send(JSON.stringify({ t: 'more', nodeId: root }));
  c.ws.send(JSON.stringify({ t: 'utter', text: 'go up', final: true, scene: { focus: root, selection: [] } }));
  c.ws.send(JSON.stringify({ t: 'settings', patch: { picksPerRun: 3 } }));
  c.ws.send(JSON.stringify({ t: 'undo' }));
  c.ws.send(JSON.stringify({ t: 'handoff', scope: { treeIds: [], nodeIds: [root] }, note: 'continue' }));
  const handoff = await c.until((m) => m.t === 'handoff');
  const zip = await fetch(`${hosted.url}${handoff.url as string}?token=${KEY}.${A}`);
  assert.equal(zip.status, 200, 'the handoff downloads with the device token');
  const uploaded = await fetch(`${hosted.url}/api/assets?name=note.txt`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}.${A}`, 'Content-Type': 'text/plain' }, body: 'hello' });
  const asset = (await uploaded.json()) as { url: string };
  assert.equal(await (await fetch(`${hosted.url}${asset.url}?token=${KEY}.${A}`)).text(), 'hello', 'an asset is served back by query token');
  assert.equal((await fetch(`${hosted.url}${asset.url}?token=${KEY}.${B}`)).status, 404, "another device's space does not have it");
  assert.deepEqual(c.seen.filter((m) => m.t === 'error'), [], 'no message was refused');
  c.ws.close();
  await hosted.close();
});

test("searches stop at the device's limit with Momo's line, the off switch stops all costly work, and the admin status shows it", { timeout: 20000 }, async () => {
  const { hosted, ledger } = await host({ searches: 1 });
  const c = await connect(hosted, `${KEY}.${A}`);
  const root = treesOf(await c.until((m) => m.t === 'hello'))[0]!.rootId;
  const scoutDone = () => c.seen.filter((m) => m.t === 'activity' && (m.activity as { role: string; state: string }).role === 'scout' && (m.activity as { state: string }).state !== 'start').length;
  c.ws.send(JSON.stringify({ t: 'ask', nodeId: root, need: 'a museum work with bread' }));
  await c.until(() => scoutDone() > 0);
  c.ws.send(JSON.stringify({ t: 'ask', nodeId: root, need: 'a paper on it' }));
  const said = await c.until((m) => m.t === 'say' && m.text === LINES.searches);
  assert.equal(said.yours, true);
  assert.equal(ledger.status().devices[A]?.searches, 1);

  const other = await connect(hosted, `${KEY}.${B}`);
  const otherRoot = treesOf(await other.until((m) => m.t === 'hello'))[0]!.rootId;
  assert.equal((await admin(hosted, '?off=1', 'POST')).off, true);
  other.ws.send(JSON.stringify({ t: 'ask', nodeId: otherRoot, need: 'anything' }));
  await other.until((m) => m.t === 'say' && m.text === LINES.off);
  other.ws.send(JSON.stringify({ t: 'questions', nodeId: otherRoot }));
  await other.until((m) => m.t === 'questions');
  const status = await admin(hosted);
  assert.equal(status.paused, 'off');
  assert.equal(status.devicesOnline, 2);
  assert.equal((await admin(hosted, '?off=0', 'POST')).off, false);
  c.ws.close();
  other.ws.close();
  await hosted.close();
});

test("the voice stops at the device's minutes: the turn is over at once and Momo says so from a recording, with no realtime session", { timeout: 20000 }, async () => {
  let sessions = 0;
  const open: LiveDeps['open'] = () => {
    sessions++;
    return { send: () => {}, close: () => {} };
  };
  const recorded: string[] = [];
  const shared = { clientDir: '', model: new FakeModel(), roles: fakeRoles, live: { open, options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' as const }, hearing: 'gpt-4o-transcribe' } } };
  const again = await host({ voiceMinutes: 0.001 }, { record: async (text) => (recorded.push(text), new Uint8Array(9600)), shared });
  const c = await connect(again.hosted, `${KEY}.${A}`);
  const hello = await c.until((m) => m.t === 'hello');
  assert.equal(hello.live, true);
  const live = await connect(again.hosted, `${KEY}.${A}`, `/live?connection=${hello.connection as string}`);
  await live.until((m) => m.t === 'ready');
  live.ws.send(JSON.stringify({ t: 'start', turn: 1, scene: { selection: [] } }));
  live.ws.send(JSON.stringify({ t: 'audio', pcm: Buffer.alloc(3200).toString('base64') }));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sessions, 1, 'the first turn reaches the realtime model');
  assert.ok((again.ledger.status().devices[A]?.voiceMinutes ?? 0) > 0, 'its audio is counted');

  live.ws.send(JSON.stringify({ t: 'start', turn: 2, scene: { selection: [] } }));
  await live.until((m) => m.t === 'over' && m.turn === 2);
  const text = await live.until((m) => m.t === 'text' && m.text === LINES.voiceMs);
  await live.until((m) => m.t === 'done' && m.id === text.id);
  const audio = live.seen.filter((m): m is Msg & VoiceFrame => m.t === 'audio' && m.id === text.id);
  assert.equal(audio.reduce((n, m) => n + Buffer.from((m as { pcm: string }).pcm, 'base64').length, 0), 9600, 'the recording is sent whole');
  assert.deepEqual(recorded, [LINES.voiceMs]);
  live.ws.send(JSON.stringify({ t: 'audio', pcm: Buffer.alloc(3200).toString('base64') }));
  live.ws.send(JSON.stringify({ t: 'end' }));
  assert.equal(sessions, 1, 'the refused turn opens nothing');
  live.ws.close();
  c.ws.close();
  await again.hosted.close();
});

test('the day starts again at midnight Pacific with the off switch kept, and spend alerts come once at half and at the cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-ledger-'));
  let now = new Date('2026-11-15T20:00:00Z');
  const alerts: string[] = [];
  const make = () => new Ledger({ file: join(dir, 'ledger.json'), limits: { ...DEFAULT_LIMITS, dollarsPerDay: 10, searches: 2 }, now: () => now, alert: (t) => alerts.push(t) });
  const ledger = make();
  ledger.used(A, 'searches', 2);
  assert.equal(ledger.refusal(A, 'searches'), 'searches');
  assert.equal(ledger.refusal(B, 'searches'), null);
  ledger.spend(4);
  ledger.spend(2);
  ledger.spend(1);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0]!, /passed 50% of the \$10 cap/);
  ledger.spend(3.5);
  assert.equal(alerts.length, 2);
  assert.equal(ledger.refusal(B, 'webAnswers'), 'cap');
  ledger.setOff(true);
  ledger.flush();

  const reopened = make();
  assert.equal(reopened.refusal(B, 'voiceMs'), 'off', 'the counts survive a restart');
  reopened.setOff(false);
  assert.equal(reopened.refusal(A, 'searches'), 'cap');
  now = new Date('2026-11-16T07:59:00Z');
  assert.equal(reopened.refusal(A, 'searches'), 'cap', 'still the 15th in San Francisco');
  now = new Date('2026-11-16T08:01:00Z');
  assert.equal(reopened.refusal(A, 'searches'), null, 'a new day');
  assert.equal(reopened.status().spentToday, 0);
});

test("a Scout call goes to OpenAI while Meta's minute is full, and every other call waits for Meta", async () => {
  let free = true;
  const asked: string[] = [];
  const stub = (name: string): ModelClient => ({
    json: async <T,>(req: JsonRequest<T>) => (asked.push(`${name} ${req.role}`), {} as T),
    search: async (req) => (asked.push(`${name} search ${req.role}`), []),
    image: async () => ({ bytes: new Uint8Array(), mime: 'image/png' }),
    transcribe: async () => '',
  });
  const overflowed: string[] = [];
  const model = new Overflow({
    meta: { ...stub('meta'), free: (_: Priority) => free },
    spare: stub('openai'),
    search: async () => (asked.push('openai search'), []),
    overflowed: (role, kind) => overflowed.push(`${kind} ${role}`),
  });
  const req = (role: string) => ({ role, system: '', user: '', schema: {} as never });
  await model.json(req('scout.ideate'));
  free = false;
  await model.json(req('scout.ideate'));
  await model.json(req('scout.rate'));
  await model.json(req('renderer'));
  await model.search({ role: 'tool.web', query: 'x' });
  assert.deepEqual(asked, ['meta scout.ideate', 'openai scout.ideate', 'openai scout.rate', 'meta renderer', 'openai search']);
  assert.deepEqual(overflowed, ['json scout.ideate', 'json scout.rate', 'search tool.web']);
});

test('an idle space closes, and opens again with its trees on its next request', { timeout: 20000 }, async () => {
  const { hosted } = await host({}, { idleMs: 50 });
  const state = () => fetch(`${hosted.url}/api/state?token=${KEY}.${A}`).then((r) => r.json() as Promise<{ snapshot: { trees: unknown[] } }>);
  await fetch(`${hosted.url}/api/assets?name=a.txt`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}.${A}` }, body: 'kept' });
  assert.deepEqual(hosted.open(), [A]);
  const deadline = Date.now() + 5000;
  while (hosted.open().length > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(hosted.open(), [], 'closed once idle');
  assert.equal((await state()).snapshot.trees.length, 1, 'reopened with the starter tree');
  assert.deepEqual(hosted.open(), [A]);
  await hosted.close();
});
