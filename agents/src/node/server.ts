import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ModelClient } from '../core/ports.ts';
import { Pipeline, type Outbound } from '../core/pipeline.ts';
import { DEFAULT_SETTINGS, type Handoff, type Roles, type Settings } from '../core/roles/types.ts';
import { Mindstorm } from '../core/state.ts';
import { DiskAssets } from './assets.ts';
import { ClientMessage, PROTOCOL_VERSION } from './protocol.ts';
import type { Speak } from './speech-openai.ts';
import { SqliteStore } from './store.ts';
import { makeTools } from './tools.ts';
import { zip } from './zip.ts';

export interface ServerOptions {
  port: number;
  host: string;
  dataDir: string;
  clientDir: string;
  model: ModelClient;
  roles: Roles;
  /** Every request must carry it. Generated and saved under dataDir when absent. */
  token?: string;
  instagram?: { token: string; userId: string };
  keys?: Record<string, string | undefined>;
  /** Reads a reply aloud. Without it the client uses the browser's own voice. */
  speak?: Speak;
  settings?: Partial<Settings>;
  log?: (line: string) => void;
}

export interface Running {
  url: string;
  token: string;
  pipeline: Pipeline;
  mind: Mindstorm;
  close(): Promise<void>;
}

const MAX_UPLOAD = 300 * 1024 * 1024;
const MAX_SPOKEN = 1200;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export async function startServer(opts: ServerOptions): Promise<Running> {
  const log = opts.log ?? (() => {});
  mkdirSync(opts.dataDir, { recursive: true });
  const token = opts.token ?? savedToken(join(opts.dataDir, 'token'));
  const store = new SqliteStore(join(opts.dataDir, 'mindstorm.sqlite'));
  const assets = new DiskAssets(join(opts.dataDir, 'assets'));
  const handoffDir = join(opts.dataDir, 'handoffs');
  mkdirSync(handoffDir, { recursive: true });

  const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
  mind.load(store.all());
  const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const sockets = new Set<WebSocket>();
  const broadcast = (message: unknown) => {
    const text = JSON.stringify(message);
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(text);
  };

  const emit = (message: Outbound) => {
    if (message.t === 'handoff') {
      void bundle(message.handoff).then(
        (made) => broadcast({ t: 'handoff', ...made }),
        (err) => broadcast({ t: 'note', role: 'packager', message: `failed: ${String(err)}` }),
      );
      return;
    }
    if (message.t === 'note') log(`[${message.role}] ${message.message}`);
    if (message.t === 'activity') log(`[${message.activity.role}] ${message.activity.state}: ${message.activity.message}`);
    broadcast(message.t === 'change' ? { ...message, undo: pipeline.undoLabel() } : message);
  };

  const pipeline = new Pipeline({
    mind,
    roles: opts.roles,
    model: opts.model,
    tools: makeTools({ model: opts.model, assets, instagram: opts.instagram, keys: opts.keys }),
    assets,
    store,
    settings,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    emit,
  });

  async function bundle(handoff: Handoff): Promise<{ name: string; url: string; markdown: string; files: string[] }> {
    const name = handoff.name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'handoff';
    const files: { name: string; bytes: Uint8Array }[] = [
      { name: `${name}/handoff.md`, bytes: new TextEncoder().encode(handoff.markdown) },
      { name: `${name}/handoff.json`, bytes: new TextEncoder().encode(JSON.stringify(handoff.json, null, 2)) },
    ];
    for (const id of handoff.assets) {
      const asset = await assets.get(id);
      if (asset) files.push({ name: `${name}/assets/${id}`, bytes: asset.bytes });
    }
    writeFileSync(join(handoffDir, `${name}.zip`), zip(files));
    writeFileSync(join(handoffDir, `${name}.md`), handoff.markdown);
    return { name, url: `/handoffs/${name}.zip`, markdown: handoff.markdown, files: files.map((f) => f.name) };
  }

  const authorized = (req: IncomingMessage, url: URL): boolean => {
    const header = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const cookie = /(?:^|;\s*)mp_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    return [header, url.searchParams.get('token'), cookie].some((given) => given !== undefined && given !== null && equal(given, token));
  };

  const http: Server = createServer((req, res) => {
    void route(req, res).catch((err) => {
      log(`http error: ${String(err)}`);
      if (!res.headersSent) json(res, 500, { error: String(err instanceof Error ? err.message : err) });
      else res.end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const guarded = path.startsWith('/api/') || path.startsWith('/assets/') || path.startsWith('/handoffs/');
    if (path === '/api/health') return json(res, 200, { ok: true, protocol: PROTOCOL_VERSION });
    if (guarded && !authorized(req, url)) return json(res, 401, { error: 'missing or wrong token' });
    if (guarded) res.setHeader('Set-Cookie', `mp_token=${token}; Path=/; HttpOnly; SameSite=Lax`);

    if (req.method === 'POST' && path === '/api/assets') {
      const bytes = await body(req, MAX_UPLOAD);
      const mime = req.headers['content-type'] ?? 'application/octet-stream';
      const { id } = await assets.put(bytes, mime, url.searchParams.get('name') ?? undefined);
      return json(res, 200, { id, url: assets.url(id), mime: mime.split(';')[0] });
    }
    if (req.method === 'POST' && path === '/api/transcribe') {
      const audio = await body(req, 25 * 1024 * 1024);
      const text = await opts.model.transcribe({ audio, mime: req.headers['content-type'] ?? 'audio/wav' });
      return json(res, 200, { text });
    }
    if (req.method === 'GET' && path === '/api/speak') {
      const text = (url.searchParams.get('text') ?? '').slice(0, MAX_SPOKEN).trim();
      if (!opts.speak || !text) return json(res, 404, { error: 'no voice' });
      const stop = new AbortController();
      res.on('close', () => stop.abort());
      const audio = await opts.speak(text, stop.signal);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
      const reader = audio.getReader();
      try {
        for (let part = await reader.read(); !part.done; part = await reader.read()) res.write(part.value);
      } catch (err) {
        if (!stop.signal.aborted) throw err;
      }
      res.end();
      return;
    }
    if (req.method === 'GET' && path === '/api/state') return json(res, 200, { snapshot: mind.snapshot(), settings });
    if (req.method === 'GET' && path.startsWith('/assets/')) {
      const id = path.slice('/assets/'.length);
      const asset = await assets.get(id);
      if (!asset) return json(res, 404, { error: 'no such asset' });
      return ranged(req, res, asset.bytes, asset.mime);
    }
    if (req.method === 'GET' && path.startsWith('/handoffs/')) {
      const file = join(handoffDir, normalize(path.slice('/handoffs/'.length)).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(handoffDir) || !existsSync(file)) return json(res, 404, { error: 'no such handoff' });
      res.writeHead(200, {
        'Content-Type': file.endsWith('.zip') ? 'application/zip' : 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.split('/').pop()}"`,
      });
      res.end(readFileSync(file));
      return;
    }
    if (req.method === 'GET') return serveStatic(res, opts.clientDir, path);
    json(res, 404, { error: 'not found' });
  }

  const wss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws' || !authorized(req, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    sockets.add(ws);
    ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, snapshot: mind.snapshot(), settings, undo: pipeline.undoLabel(), voice: Boolean(opts.speak) }));
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = ClientMessage.parse(JSON.parse(String(raw)));
      } catch (err) {
        ws.send(JSON.stringify({ t: 'error', message: `bad message: ${String(err instanceof Error ? err.message : err).slice(0, 300)}` }));
        return;
      }
      void handle(message).catch((err) => ws.send(JSON.stringify({ t: 'error', message: String(err instanceof Error ? err.message : err) })));
    });
  });

  async function handle(m: ClientMessage): Promise<void> {
    switch (m.t) {
      case 'dump':
        await pipeline.dump(m.dumps);
        return;
      case 'utter':
        pipeline.utter(m.text, m.scene, m.final);
        return;
      case 'focus':
        pipeline.focus(m.nodeId);
        return;
      case 'ask':
        await pipeline.ask(m.nodeId, m.need);
        return;
      case 'more':
        await pipeline.more(m.nodeId, m.need);
        return;
      case 'keep':
        pipeline.keep(m.nodeIds);
        return;
      case 'undo':
        pipeline.undo(m.id);
        return;
      case 'commands':
        pipeline.userCommands(m.label, m.commands);
        return;
      case 'organize':
        broadcast({ t: 'say', text: await pipeline.organize(m.request, m.scope, m.focus) });
        return;
      case 'handoff':
        await pipeline.handoff(m.scope, m.note);
        return;
      case 'settings':
        pipeline.setSettings(m.patch);
        return;
    }
  }

  await new Promise<void>((ready) => http.listen(opts.port, opts.host, ready));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  return {
    url: `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${port}`,
    token,
    pipeline,
    mind,
    async close() {
      for (const ws of sockets) ws.terminate();
      wss.close();
      await new Promise<void>((done) => http.close(() => done()));
      store.close();
    },
  };
}

function savedToken(path: string): string {
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const token = randomBytes(18).toString('base64url');
  writeFileSync(path, token, { mode: 0o600 });
  return token;
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('upload too large');
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Video elements ask for byte ranges, and some browsers refuse to play without them. */
function ranged(req: IncomingMessage, res: ServerResponse, bytes: Uint8Array, mime: string): void {
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable' };
  if (!match) {
    res.writeHead(200, { ...base, 'Content-Length': bytes.length });
    res.end(bytes);
    return;
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
  if (start > end || start >= bytes.length) {
    res.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` });
    res.end();
    return;
  }
  res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 });
  res.end(bytes.subarray(start, end + 1));
}

function serveStatic(res: ServerResponse, dir: string, path: string): void {
  const root = resolve(dir);
  const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
}
