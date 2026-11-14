/**
 * Drives the web client in a real browser against the service with stand-in agents.
 * Run: node --no-warnings --import tsx test/client.e2e.ts
 * Screenshots land in a new folder under the system's temporary folder, and the last line printed
 * names it. Set MIND_PALACE_SHOTS=docs/screenshots to replace the tracked ones on purpose.
 * Set MIND_PALACE_CHROMIUM to use another browser.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Locator, type Page } from 'playwright-core';
import type { Running } from '../src/node/server.ts';
import { PNG, bootFake, browserPath, crowd, showcase, spills } from './stage.ts';

const shots = process.env.MIND_PALACE_SHOTS ? resolve(process.env.MIND_PALACE_SHOTS) : mkdtempSync(join(tmpdir(), 'mp-shots-'));
mkdirSync(shots, { recursive: true });

let passed = 0;
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}`);
    throw err;
  }
}

async function until(what: string, probe: () => Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const count = (page: Page, selector: string) => page.locator(selector).count();
const dashed = (line: Locator) => line.evaluate((el) => getComputedStyle(el).strokeDasharray !== 'none');
/** Cards finish gliding about half a second after a change. */
const settle = (page: Page) => page.waitForTimeout(900);

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

/** Where every card of one tree sits on the field, by card id. */
function places(page: Page, ids: string[]): Promise<Record<string, string>> {
  return page.evaluate((wanted) => Object.fromEntries(wanted.map((id) => [id, (document.querySelector(`.card[data-id="${id}"]`) as HTMLElement).style.transform])), ids);
}

async function overlaps(page: Page): Promise<string[]> {
  await settle(page);
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('.card[data-id]:not(.is-under)')].map((el) => ({ title: el.getAttribute('aria-label'), r: el.getBoundingClientRect() }));
    const hits: string[] = [];
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i]!.r;
        const b = cards[j]!.r;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(`${cards[i]!.title} / ${cards[j]!.title}`);
      }
    }
    return hits;
  });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
  const problems: string[] = [];
  const watch = (page: Page) => {
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (err) => problems.push(String(err)));
  };
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await desktop.newPage();
    watch(page);

    await check('without an access key the page asks for one, and connects once it is pasted', async () => {
      await page.goto(run.url);
      await page.getByRole('textbox', { name: 'Access key' }).fill('secret');
      await page.getByRole('button', { name: 'Connect' }).click();
      await page.locator('#status[data-state="live"]').waitFor();
      assert.equal(await page.locator('#gate').isVisible(), false);
      assert.ok(await page.getByText('Nothing here yet').isVisible());
      await shot(page, 'desktop-1-empty');
    });

    let rootId = '';
    await check('a typed thought becomes a tree with one solid card and four dashed picks', async () => {
      await page.getByLabel('A thought for the mindstorm').fill('The dolly zoom makes dread out of geometry');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.locator('.card.is-kept').first().waitFor();
      await page.locator('.card.is-thinking .think').first().waitFor();
      await until('four picks', async () => (await count(page, '.card.is-pick')) === 4);
      assert.equal(await count(page, '.card.is-kept'), 1);
      assert.equal(await count(page, '.thread.is-pick'), 4);
      assert.equal(await count(page, '.thread.is-kept'), 0);
      for (const line of await page.locator('.thread.is-pick').all()) assert.ok(await dashed(line), 'a pick hangs from a dashed thread');
      assert.equal(await count(page, '.tree-chip'), 1);
      await until('the thinking mark to clear', async () => (await count(page, '.card.is-thinking')) === 0);
      rootId = (await page.locator('.card.is-root').getAttribute('data-id'))!;
    });

    await check('a chart, a fact and a steps card are drawn in their own shapes', async () => {
      await page.locator('.card[data-component="chart"] svg.chart rect.chart-bar').first().waitFor();
      assert.equal(await count(page, '.card[data-component="chart"] rect.chart-bar'), 4);
      assert.equal(await page.locator('.card[data-component="fact"] .fact-value').textContent(), '70%');
      assert.equal(await count(page, '.card[data-component="steps"] ol li'), 3);
      assert.equal(await count(page, '.card[data-component="link"]'), 1);
      assert.deepEqual(await overlaps(page), []);
      await shot(page, 'desktop-2-tree-with-picks');
    });

    const fact = page.locator('.card[data-component="fact"]');
    let factId = '';
    await check('opening a pick shows the whole item, and Keep turns its thread solid', async () => {
      await fact.click();
      factId = (await fact.getAttribute('data-id'))!;
      const panel = page.locator('#panel');
      await panel.getByRole('heading', { name: '7 in 10 notice it without naming it' }).waitFor();
      assert.ok(await panel.getByText('Pick from the librarian').isVisible());
      assert.ok(await panel.getByText('Evidence').isVisible(), 'the reason the agent gave');
      assert.ok(await panel.getByText('In a small survey, 7 in 10 viewers').isVisible());
      assert.ok(await panel.getByText('Found on the web').isVisible());
      assert.ok(await panel.getByRole('link', { name: /example\.com\/survey/ }).isVisible());
      await shot(page, 'desktop-3-card-open');
      await panel.getByRole('button', { name: 'Keep', exact: true }).click();
      const thread = page.locator(`.thread[data-id="${factId}"]`);
      await until('a solid thread', async () => !(await dashed(thread)));
      assert.equal(await count(page, '.card.is-pick'), 3);
      assert.ok(await panel.getByText('Kept', { exact: true }).isVisible());
    });

    await check('Undo names the last change and makes the thread dashed again', async () => {
      const undo = page.getByRole('button', { name: /Undo/ });
      assert.equal((await undo.textContent())!.trim(), 'Undo: Keep a pick');
      await undo.click();
      const thread = page.locator(`.thread[data-id="${factId}"]`);
      await until('a dashed thread', () => dashed(thread));
      assert.equal(await count(page, '.card.is-pick'), 4);
    });

    await check('editing a card changes what it shows', async () => {
      const panel = page.locator('#panel');
      await panel.getByRole('button', { name: 'Edit' }).click();
      await panel.getByLabel('Title').fill('Seven in ten notice it');
      await panel.getByRole('button', { name: 'Save' }).click();
      await panel.getByRole('heading', { name: 'Seven in ten notice it' }).waitFor();
      await until('the card to redraw', async () => (await fact.locator('.card-foot').textContent()) === 'Seven in ten notice it');
    });

    await check('a second thought dropped on the page makes a second tree, and the first tree does not move', async () => {
      const firstTree = await page.locator('.card[data-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.id!));
      const before = await places(page, firstTree);
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData('text/plain', 'Sourdough starters need feeding on a schedule');
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
      });
      await until('two trees', async () => (await count(page, '.tree-chip')) === 2);
      await until('eight picks', async () => (await count(page, '.card.is-pick')) === 8);
      assert.equal(await count(page, '.card.is-root'), 2);
      await settle(page);
      assert.deepEqual(await places(page, firstTree), before);
      assert.deepEqual(await overlaps(page), []);
      await shot(page, 'desktop-4-second-tree');
    });

    await check('the tree list glides between trees', async () => {
      await page.locator('.tree-chip', { hasText: 'The dolly zoom' }).click();
      await settle(page);
      const box = (await page.locator(`.card[data-id="${rootId}"]`).boundingBox())!;
      assert.ok(box.x > 200 && box.x < 1100 && box.y > 100 && box.y < 700, 'the first tree is back in the middle of the page');
    });

    await check('a typed request is heard, answered in a caption, and brings more picks', async () => {
      await page.locator(`.card[data-id="${rootId}"]`).click();
      await page.getByLabel('Talk to the librarian').fill('show me more');
      await page.getByRole('button', { name: 'Send' }).click();
      await page.locator('#caption').getByText('show me more').waitFor();
      await page.locator('#caption').getByText('Here is more.').waitFor();
      await until('twelve picks', async () => (await count(page, '.card.is-pick')) === 12);
      await settle(page);
      assert.deepEqual(await overlaps(page), []);
    });

    await check('Ask about a card replaces its picks, with a thinking mark while it works', async () => {
      const panel = page.locator('#panel');
      await panel.getByLabel('Ask about this card').fill('who invented it');
      await panel.getByRole('button', { name: 'Ask' }).click();
      await page.locator(`.card[data-id="${rootId}"].is-thinking`).waitFor();
      await page.locator('.card', { hasText: 'An essay on who invented it' }).waitFor();
      await until('the old picks to leave', async () => (await count(page, '.card.is-pick')) === 8);
    });

    await check('dragging a card onto another moves it under that card', async () => {
      await page.locator('#field').click({ position: { x: 40, y: 400 } });
      await settle(page);
      const steps = page.locator('.card[data-component="steps"]').last();
      const essay = page.locator('.card', { hasText: 'An essay on who invented it' });
      const stepsId = (await steps.getAttribute('data-id'))!;
      const from = (await steps.boundingBox())!;
      const to = (await essay.boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 30, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
      await page.locator('.card.is-drop-target').waitFor();
      await page.mouse.up();
      await until('the move to be the last change', async () => (await page.getByRole('button', { name: /Undo/ }).textContent())!.trim() === 'Undo: Move a card');
      const essayId = (await essay.getAttribute('data-id'))!;
      assert.equal(run.mind.node(stepsId).parent, essayId);
      await settle(page);
      assert.deepEqual(await overlaps(page), []);
    });

    await check('Delete removes a card after a second press', async () => {
      const essay = page.locator('.card', { hasText: 'An essay on who invented it' });
      await essay.click();
      const panel = page.locator('#panel');
      await panel.getByRole('button', { name: 'Delete' }).click();
      await panel.getByRole('button', { name: 'Really delete?' }).click();
      await until('the card to leave', async () => (await essay.count()) === 0);
      assert.equal(await panel.isVisible(), false);
    });

    await check('a chosen file and a typed address land as a picture card and a link card', async () => {
      await page.locator('#file-pick').setInputFiles({ name: 'still.png', mimeType: 'image/png', buffer: Buffer.from(PNG) });
      const picture = page.locator('.card[data-component="image"]', { hasText: 'still.png' });
      await picture.waitFor();
      await until('the picture to load', () => picture.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0));
      await page.getByLabel('A thought for the mindstorm').fill('https://example.org/lenses');
      await page.getByLabel('A thought for the mindstorm').press('Enter');
      await page.locator('.card[data-component="link"]', { hasText: 'example.org' }).first().waitFor();
      await run.pipeline.idle();
    });

    await check('the settings switch reaches the service and comes back', async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('radio', { name: 'Keep everything at once' }).click();
      await page.locator('[data-mode="immediate"][aria-checked="true"]').waitFor();
      await page.getByRole('button', { name: 'Fewer picks' }).click();
      await until('four picks each time', async () => (await page.locator('#picks-count').textContent()) === '4');
      await shot(page, 'desktop-5-settings');
      await page.getByRole('radio', { name: 'Dashed until kept' }).click();
      await page.locator('[data-mode="provisional"][aria-checked="true"]').waitFor();
      await page.keyboard.press('Escape');
    });

    await check('the work log lists what each role did', async () => {
      await page.locator('#log-open').click();
      const list = page.locator('#log-list');
      for (const role of ['intake', 'scout', 'renderer', 'conductor']) assert.ok((await list.locator('li b', { hasText: role }).count()) > 0, `${role} appears in the log`);
      await shot(page, 'desktop-6-work-log');
      await page.locator('#log-open').click();
    });

    await check('Handoff packages the tree and offers the zip with a preview', async () => {
      await page.getByRole('button', { name: 'Handoff' }).click();
      const sheet = page.locator('#handoff');
      await sheet.getByText('Everything').click();
      await sheet.getByLabel('A note to go with it (optional)').fill('Pick this up on Monday');
      await sheet.getByRole('button', { name: 'Package' }).click();
      const link = sheet.getByRole('link', { name: /Download handoff-.*\.zip/ });
      await link.waitFor();
      const reply = await desktop.request.get(new URL((await link.getAttribute('href'))!, run.url).href);
      assert.equal(reply.status(), 200);
      assert.deepEqual([...(await reply.body()).subarray(0, 2)], [0x50, 0x4b], 'the download is a zip');
      const preview = (await sheet.locator('#handoff-preview').textContent())!;
      assert.ok(preview.includes('Pick this up on Monday') && preview.includes('Sourdough'));
      await shot(page, 'desktop-7-handoff');
      await sheet.getByRole('button', { name: 'Close' }).click();
    });

    await check('every component and composite is drawn, unknown shapes fall back to a note, and a link is dashed', async () => {
      const up = await desktop.request.post(`${run.url}/api/assets?name=still.png`, { headers: { Authorization: 'Bearer secret', 'Content-Type': 'image/png' }, data: Buffer.from(PNG) });
      const image = ((await up.json()) as { url: string }).url;
      assert.ok(run.pipeline.userCommands('Add every shape', showcase(image, rootId)));
      await page.locator('.tree-chip', { hasText: 'Every shape' }).waitFor();
      for (const component of ['note', 'quote', 'fact', 'image', 'video', 'link', 'chart', 'person', 'chat', 'code', 'steps']) {
        assert.ok((await count(page, `.card[data-component="${component}"]`)) > 0, `${component} is drawn`);
      }
      assert.equal(await page.locator('.card', { hasText: 'A shape this client has never heard of' }).getAttribute('data-component'), 'note');
      for (const composite of ['gallery', 'timeline', 'comparison', 'sequence', 'cluster', 'stack']) {
        assert.equal(await count(page, `.pane[data-composite="${composite}"]`), 1, `${composite} is drawn`);
      }
      assert.ok(await page.locator('.pane[data-composite="timeline"]').getByText('1975').isVisible());
      assert.ok(await page.locator('.pane[data-composite="comparison"]').getByText('Slight breathing').isVisible());
      assert.ok(await dashed(page.locator('path.link')));
      assert.equal(await page.locator('.card[data-component="image"] img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), true, 'the uploaded picture loads');
      await page.locator('.tree-chip', { hasText: 'Every shape' }).click();
      assert.deepEqual(await overlaps(page), []);
      assert.deepEqual(await spills(page), [], 'no card holds more than its footprint');
      await shot(page, 'desktop-8-every-shape');
      await page.getByRole('button', { name: 'Open 5' }).click();
      await until('the pile to open', async () => (await count(page, '.card.is-under')) === 0);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await until('the pile to close', async () => (await count(page, '.card.is-under')) === 4);
    });

    await check('every card type in the registry can be sized, drawn and opened', async () => {
      const missing = await page.evaluate<string[]>(`import('/js/components/index.js').then(({ COMPONENTS }) =>
        Object.entries(COMPONENTS).flatMap(([name, kind]) => ['size', 'draw', 'detail'].filter((part) => typeof kind[part] !== 'function').map((part) => name + '.' + part)))`);
      assert.deepEqual(missing, []);
    });

    await check('the service can move the view to a card', async () => {
      const target = 'show-2';
      run.pipeline['deps'].emit({ t: 'navigate', nodeId: target });
      await page.locator(`.card[data-id="${target}"].is-selected`).waitFor();
      await settle(page);
      const box = (await page.locator(`.card[data-id="${target}"]`).boundingBox())!;
      assert.ok(box.x > 0 && box.x + box.width < 1440 - 384 && box.y > 60 && box.y + box.height < 900, 'the card is in view beside the panel');
      await shot(page, 'desktop-9-navigated');
      await page.keyboard.press('Escape');
    });

    await check('two hundred cards arrive, stay apart and the page keeps up', async () => {
      const started = Date.now();
      assert.ok(run.pipeline.userCommands('Add a crowd', crowd(200)));
      await until('the crowd', async () => (await count(page, '.card[data-id^="crowd-"]')) === 200);
      // A string, because tsx wraps named functions in a helper the page does not have.
      const frame = await page.evaluate<number>(`new Promise((done) => {
        const t0 = performance.now();
        let frames = 0;
        const tick = () => (++frames === 30 ? done((performance.now() - t0) / 30) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      })`);
      console.log(`     200 cards drawn in ${Date.now() - started} ms, then ${frame.toFixed(1)} ms a frame while they glide`);
      assert.ok(frame < 50, 'frames stay under 50 ms while 200 cards move');
      await page.locator('.tree-chip', { hasText: 'A crowd' }).click();
      await settle(page);
      assert.deepEqual(await overlaps(page), []);
      await shot(page, 'desktop-10-two-hundred');
    });

    await check('when the service goes away the page says so, and it comes back by itself', async () => {
      const port = Number(new URL(run.url).port);
      await run.close();
      await page.locator('#status[data-state="offline"]').waitFor();
      run = await boot(port);
      await page.locator('#status[data-state="live"]').waitFor({ timeout: 15000 });
      assert.ok((await count(page, '.card[data-id]')) > 200, 'the cards are still there');
      problems.splice(0, problems.length, ...problems.filter((line) => !/ERR_CONNECTION_REFUSED|WebSocket connection/.test(line)));
    });

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const small = await phone.newPage();
    watch(small);
    await check('at phone width the same mindstorm opens, and a tapped card fills a sheet', async () => {
      await small.goto(`${run.url}/#token=secret`);
      await small.locator('#status[data-state="live"]').waitFor();
      await small.locator('.tree-chip', { hasText: 'The dolly zoom' }).tap();
      await shot(small, 'phone-1-tree');
      await small.locator(`.card[data-id="${rootId}"]`).tap();
      await small.locator('#panel').getByRole('heading', { name: 'The dolly zoom makes dread out of geometry' }).waitFor();
      await shot(small, 'phone-2-card-open');
      const size = await small.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.equal(size[0], size[1], 'nothing spills past the side of the phone');
      await small.locator('#panel').getByRole('button', { name: 'Close' }).tap();
      await small.locator('.tree-chip', { hasText: 'Every shape' }).tap();
      await shot(small, 'phone-3-every-shape');
    });

    await check('every control is at least 44 px tall', async () => {
      for (const view of [page, small]) {
        const short = await view.evaluate(() => [...document.querySelectorAll<HTMLElement>('.bar button, .dock button, .dock label, .dock input[type="text"], .dock textarea, .log-ticker')]
          .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44)
          .map((el) => el.id || el.textContent));
        assert.deepEqual(short, []);
      }
    });

    await check('the library page draws every card type inside the footprint it states, at both widths', async () => {
      for (const view of [page, small]) {
        await view.goto(`${run.url}/library.html`);
        await view.locator('#composites .lib-entry').last().waitFor();
        const stated = await view.locator('#components .lib-size').allTextContents();
        for (const type of ['note', 'quote', 'fact', 'image', 'video', 'link', 'chart', 'person', 'chat', 'code', 'steps']) {
          assert.ok(stated.some((line) => new RegExp(`^${type} \\d+ by \\d+$`).test(line)), `${type} states its footprint`);
        }
        assert.deepEqual(await spills(view), []);
        const size = await view.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        assert.equal(size[0], size[1], 'the page does not scroll sideways');
      }
    });

    await check('nothing was written to the console as an error', async () => {
      assert.deepEqual(problems, []);
    });
  } finally {
    await browser.close();
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mp-e2e-'));
const boot = (port: number) => bootFake({ port, dataDir });
let run: Running = await boot(0);
try {
  await main();
  console.log(`\n${passed} checks passed. Screenshots are in ${shots}.`);
} finally {
  await run.close();
}
