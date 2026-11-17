/**
 * Writes the demo service's secrets to stdout as NAME=value lines, for `fly secrets import` to read from a pipe, and nothing else
 * to stdout. Keys come through the service's own loader (`loadEnv`), as deploy/secrets.ts takes the judging service's. The demo's
 * own access key is kept in ~/.mind-palace/demo.properties with the service's address (server=https://…, token=…), made there
 * when it is missing: agents/demo/headset.sh reads that file to join a headset and to open the page. No value is ever printed.
 * Usage: deploy/demo.sh (which pipes this into fly). The app's name is the first argument.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadEnv } from '../src/node/env.ts';
import { ownerSecret, pairingIn } from '../src/node/telegram.ts';

/**
 * What the demo reads from its environment. The owner's bot is read there only while the demo is filmed with Telegram, and then the
 * Mac's own service must be started without it (src/node/telegram.ts, ownBot): one program at a time may read a bot.
 */
const PASSED = [
  'MODEL_API_KEY', 'MUSE_LLM_BASE_URL', 'MUSE_LLM_MODEL', 'MIND_PALACE_QUICK_MODEL',
  'OPENAI_API_KEY', 'YOUTUBE_API_KEY', 'TMDB_API_KEY', 'EUROPEANA_API_KEY', 'GUARDIAN_API_KEY', 'UNSPLASH_ACCESS_KEY', 'FAL_KEY',
  'MIND_PALACE_LIVE', 'MIND_PALACE_LIVE_MODEL', 'MIND_PALACE_LIVE_TURN', 'MIND_PALACE_LIVE_EFFORT', 'MIND_PALACE_LIVE_PAUSE',
  'MIND_PALACE_VOICE', 'MIND_PALACE_VOICE_MODEL', 'MIND_PALACE_HEARING_MODEL',
  'MIND_PALACE_WEB_MODEL', 'MIND_PALACE_WEB_EFFORT', 'MIND_PALACE_SEARCH_MODEL', 'MIND_PALACE_MAPS',
  'TELEGRAM_BOT_TOKEN',
];

const app = process.argv[2];
if (!app || !/^[a-z0-9-]+$/.test(app)) throw new Error('usage: demo-secrets.ts <fly app name>');

// The demo keeps no file between deploys, so it is paired to the account the owner paired on their Mac: the pairing the Mac's service
// keeps in the main checkout's data folder (MIND_PALACE_PAIRED names another). With none, nothing is deployed, rather than a demo that hears no one.
const common = resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: import.meta.dirname, encoding: 'utf8' }).trim(), '..');
const pairingFile = process.env.MIND_PALACE_PAIRED ?? join(common, 'agents/data/telegram.json');
const owner = pairingIn(pairingFile);
if (!owner) throw new Error(`No Telegram pairing in ${pairingFile}: pair the bot on the Mac first (its Mind Palace page, Settings, then Pair under Telegram), then deploy again.`);

const home = join(homedir(), '.mind-palace');
const file = join(home, 'demo.properties');
const server = `https://${app}.fly.dev`;
const read = (name: string) => (existsSync(file) ? new RegExp(`^\\s*${name}\\s*=\\s*(\\S+)\\s*$`, 'm').exec(readFileSync(file, 'utf8'))?.[1] : undefined);
mkdirSync(home, { recursive: true, mode: 0o700 });
// A key made once is kept, so a headset joined before a new deploy stays joined after it.
const token = read('token') ?? randomBytes(24).toString('base64url');
if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error(`the token in ${file} must be letters, digits, - and _ only`);
if (read('token') !== token || read('server') !== server) writeFileSync(file, `server=${server}\ntoken=${token}\n`, { mode: 0o600 });

const env = loadEnv();
if (!env.MODEL_API_KEY?.trim()) throw new Error('MODEL_API_KEY is not in the env file: the demo cannot start without it');
const lines = PASSED.flatMap((name) => (env[name]?.trim() ? [`${name}=${env[name]!.trim()}`] : []));
lines.push(`MIND_PALACE_TOKEN=${token}`, `MIND_PALACE_TELEGRAM_OWNER=${ownerSecret.encode(owner)}`);
if (lines.some((line) => line.includes('\n'))) throw new Error('a value holds a line break, which fly secrets import cannot read');
process.stdout.write(`${lines.join('\n')}\n`);
process.stderr.write(
  `secrets: ${lines.length} values (${PASSED.filter((n) => env[n]?.trim()).length} from the env file, the demo's key from ${file}, the Telegram pairing from ${pairingFile}); none printed` +
    `${env.OPENAI_API_KEY?.trim() ? '' : '. NOTE: no OPENAI_API_KEY, so Momo will neither hear nor speak there'}\n`,
);
