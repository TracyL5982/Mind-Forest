import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { packager } from '../src/core/roles/packager.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running, type ServerOptions } from '../src/node/server.ts';
import { makeItem, makeNode } from '../src/core/roles/types.ts';
import { ADA, BOT_TOKEN as TOKEN, EVE, FakeBot, type Person, type Sent } from './fake-bot.ts';

/** Everything a test opened, closed after it whether it passed or not, so a failure does not leave the run waiting. */
const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const one of opened.splice(0).reverse()) await one.close().catch(() => {});
});

async function stand(): Promise<FakeBot> {
  const bot = await new FakeBot().start();
  opened.push(bot);
  return bot;
}

interface Booted {
  run: Running;
  logs: string[];
  dataDir: string;
}

async function boot(bot: FakeBot, extra: Partial<ServerOptions> = {}, dataDir = mkdtempSync(join(tmpdir(), 'mp-'))): Promise<Booted> {
  const logs: string[] = [];
  const run = await startServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    clientDir: join(import.meta.dirname, '../client'),
    model: new FakeModel(),
    roles: fakeRoles,
    token: 'secret',
    log: (line) => logs.push(line),
    ...extra,
    telegram: { token: TOKEN, api: bot.url, pollSeconds: 0, conflictMs: 100, retryMs: 20, ...extra.telegram },
  });
  opened.push(run);
  return { run, logs, dataDir };
}

function api(run: Running, path: string, method = 'GET', token = 'secret'): Promise<Response> {
  return fetch(`${run.url}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
}

async function status(run: Running): Promise<{ available: boolean; ready: boolean; paired: string | null }> {
  return (await api(run, '/api/telegram')).json() as Promise<{ available: boolean; ready: boolean; paired: string | null }>;
}

async function code(run: Running): Promise<string> {
  const end = Date.now() + 5000;
  while (!(await status(run)).ready) {
    if (Date.now() > end) throw new Error('the contact never became ready');
    await new Promise((r) => setTimeout(r, 10));
  }
  const { link } = (await (await api(run, '/api/telegram/pair', 'POST')).json()) as { link: string };
  assert.match(link, /^https:\/\/t\.me\/mind_palace_test_bot\?start=[A-Za-z0-9_-]{8,64}$/);
  return new URL(link).searchParams.get('start')!;
}

async function pair(b: Booted, bot: FakeBot, who: Person = ADA): Promise<void> {
  const after = bot.sent.length;
  bot.push(who, { text: `/start ${await code(b.run)}` });
  await bot.reply(who.id, /^Paired\./, 'sendMessage', after);
}

const items = (run: Running) => [...run.mind.items.values()];

test('a good code pairs one account; a reused or an expired one pairs no one and gets no reply; no one else is heard', async () => {
  const bot = await stand();
  let clock = 1_000_000;
  const b = await boot(bot, { telegram: { token: TOKEN, now: () => clock } });

  assert.equal((await api(b.run, '/api/telegram', 'GET', 'wrong')).status, 401, 'pairing sits behind the access token');
  assert.equal((await api(b.run, '/api/telegram/pair', 'POST', 'wrong')).status, 401);
  assert.equal((await status(b.run)).paired, null);

  await bot.read(bot.push(EVE, { text: 'Before anyone is paired' }));
  const good = await code(b.run);
  bot.push(ADA, { text: `/start ${good}` });
  await bot.reply(ADA.id, /^Paired\./);
  assert.equal((await status(b.run)).paired, 'Ada Lovelace');

  await bot.read(bot.push(EVE, { text: `/start ${good}` }));
  await bot.read(bot.push(EVE, { text: 'Hello from someone else' }));
  await b.run.pipeline.idle();
  assert.equal((await status(b.run)).paired, 'Ada Lovelace', 'a used code pairs no one');
  assert.deepEqual(bot.sent.filter((s) => s.chat === EVE.id), [], 'an account that is not paired gets no reply at all');
  assert.deepEqual(items(b.run), [], 'and nothing it sent was added');

  assert.equal((await (await api(b.run, '/api/telegram/unpair', 'POST')).json() as { paired: unknown }).paired, null);
  const late = await code(b.run);
  clock += 11 * 60 * 1000;
  const before = bot.sent.length;
  await bot.read(bot.push(ADA, { text: `/start ${late}` }));
  await bot.read(bot.push(ADA, { text: 'Sent after unpairing' }));
  await b.run.pipeline.idle();
  assert.equal((await status(b.run)).paired, null, 'a code older than ten minutes pairs no one');
  assert.equal(bot.sent.length, before, 'and an unpaired account gets no reply');
  assert.deepEqual(items(b.run), []);

  await b.run.close();
  await bot.close();
});

test('text, a link, a photo at its largest size, a file, a video and audio each reach the mindstorm, and the reply says where it went', async () => {
  const bot = await stand();
  const b = await boot(bot);
  await pair(b, bot);
  const big = new Uint8Array([9, 8, 7, 6, 5, 4]);
  bot.file('small', new Uint8Array([1]));
  bot.file('big', big);
  bot.file('pdf', new TextEncoder().encode('%PDF-1.4'));
  bot.file('clip', new Uint8Array([0, 0, 0, 24]));
  bot.file('song', new Uint8Array([73, 68, 51]));

  const cases: { fields: Record<string, unknown>; kind: string; title: RegExp }[] = [
    { fields: { text: 'Sourdough rises slowly in winter' }, kind: 'text', title: /Sourdough/ },
    { fields: { text: 'https://example.org/lenses' }, kind: 'link', title: /example\.org\/lenses/ },
    { fields: { photo: [{ file_id: 'small', width: 90, height: 60 }, { file_id: 'big', width: 1280, height: 853 }] }, kind: 'image', title: /^photo-\d+\.jpg$/ },
    { fields: { document: { file_id: 'pdf', file_name: 'plan.pdf', mime_type: 'application/pdf', file_size: 8 } }, kind: 'file', title: /^plan\.pdf$/ },
    { fields: { video: { file_id: 'clip', mime_type: 'video/mp4', file_size: 4 } }, kind: 'video', title: /^video-\d+\.mp4$/ },
    { fields: { audio: { file_id: 'song', file_name: 'song.mp3', mime_type: 'audio/mpeg' } }, kind: 'file', title: /^song\.mp3$/ },
  ];
  for (const c of cases) {
    const count = items(b.run).length;
    bot.push(ADA, c.fields);
    const reply = await bot.reply(ADA.id, /^Added “/);
    bot.sent.splice(bot.sent.indexOf(reply), 1);
    const made = items(b.run).slice(count);
    assert.equal(made.length, 1, `one item for ${c.kind}`);
    assert.equal(made[0]!.kind, c.kind);
    assert.match(made[0]!.title, c.title);
    assert.equal(reply.text, `Added “${made[0]!.title}”. It is in your knowledge base.`);
  }

  const photo = items(b.run).find((i) => i.kind === 'image')!;
  const stored = await api(b.run, `/assets/${photo.source.asset}`);
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), big, 'the largest size of the photo is kept');
  assert.equal(items(b.run).find((i) => i.kind === 'link')!.source.url, 'https://example.org/lenses', 'a lone address becomes a link');

  await b.run.close();
  await bot.close();
});

test('a caption that asks for a tree makes one from the photo it came with', async () => {
  const bot = await stand();
  const b = await boot(bot);
  await pair(b, bot);
  bot.file('stairs', new Uint8Array([1, 2, 3]));

  bot.push(ADA, { photo: [{ file_id: 'stairs', width: 800, height: 600 }], caption: 'Start a tree on this' });
  const reply = await bot.reply(ADA.id, /^Added “/);
  await b.run.pipeline.idle();

  assert.equal(b.run.mind.trees.size, 1);
  const tree = [...b.run.mind.trees.values()][0]!;
  const root = b.run.mind.itemOf(tree.rootId);
  assert.equal(root.kind, 'image', 'the photo is the root');
  assert.equal(reply.text, `Added “${root.title}”. It started the tree “${tree.title}”.`);
  assert.ok(!items(b.run).some((i) => /start a tree/i.test(i.title + i.text)), 'the words that asked are not kept as a card');

  await b.run.close();
  await bot.close();
});

test('a voice note is written out and its words are dumped; with no way to hear, the recording is kept and the reply says why', async () => {
  const bot = await stand();
  const heard: { audio: number[]; mime: string }[] = [];
  const b = await boot(bot, { transcribe: async (audio, mime) => (heard.push({ audio: [...audio], mime }), 'Buy more film for the Leica') });
  await pair(b, bot);
  bot.file('voice', new Uint8Array([79, 103, 103, 83]));

  bot.push(ADA, { voice: { file_id: 'voice', mime_type: 'audio/ogg', duration: 2 } });
  const reply = await bot.reply(ADA.id, /^Added “/);
  assert.deepEqual(heard, [{ audio: [79, 103, 103, 83], mime: 'audio/ogg' }]);
  assert.deepEqual(items(b.run).map((i) => [i.kind, i.text]), [['text', 'Buy more film for the Leica']]);
  assert.doesNotMatch(reply.text, /OPENAI/);
  await b.run.close();

  const deaf = await boot(bot);
  await pair(deaf, bot);
  bot.push(ADA, { voice: { file_id: 'voice', mime_type: 'audio/ogg', duration: 2 } });
  const said = await bot.reply(ADA.id, /OPENAI_API_KEY/);
  assert.match(said.text, /^Added “voice-\d+\.ogg”\. It is in your knowledge base\.\nVoice notes are written out only with OPENAI_API_KEY/);
  assert.deepEqual(items(deaf.run).map((i) => i.kind), ['file'], 'the recording itself is kept');

  await deaf.run.close();
  await bot.close();
});

test('a file over 20 MB is refused with a reply that points to the web page, and nothing is added', async () => {
  const bot = await stand();
  const b = await boot(bot);
  await pair(b, bot);
  bot.file('huge-unsized', new Uint8Array([1]), true);

  bot.push(ADA, { document: { file_id: 'huge', file_name: 'film.mov', mime_type: 'video/quicktime', file_size: 21 * 1024 * 1024 } });
  const said = await bot.reply(ADA.id, /over 20 MB/);
  assert.match(said.text, /web page/);
  assert.ok(!bot.calls.some((c) => c.method === 'getFile' && c.body.file_id === 'huge'), 'a file known to be too large is not asked for');

  bot.push(ADA, { video: { file_id: 'huge-unsized', mime_type: 'video/mp4' } });
  await bot.until(() => bot.sent.filter((s) => /over 20 MB/.test(s.text)).length === 2);
  await b.run.pipeline.idle();
  assert.deepEqual(items(b.run), []);

  await b.run.close();
  await bot.close();
});

test('the read position and the pairing survive a restart, so no message is taken twice', async () => {
  const bot = await stand();
  const first = await boot(bot);
  await pair(first, bot);
  const id = bot.push(ADA, { text: 'Kept once, only once' });
  await bot.reply(ADA.id, /^Added “/);
  await first.run.close();

  const polled = bot.polls();
  const again = await boot(bot, {}, first.dataDir);
  await bot.until(() => bot.polls() > polled + 2);
  const asked = bot.calls.filter((c) => c.method === 'getUpdates').slice(polled);
  assert.ok(asked.every((c) => Number(c.body.offset) > id), 'the restarted service asks only for what comes after');
  assert.equal(items(again.run).filter((i) => i.title.includes('Kept once')).length, 1);
  assert.equal(bot.sent.filter((s) => /^Added “/.test(s.text)).length, 1, 'and replies once');

  bot.push(ADA, { text: 'Heard after the restart' });
  await bot.until(() => bot.sent.filter((s) => /^Added “/.test(s.text)).length === 2);
  assert.equal((await status(again.run)).paired, 'Ada Lovelace');

  await again.run.close();
  await bot.close();
});

test('a 409 from another program reading the bot is logged once and waited out, and reading goes on when it stops', async () => {
  const bot = await stand();
  bot.refuse = { status: 409, description: 'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running' };
  const b = await boot(bot, { telegram: { token: TOKEN, conflictMs: 100 } });
  await bot.until(() => bot.polls() >= 1);
  await new Promise((r) => setTimeout(r, 600));

  assert.ok(bot.polls() <= 9, `it waits between tries (asked ${bot.polls()} times in 600 ms)`);
  assert.equal(b.logs.filter((l) => /409/.test(l)).length, 1, 'the conflict is logged once');

  bot.refuse = null;
  await pair(b, bot);
  bot.push(ADA, { text: 'After the other program stopped' });
  await bot.reply(ADA.id, /^Added “/);

  await b.run.close();
  await bot.close();
});

test('a handoff comes to the paired chat as a message and one Markdown file that names no assets/ path, and /handoff sends it again', async () => {
  const bot = await stand();
  const b = await boot(bot, { roles: { ...fakeRoles, packager } });
  await pair(b, bot);

  bot.push(ADA, { text: '/handoff' });
  await bot.reply(ADA.id, /^No handoff yet/);
  bot.push(ADA, { text: '/help' });
  await bot.reply(ADA.id, /^You are paired\./);

  bot.file('stairs', new Uint8Array([1, 2, 3]));
  bot.push(ADA, { photo: [{ file_id: 'stairs', width: 800, height: 600 }], caption: 'Start a tree on this' });
  await bot.reply(ADA.id, /started the tree/);
  await b.run.pipeline.idle();
  const tree = [...b.run.mind.trees.values()][0]!;

  await b.run.pipeline.handoff({ treeIds: [tree.id], nodeIds: [] });
  const message = await bot.reply(ADA.id, /^Handoff ready/);
  const file = await bot.reply(ADA.id, /./, 'sendDocument');
  assert.equal(message.text.split('\n')[0], `Handoff ready: ${tree.title}`);
  assert.match(message.text.split('\n')[1]!, /^For your agent: /);
  assert.match(file.file!, /^[a-z0-9-]+-handoff-\d{4}-\d{2}-\d{2}\.md$/);
  assert.match(file.text, /- picture: not attached\. The summary and text here describe it\./);
  assert.ok(!file.text.includes('assets/'), 'the file that travels names no file of the bundle');
  const kept = readdirSync(join(b.dataDir, 'handoffs'));
  assert.deepEqual(kept.sort(), [file.file!.replace(/\.md$/, '.zip'), file.file!].sort(), 'the zip stays on the web page beside the file');
  assert.equal(readFileSync(join(b.dataDir, 'handoffs', file.file!), 'utf8'), file.text);

  const count = items(b.run).length;
  for (const ask of ['/handoff', 'Send me the handoff']) {
    const sent = bot.sent.length;
    bot.push(ADA, { text: ask });
    await bot.until(() => bot.sent.length === sent + 2);
    const [again, document] = bot.sent.slice(sent);
    assert.equal(again!.text, message.text, `${ask} sends the message again`);
    assert.deepEqual([document!.method, document!.file, document!.text], ['sendDocument', file.file, file.text]);
  }
  assert.equal(items(b.run).length, count, 'asking for the handoff adds nothing');

  await b.run.close();
  await bot.close();
});

test('the bot token is in no log line, reply or saved file, whatever fails', async () => {
  const bot = await stand();
  bot.refuse = { status: 500, description: `Internal error while serving /bot${TOKEN}/getUpdates` };
  const b = await boot(bot);
  await bot.until(() => b.logs.some((l) => l.includes('answered 500')));
  bot.refuse = null;
  await pair(b, bot);
  bot.push(ADA, { document: { file_id: 'gone', file_name: 'lost.txt' } });
  await bot.reply(ADA.id, /could not be added/);
  await b.run.close();

  const unreachable = await boot(bot, { telegram: { token: TOKEN, api: 'http://[unparseable' } });
  await bot.until(() => unreachable.logs.some((l) => l.includes('could not be reached')));
  await unreachable.run.close();

  const lines = [...b.logs, ...unreachable.logs];
  assert.ok(lines.some((l) => l.includes('<bot token>')), 'the failures that held the token were logged with it hidden');
  assert.deepEqual(lines.filter((l) => l.includes(TOKEN) || l.includes(TOKEN.split(':')[1]!)), []);
  assert.deepEqual(bot.sent.filter((s) => s.text.includes(TOKEN)), []);
  assert.ok(!readFileSync(join(b.dataDir, 'telegram.json'), 'utf8').includes(TOKEN.split(':')[1]!), 'the token is not saved with the pairing');
  await bot.close();
});

/** A tree of the user's own, its first title the root card, as a drop that asked for a tree leaves it. */
function grow(run: Running, title: string, cards: string[]): string {
  const ctx = run.pipeline.ctx;
  const USER = { by: 'user' as const };
  const treeId = ctx.newId();
  const made = cards.map((card) => makeItem(ctx, { kind: 'text', title: card, text: card, origin: USER, source: { from: 'paste' } }));
  const root = makeNode(ctx, made[0]!, { treeId, parent: null, status: 'kept', why: '', origin: USER });
  run.mind.apply({
    origin: USER,
    label: `seed ${title}`,
    commands: [
      ...made.map((item) => ({ type: 'addItem' as const, item })),
      { type: 'createTree', tree: { id: treeId, title, rootId: root.id, digest: `About ${title.toLowerCase()}`, createdAt: new Date(Date.UTC(2026, 0, 1 + run.mind.trees.size)).toISOString() }, root },
      ...made.slice(1).map((item) => ({ type: 'addNode' as const, node: makeNode(ctx, item, { treeId, parent: root.id, status: 'kept', why: '', origin: USER }) })),
    ],
  });
  return treeId;
}

/** What the bot sent after the `after`th thing, once it has sent `count` more. */
async function next(bot: FakeBot, after: number, count: number): Promise<Sent[]> {
  await bot.until(() => bot.sent.length >= after + count);
  return bot.sent.slice(after, after + count);
}

test('"list my trees" names the trees newest first with a line each, and a number then sends that tree\'s handoff', async () => {
  const bot = await stand();
  const model = new FakeModel();
  const b = await boot(bot, { model });
  await pair(b, bot);

  bot.push(ADA, { text: 'list my trees' });
  assert.match((await bot.reply(ADA.id, /no trees yet/)).text, /^You have no trees yet\. Send “make a tree about …”/);

  grow(b.run, 'Film', ['Camera moves', 'Dolly zoom']);
  grow(b.run, 'Solar panels at home', ['Payback', 'Inverters', 'Roof angle']);
  let sent = bot.sent.length;
  bot.push(ADA, { text: 'What trees do I have?' });
  assert.equal(
    (await next(bot, sent, 1))[0]!.text,
    'Your trees, newest first:\n1. Solar panels at home: 3 cards. About solar panels at home\n2. Film: 2 cards. About film\nReply with a number for a tree’s handoff.',
  );

  sent = bot.sent.length;
  bot.push(ADA, { text: '2' });
  const [packing, ready, file] = await next(bot, sent, 3);
  assert.equal(packing!.text, 'Packing “Film”…', 'the answer comes at once, before the file');
  assert.equal(ready!.text.split('\n')[0], 'Handoff ready: Film');
  assert.equal(file!.method, 'sendDocument');
  assert.match(file!.text, /## Film\n- Camera moves\n {2}- Dolly zoom/);
  assert.deepEqual(model.calls, [], 'none of this asked the model');
  assert.equal(items(b.run).length, 5, 'asking added nothing');

  sent = bot.sent.length;
  bot.push(ADA, { text: '2' });
  assert.match((await next(bot, sent, 1))[0]!.text, /^Added “/, 'with no list open, a number is a thought again');
});

test('"hand off <name>" sends the one tree the name means; several are offered to choose from; none says so and lists the trees', async () => {
  const bot = await stand();
  const model = new FakeModel().on('contact.match', () => ({ matches: [] }));
  const b = await boot(bot, { model });
  await pair(b, bot);
  grow(b.run, 'Film', ['Camera moves']);
  grow(b.run, 'Solar system', ['Jupiter']);
  grow(b.run, 'Solar panels at home', ['Payback']);

  let sent = bot.sent.length;
  bot.push(ADA, { text: 'Hand off the film tree' });
  const [packing, ready] = await next(bot, sent, 3);
  assert.equal(packing!.text, 'Packing “Film”…');
  assert.equal(ready!.text.split('\n')[0], 'Handoff ready: Film');
  assert.equal(model.calls.length, 0, 'a name that is one tree needs no model');

  sent = bot.sent.length;
  bot.push(ADA, { text: 'send me the handoff for solar' });
  assert.equal(
    (await next(bot, sent, 1))[0]!.text,
    'Which one?\n1. Solar panels at home: 1 card. About solar panels at home\n2. Solar system: 1 card. About solar system\nReply with a number.',
  );
  sent = bot.sent.length;
  bot.push(ADA, { text: 'solar system' });
  assert.equal((await next(bot, sent, 3))[1]!.text.split('\n')[0], 'Handoff ready: Solar system', 'a name picks from the offer as a number does');

  sent = bot.sent.length;
  bot.push(ADA, { text: 'hand off gardening' });
  assert.match((await next(bot, sent, 1))[0]!.text, /^No tree matches “gardening”\. Your trees, newest first:\n1\. Solar panels at home/);
  assert.deepEqual(model.calls.map((c) => c.role), ['contact.match'], 'words no name holds went to the model');

  const before = bot.sent.length;
  bot.push(ADA, { text: '/handoff' });
  const [again, document] = await next(bot, before, 2);
  assert.match(again!.text, /^Handoff ready: /);
  assert.deepEqual([document!.method, /^## (.+)$/m.exec(document!.text)?.[1]], ['sendDocument', 'Solar system'], '/handoff with no name still sends the latest');
});

test('"find the tree about …" matches by what is in a tree through the model, and "yes" then sends its handoff', async () => {
  const bot = await stand();
  const model = new FakeModel().on('contact.match', (req) => ({ matches: [Number(/^(\d+)\. Home energy/m.exec(req.user)![1])] }));
  const b = await boot(bot, { model });
  await pair(b, bot);
  grow(b.run, 'Film', ['Camera moves']);
  grow(b.run, 'Home energy', ['Heat pumps', 'Inverters']);

  let sent = bot.sent.length;
  bot.push(ADA, { text: 'find the tree about heat pumps' });
  assert.equal((await next(bot, sent, 1))[0]!.text, 'Found:\n1. Home energy: 2 cards. About home energy\nReply with “yes” or 1 for its handoff.');
  assert.deepEqual(model.calls.map((c) => c.role), ['contact.match']);

  sent = bot.sent.length;
  bot.push(ADA, { text: 'Yes' });
  const [packing, ready] = await next(bot, sent, 3);
  assert.equal(packing!.text, 'Packing “Home energy”…');
  assert.equal(ready!.text.split('\n')[0], 'Handoff ready: Home energy');
});

test('words the rules do not read are read by the model when they name trees or a handoff, and a thought is still a thought', async () => {
  const bot = await stand();
  const model = new FakeModel()
    .describing()
    .on('contact.ask', (req) => (/packaged up/.test(req.user) ? { kind: 'handoff', words: 'film' } : { kind: 'none', words: '' }));
  const b = await boot(bot, { model, roles: { ...fakeRoles } });
  await pair(b, bot);
  grow(b.run, 'Film', ['Camera moves']);

  let sent = bot.sent.length;
  bot.push(ADA, { text: 'could I get my film tree packaged up for Claude' });
  assert.equal((await next(bot, sent, 3))[0]!.text, 'Packing “Film”…');
  assert.deepEqual(model.calls.map((c) => c.role), ['contact.ask']);

  sent = bot.sent.length;
  const count = items(b.run).length;
  bot.push(ADA, { text: 'Decision trees are overrated' });
  assert.match((await next(bot, sent, 1))[0]!.text, /^Added “/, 'the model said it asks nothing, so it is dropped');
  bot.push(ADA, { text: 'Sourdough needs a long cold proof' });
  await bot.until(() => items(b.run).length === count + 2);
  assert.equal(model.calls.filter((c) => c.role === 'contact.ask').length, 2, 'a thought with no word of trees or handoffs never asks the model');
});

test('a voice note that asks for a tree\'s handoff gets it, and /unpair from the chat ends the pairing', async () => {
  const bot = await stand();
  const b = await boot(bot, { transcribe: async () => 'Hand off the film tree.' });
  await pair(b, bot);
  grow(b.run, 'Film', ['Camera moves']);

  let sent = bot.sent.length;
  bot.file('memo', new Uint8Array([1, 2, 3]));
  bot.push(ADA, { voice: { file_id: 'memo', duration: 2 } });
  assert.equal((await next(bot, sent, 3))[0]!.text, 'Packing “Film”…');
  assert.equal(items(b.run).length, 1, 'the recording was not kept as a drop');

  sent = bot.sent.length;
  bot.push(ADA, { text: '/unpair' });
  assert.match((await next(bot, sent, 1))[0]!.text, /^Unpaired\./);
  assert.equal((await status(b.run)).paired, null);
  await bot.read(bot.push(ADA, { text: 'list my trees' }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(bot.sent.length, sent + 1, 'an unpaired chat is not answered');
});
