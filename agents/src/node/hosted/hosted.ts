import { timingSafeEqual } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statfsSync } from 'node:fs';
import { createServer, STATUS_CODES, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, posix } from 'node:path';
import type { Duplex } from 'node:stream';
import { PROTOCOL_VERSION } from '../protocol.ts';
import { openSpace, type Meter, type ServerOptions, type Space } from '../server.ts';
import type { InstagramLibrary, InstagramReader } from '../instagram.ts';
import { publicFetch } from '../public-fetch.ts';
import { BOT_API } from '../telegram.ts';
import { forDevice, LINES, type Ledger } from './ledger.ts';
import { JudgeTelegram, type JudgeBotOptions } from './judges.ts';
import { DeviceModel } from './overflow.ts';

/** A device names itself with an id it made on first launch. */
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;
/** The paths a device uses. The web page and everything else stay off in hosted mode. */
const DEVICE_PATHS = /^\/(api|assets|handoffs)\//;
const ERRORS_KEPT = 30;
/**
 * What a made picture costs: fal's Meta Muse Image at $0.01 a picture, as fal's model page lists it (read through a search,
 * 15 Nov 2026). The Meta API's own muse-image-1.0, the fallback, has no listed price and is counted the same.
 */
export const PICTURE_DOLLARS = 0.01;

/**
 * Most one change may store in a space. A text dump at the 1 MB message limit stores about 2.0 MB, its words in the commands and
 * again in the item, and a 1 MB `commands` message on a card at EDIT_BYTES stores the card before and after besides. A change past
 * this is refused, so a device's mindstorm passes its store limit by at most this much.
 */
export const SET_BYTES = 2_500_000;

/**
 * Spaces in all, and new ones an hour: near the number of judges (about 10), since the app's key is in the APK and a device names
 * itself, so one person can make many devices, each with its own share of the day's cap.
 */
export const MAX_DEVICES = 20;
export const NEW_DEVICES_PER_HOUR = 10;

/** Below this much free on the volume, which every space and the ledger share, nothing new is written: no upload, change or space. */
export const MIN_FREE_BYTES = 300e6;
/** A space fetches a page or a picture from an address it was given only on the public internet: never this machine or Fly's network. */
const PUBLIC_ONLY = publicFetch();
const VOLUME_FULL = 'The service is nearly out of room, so nothing more can be added for now. Everything here still opens.';

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
  /** What every space shares: the model with its one rate window, the roles, the voice, the keys, the maps. Its Instagram account, if any, is not passed on (`spaceOptions`). */
  shared: Omit<ServerOptions, 'port' | 'host' | 'dataDir' | 'token' | 'telegram' | 'meter' | 'log'>;
  /** A space with no socket open closes after this long, and opens again on its next request. */
  idleMs?: number;
  /** New devices are refused once this many have a space. */
  maxDevices?: number;
  /** New devices are refused once this many were made in the last hour, so a script with the app's key cannot take every slot at once. */
  newPerHour?: number;
  /** The largest upload, and what one device's uploads may come to in all, in bytes. */
  uploads?: { file: number; total: number };
  /** What a made picture costs, in dollars; another fal model than the default is priced otherwise. */
  pictureDollars?: number;
  /** The user's Instagram accounts, opened once: every space searches this one library, and only its reader, if any, reads Instagram. */
  following?: { library: InstagramLibrary; reader?: InstagramReader };
  /** What one device's mindstorm and handoffs may come to on disk, in bytes, before every message that writes is refused. */
  storeLimit?: number;
  /** What the files the service keeps for one device may come to, in bytes: pictures fetched, made or copied in. Uploads are apart. */
  madeLimit?: number;
  /** What is free on the volume, in bytes. Defaults to the file system's own count. */
  freeBytes?: () => number;
  /** Which limits the service was deployed with, for `/admin`: `judging`, or `testing` with no per-device daily limits. */
  mode?: string;
  /** The judges' own Telegram bot, which this service alone reads. Without it no space has Telegram. */
  judgeBot?: Omit<JudgeBotOptions, 'log'>;
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
  const maxDevices = opts.maxDevices ?? MAX_DEVICES;
  const newPerHour = opts.newPerHour ?? NEW_DEVICES_PER_HOUR;
  const uploads = opts.uploads ?? { file: 25e6, total: 40e6 };
  /** When each device of the last hour was made. */
  const born: number[] = [];
  const started = Date.now();
  const freeBytes = opts.freeBytes ?? (() => {
    const fs = statfsSync(opts.dataDir);
    return fs.bavail * fs.bsize;
  });
  const volumeFull = () => (freeBytes() < MIN_FREE_BYTES ? VOLUME_FULL : null);

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
    paused: () => {
      const why = ledger.paused();
      return why ? LINES[why] : null;
    },
    held: () => {
      const why = ledger.held(device);
      return why ? LINES[why] : null;
    },
    pictured: () => ledger.spend(opts.pictureDollars ?? PICTURE_DOLLARS, device),
    recorded,
  });

  /** A chat's message opens only the space of a device that has one: Telegram never makes a device. */
  const judges = opts.judgeBot
    ? new JudgeTelegram({ ...opts.judgeBot, file: join(opts.dataDir, 'judge-telegram.json'), log: note, open: async (device) => known.has(device) && !('error' in (await spaceOf(device))) })
    : null;

  async function spaceOf(device: string): Promise<Space | { status: number; error: string }> {
    await closing.get(device);
    const there = open.get(device);
    if (there) {
      there.last = Date.now();
      return there.space;
    }
    const dir = join(spacesDir, device);
    if (!known.has(device)) {
      if (volumeFull()) return { status: 507, error: VOLUME_FULL };
      if (known.size >= maxDevices) return { status: 403, error: 'this service has all the headsets it can take' };
      while (born.length > 0 && born[0]! < Date.now() - 3_600_000) born.shift();
      if (born.length >= newPerHour) return { status: 429, error: 'too many new headsets this hour; try again later' };
      born.push(Date.now());
      if (opts.starter && existsSync(opts.starter)) cpSync(opts.starter, dir, { recursive: true });
      known.add(device);
      note(`[spaces] new space for ${short(device)}${opts.starter && existsSync(opts.starter) ? ', from the starter trees' : ''}`);
    }
    const model = new DeviceModel(opts.shared.model, device, () => {
      const why = ledger.held(device);
      return why ? LINES[why] : null;
    });
    const space = openSpace({ ...spaceOptions(opts, device), model, volumeFull, meter: meterOf(device), uploads, contact: judges?.channel(device), log: (line) => note(`[${short(device)}] ${line}`) });
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
    judges?.forget(device);
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
        return { device, online: space?.online() ?? 0, trees: space?.mind.trees.size ?? 0, idleS: Math.round((Date.now() - entry.last) / 1000) };
      }),
    );
    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      mode: opts.mode ?? 'judging',
      uptimeS: Math.round((Date.now() - started) / 1000),
      spaces: known.size,
      maxDevices,
      newThisHour: born.filter((at) => at >= Date.now() - 3_600_000).length,
      newPerHour,
      known: [...known],
      telegram: judges?.status() ?? null,
      instagram: opts.following ? { posts: opts.following.library.size(), reading: Boolean(opts.following.reader) } : null,
      devicesOnline: spaces.filter((s) => s.online > 0).length,
      open: spaces,
      ...ledger.status(),
      errors: { count: errorCount, last: errors.slice(-10) },
    };
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Every check here reads the path as a space will: decoded, then with its dot segments resolved.
    let path: string;
    try {
      path = posix.normalize(decodeURIComponent(url.pathname));
    } catch {
      return json(res, 400, { error: 'a path that does not decode' });
    }
    if (path === '/api/health') return json(res, 200, { ok: true, protocol: PROTOCOL_VERSION });
    if (path === '/admin' || path.startsWith('/admin/')) {
      const given = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
      if (!equal(given, opts.adminToken)) return json(res, 401, { error: 'missing or wrong admin token' });
      const deleting = /^\/admin\/spaces\/([^/]+)$/.exec(path)?.[1];
      if (req.method === 'DELETE' && deleting) {
        if (!DEVICE.test(deleting) || !known.has(deleting)) return json(res, 404, { error: 'no such space' });
        await forget(deleting);
        note(`[admin] deleted the space of ${short(deleting)}`);
        return json(res, 200, await status());
      }
      if (path !== '/admin') return json(res, 404, { error: 'not found' });
      if (req.method === 'POST') {
        const off = url.searchParams.get('off');
        if (off !== '1' && off !== '0') return json(res, 400, { error: 'POST /admin?off=1 switches costly work off, ?off=0 on again' });
        ledger.setOff(off === '1');
        note(`[admin] switched ${off === '1' ? 'off' : 'on'}`);
      }
      return json(res, 200, await status());
    }
    if (!DEVICE_PATHS.test(path)) return json(res, 404, { error: 'not found' });
    const device = deviceOf(req, url);
    if (!device) return json(res, 401, { error: 'missing or wrong token' });
    const space = await spaceOf(device);
    if ('error' in space) return json(res, space.status, { error: space.error });
    await space.serve(req, res);
  }

  const http = createServer((req, res) => {
    void route(req, res).catch((err) => {
      note(`[hosted] http error: ${String(err)}`);
      if (!res.headersSent) json(res, 500, { error: 'the service failed' });
      else res.end();
    });
  });
  http.on('upgrade', upgradeWhenOpen((req) => deviceOf(req, new URL(req.url ?? '/', 'http://localhost')), spaceOf, log));

  await new Promise<void>((ready) => http.listen(opts.port, opts.host, ready));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  judges?.start();
  return {
    url: `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${port}`,
    open: () => [...open.keys()],
    async close() {
      clearInterval(sweep);
      await judges?.close();
      opts.following?.reader?.stop();
      await Promise.all([...closing.values()]);
      for (const [, entry] of open) await (await entry.space.catch(() => null))?.close();
      open.clear();
      ledger.flush();
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}

/**
 * Hands a socket's upgrade to its device's space once the space is open, which can take a while when it is closing first. Node takes
 * its own error listener off the socket before an upgrade, so one is put on for the wait, and taken off just before the space has the
 * socket, as the ws README does for an upgrade handled later: a socket reset in the wait would otherwise end the process.
 */
export function upgradeWhenOpen(
  deviceOf: (req: IncomingMessage) => string | null,
  spaceOf: (device: string) => Promise<Space | { status: number; error: string }>,
  log: (line: string) => void,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    const heard = (err: Error) => log(`[hosted] a socket went while its space opened: ${err.message}`);
    socket.on('error', heard);
    const refuse = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
      socket.destroy();
    };
    const device = deviceOf(req);
    if (!device) return refuse('401 Unauthorized');
    void spaceOf(device).then(
      (space) => {
        if ('error' in space) return refuse(`${space.status} ${STATUS_CODES[space.status]}`);
        socket.removeListener('error', heard);
        space.upgrade(req, socket, head);
      },
      () => refuse('500 Internal Server Error'),
    );
  };
}

/**
 * What a device's space is opened with: the shared parts, less what a judge's space must never have. No Telegram bot of its own,
 * since the user's Mac reads their bot and two readers take each other's messages: a space's Telegram is the judges' bot, which
 * `startHosted` gives it as its contact. No Instagram account of the user's, neither its token nor their own
 * posts: a space searches the one shared library, whose reader alone holds the account. No web page: static files come from a folder
 * that is never made.
 */
export function spaceOptions(opts: Pick<HostedOptions, 'shared' | 'dataDir' | 'appKey' | 'following' | 'storeLimit' | 'madeLimit'>, device: string): Omit<ServerOptions, 'port' | 'host'> {
  const live = opts.shared.live;
  const answer = live?.webAnswer;
  return {
    ...opts.shared,
    // A web answer runs as this device's work, so what it costs is counted to the device's share (`forDevice`).
    ...(live && answer ? { live: { ...live, webAnswer: (question: string) => forDevice.run(device, () => answer(question)) } } : {}),
    telegram: undefined,
    instagram: undefined,
    library: opts.following?.library,
    storeLimit: opts.storeLimit ?? 20e6,
    madeLimit: opts.madeLimit ?? 60e6,
    setBytes: SET_BYTES,
    fetchPage: PUBLIC_ONLY,
    clientDir: join(opts.dataDir, 'no-web-page'),
    dataDir: join(opts.dataDir, 'spaces', device),
    token: `${opts.appKey}.${device}`,
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
