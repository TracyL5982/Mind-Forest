/**
 * Adds the headset's library to the mindstorm: films, works, notes, tags and the saved trees. Offline, and a second run adds nothing.
 * Stop the service first: it keeps the mindstorm in memory and would write over the import.
 * Usage: npm run import-library   (MIND_PALACE_DATA names another data folder)
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { libraryDraft, sipsPictures } from '../src/node/library.ts';
import { SqliteStore } from '../src/node/store.ts';

const agents = resolve(import.meta.dirname, '..');
const dataDir = resolve(loadEnv().MIND_PALACE_DATA ?? join(agents, 'data'));
const lock = join(dataDir, 'service.pid');
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  let running = false;
  try {
    process.kill(pid, 0);
    running = true;
  } catch {
    // No such process: the service stopped without removing its mark.
  }
  if (running) {
    console.error(`The service is running on ${dataDir} (process ${pid}). Stop it, then import.`);
    process.exit(1);
  }
}

const started = Date.now();
const store = new SqliteStore(join(dataDir, 'mindstorm.sqlite'));
const now = () => new Date().toISOString();
const mind = new Mindstorm({ now, newId: () => randomUUID() });
mind.load(store.all());
const { draft, added } = await libraryDraft({
  files: { repo: resolve(agents, '..') },
  mind,
  assets: new DiskAssets(join(dataDir, 'assets')),
  pictures: sipsPictures,
  now,
  log: (line) => console.log(`  ${line}`),
});
if (draft) store.append(mind.apply(draft));
store.close();
console.log(
  draft
    ? `Added ${added.films} films, ${added.works} works, ${added.notes} notes, ${added.tags} tags and ${added.trees} saved trees to ${dataDir}, with ${added.pictures} pictures, in ${((Date.now() - started) / 1000).toFixed(1)} s.`
    : `${dataDir} already holds the whole library.`,
);
