import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { roles } from '../src/core/roles/index.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { startServer } from '../src/node/server.ts';

/** The real roles, the live model and the web client together, once, with screenshots. */
const env = loadEnv();
const root = resolve(import.meta.dirname, '..');
const run = await startServer({
  port: 0,
  host: '127.0.0.1',
  dataDir: mkdtempSync(join(tmpdir(), 'mp-live-')),
  clientDir: join(root, 'client'),
  model: new MetaModel({ apiKey: env.MODEL_API_KEY ?? '' }),
  roles,
  token: 'live',
  keys: env,
  instagram: env.META_IG_TOKEN && env.META_IG_USER_ID ? { token: env.META_IG_TOKEN, userId: env.META_IG_USER_ID } : undefined,
  log: (line) => console.log(line),
});
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const shell = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().at(-1)!;
const browser = await chromium.launch({ executablePath: join(cache, shell, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium') }).catch(() =>
  chromium.launch({ channel: 'chrome' }),
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${run.url}/#token=live`);

const shot = (name: string) => page.screenshot({ path: join(root, 'docs/screenshots', `${name}.png`) });
const settle = async () => {
  await run.pipeline.idle();
  await page.waitForTimeout(1500);
  await run.pipeline.idle();
  await page.waitForTimeout(1500);
};

// A thought typed with no picture: checks the found material, how it is drawn, and that one undo takes the whole run back.
const thought = process.argv[2];
if (!thought) throw new Error('usage: tsx scripts/live-text.ts "<a thought>"');
const started = Date.now();
await page.getByLabel('A thought for the mindstorm').fill(thought);
await page.getByLabel('A thought for the mindstorm').press('Enter');
await page.locator('.card.is-pick').first().waitFor({ timeout: 120_000 });
console.log(`first pick on screen after ${((Date.now() - started) / 1000).toFixed(1)}s`);
await settle();
await settle();
console.log(`all picks on screen after ${((Date.now() - started) / 1000).toFixed(1)}s`);
await shot('live-text-1-picks');
const parts = run.mind.changes().filter((c) => c.origin.role === 'scout');
console.log(`scout deliveries: ${parts.length}, sharing ${new Set(parts.map((c) => c.part)).size} part`);
let n = 0;
for (const component of ['chart', 'image', 'video', 'note']) {
  const card = page.locator(`.card.is-pick[data-component="${component}"]`).first();
  if ((await card.count()) === 0) continue;
  await card.click();
  await page.waitForTimeout(1200);
  await shot(`live-text-${++n + 1}-open-${component}`);
  await page.keyboard.press('Escape');
}

for (const tree of run.mind.trees.values()) {
  console.log(`TREE ${tree.title}`);
  for (const n of run.mind.treeNodes(tree.id)) {
    const item = run.mind.item(n.itemId);
    console.log(`  ${'  '.repeat(run.mind.depth(n.id))}${n.status === 'pick' ? '┄' : '─'} [${n.view.component}] ${item.title} <${item.source.from}>`);
  }
}
const before = await page.locator('.card.is-pick').count();
await page.getByRole('button', { name: /undo/i }).first().click();
await page.waitForTimeout(1500);
console.log(`picks before undo: ${before}, after one undo: ${await page.locator('.card.is-pick').count()}`);
console.log('console errors:', errors.length, errors.slice(0, 3));
await browser.close();
await run.close();
process.exit(0);
