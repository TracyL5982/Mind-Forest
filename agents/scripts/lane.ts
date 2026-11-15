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
 *   shapes             load the Every shape tree: each card type and each arrangement. `shapes=eleven`
 *                      leaves out the types drawn from structure or assembled from parts, the recording
 *                      and the arrangements added after the first six, to compare with a client that
 *                      does not draw them.
 *   chips              load the With chips tree: cards whose items carry a date, a place, people
 *                      or an origin, twins that carry none, and a timeline of cards with chips
 *   crowd=<n>          load a tree of n note cards. Default 200. `crowd=<n>:chips` gives every
 *                      other card a date and a place.
 *   card=<type>:<json> add one kept card of that type in a tree named Lane. The type is any of the
 *                      twenty-eight in docs/libraries.md, or one no client knows. The card keeps the
 *                      view it is given, whatever its item holds: the stand-in Renderer redraws every
 *                      other tree by the rules and leaves this one as placed. The JSON is the card's
 *                      props, or { item, props, pick } to also set the item's title, summary,
 *                      text, data or origin, or to add the card as a pick: card=fact:{"item":{"title":"Budget"},"props":{"value":"$1.2M","label":"spent"},"pick":true}
 *                      A card shows chips for what its item's data holds: card=note:{"item":{"data":{"when":"1958","where":"Rome"}}}
 *                      The step prints the card's footprint and the text of each chip.
 *   group=<kind>:<json> arrange the cards added since the last group as a gallery, timeline,
 *                      comparison, sequence, cluster, stack or layout. The JSON is the group's props, and
 *                      may hold a title. A key $0, $1, ... stands for the first, second, ... card:
 *                      group=timeline:{"title":"Years","labels":{"$0":"1958","$1":"1975","$2":"1990"}}
 *                      A value "$0" stands for a card too, as a layout's tree names its members:
 *                      group=layout:{"tree":{"kind":"row","label":"Two","children":[{"kind":"card","id":"$0","role":"lead"},{"kind":"card","id":"$1","role":"normal"},{"kind":"card","id":"$2","role":"minor"}]}}
 *   tree=<text>        go to the tree whose name holds this text. The field zooms out to fit it,
 *                      and never zooms in past 100 percent.
 *   zoom=<percent>     zoom the field about the middle of the page
 *   pan=<dx>,<dy>      drag the field by this many page pixels
 *   open=<what>        click a card. <what> is a card type, or text on the card or in its title.
 *   press=<name>       click the button with this name in the opened card
 *   close              close the opened card
 *   wait=<ms>          wait
 *   apart              fail when two cards overlap
 *   fits               fail when part of a card reaches past its face or its text is squeezed
 *   shot=<name>        save <out>/<name>.png. `shot=<name>:full` saves the whole scrolling page.
 *
 * Example
 *   node --no-warnings --import tsx scripts/lane.ts --out /tmp/lane app shapes tree=Every zoom=50 shot=zoom-50 open=chart shot=chart-open
 *   node --no-warnings --import tsx scripts/lane.ts --out /tmp/lane app 'card=table:{"item":{"title":"Plans"},"props":{"heads":["Plan","Price"],"rows":[["Solo","$8"],["Team","$20"]]}}' fits open=table shot=table-open
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
import { PNG, TOKEN, bootFake, browserPath, chipped, crowd, faceFaults, showcase, stored } from '../test/stage.ts';
import { tones } from '../src/fake/model.ts';

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

type Given = { item?: Partial<Item>; props?: Record<string, unknown>; pick?: boolean };

/** Read `card=`'s JSON: the props alone, or the item, the props and whether the card is a pick. */
function given(json: string): Given {
  const parsed = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  const whole = ['item', 'props', 'pick'].some((key) => key in parsed) && Object.keys(parsed).every((key) => ['item', 'props', 'pick'].includes(key));
  return whole ? (parsed as Given) : { props: parsed };
}

/** The lane cards no group has taken yet, in the order they were added. */
const loose: string[] = [];
let groups = 0;

async function still(page: Page, run: Running): Promise<string> {
  const up = await page.request.post(`${run.url}/api/assets?name=still.png`, { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/png' }, data: Buffer.from(PNG) });
  return ((await up.json()) as { url: string }).url;
}

function loneCard(type: string, { item: fields = {}, props = {}, pick = false }: Given, run: Running): { id: string; commands: Command[] } {
  const at = new Date().toISOString();
  const n = run.mind.trees.has('lane') ? run.mind.treeNodes('lane').length : 0;
  const make = (id: string, component: string, title: string, parent: string | null, view: Record<string, unknown>, more: Partial<Item>, status: Node['status']): [Item, Node] => [
    { id: `item-${id}`, kind: 'text', title, text: '', summary: '', tags: [], data: {}, source: { from: 'paste', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0, ...more },
    { id, treeId: 'lane', itemId: `item-${id}`, parent, status, why: status === 'pick' ? 'Worth a look' : '', importance: 0.5, origin: { by: 'user' }, view: { component, props: view, by: 'renderer' }, order: n },
  ];
  const commands: Command[] = [];
  if (n === 0) {
    const [item, root] = make('lane-root', 'note', 'Lane', null, {}, {}, 'kept');
    commands.push({ type: 'addItem', item }, { type: 'createTree', tree: { id: 'lane', title: 'Lane', rootId: root.id, digest: '', createdAt: at }, root });
  }
  const [item, node] = make(`lane-${n}`, type, `A ${type} card`, 'lane-root', props, { ...fields, id: `item-lane-${n}` }, pick ? 'pick' : 'kept');
  commands.push({ type: 'addItem', item }, { type: 'addNode', node });
  return { id: node.id, commands };
}

/** Swaps a key `$n` for the id of the nth loose card, at any depth. */
function named(value: unknown): unknown {
  if (typeof value === 'string' && /^\$\d+$/.test(value)) return loose[Number(value.slice(1))] ?? value;
  if (Array.isArray(value)) return value.map(named);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [/^\$\d+$/.test(key) ? (loose[Number(key.slice(1))] ?? key) : key, named(inner)]));
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
  async shapes(value, page, run) {
    const other = [...run.mind.trees.values()][0]?.rootId;
    if (!run.pipeline.userCommands('Add every shape', showcase(await still(page, run), other, value === 'eleven' ? { structured: false } : { sound: await stored(page, run, tones(4), 'audio/wav', 'memo.wav') }))) throw new Error('the service refused the Every shape tree');
    await page.locator('.tree-chip', { hasText: 'Every shape' }).waitFor();
    await run.pipeline.idle();
  },
  async chips(_, page, run) {
    if (!run.pipeline.userCommands('Add cards with chips', chipped(await still(page, run)))) throw new Error('the service refused the With chips tree');
    await page.locator('.tree-chip', { hasText: 'With chips' }).waitFor();
    await run.pipeline.idle();
  },
  async crowd(value, page, run) {
    const [count, mode] = value.split(':');
    const total = Number(count) || 200;
    if (!run.pipeline.userCommands('Add a crowd', crowd(total, { chips: mode === 'chips' }))) throw new Error('the service refused the crowd');
    await page.waitForFunction((n) => document.querySelectorAll('.card[data-id^="crowd-"]').length === n, total);
    return `${total} cards drawn`;
  },
  async card(value, page, run) {
    const cut = value.indexOf(':');
    const type = cut < 0 ? value : value.slice(0, cut);
    const { id, commands } = loneCard(type, given(cut < 0 ? '' : value.slice(cut + 1)), run);
    if (!run.pipeline.userCommands(`Add a ${type} card`, commands)) throw new Error(`the service refused a ${type} card`);
    loose.push(id);
    await page.locator(`.card[data-id="${id}"]`).waitFor();
    const card = page.locator(`.card[data-id="${id}"]`);
    const chips = await card.locator('.chip').evaluateAll((els) => els.map((el) => [...el.children].map((part) => part.textContent).filter(Boolean).join(' ')));
    return `drawn as ${await card.getAttribute('data-component')}, ${await card.evaluate((el: HTMLElement) => `${el.style.width} by ${el.style.height}`)}${chips.length ? `, chips: ${chips.join(' | ')}` : ', no chips'}`;
  },
  async group(value, page, run) {
    const cut = value.indexOf(':');
    const composite = cut < 0 ? value : value.slice(0, cut);
    const { title = '', ...props } = named(cut < 0 ? {} : JSON.parse(value.slice(cut + 1))) as { title?: string } & Record<string, unknown>;
    const id = `lane-group-${groups++}`;
    const members = loose.splice(0);
    if (!run.pipeline.userCommands(`Group as a ${composite}`, [{ type: 'setGroup', group: { id, treeId: 'lane', anchor: 'lane-root', composite, title, members, props } } as Command])) {
      throw new Error(`the service refused a ${composite} of ${members.length} cards`);
    }
    await page.locator(`.pane[data-group="${id}"]`).waitFor();
    return `${members.length} cards drawn as ${await page.locator(`.pane[data-group="${id}"]`).getAttribute('data-composite')}`;
  },
  async tree(value, page) {
    await page.locator('.tree-chip', { hasText: value }).first().click();
    await settle(page);
    return `the field is at ${Math.round((await zoomOf(page)) * 100)} percent`;
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
  async pan(value, page) {
    const [dx, dy] = value.split(',').map(Number) as [number, number];
    // The top left corner of the field is clear of the bars, the dock and, at most zooms, the cards.
    const from = { x: 8, y: Math.round(height * 0.62) };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
    await page.mouse.up();
  },
  async open(value, page) {
    const byType = page.locator(`.card[data-id][data-component="${value}"]`);
    const wanted = /^[a-z-]+$/.test(value) && (await byType.count()) > 0 ? byType : cards(page).filter({ hasText: value }).or(page.locator(`.card[data-id][aria-label*=${JSON.stringify(value)}]`));
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
  async fits(_, page) {
    await settle(page);
    const found = await faceFaults(page);
    if (found.length > 0) throw new Error(`${found.length} parts do not fit, the first is ${found[0]}`);
    return `${await page.locator('.card').count()} cards, every part fits`;
  },
  async shot(value, page) {
    const [name, mode] = value.split(':');
    await settle(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const path = join(out, `${name}.png`);
    if (mode === 'full') {
      // Pictures load when they scroll into view, so walk the page once before the shot.
      await page.evaluate(`(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
          scrollTo(0, y);
          await new Promise((done) => setTimeout(done, 80));
        }
        scrollTo(0, 0);
      })()`);
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path, fullPage: mode === 'full' });
    return path;
  },
};

const run = await bootFake({ ...(flags.client ? { clientDir: resolve(flags.client) } : {}), asPlaced: (treeId) => treeId === 'lane' });
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
