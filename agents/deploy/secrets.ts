/**
 * Writes the hosted service's secrets to stdout as NAME=value lines, for `fly secrets import` to read from a pipe, and nothing else
 * to stdout. Keys come through the service's own loader (`loadEnv`), the app key from ~/.mind-palace/judging.properties (the judging
 * app's build reads the same line), the admin token from ~/.mind-palace/admin-token, and the Telegram chat for alerts from the pairing
 * the Mac's service keeps. A missing app key or admin token is made and kept there. No value is ever printed.
 * Usage: deploy/secrets.sh (which pipes this into fly)
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadEnv } from '../src/node/env.ts';

/**
 * What the service reads from its environment, as on the Mac. The budget and the limits are set in fly.toml instead. The Instagram
 * account (META_IG_TOKEN, META_IG_USER_ID) stays on the Mac: the server only searches the library deploy/instagram.sh copies.
 */
const PASSED = [
  'MODEL_API_KEY', 'MUSE_LLM_BASE_URL', 'MUSE_LLM_MODEL', 'MIND_PALACE_QUICK_MODEL',
  'OPENAI_API_KEY', 'YOUTUBE_API_KEY', 'TMDB_API_KEY', 'EUROPEANA_API_KEY', 'GUARDIAN_API_KEY', 'UNSPLASH_ACCESS_KEY', 'FAL_KEY',
  // The owner's bot, which the server only sends spend alerts through, and the judges' own bot, which only the server reads.
  'TELEGRAM_BOT_TOKEN', 'MIND_PALACE_JUDGE_BOT_TOKEN',
  'MIND_PALACE_LIVE', 'MIND_PALACE_LIVE_MODEL', 'MIND_PALACE_LIVE_TURN', 'MIND_PALACE_LIVE_EFFORT', 'MIND_PALACE_LIVE_PAUSE',
  'MIND_PALACE_VOICE', 'MIND_PALACE_VOICE_MODEL', 'MIND_PALACE_HEARING_MODEL',
  'MIND_PALACE_WEB_MODEL', 'MIND_PALACE_WEB_EFFORT', 'MIND_PALACE_SEARCH_MODEL', 'MIND_PALACE_MAPS',
];

const home = join(homedir(), '.mind-palace');
const properties = join(home, 'judging.properties');
const adminFile = join(home, 'admin-token');
const key = () => randomBytes(24).toString('base64url');

function kept(file: string, read: () => string | undefined, make: () => void): string {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (!read()) make();
  const value = read();
  if (!value) throw new Error(`could not keep a value in ${file}`);
  return value;
}

const appKeyOf = () => (existsSync(properties) ? /^\s*appKey\s*=\s*(\S+)\s*$/m.exec(readFileSync(properties, 'utf8'))?.[1] : undefined);
const appKey = kept(properties, appKeyOf, () => appendFileSync(properties, `${existsSync(properties) && !readFileSync(properties, 'utf8').endsWith('\n') ? '\n' : ''}appKey=${key()}\n`, { mode: 0o600 }));
if (!/^[A-Za-z0-9_-]+$/.test(appKey)) throw new Error(`the appKey in ${properties} must be letters, digits, - and _ only`);
const adminOf = () => (existsSync(adminFile) ? readFileSync(adminFile, 'utf8').trim() || undefined : undefined);
const adminToken = kept(adminFile, adminOf, () => writeFileSync(adminFile, `${key()}\n`, { mode: 0o600 }));

/** The pairing in the main checkout's data folder, where the user's own service runs. */
function pairedChat(): string | undefined {
  const given = process.env.MIND_PALACE_PAIRED;
  const common = resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: import.meta.dirname, encoding: 'utf8' }).trim(), '..');
  const file = given ?? join(common, 'agents/data/telegram.json');
  if (!existsSync(file)) return undefined;
  const chat = (JSON.parse(readFileSync(file, 'utf8')) as { paired?: { chatId?: number } | null }).paired?.chatId;
  return chat === undefined ? undefined : String(chat);
}

const env = loadEnv();
const lines = PASSED.flatMap((name) => (env[name]?.trim() ? [`${name}=${env[name]!.trim()}`] : []));
lines.push(`MIND_PALACE_APP_KEY=${appKey}`, `MIND_PALACE_ADMIN_TOKEN=${adminToken}`);
const chat = pairedChat();
if (chat) lines.push(`MIND_PALACE_ALERT_CHAT=${chat}`);
if (lines.some((line) => line.includes('\n'))) throw new Error('a value holds a line break, which fly secrets import cannot read');
process.stdout.write(`${lines.join('\n')}\n`);
process.stderr.write(
  `secrets: ${lines.length} values (${PASSED.filter((n) => env[n]?.trim()).length} from the env file, the app key and admin token from ${dirname(properties)}, ` +
    `${chat ? 'the paired Telegram chat for alerts' : 'no paired Telegram chat, so alerts only go to the log'}); none printed\n`,
);
