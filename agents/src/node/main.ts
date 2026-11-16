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
import { PICTURE_DOLLARS, startHosted, telegramAlert } from './hosted/hosted.ts';
import { DEFAULT_LIMITS, Ledger } from './hosted/ledger.ts';
import { Overflow, Paused, SPARE_EFFORTS, SPARE_MODEL, SPARE_QUICK_MODEL, spareCost } from './hosted/overflow.ts';
import { openaiSearch, SEARCH_DOLLARS } from './search-openai.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const env = loadEnv();
const args = new Set(process.argv.slice(2));
const fake = args.has('--fake');
/** One service for many headsets: a space per device, limits, an off switch, and no Telegram reading (see agents/README.md). */
const hosted = env.MIND_PALACE_HOSTED === '1';
const dataDir = env.MIND_PALACE_DATA ?? join(root, fake ? 'data-fake' : 'data');
const number = (name: string, fallback: number) => (env[name]?.trim() ? Number(env[name]) : fallback);
const log = (line: string) => console.log(line);

const ledger = hosted
  ? new Ledger({
      file: join(dataDir, 'ledger.json'),
      limits: {
        voiceMinutes: number('MIND_PALACE_LIMIT_VOICE_MINUTES', DEFAULT_LIMITS.voiceMinutes),
        searches: number('MIND_PALACE_LIMIT_SEARCHES', DEFAULT_LIMITS.searches),
        webAnswers: number('MIND_PALACE_LIMIT_WEB_ANSWERS', DEFAULT_LIMITS.webAnswers),
        dollarsPerDay: number('MIND_PALACE_CAP_DOLLARS', DEFAULT_LIMITS.dollarsPerDay),
      },
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
    tokenBudget: env.MIND_PALACE_TOKEN_BUDGET ? Number(env.MIND_PALACE_TOKEN_BUDGET) : undefined,
    onCall: (c) => {
      ledger?.metaTokens(c.tokens ?? 0);
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
        ledger?.spend(dollars);
        log(`  overflow ${c.kind} ${c.role} ${c.ok ? 'ok' : 'FAILED'} ${c.ms}ms on ${c.model ?? '?'}${c.tokens ? `, ${c.tokens} tokens` : ''}, $${dollars.toFixed(4)}`);
      },
    });
    model = new Overflow({
      meta,
      spare,
      search: async (req) => {
        ledger?.spend(SEARCH_DOLLARS);
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
    return why ? `the service is ${why === 'off' ? 'switched off' : "over today's spend cap"}` : null;
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

const shared = {
  clientDir: join(root, 'client'),
  model,
  roles,
  keys: { YOUTUBE_API_KEY: env.YOUTUBE_API_KEY, TMDB_API_KEY: env.TMDB_API_KEY, EUROPEANA_API_KEY: env.EUROPEANA_API_KEY, GUARDIAN_API_KEY: env.GUARDIAN_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, MIND_PALACE_SEARCH_MODEL: env.MIND_PALACE_SEARCH_MODEL },
  speak: !fake && env.OPENAI_API_KEY ? openaiSpeech(fetch, { apiKey: env.OPENAI_API_KEY, model: env.MIND_PALACE_VOICE_MODEL, voice: env.MIND_PALACE_VOICE }) : undefined,
  live:
    !fake && env.OPENAI_API_KEY && env.MIND_PALACE_LIVE !== 'off'
      ? {
          open: openaiRealtime({ apiKey: env.OPENAI_API_KEY, model: liveModel }),
          options: liveOptions,
          webAnswer: openaiWebAnswer(fetch, { apiKey: env.OPENAI_API_KEY, model: env.MIND_PALACE_WEB_MODEL || undefined, effort: env.MIND_PALACE_WEB_EFFORT || undefined, log, spent: (dollars) => ledger?.spend(dollars) }),
        }
      : undefined,
  transcribe: !fake && env.OPENAI_API_KEY ? openaiTranscribe(fetch, { apiKey: env.OPENAI_API_KEY, model: env.MIND_PALACE_HEARING_MODEL }) : undefined,
  instagram: env.META_IG_TOKEN && env.META_IG_USER_ID ? { token: env.META_IG_TOKEN, userId: env.META_IG_USER_ID } : undefined,
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
    maxDevices: number('MIND_PALACE_MAX_DEVICES', 60),
    newPerHour: number('MIND_PALACE_NEW_DEVICES_PER_HOUR', 30),
    pictureDollars: number('MIND_PALACE_PICTURE_DOLLARS', PICTURE_DOLLARS),
    uploads: { file: number('MIND_PALACE_UPLOAD_MB', 25) * 1e6, total: number('MIND_PALACE_UPLOAD_MB_PER_DEVICE', 40) * 1e6 },
    record,
    log,
  });
  // A redeploy stops the machine with a signal: the day's counts are written before it goes.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void service.close().finally(() => process.exit(0)));
  console.log(`Mind Palace agents, hosted${fake ? ' (fake roles, no model)' : ''}: a space per device under ${join(dataDir, 'spaces')}`);
  console.log(`  listening ${service.url}, limits ${JSON.stringify(ledger.limits)}`);
  console.log(`  telegram  ${env.TELEGRAM_BOT_TOKEN && env.MIND_PALACE_ALERT_CHAT ? 'alerts only, no reading' : 'off'}`);
} else {
  const running = await startServer({
    ...shared,
    port,
    host,
    dataDir,
    token: env.MIND_PALACE_TOKEN || undefined,
    // One program at a time may read a bot's messages, so the offline stand-in leaves the bot to the real service.
    telegram: !fake && env.TELEGRAM_BOT_TOKEN ? { token: env.TELEGRAM_BOT_TOKEN } : undefined,
    log,
  });
  console.log(`Mind Palace agents${fake ? ' (fake roles, no model)' : ''}`);
  console.log(`  open   ${running.url}/#token=${running.token}`);
  console.log(`  socket ${running.url.replace('http', 'ws')}/ws?token=${running.token}`);
}
console.log(maps ? `  maps   on: place names are looked up at ${env.MIND_PALACE_MAPS}, and clients load its tiles` : '  maps   off: set MIND_PALACE_MAPS=openstreetmap to look places up and draw maps');
