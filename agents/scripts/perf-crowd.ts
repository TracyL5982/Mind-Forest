/**
 * Times the web client drawing a crowd: milliseconds from the `Add a crowd` command reaching the
 * service to 200 note cards being in the page and painted once.
 *
 * Run: node --no-warnings --import tsx scripts/perf-crowd.ts [--client <dir>] [--cards <n>] [--chips]
 *
 * --chips gives every other card a date and a place, so half the crowd draws a line of chips.
 * --client serves another checkout's client folder, so two branches can be timed by one script
 * against the same service. Each run starts a fresh service and a fresh browser. Timings move by
 * tens of milliseconds between runs, so compare medians of runs that alternate between branches.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { TOKEN, bootFake, browserPath, crowd } from '../test/stage.ts';

const { values: flags } = parseArgs({ options: { client: { type: 'string' }, cards: { type: 'string', default: '200' }, chips: { type: 'boolean', default: false } } });
const total = Number(flags.cards);

const run = await bootFake(flags.client ? { clientDir: resolve(flags.client) } : {});
const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${run.url}/#token=${TOKEN}`);
  await page.locator('#status[data-state="live"]').waitFor();
  // A string, because tsx wraps named functions in a helper the page does not have. The promise is
  // parked on the page, and `void` keeps this call from waiting for it.
  await page.evaluate(`void (window.crowdDrawn = new Promise((done) => {
    const look = () => {
      if (document.querySelectorAll('.card[data-id^="crowd-"]').length < ${total}) return requestAnimationFrame(look);
      requestAnimationFrame(() => requestAnimationFrame(() => done(performance.timeOrigin + performance.now())));
    };
    look();
  }))`);
  const started = Date.now();
  if (!run.pipeline.userCommands('Add a crowd', crowd(total, { chips: flags.chips }))) throw new Error('the service refused the crowd');
  const drawn = await page.evaluate<number>('window.crowdDrawn');
  console.log(`${Math.round(drawn - started)} ms from Add a crowd to ${total} drawn cards`);
} finally {
  await browser.close();
  await run.close();
}
