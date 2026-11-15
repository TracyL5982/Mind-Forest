// What the preview checks share: the fake service on a fresh copy of a data folder, a proxy between it and the preview
// that records what the preview sends and can speak to the preview as the service (a navigate, which the fake service
// never sends), and launching the preview against it with the voice off and muted, so nothing is heard. The fake
// service reads no keys file (MIND_PALACE_ENV is empty). Everything started is stopped, and the copy deleted, however
// the check ends.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const quest = join(here, '../..');
const agents = join(quest, '../agents');
const { WebSocket, WebSocketServer } = createRequire(join(agents, 'package.json'))('ws');

export const flag = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
export const later = (seconds) => new Promise((r) => setTimeout(r, seconds * 1000));
export const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const find = (log, pattern, after = 0) => log.find((l) => l.at >= after && pattern.test(l.line));
export const until = async (log, pattern, after = 0) => {
  for (let i = 0; i < 300; i++) {
    const hit = find(log, pattern, after);
    if (hit) return hit;
    await later(0.1);
  }
  return null;
};

export function checker() {
  const checks = [];
  const check = (ok, what) => {
    checks.push({ ok: Boolean(ok), what });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  };
  const failed = () => checks.filter((c) => !c.ok).length;
  const summary = (where) => `${checks.length - failed()} of ${checks.length} checks passed; pictures and logs in ${where}`;
  return { check, failed, summary };
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** The fake service on a copy of `source`, and the proxy the preview joins through. */
export async function standIn(name, source) {
  if (!source || !existsSync(join(source, 'mindstorm.sqlite'))) throw new Error('--data must name a data folder with a mindstorm.sqlite');
  const work = mkdtempSync(join(tmpdir(), `${name}-`));
  const data = join(work, 'data');
  const previewData = join(work, 'preview');
  mkdirSync(previewData);
  cpSync(source, data, { recursive: true });
  rmSync(join(data, 'service.pid'), { force: true });
  writeFileSync(join(work, 'empty.env'), '');
  // Hex, so the token never starts with a dash, which the launch flags would read as a flag of its own.
  const token = randomBytes(12).toString('hex');

  const started = [];
  const stop = () => {
    for (const child of started) if (child.exitCode === null) child.kill();
  };
  const clean = () => rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => (stop(), setTimeout(() => (clean(), process.exit(1)), 500)));

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
    if (i > 100) {
      stop();
      throw new Error('the fake service did not start');
    }
    await later(0.2);
  }
  const state = async () => (await (await api('/api/state')).json()).snapshot;

  const proxyPort = await freePort();
  let previewSocket = null;
  const fromPreview = [];
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
    down.on('message', (m) => {
      fromPreview.push({ when: Date.now(), message: JSON.parse(String(m)) });
      if (up.readyState === WebSocket.OPEN) up.send(String(m));
      else queued.push(String(m));
    });
    down.on('close', () => up.close());
    up.on('close', () => down.close());
  });
  proxy.listen(proxyPort, '127.0.0.1');

  /** The preview, joined through the proxy, run in real time until `seconds`, with a picture every 2 s into `shots`. */
  function launch(shots, name, seconds, extra) {
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
    const sent = (t) => fromPreview.filter((m) => m.message.t === t && m.when >= began).map((m) => ({ ...m.message, at: (m.when - began) / 1000 }));
    return { log, done, began, sent, at: () => (Date.now() - began) / 1000 };
  }

  async function close() {
    sockets.close();
    proxy.close();
    stop();
    await later(0.5);
    clean();
  }

  return {
    work,
    previewData,
    token,
    servicePort,
    serviceAddress: `http://127.0.0.1:${proxyPort}`,
    api,
    state,
    inject: (message) => previewSocket?.send(JSON.stringify(message)),
    launch,
    close,
    WebSocket,
  };
}
