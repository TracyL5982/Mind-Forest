import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  InstagramLibrary,
  InstagramReader,
  inTurn,
  nextRead,
  openInstagram,
  paceAfter,
  parseList,
  REREAD,
  usageOf,
  type Account,
  type Listed,
  type Shrink,
} from '../src/node/instagram.ts';
import { makeSources } from '../src/node/sources.ts';
import type { ModelClient } from '../src/core/ports.ts';
import { MemoryAssets } from './kit.ts';

const LIST = `# Accounts I keep — a made-up list

Account: @someone\\_here
- A note in the preamble that mentions @not\\_listed — and a dash.

## Making (3)

### Prints & Drawing (2)

- @ink\\_and\\_paper — Ink and Paper — Illustration studio — https://www.instagram.com/ink\\_and\\_paper/ (12.0k followers)
- @stonemason — Stone Mason — Sculptor — carves in marble — https://www.instagram.com/stonemason/ ★

### Buildings (1)

- @concrete.lines — Concrete Lines — Architecture office — https://www.instagram.com/concrete.lines/ (3.1M followers) ★

## Leisure (2)

### Movement (2)

- @floorwork — Floorwork — Floor-work troupe from Lisbon — https://www.instagram.com/floorwork/ (40.2k followers)
- @ink\\_and\\_paper — Ink and Paper — Illustration studio — https://www.instagram.com/ink\\_and\\_paper/ (12.0k followers)
`;

test('the list gives each account once, with every category it is under and what the list says of it', () => {
  const listed = parseList(LIST);

  assert.deepEqual(listed.categories, ['Prints & Drawing', 'Buildings', 'Movement']);
  assert.deepEqual(listed.accounts.map((a) => a.handle), ['ink_and_paper', 'stonemason', 'concrete.lines', 'floorwork']);
  const ink = listed.accounts[0]!;
  assert.deepEqual(ink, { handle: 'ink_and_paper', name: 'Ink and Paper', about: 'Illustration studio', categories: ['Prints & Drawing', 'Movement'] });
  assert.equal(listed.accounts[1]!.about, 'Sculptor — carves in marble', 'a description with its own dash keeps both parts');
});

const REAL_LIST = process.env.MIND_PALACE_INSTAGRAM_LIST || join(homedir(), '.mind-palace', 'instagram-following.md');

test('the user\'s own list gives its 231 accounts, each category as many as its heading says', { skip: !existsSync(REAL_LIST) && 'no list on this machine' }, () => {
  const markdown = readFileSync(REAL_LIST, 'utf8');
  const listed = parseList(markdown);

  assert.equal(listed.accounts.length, 231);
  assert.equal(listed.categories.length, 15);
  // Each `### Name (n)` heading says how many accounts are under it.
  const headings = [...markdown.replace(/\\_/g, '_').matchAll(/^###\s+(.+?)\s+\((\d+)\)\s*$/gm)].map((m) => [m[1]!, Number(m[2])] as const);
  assert.deepEqual(headings.map(([name]) => name), listed.categories);
  for (const [name, count] of headings) assert.equal(listed.accounts.filter((a) => a.categories.includes(name)).length, count, name);
  assert.equal(listed.accounts.reduce((n, a) => n + a.categories.length, 0), 241, 'every listing, an account under two categories counted twice');
  assert.ok(listed.accounts.every((a) => a.name && !a.handle.includes('\\')));
});

// ---- the library

const ACCOUNTS = parseList(LIST);
const account = (handle: string): Account => ACCOUNTS.accounts.find((a) => a.handle === handle)!;

function library(listed: Listed = ACCOUNTS) {
  const dir = mkdtempSync(join(tmpdir(), 'mp-instagram-'));
  const assets = new MemoryAssets();
  return { dir, assets, library: new InstagramLibrary(dir, listed, assets) };
}

/** A Graph API answer for an account's posts, each `[id, caption, type]`, posted a day apart, newest first. */
function graph(posts: [string, string, string?][]) {
  return {
    business_discovery: {
      media: {
        data: posts.map(([id, caption, type = 'IMAGE'], n) => ({
          id,
          caption,
          media_type: type,
          ...(type === 'VIDEO' ? { thumbnail_url: `https://cdn.example/${id}-thumb.jpg` } : { media_url: `https://cdn.example/${id}.jpg` }),
          permalink: `https://www.instagram.com/p/${id}/`,
          timestamp: `2026-11-${String(14 - n).padStart(2, '0')}T10:00:00+0000`,
        })),
      },
    },
  };
}

/** A fake Instagram: Business Discovery answers from `accounts` with these usage headers, and the CDN serves a picture for any address. */
function instagram(accounts: Record<string, unknown>, usage = '{"call_count":4,"total_cputime":1,"total_time":2}') {
  const asked: string[] = [];
  const send = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    if (url.startsWith('https://cdn.example/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    const handle = /business_discovery\.username\(([^)]+)\)/.exec(url)?.[1] ?? '';
    const answer = accounts[handle];
    const headers = { 'content-type': 'application/json', 'x-app-usage': usage };
    if (answer === undefined) {
      return new Response(JSON.stringify({ error: { message: 'Invalid user id', code: 110, error_subcode: 2207013, is_transient: false, error_user_title: 'Cannot find User' } }), { status: 400, headers });
    }
    if (typeof answer === 'number') return new Response(JSON.stringify({ error: { message: 'Application request limit reached', code: answer, is_transient: true } }), { status: 400, headers });
    return new Response(JSON.stringify(answer), { headers });
  }) as typeof fetch;
  return { send, asked };
}

const shrink: Shrink = async (pictures) => pictures.map((bytes) => new Uint8Array([...bytes, 9]));
const CONNECTION = { token: 'token', userId: '17840000' };

test('reading an account keeps its posts and a small copy of each picture, a video by its thumbnail', async () => {
  const { dir, library: lib } = library();
  const { send, asked } = instagram({ floorwork: graph([['1', 'Rehearsal for the spring piece #contemporarydance', 'VIDEO'], ['2', 'New season, new floor', 'CAROUSEL_ALBUM']]) });
  const reader = new InstagramReader({ library: lib, connection: CONNECTION, send, shrink });

  const outcome = await reader.read(account('floorwork'));

  assert.equal(outcome.answer.kind, 'read');
  assert.equal(outcome.posts, 2);
  assert.equal(outcome.usage.percent, 4);
  assert.deepEqual(readdirSync(join(dir, 'pictures')).sort(), ['1.jpg', '2.jpg']);
  assert.deepEqual([...readFileSync(join(dir, 'pictures', '1.jpg'))], [1, 2, 3, 9], 'the shrunk copy is what is kept');
  assert.ok(asked.includes('https://cdn.example/1-thumb.jpg'), "a video's thumbnail is fetched, not the video");
  const reading = lib.reading('floorwork');
  assert.equal(reading?.state, 'read');
  assert.deepEqual(reading?.state === 'read' && reading.posts[0], { id: '1', caption: 'Rehearsal for the spring piece #contemporarydance', type: 'video', at: '2026-11-14T10:00:00.000Z', url: 'https://www.instagram.com/p/1/' });
});

test('reading an account again fetches only new pictures and lets go of the posts it no longer shows', async () => {
  const { dir, library: lib } = library();
  const first = instagram({ floorwork: graph([['1', 'one'], ['2', 'two']]) });
  await new InstagramReader({ library: lib, connection: CONNECTION, send: first.send, shrink }).read(account('floorwork'));
  const again = instagram({ floorwork: graph([['3', 'three'], ['2', 'two']]) });

  const outcome = await new InstagramReader({ library: lib, connection: CONNECTION, send: again.send, shrink }).read(account('floorwork'));

  assert.equal(outcome.fetched, 1);
  assert.deepEqual(again.asked.filter((url) => url.startsWith('https://cdn.example/')), ['https://cdn.example/3.jpg']);
  assert.deepEqual(readdirSync(join(dir, 'pictures')).sort(), ['2.jpg', '3.jpg']);
  assert.equal(lib.size(), 2);
});

test('an account Instagram cannot read is kept as such, and a call Instagram holds back keeps what was there', async () => {
  const { library: lib } = library();
  const { send } = instagram({ floorwork: graph([['1', 'one']]) });
  const reader = new InstagramReader({ library: lib, connection: CONNECTION, send, shrink });
  await reader.read(account('floorwork'));

  const personal = await reader.read(account('stonemason'));
  const held = await new InstagramReader({ library: lib, connection: CONNECTION, send: instagram({ floorwork: 80002 }).send, shrink }).read(account('floorwork'));

  assert.equal(personal.answer.kind, 'unreadable');
  assert.deepEqual(lib.reading('stonemason'), { state: 'unreadable', at: lib.reading('stonemason')!.at, why: 'Cannot find User' });
  assert.equal(held.answer.kind, 'held');
  assert.equal(lib.reading('floorwork')?.state, 'read', 'a limit reached says nothing about the account');
  assert.equal(lib.size(), 1);
});

test('a library opened again on the same folder holds what was read before', async () => {
  const { dir, assets, library: lib } = library();
  await new InstagramReader({ library: lib, connection: CONNECTION, send: instagram({ floorwork: graph([['1', 'one']]) }).send, shrink }).read(account('floorwork'));

  const reopened = new InstagramLibrary(dir, ACCOUNTS, assets);

  assert.equal(reopened.size(), 1);
  assert.equal(reopened.reading('floorwork')?.state, 'read');
});

async function filled() {
  const made = library();
  const { send } = instagram({
    floorwork: graph([['d1', 'Rehearsal in the new studio'], ['d2', 'Opening night'], ['d3', 'Tour dates are out']]),
    ink_and_paper: graph([['i1', 'A risograph print of the harbour at dawn #risograph'], ['i2', 'Sketchbook pages from the train']]),
    'concrete.lines': graph([['c1', 'Our new library in Porto, a movement of light on concrete'], ['c2', 'Model of the tower #architecture']]),
  });
  const reader = new InstagramReader({ library: made.library, connection: CONNECTION, send, shrink });
  for (const handle of ['floorwork', 'ink_and_paper', 'concrete.lines']) await reader.read(account(handle));
  return made;
}

test('a search finds posts by their caption, hashtags and account, and a category named first', async () => {
  const { library: lib } = await filled();

  assert.deepEqual((await lib.search('risograph harbour')).map((f) => f.url), ['https://www.instagram.com/p/i1/']);
  assert.deepEqual((await lib.search('Concrete Lines')).map((f) => f.by), ['@concrete.lines', '@concrete.lines']);
  const movement = (await lib.search('movement')).map((f) => f.by);
  assert.deepEqual(movement.slice(0, 2), ['@floorwork', '@floorwork'], 'the account listed under Movement comes first, though its captions never say movement');
  assert.ok(movement.includes('@concrete.lines'), 'a post that says movement comes after');
  assert.equal(movement.filter((by) => by === '@floorwork').length, 2, 'no account takes more than two places');
  assert.deepEqual(await lib.search('volcano'), []);
});

test('a search hands back each post with its picture already stored, so nothing is fetched to show it', async () => {
  const { assets, library: lib } = await filled();

  const [post] = await lib.search('risograph');

  assert.deepEqual({ ...post, asset: undefined }, { title: 'Ink and Paper', by: '@ink_and_paper', date: '2026-11-14', text: 'A risograph print of the harbour at dawn #risograph', from: 'Instagram', url: 'https://www.instagram.com/p/i1/', asset: undefined });
  assert.deepEqual([...(await assets.get(post!.asset!))!.bytes], [1, 2, 3, 9]);
  assert.equal((await lib.search('risograph'))[0]!.asset, post!.asset, 'a post found again is not copied again');
});

// ---- pacing and order

test('the usage Instagram reports slows the reads as the hour fills', () => {
  const headers = (h: Record<string, string>) => new Headers(h);
  assert.deepEqual(usageOf(headers({ 'x-app-usage': '{"call_count":12,"total_cputime":3,"total_time":30}' })), { percent: 30, regainMs: 0 });
  assert.deepEqual(
    usageOf(headers({ 'x-business-use-case-usage': '{"1784":[{"type":"instagram","call_count":95,"total_cputime":2,"total_time":4,"estimated_time_to_regain_access":20}]}' })),
    { percent: 95, regainMs: 20 * 60_000 },
  );
  assert.deepEqual(usageOf(headers({})), { percent: 0, regainMs: 0 });

  const waits = [0, 49, 50, 75, 90].map((percent) => paceAfter({ percent, regainMs: 0 }));
  assert.deepEqual(waits, [...waits].sort((a, b) => a - b), 'never faster as usage climbs');
  assert.ok(waits[0]! >= 15_000, 'no more than 240 calls an hour when the limit is far');
  assert.ok(waits[4]! >= 15 * 60_000, 'near the limit, it all but stops');
  assert.equal(paceAfter({ percent: 10, regainMs: 30 * 60_000 }), 30 * 60_000, 'a wait Instagram names is kept');
});

test('accounts never read come first, taking the categories in turn, then each again two days after its read', () => {
  const order = inTurn(ACCOUNTS);
  assert.deepEqual(order.map((a) => a.handle), ['ink_and_paper', 'concrete.lines', 'floorwork', 'stonemason']);

  const now = Date.UTC(2026, 10, 15);
  const due = new Map<string, number>([['ink_and_paper', now + 1000], ['concrete.lines', now + REREAD - 1000]]);
  assert.equal(nextRead(order, (h) => due.get(h), new Map(), now)?.account.handle, 'floorwork');
  assert.equal(nextRead(order, (h) => due.get(h), new Map([['floorwork', now], ['stonemason', now]]), now)?.account.handle, 'ink_and_paper', 'a failed read waits an hour');

  due.set('floorwork', now + REREAD).set('stonemason', now + REREAD);
  assert.deepEqual(nextRead(order, (h) => due.get(h), new Map(), now), { account: account('ink_and_paper'), at: now + 1000 });
});

test('an account is due two days after a full read, and an hour after one that could not keep every picture', async () => {
  const { library: lib } = library();
  const { send } = instagram({ floorwork: graph([['1', 'one'], ['2', 'two']]), ink_and_paper: graph([['3', 'three']]) });
  const brokenCdn = (async (input: string | URL, init?: RequestInit) =>
    String(input) === 'https://cdn.example/2.jpg' ? new Response('', { status: 503 }) : send(input, init)) as typeof fetch;
  const reader = new InstagramReader({ library: lib, connection: CONNECTION, send: brokenCdn, shrink });

  await reader.read(account('floorwork'));
  await reader.read(account('ink_and_paper'));

  const at = (handle: string) => Date.parse(lib.reading(handle)!.at);
  assert.equal(lib.dueAt('floorwork')! - at('floorwork'), 60 * 60_000);
  assert.equal(lib.dueAt('ink_and_paper')! - at('ink_and_paper'), REREAD);
  assert.equal(lib.dueAt('stonemason'), undefined);
  assert.equal(lib.size(), 2);
});

// ---- the source

test('Instagram is offered only with the library, and while it holds posts, as posts from accounts you follow', async () => {
  const model = {} as ModelClient;
  const read = async () => null;
  const offered = (following?: Parameters<typeof makeSources>[0]['following']) => makeSources({ send: fetch, model, read, following }).list().find((s) => s.id === 'instagram');

  assert.equal(offered(), undefined, 'no list or no connection');
  const { library: empty } = library();
  assert.equal(offered(empty), undefined, 'nothing read yet');
  const { library: lib } = await filled();
  const line = offered(lib)!;
  assert.equal(line.goodFor.split('. ')[0], 'Posts from accounts you follow: Prints & Drawing, Buildings, Movement');
  assert.equal(line.visual, true);
});

test('without a list there is no library, and a list is read without the reader when reading is off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-instagram-'));
  const lines: string[] = [];
  const open = (list: string) => openInstagram({ connection: CONNECTION, list, dir, assets: new MemoryAssets(), read: false, log: (line) => lines.push(line) });

  assert.equal(open(join(dir, 'missing.md')), null);
  assert.match(lines[0]!, /no list of accounts/);
  writeFileSync(join(dir, 'list.md'), LIST);
  const opened = open(join(dir, 'list.md'));
  assert.equal(opened?.reader, undefined);
  assert.equal(opened?.library.accounts.length, 4);
  rmSync(dir, { recursive: true, force: true });
});
