import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import { WebSocket } from 'ws';
import type { Found, JsonRequest, ModelClient, Priority, Tools } from '../src/core/ports.ts';
import type { Roles } from '../src/core/roles/types.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { MIN_FREE_BYTES, PICTURE_DOLLARS, RECORDED_LINES, SET_BYTES, spaceOptions, startHosted, telegramAlert, upgradeWhenOpen, type Hosted, type HostedOptions } from '../src/node/hosted/hosted.ts';
import { DEFAULT_LIMITS, forDevice, Ledger, LINES, type Limits } from '../src/node/hosted/ledger.ts';
import { Overflow, Paused } from '../src/node/hosted/overflow.ts';
import { LiveVoice, type LiveDeps, type VoiceFrame } from '../src/node/live.ts';
import { SEARCH_DOLLARS } from '../src/node/search-openai.ts';
import { questWavMs } from '../src/node/speech-openai.ts';
import { chargedPictures, startServer, STORE_FULL, type Space } from '../src/node/server.ts';
import { makeSources } from '../src/node/sources.ts';
import { ADA, BOT_TOKEN, FakeBot } from './fake-bot.ts';
import { MemoryAssets } from './kit.ts';
import { SqliteStore } from '../src/node/store.ts';
import { EDIT_BYTES, storedBytes, type Command } from '../src/core/domain.ts';
import { followingIn, InstagramLibrary, openInstagram, parseList } from '../src/node/instagram.ts';
import { tempDir } from './temp.ts';
import { DemoScript } from '../src/demo/script.ts';
import { loadShowcase } from '../src/demo/showcase.ts';
import { recordingName, recordingOf } from '../src/demo/lines.ts';

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
  const dir = tempDir('mp-starter-');
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, clientDir: '', model: new FakeModel(), roles: fakeRoles, token: 'x' });
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
  await run.pipeline.idle();
  await run.close();
  return dir;
}

async function host(limits: Partial<Limits> = {}, extra: Partial<HostedOptions> = {}): Promise<{ hosted: Hosted; ledger: Ledger; dataDir: string; lines: string[] }> {
  const dataDir = tempDir('mp-hosted-');
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

/** The promise, or a failure after `ms`, so a test that waits for a reply that never comes fails instead of holding the run open. */
const soon = <T,>(promise: Promise<T>, ms = 8000): Promise<T> =>
  Promise.race([promise, new Promise<never>((_done, fail) => setTimeout(() => fail(new Error(`nothing came in ${ms} ms`)), ms).unref())]);

/** Resolves once `check` holds, looked at every 10 ms, or fails after `ms`. */
const holds = (check: () => unknown, ms = 8000): Promise<void> =>
  new Promise((done, fail) => {
    const by = Date.now() + ms;
    const look = (): void => void (check() ? done() : Date.now() > by ? fail(new Error(`it did not hold in ${ms} ms`)) : setTimeout(look, 10).unref());
    look();
  });

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
  const empty = tempDir('mp-empty-');
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
  // A lesson of the welcome walk is Momo's voice too: past the minutes it gets no answer, and the device says the lesson's own line.
  live.ws.send(JSON.stringify({ t: 'lesson', turn: 3, words: 'What is she holding?', picture: 'A woman reads a letter.', cards: [] }));
  await live.until((m) => m.t === 'quiet' && m.turn === 3);
  assert.equal(sessions, 1, 'the refused lesson opens nothing');
  assert.deepEqual(recorded, [LINES.voiceMs], 'and no reason is said over the lesson');
  live.ws.close();
  c.ws.close();
  await again.hosted.close();
});

test('the day starts again at midnight Pacific with the off switch kept, and a cap, when one is set, refuses costly work and is told once', () => {
  const dir = tempDir('mp-ledger-');
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
  assert.equal(alerts.length, 0, 'under $25, nothing is told');
  ledger.spend(3.5);
  ledger.spend(1);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0]!, /reached the \$10 cap/);
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
  const dataDir = tempDir('mp-hosted-');
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
  const dataDir = tempDir('mp-hosted-');
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

test("every line the hosted service says itself is recorded in Momo's realtime voice, as written now, and the image ships each recording", () => {
  const demo = join(import.meta.dirname, '../demo');
  const lines = JSON.parse(readFileSync(join(demo, 'lines.json'), 'utf8')) as { voice: string; said: Record<string, string> };
  const voices = JSON.parse(readFileSync(join(demo, 'voice', 'voices.json'), 'utf8')) as Record<string, string>;
  const dockerfile = readFileSync(join(import.meta.dirname, '../Dockerfile'), 'utf8');
  const shipped = dockerfile.split('\n').filter((line) => line.startsWith('COPY ') && line.trim().endsWith(' ./demo/voice/')).flatMap((line) => line.split(/\s+/).slice(1, -1));
  const ignore = readFileSync(join(import.meta.dirname, '../.dockerignore'), 'utf8').split('\n');
  assert.deepEqual(Object.values(RECORDED_LINES).sort(), [...new Set([...Object.values(LINES).filter((line) => line !== LINES.webAnswers), STORE_FULL])].concat(RECORDED_LINES.volumeFull!).sort(), 'every refusal said aloud: the limits but the web answers, which Momo says in her own words, and a full space');
  for (const [key, text] of Object.entries(RECORDED_LINES)) {
    assert.equal(lines.said[key], text, `${key}: lines.json has the words as the service says them`);
    const name = recordingName(lines.voice, text);
    assert.equal(voices[name], 'realtime', `${key}: recorded in her realtime voice`);
    assert.ok(recordingOf(demo, text), `${key}: its recording is there`);
    assert.ok(shipped.includes(`demo/voice/${name}`) && ignore.includes(`!demo/voice/${name}`), `${key}: the image ships ${name}`);
  }
});

test("a refusal is said from its recording, its caption timed to it; words with no recording are shown alone, with no other voice", { timeout: 30000 }, async () => {
  const demo = join(import.meta.dirname, '../demo');
  const asked: string[] = [];
  const shared = { clientDir: '', model: new FakeModel(), roles: fakeRoles, live: { open: (() => ({ send: () => {}, close: () => {} })) as LiveDeps['open'], options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' as const }, hearing: 'gpt-4o-transcribe' } } };
  // As main.ts gives it: the demo folder's recording of the words, or none. First the words are ones changed since they were recorded.
  let words = (text: string) => `${text} (changed)`;
  const record = async (text: string) => {
    asked.push(text);
    const pcm = recordingOf(demo, words(text));
    if (!pcm) throw new Error('no recording');
    return pcm;
  };
  const { hosted, ledger } = await host({}, { shared, record });
  try {
    const c = await connect(hosted, `${KEY}.${A}`);
    const hello = await c.until((m) => m.t === 'hello');
    const live = await connect(hosted, `${KEY}.${A}`, `/live?connection=${hello.connection as string}`);
    await live.until((m) => m.t === 'ready');
    ledger.setOff(true);

    // Words with no recording: shown for as long as they take to read, with no sound.
    live.ws.send(JSON.stringify({ t: 'start', turn: 1, scene: { selection: [] } }));
    const bare = await live.until((m) => m.t === 'text' && m.text === LINES.off);
    const at = Date.now();
    await soon(live.until((m) => m.t === 'done' && m.id === bare.id), 15000);
    assert.equal(live.seen.filter((m) => m.t === 'audio' && m.id === bare.id).length, 0, 'no sound at all');
    assert.ok((bare.ms as number) >= 1500 && Date.now() - at >= (bare.ms as number) - 200, 'the words stay up as long as they take to read');

    // Its recording: said whole, the caption told how long it is and that it starts at its start.
    words = (text) => text;
    live.ws.send(JSON.stringify({ t: 'end' }));
    live.ws.send(JSON.stringify({ t: 'start', turn: 2, scene: { selection: [] } }));
    const text = await live.until((m) => m.t === 'text' && m.id !== bare.id && m.text === LINES.off);
    await live.until((m) => m.t === 'done' && m.id === text.id);
    const sound = live.seen.filter((m) => m.t === 'audio' && m.id === text.id).reduce((n, m) => n + Buffer.from(m.pcm as string, 'base64').length, 0);
    assert.equal(sound, recordingOf(demo, LINES.off)!.length, 'the recording, whole');
    assert.deepEqual([text.ms, text.from], [Math.round(sound / 48), 0]);
    assert.deepEqual(asked, [LINES.off, LINES.off]);
    for (const ws of [live.ws, c.ws]) ws.close();
  } finally {
    await hosted.close();
  }
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
  const dataDir = tempDir('mp-ledger-');
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: DEFAULT_LIMITS });
  const meter = {
    refused: () => null,
    used: () => {},
    spent: (d: number) => ledger.spend(d, A),
    paused: () => (ledger.paused() ? LINES.off : null),
    pictured: () => ledger.spend(PICTURE_DOLLARS, A),
    held: () => null,
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
  const dataDir = tempDir('mp-hosted-');
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

test("every hosted space searches one Instagram library through its own view, and no space opens or reads its own", { timeout: 20000 }, async () => {
  const listFile = join(tempDir('mp-list-'), 'following.md');
  writeFileSync(listFile, '# Accounts\n\n## Art (1)\n\n### Prints (1)\n\n- @ink_and_paper — Ink and Paper — Illustration studio — https://www.instagram.com/ink_and_paper/\n');
  const libDir = tempDir('mp-library-');
  const library = new InstagramLibrary(libDir, parseList(readFileSync(listFile, 'utf8')));
  library.keep(library.accounts[0]!, { state: 'read', at: new Date().toISOString(), posts: [{ id: '17900000000000001', caption: 'A risograph print of the harbour', type: 'image', at: '2026-11-14T10:00:00Z', url: 'https://www.instagram.com/p/17900000000000001/' }] });
  writeFileSync(library.picture('17900000000000001'), new Uint8Array([0xff, 0xd8, 0xff]));

  const a = new MemoryAssets();
  const b = new MemoryAssets();
  const [inA, inB] = [followingIn(library, a), followingIn(library, b)];
  const [foundA] = await inA.search('risograph harbour');
  const [foundB] = await inB.search('risograph');
  assert.equal(foundA?.url, 'https://www.instagram.com/p/17900000000000001/');
  assert.ok(a.files.has(foundA!.asset!) && b.files.has(foundB!.asset!), "each space's copy of the picture is in its own assets");
  assert.equal((await inA.search('risograph'))[0]!.asset, foundA!.asset, 'and is not copied again');

  const dataDir = tempDir('mp-hosted-');
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: DEFAULT_LIMITS });
  const instagram = { token: 'ig', userId: '1', list: listFile, read: true };
  const hosted = await startHosted({ port: 0, host: '127.0.0.1', dataDir, appKey: KEY, adminToken: ADMIN, ledger, shared: { clientDir: '', model: new FakeModel(), roles: fakeRoles, instagram }, following: { library }, log: () => {} });
  for (const device of [A, B]) assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}.${device}`)).status, 200);
  for (const device of [A, B]) assert.ok(!existsSync(join(dataDir, 'spaces', device, 'instagram')), `${device} opened no library of its own`);
  assert.deepEqual((await admin(hosted)).instagram, { posts: 1, reading: false });
  await hosted.close();
});

test("a device's commands and drops stop once its mindstorm is at its limit, and a socket message is small", { timeout: 20000 }, async () => {
  const { hosted } = await host({}, { storeLimit: 1 });
  const c = await connect(hosted, `${KEY}.${A}`);
  await c.until((m) => m.t === 'hello');
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'one more note' }] }));
  await c.until((m) => m.t === 'say' && String(m.text).includes('is full'));
  const closed = new Promise<number>((done) => c.ws.on('close', (code) => done(code)));
  c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'x'.repeat(1_200_000) }] }));
  assert.equal(await closed, 1009, 'a message over 1 MB closes the socket');
  await hosted.close();
});

test("a judge's space gets none of the user's own accounts: no Instagram token or user id, no Telegram, and the one shared library", () => {
  const library = new InstagramLibrary(tempDir('mp-library-'), { accounts: [], categories: [] });
  const shared = { clientDir: '/web', model: new FakeModel(), roles: fakeRoles, instagram: { token: 'ig-token', userId: '17841400000', list: '/list.md', read: true }, telegram: { token: 'bot' } } as HostedOptions['shared'];
  const options = spaceOptions({ shared, dataDir: '/data', appKey: KEY, following: { library } }, A);
  assert.equal(options.instagram, undefined, 'no token or user id, and so none of their own posts');
  assert.equal(options.telegram, undefined);
  assert.equal(options.library, library);
  const given = JSON.stringify({ ...options, model: null, roles: null, library: null });
  assert.ok(!given.includes('ig-token') && !given.includes('17841400000'), 'the token and user id are nowhere in what the space gets');
  assert.equal(options.dataDir, join('/data', 'spaces', A));
  assert.equal(options.clientDir, join('/data', 'no-web-page'));
});

test('with no Instagram account on the server, the library opens from the list alone, never calls Instagram, and a space finds its posts and pictures', { timeout: 20000 }, async () => {
  const listFile = join(tempDir('mp-list-'), 'following.md');
  writeFileSync(listFile, '# Accounts\n\n## Art (1)\n\n### Prints (1)\n\n- @ink_and_paper — Ink and Paper — Illustration studio — https://www.instagram.com/ink_and_paper/\n');
  const libDir = tempDir('mp-library-');
  const copied = new InstagramLibrary(libDir, parseList(readFileSync(listFile, 'utf8')));
  copied.keep(copied.accounts[0]!, { state: 'read', at: new Date().toISOString(), posts: [{ id: '17900000000000001', caption: 'A risograph print of the harbour', type: 'image', at: '2026-11-14T10:00:00Z', url: 'https://www.instagram.com/p/17900000000000001/' }] });
  writeFileSync(copied.picture('17900000000000001'), new Uint8Array([0xff, 0xd8, 0xff]));

  const realFetch = globalThis.fetch;
  const instagramCalls: string[] = [];
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('facebook.com') || url.includes('instagram.com')) instagramCalls.push(url);
    return realFetch(input, init);
  };
  let hosted: Hosted | undefined;
  let ws: WebSocket | undefined;
  try {
    const lines: string[] = [];
    const following = openInstagram({ list: listFile, dir: libDir, read: true, log: (line) => lines.push(line) });
    assert.ok(following, 'the library opens with no token or user id');
    assert.equal(following.reader, undefined, 'and has no reader, though reading was asked for');
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /1 posts kept, reading asked for but there is no META_IG_TOKEN and META_IG_USER_ID, so nothing is read/);

    let found: Found | undefined;
    let picture: string | undefined;
    const roles: Roles = {
      ...fakeRoles,
      async scout(ctx, { need }) {
        [found] = await ctx.tools.sources.search('instagram', need ?? '');
        picture = found?.asset && ctx.assets.url(found.asset);
        return [];
      },
    };
    ({ hosted } = await host({}, { shared: { clientDir: '', model: new FakeModel(), roles }, following: { library: following.library } }));
    const c = await connect(hosted, `${KEY}.${A}`);
    ws = c.ws;
    const root = treesOf(await c.until((m) => m.t === 'hello'))[0]!.rootId;
    c.ws.send(JSON.stringify({ t: 'ask', nodeId: root, need: 'risograph harbour' }));
    const scouted = await c.until((m) => m.t === 'activity' && (m.activity as { role: string; state: string }).role === 'scout' && (m.activity as { state: string }).state !== 'start');
    assert.equal((scouted.activity as { state: string }).state, 'done');
    assert.equal(found?.url, 'https://www.instagram.com/p/17900000000000001/', "the space found the account's post");
    const served = new URL(picture!, hosted.url);
    served.searchParams.set('token', `${KEY}.${A}`);
    const got = await fetch(served);
    assert.equal(got.status, 200, "its picture is in the space's own assets");
    assert.deepEqual([...new Uint8Array(await got.arrayBuffer())], [0xff, 0xd8, 0xff]);
    assert.deepEqual((await admin(hosted)).instagram, { posts: 1, reading: false });
    assert.deepEqual(instagramCalls, [], 'Instagram was never called');
  } finally {
    ws?.close();
    await hosted?.close();
    globalThis.fetch = realFetch;
  }
});

test("one message stores at most SET_BYTES however many large cards it touches, and a card's edits stop at EDIT_BYTES", { timeout: 30000 }, async () => {
  const { hosted, dataDir } = await host();
  let ws: WebSocket | undefined;
  try {
    const c = await connect(hosted, `${KEY}.${A}`);
    ws = c.ws;
    await c.until((m) => m.t === 'hello');
    const at = '2026-11-15T00:00:00.000Z';
    const cards = [1, 2, 3, 4];
    const send = (label: string, commands: Command[]) => c.ws.send(JSON.stringify({ t: 'commands', label, commands }));
    const kept = (label: string) => soon(c.until((m) => m.t === 'change' && (m.set as { label: string }).label === label));
    const refused = (pattern: RegExp) => soon(c.until((m) => m.t === 'note' && pattern.test(String(m.message))));
    send('Four cards', cards.flatMap((n): Command[] => [
      { type: 'addItem', item: { id: `item-${n}`, kind: 'text', title: `Card ${n}`, text: 'A card to draw on.', summary: '', tags: [], data: {}, origin: { by: 'user' }, source: { from: 'paste', capturedAt: at }, archived: false, revision: 0 } },
      { type: 'createTree', tree: { id: `tree-${n}`, title: `Card ${n}`, rootId: `node-${n}`, digest: '', createdAt: at }, root: { id: `node-${n}`, treeId: `tree-${n}`, itemId: `item-${n}`, parent: null, status: 'kept', why: '', importance: 1, origin: { by: 'user' }, view: { component: 'note', props: {}, by: 'renderer' }, order: 0 } },
    ]));
    await kept('Four cards');

    // Lines at full precision rather than the headset's four places, as a script would send them: about 17 bytes a number.
    const line = (id: string) => ({ id, kind: 'stroke' as const, points: Array.from({ length: 1024 }, (_v, i) => (i % 997) / 1000 + 0.000123456789012) });
    const fit = Math.floor((EDIT_BYTES - 1) / (storedBytes(line('e-1-00')) + 1));
    for (const n of cards) {
      send(`Draw on ${n}`, Array.from({ length: fit }, (_v, k) => ({ type: 'addEdit', id: `node-${n}`, edit: line(`e-${n}-${k}`) })));
      await kept(`Draw on ${n}`);
    }
    send('One line too many', [{ type: 'addEdit', id: 'node-1', edit: line('e-1-over') }]);
    await refused(/a card's edits come to at most 512 KB/);

    send('Rub out a line on four cards', cards.map((n) => ({ type: 'removeEdit', id: `node-${n}`, editId: `e-${n}-0` })));
    await refused(/one change keeps at most 2\.5 MB, and this one would keep [4-9]\.\d MB/);
    send('Rub out a line on two cards', [1, 2].map((n) => ({ type: 'removeEdit', id: `node-${n}`, editId: `e-${n}-0` })));
    await kept('Rub out a line on two cards');

    const nodes = (await fetch(`${hosted.url}/api/state?token=${KEY}.${A}`).then((r) => r.json()) as { snapshot: { nodes: { id: string; edits?: unknown[] }[] } }).snapshot.nodes;
    const edits = (id: string) => nodes.find((node) => node.id === id)?.edits?.length;
    assert.deepEqual(cards.map((n) => edits(`node-${n}`)), [fit - 1, fit - 1, fit, fit], 'the refused change changed nothing, and the one kept took a line from two cards');
    const store = new SqliteStore(join(dataDir, 'spaces', A, 'mindstorm.sqlite'));
    const largest = Math.max(...store.all().map((set) => storedBytes(set)));
    store.close();
    assert.ok(largest <= SET_BYTES, `no change stored more than SET_BYTES (the largest was ${largest} bytes)`);
  } finally {
    ws?.close();
    await hosted.close();
  }
});

test("a socket that fails while its space opens is heard, and the space then has the socket with only its own listeners", async () => {
  const lines: string[] = [];
  let open!: (space: Space) => void;
  const opening = new Promise<Space>((done) => (open = done));
  const handle = upgradeWhenOpen(() => A, () => opening, (line) => lines.push(line));
  const socket = new PassThrough();
  const own = socket.listenerCount('error');
  handle({ url: `/ws?token=${KEY}.${A}`, headers: {} } as IncomingMessage, socket, Buffer.alloc(0));
  socket.emit('error', new Error('read ECONNRESET'));
  assert.ok(lines.some((line) => line.includes('ECONNRESET')), 'the error was heard while the space opened');
  let listeners = -1;
  open({ upgrade: (_req: IncomingMessage, taken: PassThrough) => (listeners = taken.listenerCount('error')) } as unknown as Space);
  await opening;
  await new Promise((done) => setImmediate(done));
  assert.equal(listeners, own, "the wait's listener is gone when the space takes the socket");
});

test('once a space is at its store limit every message that writes is refused, the voice tools that write too, and handoff zips count', { timeout: 30000 }, async () => {
  let heard: ((event: Record<string, unknown>) => void) | undefined;
  const open: LiveDeps['open'] = (on) => {
    heard = on.event as (event: Record<string, unknown>) => void;
    return { send: () => {}, close: () => {} };
  };
  const live = { open, options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' as const }, hearing: 'gpt-4o-transcribe' } };
  const { hosted, dataDir, lines } = await host({}, { shared: { clientDir: '', model: new FakeModel(), roles: fakeRoles, live }, storeLimit: 5e6 });
  const sockets: WebSocket[] = [];
  try {
    const c = await connect(hosted, `${KEY}.${A}`);
    sockets.push(c.ws);
    const hello = await c.until((m) => m.t === 'hello');
    const root = treesOf(hello)[0]!.rootId;
    const fulls = () => c.seen.filter((m) => m.t === 'say' && String(m.text).includes('is full')).length;
    c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Under the limit, a note is kept' }] }));
    await soon(c.until((m) => m.t === 'change'));
    assert.equal(fulls(), 0);

    writeFileSync(join(dataDir, 'spaces', A, 'handoffs', 'earlier.zip'), new Uint8Array(5e6));
    const writes = [
      { t: 'dump', dumps: [{ kind: 'text', text: 'one more note' }] },
      { t: 'utter', text: 'start a tree on lighthouses', final: true, scene: { focus: root, selection: [] } },
      { t: 'ask', nodeId: root, need: 'a museum work' },
      { t: 'more', nodeId: root },
      { t: 'keep', nodeIds: [root] },
      { t: 'undo' },
      { t: 'commands', label: 'Rename', commands: [{ type: 'renameTree', id: treesOf(hello)[0]!.id, title: 'Renamed' }] },
      { t: 'organize', request: 'group these', scope: { treeIds: [], nodeIds: [root] } },
      { t: 'handoff', scope: { treeIds: [], nodeIds: [root] } },
    ];
    for (const message of writes) c.ws.send(JSON.stringify(message));
    await soon(c.until(() => fulls() === writes.length));
    c.ws.send(JSON.stringify({ t: 'focus', nodeId: root }));
    c.ws.send(JSON.stringify({ t: 'questions', nodeId: root }));
    await soon(c.until((m) => m.t === 'questions'));
    assert.equal(fulls(), writes.length, 'what only reads still works');

    const voice = await connect(hosted, `${KEY}.${A}`, `/live?connection=${hello.connection as string}`);
    sockets.push(voice.ws);
    await voice.until((m) => m.t === 'ready');
    voice.ws.send(JSON.stringify({ t: 'start', turn: 1, scene: { selection: [] } }));
    voice.ws.send(JSON.stringify({ t: 'audio', pcm: Buffer.alloc(3200).toString('base64') }));
    await holds(() => heard);
    heard!({ type: 'response.created', response: { id: 'r1', metadata: { purpose: 'reply' } } });
    heard!({ type: 'response.output_item.added', response_id: 'r1', item: { type: 'function_call', call_id: 'c1', name: 'save_note' } });
    heard!({ type: 'response.function_call_arguments.done', response_id: 'r1', call_id: 'c1', arguments: JSON.stringify({ text: 'remember the harbour' }) });
    heard!({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
    const answered = () => lines.find((line) => line.includes('[live] save_note('));
    await holds(answered);
    assert.match(answered()!, /"error":"This headset's Mind Forest is full/, "Momo's note is refused too");
  } finally {
    for (const ws of sockets) ws.close();
    await hosted.close();
  }
});

test('with the volume nearly full, nothing new is written and no new space is made, while health and reads go on', { timeout: 20000 }, async () => {
  let free = 10 * MIN_FREE_BYTES;
  const { hosted } = await host({}, { freeBytes: () => free });
  let ws: WebSocket | undefined;
  try {
    const c = await connect(hosted, `${KEY}.${A}`);
    ws = c.ws;
    await c.until((m) => m.t === 'hello');
    free = MIN_FREE_BYTES - 1;
    c.ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'a note with no room for it' }] }));
    await soon(c.until((m) => m.t === 'say' && String(m.text).includes('nearly out of room')));
    const upload = await fetch(`${hosted.url}/api/assets?name=note.txt`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}.${A}`, 'Content-Type': 'text/plain' }, body: 'hello' });
    assert.equal(upload.status, 507);
    assert.match(((await upload.json()) as { error: string }).error, /nearly out of room/);
    assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}.${B}`)).status, 507, 'no new space');
    await assert.rejects(connect(hosted, `${KEY}.${B}`), /507/);
    assert.equal((await fetch(`${hosted.url}/api/health`)).status, 200);
    assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}.${A}`)).status, 200, 'a space that is there still opens');
    free = 10 * MIN_FREE_BYTES;
    assert.equal((await fetch(`${hosted.url}/api/state?token=${KEY}.${B}`)).status, 200, 'and with room again, a new one is made');
  } finally {
    ws?.close();
    await hosted.close();
  }
});

test("a hosted space reads a page or picture, or relays a linked file, only from a public address, never this machine's", { timeout: 20000 }, async () => {
  const asked: string[] = [];
  const server = createServer((req, res) => void (asked.push(req.url ?? ''), res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Inside</title>')));
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const inside = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let read: unknown = 'not yet';
  let picture: unknown = 'not yet';
  let linked = '';
  const roles: Roles = {
    ...fakeRoles,
    async scout(ctx) {
      read = await ctx.tools.web.read(`${inside}/page`);
      picture = await ctx.tools.web.picture(`${inside}/picture.jpg`);
      linked = (await ctx.assets.link(`${inside}/episode.mp3`, 'audio/mpeg')).id;
      return [];
    },
  };
  const { hosted } = await host({}, { shared: { clientDir: '', model: new FakeModel(), roles } });
  let ws: WebSocket | undefined;
  try {
    const c = await connect(hosted, `${KEY}.${A}`);
    ws = c.ws;
    const root = treesOf(await c.until((m) => m.t === 'hello'))[0]!.rootId;
    c.ws.send(JSON.stringify({ t: 'ask', nodeId: root, need: 'the page' }));
    await holds(() => read !== 'not yet' && picture !== 'not yet' && linked !== '');
    assert.equal(read, null);
    assert.equal(picture, null);
    assert.equal((await fetch(`${hosted.url}/assets/${linked}?token=${KEY}.${A}`)).status, 502, "a linked file on this machine is not relayed");
    assert.deepEqual(asked, [], 'the service never asked this machine');
  } finally {
    ws?.close();
    await hosted.close();
    server.close();
  }
});

test("each device has a share of the day's tokens and spend, so one judge cannot stop the others, and a judge's words are a few thousand characters", { timeout: 30000 }, async () => {
  let count: (tokens: number) => void = () => {};
  const base = new FakeModel();
  // As main.ts counts Meta's tokens: told after each call, to the device whose work the call is.
  const model: ModelClient = { json: (req) => base.json(req), search: async (req) => (count(3000), base.search(req)), image: (req) => base.image(req), transcribe: (req) => base.transcribe(req) };
  const scouted: string[] = [];
  const roles: Roles = {
    ...fakeRoles,
    async scout(ctx, { need }) {
      await ctx.model.search({ role: 'scout', query: need ?? 'more' });
      scouted.push(need ?? '');
      return [];
    },
  };
  const { hosted, ledger } = await host({ deviceTokens: 5000 }, { shared: { clientDir: '', model, roles } });
  count = (tokens) => ledger.metaTokens(tokens, forDevice.getStore());
  const sockets: WebSocket[] = [];
  try {
    const [a, b] = await Promise.all([connect(hosted, `${KEY}.${A}`), connect(hosted, `${KEY}.${B}`)]);
    sockets.push(a.ws, b.ws);
    const rootA = treesOf(await a.until((m) => m.t === 'hello'))[0]!.rootId;
    const rootB = treesOf(await b.until((m) => m.t === 'hello'))[0]!.rootId;
    for (const need of ['harbours', 'lighthouses']) {
      a.ws.send(JSON.stringify({ t: 'ask', nodeId: rootA, need }));
      await holds(() => scouted.includes(need));
    }
    a.ws.send(JSON.stringify({ t: 'ask', nodeId: rootA, need: 'one more' }));
    await soon(a.until((m) => m.t === 'say' && m.text === LINES.share));
    b.ws.send(JSON.stringify({ t: 'ask', nodeId: rootB, need: 'tide pools' }));
    await holds(() => scouted.includes('tide pools'));
    assert.deepEqual(scouted, ['harbours', 'lighthouses', 'tide pools'], "A's share stopped A alone");
    const devices = ledger.status().devices;
    assert.deepEqual([devices[A]?.tokens, devices[B]?.tokens], [6000, 3000], 'tokens are counted to the device whose work they were');

    a.ws.send(JSON.stringify({ t: 'utter', text: 'x'.repeat(4001), final: true, scene: { selection: [] } }));
    assert.match(String((await soon(a.until((m) => m.t === 'error'))).message), /too_big|at most 4000|<=4000/i, 'words past 4000 characters are refused');
  } finally {
    for (const ws of sockets) ws.close();
    await hosted.close();
  }
});

test("a space's web answers run as its device's work, so their spend is counted to the device", async () => {
  const seen: (string | undefined)[] = [];
  const live = { open: (() => ({ send: () => {}, close: () => {} })) as LiveDeps['open'], options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' as const }, hearing: 'gpt-4o-transcribe' }, webAnswer: async () => (seen.push(forDevice.getStore()), 'An answer.') };
  const options = spaceOptions({ shared: { clientDir: '', model: new FakeModel(), roles: fakeRoles, live }, dataDir: '/data', appKey: KEY }, A);
  assert.equal(await options.live!.webAnswer!('When is low tide?'), 'An answer.');
  assert.deepEqual(seen, [A]);
});

test("the files the service keeps for a device count toward a limit of their own, and its uploads do not", { timeout: 30000 }, async () => {
  const kept: string[] = [];
  const roles: Roles = {
    ...fakeRoles,
    async scout(ctx, { need }) {
      await ctx.assets.put(new Uint8Array(600_000), 'image/jpeg', `${need}.jpg`).then(
        () => kept.push(`kept ${need}`),
        (err: Error) => kept.push(`refused ${need}: ${err.message}`),
      );
      return [];
    },
  };
  const { hosted } = await host({}, { shared: { clientDir: '', model: new FakeModel(), roles }, madeLimit: 1_000_000 });
  let ws: WebSocket | undefined;
  try {
    const c = await connect(hosted, `${KEY}.${A}`);
    ws = c.ws;
    const root = treesOf(await c.until((m) => m.t === 'hello'))[0]!.rootId;
    const ask = async (need: string) => {
      c.ws.send(JSON.stringify({ t: 'ask', nodeId: root, need }));
      await holds(() => kept.some((line) => line.includes(` ${need}`)));
    };
    await ask('harbour');
    const upload = await fetch(`${hosted.url}/api/assets?name=scan.bin`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}.${A}`, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(1_500_000) });
    assert.equal(upload.status, 200, 'an upload is not one of the files the service keeps');
    await ask('lighthouse');
    assert.deepEqual(kept, ['kept harbour', "refused lighthouse: no room to keep lighthouse.jpg: this headset's files come to 1 MB at most"]);
  } finally {
    ws?.close();
    await hosted.close();
  }
});

/**
 * The starter trees built as for the judging service: a demo data folder with one showcase tree, whose pin is the user's own and
 * whose picture is `picture` bytes, made into a starter by `scripts/starter.ts`.
 */
async function starterFromShowcase(picture: number): Promise<string> {
  const show = tempDir('mp-show-');
  mkdirSync(join(show, 'mini', 'media'), { recursive: true });
  writeFileSync(join(show, 'mini', 'media', 'cone.jpg'), new Uint8Array(picture));
  writeFileSync(join(show, 'mini', 'tree.json'), JSON.stringify({
    version: 1, id: 'mini', title: 'Seed spirals', topic: 'Why do seeds grow in spirals?',
    cards: [{ id: 'cone', parent: 'root', kind: 'picture', origin: 'ocean', title: 'Pine cone from above', text: 'The scales run in two sets of spirals.', from: 'Pinterest, your Seed board', href: 'https://www.pinterest.com/pin/1/', image: 'cone.jpg', w: 640, h: 640 }],
  }));
  const data = tempDir('mp-demo-data-');
  const media = tempDir('mp-demo-media-');
  const script = DemoScript.parse({ version: 1, title: 'Walkthrough', topic: 'A walkthrough', phases: [{ id: 'r1', title: 'Round 1', parent: null, head: 'root', cards: [] }] });
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir: data, clientDir: '', model: new FakeModel(), roles: fakeRoles, token: 'x', demo: { script, mediaDir: media, showcase: loadShowcase(show).trees } });
  await run.close();
  const out = join(tempDir('mp-starter-out-'), 'starter');
  execFileSync(process.execPath, ['--no-warnings', '--import', 'tsx', 'scripts/starter.ts', '--from', data, '--trees', '1', '--out', out], { cwd: join(import.meta.dirname, '..'), stdio: 'pipe' });
  return out;
}

test("the starter trees' pictures count toward no headset's limit, and their pins read as Pinterest pins, not as the judge's own", { timeout: 60000 }, async () => {
  const kept: string[] = [];
  const roles: Roles = {
    ...fakeRoles,
    async scout(ctx, { need }) {
      await ctx.assets.put(new Uint8Array(600_000), 'image/jpeg', `${need}.jpg`).then(
        () => kept.push(`kept ${need}`),
        (err: Error) => kept.push(`refused ${need}: ${err.message}`),
      );
      return [];
    },
  };
  // A starter picture of 0.9 MB, in a space that may keep 1 MB: had it counted, no picture of the judge's would fit.
  const starter = await starterFromShowcase(900_000);
  const metas = readdirSync(join(starter, 'assets')).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(starter, 'assets', name), 'utf8')) as { made?: boolean; starter?: boolean });
  assert.ok(metas.length > 0 && metas.every((meta) => meta.made && meta.starter), `the starter marks each of its files: ${JSON.stringify(metas)}`);
  const { hosted } = await host({}, { starter, shared: { clientDir: '', model: new FakeModel(), roles }, madeLimit: 1_000_000 });
  let ws: WebSocket | undefined;
  try {
    const c = await connect(hosted, `${KEY}.${A}`);
    ws = c.ws;
    const hello = await c.until((m) => m.t === 'hello');
    const items = (hello.snapshot as { items: { title: string; text: string; data: Record<string, unknown> }[] }).items;
    const pin = items.find((item) => item.title === 'Pine cone from above')!;
    assert.deepEqual([pin.data.from, (pin.data.credit as { text: string }).text], ['Pinterest', 'Pinterest pin']);
    assert.ok(!/your/i.test(pin.text) && pin.text.endsWith('\n\nPinterest pin'), pin.text);
    const root = treesOf(hello)[0]!.rootId;
    const ask = async (need: string) => {
      c.ws.send(JSON.stringify({ t: 'ask', nodeId: root, need }));
      await holds(() => kept.some((line) => line.includes(` ${need}`)));
    };
    await ask('harbour');
    await ask('lighthouse');
    assert.deepEqual(kept, ['kept harbour', "refused lighthouse: no room to keep lighthouse.jpg: this headset's files come to 1 MB at most"], "the judge's own pictures have the whole limit");
  } finally {
    ws?.close();
    await hosted.close();
  }
});

test('by default the service takes 10 new devices an hour and 20 in all, near the number of judges', { timeout: 60000 }, async () => {
  const { hosted } = await host();
  const device = (n: number) => `device-${String(n).padStart(12, '0')}`;
  try {
    const made = [];
    for (let n = 1; n <= 11; n++) made.push((await fetch(`${hosted.url}/api/state?token=${KEY}.${device(n)}`)).status);
    assert.deepEqual(made, [...Array(10).fill(200), 429], 'the eleventh new device in an hour is refused');
    assert.deepEqual([(await admin(hosted)).maxDevices, (await admin(hosted)).newPerHour], [20, 10]);
  } finally {
    await hosted.close();
  }
});

test("/admin says which limits are on, judging or testing, and every limit's value", { timeout: 20000 }, async () => {
  const judging = await host();
  const testing = await host({ voiceMinutes: null, searches: null, webAnswers: null, deviceDollars: null, deviceTokens: null }, { mode: 'testing' });
  try {
    const [j, t] = [await admin(judging.hosted), await admin(testing.hosted)];
    assert.equal(j.mode, 'judging');
    assert.deepEqual(j.limits, { voiceMinutes: 60, searches: 30, webAnswers: 30, dollarsPerDay: 'none', deviceDollars: 23, deviceTokens: 9_000_000, tokensPerDay: 180_000_000 });
    assert.equal(t.mode, 'testing');
    assert.deepEqual(t.limits, { voiceMinutes: 'none', searches: 'none', webAnswers: 'none', dollarsPerDay: 'none', deviceDollars: 'none', deviceTokens: 'none', tokensPerDay: 180_000_000 });
  } finally {
    await judging.hosted.close();
    await testing.hosted.close();
  }
});
