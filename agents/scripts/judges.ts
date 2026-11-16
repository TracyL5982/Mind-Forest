/**
 * N simulated judges against a hosted service, each a new device with one voice-free session: open (connect and hello), search
 * (a Scout run: on the first starter tree when there is one, else a new tree on a subject of its own, timed to its first card, its
 * last and its end), ask (the suggested questions on the tree's root), and open a card (focus a new pick and fetch its picture).
 * Prints each judge's times, each step's median and slowest, then the service's own count of overflows to OpenAI, spend and errors
 * from /admin. Each judge's space is deleted at the end unless --keep.
 * Usage: npm run judges -- --url http://127.0.0.1:8899 [--judges 10] [--spread 20] [--app-key K] [--admin-token T] [--keep]
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
    keep: { type: 'boolean', default: false },
    'settle-s': { type: 'string', default: '60' },
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

/** What a judge with no tree starts one on, a different subject each, as different judges would. */
const SUBJECTS = [
  "Vermeer's use of light",
  'Brutalist libraries',
  'Film scores by Ennio Morricone',
  'Deep sea bioluminescence',
  'Japanese woodblock prints of waves',
  'The history of the bicycle',
  'Mid-century modern chairs',
  'Coral reef restoration',
  'Bauhaus typography',
  'Silent film comedians',
];

interface Msg {
  t: string;
  [k: string]: unknown;
}
type Step = 'open' | 'first card' | 'last card' | 'search done' | 'ask' | 'open a card';
interface Judge {
  n: number;
  device: string;
  how: string;
  times: Partial<Record<Step, number>>;
  trees: number;
  cards: number;
  failed?: string;
  refused?: string;
  /** What the service said failed: an `error` message, or a role's `failed` note. */
  errors: string[];
}
type Patch = { entity: string; before: unknown; after: { id: string; parent?: string | null; itemId?: string; rootId?: string } | null };

async function judge(n: number): Promise<Judge> {
  const device = `judge-${n}-${randomBytes(8).toString('hex')}`;
  const token = `${appKey}.${device}`;
  const result: Judge = { n, device, how: '', times: {}, trees: 0, cards: 0, errors: [] };
  const seen: Msg[] = [];
  const arrived = new Map<Msg, number>();
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
    arrived.set(m, Date.now());
    if (m.t === 'error' || (m.t === 'note' && String(m.message).startsWith('failed'))) result.errors.push(String(m.message).slice(0, 160));
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.done(m));
  });
  const patches = (m: Msg) => (m.t === 'change' ? (m.set as { patches: Patch[] }).patches : []);
  try {
    await new Promise((ok, fail) => (ws.once('open', ok), ws.once('error', fail)));
    const hello = await until((m) => m.t === 'hello', 'hello');
    result.times.open = Date.now() - started;
    const trees = (hello.snapshot as { trees: { rootId: string }[] }).trees;
    result.trees = trees.length;

    const at = Date.now();
    const landed = (m: Msg) => m.t === 'change' && m.yours === true && (m.set as { origin: { role?: string } }).origin.role === 'scout';
    const refused = (m: Msg) => m.t === 'say' && m.yours === true && m.kind === 'reply';
    let root = trees[0]?.rootId;
    if (root) {
      result.how = 'ask on a starter tree';
      ws.send(JSON.stringify({ t: 'ask', nodeId: root, need: values.need }));
    } else {
      const subject = SUBJECTS[(n - 1) % SUBJECTS.length]!;
      result.how = `new tree: ${subject}`;
      ws.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: `Start a tree on this: ${subject}` }] }));
      const made = await until((m) => patches(m).some((p) => p.entity === 'tree' && p.before === null), 'new tree');
      root = patches(made).find((p) => p.entity === 'tree' && p.before === null)!.after!.rootId!;
    }
    const scoutEnded = (m: Msg) => {
      const a = m.activity as { role?: string; state?: string; nodeId?: string; whole?: boolean } | undefined;
      return m.t === 'activity' && a?.role === 'scout' && a.state !== 'start' && a.whole === true && a.nodeId === root;
    };
    const first = await until((m) => landed(m) || refused(m) || scoutEnded(m), 'first card');
    if (refused(first)) result.refused = String(first.text);
    if (landed(first)) result.times['first card'] = arrived.get(first)! - at;
    if (!refused(first)) {
      await until(scoutEnded, 'end of the search');
      result.times['search done'] = Date.now() - at;
      const last = Math.max(...seen.filter(landed).map((m) => arrived.get(m)!));
      if (Number.isFinite(last)) result.times['last card'] = last - at;
    }

    const asked = Date.now();
    ws.send(JSON.stringify({ t: 'questions', nodeId: root }));
    await until((m) => m.t === 'questions' && m.nodeId === root, 'questions');
    result.times.ask = Date.now() - asked;

    const picks = seen.filter(landed).flatMap((m) => patches(m).filter((p) => p.entity === 'node' && p.before === null && p.after?.parent === root));
    result.cards = picks.length;
    const pick = picks[0]?.after;
    if (pick) {
      const opened = Date.now();
      ws.send(JSON.stringify({ t: 'focus', nodeId: pick.id }));
      const state = (await (await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { snapshot: { items: { id: string; source: { asset?: string }; data: { image?: string } }[] } };
      const item = state.snapshot.items.find((i) => i.id === pick.itemId);
      const picture = item?.data.image ?? (item?.source.asset ? `/assets/${item.source.asset}` : undefined);
      if (picture?.startsWith('/')) await (await fetch(`${base}${picture}${picture.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`)).arrayBuffer();
      result.times['open a card'] = Date.now() - opened;
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
const steps: Step[] = ['open', 'first card', 'last card', 'search done', 'ask', 'open a card'];
const seconds = (ms: number | undefined) => (ms === undefined ? '-' : `${(ms / 1000).toFixed(1)}s`);
for (const r of results) {
  console.log(
    `judge ${String(r.n).padStart(2)} (${r.how}): ${steps.map((s) => `${s} ${seconds(r.times[s])}`).join(', ')}; ${r.trees} trees at start, ${r.cards} new cards` +
      `${r.refused ? `; refused: ${r.refused}` : ''}${r.failed ? `; FAILED: ${r.failed}` : ''}${r.errors.length ? `; errors: ${r.errors.join(' / ')}` : ''}`,
  );
}
for (const s of steps) {
  const times = results.flatMap((r) => (r.times[s] === undefined ? [] : [r.times[s]!])).sort((a, b) => a - b);
  if (times.length === 0) continue;
  console.log(`${s.padEnd(12)} median ${seconds(times[Math.floor((times.length - 1) / 2)])}, slowest ${seconds(times.at(-1))}, ${times.length} of ${count}`);
}
console.log(`failed ${results.filter((r) => r.failed).length} of ${count}, refused ${results.filter((r) => r.refused).length}, with errors ${results.filter((r) => r.errors.length).length}`);
if (adminToken) {
  const admin = (path: string, method = 'GET') => fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${adminToken}` } });
  const status = (await (await admin('/admin')).json()) as Record<string, unknown>;
  const errors = status.errors as { count: number; last: string[] };
  console.log(`service: overflows ${status.overflows}, spent today $${status.spentToday}, Meta tokens ${status.metaTokens}, spaces ${status.spaces}, errors ${errors.count}`);
  for (const line of errors.last) console.log(`  ${line}`);
  if (!values.keep) {
    // A picture the Scout is still making lands after its run has ended, and would find its space gone.
    await new Promise((r) => setTimeout(r, Number(values['settle-s']) * 1000));
    const deleted = await Promise.all(results.map(async (r) => (await admin(`/admin/spaces/${r.device}`, 'DELETE')).status));
    console.log(`deleted ${deleted.filter((s) => s === 200).length} of ${count} judges' spaces`);
  }
}
