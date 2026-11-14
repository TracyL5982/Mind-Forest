import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelClient } from '../core/ports.ts';
import type { Roles } from '../core/roles/types.ts';
import { FakeModel } from '../fake/model.ts';
import { loadEnv } from './env.ts';
import { openMaps, type Maps } from './geocoder.ts';
import { MetaModel } from './model-meta.ts';
import { startServer } from './server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const env = loadEnv();
const args = new Set(process.argv.slice(2));
const fake = args.has('--fake');

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
  model = new MetaModel({
    apiKey: env.MODEL_API_KEY,
    baseUrl: env.MUSE_LLM_BASE_URL || undefined,
    model: env.MUSE_LLM_MODEL || undefined,
    tokenBudget: env.MIND_PALACE_TOKEN_BUDGET ? Number(env.MIND_PALACE_TOKEN_BUDGET) : undefined,
    onCall: (c) => console.log(`  model ${c.kind} ${c.role} ${c.ok ? 'ok' : 'FAILED'} ${c.ms}ms${c.tokens ? ` ${c.tokens} tokens` : ''}`),
  });
  roles = (await import('../core/roles/index.ts')).roles;
}

const dataDir = env.MIND_PALACE_DATA ?? join(root, fake ? 'data-fake' : 'data');
let maps: Maps | undefined;
try {
  maps = env.MIND_PALACE_MAPS?.trim() ? openMaps(env.MIND_PALACE_MAPS, join(dataDir, 'places.json')) : undefined;
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const running = await startServer({
  port: Number(env.MIND_PALACE_PORT ?? 8787),
  host: env.MIND_PALACE_HOST ?? '0.0.0.0',
  dataDir,
  clientDir: join(root, 'client'),
  model,
  roles,
  token: env.MIND_PALACE_TOKEN || undefined,
  instagram: env.META_IG_TOKEN && env.META_IG_USER_ID ? { token: env.META_IG_TOKEN, userId: env.META_IG_USER_ID } : undefined,
  maps,
  log: (line) => console.log(line),
});

console.log(`Mind Palace agents${fake ? ' (fake roles, no model)' : ''}`);
console.log(`  open   ${running.url}/#token=${running.token}`);
console.log(`  socket ${running.url.replace('http', 'ws')}/ws?token=${running.token}`);
console.log(maps ? `  maps   on: place names are looked up at ${env.MIND_PALACE_MAPS}, and clients load its tiles` : '  maps   off: set MIND_PALACE_MAPS=openstreetmap to look places up and draw maps');
