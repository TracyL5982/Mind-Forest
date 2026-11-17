import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelClient } from '../core/ports.ts';
import type { Roles } from '../core/roles/types.ts';
import { FakeModel } from '../fake/model.ts';
import { loadEnv } from './env.ts';
import { openMaps, type Maps } from './geocoder.ts';
import { MetaModel } from './model-meta.ts';
import { startServer } from './server.ts';
import type { LiveOptions } from './live.ts';
import { HEARING_MODEL, openaiRealtime, openaiSpeech, openaiTranscribe, SPEECH_VOICE } from './speech-openai.ts';
import { openaiWebAnswer } from './web-answer.ts';
import { MAX_DEVICES, NEW_DEVICES_PER_HOUR, PICTURE_DOLLARS, startHosted, telegramAlert } from './hosted/hosted.ts';
import { judgeBotToken } from './hosted/judges.ts';
import { forDevice, Ledger, limitsFrom } from './hosted/ledger.ts';
import { Overflow, Paused, SPARE_EFFORTS, SPARE_MODEL, SPARE_QUICK_MODEL, spareCost } from './hosted/overflow.ts';
import { openInstagram } from './instagram.ts';
import { openaiSearch, SEARCH_DOLLARS } from './search-openai.ts';
import type { LinesOptions } from '../demo/lines.ts';
import { record as recordLine } from '../demo/momo-voice.ts';
import { loadScript } from '../demo/script.ts';
import { loadShowcase } from '../demo/showcase.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const env = loadEnv();
const args = new Set(process.argv.slice(2));
const fake = args.has('--fake');
/** One service for many headsets: a space per device, limits, an off switch, and no Telegram reading (see agents/README.md). */
const hosted = env.MIND_PALACE_HOSTED === '1';
/**
 * The demo: one prepared tree played round by round, with a page to go to any round (agents/demo/README.md). It keeps its own
 * data folder, so the user's mindstorm is not touched. With `--fake` it runs with no model and no voice, to try the page.
 */
const demo = args.has('--demo');
const demoDir = env.MIND_PALACE_DEMO ?? join(root, 'demo');
const dataDir = env.MIND_PALACE_DATA ?? join(root, demo ? (fake ? 'data-demo-fake' : 'data-demo') : fake ? 'data-fake' : 'data');
const number = (name: string, fallback: number) => (env[name]?.trim() ? Number(env[name]) : fallback);

/**
 * Records one of Momo's written lines for the demo, as 16-bit mono PCM at the live voice's rate: the realtime model itself, as
 * Momo, saying the line, kept once it is heard to be the words as written (`demo/momo-voice.ts`). No other voice is used.
 * Without the key a take plays with her words shown and no sound.
 */
function demoRecord(): LinesOptions['record'] {
  const apiKey = env.OPENAI_API_KEY;
  if (fake || !apiKey) return undefined;
  const hear = openaiTranscribe(fetch, { apiKey, model: env.MIND_PALACE_HEARING_MODEL });
  const model = env.MIND_PALACE_LIVE_MODEL || 'gpt-realtime-2.1';
  return (text, kind) =>
    recordLine(
      {
        open: openaiRealtime({ apiKey, model }),
        model,
        voice: env.MIND_PALACE_VOICE || SPEECH_VOICE,
        name: 'Momo',
        hear: (wav, likely) => hear(wav, 'audio/wav', { name: 'Momo', words: likely }),
        log,
      },
      text,
      kind,
    );
}

/** The showcase trees of the demo's folder that hold together; one that does not is said and left out. */
function showcase() {
  const { trees, problems } = loadShowcase(join(demoDir, 'showcase'));
  for (const problem of problems) console.log(`[demo] ${problem}`);
  return trees;
}

/**
 * Starts the app again on a headset this Mac reaches by adb, joined to this service: what the demo's empty stage needs, since a
 * headset keeps a tree the service deleted. It is the repository's own script (agents/demo/headset.sh restart), given this
 * service's data folder and port and none of its keys. Undefined where the script is not there.
 */
function restartHeadset(): (() => Promise<string>) | undefined {
  const script = join(root, 'demo', 'headset.sh');
  // On Fly there is no adb and no headset on a cable: MIND_PALACE_DEMO_RESTART=off says so, and the page then says what to do.
  if (env.MIND_PALACE_DEMO_RESTART === 'off' || !existsSync(script)) return undefined;
  return () =>
    new Promise((done, failed) => {
      const given = { ...process.env, MIND_PALACE_DATA: resolve(dataDir), MIND_PALACE_PORT: String(env.MIND_PALACE_PORT ?? 8787) };
      execFile('bash', [script, 'restart'], { env: given, timeout: 40_000 }, (err, stdout, stderr) => {
        const said = `${stdout}\n${stderr}`.split('\n').map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
        if (err) failed(new Error(said || err.message));
        else done(said || 'the app was started again on the headset');
      });
    });
}
const log = (line: string) => console.log(line);

const ledger = hosted
  ? new Ledger({
      file: join(dataDir, 'ledger.json'),
      limits: limitsFrom(env),
      metaDollarsPerMillion: number('MIND_PALACE_META_PRICE', 0),
      alert:
        env.TELEGRAM_BOT_TOKEN && env.MIND_PALACE_ALERT_CHAT
          ? telegramAlert({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.MIND_PALACE_ALERT_CHAT, log })
          : (text) => log(`[alert] no Telegram chat to send to: ${text}`),
    })
  : null;

let model: ModelClient;
let roles: Roles;
if (fake) {
  model = new FakeModel();
  roles = (await import('../fake/roles.ts')).fakeRoles;
} else {
  if (!env.MODEL_API_KEY) {
    console.error('MODEL_API_KEY is not set. Put it in ~/.muse-garden.env, or run with --fake.');
    process.exit(1);
  }
  const meta = new MetaModel({
    apiKey: env.MODEL_API_KEY,
    baseUrl: env.MUSE_LLM_BASE_URL || undefined,
    model: env.MUSE_LLM_MODEL || undefined,
    quickModel: env.MIND_PALACE_QUICK_MODEL || undefined,
    // Hosted, the budget is the ledger's, counted again each day; on the Mac it lasts as long as the process.
    tokenBudget: hosted ? Number.POSITIVE_INFINITY : env.MIND_PALACE_TOKEN_BUDGET ? Number(env.MIND_PALACE_TOKEN_BUDGET) : undefined,
    onCall: (c) => {
      ledger?.metaTokens(c.tokens ?? 0, forDevice.getStore());
      console.log(
        `  model ${c.kind} ${c.role} ${c.ok ? 'ok' : 'FAILED'} ${c.ms}ms${c.tokens ? ` ${c.tokens} tokens` : ''}` +
          `${c.model ? `, ${[c.model, c.effort].filter(Boolean).join(' ')}` : ''}${c.tries && c.tries > 1 ? `, ${c.tries} tries` : ''}` +
          `${c.heldMs ? `, held ${c.heldMs}ms for the rate window` : ''}${c.gaveUp ? ', gave up waiting for the rate window' : ''}`,
      );
    },
  });
  model = meta;
  if (hosted && env.OPENAI_API_KEY && env.MIND_PALACE_OVERFLOW !== 'off') {
    const apiKey = env.OPENAI_API_KEY;
    const spare = new MetaModel({
      apiKey,
      baseUrl: 'https://api.openai.com/v1',
      model: SPARE_MODEL,
      quickModel: SPARE_QUICK_MODEL,
      efforts: SPARE_EFFORTS,
      onCall: (c) => {
        const dollars = spareCost(c.model, c.usage);
        ledger?.spend(dollars, forDevice.getStore());
        log(`  overflow ${c.kind} ${c.role} ${c.ok ? 'ok' : 'FAILED'} ${c.ms}ms on ${c.model ?? '?'}${c.tokens ? `, ${c.tokens} tokens` : ''}, $${dollars.toFixed(4)}`);
      },
    });
    model = new Overflow({
      meta,
      spare,
      search: async (req) => {
        ledger?.spend(SEARCH_DOLLARS, forDevice.getStore());
        return openaiSearch(fetch, { apiKey, model: SPARE_QUICK_MODEL }, req);
      },
      overflowed: (role, kind) => {
        ledger?.overflowed();
        log(`[overflow] ${kind} ${role} to OpenAI: Meta's minute is full`);
      },
    });
  }
  roles = (await import('../core/roles/index.ts')).roles;
}
if (ledger) {
  const inner = model;
  model = new Paused(inner, () => {
    const why = ledger.paused();
    return why ? `the service is ${why === 'off' ? 'switched off' : why === 'budget' ? "over today's token budget" : "over today's spend cap"}` : null;
  });
}

/** Momo's real-time voice. MIND_PALACE_LIVE_TURN is `semantic`, or `server:<ms>` for a pause of that length. */
const liveModel = env.MIND_PALACE_LIVE_MODEL || 'gpt-realtime-2.1';
const turn = /^server:(\d+)$/.exec(env.MIND_PALACE_LIVE_TURN ?? '');
const liveOptions: LiveOptions = {
  model: liveModel,
  voice: env.MIND_PALACE_VOICE || SPEECH_VOICE,
  turn: turn ? { kind: 'server', ms: Number(turn[1]) } : { kind: 'semantic' },
  hearing: env.MIND_PALACE_HEARING_MODEL || HEARING_MODEL,
  effort: (env.MIND_PALACE_LIVE_EFFORT as LiveOptions['effort']) || 'minimal',
  ...(env.MIND_PALACE_LIVE_PAUSE ? { pauseMs: Number(env.MIND_PALACE_LIVE_PAUSE) } : {}),
};

// One role's failure that nothing caught must not take the whole service down with the user's session.
process.on('unhandledRejection', (err) => console.error(`[service] a failure nothing caught: ${err instanceof Error ? err.stack : String(err)}`));

let maps: Maps | undefined;
try {
  maps = env.MIND_PALACE_MAPS?.trim() ? openMaps(env.MIND_PALACE_MAPS, join(dataDir, 'places.json')) : undefined;
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
// The accounts the user chose, outside the repository since the list names them.
const instagramList = env.MIND_PALACE_INSTAGRAM_LIST || join(homedir(), '.mind-palace', 'instagram-following.md');

const shared = {
  clientDir: join(root, 'client'),
  model,
  roles,
  keys: {
    YOUTUBE_API_KEY: env.YOUTUBE_API_KEY, TMDB_API_KEY: env.TMDB_API_KEY, EUROPEANA_API_KEY: env.EUROPEANA_API_KEY, GUARDIAN_API_KEY: env.GUARDIAN_API_KEY,
    UNSPLASH_ACCESS_KEY: env.UNSPLASH_ACCESS_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, MIND_PALACE_SEARCH_MODEL: env.MIND_PALACE_SEARCH_MODEL,
    // With FAL_KEY, pictures are made on fal's Muse Image, or the model MIND_PALACE_FAL_MODEL names; `off` or no key, on the Meta API's muse-image-1.0.
    FAL_KEY: env.FAL_KEY, MIND_PALACE_FAL_MODEL: env.MIND_PALACE_FAL_MODEL,
  },
  speak: !fake && env.OPENAI_API_KEY ? openaiSpeech(fetch, { apiKey: env.OPENAI_API_KEY, model: env.MIND_PALACE_VOICE_MODEL, voice: env.MIND_PALACE_VOICE }) : undefined,
  live:
    !fake && env.OPENAI_API_KEY && env.MIND_PALACE_LIVE !== 'off'
      ? {
          open: openaiRealtime({ apiKey: env.OPENAI_API_KEY, model: liveModel }),
          options: liveOptions,
          webAnswer: openaiWebAnswer(fetch, { apiKey: env.OPENAI_API_KEY, model: env.MIND_PALACE_WEB_MODEL || undefined, effort: env.MIND_PALACE_WEB_EFFORT || undefined, log, spent: (dollars) => ledger?.spend(dollars, forDevice.getStore()) }),
        }
      : undefined,
  transcribe: !fake && env.OPENAI_API_KEY ? openaiTranscribe(fetch, { apiKey: env.OPENAI_API_KEY, model: env.MIND_PALACE_HEARING_MODEL }) : undefined,
  wakeCheck: env.MIND_PALACE_WAKE_CHECK !== 'off',
  // MIND_PALACE_INSTAGRAM_READ=off searches what is kept without reading Instagram.
  instagram:
    env.META_IG_TOKEN && env.META_IG_USER_ID
      ? { token: env.META_IG_TOKEN, userId: env.META_IG_USER_ID, list: instagramList, read: env.MIND_PALACE_INSTAGRAM_READ !== 'off' }
      : undefined,
  maps,
};
const port = Number(env.MIND_PALACE_PORT ?? 8787);
const host = env.MIND_PALACE_HOST ?? '0.0.0.0';

if (ledger) {
  if (!env.MIND_PALACE_APP_KEY || !env.MIND_PALACE_ADMIN_TOKEN) {
    console.error('Hosted mode needs MIND_PALACE_APP_KEY and MIND_PALACE_ADMIN_TOKEN.');
    process.exit(1);
  }
  const openaiKey = env.OPENAI_API_KEY;
  const record =
    !fake && openaiKey
      ? async (text: string) => {
          const speak = openaiSpeech(fetch, { apiKey: openaiKey, model: env.MIND_PALACE_VOICE_MODEL, voice: env.MIND_PALACE_VOICE, format: 'pcm' });
          return new Uint8Array(await new Response(await speak(text, AbortSignal.timeout(20_000))).arrayBuffer());
        }
      : undefined;
  // One library of the user's Instagram accounts for every space, on the volume, opened from the list alone: the server needs no
  // Instagram account. Its pictures are made small with macOS's `sips`, which a Linux server lacks, so deploy/instagram.sh copies the
  // Mac's library there, and the server reads Instagram only with MIND_PALACE_INSTAGRAM_READ=on and an account.
  const following = openInstagram({ connection: shared.instagram, list: instagramList, dir: join(dataDir, 'instagram'), read: env.MIND_PALACE_INSTAGRAM_READ === 'on', log }) ?? undefined;
  // The judges' own bot, which only this service reads. The owner's bot is never read here: their Mac reads it.
  const judgeToken = fake ? undefined : judgeBotToken(env, log);
  const service = await startHosted({
    port,
    host,
    dataDir,
    starter: env.MIND_PALACE_STARTER ?? join(root, 'starter'),
    appKey: env.MIND_PALACE_APP_KEY,
    adminToken: env.MIND_PALACE_ADMIN_TOKEN,
    ledger,
    shared,
    idleMs: number('MIND_PALACE_IDLE_MINUTES', 20) * 60_000,
    maxDevices: number('MIND_PALACE_MAX_DEVICES', MAX_DEVICES),
    newPerHour: number('MIND_PALACE_NEW_DEVICES_PER_HOUR', NEW_DEVICES_PER_HOUR),
    pictureDollars: number('MIND_PALACE_PICTURE_DOLLARS', PICTURE_DOLLARS),
    uploads: { file: number('MIND_PALACE_UPLOAD_MB', 25) * 1e6, total: number('MIND_PALACE_UPLOAD_MB_PER_DEVICE', 40) * 1e6 },
    following,
    storeLimit: number('MIND_PALACE_STORE_MB_PER_DEVICE', 20) * 1e6,
    madeLimit: number('MIND_PALACE_FILES_MB_PER_DEVICE', 60) * 1e6,
    record,
    judgeBot: judgeToken ? { token: judgeToken } : undefined,
    // deploy/deploy.sh says which: judging, with fly.toml's limits, or testing, with deploy/testing.env's.
    mode: env.MIND_PALACE_LIMITS_MODE || 'judging',
    log,
  });
  // A redeploy stops the machine with a signal: the day's counts are written before it goes.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void service.close().finally(() => process.exit(0)));
  console.log(`Mind Palace agents, hosted${fake ? ' (fake roles, no model)' : ''}: a space per device under ${join(dataDir, 'spaces')}`);
  console.log(`  listening ${service.url}, limits ${JSON.stringify(ledger.limits)}`);
  console.log(`  telegram  the owner's bot: ${env.TELEGRAM_BOT_TOKEN && env.MIND_PALACE_ALERT_CHAT ? 'alerts only, never read' : 'off'}; the judges' bot: ${judgeToken ? 'read, a chat per headset' : 'off (MIND_PALACE_JUDGE_BOT_TOKEN is not set)'}`);
} else {
  const running = await startServer({
    ...shared,
    port,
    host,
    dataDir,
    token: env.MIND_PALACE_TOKEN || undefined,
    // One program at a time may read a bot's messages, so the offline stand-in leaves the bot to the real service.
    // The demo is a stage, not the user's own space: nothing sent to the bot lands in it.
    telegram: !fake && !demo && env.TELEGRAM_BOT_TOKEN ? { token: env.TELEGRAM_BOT_TOKEN } : undefined,
    ...(demo ? { demo: { script: loadScript(join(demoDir, 'script.json')), mediaDir: join(demoDir, 'media'), showcase: showcase(), restart: restartHeadset(), voice: env.MIND_PALACE_VOICE || SPEECH_VOICE, record: demoRecord() } } : {}),
    log,
  });
  console.log(`Mind Palace agents${fake ? ' (fake roles, no model)' : ''}${demo ? ', the demo' : ''}`);
  if (demo) {
    console.log(`  demo   ${running.url}/demo#token=${running.token}   <- the page that goes to any round`);
    console.log(`  voice  ${shared.live ? 'Momo is live' : 'OFF: Momo cannot hear or speak without OPENAI_API_KEY in ~/.muse-garden.env'}`);
  }
  console.log(`  open   ${running.url}/#token=${running.token}`);
  console.log(`  socket ${running.url.replace('http', 'ws')}/ws?token=${running.token}`);
}
console.log(maps ? `  maps   on: place names are looked up at ${env.MIND_PALACE_MAPS}, and clients load its tiles` : '  maps   off: set MIND_PALACE_MAPS=openstreetmap to look places up and draw maps');
