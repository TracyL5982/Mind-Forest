import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import type { JsonRequest, ModelClient, Priority, Tools } from '../src/core/ports.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { PICTURE_DOLLARS, startHosted, telegramAlert, type Hosted, type HostedOptions } from '../src/node/hosted/hosted.ts';
import { DEFAULT_LIMITS, Ledger, LINES, type Limits } from '../src/node/hosted/ledger.ts';
import { Overflow, Paused } from '../src/node/hosted/overflow.ts';
import { LiveVoice, type LiveDeps, type VoiceFrame } from '../src/node/live.ts';
import { SEARCH_DOLLARS } from '../src/node/search-openai.ts';
import { questWavMs } from '../src/node/speech-openai.ts';
import { chargedPictures, startServer } from '../src/node/server.ts';
import { makeSources } from '../src/node/sources.ts';
import { ADA, BOT_TOKEN, FakeBot } from './fake-bot.ts';

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

/** A PCM WAV of `ms` of 16 kHz mono 16-bit silence, as the Quest records; `byteRate` writes another value in the header's own field. */
function recording(ms: number, byteRate = 32000): Uint8Array<ArrayBuffer> {
  const data = Math.round(ms * 32);
  const wav = new Uint8Array(44 + data);
  const view = new DataView(wav.buffer);
  const tag = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, data, true);
  return wav;
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
  const remove = (device: string) => fetch(`${hosted.url}/admin/spaces/${device}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ADMIN}` } });
  const gone = await remove(B);
  assert.equal(gone.status, 200);
  assert.equal(((await gone.json()) as { spaces: number }).spaces, 1);
  assert.ok(!existsSync(join(dataDir, 'spaces', B)), "a deleted space's folder is gone");
  assert.equal((await remove(B)).status, 404);
  assert.equal((await fetch(`${hosted.url}/admin/spaces/${A}`, { method: 'DELETE' })).status, 401, 'deleting needs the admin token');
  await hosted.close();
});

test('with an empty starter a new space starts with no tree', { timeout: 20000 }, async () => {
  const empty = mkdtempSync(join(tmpdir(), 'mp-empty-'));
  const { hosted } = await host({}, { starter: empty });
  const c = await connect(hosted, `${KEY}.${A}`);
  assert.deepEqual(treesOf(await c.until((m) => m.t === 'hello')), []);
  c.ws.close();
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

test("the hosted service never reads the user's bot, even when handed it, and its alert only sends", { timeout: 20000 }, async () => {
  const bot = await new FakeBot().start();
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-hosted-'));
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: DEFAULT_LIMITS });
  const shared = { clientDir: '', model: new FakeModel(), roles: fakeRoles, telegram: { token: BOT_TOKEN, api: bot.url, pollSeconds: 1 } } as HostedOptions['shared'];
  const hosted = await startHosted({ port: 0, host: '127.0.0.1', dataDir, appKey: KEY, adminToken: ADMIN, ledger, shared, log: () => {} });
  const c = await connect(hosted, `${KEY}.${A}`);
  await c.until((m) => m.t === 'hello');
  assert.equal(((await fetch(`${hosted.url}/api/telegram?token=${KEY}.${A}`).then((r) => r.json())) as { available: boolean }).available, false);
  telegramAlert({ token: BOT_TOKEN, chatId: String(ADA.id), api: bot.url, log: () => {} })('spend passed 50%');
  await bot.reply(ADA.id, /spend passed 50%/);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(bot.calls.map((call) => call.method), ['sendMessage'], 'no getMe and no getUpdates, only the alert');
  c.ws.close();
  await hosted.close();
  await bot.close();
});

test('speech and transcription are refused while off by any spelling of their path, and each call counts as voice and dollars', { timeout: 20000 }, async () => {
  const calls: string[] = [];
  const speak = async () => (calls.push('speak'), new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(new Uint8Array([1, 2, 3])), c.close()) }));
  const transcribe = async () => (calls.push('transcribe'), 'hello');
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-hosted-'));
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: DEFAULT_LIMITS });
  const hosted = await startHosted({ port: 0, host: '127.0.0.1', dataDir, appKey: KEY, adminToken: ADMIN, ledger, shared: { clientDir: '', model: new FakeModel(), roles: fakeRoles, speak, transcribe }, log: () => {} });
  const auth = { Authorization: `Bearer ${KEY}.${A}` };
  const wav = { method: 'POST', headers: { ...auth, 'Content-Type': 'audio/wav' }, body: recording(1000) };

  ledger.setOff(true);
  for (const path of ['/api/speak', '/api/%73peak', '/api/%2573peak', '/api/./speak', '/assets/../api/speak']) {
    const status = (await fetch(`${hosted.url}${path}?text=hello`, { headers: auth })).status;
    assert.ok(status === 429 || status === 404, `${path} answered ${status}`);
  }
  for (const path of ['/api/transcribe', '/api/%74ranscribe']) assert.equal((await fetch(`${hosted.url}${path}`, wav)).status, 429, path);
  assert.deepEqual(calls, [], 'no speech or transcription while off');

  ledger.setOff(false);
  assert.equal((await fetch(`${hosted.url}/api/speak?text=${'a'.repeat(140)}`, { headers: auth })).status, 200);
  assert.equal((await fetch(`${hosted.url}/api/transcribe`, wav)).status, 200);
  assert.deepEqual(calls, ['speak', 'transcribe']);
  const used = ledger.status().devices[A]!;
  assert.equal(used.voiceMinutes, Number(((10_000 + 1000) / 60_000).toFixed(3)), '140 characters said is 10 s, and the recording 1 s');
  assert.ok(used.dollars > 0, 'and both cost');
  await hosted.close();
});

test('a device reaches only its own paths: a decoded or dotted path to the web page or elsewhere is 404', { timeout: 20000 }, async () => {
  const { hosted } = await host();
  for (const path of ['/api/..%2Findex.html', '/api/%2e%2e/index.html', '/api/../client/js/dom.js', '/assets/..%2F..%2Fledger.json']) {
    assert.equal((await fetch(`${hosted.url}${path}?token=${KEY}.${A}`)).status, 404, path);
  }
  assert.equal((await fetch(`${hosted.url}/%61dmin?token=${KEY}.${A}`)).status, 401, 'an encoded /admin is still the admin endpoint, and a device token is not its token');
  await hosted.close();
});

test('uploads are capped per file and per device, new devices per hour, and the status names every device in full', { timeout: 20000 }, async () => {
  const { hosted } = await host({}, { uploads: { file: 1000, total: 1500 }, newPerHour: 2 });
  const upload = (bytes: number) => fetch(`${hosted.url}/api/assets?name=f.bin`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}.${A}` }, body: new Uint8Array(bytes) });
  assert.equal((await upload(2000)).status, 413, 'a file over the limit');
  assert.equal((await upload(1000)).status, 200);
  assert.equal((await upload(800)).status, 413, "over the device's room");
  assert.equal((await upload(400)).status, 200, 'what fits still goes in');
  assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}.${B}`)).status, 200);
  const third = 'device-cccccccccccc';
  assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}.${third}`)).status, 429, 'a third new device in the hour');
  await assert.rejects(connect(hosted, `${KEY}.${third}`), /429/);
  const status = await admin(hosted);
  assert.deepEqual((status.known as string[]).sort(), [A, B]);
  assert.ok((status.open as { device: string }[]).some((s) => s.device === A), 'open spaces by full id');
  await hosted.close();
});

test('a device keeps two voice sockets, and the off switch in the middle of a turn ends it, the answer and the session', { timeout: 20000 }, async () => {
  const shut: number[] = [];
  let sessions = 0;
  const open: LiveDeps['open'] = () => {
    const n = ++sessions;
    return { send: () => {}, close: () => void shut.push(n) };
  };
  const shared = { clientDir: '', model: new FakeModel(), roles: fakeRoles, live: { open, options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' as const }, hearing: 'gpt-4o-transcribe' } } };
  const { hosted, ledger } = await host({}, { shared, record: async () => new Uint8Array(4800) });
  const c = await connect(hosted, `${KEY}.${A}`);
  const hello = await c.until((m) => m.t === 'hello');
  const path = `/live?connection=${hello.connection as string}`;
  const first = await connect(hosted, `${KEY}.${A}`, path);
  const closed = new Promise<number>((done) => first.ws.on('close', (code) => done(code)));
  await connect(hosted, `${KEY}.${A}`, path);
  const live = await connect(hosted, `${KEY}.${A}`, path);
  assert.ok((await closed) > 0, 'the oldest of three is cut off');

  await live.until((m) => m.t === 'ready');
  live.ws.send(JSON.stringify({ t: 'start', turn: 1, scene: { selection: [] } }));
  live.ws.send(JSON.stringify({ t: 'audio', pcm: Buffer.alloc(3200).toString('base64') }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sessions, 1);
  ledger.setOff(true);
  live.ws.send(JSON.stringify({ t: 'audio', pcm: Buffer.alloc(3200).toString('base64') }));
  await live.until((m) => m.t === 'over' && m.turn === 1);
  await live.until((m) => m.t === 'text' && m.text === LINES.off);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(shut, [1], 'the realtime session closes');
  for (const ws of [live.ws, c.ws]) ws.close();
  await hosted.close();
});

test("the Scout's web source on OpenAI is charged", async () => {
  const spent: number[] = [];
  const send = (async (url: string) =>
    String(url).startsWith('https://api.openai.com/') ? new Response(JSON.stringify({ output: [] })) : new Response('', { status: 404 })) as typeof fetch;
  const sources = makeSources({ send, model: new FakeModel(), read: async () => null, keys: { OPENAI_API_KEY: 'k' }, spent: (d) => spent.push(d) });
  await sources.search('web', 'brutalist libraries');
  assert.deepEqual(spent, [SEARCH_DOLLARS]);
});

test('a made picture is charged at the price of one, and none is made while the service is paused', async () => {
  const made: string[] = [];
  const tools = { images: { generate: async (prompt: string) => (made.push(prompt), { asset: 'a.png' }) } } as unknown as Tools;
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-ledger-'));
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: DEFAULT_LIMITS });
  const meter = {
    refused: () => null,
    used: () => {},
    spent: (d: number) => ledger.spend(d, A),
    paused: () => (ledger.paused() ? LINES.off : null),
    pictured: () => ledger.spend(PICTURE_DOLLARS, A),
    recorded: async () => null,
  };
  const charged = chargedPictures(tools, meter);
  await charged.images.generate('a lighthouse');
  assert.equal(ledger.status().devices[A]?.dollars, PICTURE_DOLLARS);
  ledger.setOff(true);
  await assert.rejects(charged.images.generate('another'), new RegExp(LINES.off.slice(0, 20)));
  assert.deepEqual(made, ['a lighthouse']);
  assert.equal(chargedPictures(tools, undefined), tools, 'the Mac makes pictures as before');
});

test("hosted transcription takes only the Quest's own WAV header, and counts it by its length", { timeout: 20000 }, async () => {
  const view = (wav: Uint8Array) => new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(questWavMs(recording(10_000)), 10_000, 'the Quest at 10 s');
  assert.equal(questWavMs(recording(60_000)), 60_000, 'and at 60 s');
  const empty = recording(60_000);
  view(empty).setUint32(40, 0, true);
  view(empty).setUint32(4, 36, true);
  assert.equal(questWavMs(empty), 60_000, 'a data size of 0 counts what follows the header');
  assert.equal(questWavMs(recording(60_000, 0xffffffff)), null, 'a forged byte rate');
  const rate = recording(1000);
  view(rate).setUint32(24, 8000, true);
  assert.equal(questWavMs(rate), null, 'another sample rate');
  const twoFmt = new Uint8Array([...recording(0).subarray(0, 36), ...recording(0).subarray(12, 36), ...recording(1000).subarray(36)]);
  assert.equal(questWavMs(twoFmt), null, 'two fmt chunks');
  const extra = new Uint8Array([...recording(0).subarray(0, 36), ...new TextEncoder().encode('LIST'), 4, 0, 0, 0, 1, 2, 3, 4, ...recording(1000).subarray(36)]);
  assert.equal(questWavMs(extra), null, 'a chunk before the data');
  assert.equal(questWavMs(new Uint8Array(100)), null);

  const transcribe = async () => 'hello';
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-hosted-'));
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: DEFAULT_LIMITS });
  const hosted = await startHosted({ port: 0, host: '127.0.0.1', dataDir, appKey: KEY, adminToken: ADMIN, ledger, shared: { clientDir: '', model: new FakeModel(), roles: fakeRoles, transcribe }, log: () => {} });
  const post = (body: Uint8Array<ArrayBuffer>, type = 'audio/wav') => fetch(`${hosted.url}/api/transcribe`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}.${A}`, 'Content-Type': type }, body });
  assert.equal((await post(empty)).status, 200);
  assert.equal(ledger.status().devices[A]?.voiceMinutes, 1, 'a minute with a data size of 0 is a minute');
  for (const [wav, what] of [[recording(1000, 0xffffffff), 'a forged byte rate'], [rate, 'another rate'], [twoFmt, 'two fmt chunks'], [extra, 'an extra chunk']] as const) {
    assert.equal((await post(new Uint8Array(wav))).status, 415, what);
  }
  assert.equal((await post(recording(1000), 'audio/webm')).status, 415, 'only WAV');
  assert.equal((await post(recording(70_000))).status, 413, 'over about a minute');
  assert.equal(ledger.status().devices[A]?.voiceMinutes, 1, 'nothing refused was counted');
  await hosted.close();
});

test('uploads at once from one device take no more than its room, and stream to disk', { timeout: 20000 }, async () => {
  const { hosted, dataDir } = await host({}, { uploads: { file: 1000, total: 2000 } });
  const files = () => readdirSync(join(dataDir, 'spaces', A, 'assets')).filter((f) => !f.endsWith('.json')).length;
  assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}.${A}`)).status, 200);
  const before = files();
  const streamed = () =>
    fetch(`${hosted.url}/api/assets?name=f.bin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}.${A}` },
      body: new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array(900)), c.close()) }),
      duplex: 'half',
    } as RequestInit);
  const statuses = await Promise.all(Array.from({ length: 10 }, streamed));
  const stored = files() - before;
  assert.ok(stored >= 1 && stored <= 2, `${stored} files stored`);
  assert.equal(statuses.filter((r) => r.status === 200).length, stored);
  assert.ok(statuses.every((r) => [200, 413, 429].includes(r.status)));
  const room = JSON.parse(readFileSync(join(dataDir, 'spaces', A, 'uploads.json'), 'utf8')) as { bytes: number };
  assert.ok(room.bytes <= 2000);
  const over = await fetch(`${hosted.url}/api/assets?name=g.bin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}.${A}` },
    body: new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array(600)), c.enqueue(new Uint8Array(600)), c.close()) }),
    duplex: 'half',
  } as RequestInit);
  assert.equal(over.status, 413, 'a body with no size given is stopped at the limit as it arrives');
  assert.equal(files() - before, stored, 'and nothing of it is kept');
  await hosted.close();
});

test('a damaged uploads.json counts as no uploads, and the space still opens', { timeout: 20000 }, async () => {
  const { hosted, dataDir } = await host({}, { uploads: { file: 1000, total: 2000 } });
  assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}.${A}`)).status, 200);
  await hosted.close();
  writeFileSync(join(dataDir, 'spaces', A, 'uploads.json'), '{"bytes": 12');
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: DEFAULT_LIMITS });
  const again = await startHosted({ port: 0, host: '127.0.0.1', dataDir, appKey: KEY, adminToken: ADMIN, ledger, shared: { clientDir: '', model: new FakeModel(), roles: fakeRoles }, uploads: { file: 1000, total: 2000 }, log: () => {} });
  assert.equal((await fetch(`${again.url}/api/state?token=${KEY}.${A}`)).status, 200);
  await again.close();
});

test("after a cut, the live voice's next session answers its first turn instead of cancelling it", () => {
  const sessions: { sent: { type: string }[]; event: (e: { type: string; [k: string]: unknown }) => void }[] = [];
  const voice = new LiveVoice(
    {
      open: (on) => {
        const s = { sent: [] as { type: string }[], event: on.event };
        sessions.push(s);
        return { send: (e) => void s.sent.push(e), close: () => {} };
      },
      options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' }, hearing: 'gpt-4o-transcribe' },
      name: () => 'Momo',
      words: () => '',
      tools: () => [],
      call: async () => ({}),
      label: () => undefined,
      where: () => 'Nothing is open.',
      cards: () => [],
      nameOf: () => 'this card',
      spoken: () => {},
      activity: () => {},
      log: () => {},
      idleMs: 60_000,
    },
    () => {},
  );
  voice.heard({ t: 'start', turn: 1, scene: { selection: [] } });
  voice.heard({ t: 'end' });
  assert.ok(sessions[0]!.sent.some((e) => e.type === 'response.create'), 'an answer was asked for');
  voice.close();
  voice.heard({ t: 'start', turn: 2, scene: { selection: [] } });
  voice.heard({ t: 'end' });
  sessions[1]!.event({ type: 'response.created', response: { id: 'r2', metadata: { purpose: 'reply' } } });
  assert.deepEqual(sessions[1]!.sent.filter((e) => e.type === 'response.cancel'), [], "the new session's first answer stands");
  voice.close();
});
