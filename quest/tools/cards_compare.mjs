#!/usr/bin/env node
// Sets each card the Quest draws beside the web client's own drawing of the same sample, one PNG per
// type: the web card and the Quest's small face, then the web's opened card, where the library page
// draws one, and the Quest's opened face. The Quest's faces come from quest/core/cards/test/faces.sh;
// the web's from the running library page, with Playwright.
//   node quest/tools/cards_compare.mjs --faces <faces.sh folder> --out <folder> \
//     --playwright <a folder whose node_modules holds playwright-core> [--page http://localhost:8700/library.html] [--chromium <binary>]
import { readFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { join, resolve } from 'path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
for (const need of ['faces', 'out', 'playwright']) {
  if (!args[need]) {
    console.error(`missing --${need}`);
    process.exit(2);
  }
}
const { chromium } = createRequire(join(resolve(args.playwright), 'package.json'))('playwright-core');
const faces = resolve(args.faces);
const manifest = JSON.parse(readFileSync(join(faces, 'manifest.json'), 'utf8'));
const types = [...new Set(manifest.map((card) => card.type))];
mkdirSync(args.out, { recursive: true });

const browser = await chromium.launch(args.chromium ? { executablePath: args.chromium } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(args.page ?? 'http://localhost:8700/library.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

/** The web's cards of one type, in the page's order, each with its opened card where the page draws one. */
async function webCards(type) {
  const section = page.locator('#components section.lib-entry').filter({ has: page.locator(`h3:text-is("${type}")`) });
  const cells = section.locator('.lib-cell');
  const cards = [];
  const rowFirst = new Map();
  for (let i = 0; i < await cells.count(); i++) {
    const cell = cells.nth(i);
    const label = (await cell.locator('.lib-label').first().textContent()).trim();
    const row = await cell.evaluate((el) => {
      const r = el.closest('.lib-row');
      return [...document.querySelectorAll('.lib-row')].indexOf(r);
    });
    if (await cell.locator('.lib-stage').count()) {
      const card = { label, small: await cell.locator('.lib-stage').first().screenshot() };
      cards.push(card);
      if (!rowFirst.has(row)) rowFirst.set(row, card);
    } else if (await cell.locator('.panel').count()) {
      const shot = await cell.locator('.panel').first().screenshot();
      const owner = label.toLowerCase() === 'opened' ? rowFirst.get(row) : cards.find((c) => `${c.label}, opened`.toLowerCase() === label.toLowerCase());
      if (owner) owner.opened = shot;
    }
  }
  return cards;
}

const uri = (png) => `data:image/png;base64,${png.toString('base64')}`;
const file = (name) => readFileSync(join(faces, name));
const img = (png) => (png ? `<img src="${uri(png)}">` : '<div class="none">none on the page</div>');

for (const type of types) {
  const web = await webCards(type);
  const quest = manifest.filter((card) => card.type === type);
  const rows = quest.map((card, i) => {
    const theirs = web[i];
    const same = theirs && card.label.endsWith(theirs.label.replace(/^.*: /, ''));
    return `<tr><th>${card.label}<br><small>${card.status}, ${card.footprint.join(' by ')}${same ? '' : '<br>no matching web card'}</small></th>
      <td>${img(same ? theirs.small : null)}</td><td>${img(file(`${card.id}-small.png`))}</td>
      <td>${img(same ? theirs.opened : null)}</td><td>${img(file(`${card.id}-open.png`))}</td></tr>`;
  });
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #0b0d11; color: #ecebe6; font: 13px -apple-system, sans-serif; }
    table { border-collapse: separate; border-spacing: 24px 18px; } th { text-align: left; vertical-align: top; width: 140px; font-weight: 600; }
    th small { color: #909089; font-weight: 400; } td { vertical-align: top; } img { display: block; zoom: 0.5; }
    thead th { color: #909089; font-weight: 400; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; }
    .none { color: #555; font-size: 11px; }
  </style><h2>${type}</h2><table><thead><tr><th></th><th>Web</th><th>Quest small</th><th>Web opened</th><th>Quest opened</th></tr></thead>${rows.join('')}</table>`;
  const sheet = await browser.newPage({ viewport: { width: 1700, height: 800 }, deviceScaleFactor: 1 });
  await sheet.setContent(html);
  await sheet.screenshot({ path: join(args.out, `${type}.png`), fullPage: true });
  await sheet.close();
  console.log(`${type}: ${quest.length} cards, ${web.length} on the page`);
}
await browser.close();
