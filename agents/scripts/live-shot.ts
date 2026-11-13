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

await run.pipeline.dump([{ kind: 'text', text: 'I want to design a small ceramic lamp that glows like a paper lantern. Warm, uneven, hand-made.' }]);
await settle();
await shot('live-1-thought-with-picks');

const rootId = [...run.mind.trees.values()][0]!.rootId;
run.pipeline.utter('show me what this could look like, and how do potters make porcelain thin enough to glow', { focus: rootId, selection: [], treeId: run.mind.node(rootId).treeId }, true);
await settle();
await shot('live-2-after-asking');

for (const tree of run.mind.trees.values()) {
  console.log(`TREE ${tree.title}`);
  for (const n of run.mind.treeNodes(tree.id)) {
    const item = run.mind.item(n.itemId);
    console.log(`  ${'  '.repeat(run.mind.depth(n.id))}${n.status === 'pick' ? '┄' : '─'} [${n.view.component}] ${item.title} <${item.source.from}>`);
  }
}
console.log('console errors:', errors.length, errors.slice(0, 3));
await browser.close();
await run.close();
process.exit(0);
