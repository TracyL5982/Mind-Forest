// Runs the Mac preview twice against the fake service on a fresh copy of a data folder, and checks from the preview's
// log, the files it writes and the service's state that the service's trees keep the shelf's rules:
//   launch 1   nothing stands, every tree hangs as a cover; one cover is carried along the shelf
//   launch 2   each cover hangs where it hung, the carried one where it was put; a navigate to a tree on the shelf
//              unfolds it; a tree asked for by another client only hangs, and not at the standing tree's place; a tree
//              asked for from the preview (-agentType) presses the standing one back to its place and stands; a tree
//              deleted at the service drops its spot
// The headset's own shelf file, seeded before the first launch, must be left as it was. The preview runs with
// -agentVoice off and -mute, so nothing is heard. The fake service reads no keys file (MIND_PALACE_ENV is empty).
// A small proxy between the preview and the service sends the navigate, which the fake service never does.
//
//   quest/desktop/build.sh && node quest/desktop/test/shelf_check.mjs --data <data folder> [--shots <folder>]
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const quest = join(here, '../..');
const agents = join(quest, '../agents');
const { WebSocket, WebSocketServer } = createRequire(join(agents, 'package.json'))('ws');

const flag = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const source = flag('--data');
if (!source || !existsSync(join(source, 'mindstorm.sqlite'))) throw new Error('--data must name a data folder with a mindstorm.sqlite');
const work = mkdtempSync(join(tmpdir(), 'shelf-check-'));
const shots = flag('--shots', join(work, 'shots'));
mkdirSync(shots, { recursive: true });
const data = join(work, 'data');
const previewData = join(work, 'preview');
mkdirSync(previewData);
cpSync(source, data, { recursive: true });
rmSync(join(data, 'service.pid'), { force: true });
writeFileSync(join(work, 'empty.env'), '');
const token = randomBytes(12).toString('base64url');
const ownShelf = JSON.stringify({ version: 3, films: 0, trees: [], seeded: 'the headset keeps its own trees here' });
writeFileSync(join(previewData, 'ocean-shelf.json'), ownShelf);

const later = (seconds) => new Promise((r) => setTimeout(r, seconds * 1000));
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const started = [];
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: Boolean(ok), what });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// The fake service, on the copy.
const servicePort = await freePort();
const service = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'src/node/main.ts', '--fake'], {
  cwd: agents,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, MIND_PALACE_ENV: join(work, 'empty.env'), MIND_PALACE_DATA: data, MIND_PALACE_PORT: String(servicePort), MIND_PALACE_TOKEN: token },
  stdio: ['ignore', openSync(join(work, 'service.log'), 'w'), openSync(join(work, 'service.log'), 'a')],
});
started.push(service);
console.log(`fake service ${service.pid} on ${servicePort}, data copied to ${data}`);
const api = (path, init = {}) => fetch(`http://127.0.0.1:${servicePort}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } });
for (let i = 0; ; i++) {
  if (await fetch(`http://127.0.0.1:${servicePort}/api/health`).then((r) => r.ok, () => false)) break;
  if (i > 100) throw new Error('the fake service did not start');
  await later(0.2);
}
const state = async () => (await (await api('/api/state')).json()).snapshot;
const before = await state();
const newestFirst = [...before.trees].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

// The proxy: the preview's socket and HTTP pass through it to the service; `inject` speaks to the preview as the service.
const proxyPort = await freePort();
let previewSocket = null;
const proxy = createServer((req, res) => {
  const upstream = request({ host: '127.0.0.1', port: servicePort, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  upstream.on('error', () => res.destroy());
  req.pipe(upstream);
});
const sockets = new WebSocketServer({ server: proxy, path: '/ws' });
sockets.on('connection', (down, req) => {
  const up = new WebSocket(`ws://127.0.0.1:${servicePort}${req.url}`);
  const queued = [];
  previewSocket = down;
  up.on('message', (m) => down.send(String(m)));
  up.on('open', () => queued.splice(0).forEach((m) => up.send(m)));
  down.on('message', (m) => (up.readyState === WebSocket.OPEN ? up.send(String(m)) : queued.push(String(m))));
  down.on('close', () => up.close());
  up.on('close', () => down.close());
});
proxy.listen(proxyPort, '127.0.0.1');
const inject = (message) => previewSocket?.send(JSON.stringify(message));

const spotsFile = join(previewData, 'agent-shelf.json');
const readSpots = () => (existsSync(spotsFile) ? JSON.parse(readFileSync(spotsFile, 'utf8')).services[`http://127.0.0.1:${proxyPort}`] ?? {} : {});

function launch(name, seconds, extra) {
  const log = [];
  const began = Date.now();
  const args = ['-agent', `ws://127.0.0.1:${proxyPort}`, '-agentToken', token, '-cards', '-mute', '-agentVoice', 'off', '-dataDir', previewData, '-realtime',
    '-shot', join(shots, `${name}.png`), '-shotAt', String(seconds), '-shotEvery', '2', ...extra];
  const preview = spawn(join(quest, 'desktop/preview'), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  started.push(preview);
  let partial = '';
  preview.stderr.on('data', (chunk) => {
    const lines = (partial + chunk).split('\n');
    partial = lines.pop();
    for (const line of lines) if (/^\[(agent|ocean)\]/.test(line)) log.push({ at: (Date.now() - began) / 1000, line });
  });
  const done = new Promise((resolve) => preview.on('exit', resolve));
  return { log, done, began, at: () => (Date.now() - began) / 1000 };
}
const find = (log, pattern, after = 0) => log.find((l) => l.at >= after && pattern.test(l.line));
const until = async (log, pattern, after = 0) => {
  for (let i = 0; i < 300; i++) {
    const hit = find(log, pattern, after);
    if (hit) return hit;
    await later(0.1);
  }
  return null;
};
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

try {
  // Launch 1.
  const first = launch('launch1', 14, ['-carryAt', '8', '-carry', '0', '-carryRight', '0.1', '-carryUp', '0.05']);
  await first.done;
  const joined = find(first.log, /^\[agent\] connected: (\d+) trees/);
  check(joined && Number(/(\d+) trees/.exec(joined.line)[1]) === before.trees.length, `launch 1 joined the service and its ${before.trees.length} trees (${joined?.line})`);
  check(!find(first.log, /^\[agent\] went to |was asked for here|^\[ocean\] put away/), 'launch 1: nothing stands');
  const carried = find(first.log, /^\[ocean\] carrying the cover of (.*) by flag$/);
  const carriedTitle = carried && /cover of (.*) by flag$/.exec(carried.line)[1];
  check(carriedTitle === newestFirst[0].title, `the first cover on the shelf is the newest tree, "${newestFirst[0].title}" (carried: "${carriedTitle}")`);
  const spots1 = readSpots();
  check(before.trees.every((t) => spots1[t.id]), `every tree's spot is written down (${Object.keys(spots1).length} of ${before.trees.length})`);
  // OceanModel::shelfSpots, in the order freeSpot tries them.
  const usual = [[-39, 24], [-13, 24], [13, 24], [39, 24], [-64, 22], [64, 22], [-26, 37], [0, 37], [26, 37]].map(String);
  const carriedSpot = spots1[newestFirst[0].id];
  check(carriedSpot && !usual.includes(String(carriedSpot)), `the carried cover is kept where it was put, not at a usual place (${carriedSpot})`);
  const places = newestFirst.slice(1).map((t) => ({ t, k: usual.indexOf(String(spots1[t.id])) }));
  const inOrder = places.every((p, i) => p.k >= 1 && (i === 0 || p.k > places[i - 1].k || p.t.createdAt === places[i - 1].t.createdAt));
  check(inOrder && new Set(places.map((p) => p.k)).size === places.length, `the others hang at the usual places from the second on, a newer tree at an earlier one (${places.map((p) => `${p.t.title}: ${spots1[p.t.id]}`).join(' | ')})`);

  // Launch 2.
  const gone = newestFirst[newestFirst.length - 1];
  const goTo = newestFirst[1];
  const second = launch('launch2', 40, ['-agentType', 'start%20a%20tree%20about%20dolly%20zooms', '-agentTypeAt', '20']);
  const joined2 = await until(second.log, /^\[agent\] connected/);
  await later(4);
  const navigated = second.at();
  inject({ t: 'navigate', treeId: goTo.id });
  const wentTo = await until(second.log, new RegExp(`^\\[agent\\] went to .* in "${escape(goTo.title)}"`), navigated);
  await later(2);
  const elsewhere = new WebSocket(`ws://127.0.0.1:${servicePort}/ws?token=${token}`);
  await new Promise((r) => elsewhere.on('open', r));
  const dumped = second.at();
  elsewhere.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: the long take in Children of Men' }] }));
  const asked = await until(second.log, /^\[agent\] "(.*)" was asked for here, so it stands$/, dumped);
  await later(3);
  const deleted = second.at();
  elsewhere.send(JSON.stringify({ t: 'commands', label: 'Delete a tree', commands: [{ type: 'deleteTree', id: gone.id }] }));
  await second.done;
  elsewhere.close();

  const stood = find(second.log, /^\[agent\] went to |was asked for here|^\[ocean\] put away/);
  check(joined2 && (!stood || stood.at >= navigated), `launch 2: nothing stands until a navigate comes (first stand at ${stood?.at.toFixed(1)} s, navigate at ${navigated.toFixed(1)} s)`);
  check(wentTo && wentTo.at - navigated < 4, `a navigate to "${goTo.title}" on the shelf unfolds it (${wentTo ? (wentTo.at - navigated).toFixed(1) + ' s' : 'never'})`);
  const meanwhile = second.log.filter((l) => l.at >= dumped && l.at < (asked?.at ?? 999));
  check(find(meanwhile, /^\[agent\] tree ".*long take.*": \d+ cards/i), 'the tree asked for by another client reaches the preview');
  check(!find(meanwhile, /was asked for here|^\[ocean\] put away/), `and only hangs: "${goTo.title}" stays up, nothing is pressed for it`);
  check(asked && /dolly zoom/i.test(asked.line), `the tree typed for on the preview stands (${asked?.line})`);
  const putAway = find(second.log, new RegExp(`^\\[ocean\\] put away: ${escape(goTo.title)}$`), asked?.at ?? 999);
  check(putAway && putAway.at - asked.at < 1, `and "${goTo.title}" pressed itself onto the shelf first (${putAway ? (putAway.at - asked.at).toFixed(2) + ' s after' : 'never'})`);
  check(find(second.log, new RegExp(`^\\[agent\\] tree "${escape(gone.title)}" was deleted at the service`), deleted), `"${gone.title}" was deleted at the service`);

  const spots2 = readSpots();
  const after = await state();
  check(String(spots2[newestFirst[0].id]) === String(carriedSpot), `the carried cover hung where it was put, across the restart (${spots2[newestFirst[0].id]})`);
  check(String(spots2[goTo.id]) === String(spots1[goTo.id]), `"${goTo.title}" went back to its own place (${spots2[goTo.id]})`);
  check(!(gone.id in spots2), `the deleted tree's spot is dropped (${Object.keys(spots2).length} spots)`);
  const longTake = after.trees.find((t) => /long take/i.test(t.title));
  check(longTake && spots2[longTake.id] && !Object.entries(spots2).some(([id, s]) => id !== longTake.id && String(s) === String(spots2[longTake.id])), `the other client's tree hangs at a place of its own (${longTake && spots2[longTake.id]})`);
  check(readFileSync(join(previewData, 'ocean-shelf.json'), 'utf8') === ownShelf, "the headset's own shelf file is as it was");
  writeFileSync(join(shots, 'log-launch1.txt'), first.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
  writeFileSync(join(shots, 'log-launch2.txt'), second.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
  writeFileSync(join(shots, 'spots.json'), JSON.stringify({ launch1: spots1, launch2: spots2, trees: after.trees.map((t) => ({ id: t.id, title: t.title, createdAt: t.createdAt })) }, null, 2));
} finally {
  for (const child of started) if (child.exitCode === null) child.kill();
  sockets.close();
  proxy.close();
  await later(0.5);
  rmSync(work, { recursive: true, force: true });
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed} of ${checks.length} checks passed; pictures and logs in ${shots}`);
process.exit(failed ? 1 : 0);
