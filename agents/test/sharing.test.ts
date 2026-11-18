import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { WebSocket } from 'ws';
import type { Command, Item, Node } from '../src/core/domain.ts';
import { copyOf, plantingOf } from '../src/core/sharing.ts';
import { recordingName } from '../src/demo/lines.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startHosted, type Hosted, type HostedOptions } from '../src/node/hosted/hosted.ts';
import { DEFAULT_LIMITS, Ledger } from '../src/node/hosted/ledger.ts';
import { Paused } from '../src/node/hosted/overflow.ts';
import { SHARE_MS, Shares } from '../src/node/hosted/shares.ts';
import { startServer } from '../src/node/server.ts';
import { ADA, BOT_TOKEN, EVE, FakeBot, type Person } from './fake-bot.ts';
import { tempDir } from './temp.ts';

const KEY = 'app-key';
const A = 'device-aaaaaaaaaaaa';
const B = 'device-bbbbbbbbbbbb';
/** A third person, whose chat with the bot is paired with no headset. */
const ZOE = { id: 777, first_name: 'Zoe' };
const LINE = { text: 'A friend just shared a tree with you. I planted it right here!', pcm: new Uint8Array(48 * 500) };
const PICTURE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
/** The message to forward, which reads right in the friend's chat. A line to the sharer on what to do comes just before it. */
const LINK = /^A friend shared a tree with you in Mind Forest: “(.+)”\. Tap to plant it in your forest: https:\/\/t\.me\/mind_palace_test_bot\?start=share-([A-Za-z0-9_-]{12})$/;
const NOTE = 'Forward the next message to a friend who uses Mind Forest.';

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const one of opened.splice(0).reverse()) await one.close().catch(() => {});
});

/** A data folder with one tree, made by the service itself, as the starter script's output is. */
async function starterFolder(): Promise<string> {
  const dir = tempDir('mp-starter-');
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, clientDir: '', model: new FakeModel(), roles: fakeRoles, token: 'x' });
  await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
  await run.pipeline.idle();
  await run.close();
  return dir;
}

interface Stage {
  hosted: Hosted;
  bot: FakeBot;
  dataDir: string;
  clock: { now: number };
}

/** The hosted service with the judges' bot at a stand-in for Telegram, shared trees growing fast, and Momo's line for them. */
async function host(dataDir = tempDir('mp-share-'), bot?: FakeBot, clock = { now: 1_000_000 }, extra: Partial<HostedOptions> = {}): Promise<Stage> {
  if (!bot) opened.push((bot = await new FakeBot().start()));
  const ledger = new Ledger({ file: join(dataDir, 'ledger.json'), limits: DEFAULT_LIMITS });
  const hosted = await startHosted({
    port: 0, host: '127.0.0.1', dataDir, starter: await starterFolder(), appKey: KEY, adminToken: 'admin', ledger,
    shared: {
      clientDir: '', model: new Paused(new FakeModel(), () => ledger.paused()), roles: fakeRoles,
      // A live voice that says nothing of its own: what reaches the headset's voice socket is the service's.
      live: { open: () => ({ send: () => {}, close: () => {} }), options: { model: 'gpt-realtime-2.1-mini', voice: 'marin', turn: { kind: 'semantic' as const }, hearing: 'gpt-4o-transcribe' } },
    },
    judgeBot: { token: BOT_TOKEN, api: bot.url, pollSeconds: 0, conflictMs: 100, retryMs: 20, now: () => clock.now },
    sharedLine: LINE,
    sharePace: { grow: 120, after: 40, stand: 400 },
    log: () => {},
    ...extra,
  });
  opened.push(hosted);
  return { hosted, bot, dataDir, clock };
}

const call = (hosted: Hosted, device: string, path: string, init: RequestInit = {}) => fetch(`${hosted.url}${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}.${device}`, ...init.headers } });

async function pair(s: Stage, device: string, who: Person): Promise<void> {
  await s.bot.until(() => s.bot.calls.some((c) => c.method === 'getUpdates'));
  const { code } = (await (await call(s.hosted, device, '/api/telegram/pair', { method: 'POST' })).json()) as { code: string };
  const after = s.bot.sent.length;
  s.bot.push(who, { text: code });
  await s.bot.reply(who.id, /^We’re paired\./, 'sendMessage', after);
}

/** What the bot sends `who` next, in answer to `fields`. */
async function ask(s: Stage, who: Person, fields: Record<string, unknown>): Promise<string> {
  const after = s.bot.sent.length;
  s.bot.push(who, fields);
  return (await s.bot.reply(who.id, /./, 'sendMessage', after)).text;
}

interface Frame {
  t: string;
  [k: string]: unknown;
}

/**
 * A headset joined to its space, with its voice's socket open: what each was sent. As the app does, it says a tree it asked for
 * stands, by its first card.
 */
async function headset(hosted: Hosted, device: string): Promise<{ ws: WebSocket; seen: Frame[]; voice: Frame[]; send: (m: object) => void; off: () => void }> {
  const seen: Frame[] = [];
  const voice: Frame[] = [];
  const ws = new WebSocket(`${hosted.url.replace('http', 'ws')}/ws?token=${KEY}.${device}`);
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Frame & { yours?: boolean; set?: { commands: Command[] } };
    seen.push(m);
    const made = m.t === 'change' && m.yours ? m.set!.commands.find((c): c is Extract<Command, { type: 'createTree' }> => c.type === 'createTree') : undefined;
    if (made) ws.send(JSON.stringify({ t: 'focus', nodeId: made.tree.rootId }));
  });
  await new Promise((open) => ws.on('open', open));
  await soon(() => seen.some((m) => m.t === 'hello'));
  const live = new WebSocket(`${hosted.url.replace('http', 'ws')}/live?token=${KEY}.${device}&connection=${String(seen.find((m) => m.t === 'hello')!.connection)}`);
  live.on('message', (raw) => voice.push(JSON.parse(String(raw)) as Frame));
  await new Promise((open) => live.on('open', open));
  await soon(() => voice.some((m) => m.t === 'ready'));
  ws.send(JSON.stringify({ t: 'client', media: { embeds: false, files: ['mp4'] } }));
  return { ws, seen, voice, send: (m) => ws.send(JSON.stringify(m)), off: () => (live.close(), ws.close()) };
}

async function soon(ok: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

type State = { trees: { id: string; title: string; rootId: string }[]; nodes: Node[]; items: Item[] };
const state = async (hosted: Hosted, device: string) => ((await (await call(hosted, device, '/api/state')).json()) as { snapshot: State }).snapshot;

/** The sharer's tree, with a picture they kept on it, so the copy takes a file with it. */
async function withPicture(s: Stage, h: Awaited<ReturnType<typeof headset>>): Promise<{ tree: State['trees'][number]; asset: string }> {
  const { id: asset } = (await (await call(s.hosted, A, '/api/assets?name=cone.jpg', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: PICTURE })).json()) as { id: string };
  const before = await state(s.hosted, A);
  const tree = before.trees[0]!;
  const item: Item = {
    id: 'cone-item', kind: 'image', title: 'Pine cone from above', text: '', summary: 'Two sets of spirals.', tags: [], data: { image: `/assets/${asset}` },
    source: { from: 'drop', asset, capturedAt: '2026-11-17T00:00:00.000Z' }, origin: { by: 'user' }, archived: false, revision: 0,
  };
  const root = before.nodes.find((n) => n.id === tree.rootId)!;
  const node: Node = { ...root, id: 'cone-node', itemId: item.id, parent: tree.rootId, status: 'kept', why: 'The spirals', order: 99, view: { component: 'image', props: { src: `/assets/${asset}` }, by: 'default' } };
  h.send({ t: 'commands', label: 'Keep a picture', commands: [{ type: 'addItem', item }, { type: 'addNode', node }] });
  await soon(() => h.seen.some((m) => m.t === 'change'));
  return { tree, asset };
}

test('a tree shared from one headset goes through Telegram as a link, survives a restart, and grows in the friend\'s forest when they put the headset on again, with Momo\'s line', { timeout: 40000 }, async () => {
  const s = await host();
  await pair(s, A, ADA);
  await pair(s, B, EVE);
  const sharer = await headset(s.hosted, A);
  const { tree, asset } = await withPicture(s, sharer);
  const theirs = await state(s.hosted, A);

  const after = s.bot.sent.length;
  sharer.send({ t: 'share', tree: tree.id });
  await soon(() => sharer.seen.some((m) => m.t === 'shared'));
  assert.deepEqual(sharer.seen.find((m) => m.t === 'shared'), { t: 'shared', tree: tree.id, ok: true });
  const offer = await s.bot.reply(ADA.id, LINK, 'sendMessage', after);
  const [, title, code] = LINK.exec(offer.text)!;
  const posted = s.bot.sent.slice(after).filter((m) => m.chat === ADA.id).map((m) => m.text);
  assert.deepEqual(posted, [NOTE, offer.text], 'what to do, then the message to forward');
  assert.equal(title, tree.title);
  assert.deepEqual((await state(s.hosted, A)).trees.map((t) => t.id), theirs.trees.map((t) => t.id), 'the sharer keeps their tree: a copy was shared');
  sharer.off();

  // The service starts again before the friend opens the link: the code and its copy are on the volume.
  await s.hosted.close();
  const again = await host(s.dataDir, s.bot, s.clock);
  const friend = await headset(again.hosted, B);
  const forest = (await state(again.hosted, B)).trees.length;
  assert.equal(await ask(again, EVE, { text: `/start share-${code}` }), `“${title}” is waiting in your Mind Forest. Put on your headset to see it grow.`);
  assert.equal((await state(again.hosted, B)).trees.length, forest, 'held, not planted yet');

  // A moment off, as the headset's menu takes, grows nothing; put on again after twelve seconds, it grows as the friend's own tree.
  friend.send({ t: 'worn', away: 3 });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await state(again.hosted, B)).trees.length, forest);
  const from = friend.seen.length;
  friend.send({ t: 'worn', away: 12 });
  await soon(() => friend.voice.some((m) => m.t === 'done' && String(m.id).startsWith('shared-')));
  const told = await again.bot.reply(ADA.id, /was planted/, 'sendMessage', after);
  assert.equal(told.text, `“${title}” was planted in a friend’s forest.`, 'the sharer is told, with no name');

  const grown = await state(again.hosted, B);
  const copy = grown.trees.find((t) => t.title === title && !theirs.trees.some((o) => o.id === t.id))!;
  assert.ok(copy, 'a tree of that title, under an id of its own');
  const cards = grown.nodes.filter((n) => n.treeId === copy.id);
  assert.equal(cards.length, theirs.nodes.filter((n) => n.treeId === tree.id && (n.status === 'kept' || n.id === tree.rootId)).length, 'its first card and every kept card');
  assert.ok(cards.length >= 2);
  assert.ok(cards.every((n) => n.status === 'kept' && !theirs.nodes.some((o) => o.id === n.id)), 'kept, every card under a new id');
  const picture = grown.items.find((i) => i.title === 'Pine cone from above' && cards.some((n) => n.itemId === i.id))!;
  assert.notEqual(picture.id, 'cone-item');
  assert.ok(picture.source.asset && picture.source.asset !== asset, 'its picture copied under a new id');
  assert.equal(picture.data.image, `/assets/${picture.source.asset}`);
  assert.equal((cards.find((n) => n.itemId === picture.id)!.view.props as { src: string }).src, `/assets/${picture.source.asset}`);
  assert.deepEqual(new Uint8Array(await (await call(again.hosted, B, `/assets/${picture.source.asset}`)).arrayBuffer()), PICTURE);

  // It grew as the headset's own tree, its first card first and then its layer, as an agent's cards come.
  const changes = friend.seen.slice(from).filter((m) => m.t === 'change') as (Frame & { yours?: boolean; set: { origin: { by: string; role?: string }; commands: Command[] } })[];
  assert.ok(changes[0]!.yours && changes[0]!.set.commands.some((c) => c.type === 'createTree'));
  assert.ok(changes.slice(1).every((m) => m.yours && m.set.origin.by === 'agent' && m.set.origin.role === 'shared'));
  // Momo's recorded line, its caption shown by its length.
  const line = friend.voice.find((m) => m.t === 'text' && String(m.id).startsWith('shared-'))!;
  assert.deepEqual([line.text, line.kind, line.ms, line.from], [LINE.text, 'reply', 500, 0]);
  assert.equal(friend.voice.filter((m) => m.t === 'audio' && m.id === line.id).reduce((n, m) => n + Buffer.from(String(m.pcm), 'base64').length, 0), LINE.pcm.length);

  // A link plants its tree once; an unknown one gets a plain answer.
  assert.equal(await ask(again, EVE, { text: `/start share-${code}` }), 'That tree was planted already: a shared tree’s link works once.');
  assert.equal(await ask(again, EVE, { text: '/start share-AAAAAAAAAAAA' }), 'That link isn’t one I know. Ask your friend to share the tree again.');
  friend.off();
});

test('sharing needs the sharer\'s Telegram; a friend not paired is told to pair first and the link waits; a tree can be shared with oneself; links last a week', { timeout: 40000 }, async () => {
  const s = await host();
  const sharer = await headset(s.hosted, A);
  const tree = (await state(s.hosted, A)).trees[0]!;
  sharer.send({ t: 'share', tree: tree.id });
  await soon(() => sharer.seen.some((m) => m.t === 'shared'));
  const refused = sharer.seen.find((m) => m.t === 'shared')!;
  assert.deepEqual([refused.ok, refused.reason], [false, 'unpaired']);
  assert.match(String(refused.text), /^Pair Telegram first/);

  await pair(s, A, ADA);
  const after = s.bot.sent.length;
  sharer.send({ t: 'share', tree: tree.id });
  const [, title, code] = LINK.exec((await s.bot.reply(ADA.id, LINK, 'sendMessage', after)).text)!;
  assert.equal(await ask(s, ZOE, { text: `/start share-${code}` }), `To get “${title}”, pair this chat with your headset first: in your headset, say “Momo, connect my Telegram”, and send me the code it gives you. Then open the link again.`);

  // Shared with oneself: the sharer's own space holds the copy, and it grows at their next return, here after a restart.
  assert.match(await ask(s, ADA, { text: `/start share-${code}` }), /is waiting in your Mind Forest/);
  sharer.off();
  await s.hosted.close();
  const again = await host(s.dataDir, s.bot, s.clock);
  const before = (await state(again.hosted, A)).trees.length;
  const back = await headset(again.hosted, A);
  await soon(() => back.voice.some((m) => m.t === 'done' && String(m.id).startsWith('shared-')));
  assert.equal((await state(again.hosted, A)).trees.length, before + 1, 'joining grows it');
  back.off();

  // A week later a link no longer works, and says so.
  const later = again.bot.sent.length;
  const owner = await headset(again.hosted, A);
  owner.send({ t: 'share', tree: tree.id });
  const [, , old] = LINK.exec((await again.bot.reply(ADA.id, LINK, 'sendMessage', later)).text)!;
  again.clock.now += SHARE_MS + 1;
  assert.equal(await ask(again, ADA, { text: `/start share-${old}` }), 'That link has expired: a shared tree’s link works for 7 days. Ask your friend to share it again.');
  owner.off();
});

test("the hosted service's hello says a shared tree goes out through Telegram, so the headset shows no list of people; no other service says so", { timeout: 30000 }, async () => {
  const hello = async (url: string, token: string) => {
    const ws = new WebSocket(`${url.replace('http', 'ws')}/ws?token=${token}`);
    const first = await new Promise<Frame>((done) => ws.once('message', (raw) => done(JSON.parse(String(raw)) as Frame)));
    ws.close();
    return first;
  };
  const s = await host();
  const told = await hello(s.hosted.url, `${KEY}.${A}`);
  assert.equal(told.t, 'hello');
  assert.equal(told.share, 'telegram');
  // Without the judges' bot nothing is shared, and the hello says nothing of it.
  const bare = await host(tempDir('mp-share-'), undefined, undefined, { judgeBot: undefined });
  assert.equal('share' in (await hello(bare.hosted.url, `${KEY}.${A}`)), false);
  // Nor does a service that is not hosted.
  const plain = await startServer({ port: 0, host: '127.0.0.1', dataDir: tempDir('mp-share-'), clientDir: '', model: new FakeModel(), roles: fakeRoles, token: 'x' });
  try {
    assert.equal('share' in (await hello(plain.url, 'x')), false);
  } finally {
    await plain.close();
  }
});

test('a shared tree is its kept cards under new ids, its files pointing at their copies; codes count a day\'s shares, expire, and lose their files', () => {
  const dir = tempDir('mp-shares-');
  const clock = { now: 5_000_000 };
  const shares = new Shares(dir, () => clock.now);
  const copy = {
    version: 1 as const, title: 'Seed spirals', assets: ['0123456789abcdef.jpg'],
    nodes: [{ id: 'r', treeId: 't', itemId: 'ir', parent: null }, { id: 'c', treeId: 't', itemId: 'ic', parent: 'r' }, { id: 'g', treeId: 't', itemId: 'ig', parent: 'c' }] as Node[],
    items: [{ id: 'ir', source: {} }, { id: 'ic', source: { asset: '0123456789abcdef.jpg' }, data: { image: '/assets/0123456789abcdef.jpg' } }, { id: 'ig', source: {} }] as unknown as Item[],
  };
  const code = shares.make(A, copy, [{ id: '0123456789abcdef.jpg', mime: 'image/jpeg', bytes: PICTURE }]);
  assert.match(code, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(shares.today(A), 1);
  assert.equal(shares.today(B), 0);
  const found = shares.find(code);
  assert.equal(found.state, 'live');
  assert.deepEqual(found.state === 'live' && found.files[0]!.bytes, PICTURE);
  let n = 0;
  const planted = plantingOf(copy, new Map([['0123456789abcdef.jpg', 'fedcba9876543210.jpg']]), () => `new-${++n}`, 'now');
  const made = [...planted.first, ...planted.layers.flat()];
  assert.equal(planted.layers.length, 2, 'a layer under the first card, and one under that');
  const nodes = made.flatMap((c) => (c.type === 'addNode' ? [c.node] : c.type === 'createTree' ? [c.root] : []));
  assert.ok(nodes.every((node) => node.treeId === planted.treeId && !['r', 'c', 'g'].includes(node.id) && node.status === 'kept'));
  const items = made.flatMap((c) => (c.type === 'addItem' ? [c.item] : []));
  assert.deepEqual(items.find((i) => i.source.asset)!.data, { image: '/assets/fedcba9876543210.jpg' });

  shares.use(code, B);
  assert.equal(shares.find(code).state, 'used');
  assert.ok(!existsSync(join(dir, code)), 'its files went to the friend; they are not kept twice');
  const late = shares.make(A, copy, []);
  clock.now += SHARE_MS + 1;
  assert.equal(shares.find(late).state, 'expired');
  shares.sweep();
  assert.ok(!existsSync(join(dir, late)), "an expired code's files go at once");
  assert.equal(shares.today(A), 0, 'a day later, the count starts again');
  clock.now += 31 * 24 * 3_600_000;
  shares.sweep();
  assert.equal(shares.find(late).state, 'unknown', 'and its entry a month after');
});

test('only kept cards are shared, and the copy keeps a picture file it shows', async () => {
  const dir = tempDir('mp-copy-');
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, clientDir: '', model: new FakeModel(), roles: fakeRoles, token: 'x' });
  try {
    await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
    await run.pipeline.idle();
    const tree = [...run.mind.trees.values()][0]!;
    const copy = copyOf(run.mind, tree.id)!;
    assert.equal(copy.title, tree.title);
    assert.equal(copy.nodes[0]!.id, tree.rootId);
    assert.ok(copy.nodes.slice(1).every((node) => node.status === 'kept'));
    const picks = run.mind.treeNodes(tree.id).filter((node) => node.status !== 'kept');
    assert.ok(picks.every((pick) => !copy.nodes.some((node) => node.id === pick.id)), 'suggestions never kept stay behind');
    assert.equal(copyOf(run.mind, 'no-such-tree'), null);
  } finally {
    await run.close();
  }
});

test("the hosted image ships Momo's line for a shared tree: its build names the recording of the line as lines.json has it now", () => {
  const demo = join(import.meta.dirname, '../demo');
  const lines = JSON.parse(readFileSync(join(demo, 'lines.json'), 'utf8')) as { voice: string; said: Record<string, string> };
  const recording = recordingName(lines.voice, lines.said.shared!);
  const dockerfile = readFileSync(join(import.meta.dirname, '../Dockerfile'), 'utf8');
  const ignore = readFileSync(join(import.meta.dirname, '../.dockerignore'), 'utf8');
  assert.match(dockerfile, new RegExp(`COPY demo/voice/voices\\.json demo/voice/${recording.replace('.', '\\.')} \\./demo/voice/`));
  assert.ok(ignore.split('\n').includes(`!demo/voice/${recording}`));
  assert.ok(ignore.split('\n').includes('!demo/lines.json'));
});
