import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { WebSocket } from 'ws';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startHosted, type Hosted, type HostedOptions } from '../src/node/hosted/hosted.ts';
import { judgeBotToken } from '../src/node/hosted/judges.ts';
import { DEFAULT_LIMITS, Ledger, LINES, type Limits } from '../src/node/hosted/ledger.ts';
import { Paused } from '../src/node/hosted/overflow.ts';
import { startServer } from '../src/node/server.ts';
import { ADA, BOT_TOKEN, EVE, FakeBot, type Person, type Sent } from './fake-bot.ts';

const KEY = 'app-key';
const ADMIN = 'admin-token';
const A = 'device-aaaaaaaaaaaa';
const B = 'device-bbbbbbbbbbbb';
const STRANGER = /^This is the Mind Palace bot for headsets\. In your headset, say “Momo, connect my Telegram”/;

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const one of opened.splice(0).reverse()) await one.close().catch(() => {});
});

/** A data folder with one tree, made by the service itself, as the starter script's output is. */
async function starterFolder(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'mp-starter-'));
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, clientDir: '', model: new FakeModel(), roles: fakeRoles, token: 'x' });
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
  await run.pipeline.idle();
  await run.close();
  return dir;
}

interface Stage {
  hosted: Hosted;
  bot: FakeBot;
  ledger: Ledger;
  dataDir: string;
  lines: string[];
  clock: { now: number };
}

/** The hosted service reading the judges' bot at a stand-in for Telegram. */
async function host(limits: Partial<Limits> = {}, extra: Partial<HostedOptions> = {}, dataDir = mkdtempSync(join(tmpdir(), 'mp-judges-')), bot?: FakeBot): Promise<Stage> {
  if (!bot) opened.push((bot = await new FakeBot().start()));
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: { ...DEFAULT_LIMITS, ...limits } });
  const lines: string[] = [];
  const clock = { now: 1_000_000 };
  const hosted = await startHosted({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    starter: await starterFolder(),
    appKey: KEY,
    adminToken: ADMIN,
    ledger,
    shared: { clientDir: '', model: new Paused(new FakeModel(), () => ledger.paused()), roles: fakeRoles },
    judgeBot: { token: BOT_TOKEN, api: bot.url, pollSeconds: 0, conflictMs: 100, retryMs: 20, now: () => clock.now },
    log: (line) => lines.push(line),
    ...extra,
  });
  opened.push(hosted);
  return { hosted, bot, ledger, dataDir, lines, clock };
}

const call = (hosted: Hosted, device: string, path: string, method = 'GET') => fetch(`${hosted.url}${path}`, { method, headers: { Authorization: `Bearer ${KEY}.${device}` } });
const admin = async (hosted: Hosted, path = '', method = 'GET') =>
  (await fetch(`${hosted.url}/admin${path}`, { method, headers: { Authorization: `Bearer ${ADMIN}` } })).json() as Promise<Record<string, unknown>>;

/** The code a headset is given, once the service has reached Telegram. */
async function invite(s: Stage, device: string): Promise<{ link: string; bot: string; code: string }> {
  await s.bot.until(() => s.bot.calls.some((c) => c.method === 'getUpdates'));
  const res = await call(s.hosted, device, '/api/telegram/pair', 'POST');
  assert.equal(res.status, 200);
  return res.json() as Promise<{ link: string; bot: string; code: string }>;
}

async function pair(s: Stage, device: string, who: Person): Promise<void> {
  const after = s.bot.sent.length;
  s.bot.push(who, { text: (await invite(s, device)).code });
  await s.bot.reply(who.id, /^Paired with your headset\./, 'sendMessage', after);
}

/** What the bot sent after the `after`th thing, once it has sent `count` more. */
async function next(bot: FakeBot, after: number, count: number): Promise<Sent[]> {
  await bot.until(() => bot.sent.length >= after + count);
  return bot.sent.slice(after, after + count);
}

/** What the bot sends `who` in answer to one message. */
async function ask(s: Stage, who: Person, fields: Record<string, unknown>, count = 1): Promise<Sent[]> {
  const after = s.bot.sent.length;
  s.bot.push(who, fields);
  const sent = await next(s.bot, after, count);
  assert.deepEqual(sent.map((m) => m.chat), sent.map(() => who.id), 'every answer goes to the chat that asked');
  return sent;
}

const titles = async (hosted: Hosted, device: string) =>
  ((await (await call(hosted, device, '/api/state')).json()) as { snapshot: { items: { title: string }[] } }).snapshot.items.map((i) => i.title);

test('a headset is given a six-digit code and the bot\'s link; the judge who sends the code is paired with that headset, once', { timeout: 20000 }, async () => {
  const s = await host();
  await s.bot.until(() => s.bot.calls.some((c) => c.method === 'getUpdates'));
  assert.deepEqual(await (await call(s.hosted, A, '/api/telegram')).json(), { available: true, ready: true, paired: null });

  assert.match((await ask(s, ADA, { text: 'hello?' }))[0]!.text, STRANGER, 'a chat that is not paired gets one helpful line');
  const before = await titles(s.hosted, A);

  const given = await invite(s, A);
  assert.match(given.code, /^\d{6}$/);
  assert.deepEqual([given.bot, given.link], ['mind_palace_test_bot', `https://t.me/mind_palace_test_bot?start=${given.code}`]);

  const wrong = given.code === '000000' ? '111111' : '000000';
  assert.match((await ask(s, ADA, { text: wrong }))[0]!.text, /^That code did not work\./);
  assert.match((await ask(s, ADA, { text: `${given.code.slice(0, 3)} ${given.code.slice(3)}` }))[0]!.text, /^Paired with your headset\./, 'the code as Momo says it, in two groups');
  assert.equal(((await (await call(s.hosted, A, '/api/telegram')).json()) as { paired: string }).paired, 'Ada Lovelace');

  assert.match((await ask(s, EVE, { text: `/start ${given.code}` }))[0]!.text, /^That code did not work\./, 'a code works once');
  assert.match((await ask(s, EVE, { text: 'list my trees' }))[0]!.text, STRANGER);
  assert.deepEqual(await titles(s.hosted, A), before, 'nothing a stranger sent was added');

  const link = await invite(s, B);
  assert.match((await ask(s, EVE, { text: `/start ${link.code}` }))[0]!.text, /^Paired with your headset\./, 'the deep link pairs as the typed code does');
  assert.deepEqual((await admin(s.hosted)).telegram, { bot: 'mind_palace_test_bot', paired: 2 });
});

test('a code lasts ten minutes, a new one replaces the last, and five wrong codes stop a chat\'s codes being read', { timeout: 20000 }, async () => {
  const s = await host();
  const first = await invite(s, A);
  const second = await invite(s, A);
  assert.notEqual(first.code, second.code);
  assert.match((await ask(s, ADA, { text: first.code }))[0]!.text, /^That code did not work\./, 'the replaced code');
  s.clock.now += 10 * 60_000 + 1;
  assert.match((await ask(s, ADA, { text: second.code }))[0]!.text, /^That code did not work\./, 'the expired code');

  const live = await invite(s, A);
  const others = ['111111', '222222', '333333', '444444', '555555'].filter((code) => code !== live.code).slice(0, 4);
  for (const code of others) await ask(s, ADA, { text: code });
  assert.match((await ask(s, ADA, { text: live.code }))[0]!.text, /^That code did not work\./, 'after five wrong codes in ten minutes even a good one is not read');
  assert.equal(((await (await call(s.hosted, A, '/api/telegram')).json()) as { paired: string | null }).paired, null);
  const sent = s.bot.sent.length;
  await s.bot.read(s.bot.push(ADA, { text: 'hello?' }));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(s.bot.sent.length, sent, 'and after six replies in ten minutes the chat is no longer answered');

  s.clock.now += 10 * 60_000 + 1;
  const later = await invite(s, A);
  assert.match((await ask(s, ADA, { text: later.code }))[0]!.text, /^Paired with your headset\./, 'ten minutes on, the chat may try again');
});

test('each judge reaches only their own headset: drops, trees and handoffs stay in its space, whoever asks', { timeout: 30000 }, async () => {
  const s = await host();
  await pair(s, A, ADA);
  await pair(s, B, EVE);

  assert.match((await ask(s, ADA, { text: 'Rye needs more water than wheat' }))[0]!.text, /^Added “/);
  assert.ok((await titles(s.hosted, A)).some((t) => /Rye/.test(t)));
  assert.ok(!(await titles(s.hosted, B)).some((t) => /Rye/.test(t)), 'the other headset has none of it');

  const listed = (await ask(s, EVE, { text: 'list my trees' }))[0]!.text;
  assert.match(listed, /^Your trees, newest first:\n1\. .*Sourdough/);

  const [packing, ready, file] = await ask(s, ADA, { text: 'hand off the sourdough tree' }, 3);
  assert.match(packing!.text, /^Packing “.*Sourdough.*”…$/);
  assert.match(ready!.text, /^Handoff ready: /);
  assert.equal(file!.method, 'sendDocument');
  assert.ok(existsSync(join(s.dataDir, 'spaces', A, 'handoffs', file!.file!)), "the handoff is in the asker's space");
  assert.ok(!existsSync(join(s.dataDir, 'spaces', B, 'handoffs', file!.file!)));

  const sent = s.bot.sent.length;
  const ws = new WebSocket(`${s.hosted.url.replace('http', 'ws')}/ws?token=${KEY}.${B}`);
  await new Promise((ok) => ws.on('open', ok));
  ws.send(JSON.stringify({ t: 'handoff', scope: { treeIds: [], nodeIds: [] } }));
  const fromHeadset = await next(s.bot, sent, 2);
  ws.close();
  assert.deepEqual(fromHeadset.map((m) => [m.chat, m.method]), [[EVE.id, 'sendMessage'], [EVE.id, 'sendDocument']], 'a handoff asked for in the headset comes to its own chat');
});

test('the pairings are on the volume and survive a restart; /unpair and a deleted space end them', { timeout: 30000 }, async () => {
  const s = await host();
  await pair(s, A, ADA);
  await pair(s, B, EVE);
  const file = join(s.dataDir, 'judge-telegram.json');
  const saved = readFileSync(file, 'utf8');
  assert.deepEqual(Object.values((JSON.parse(saved) as { chats: Record<string, { device: string }> }).chats).map((c) => c.device).sort(), [A, B]);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!saved.includes(BOT_TOKEN.split(':')[1]!), 'the token is not saved with the pairings');
  await s.hosted.close();

  const again = await host({}, {}, s.dataDir, s.bot);
  assert.match((await ask(again, ADA, { text: 'list my trees' }))[0]!.text, /^Your trees, newest first:/, 'the chat is still paired, and its space opens for it');
  assert.deepEqual(again.hosted.open(), [A], 'only the space that was written to is open');

  assert.match((await ask(again, ADA, { text: '/unpair' }))[0]!.text, /^Unpaired\./);
  assert.match((await ask(again, ADA, { text: 'list my trees' }))[0]!.text, STRANGER);

  await fetch(`${again.hosted.url}/admin/spaces/${B}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.match((await ask(again, EVE, { text: 'list my trees' }))[0]!.text, STRANGER, "a deleted space's chat is a stranger again");
  assert.ok(!existsSync(join(again.dataDir, 'spaces', B)), 'and its message made no new space');
});

test("a judge's Telegram obeys the headset's limits: the store, the upload room, the voice minutes and the off switch", { timeout: 30000 }, async () => {
  const full = await host({}, { storeLimit: 1 });
  await pair(full, A, ADA);
  const before = await titles(full.hosted, A);
  assert.match((await ask(full, ADA, { text: 'one more note' }))[0]!.text, /mind palace is full/);
  assert.match((await ask(full, ADA, { text: 'hand off the sourdough tree' }, 2))[1]!.text, /mind palace is full/);
  assert.deepEqual(await titles(full.hosted, A), before);
  await full.hosted.close();

  const heard: number[] = [];
  const s = await host({ voiceMinutes: 1 }, { uploads: { file: 1000, total: 1500 }, shared: { clientDir: '', model: new FakeModel(), roles: fakeRoles, transcribe: async (audio) => (heard.push(audio.length), 'list my trees') } });
  await pair(s, A, ADA);
  s.bot.file('big', new Uint8Array(2000));
  s.bot.file('fits', new Uint8Array(900));
  s.bot.file('memo', new Uint8Array(10));
  assert.match((await ask(s, ADA, { document: { file_id: 'big', file_size: 2000, file_name: 'big.bin' } }))[0]!.text, /a file may be at most/);
  assert.ok(!s.bot.calls.some((c) => c.method === 'getFile'), 'a file known to be too large is never fetched');
  assert.match((await ask(s, ADA, { document: { file_id: 'fits', file_size: 900, file_name: 'fits.txt' } }))[0]!.text, /^Added “/);
  assert.match((await ask(s, ADA, { document: { file_id: 'fits', file_name: 'again.txt' } }))[0]!.text, /used all its room for files/, "a second file past the device's room, its size unsaid");

  assert.match((await ask(s, ADA, { voice: { file_id: 'memo', duration: 45 } }))[0]!.text, /^Your trees, newest first:/, 'a voice note asks as text does');
  assert.equal(s.ledger.status().devices[A]?.voiceMinutes, 0.75, 'and its length counts as voice');
  assert.ok((s.ledger.status().devices[A]?.dollars ?? 0) > 0, 'and as spend');
  await ask(s, ADA, { voice: { file_id: 'memo', duration: 30 } });
  assert.equal((await ask(s, ADA, { voice: { file_id: 'memo', duration: 5 } }))[0]!.text, LINES.voiceMs);
  assert.equal(heard.length, 2, 'past the minutes nothing is written out');

  await admin(s.hosted, '?off=1', 'POST');
  assert.equal((await ask(s, ADA, { text: 'another thought' }))[0]!.text, LINES.off);
  assert.equal((await ask(s, ADA, { text: 'hand off the sourdough tree' }, 2))[1]!.text, LINES.off);
});

test("the judges' bot is never the owner's: a judges' token that is the owner's own is refused, and none means no Telegram", async () => {
  const lines: string[] = [];
  assert.equal(judgeBotToken({ TELEGRAM_BOT_TOKEN: 'owner', MIND_PALACE_JUDGE_BOT_TOKEN: 'judges' }, (l) => lines.push(l)), 'judges');
  assert.equal(judgeBotToken({ TELEGRAM_BOT_TOKEN: 'owner' }, (l) => lines.push(l)), undefined);
  assert.equal(lines.length, 0);
  assert.equal(judgeBotToken({ TELEGRAM_BOT_TOKEN: 'owner-token', MIND_PALACE_JUDGE_BOT_TOKEN: ' owner-token ' }, (l) => lines.push(l)), undefined);
  assert.match(lines.join('\n'), /same bot as TELEGRAM_BOT_TOKEN/);
  assert.ok(!lines.join('\n').includes('owner-token'), 'the token is not logged');

  const s = await host({}, { judgeBot: undefined });
  assert.deepEqual(await (await call(s.hosted, A, '/api/telegram')).json(), { available: false, ready: false, paired: null });
  assert.equal((await call(s.hosted, A, '/api/telegram/pair', 'POST')).status, 404);
  assert.deepEqual(s.bot.calls, [], 'with no judges\' bot the service reaches Telegram for nothing');
});
