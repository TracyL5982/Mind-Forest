import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { Readable, type Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ModelClient, Tools } from '../core/ports.ts';
import { Pipeline, type Outbound } from '../core/pipeline.ts';
import { DEFAULT_SETTINGS, type Handoff, type Playback, type Roles, type Settings } from '../core/roles/types.ts';
import { Mindstorm } from '../core/state.ts';
import { saysWakePhrase, spokenName, withoutWakePhrase } from '../core/wake.ts';
import { DiskAssets } from './assets.ts';
import { Declined, whereItWent, type Channel, type Delivery, type Desk, type Invite } from './contact.ts';
import { chatContext, readMessage } from './momo-chat.ts';
import { matchTrees, treeLines } from './tree-asks.ts';
import { landedCards, nameOf, runTool, toolLabel, toolSpecs, whereNote } from '../core/voice-tools.ts';
import { LiveVoice, RATE, type LiveOptions, type OpenRealtime, type VoiceFrame } from './live.ts';
import { copyOf, plantingOf, SHARE_BYTES, SHARE_CARDS, type ShareAnswer, type SharedFile, type TreeCopy } from '../core/sharing.ts';
import { Gifts, type GiftPace } from './gifts.ts';
import type { Maps } from './geocoder.ts';
import { ClientMessage, DeviceFrame, PROTOCOL_VERSION, type Look } from './protocol.ts';
import { SPEECH_VOICE, HEARING_DOLLARS_PER_MINUTE, SPEECH_DOLLARS_PER_MINUTE, heardMs, spokenMs, questWavMs, type Speak, type Transcribe } from './speech-openai.ts';
import { checkName } from './wake-check.ts';
import type { WebAnswer } from './web-answer.ts';
import { SqliteStore } from './store.ts';
import { CODE_MS, Telegram, type TelegramOptions } from './telegram.ts';
import { followingIn, openInstagram, type InstagramLibrary } from './instagram.ts';
import { makeTools } from './tools.ts';
import { zip } from './zip.ts';
import { Director, momoNote, type Pace } from '../demo/director.ts';
import { Lines, type LinesOptions } from '../demo/lines.ts';
import type { DemoScript } from '../demo/script.ts';
import type { Showcase } from '../demo/showcase.ts';

export interface ServerOptions {
  port: number;
  host: string;
  dataDir: string;
  clientDir: string;
  model: ModelClient;
  roles: Roles;
  /** Every request must carry it. Generated and saved under dataDir when absent. */
  token?: string;
  /**
   * The Instagram connection. With `list`, the accounts in that file are read into a library under dataDir and searched as a source;
   * `read: false` searches what the library holds without reading Instagram.
   */
  instagram?: { token: string; userId: string; list?: string; read?: boolean };
  /** The user's Instagram accounts, opened once and shared: this space searches them through a view of its own and reads nothing. */
  library?: InstagramLibrary;
  /** Hosted mode: past this many bytes of mindstorm and handoffs on disk, every message that writes is refused. */
  storeLimit?: number;
  /** How a page or a picture named by a dump, a search or the model is fetched (`ToolOptions.fetchPage`). */
  fetchPage?: typeof fetch;
  /** Hosted mode: what the files the service keeps in this space itself may come to, in bytes (pictures fetched, made or copied in). */
  madeLimit?: number;
  /** Hosted mode: why the volume takes no more writes now, or null. Reads go on. */
  volumeFull?: () => string | null;
  /** Hosted mode: most bytes one change may store (`MindstormOptions.setBytes`), so a message passes the store limit by at most this. */
  setBytes?: number;
  keys?: Record<string, string | undefined>;
  /**
   * Reads a reply aloud, with the speech model. Without it the client uses the browser's own voice, and a headset shows the words.
   * The demo never has it, nor do the hosted spaces (`spaceOptions`): no one there hears another voice than Momo's realtime one (the
   * user's rule, 2026-11-18). The Mac's own service keeps it for its web page.
   */
  speak?: Speak;
  /** Turns recorded speech into text, told the card titles. When present the client records instead of using the browser's recognition. */
  transcribe?: Transcribe;
  /** False takes every wake for the name: the check of what woke a device (DECISIONS 70) is off. It needs `transcribe`. */
  wakeCheck?: boolean;
  /** Momo's real-time voice on `/live`: the realtime model, how it is set up, and its web answers. Without it `/live` is refused. */
  live?: { open: OpenRealtime; options: LiveOptions; webAnswer?: WebAnswer };
  settings?: Partial<Settings>;
  /** Maps switched on. Without it no place is looked up and clients are told to load no tiles. */
  maps?: Maps;
  /** The only folder a linked file may be served from. Defaults to the repository's `library/clips/full`. */
  films?: string;
  /** Mind Palace as a Telegram contact, reached with this bot's token. */
  telegram?: Omit<TelegramOptions, 'desk' | 'file' | 'log'>;
  /** Hosted mode: this space's contact, made round its desk, in place of a bot of its own. */
  contact?: (desk: Desk) => Channel;
  /** Hosted mode: what this space's device may still do today, and where its use and spend are counted. */
  meter?: Meter;
  /**
   * Sharing a tree with a friend (the hosted service): a copy of a tree shared from here goes out through the person's Telegram,
   * and trees friends shared with them grow here when the headset is next put on, with Momo's recorded `line` for it.
   */
  sharing?: {
    share(copy: TreeCopy, files: SharedFile[]): Promise<ShareAnswer>;
    /** A tree shared under `code` grew here: its sharer is told. */
    planted(code: string): void;
    line?: { text: string; pcm: Uint8Array };
    pace?: Partial<GiftPace>;
  };
  /** Hosted mode: the largest file one upload may be, and what this space's uploads may come to in all, in bytes. */
  uploads?: { file: number; total: number };
  /** The demo: one prepared tree played round by round, with a page to go to any round (src/demo, agents/demo/README.md). */
  demo?: {
    script: DemoScript;
    mediaDir: string;
    showcase?: Showcase[];
    pace?: Partial<Pace>;
    restart?: () => Promise<string>;
    /** The folder Momo's written lines and their recordings are in (`lines.json`, `voice/`). Beside the media folder when not given. */
    linesDir?: string;
    /** The voice the lines are recorded in, and what records one (`LinesOptions.record`): 16-bit mono PCM at the live voice's rate. */
    voice?: string;
    record?: LinesOptions['record'];
  };
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
  /** The line Momo says while this device's own model calls are refused: all of `paused`, or the device past its share of the day. */
  held(): string | null;
  /** A picture was made, on whichever model made it: counted at the price of one. */
  pictured(): void;
  /** A line's recording in Momo's realtime voice, as 16-bit mono PCM at the live voice's rate, or null when it has none. */
  recorded(text: string): Promise<Uint8Array | null>;
}

/** One device's mindstorm, pipeline and voice, answering the requests a listener hands it. */
export interface Space {
  token: string;
  pipeline: Pipeline;
  mind: Mindstorm;
  demo: Director | null;
  /**
   * Takes a tree a friend shared, under its code: its files are copied here, and it is held to grow when the headset is next put
   * on. Or why it could not take it, in a few words ending with a full stop.
   */
  receiveShared(code: string, copy: TreeCopy, files: SharedFile[]): Promise<{ ok: true } | { ok: false; why: string }>;
  /** Answers one request. The caller has checked nothing. */
  serve(req: IncomingMessage, res: ServerResponse): Promise<void>;
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Sockets open on it now. */
  online(): number;
  close(): Promise<void>;
}

/** The voice tools that start a Scout run. */
const SEARCHING = new Set(['find_new', 'more_like_this', 'start_tree']);
/** The voice tools that write nothing. Every other one is refused once the space has no room. */
const READING = new Set(['web_answer', 'look_up_mindstorm', 'go_to', 'connect_telegram']);
/** The messages that write to the mindstorm, its pictures or its handoffs. */
const WRITES = new Set<ClientMessage['t']>(['dump', 'utter', 'ask', 'more', 'keep', 'undo', 'commands', 'organize', 'handoff']);
/** `/live` sockets one metered space keeps: a headset reconnecting while its old socket lingers. A newer one closes the oldest. */
const LIVE_PER_SPACE = 2;
/** How long Momo's answer to a spoken turn is held at most for the turn's words, while the demo's director may answer it (the lead's call, 2026-11-17). */
const ANSWER_HOLD_MS = 2000;
/** What a metered space takes on /api/transcribe: the Quest's own WAV, of about a minute at most. */
const RECORDING_BYTES = 2_000_000;

export interface Running {
  url: string;
  token: string;
  pipeline: Pipeline;
  mind: Mindstorm;
  /** The demo's director, when the service runs the demo. */
  demo: Director | null;
  close(): Promise<void>;
}

const MAX_UPLOAD = 300 * 1024 * 1024;
const MAX_SPOKEN = 1200;
/** A recording that a wake began holds the name within its first characters: the device starts it a tenth of a second before the name. */
const WAKE_WITHIN = 48;
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
    demo: space.demo,
    async close() {
      await space.close();
      await new Promise<void>((done) => http.close(() => done()));
      rmSync(lock, { force: true });
    },
  };
}

export async function openSpace(given: Omit<ServerOptions, 'port' | 'host'>): Promise<Space> {
  // The demo speaks only in Momo's realtime voice: what would be read aloud with the speech model is shown instead.
  const opts = given.demo ? { ...given, speak: undefined } : given;
  const log = opts.log ?? (() => {});
  const meter = opts.meter;
  mkdirSync(opts.dataDir, { recursive: true });
  const token = opts.token ?? savedToken(join(opts.dataDir, 'token'));
  const store = new SqliteStore(join(opts.dataDir, 'mindstorm.sqlite'));
  const assets = new DiskAssets(join(opts.dataDir, 'assets'), '', opts.films, opts.madeLimit);
  const handoffDir = join(opts.dataDir, 'handoffs');
  mkdirSync(handoffDir, { recursive: true });
  /** What this space's uploads come to, kept beside them so a restart does not forget it. Only counted when `uploads` caps it. */
  const uploadedFile = join(opts.dataDir, 'uploads.json');
  const uploaded = readUploaded(uploadedFile);
  /** One upload at a time, so what one takes of the room is known before the next starts. */
  let uploading = false;
  const keepUploaded = (bytes: number) => {
    uploaded.bytes += bytes;
    uploaded.files += 1;
    writeFileSync(`${uploadedFile}.tmp`, JSON.stringify(uploaded));
    renameSync(`${uploadedFile}.tmp`, uploadedFile);
  };
  const instagram = opts.instagram;
  const opened = !opts.library && instagram?.list
    ? openInstagram({ connection: instagram, list: instagram.list, dir: join(opts.dataDir, 'instagram'), assets, read: instagram.read !== false, log })
    : null;
  const following = opts.library ? followingIn(opts.library, assets) : opened?.library;

  const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID(), setBytes: opts.setBytes });
  mind.load(store.all());
  const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const maps = opts.maps ? { tiles: opts.maps.tiles, credit: opts.maps.credit, link: opts.maps.link } : null;
  const sockets = new Set<WebSocket>();
  /** What each connection said it can play. A connection that has not said is taken to be a browser. */
  const plays = new Map<WebSocket, Playback>();
  /** The connections made by the app on a headset, which joins through OkHttp and says so. The Mac preview is not one. */
  const headsets = new WeakSet<WebSocket>();
  const playback = (): Playback => {
    const said = [...plays.values()];
    const files = said.length === 0 ? [] : said.map((p) => p.files).reduce((both, next) => both.filter((ext) => next.includes(ext)));
    return { embeds: said.every((p) => p.embeds), files };
  };
  /** Each connection's id, which its hello tells it, so its `/live` socket can name it. */
  const connections = new Map<string, WebSocket>();
  /** The live voice of the device on each connection, once its `/live` socket names it. */
  const voices = new Map<WebSocket, LiveVoice>();
  /** What each connection last marked on a picture (`look`, WS89), until its next look or until it closes: in memory only. */
  const looks = new Map<WebSocket, Look>();
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
    // A take says its own lines: Momo is told nothing of its cards, or she would tell of them again in words of her own. Nor of a
    // shared tree's, which grows with its own line.
    if (!director?.directing() && !gifts?.growing()) asker?.voice?.observed(message);
  };

  const liveRoles = meter ? metered(opts.roles, meter) : opts.roles;
  /** Work that came from the person's own contact (their Telegram), carried into the runs it starts, so the demo can tell it apart. */
  const fromContact = new AsyncLocalStorage<true>();
  /** The demo's director, made once the pipeline it directs is. Its roles are asked for at each call, so they find it. */
  let director: Director | null = null;
  const pipeline = new Pipeline({
    mind,
    roles: opts.demo
      ? {
          ...liveRoles,
          scout: (ctx, input) => (director ? director.roles().scout(ctx, input) : liveRoles.scout(ctx, input)),
          questions: (ctx, input) => (director ? director.roles().questions(ctx, input) : liveRoles.questions(ctx, input)),
          renderer: (ctx, input) => (director ? director.roles().renderer(ctx, input) : liveRoles.renderer(ctx, input)),
        }
      : liveRoles,
    // A prepared round holds more cards than a live one, and all of them stay.
    ...(opts.demo ? { round: { most: 24, known: 24 } } : {}),
    model: opts.model,
    tools: chargedPictures(makeTools({ model: opts.model, assets, instagram: opts.instagram, following, fetchPage: opts.fetchPage, keys: opts.keys, geocoder: opts.maps?.geocoder, spent: meter && ((dollars) => meter.spent(dollars)), log: opts.log }), meter),
    assets,
    store,
    settings,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    emit,
    playback,
  });
  pipeline.resume();

  /** The headset joined to this space, the newest: what a shared tree grows on, and where Momo's line for it is said. */
  const headset = (): WebSocket | undefined => [...sockets].filter((ws) => ws.readyState === ws.OPEN && plays.get(ws)?.embeds === false).at(-1);
  const sharing = opts.sharing;
  /** Trees friends shared with this person, held to grow when the headset is next put on (the hosted service). */
  const gifts: Gifts | null = sharing
    ? new Gifts({
        file: join(opts.dataDir, 'shared-trees.json'),
        pace: sharing.pace,
        stage: (origin, label, commands) => {
          const ws = headset();
          asking.run({ ws, voice: ws && voices.get(ws) }, () => pipeline.stage(origin, label, commands));
        },
        watched: () => headset() !== undefined,
        planted: (treeId) => mind.trees.has(treeId),
        // Her recorded line on the headset's voice socket, its caption shown as its sound plays; none when the socket is shut.
        speak: () => {
          const ws = headset();
          const live = ws && liveOf.get(ws);
          const line = sharing.line;
          if (!line || !live || live.readyState !== live.OPEN) return 0;
          const id = `shared-${++lines}`;
          const ms = Math.round(line.pcm.length / ((RATE / 1000) * 2));
          const send = (frame: VoiceFrame) => live.send(JSON.stringify(frame));
          send({ t: 'text', id, text: line.text, kind: 'reply', ms, from: 0 });
          const piece = (RATE / 10) * 2;
          for (let at = 0; at < line.pcm.length; at += piece) send({ t: 'audio', id, pcm: Buffer.from(line.pcm.subarray(at, at + piece)).toString('base64') });
          send({ t: 'done', id });
          return ms;
        },
        grew: (gift) => sharing.planted(gift.code),
        log,
      })
    : null;
  /** A copy of a tree and its files, shared from here, or why it cannot go. */
  const shareTree = async (treeId: string): Promise<ShareAnswer> => {
    const copy = copyOf(mind, treeId);
    if (!copy || !sharing) return { ok: false, reason: 'unavailable', text: 'That tree can’t be shared just now.' };
    const tooBig: ShareAnswer = { ok: false, reason: 'too-big', text: `That tree is too big to share: ${SHARE_CARDS} cards and ${SHARE_BYTES / 1e6} MB of pictures at most.` };
    if (copy.nodes.length > SHARE_CARDS) return tooBig;
    const files: SharedFile[] = [];
    let bytes = 0;
    for (const id of copy.assets) {
      const stored = assets.open(id);
      if (!stored) continue;
      if ('bytes' in stored) {
        bytes += stored.bytes.length;
        if (bytes > SHARE_BYTES) return tooBig;
        files.push({ id, mime: stored.mime, bytes: stored.bytes });
      } else files.push({ id, mime: stored.mime, link: 'file' in stored ? stored.file : stored.url });
    }
    return sharing.share(copy, files);
  };

  if (opts.demo) {
    /** The headset the demo is shown on: the newest connection that said it is one, or else the newest client. */
    const device = (): WebSocket | undefined => {
      const open = [...sockets].filter((ws) => ws.readyState === ws.OPEN);
      return open.findLast((ws) => plays.get(ws)?.embeds === false) ?? open.at(-1);
    };
    director = new Director({
      script: opts.demo.script,
      mediaDir: opts.demo.mediaDir,
      showcase: opts.demo.showcase,
      dataDir: opts.dataDir,
      mind,
      pipeline,
      assets,
      roles: liveRoles,
      asDevice: (body) => {
        const ws = device();
        return asking.run({ ws, voice: ws && voices.get(ws) }, body);
      },
      devices: () => [...sockets].filter((ws) => ws.readyState === ws.OPEN && plays.get(ws)?.embeds === false).length,
      forgetVoices: () => {
        for (const voice of voices.values()) voice.close();
      },
      lines: new Lines({ demoDir: opts.demo.linesDir ?? dirname(opts.demo.mediaDir), dataDir: opts.dataDir, voice: opts.demo.voice ?? SPEECH_VOICE, record: opts.demo.record, log }),
      // A take's lines go to the headset as the live voice's do, on the socket its voice is open on.
      momo: (frame) => {
        const ws = device();
        const live = ws && liveOf.get(ws);
        if (!live || live.readyState !== live.OPEN) return false;
        live.send(JSON.stringify(frame));
        return true;
      },
      // Only the app on a headset can be started again from here. The Mac preview joins as a device too, and a headset on the
      // cable that is not the one joined must be left as it is.
      fromContact: () => fromContact.getStore() === true,
      // The contact is made below: by the time the page asks, it is there.
      owner: {
        paired: () => Boolean(telegram?.tell && telegram.status().paired),
        tell: (text) => telegram?.tell?.(text) ?? Promise.resolve(false),
      },
      restart:
        opts.demo.restart &&
        (() => ([...sockets].some((ws) => ws.readyState === ws.OPEN && headsets.has(ws)) ? opts.demo!.restart!() : Promise.reject(new Error('what joined is not the app on a headset')))),
      log,
      pace: opts.demo.pace,
    });
    await director.prepare();
  }

  /** What a contact's message may not do here now, as a client's may not: write with no room left, or cost while costly work is stopped. */
  const admit = () => {
    const why = noRoom() ?? meter?.held();
    if (why) throw new Declined(why);
  };
  /** A metered space writes out a recording no larger than the headset's own, so one note is one small paid call. */
  const hearable = (bytes: number): string | null => (meter && bytes > RECORDING_BYTES ? NOTE_TOO_LONG : null);
  const fits = (bytes: number): string | null => {
    const volume = opts.volumeFull?.();
    if (volume || !opts.uploads) return volume ?? null;
    return bytes > opts.uploads.file ? `That file’s too big for me here. I can take up to ${Math.round(opts.uploads.file / 1e6)} MB.` : bytes > opts.uploads.total - uploaded.bytes ? NO_FILE_ROOM : null;
  };
  const hear = opts.transcribe;
  const desk: Desk = {
    dump: async (dumps, into) => {
      // In the demo a take is not interrupted: what comes in while one plays is filed once it ends.
      await director?.untilTaken();
      admit();
      return whereItWent(mind, await fromContact.run(true, () => pipeline.dump(dumps, into && { treeId: into.tree, words: into.words })));
    },
    fits,
    keep: async (bytes, mime, name) => {
      const why = fits(bytes.length);
      if (why) throw new Declined(why);
      const { id } = await assets.put(bytes, mime, name);
      if (opts.uploads) keepUploaded(bytes.length);
      return id;
    },
    hearable,
    transcribe: hear && (async (audio, mime, seconds) => {
      const why = hearable(audio.length) ?? meter?.refused('voiceMs');
      if (why) throw new Declined(why);
      const ms = heardMs(audio, seconds);
      meter?.used('voiceMs', ms);
      meter?.spent((ms / 60_000) * HEARING_DOLLARS_PER_MINUTE);
      return withoutWakePhrase(await hear(audio, mime, { name: spokenName(settings.agentName), words: likelyWords(mind, null) }), settings.agentName).trim();
    }),
    latest: () => latestHandoff(handoffDir),
    trees: () => treeLines(mind),
    read: async (heard) => {
      const why = meter?.held();
      if (why) throw new Declined(why);
      const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return readMessage(opts.model, { name: spokenName(settings.agentName), today, context: chatContext(mind, heard.text) }, heard);
    },
    match: (words) => matchTrees(mind, opts.model, words),
    handoff: async (treeId) => {
      admit();
      await pipeline.handoff({ treeIds: [treeId], nodeIds: [] });
    },
    // The headsets are told when the contact is paired or no longer is (`telegram`), so a pairing panel can close.
    paired: (paired) => broadcast({ t: 'telegram', paired }),
  };
  const own = opts.telegram ? new Telegram({ ...opts.telegram, desk, file: join(opts.dataDir, 'telegram.json'), log }) : null;
  const telegram: Channel | null = opts.contact?.(desk) ?? own;
  const contact = () => ({ available: telegram !== null, ...(telegram?.status() ?? { ready: false, paired: null }) });
  /**
   * A pairing code given out while no one is paired also goes to the headsets (`telegram`, with the bot and the code), so the pairing
   * panel shows the code Momo reads out. Never logged: a code is a secret while it works.
   */
  const toldCode = (invite: Invite | null): Invite | null => {
    if (invite?.code && telegram?.status().paired === null) {
      broadcast({ t: 'telegram', paired: false, bot: invite.bot, code: invite.code, expiresIn: invite.expiresIn ?? CODE_MS / 1000 });
    }
    return invite;
  };
  const voiceContact = telegram ? { status: () => telegram.status(), pair: () => toldCode(telegram.pair()) } : undefined;

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

    const volumeFull = req.method === 'POST' && path === '/api/assets' ? opts.volumeFull?.() : null;
    if (volumeFull) return json(res, 507, { error: volumeFull });
    if (req.method === 'POST' && path === '/api/assets' && opts.uploads) {
      if (uploading) return json(res, 429, { error: 'one upload at a time' });
      const limit = opts.uploads.file;
      const room = opts.uploads.total - uploaded.bytes;
      const declared = Number(req.headers['content-length'] ?? 0) || 0;
      if (declared > limit) return json(res, 413, { error: tooBig(limit) });
      if (declared > room) return json(res, 413, { error: FULL });
      uploading = true;
      try {
        const mime = req.headers['content-type'] ?? 'application/octet-stream';
        const { id, size } = await assets.putStream(req, mime, url.searchParams.get('name') ?? undefined, Math.min(limit, room), () => new TooLarge(room < limit ? FULL : tooBig(limit)));
        keepUploaded(size);
        return json(res, 200, { id, url: assets.url(id), mime: mime.split(';')[0] });
      } finally {
        uploading = false;
      }
    }
    if (req.method === 'POST' && path === '/api/assets') {
      const bytes = await body(req, MAX_UPLOAD);
      const mime = req.headers['content-type'] ?? 'application/octet-stream';
      const { id } = await assets.put(bytes, mime, url.searchParams.get('name') ?? undefined);
      return json(res, 200, { id, url: assets.url(id), mime: mime.split(';')[0] });
    }
    if (req.method === 'POST' && path === '/api/transcribe') {
      const why = meter?.refused('voiceMs');
      if (why) return json(res, 429, { error: why });
      const mime = req.headers['content-type'] ?? 'audio/wav';
      if (meter && mime.split(';')[0]!.trim().toLowerCase() !== 'audio/wav') return json(res, 415, { error: 'a recording here is audio/wav' });
      const audio = await body(req, meter ? RECORDING_BYTES : 25 * 1024 * 1024);
      if (meter) {
        const ms = questWavMs(audio);
        if (ms === null) return json(res, 415, { error: "a recording here is the Quest's own WAV: 16 kHz mono 16-bit PCM" });
        meter.used('voiceMs', ms);
        meter.spent((ms / 60_000) * HEARING_DOLLARS_PER_MINUTE);
      }
      const heard = opts.transcribe
        ? await opts.transcribe(audio, mime, { name: spokenName(settings.agentName), words: likelyWords(mind, url.searchParams.get('tree')) })
        : await opts.model.transcribe({ audio, mime });
      // `woke=1`: the recording began with what the device's spotter took for the name, which also wakes on things that only
      // sound like it. Unless the words begin with the name, nothing was said to Momo (DECISIONS 70).
      if (url.searchParams.get('woke') === '1' && opts.transcribe && opts.wakeCheck !== false && !saysWakePhrase(heard.slice(0, WAKE_WITHIN), settings.agentName)) {
        log(`[voice] a recording did not begin with the name, so nothing is made of it${meter ? '' : `: ${heard.slice(0, 80)}`}`);
        return json(res, 200, { text: '', named: false });
      }
      return json(res, 200, { text: withoutWakePhrase(heard, settings.agentName).trim(), named: true });
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
      if (!telegram) return json(res, 404, { error: 'this service has no Telegram bot' });
      const invite = toldCode(telegram.pair());
      return invite ? json(res, 200, invite) : json(res, 503, { error: 'Telegram has not answered yet' });
    }
    if (req.method === 'POST' && path === '/api/telegram/unpair') {
      telegram?.unpair();
      return json(res, 200, contact());
    }
    if (req.method === 'GET' && path.startsWith('/assets/')) {
      const stored = assets.open(path.slice('/assets/'.length));
      if (!stored) return json(res, 404, { error: 'no such asset' });
      if ('url' in stored) return relay(req, res, stored.url, stored.mime, opts.fetchPage ?? fetch);
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
    if (director && path.startsWith('/api/demo')) {
      const posted = async (): Promise<Record<string, unknown>> => {
        try {
          return JSON.parse(Buffer.from(await body(req, 20_000)).toString('utf8') || '{}') as Record<string, unknown>;
        } catch {
          return {};
        }
      };
      /** The pace a call names, or the one that is loaded when it names none. */
      const modeOf = (given: unknown) => (given === 'fast' || given === 'real' ? given : undefined);
      if (req.method === 'GET' && path === '/api/demo') return json(res, 200, { outline: director.outline(), status: director.status(), voice: Boolean(opts.live), restarts: director.restarts });
      if (req.method === 'GET' && path === '/api/demo/status') return json(res, 200, director.status());
      if (req.method === 'POST' && path === '/api/demo/goto') {
        const { round } = await posted();
        // The set-up takes a while on a headset: the page reads how far it is from the status.
        void director.goto(String(round ?? '')).catch(() => {});
        return json(res, 202, director.status());
      }
      if (req.method === 'GET' && path === '/api/demo/take') {
        try {
          return json(res, 200, director.shown(url.searchParams.get('round') ?? '', modeOf(url.searchParams.get('mode'))));
        } catch (err) {
          return json(res, 404, { error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (req.method === 'GET' && path === '/api/demo/lines.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="lines.json"', 'Cache-Control': 'no-store' });
        res.end(`${JSON.stringify(director.linesFile(), null, 1)}\n`);
        return;
      }
      if (req.method === 'POST' && path === '/api/demo/play') {
        const { round, at } = await posted();
        // The take runs for the length of a real round: the page reads where it is from the status.
        void director.playTake(typeof round === 'string' ? round : undefined, typeof at === 'number' ? at : undefined).catch(() => {});
        return json(res, 202, director.status());
      }
      if (req.method === 'POST' && path === '/api/demo/mode') {
        const { mode } = await posted();
        if (mode !== 'fast' && mode !== 'real') return json(res, 400, { error: 'a mode is "fast" or "real"' });
        director.setMode(mode);
        return json(res, 200, director.status());
      }
      if (req.method === 'POST' && path === '/api/demo/pause') {
        await director.pause().catch(() => {});
        return json(res, 200, director.status());
      }
      if (req.method === 'POST' && path === '/api/demo/seek') {
        const { round, at } = await posted();
        await director.seek(String(round ?? ''), Number(at) || 0).catch(() => {});
        return json(res, 200, director.status());
      }
      if (req.method === 'POST' && path === '/api/demo/line') {
        const { round, line, text, mode } = await posted();
        try {
          return json(res, 200, director.setLine(String(round ?? ''), String(line ?? ''), typeof text === 'string' ? text : null, modeOf(mode)));
        } catch (err) {
          return json(res, 404, { error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (req.method === 'POST' && path === '/api/demo/scripted') {
        director.setScripted((await posted()).on !== false);
        return json(res, 200, director.status());
      }
      if (req.method === 'POST' && path === '/api/demo/show') {
        const { tree } = await posted();
        // The headset is taken through the tree's layers, which takes a few seconds: the page reads how far it is from the status.
        void director.show(String(tree ?? '')).catch(() => {});
        return json(res, 202, director.status());
      }
      if (req.method === 'POST' && path === '/api/demo/showcase') {
        void director.setShowcase((await posted()).on !== false).catch(() => {});
        return json(res, 202, director.status());
      }
      // The daily tree: arm it (a headset may be started again, which the page follows on the status), send Momo's message, grow it.
      if (req.method === 'POST' && path === '/api/demo/daily/arm') {
        const { tree, kind } = await posted();
        void director.armDaily(typeof tree === 'string' && tree ? tree : undefined, kind === 'shared' ? 'shared' : 'daily').catch(() => {});
        return json(res, 202, director.status());
      }
      if (req.method === 'POST' && path === '/api/demo/daily/clear') {
        director.clearHeld();
        return json(res, 200, director.status());
      }
      if (req.method === 'POST' && path === '/api/demo/daily/send') {
        await director.sendDaily().catch(() => {});
        return json(res, 200, director.status());
      }
      if (req.method === 'POST' && path === '/api/demo/daily/grow') {
        void director.growDaily().catch(() => {});
        return json(res, 202, director.status());
      }
      // Momo's question at the walkthrough's end, asked again by hand for another take.
      if (req.method === 'POST' && path === '/api/demo/ending') {
        void director.askMuseCode().catch(() => {});
        return json(res, 202, director.status());
      }
      return json(res, 404, { error: 'not found' });
    }
    if (req.method === 'GET' && path === '/demo' && director) return serveStatic(res, opts.clientDir, '/demo.html');
    if (req.method === 'GET') return serveStatic(res, opts.clientDir, path);
    json(res, 404, { error: 'not found' });
  }

  // In hosted mode a message is small: a client's commands and drops, and on /live 100 ms of audio (a frame's own limit is 1 MiB).
  const wss = new WebSocketServer({ noServer: true, ...(meter ? { maxPayload: 1_000_000 } : {}) });
  const liveWss = new WebSocketServer({ noServer: true, ...(meter ? { maxPayload: 1_500_000 } : {}) });
  /** Why this space takes no more writes now, or null: the volume nearly full, or its mindstorm and handoffs past the store limit. */
  const noRoom = (): string | null => {
    const volume = opts.volumeFull?.();
    if (volume || opts.storeLimit === undefined) return volume ?? null;
    const size = (file: string) => (existsSync(file) ? statSync(file).size : 0);
    const db = join(opts.dataDir, 'mindstorm.sqlite');
    const handoffs = existsSync(handoffDir) ? readdirSync(handoffDir).reduce((sum, name) => sum + size(join(handoffDir, name)), 0) : 0;
    return size(db) + size(`${db}-wal`) + handoffs > opts.storeLimit ? STORE_FULL : null;
  };
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
  /**
   * A refusal Momo says on the device's `/live` socket from its recording in her realtime voice, so a refused device costs no
   * realtime model: its caption with the recording's length, then its sound. Words with no recording are shown alone for as long as
   * they take to read, and the log says so: no other voice ever says them (the user's rule, 2026-11-18).
   */
  const sayRecorded = async (live: WebSocket, text: string) => {
    const id = `line-${++lines}`;
    const send = (frame: VoiceFrame) => live.readyState === live.OPEN && live.send(JSON.stringify(frame));
    const pcm = (await meter?.recorded(text).catch(() => null)) ?? null;
    if (!pcm) log(`[limits] no recording of “${text}” in Momo's realtime voice: its words are shown with no sound`);
    const ms = pcm ? Math.round(pcm.length / ((RATE / 1000) * 2)) : Math.max(1500, text.length * 66);
    send({ t: 'text', id, text, kind: 'reply', ms, from: 0 });
    const piece = (RATE / 10) * 2;
    if (pcm) for (let at = 0; at < pcm.length; at += piece) send({ t: 'audio', id, pcm: Buffer.from(pcm.subarray(at, at + piece)).toString('base64') });
    else await new Promise((done) => setTimeout(done, ms).unref?.());
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
    // A frame over the size limit, or one that breaks the protocol, closes the socket; unheard, the error would end the process.
    ws.on('error', (err) => log(`[live] socket closed: ${err.message}`));
    const live = opts.live!;
    // Terminated, not closed: a closing socket still delivers what arrives while it waits for the device's reply.
    if (meter) for (const old of [...liveWss.clients].slice(0, Math.max(0, liveWss.clients.size - LIVE_PER_SPACE))) old.terminate();
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
    /**
     * While the demo's director may answer a turn in Momo's place (`Director.holdsAnswers`, as for the prune of Llull's ring), her
     * answer to a spoken turn is held until the turn's words are written down, `ANSWER_HOLD_MS` at most. A turn the director answers
     * (`Director.answerTurn`) never has her own answer reach the headset (the lead's call, 2026-11-17). The turn being heard, with
     * the card open as it began.
     */
    let deciding: { turn: number; focus?: string; held: VoiceFrame[]; timer?: ReturnType<typeof setTimeout> } | null = null;
    /** The turn the director answered, its words, and the ids of Momo's own answers to it: none reaches the headset, and her tools for it do nothing. */
    let directed: { turn: number; words: string | null; ids: Set<string> } | null = null;
    /** Momo's tools that wait for the turn being heard to be settled, since its words may be written down later than a call waits for them. */
    const settled: (() => void)[] = [];
    const settling = () => {
      for (const done of settled.splice(0)) done();
    };
    /** Momo's voice to the headset: kept from it while a take's lines are what it hears. */
    const toDevice = (frame: VoiceFrame) => {
      // While a round's take is what the headset hears, Momo's own words are kept from it; her reply over, the take is seen to.
      if (director?.mutes()) {
        if (frame.t === 'text' || frame.t === 'audio') return;
        if (frame.t === 'done') director.replied();
      }
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };
    const settle = (words: string | null) => {
      const d = deciding;
      if (!d) return;
      deciding = null;
      if (d.timer) clearTimeout(d.timer);
      if (director?.answerTurn(words, d.focus)) {
        directed = { turn: d.turn, words, ids: new Set(d.held.flatMap((f) => ('id' in f ? [f.id] : []))) };
        log(`[demo] turn ${d.turn} is answered by the director: Momo's own answer is dropped`);
        return settling();
      }
      settling();
      if (words === null && d.held.length > 0) log(`[demo] turn ${d.turn}'s words were not written down in ${ANSWER_HOLD_MS} ms: Momo's answer goes on`);
      for (const f of d.held) toDevice(f);
    };
    const gate = (frame: VoiceFrame) => {
      if (frame.t === 'heard') {
        toDevice(frame);
        // Her name alone is no request: the turn goes on, and its words are waited for.
        if (frame.final && deciding?.turn === frame.turn && frame.text.trim()) settle(frame.text);
        return;
      }
      if (frame.t !== 'text' && frame.t !== 'audio' && frame.t !== 'done') return toDevice(frame);
      if (directed && (directed.ids.has(frame.id) || (frame.t === 'text' && frame.turn === directed.turn))) {
        directed.ids.add(frame.id);
        return;
      }
      if (!deciding) return toDevice(frame);
      deciding.held.push(frame);
      deciding.timer ??= setTimeout(() => settle(null), ANSWER_HOLD_MS);
    };
    const voice: LiveVoice = new LiveVoice(
      {
        open: live.open,
        options: live.options,
        name: () => spokenName(settings.agentName),
        words: (scene) => likelyWords(mind, scene.treeId ?? null),
        tools: toolSpecs,
        call: async (name, args, scene, said) => {
          // A tool Momo calls for the turn the director answered does nothing: the card is cut, and her line said.
          if (deciding || directed) {
            const before = directed;
            const words = await said();
            if (deciding) {
              deciding.timer ??= setTimeout(() => settle(null), ANSWER_HOLD_MS);
              await new Promise<void>((done) => settled.push(done));
            }
            if (directed && ((words !== undefined && words === directed.words) || (words === undefined && directed !== before))) {
              return { done: true, note: 'Already done, and said. Say nothing more about it.' };
            }
          }
          const why = (READING.has(name) ? null : noRoom()) ?? (SEARCHING.has(name) ? meter?.refused('searches') : null);
          if (why) return Promise.resolve({ error: why });
          return asking.run({ ws: own, voice }, () => runTool(name, args, { pipeline, scene, webAnswer, said, contact: voiceContact }));
        },
        label: toolLabel,
        where: (scene) => whereNote(pipeline.ctx, scene) + (director?.takeNote(scene.focus) ?? ''),
        cards: (set) => landedCards(mind, set),
        nameOf: (nodeId) => (mind.nodes.has(nodeId) ? nameOf(mind.itemOf(nodeId)) : 'this card'),
        spoken: (turn) => pipeline.spoken(turn),
        // Momo's own steps (a web search) are this device's alone: another headset's orb would show it working.
        activity: (activity) => {
          log(`[momo] ${activity.state}: ${activity.label}`);
          if (own && own.readyState === own.OPEN) own.send(JSON.stringify({ t: 'activity', activity }));
        },
        spent: (dollars) => meter?.spent(dollars),
        ...(opts.transcribe && opts.wakeCheck !== false
          ? {
              named: async (pcm: Uint8Array) => {
                const ms = (pcm.length / 2 / 16000) * 1000;
                meter?.spent((ms / 60_000) * HEARING_DOLLARS_PER_MINUTE);
                const { ok, heard } = await checkName(opts.transcribe!, pcm, spokenName(settings.agentName));
                // What was not said to Momo is not written into a log others keep.
                log(`[live] the sound of the wake was written down${ok || !meter ? ` as: ${heard}` : ', and is not the name'}`);
                return ok;
              },
            }
          : {}),
        log,
        ...(opts.demo ? { extra: () => momoNote(opts.demo!.script) } : {}),
      },
      (frame) => {
        if (frame.t === 'audio') {
          counted(frame.pcm, RATE);
          const why = meter?.refused('voiceMs');
          if (why) return cut(why, frame.id);
        }
        gate(frame);
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
      if (frame.t === 'lesson') {
        // A lesson's answer is Momo's voice too: past the day's share none is given, and the device says the lesson's own line.
        turn = frame.turn;
        cutting = false;
        refusedTurn = null;
        const why = meter?.refused('voiceMs');
        if (why) {
          log(`[limits] refused: ${why}`);
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'quiet', turn: frame.turn } satisfies VoiceFrame));
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
      if (frame.t === 'name') {
        // Past the day's share the turn itself is refused, with its reason said aloud: the check is not spent on it.
        if (meter?.refused('voiceMs')) return void (ws.readyState === ws.OPEN && ws.send(JSON.stringify({ t: 'name', ok: true } satisfies VoiceFrame)));
        counted(frame.pcm, 16000);
      }
      if (frame.t === 'start') {
        // A new turn: what Momo was saying is stopped, so an answer held for the turn before goes nowhere.
        if (deciding?.timer) clearTimeout(deciding.timer);
        settling();
        deciding = director?.holdsAnswers() ? { turn: frame.turn, ...(frame.scene.focus ? { focus: frame.scene.focus } : {}), held: [] } : null;
      }
      voice.heard(frame);
    });
  });

  wss.on('connection', (ws: WebSocket, req?: IncomingMessage) => {
    ws.on('error', (err) => log(`[ws] socket closed: ${err.message}`));
    sockets.add(ws);
    if (/okhttp/i.test(String(req?.headers['user-agent'] ?? ''))) headsets.add(ws);
    const connection = randomUUID();
    connections.set(connection, ws);
    ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, snapshot: mind.snapshot(), settings, maps, undo: pipeline.undoLabel(), voice: Boolean(opts.speak), hearing: opts.transcribe ? 'service' : 'browser', live: Boolean(opts.live), connection, ...(sharing && !director ? { share: 'telegram' } : {}) }));
    // On a service whose Telegram is a hosted contact, whether this headset is paired with a chat: unpaired, its Send and Share say
    // to pair first, and a pinch on that opens the pairing panel (`pair`).
    if (opts.contact && telegram) ws.send(JSON.stringify({ t: 'telegram', paired: telegram.status().paired !== null }));
    ws.on('close', () => {
      sockets.delete(ws);
      looks.delete(ws);
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
    director?.heard(m);
    const full = WRITES.has(m.t) ? noRoom() : null;
    if (full) return decline(ws, full);
    switch (m.t) {
      case 'client':
        plays.set(ws, m.media);
        if (director && m.media.embeds === false) director.joined();
        else if (m.media.embeds === false) gifts?.returned();
        return;
      case 'worn':
        if (director) director.worn(m.away);
        else gifts?.returned(m.away);
        return;
      case 'look':
        // What the user marked on a picture, for Momo to see with their next words about it, and for the Scout when they send
        // it: kept for this connection alone, in memory, and never written to the log or the store.
        if (m.crop) looks.set(ws, m);
        else if (!m.nodeId || looks.get(ws)?.nodeId === m.nodeId) looks.delete(ws);
        voices.get(ws)?.look(m);
        return;
      case 'pair': {
        // The headset's pairing panel asks for the bot and a code, the one already given while it still has a while to run.
        if (!telegram) {
          ws.send(JSON.stringify({ t: 'error', message: 'this service has no Telegram to pair with' }));
          return;
        }
        if (telegram.status().paired !== null) {
          ws.send(JSON.stringify({ t: 'telegram', paired: true }));
          return;
        }
        const invite = telegram.pair({ reuse: true });
        ws.send(JSON.stringify(invite?.code ? { t: 'telegram', paired: false, bot: invite.bot, code: invite.code, expiresIn: invite.expiresIn ?? CODE_MS / 1000 } : { t: 'telegram', paired: false, ready: false }));
        return;
      }
      case 'share':
        // The demo shares a tree with the user as the friend (the film); the hosted service, through the person's Telegram, with a
        // friend who uses it too, and tells the headset how it went. Any other service shares nothing.
        if (director) {
          await director.share(m.tree).catch((err) => ws.send(JSON.stringify({ t: 'error', message: `the tree was not shared: ${err instanceof Error ? err.message : String(err)}` })));
          return;
        }
        if (!sharing) {
          ws.send(JSON.stringify({ t: 'error', message: 'sharing a tree with a friend is not ready on this service yet' }));
          return;
        }
        ws.send(JSON.stringify({ t: 'shared', tree: m.tree, ...(await shareTree(m.tree).catch((): ShareAnswer => ({ ok: false, reason: 'unavailable', text: 'That tree can’t be shared just now.' }))) }));
        return;
      case 'dump':
        await pipeline.dump(m.dumps);
        return;
      case 'utter':
        pipeline.utter(m.text, m.scene, m.final);
        return;
      case 'focus':
        pipeline.focus(m.nodeId);
        gifts?.focused(m.nodeId);
        return;
      case 'questions':
        ws.send(JSON.stringify({ t: 'questions', nodeId: m.nodeId, questions: await pipeline.questions(m.nodeId) }));
        return;
      case 'ask':
      case 'more': {
        const why = meter?.refused('searches');
        if (why) return decline(ws, why);
        // An ask about a card the user drew on (its Send) is about the part they ringed: the Scout is shown it.
        const marked = m.t === 'ask' && looks.get(ws)?.nodeId === m.nodeId ? looks.get(ws)?.crop : undefined;
        await (m.t === 'ask' ? pipeline.ask(m.nodeId, m.need, marked) : pipeline.more(m.nodeId, m.need));
        return;
      }
      case 'keep':
        pipeline.keep(m.nodeIds);
        return;
      case 'undo':
        pipeline.undo(m.id);
        return;
      case 'commands':
        if (pipeline.userCommands(m.label, m.commands)) director?.changed(m.commands);
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

  own?.start();
  return {
    token,
    pipeline,
    mind,
    demo: director,
    async receiveShared(code, copy, files) {
      if (!gifts) return { ok: false, why: 'this headset does not take shared trees.' };
      const bytes = files.reduce((n, file) => n + (file.bytes?.length ?? 0), 0);
      if (opts.volumeFull?.() || !assets.room(bytes)) return { ok: false, why: 'your headset has no room left for its pictures.' };
      const moved = new Map<string, string>();
      for (const file of files) moved.set(file.id, (file.bytes ? await assets.put(file.bytes, file.mime, file.name) : await assets.link(file.link!, file.mime, file.name)).id);
      gifts.hold({ code, title: copy.title, planting: plantingOf(copy, moved, () => randomUUID(), new Date().toISOString()) });
      return { ok: true };
    },
    serve,
    upgrade,
    online: () => sockets.size + liveWss.clients.size,
    async close() {
      opened?.reader?.stop();
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
const NOTE_TOO_LONG = 'That voice note’s too long for me to write out here. Send me one of up to a minute or so.';
const NO_FILE_ROOM = 'This headset has used all its room for files, so I can’t keep that one.';
export const STORE_FULL = "This headset's Mind Forest is full, so nothing more can be added here.";
const tooBig = (limit: number) => `a file may be at most ${Math.round(limit / 1e6)} MB here`;

/** What a space's uploads come to. A file that does not parse, as after a crash in the middle of writing it, counts as none. */
function readUploaded(file: string): { bytes: number; files: number } {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { bytes?: unknown; files?: unknown };
    if (typeof saved.bytes === 'number' && typeof saved.files === 'number') return { bytes: saved.bytes, files: saved.files };
  } catch {
    // No file yet, or a damaged one.
  }
  return { bytes: 0, files: 0 };
}

/** A request body over its limit, answered with 413. */
class TooLarge extends Error {}

async function body(req: IncomingMessage, limit: number, tooLarge = tooBig(limit)): Promise<Uint8Array> {
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
/** A linked asset's remote bytes, streamed as they come, fetched with `send`: in hosted mode only from a public address. */
async function relay(req: IncomingMessage, res: ServerResponse, url: string, mime: string, send: typeof fetch): Promise<void> {
  const stop = new AbortController();
  res.on('close', () => stop.abort());
  let upstream: Response;
  try {
    upstream = await send(url, {
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
