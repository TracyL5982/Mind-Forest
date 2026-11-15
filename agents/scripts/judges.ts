/**
 * N simulated judges against a hosted service, each a new device with one voice-free session: open (connect, hello with the
 * starter trees), ask (the suggested questions on a card), search (a Scout run on it, to its first card and its end), and open a
 * card (focus a new pick and fetch its picture). Prints each step's median and slowest, then the service's own count of overflows
 * to OpenAI, spend and errors from /admin.
 * Usage: npm run judges -- --url http://127.0.0.1:8899 [--judges 10] [--spread 20] [--app-key K] [--admin-token T]
 * The keys default to JUDGES_APP_KEY and JUDGES_ADMIN_TOKEN, then to ~/.mind-palace/judging.properties and ~/.mind-palace/admin-token.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:8899' },
    judges: { type: 'string', default: '10' },
    spread: { type: 'string', default: '20' },
    'app-key': { type: 'string' },
    'admin-token': { type: 'string' },
    need: { type: 'string', default: 'something surprising to look at about this' },
    'wait-s': { type: 'string', default: '120' },
  },
});
const home = join(homedir(), '.mind-palace');
const fromFile = (file: string, pattern?: RegExp) => {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  return pattern ? pattern.exec(text)?.[1] : text.trim();
};
const appKey = values['app-key'] ?? process.env.JUDGES_APP_KEY ?? fromFile(join(home, 'judging.properties'), /^\s*appKey\s*=\s*(\S+)/m);
const adminToken = values['admin-token'] ?? process.env.JUDGES_ADMIN_TOKEN ?? fromFile(join(home, 'admin-token'));
if (!appKey) throw new Error('no app key: --app-key, JUDGES_APP_KEY, or appKey= in ~/.mind-palace/judging.properties');
const base = values.url!.replace(/\/+$/, '');
const waitMs = Number(values['wait-s']) * 1000;

interface Msg {
  t: string;
  [k: string]: unknown;
}
type Step = 'open' | 'ask' | 'first card' | 'search done' | 'open a card';
interface Judge {
  n: number;
  times: Partial<Record<Step, number>>;
  trees: number;
  cards: number;
  failed?: string;
  refused?: string;
}

async function judge(n: number): Promise<Judge> {
  const device = `judge-${n}-${randomBytes(8).toString('hex')}`;
  const token = `${appKey}.${device}`;
  const result: Judge = { n, times: {}, trees: 0, cards: 0 };
  const seen: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; done: (m: Msg) => void }[] = [];
  const until = (pred: (m: Msg) => boolean, what: string) =>
    new Promise<Msg>((done, fail) => {
      const hit = seen.find(pred);
      if (hit) return done(hit);
      const timer = setTimeout(() => fail(new Error(`no ${what} in ${waitMs / 1000} s`)), waitMs);
      waiters.push({ pred, done: (m) => (clearTimeout(timer), done(m)) });
    });
  const started = Date.now();
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as Msg;
    seen.push(m);
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.done(m));
  });
  try {
    await new Promise((ok, fail) => (ws.once('open', ok), ws.once('error', fail)));
    const hello = await until((m) => m.t === 'hello', 'hello');
    result.times.open = Date.now() - started;
    const trees = (hello.snapshot as { trees: { rootId: string }[] }).trees;
    result.trees = trees.length;
    const root = trees[0]?.rootId;
    if (!root) throw new Error('no starter tree');

    let at = Date.now();
    ws.send(JSON.stringify({ t: 'questions', nodeId: root }));
    await until((m) => m.t === 'questions' && m.nodeId === root, 'questions');
    result.times.ask = Date.now() - at;

    at = Date.now();
    const scoutEnded = (m: Msg) => m.t === 'activity' && (m.activity as { role: string; state: string; nodeId?: string }).role === 'scout' && (m.activity as { state: string }).state !== 'start' && (m.activity as { whole?: boolean }).whole === true;
    const landed = (m: Msg) => m.t === 'change' && m.yours === true && (m.set as { origin: { role?: string } }).origin.role === 'scout';
    const refused = (m: Msg) => m.t === 'say' && m.yours === true;
    ws.send(JSON.stringify({ t: 'ask', nodeId: root, need: values.need }));
    const first = await until((m) => landed(m) || refused(m) || scoutEnded(m), 'first card');
    if (refused(first)) result.refused = String(first.text);
    if (landed(first)) result.times['first card'] = Date.now() - at;
    if (!refused(first)) {
      await until(scoutEnded, 'end of the search');
      result.times['search done'] = Date.now() - at;
    }
    const picks = seen.filter(landed).flatMap((m) =>
      (m.set as { patches: { entity: string; before: unknown; after: { id: string; parent?: string; itemId?: string } | null }[] }).patches.filter((p) => p.entity === 'node' && p.before === null && p.after?.parent === root),
    );
    result.cards = picks.length;
    const pick = picks[0]?.after;
    if (pick) {
      at = Date.now();
      ws.send(JSON.stringify({ t: 'focus', nodeId: pick.id }));
      const state = (await (await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { snapshot: { items: { id: string; source: { asset?: string }; data: { image?: string } }[] } };
      const item = state.snapshot.items.find((i) => i.id === pick.itemId);
      const picture = item?.data.image ?? (item?.source.asset ? `/assets/${item.source.asset}` : undefined);
      if (picture?.startsWith('/')) await (await fetch(`${base}${picture}${picture.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`)).arrayBuffer();
      result.times['open a card'] = Date.now() - at;
    }
  } catch (err) {
    result.failed = err instanceof Error ? err.message : String(err);
  } finally {
    ws.close();
  }
  return result;
}

const count = Number(values.judges);
const spreadMs = Number(values.spread) * 1000;
console.log(`${count} judges against ${base}, starting over ${spreadMs / 1000} s`);
const results = await Promise.all(
  Array.from({ length: count }, (_, n) => new Promise<Judge>((done) => setTimeout(() => void judge(n + 1).then(done), count > 1 ? (spreadMs * n) / (count - 1) : 0))),
);
const steps: Step[] = ['open', 'ask', 'first card', 'search done', 'open a card'];
for (const r of results) {
  console.log(`judge ${String(r.n).padStart(2)}: ${steps.map((s) => `${s} ${r.times[s] === undefined ? '-' : `${(r.times[s]! / 1000).toFixed(1)}s`}`).join(', ')}; ${r.trees} trees, ${r.cards} new cards${r.refused ? `; refused: ${r.refused}` : ''}${r.failed ? `; FAILED: ${r.failed}` : ''}`);
}
for (const s of steps) {
  const times = results.flatMap((r) => (r.times[s] === undefined ? [] : [r.times[s]!])).sort((a, b) => a - b);
  if (times.length === 0) continue;
  console.log(`${s.padEnd(12)} median ${(times[Math.floor((times.length - 1) / 2)]! / 1000).toFixed(1)} s, slowest ${(times.at(-1)! / 1000).toFixed(1)} s, ${times.length} of ${count}`);
}
console.log(`failed ${results.filter((r) => r.failed).length} of ${count}, refused ${results.filter((r) => r.refused).length}`);
if (adminToken) {
  const status = (await (await fetch(`${base}/admin`, { headers: { Authorization: `Bearer ${adminToken}` } })).json()) as Record<string, unknown>;
  console.log(`service: overflows ${status.overflows}, spent today $${status.spentToday}, Meta tokens ${status.metaTokens}, spaces ${status.spaces}, errors ${(status.errors as { count: number }).count}`);
}
