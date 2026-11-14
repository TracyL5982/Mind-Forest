/**
 * Drives the web client in a real Chromium against the service with stand-in agents, runs the
 * steps it is given in order, and saves screenshots. Verifiers use it to look at one behaviour.
 *
 * Run: node --no-warnings --import tsx scripts/lane.ts --out <dir> [options] <step> [<step> ...]
 *
 * Options
 *   --out <dir>        where screenshots and the video are saved. Required.
 *   --size <w>x<h>     the page size. Default 1440x900.
 *   --scale <n>        device pixels per page pixel. Default 2.
 *   --client <dir>     serve the client folder of another checkout, to compare two branches.
 *   --video            record the whole run to <out>/lane.webm.
 *
 * Steps. A step is `name` or `name=value`.
 *   library            open library.html
 *   app                open the app and connect to the service
 *   think=<text>       type a thought into the dock and wait for its picks
 *   shapes             load the Every shape tree: each card type, each arrangement, one unknown type
 *   crowd=<n>          load a tree of n note cards. Default 200.
 *   card=<type>:<json> add one kept card of that type with those props, in a tree named Lane
 *   tree=<text>        go to the tree whose name holds this text
 *   zoom=<percent>     zoom the field about the middle of the page
 *   open=<what>        click a card. <what> is a card type, or text on the card.
 *   press=<name>       click the button with this name in the opened card
 *   close              close the opened card
 *   wait=<ms>          wait
 *   apart              fail when two cards overlap
 *   shot=<name>        save <out>/<name>.png. `shot=<name>:full` saves the whole scrolling page.
 *
 * Example
 *   node --no-warnings --import tsx scripts/lane.ts --out /tmp/lane app shapes tree=Every zoom=50 shot=zoom-50 open=chart shot=chart-open
 *
 * Each step prints one line. The run exits 1 when a step fails or the page logs an error. A file
 * that fails to load is printed and does not fail the run, so a lane can show a missing picture.
 * Set MIND_PALACE_CHROMIUM to use another browser.
 */
import { mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright-core';
import type { Command, Item, Node } from '../src/core/domain.ts';
import type { Running } from '../src/node/server.ts';
import { PNG, TOKEN, bootFake, browserPath, crowd, showcase } from '../test/stage.ts';

const { values: flags, positionals: steps } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    size: { type: 'string', default: '1440x900' },
    scale: { type: 'string', default: '2' },
    client: { type: 'string' },
    video: { type: 'boolean', default: false },
  },
});
if (!flags.out || steps.length === 0) {
  console.error('usage: lane.ts --out <dir> [--size 1440x900] [--scale 2] [--client <dir>] [--video] <step> [<step> ...]\nThe steps are listed at the top of scripts/lane.ts.');
  process.exit(2);
}
const out = resolve(flags.out);
mkdirSync(out, { recursive: true });
const [width, height] = flags.size.split('x').map(Number) as [number, number];

/** Cards finish gliding about half a second after a change. */
const settle = (page: Page) => page.waitForTimeout(900);

const cards = (page: Page) => page.locator('.card[data-id]');

async function connect(page: Page, run: Running): Promise<void> {
  await page.goto(`${run.url}/#token=${TOKEN}`);
  await page.locator('#status[data-state="live"]').waitFor();
}

function loneCard(type: string, props: Record<string, unknown>, run: Running): { id: string; commands: Command[] } {
  const at = new Date().toISOString();
  const n = run.mind.trees.has('lane') ? run.mind.treeNodes('lane').length : 0;
  const make = (id: string, component: string, title: string, parent: string | null, given: Record<string, unknown>): [Item, Node] => [
    { id: `item-${id}`, kind: 'text', title, text: '', summary: '', tags: [], data: {}, source: { from: 'paste', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0 },
    { id, treeId: 'lane', itemId: `item-${id}`, parent, status: 'kept', why: '', importance: 0.5, origin: { by: 'user' }, view: { component, props: given, by: 'renderer' }, order: n },
  ];
  const commands: Command[] = [];
  if (n === 0) {
    const [item, root] = make('lane-root', 'note', 'Lane', null, {});
    commands.push({ type: 'addItem', item }, { type: 'createTree', tree: { id: 'lane', title: 'Lane', rootId: root.id, digest: '', createdAt: at }, root });
  }
  const [item, node] = make(`lane-${n}`, type, `A ${type} card`, 'lane-root', props);
  commands.push({ type: 'addItem', item }, { type: 'addNode', node });
  return { id: node.id, commands };
}

async function overlapping(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>('.card[data-id]:not(.is-under)')].map((el) => ({ title: el.getAttribute('aria-label'), r: el.getBoundingClientRect() }));
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!.r;
        const b = boxes[j]!.r;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(`${boxes[i]!.title} / ${boxes[j]!.title}`);
      }
    }
    return hits;
  });
}

const zoomOf = (page: Page) => page.locator('.world').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);

type Step = (value: string, page: Page, run: Running) => Promise<string | void>;

const STEPS: Record<string, Step> = {
  async library(_, page, run) {
    await page.goto(`${run.url}/library.html`);
    await page.locator('#composites .lib-entry').last().waitFor();
  },
  app: (_, page, run) => connect(page, run),
  async think(value, page, run) {
    const before = await cards(page).count();
    await page.getByLabel('A thought for the mindstorm').fill(value);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.card[data-id]').length > n, before);
    await run.pipeline.idle();
    await settle(page);
    return `${(await cards(page).count()) - before} cards arrived`;
  },
  async shapes(_, page, run) {
    const up = await page.request.post(`${run.url}/api/assets?name=still.png`, { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/png' }, data: Buffer.from(PNG) });
    const image = ((await up.json()) as { url: string }).url;
    const other = [...run.mind.trees.values()][0]?.rootId;
    if (!run.pipeline.userCommands('Add every shape', showcase(image, other))) throw new Error('the service refused the Every shape tree');
    await page.locator('.tree-chip', { hasText: 'Every shape' }).waitFor();
    await run.pipeline.idle();
  },
  async crowd(value, page, run) {
    const total = Number(value) || 200;
    if (!run.pipeline.userCommands('Add a crowd', crowd(total))) throw new Error('the service refused the crowd');
    await page.waitForFunction((n) => document.querySelectorAll('.card[data-id^="crowd-"]').length === n, total);
    return `${total} cards drawn`;
  },
  async card(value, page, run) {
    const cut = value.indexOf(':');
    const type = cut < 0 ? value : value.slice(0, cut);
    const props = cut < 0 ? {} : (JSON.parse(value.slice(cut + 1)) as Record<string, unknown>);
    const { id, commands } = loneCard(type, props, run);
    if (!run.pipeline.userCommands(`Add a ${type} card`, commands)) throw new Error(`the service refused a ${type} card`);
    await page.locator(`.card[data-id="${id}"]`).waitFor();
    return `drawn as ${await page.locator(`.card[data-id="${id}"]`).getAttribute('data-component')}`;
  },
  async tree(value, page) {
    await page.locator('.tree-chip', { hasText: value }).first().click();
    await settle(page);
  },
  async zoom(value, page) {
    const want = Number(value) / 100;
    await page.mouse.move(width / 2, height / 2);
    await page.keyboard.down('Control');
    let got = await zoomOf(page);
    // input.js turns a wheel with Control held into a zoom of exp(-deltaY * 0.012). The browser
    // caps how far one wheel event turns, so this closes in over several.
    for (let tries = 0; tries < 20 && Math.abs(got - want) > 0.005; tries++) {
      await page.mouse.wheel(0, -Math.log(want / got) / 0.012);
      await page.waitForTimeout(60);
      got = await zoomOf(page);
    }
    await page.keyboard.up('Control');
    if (Math.abs(got - want) > 0.005) throw new Error(`asked for ${want}, the field is at ${got.toFixed(3)}`);
    return `the field is at ${Math.round(got * 100)} percent`;
  },
  async open(value, page) {
    const byType = page.locator(`.card[data-id][data-component="${value}"]`);
    const wanted = /^[a-z-]+$/.test(value) && (await byType.count()) > 0 ? byType : cards(page).filter({ hasText: value });
    // Several trees can hold a card that matches. Take the first whose middle can be clicked.
    const reachable = await wanted.evaluateAll((els) => els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }));
    if (reachable < 0) throw new Error(`no card for "${value}" is in view and uncovered`);
    await wanted.nth(reachable).click();
    await page.locator('#panel:not([hidden])').waitFor();
    await settle(page);
    return `opened "${await page.locator('#panel .panel-title').textContent()}"`;
  },
  async press(value, page) {
    await page.locator('#panel').getByRole('button', { name: value, exact: true }).click();
    await settle(page);
  },
  async close(_, page) {
    await page.keyboard.press('Escape');
    await settle(page);
  },
  wait: (value, page) => page.waitForTimeout(Number(value)),
  async apart(_, page) {
    await settle(page);
    const hits = await overlapping(page);
    if (hits.length > 0) throw new Error(`${hits.length} pairs of cards overlap, the first is ${hits[0]}`);
    return `${await cards(page).count()} cards, none overlap`;
  },
  async shot(value, page) {
    const [name, mode] = value.split(':');
    await settle(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const path = join(out, `${name}.png`);
    await page.screenshot({ path, fullPage: mode === 'full' });
    return path;
  },
};

const run = await bootFake(flags.client ? { clientDir: resolve(flags.client) } : {});
const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: Number(flags.scale),
  ...(flags.video ? { recordVideo: { dir: out, size: { width, height } } } : {}),
});
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const problems: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (err) => problems.push(String(err)));

let failed = false;
try {
  for (const step of steps) {
    const cut = step.indexOf('=');
    const name = cut < 0 ? step : step.slice(0, cut);
    const act = STEPS[name];
    if (!act) throw new Error(`no step named ${name}`);
    const said = await act(cut < 0 ? '' : step.slice(cut + 1), page, run);
    console.log(`ok   ${step}${said ? `  ${said}` : ''}`);
  }
} catch (err) {
  failed = true;
  console.log(`FAIL ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`);
} finally {
  const video = page.video();
  await context.close();
  if (video) {
    renameSync(await video.path(), join(out, 'lane.webm'));
    console.log(`video ${join(out, 'lane.webm')}`);
  }
  await browser.close();
  await run.close();
}
const missing = (line: string) => line.startsWith('Failed to load resource');
for (const line of problems) console.log(`${missing(line) ? 'page note' : 'page error'}: ${line}`);
process.exit(failed || problems.some((line) => !missing(line)) ? 1 : 0);
