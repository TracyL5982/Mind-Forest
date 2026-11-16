import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Readable, type Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ModelClient, Tools } from '../core/ports.ts';
import { Pipeline, type Outbound } from '../core/pipeline.ts';
import { DEFAULT_SETTINGS, type Handoff, type Playback, type Roles, type Settings } from '../core/roles/types.ts';
import { Mindstorm } from '../core/state.ts';
import { spokenName, withoutWakePhrase } from '../core/wake.ts';
import { DiskAssets } from './assets.ts';
import { whereItWent, type Delivery, type Desk } from './contact.ts';
import { landedCards, nameOf, runTool, toolLabel, toolSpecs, whereNote } from '../core/voice-tools.ts';
import { LiveVoice, RATE, type LiveOptions, type OpenRealtime, type VoiceFrame } from './live.ts';
import type { Maps } from './geocoder.ts';
import { ClientMessage, DeviceFrame, PROTOCOL_VERSION } from './protocol.ts';
import { HEARING_DOLLARS_PER_MINUTE, heardMs, SPEECH_DOLLARS_PER_MINUTE, spokenMs, type Speak, type Transcribe } from './speech-openai.ts';
import type { WebAnswer } from './web-answer.ts';
import { SqliteStore } from './store.ts';
import { Telegram, type TelegramOptions } from './telegram.ts';
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
  /** Turns recorded speech into text, told the card titles. When present the client records instead of using the browser's recognition. */
  transcribe?: Transcribe;
  /** Momo's real-time voice on `/live`: the realtime model, how it is set up, and its web answers. Without it `/live` is refused. */
  live?: { open: OpenRealtime; options: LiveOptions; webAnswer?: WebAnswer };
  settings?: Partial<Settings>;
  /** Maps switched on. Without it no place is looked up and clients are told to load no tiles. */
  maps?: Maps;
  /** The only folder a linked file may be served from. Defaults to the repository's `public/clips/full`. */
  films?: string;
  /** Mind Palace as a Telegram contact, reached with this bot's token. */
  telegram?: Omit<TelegramOptions, 'desk' | 'file' | 'log'>;
  /** Hosted mode: what this space's device may still do today, and where its use and spend are counted. */
  meter?: Meter;
  /** Hosted mode: the largest file one upload may be, and what this space's uploads may come to in all, in bytes. */
  uploads?: { file: number; total: number };
  log?: (line: string) => void;
}

/** What a device's day is counted in: minutes of voice with Momo both ways, Scout runs, and Momo's web answers. */
export type Metered = 'voiceMs' | 'searches' | 'webAnswers';

export interface Meter {
  /** The short line Momo says when this kind of work is refused now, or null when it may go ahead. */
  refused(kind: Metered): string | null;
  used(kind: Metered, amount: number): void;
  spent(dollars: number): void;
  /** The line Momo says while all costly work is stopped (switched off, or over the day's cap), or null. */
  paused(): string | null;
  /** A picture was made, on whichever model made it: counted at the price of one. */
  pictured(): void;
  /** A line said in Momo's voice, as 16-bit mono PCM at the live voice's rate, when it can be made. */
  recorded(text: string): Promise<Uint8Array | null>;
}

/** One device's mindstorm, pipeline and voice, answering the requests a listener hands it. */
export interface Space {
  token: string;
  pipeline: Pipeline;
  mind: Mindstorm;
  /** Answers one request. The caller has checked nothing. */
  serve(req: IncomingMessage, res: ServerResponse): Promise<void>;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Sockets open on it now. */
  online(): number;
  close(): Promise<void>;
}

/** The voice tools that start a Scout run. */
const SEARCHING = new Set(['find_new', 'more_like_this', 'start_tree']);
/** `/live` sockets one metered space keeps: a headset reconnecting while its old socket lingers. A newer one closes the oldest. */
const LIVE_PER_SPACE = 2;

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
  '.wasm': 'application/wasm',
};

export async function startServer(opts: ServerOptions): Promise<Running> {
  const space = await openSpace(opts);
  const http: Server = createServer((req, res) => void space.serve(req, res));
  http.on('upgrade', (req, socket, head) => space.upgrade(req, socket, head));
  await new Promise<void>((ready) => http.listen(opts.port, opts.host, ready));
  // Another process writing this data folder while the service runs would corrupt it. `npm run import-library` checks for this file.
  const lock = join(opts.dataDir, 'service.pid');
  writeFileSync(lock, String(process.pid));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  return {
    url: `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${port}`,
    token: space.token,
    pipeline: space.pipeline,
    mind: space.mind,
    async close() {
      await space.close();
      await new Promise<void>((done) => http.close(() => done()));
      rmSync(lock, { force: true });
    },
  };
}

export async function openSpace(opts: Omit<ServerOptions, 'port' | 'host'>): Promise<Space> {
  const log = opts.log ?? (() => {});
  const meter = opts.meter;
  mkdirSync(opts.dataDir, { recursive: true });
  const token = opts.token ?? savedToken(join(opts.dataDir, 'token'));
  const store = new SqliteStore(join(opts.dataDir, 'mindstorm.sqlite'));
  const assets = new DiskAssets(join(opts.dataDir, 'assets'), '', opts.films);
  const handoffDir = join(opts.dataDir, 'handoffs');
  mkdirSync(handoffDir, { recursive: true });
  /** What this space's uploads come to, kept beside them so a restart does not forget it. Only counted when `uploads` caps it. */
  const uploadedFile = join(opts.dataDir, 'uploads.json');
  const uploaded: { bytes: number; files: number } = existsSync(uploadedFile) ? JSON.parse(readFileSync(uploadedFile, 'utf8')) : { bytes: 0, files: 0 };
  const keepUploaded = (bytes: number) => {
    uploaded.bytes += bytes;
    uploaded.files += 1;
    writeFileSync(uploadedFile, JSON.stringify(uploaded));
  };

  const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
  mind.load(store.all());
  const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const maps = opts.maps ? { tiles: opts.maps.tiles, credit: opts.maps.credit, link: opts.maps.link } : null;
  const sockets = new Set<WebSocket>();
  /** What each connection said it can play. A connection that has not said is taken to be a browser. */
  const plays = new Map<WebSocket, Playback>();
  const playback = (): Playback => {
    const said = [...plays.values()];
    const files = said.length === 0 ? [] : said.map((p) => p.files).reduce((both, next) => both.filter((ext) => next.includes(ext)));
    return { embeds: said.every((p) => p.embeds), files };
  };
  /** Each connection's id, which its hello tells it, so its `/live` socket can name it. */
  const connections = new Map<string, WebSocket>();
  /** The live voice of the device on each connection, once its `/live` socket names it. */
  const voices = new Map<WebSocket, LiveVoice>();
  /**
   * Who the work under way was started by: a connection's message or its device's live voice. Its changes and navigates are marked
   * `yours` to that connection alone, and its voice hears what the work does.
   */
  const asking = new AsyncLocalStorage<{ ws?: WebSocket; voice?: LiveVoice }>();
  const broadcast = (message: object, yours?: WebSocket) => {
    const text = JSON.stringify(message);
    for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(ws === yours ? JSON.stringify({ ...message, yours: true }) : text);
  };

  const emit = (message: Outbound) => {
    if (message.t === 'handoff') {
      void bundle(message.handoff).then(
        (made) => {
          broadcast({ t: 'handoff', ...made });
          void telegram?.deliver({ title: message.handoff.title, file: `${made.name}.md`, markdown: message.handoff.markdown });
        },
        (err) => broadcast({ t: 'note', role: 'packager', message: `failed: ${String(err)}` }),
      );
      return;
    }
    const asker = asking.getStore();
    if (message.t === 'note') log(`[${message.role}] ${message.message}`);
    if (message.t === 'activity') log(`[${message.activity.role}] ${message.activity.state}: ${message.activity.message}`);
    if (message.t === 'change') broadcast({ ...message, undo: pipeline.undoLabel() }, asker?.ws);
    else if (message.t === 'navigate') broadcast(message, asker?.ws);
    else broadcast(message);
    asker?.voice?.observed(message);
  };

  const pipeline = new Pipeline({
    mind,
    roles: meter ? metered(opts.roles, meter) : opts.roles,
    model: opts.model,
    tools: chargedPictures(makeTools({ model: opts.model, assets, instagram: opts.instagram, keys: opts.keys, geocoder: opts.maps?.geocoder, spent: meter && ((dollars) => meter.spent(dollars)) }), meter),
    assets,
    store,
    settings,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    emit,
    playback,
  });
  pipeline.resume();

  const desk: Desk = {
    dump: async (dumps) => whereItWent(mind, await pipeline.dump(dumps)),
    keep: async (bytes, mime, name) => (await assets.put(bytes, mime, name)).id,
    transcribe: opts.transcribe && (async (audio, mime) =>
      withoutWakePhrase(await opts.transcribe!(audio, mime, { name: spokenName(settings.agentName), words: likelyWords(mind, null) }), settings.agentName).trim()),
    latest: () => latestHandoff(handoffDir),
  };
  const telegram = opts.telegram ? new Telegram({ ...opts.telegram, desk, file: join(opts.dataDir, 'telegram.json'), log }) : null;
  const contact = () => ({ available: telegram !== null, ...(telegram?.status() ?? { ready: false, paired: null }) });

  async function bundle(handoff: Handoff): Promise<{ name: string; url: string; markdown: string; files: string[] }> {
    const name = handoff.name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'handoff';
    const files: { name: string; bytes: Uint8Array }[] = [
      { name: `${name}/handoff.md`, bytes: new TextEncoder().encode(handoff.bundled) },
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

  const serve = (req: IncomingMessage, res: ServerResponse): Promise<void> =>
    route(req, res).catch((err) => {
      if (err instanceof TooLarge && !res.headersSent) return json(res, 413, { error: err.message });
      log(`http error: ${String(err)}`);
      if (!res.headersSent) json(res, 500, { error: String(err instanceof Error ? err.message : err) });
      else res.end();
    });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const guarded = path.startsWith('/api/') || path.startsWith('/assets/') || path.startsWith('/handoffs/');
    if (path === '/api/health') return json(res, 200, { ok: true, protocol: PROTOCOL_VERSION });
    if (guarded && !authorized(req, url)) return json(res, 401, { error: 'missing or wrong token' });
    if (guarded) res.setHeader('Set-Cookie', `mp_token=${token}; Path=/; HttpOnly; SameSite=Lax`);

    if (req.method === 'POST' && path === '/api/assets') {
      const limit = opts.uploads?.file ?? MAX_UPLOAD;
      const declared = Number(req.headers['content-length'] ?? 0) || 0;
      const roomLeft = opts.uploads ? opts.uploads.total - uploaded.bytes : Infinity;
      if (declared > limit) return json(res, 413, { error: `a file may be at most ${Math.round(limit / 1e6)} MB here` });
      if (declared > roomLeft) return json(res, 413, { error: FULL });
      const bytes = await body(req, Math.min(limit, roomLeft), roomLeft < limit ? FULL : undefined);
      const mime = req.headers['content-type'] ?? 'application/octet-stream';
      const { id } = await assets.put(bytes, mime, url.searchParams.get('name') ?? undefined);
      if (opts.uploads) keepUploaded(bytes.length);
      return json(res, 200, { id, url: assets.url(id), mime: mime.split(';')[0] });
    }
    if (req.method === 'POST' && path === '/api/transcribe') {
      const why = meter?.refused('voiceMs');
      if (why) return json(res, 429, { error: why });
      const audio = await body(req, 25 * 1024 * 1024);
      const mime = req.headers['content-type'] ?? 'audio/wav';
      const ms = heardMs(audio, mime);
      meter?.used('voiceMs', ms);
      meter?.spent((ms / 60_000) * HEARING_DOLLARS_PER_MINUTE);
      const heard = opts.transcribe
        ? await opts.transcribe(audio, mime, { name: spokenName(settings.agentName), words: likelyWords(mind, url.searchParams.get('tree')) })
        : await opts.model.transcribe({ audio, mime });
      return json(res, 200, { text: withoutWakePhrase(heard, settings.agentName).trim() });
    }
    if (req.method === 'GET' && path === '/api/speak') {
      const why = meter?.refused('voiceMs');
      if (why) return json(res, 429, { error: why });
      const text = (url.searchParams.get('text') ?? '').slice(0, MAX_SPOKEN).trim();
      if (!opts.speak || !text) return json(res, 404, { error: 'no voice' });
      const ms = spokenMs(text);
      meter?.used('voiceMs', ms);
      meter?.spent((ms / 60_000) * SPEECH_DOLLARS_PER_MINUTE);
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
    if (req.method === 'GET' && path === '/api/state') return json(res, 200, { snapshot: mind.snapshot(), settings, maps });
    if (req.method === 'GET' && path === '/api/telegram') return json(res, 200, contact());
    if (req.method === 'POST' && path === '/api/telegram/pair') {
      if (!telegram) return json(res, 404, { error: 'TELEGRAM_BOT_TOKEN is not set' });
      const link = telegram.pair();
      return link ? json(res, 200, { link }) : json(res, 503, { error: 'Telegram has not answered yet' });
    }
    if (req.method === 'POST' && path === '/api/telegram/unpair') {
      telegram?.unpair();
      return json(res, 200, contact());
    }
    if (req.method === 'GET' && path.startsWith('/assets/')) {
      const stored = assets.open(path.slice('/assets/'.length));
      if (!stored) return json(res, 404, { error: 'no such asset' });
      if ('url' in stored) return relay(req, res, stored.url, stored.mime);
      if ('bytes' in stored) return ranged(req, res, stored.mime, stored.bytes.length, (start, end) => res.end(stored.bytes.subarray(start, end + 1)));
      return ranged(req, res, stored.mime, stored.size, (start, end) => void createReadStream(stored.file, { start, end }).on('error', () => res.destroy()).pipe(res));
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
  const liveWss = new WebSocketServer({ noServer: true });
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const refuse = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
      socket.destroy();
    };
    if (!authorized(req, url)) return refuse('401 Unauthorized');
    if (url.pathname === '/ws') return wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    if (url.pathname === '/live' && opts.live) return liveWss.handleUpgrade(req, socket, head, (ws) => liveWss.emit('connection', ws, req));
    refuse('404 Not Found');
  };

  /** Each connection's `/live` socket, for a line said in Momo's recorded voice there. */
  const liveOf = new Map<WebSocket, WebSocket>();
  let lines = 0;
  /** A refusal Momo says on the device's `/live` socket from a recording, so a refused device costs no realtime model. */
  const sayRecorded = async (live: WebSocket, text: string) => {
    const id = `line-${++lines}`;
    const send = (frame: VoiceFrame) => live.readyState === live.OPEN && live.send(JSON.stringify(frame));
    send({ t: 'text', id, text, kind: 'reply' });
    const pcm = await meter?.recorded(text).catch(() => null);
    const piece = (RATE / 10) * 2;
    if (pcm) for (let at = 0; at < pcm.length; at += piece) send({ t: 'audio', id, pcm: Buffer.from(pcm.subarray(at, at + piece)).toString('base64') });
    send({ t: 'done', id });
  };
  /** A refusal told to the connection that asked: in Momo's recorded voice when it has `/live`, else as a reply it reads aloud. */
  const decline = (ws: WebSocket, text: string) => {
    log(`[limits] refused: ${text}`);
    const live = liveOf.get(ws);
    if (live) void sayRecorded(live, text);
    else ws.send(JSON.stringify({ t: 'say', text, kind: 'reply', yours: true }));
  };

  liveWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const live = opts.live!;
    if (meter) for (const old of [...liveWss.clients].slice(0, Math.max(0, liveWss.clients.size - LIVE_PER_SPACE))) old.close(4000, 'a newer voice connection replaced this one');
    /** The device's own connection, as its hello named it: what Momo starts is that connection's, and Momo hears of its work. */
    const own = connections.get(new URL(req.url ?? '/', 'http://localhost').searchParams.get('connection') ?? '');
    const webAnswer: typeof live.webAnswer = live.webAnswer && meter
      ? async (question) => {
          const why = meter.refused('webAnswers');
          if (why) throw new Error(why);
          meter.used('webAnswers', 1);
          return live.webAnswer!(question);
        }
      : live.webAnswer;
    /** Audio is counted as 16-bit mono: the device's at 16 kHz, Momo's at the live voice's rate. */
    const counted = (pcm: string, rate: number) => meter?.used('voiceMs', ((pcm.length * 3) / 4 / 2 / rate) * 1000);
    const voice: LiveVoice = new LiveVoice(
      {
        open: live.open,
        options: live.options,
        name: () => spokenName(settings.agentName),
        words: (scene) => likelyWords(mind, scene.treeId ?? null),
        tools: toolSpecs,
        call: (name, args, scene, said) => {
          const why = SEARCHING.has(name) ? meter?.refused('searches') : null;
          if (why) return Promise.resolve({ error: why });
          return asking.run({ ws: own, voice }, () => runTool(name, args, { pipeline, scene, webAnswer, said }));
        },
        label: toolLabel,
        where: (scene) => whereNote(pipeline.ctx, scene),
        cards: (set) => landedCards(mind, set),
        nameOf: (nodeId) => (mind.nodes.has(nodeId) ? nameOf(mind.itemOf(nodeId)) : 'this card'),
        spoken: (turn) => pipeline.spoken(turn),
        // Momo's own steps (a web search) are this device's alone: another headset's orb would show it working.
        activity: (activity) => {
          log(`[momo] ${activity.state}: ${activity.label}`);
          if (own && own.readyState === own.OPEN) own.send(JSON.stringify({ t: 'activity', activity }));
        },
        spent: (dollars) => meter?.spent(dollars),
        log,
      },
      (frame) => {
        if (frame.t === 'audio') {
          counted(frame.pcm, RATE);
          const why = meter?.refused('voiceMs');
          if (why) return cut(why, frame.id);
        }
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
      },
    );
    if (own) {
      voices.set(own, voice);
      liveOf.set(own, ws);
    }
    ws.on('close', () => {
      if (own && voices.get(own) === voice) voices.delete(own);
      if (own && liveOf.get(own) === ws) liveOf.delete(own);
      voice.close();
    });
    /** The turn being refused: its audio goes nowhere, and it is over at once. */
    let refusedTurn: number | null = null;
    /** The turn the device is in, from its `start` to its `end`. */
    let turn: number | null = null;
    let cutting = false;
    /**
     * The voice limit, the cap or the off switch came in the middle of a turn or an answer: the turn is over, the answer ends, the
     * realtime session closes so nothing more costs, and Momo says why from a recording. The next `start` opens a session again if allowed.
     */
    const cut = (why: string, answer?: string) => {
      if (cutting) return;
      cutting = true;
      log(`[limits] refused in the middle of a turn: ${why}`);
      const send = (frame: VoiceFrame) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(frame));
      if (turn !== null) {
        send({ t: 'over', turn });
        refusedTurn = turn;
      }
      if (answer) send({ t: 'done', id: answer });
      setImmediate(() => voice.close());
      void sayRecorded(ws, why);
    };
    ws.on('message', (raw) => {
      let frame: DeviceFrame;
      try {
        frame = DeviceFrame.parse(JSON.parse(String(raw)));
      } catch {
        // The error would quote the frame, and a frame may be the user's voice.
        log(`[live] a frame that is not one (${String(raw).length} bytes)`);
        return;
      }
      if (frame.t === 'start') {
        const why = meter?.refused('voiceMs');
        refusedTurn = why ? frame.turn : null;
        turn = frame.turn;
        cutting = false;
        if (why) {
          log(`[limits] refused: ${why}`);
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'over', turn: frame.turn } satisfies VoiceFrame));
          void sayRecorded(ws, why);
          return;
        }
      }
      if (frame.t === 'end' || frame.t === 'cancel') turn = null;
      if (refusedTurn !== null) {
        if (frame.t === 'end' || frame.t === 'cancel') refusedTurn = null;
        return;
      }
      if (frame.t === 'audio') {
        counted(frame.pcm, 16000);
        const why = meter?.refused('voiceMs');
        if (why) return cut(why);
      }
      voice.heard(frame);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    sockets.add(ws);
    const connection = randomUUID();
    connections.set(connection, ws);
    ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, snapshot: mind.snapshot(), settings, maps, undo: pipeline.undoLabel(), voice: Boolean(opts.speak), hearing: opts.transcribe ? 'service' : 'browser', live: Boolean(opts.live), connection }));
    ws.on('close', () => {
      sockets.delete(ws);
      plays.delete(ws);
      connections.delete(connection);
      voices.delete(ws);
      liveOf.delete(ws);
    });
    ws.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = ClientMessage.parse(JSON.parse(String(raw)));
      } catch (err) {
        ws.send(JSON.stringify({ t: 'error', message: `bad message: ${String(err instanceof Error ? err.message : err).slice(0, 300)}` }));
        return;
      }
      void asking.run({ ws, voice: voices.get(ws) }, () => handle(message, ws)).catch((err) => ws.send(JSON.stringify({ t: 'error', message: String(err instanceof Error ? err.message : err) })));
    });
  });

  async function handle(m: ClientMessage, ws: WebSocket): Promise<void> {
    switch (m.t) {
      case 'client':
        plays.set(ws, m.media);
        return;
      case 'dump':
        await pipeline.dump(m.dumps);
        return;
      case 'utter':
        pipeline.utter(m.text, m.scene, m.final);
        return;
      case 'focus':
        pipeline.focus(m.nodeId);
        return;
      case 'questions':
        ws.send(JSON.stringify({ t: 'questions', nodeId: m.nodeId, questions: await pipeline.questions(m.nodeId) }));
        return;
      case 'ask':
      case 'more': {
        const why = meter?.refused('searches');
        if (why) return decline(ws, why);
        await (m.t === 'ask' ? pipeline.ask(m.nodeId, m.need) : pipeline.more(m.nodeId, m.need));
        return;
      }
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
        await pipeline.organize(m.request, m.scope, m.focus);
        return;
      case 'handoff':
        await pipeline.handoff(m.scope, m.note);
        return;
      case 'settings':
        pipeline.setSettings(m.patch);
        return;
    }
  }

  telegram?.start();
  return {
    token,
    pipeline,
    mind,
    serve,
    upgrade,
    online: () => sockets.size + liveWss.clients.size,
    async close() {
      await telegram?.close();
      for (const ws of sockets) ws.terminate();
      for (const ws of liveWss.clients) ws.terminate();
      wss.close();
      liveWss.close();
      store.close();
    },
  };
}

/**
 * Every made picture charged, and none made while the service is paused, whichever model the tools make it on (fal's, or the Meta
 * model's as its fallback), so a picture still being made for a run under way when the switch flips costs nothing.
 */
export function chargedPictures(tools: Tools, meter: Meter | undefined): Tools {
  if (!meter) return tools;
  return {
    ...tools,
    images: {
      async generate(prompt) {
        const why = meter.paused();
        if (why) throw new Error(why);
        const made = await tools.images.generate(prompt);
        meter.pictured();
        return made;
      },
    },
  };
}

/** The Scout counted against the device's searches, and refused once they are used up. */
function metered(roles: Roles, meter: Meter): Roles {
  return {
    ...roles,
    scout: (ctx, req) => {
      const why = meter.refused('searches');
      if (why) return Promise.reject(new Error(why));
      meter.used('searches', 1);
      return roles.scout(ctx, req);
    },
  };
}

/** The newest handoff file, as it was written beside its zip. */
function latestHandoff(dir: string): Delivery | null {
  const newest = readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({ file, at: statSync(join(dir, file)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0];
  if (!newest) return null;
  const markdown = readFileSync(join(dir, newest.file), 'utf8');
  const title = /^# Handoff: (.+)$/.exec(markdown.split('\n', 1)[0]!)?.[1]?.trim() || newest.file.replace(/\.md$/, '');
  return { title, file: newest.file, markdown };
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

const FULL = 'this headset has used all its room for files';

/** A request body over its limit, answered with 413. */
class TooLarge extends Error {}

async function body(req: IncomingMessage, limit: number, tooLarge = `a file may be at most ${Math.round(limit / 1e6)} MB here`): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new TooLarge(tooLarge);
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Video elements ask for byte ranges, and some browsers refuse to play without them. `send` writes bytes start to end, both included. */
function ranged(req: IncomingMessage, res: ServerResponse, mime: string, size: number, send: (start: number, end: number) => void): void {
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable' };
  if (!match) {
    res.writeHead(200, { ...base, 'Content-Length': size });
    if (size === 0) return void res.end();
    return send(0, size - 1);
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  send(start, end);
}

/** A linked remote file, streamed through the service so a client only ever fetches from it. The client's byte range goes to the source. */
async function relay(req: IncomingMessage, res: ServerResponse, url: string, mime: string): Promise<void> {
  const stop = new AbortController();
  res.on('close', () => stop.abort());
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { 'User-Agent': 'MindPalace/0.1 (local prototype)', ...(req.headers.range ? { Range: req.headers.range } : {}) },
      redirect: 'follow',
      signal: stop.signal,
    });
  } catch {
    if (!stop.signal.aborted) json(res, 502, { error: 'the source of this file could not be reached' });
    return;
  }
  const headers: Record<string, string> = { 'Content-Type': upstream.headers.get('content-type') ?? mime, 'Cache-Control': 'private, max-age=86400' };
  for (const name of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body) return void res.end();
  Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).on('error', () => res.destroy()).pipe(res);
}

function serveStatic(res: ServerResponse, dir: string, path: string): void {
  const root = resolve(dir);
  const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
}

const LIKELY_WORDS = 900;

/** Card titles the user is likely to say: the tree in view first, then every tree, then the newest cards. */
export function likelyWords(mind: Mindstorm, treeId: string | null): string {
  const inView = treeId && mind.trees.has(treeId) ? mind.treeNodes(treeId).map((n) => mind.item(n.itemId).title) : [];
  const trees = [...mind.trees.values()].map((t) => t.title);
  const newest = [...mind.items.values()].filter((i) => mind.nodesOfItem(i.id).length > 0).slice(-40).reverse().map((i) => i.title);
  const titles: string[] = [];
  let length = 0;
  for (const title of new Set([...inView, ...trees, ...newest].map((t) => t.trim()).filter(Boolean))) {
    if (length + title.length + 2 > LIKELY_WORDS) break;
    titles.push(title);
    length += title.length + 2;
  }
  return titles.join('; ');
}
