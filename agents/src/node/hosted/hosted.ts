import { timingSafeEqual } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { PROTOCOL_VERSION } from '../protocol.ts';
import { openSpace, type Meter, type ServerOptions, type Space } from '../server.ts';
import { BOT_API } from '../telegram.ts';
import { LINES, type Ledger } from './ledger.ts';

/** A device names itself with an id it made on first launch. */
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;
/** The paths a device uses. The web page and everything else stay off in hosted mode. */
const DEVICE_PATHS = /^\/(api|assets|handoffs)\//;
const ERRORS_KEPT = 30;

export interface HostedOptions {
  port: number;
  host: string;
  /** The volume: each device's space in `spaces/<device>`, beside the day's ledger. */
  dataDir: string;
  /** A new space starts as a copy of this folder: a few trees and the files they show. */
  starter?: string;
  /** The key built into the judging app. A device's token is `<appKey>.<deviceId>`. */
  appKey: string;
  /** For `/admin`: the status, and the off switch. */
  adminToken: string;
  ledger: Ledger;
  /** What every space shares: the model with its one rate window, the roles, the voice, the keys, the maps. */
  shared: Omit<ServerOptions, 'port' | 'host' | 'dataDir' | 'token' | 'telegram' | 'meter' | 'log'>;
  /** A space with no socket open closes after this long, and opens again on its next request. */
  idleMs?: number;
  /** New devices are refused once this many have a space. */
  maxDevices?: number;
  /** A line in Momo's voice as 16-bit mono PCM at the live voice's rate, for a refusal said without the realtime model. */
  record?: (text: string) => Promise<Uint8Array>;
  log: (line: string) => void;
}

export interface Hosted {
  url: string;
  /** The devices whose spaces are open now. */
  open(): string[];
  close(): Promise<void>;
}

/**
 * Mind Palace for many headsets in one process: each device has its own space (mindstorm, pipeline, live voice) in its own folder
 * on the volume, while the model, its rate window and the source caches are shared. A device is known by the token it sends,
 * `<appKey>.<deviceId>`, everywhere it sent one before, so the app's protocol is unchanged.
 */
export async function startHosted(opts: HostedOptions): Promise<Hosted> {
  const { ledger, log } = opts;
  const spacesDir = join(opts.dataDir, 'spaces');
  mkdirSync(spacesDir, { recursive: true });
  const known = new Set(readdirSync(spacesDir).filter((name) => DEVICE.test(name)));
  const open = new Map<string, { space: Promise<Space>; last: number }>();
  const closing = new Map<string, Promise<void>>();
  const idleMs = opts.idleMs ?? 20 * 60_000;
  const maxDevices = opts.maxDevices ?? 40;
  const started = Date.now();

  const errors: string[] = [];
  let errorCount = 0;
  const note = (line: string) => {
    log(line);
    if (!/\bfail|error|unreadable|gave up/i.test(line)) return;
    errorCount++;
    errors.push(`${new Date().toISOString()} ${line.slice(0, 300)}`);
    if (errors.length > ERRORS_KEPT) errors.shift();
  };

  const recordings = new Map<string, Promise<Uint8Array>>();
  const recorded = (text: string): Promise<Uint8Array | null> => {
    if (!opts.record) return Promise.resolve(null);
    let made = recordings.get(text);
    if (!made) {
      made = opts.record(text);
      recordings.set(text, made);
      made.catch(() => recordings.delete(text));
    }
    return made;
  };

  const meterOf = (device: string): Meter => ({
    refused: (kind) => {
      const why = ledger.refusal(device, kind);
      return why ? LINES[why] : null;
    },
    used: (kind, amount) => ledger.used(device, kind, amount),
    spent: (dollars) => ledger.spend(dollars, device),
    recorded,
  });

  async function spaceOf(device: string): Promise<Space | null> {
    await closing.get(device);
    const there = open.get(device);
    if (there) {
      there.last = Date.now();
      return there.space;
    }
    const dir = join(spacesDir, device);
    if (!known.has(device)) {
      if (known.size >= maxDevices) return null;
      if (opts.starter && existsSync(opts.starter)) cpSync(opts.starter, dir, { recursive: true });
      known.add(device);
      note(`[spaces] new space for ${short(device)}${opts.starter && existsSync(opts.starter) ? ', from the starter trees' : ''}`);
    }
    const space = openSpace({ ...opts.shared, dataDir: dir, token: `${opts.appKey}.${device}`, meter: meterOf(device), log: (line) => note(`[${short(device)}] ${line}`) });
    open.set(device, { space, last: Date.now() });
    space.catch((err) => {
      open.delete(device);
      note(`[spaces] ${short(device)} failed to open: ${String(err)}`);
    });
    return space;
  }

  /** A space and its folder gone, as for a load test's devices. A request after this starts the device afresh. */
  async function forget(device: string): Promise<void> {
    await closing.get(device);
    const entry = open.get(device);
    open.delete(device);
    const space = await entry?.space.catch(() => null);
    if (space) {
      await space.pipeline.idle();
      await space.close();
    }
    rmSync(join(spacesDir, device), { recursive: true, force: true });
    known.delete(device);
  }

  const sweep = setInterval(() => {
    for (const [device, entry] of open) {
      void entry.space.then((space) => {
        if (space.online() > 0 || Date.now() - entry.last < idleMs || open.get(device) !== entry) return;
        open.delete(device);
        const done = space.pipeline
          .idle()
          .then(() => space.close())
          .then(() => note(`[spaces] ${short(device)} closed after ${Math.round(idleMs / 60_000)} idle minutes`))
          .finally(() => closing.delete(device));
        closing.set(device, done);
      });
    }
  }, Math.min(60_000, idleMs));
  sweep.unref();

  const deviceOf = (req: IncomingMessage, url: URL): string | null => {
    const given = [
      req.headers.authorization?.replace(/^Bearer\s+/i, ''),
      url.searchParams.get('token'),
      /(?:^|;\s*)mp_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1],
    ].find((t): t is string => typeof t === 'string' && t.length > 0);
    if (!given) return null;
    const dot = given.indexOf('.');
    const device = given.slice(dot + 1);
    return dot > 0 && equal(given.slice(0, dot), opts.appKey) && DEVICE.test(device) ? device : null;
  };

  const status = async () => {
    const spaces = await Promise.all(
      [...open].map(async ([device, entry]) => {
        const space = await entry.space.catch(() => null);
        return { device: short(device), online: space?.online() ?? 0, trees: space?.mind.trees.size ?? 0, idleS: Math.round((Date.now() - entry.last) / 1000) };
      }),
    );
    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      uptimeS: Math.round((Date.now() - started) / 1000),
      spaces: known.size,
      maxDevices,
      devicesOnline: spaces.filter((s) => s.online > 0).length,
      open: spaces,
      ...ledger.status(),
      errors: { count: errorCount, last: errors.slice(-10) },
    };
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, protocol: PROTOCOL_VERSION });
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      const given = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
      if (!equal(given, opts.adminToken)) return json(res, 401, { error: 'missing or wrong admin token' });
      const deleting = /^\/admin\/spaces\/([^/]+)$/.exec(url.pathname)?.[1];
      if (req.method === 'DELETE' && deleting) {
        if (!DEVICE.test(deleting) || !known.has(deleting)) return json(res, 404, { error: 'no such space' });
        await forget(deleting);
        note(`[admin] deleted the space of ${short(deleting)}`);
        return json(res, 200, await status());
      }
      if (url.pathname !== '/admin') return json(res, 404, { error: 'not found' });
      if (req.method === 'POST') {
        const off = url.searchParams.get('off');
        if (off !== '1' && off !== '0') return json(res, 400, { error: 'POST /admin?off=1 switches costly work off, ?off=0 on again' });
        ledger.setOff(off === '1');
        note(`[admin] switched ${off === '1' ? 'off' : 'on'}`);
      }
      return json(res, 200, await status());
    }
    if (!DEVICE_PATHS.test(url.pathname)) return json(res, 404, { error: 'not found' });
    const device = deviceOf(req, url);
    if (!device) return json(res, 401, { error: 'missing or wrong token' });
    if (url.pathname === '/api/speak' || url.pathname === '/api/transcribe') {
      const why = ledger.refusal(device, 'voiceMs');
      if (why) return json(res, 429, { error: LINES[why] });
    }
    const space = await spaceOf(device);
    if (!space) return json(res, 403, { error: 'this service has all the headsets it can take' });
    await space.serve(req, res);
  }

  const http = createServer((req, res) => {
    void route(req, res).catch((err) => {
      note(`[hosted] http error: ${String(err)}`);
      if (!res.headersSent) json(res, 500, { error: 'the service failed' });
      else res.end();
    });
  });
  http.on('upgrade', (req, socket, head) => {
    const refuse = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
      socket.destroy();
    };
    const device = deviceOf(req, new URL(req.url ?? '/', 'http://localhost'));
    if (!device) return refuse('401 Unauthorized');
    void spaceOf(device).then(
      (space) => (space ? space.upgrade(req, socket, head) : refuse('403 Forbidden')),
      () => refuse('500 Internal Server Error'),
    );
  });

  await new Promise<void>((ready) => http.listen(opts.port, opts.host, ready));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  return {
    url: `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${port}`,
    open: () => [...open.keys()],
    async close() {
      clearInterval(sweep);
      await Promise.all([...closing.values()]);
      for (const [, entry] of open) await (await entry.space.catch(() => null))?.close();
      open.clear();
      ledger.flush();
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}

/** A message to the user's paired Telegram chat through their bot. It only sends: the user's Mac keeps reading the bot. */
export function telegramAlert(opts: { token: string; chatId: string; log: (line: string) => void; api?: string }): (text: string) => void {
  return (text) =>
    void fetch(`${opts.api ?? BOT_API}/bot${opts.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: opts.chatId, text }),
      signal: AbortSignal.timeout(15_000),
    }).then(
      (res) => opts.log(res.ok ? `[alert] sent: ${text}` : `[alert] Telegram answered ${res.status}: ${text}`),
      (err) => opts.log(`[alert] failed: ${String(err)}: ${text}`),
    );
}

const short = (device: string) => device.slice(0, 8);

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
