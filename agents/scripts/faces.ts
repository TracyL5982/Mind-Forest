/**
 * Draws every sample in test/footprints.json on the library page in a real browser, as the field draws a card, and prints what
 * is wrong with each small face by the sizing rule: wider than 210 px or taller than 146, a part past its face, text clamped,
 * cut, ended with an ellipsis or holding more than its box, a row drawing more lines than it was counted for, read text under
 * 13.5 px or in italics. A sample's pictures are drawn as missing, since the fixtures name files no server holds. The library
 * page's own cards are checked too, with their pictures. `--type note,list` checks those types only, and
 * `--shots <dir>` saves the samples in parts 900 px tall, and the library page in parts 1800 px tall, there.
 *
 * Run: node --no-warnings --import tsx scripts/faces.ts [--type a,b] [--shots dir]
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { bootFake, browserPath, faceFaults } from '../test/stage.ts';

type Sample = { type: string; item: Record<string, unknown>; props: Record<string, unknown> };

const arg = (name: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const only = arg('--type')?.split(',') ?? [];
const shots = arg('--shots');
const { samples } = JSON.parse(readFileSync(join(import.meta.dirname, '../test/footprints.json'), 'utf8')) as { samples: Sample[] };
const drawn = samples.filter((sample) => only.length === 0 || only.includes(sample.type));

const run = await bootFake({ dataDir: mkdtempSync(join(tmpdir(), 'mp-faces-')) });
const browser = await chromium.launch({ executablePath: browserPath() });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript('window.__name = (f) => f');
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('requestfailed', (request) => errors.push(`request failed: ${request.url()}`));
  page.on('response', (response) => response.status() >= 400 && errors.push(`${response.status()}: ${response.url()}`));
  await page.goto(`${run.url}/library.html`);
  await page.locator('#composites .lib-entry').last().waitFor({ timeout: 15000 }).catch((error) => {
    throw new Error(`the library page did not draw: ${errors.join('; ') || error}`);
  });
  await page.evaluate(async (list) => {
    const registry = '/js/components/index.js';
    const { drawCard, sizeOf } = await import(registry);
    const box = document.createElement('div');
    box.id = 'faces';
    box.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;padding:16px;background:var(--bg)';
    document.body.prepend(box);
    list.forEach((sample, i) => {
      const node = { id: `face-${i}`, status: 'kept', view: { component: sample.type, props: sample.props } };
      const item = { title: '', text: '', summary: '', tags: [], data: {}, source: { from: 'paste' }, origin: { by: 'user' }, ...sample.item };
      const [w, h] = sizeOf(node, item);
      const card = document.createElement('div');
      card.className = 'card is-kept';
      card.dataset.component = sample.type;
      card.dataset.said = JSON.stringify([sample.item, sample.props]);
      card.setAttribute('aria-label', `sample ${i}`);
      card.style.cssText = `position:relative;width:${w}px;height:${h}px`;
      const face = document.createElement('div');
      face.className = 'card-face';
      face.append(drawCard(node, item, { asset: () => '' }));
      card.append(face);
      box.append(card);
    });
  }, drawn);
  await page.waitForTimeout(300);
  const faults = (await faceFaults(page)).filter((line) => only.length === 0 || only.some((type) => line.startsWith(`${type} `)));
  for (const line of faults) console.log(line);
  for (const line of errors) console.log(`console: ${line}`);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    const { width, height } = (await page.locator('#faces').boundingBox())!;
    for (let top = 0, part = 0; top < height; top += 900, part += 1) {
      await page.screenshot({ path: join(shots, `faces-${part}.png`), fullPage: true, clip: { x: 0, y: top, width, height: Math.min(900, height - top) } });
    }
    await page.evaluate(() => document.getElementById('faces')!.remove());
    const tall = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let top = 0, part = 0; top < tall; top += 1800, part += 1) {
      await page.screenshot({ path: join(shots, `library-${part}.png`), fullPage: true, clip: { x: 0, y: top, width: 1440, height: Math.min(1800, tall - top) } });
    }
  }
  console.log(`${drawn.length} samples drawn, ${faults.length} faults, ${errors.length} console errors`);
  process.exitCode = faults.length + errors.length > 0 ? 1 : 0;
} finally {
  await browser.close();
  await run.close();
}
