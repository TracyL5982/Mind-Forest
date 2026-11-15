/**
 * The Instagram library, by hand.
 *
 *   instagram.ts read <data dir> [count]   reads that many accounts, the list's categories in turn, paced as the service paces them
 *   instagram.ts report <data dir>         what the library holds: accounts that cannot be read, posts, bytes, captions worth searching
 *   instagram.ts search <data dir> <words> what a search of it hands the Scout
 *
 * The list is MIND_PALACE_INSTAGRAM_LIST, by default ~/.mind-palace/instagram-following.md. The library is `<data dir>/instagram`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../src/node/env.ts';
import { captionUseful, InstagramLibrary, InstagramReader, inTurn, paceAfter, parseList, said } from '../src/node/instagram.ts';
import { DiskAssets } from '../src/node/assets.ts';

const env = loadEnv();
const [mode, dataDir, ...rest] = process.argv.slice(2);
if (!mode || !dataDir) {
  console.error('usage: instagram.ts read|report|search <data dir> ...');
  process.exit(1);
}
const listed = parseList(readFileSync(env.MIND_PALACE_INSTAGRAM_LIST || join(homedir(), '.mind-palace', 'instagram-following.md'), 'utf8'));
const dir = join(dataDir, 'instagram');
const library = new InstagramLibrary(dir, listed, new DiskAssets(join(dataDir, 'assets')));

if (mode === 'read') {
  if (!env.META_IG_TOKEN || !env.META_IG_USER_ID) throw new Error('META_IG_TOKEN and META_IG_USER_ID are not set');
  const reader = new InstagramReader({ library, connection: { token: env.META_IG_TOKEN, userId: env.META_IG_USER_ID } });
  const accounts = inTurn(listed).slice(0, Number(rest[0] ?? 30));
  for (const [n, account] of accounts.entries()) {
    const outcome = await reader.read(account);
    console.log(`${n + 1}/${accounts.length} @${account.handle} (${account.categories.join(', ')}): ${said(outcome)} [usage ${JSON.stringify(outcome.usage)}]`);
    const wait = Math.max(paceAfter(outcome.usage), outcome.answer.kind === 'held' ? outcome.answer.ms : 0);
    if (n < accounts.length - 1) await new Promise((resolve) => setTimeout(resolve, wait));
  }
} else if (mode === 'report') {
  const readings = listed.accounts.map((a) => ({ account: a, reading: library.reading(a.handle) }));
  const read = readings.filter((r) => r.reading?.state === 'read');
  const unreadable = readings.filter((r) => r.reading?.state === 'unreadable');
  const posts = read.flatMap((r) => (r.reading?.state === 'read' ? r.reading.posts : []));
  const pictures = readdirSync(join(dir, 'pictures')).filter((f) => f.endsWith('.jpg'));
  const bytes = pictures.reduce((n, f) => n + statSync(join(dir, 'pictures', f)).size, 0);
  const types = posts.reduce<Record<string, number>>((n, p) => ({ ...n, [p.type]: (n[p.type] ?? 0) + 1 }), {});
  const useful = posts.filter((p) => captionUseful(p.caption)).length;
  const pct = (a: number, b: number) => `${b ? ((100 * a) / b).toFixed(1) : '0'}%`;
  console.log(`accounts: ${listed.accounts.length} listed, ${read.length} read, ${unreadable.length} cannot be read, ${listed.accounts.length - read.length - unreadable.length} not read yet`);
  for (const { account, reading } of unreadable) console.log(`  cannot be read: @${account.handle} (${account.categories.join(', ')}): ${reading?.state === 'unreadable' ? reading.why : ''}`);
  console.log(`posts: ${posts.length} (${Object.entries(types).map(([t, n]) => `${n} ${t}`).join(', ')}), ${(posts.length / Math.max(1, read.length)).toFixed(1)} an account read`);
  console.log(`pictures: ${pictures.length}, ${(bytes / 1e6).toFixed(1)} MB, ${Math.round(bytes / Math.max(1, pictures.length) / 1024)} KB each`);
  console.log(`captions worth searching (five words or more besides hashtags): ${useful} of ${posts.length}, ${pct(useful, posts.length)}`);
  for (const category of listed.categories) {
    const inIt = read.filter((r) => r.account.categories.includes(category));
    const of = inIt.flatMap((r) => (r.reading?.state === 'read' ? r.reading.posts : []));
    console.log(`  ${category}: ${inIt.length} accounts read, ${of.length} posts, captions worth searching ${pct(of.filter((p) => captionUseful(p.caption)).length, of.length)}`);
  }
} else if (mode === 'search') {
  const started = performance.now();
  const found = await library.search(rest.join(' '));
  console.log(`${found.length} found in ${(performance.now() - started).toFixed(1)} ms among ${library.size()} posts`);
  for (const f of found) console.log(`  ${f.by} ${f.date} ${f.url} ${f.text.replace(/\s+/g, ' ').slice(0, 100)}`);
} else {
  console.error(`no mode "${mode}"`);
  process.exit(1);
}
