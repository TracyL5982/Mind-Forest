/**
 * Drives the web client in a real browser against the service with stand-in agents.
 * Run: node --no-warnings --import tsx test/client.e2e.ts
 * Screenshots land in a new folder under the system's temporary folder, and the last line printed
 * names it. Set MIND_PALACE_SHOTS=docs/screenshots to replace the tracked ones on purpose.
 * Set MIND_PALACE_CHROMIUM to use another browser.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Locator, type Page } from 'playwright-core';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running } from '../src/node/server.ts';
import { COMPONENT_IDS, STRUCTURED_IDS } from '../src/core/samples.ts';
import { CHIPPED, LONG_PLACE, PLACED, PNG, STRUCTURED, bootFake, browserPath, chipped, crowd, showcase, spills, unknownShape } from './stage.ts';
import { ADA, BOT_TOKEN, FakeBot } from './fake-bot.ts';

const here = import.meta.dirname;
const shots = process.env.MIND_PALACE_SHOTS ? resolve(process.env.MIND_PALACE_SHOTS) : mkdtempSync(join(tmpdir(), 'mp-shots-'));
mkdirSync(shots, { recursive: true });

let passed = 0;
/** With E2E_KEEP_GOING=1 a failed check is reported and the rest still run, to see every check that fails on older code. */
const failed: string[] = [];
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}`);
    if (!process.env.E2E_KEEP_GOING) throw err;
    console.log(`     ${String(err instanceof Error ? err.message : err).split('\n')[0]}`);
    failed.push(name);
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

    await check('a plain thought goes into the knowledge base, is listed there, and starts no tree', async () => {
      await page.getByLabel('A thought for the mindstorm').fill('Remember the lens cap');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.locator('.kb-chip', { hasText: 'Knowledge base 1' }).waitFor();
      await page.locator('#toast', { hasText: 'is in your knowledge base' }).waitFor();
      assert.equal(await count(page, '.card'), 0);
      assert.equal(await count(page, '.tree-chip'), 0);
      assert.equal(await page.locator('#empty').isVisible(), false);
      await page.locator('.kb-chip').click();
      await page.locator('#kb-list li', { hasText: 'Remember the lens cap' }).waitFor();
      await page.mouse.click(700, 450);
      await until('the list to close', async () => !(await page.locator('#kb').isVisible()));
    });

    let rootId = '';
    await check('a thought that asks for a tree becomes one, with one solid card and four dashed picks', async () => {
      await page.getByLabel('A thought for the mindstorm').fill('Start a tree on this: The dolly zoom makes dread out of geometry');
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

    await check('a second thought dropped on the page makes a second tree, the first tree does not move, and the view goes to the new root once its round is told', async () => {
      const firstTree = await page.locator('.card[data-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.id!));
      const before = await places(page, firstTree);
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData('text/plain', 'Sourdough starters need feeding on a schedule. Start a tree on this.');
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
      });
      await until('two trees', async () => (await count(page, '.tree-chip')) === 2);
      await until('eight picks', async () => (await count(page, '.card.is-pick')) === 8);
      assert.equal(await count(page, '.card.is-root'), 2);
      await settle(page);
      assert.deepEqual(await places(page, firstTree), before);
      assert.deepEqual(await overlaps(page), []);
      await shot(page, 'desktop-4-second-tree');
      await page.locator('.card.is-root.is-selected', { hasText: 'Sourdough' }).waitFor();
      await page.locator('#caption').getByText(/new things under Sourdough/).waitFor();
      await page.keyboard.press('Escape');
    });

    await check("an opened card offers the librarian's questions about it, and picking one asks it", async () => {
      // The view went to this root when its round was told, which already asked for its questions, so they may come at once.
      await page.locator('.card.is-pick', { hasText: 'An essay on Sourdough' }).first().click();
      await page.locator('.card.is-root', { hasText: 'Sourdough' }).click();
      const offered = page.locator('#panel').getByRole('group', { name: 'Suggested questions' });
      await offered.getByRole('button', { name: /^Where does Sourdough/ }).waitFor();
      assert.ok((await offered.getByRole('button').allTextContents()).every((q) => q.includes('Sourdough')), 'none of the last card');
      const before = await offered.getByRole('button').allTextContents();
      assert.equal(before.length, 3);
      await shot(page, 'desktop-4b-questions');
      await offered.getByRole('button', { name: before[0] }).click();
      await page.locator('.card', { hasText: `An essay on ${before[0]}` }).waitFor();
      await until('the new picks to join the old', async () => (await count(page, '.card.is-pick')) === 12);
      assert.deepEqual(await offered.getByRole('button').allTextContents(), before.slice(1), 'the asked question leaves the list');
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
      await until('sixteen picks', async () => (await count(page, '.card.is-pick')) === 16);
      await settle(page);
      assert.deepEqual(await overlaps(page), []);
    });

    await check('Ask about a card adds to its picks, with a thinking mark while it works, and at ten the least related make room', async () => {
      const panel = page.locator('#panel');
      await panel.getByLabel('Ask about this card').fill('who invented it');
      await panel.getByRole('button', { name: 'Ask' }).click();
      await page.locator(`.card[data-id="${rootId}"].is-thinking`).waitFor();
      await page.locator('.card', { hasText: 'An essay on who invented it' }).waitFor();
      await until('the card to hold ten picks', async () => (await count(page, '.card.is-pick')) === 18);
      assert.equal(run.mind.picks(rootId).length, 10);
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

    await check('a chosen file goes into the knowledge base, "start a tree on this" makes it a picture card, and a typed address is kept as a link', async () => {
      await page.locator('#file-pick').setInputFiles({ name: 'still.png', mimeType: 'image/png', buffer: Buffer.from(PNG) });
      await page.locator('#toast', { hasText: '“still.png” is in your knowledge base' }).waitFor();
      await page.getByLabel('Talk to the librarian').fill('start a tree on this');
      await page.getByRole('button', { name: 'Send' }).click();
      const picture = page.locator('.card.is-root[data-component="image"]', { hasText: 'still.png' });
      await picture.waitFor();
      await until('the picture to load', () => picture.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0));
      await page.getByLabel('A thought for the mindstorm').fill('https://example.org/lenses');
      await page.getByLabel('A thought for the mindstorm').press('Enter');
      await page.locator('.kb-chip').click();
      await page.locator('#kb-list li', { hasText: 'example.org' }).waitFor();
      await page.locator('.kb-chip').click();
      await run.pipeline.idle();
    });

    await check("the settings switch and the agent's name reach the service and come back", async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('radio', { name: 'Keep everything at once' }).click();
      await page.locator('[data-mode="immediate"][aria-checked="true"]').waitFor();
      await page.getByRole('button', { name: 'Fewer picks' }).click();
      await until('four picks each time', async () => (await page.locator('#picks-count').textContent()) === '4');
      assert.equal(await page.getByLabel('What you call the librarian').inputValue(), 'momo');
      await page.getByLabel('What you call the librarian').fill('Juno');
      await page.getByRole('button', { name: 'Rename' }).click();
      await until('the microphone offering the new name', async () => (await page.getAttribute('#mic', 'title')) === 'Listen for "Hey Juno"');
      await shot(page, 'desktop-5-settings');
      await page.getByRole('radio', { name: 'Dashed until kept' }).click();
      await page.locator('[data-mode="provisional"][aria-checked="true"]').waitFor();
      await page.keyboard.press('Escape');
    });

    await check('the Telegram row says how to turn it on, pairs with a one-time link, shows who is paired, and unpairs', async () => {
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.locator('#telegram-state', { hasText: 'Add TELEGRAM_BOT_TOKEN' }).waitFor();
      await page.getByRole('button', { name: 'Settings' }).click();

      const bot = await new FakeBot().start();
      const contact = await bootFake({ telegram: { token: BOT_TOKEN, api: bot.url, pollSeconds: 0 } });
      const view = await desktop.newPage();
      watch(view);
      try {
        await view.goto(`${contact.url}/#token=secret`);
        await view.locator('#status[data-state="live"]').waitFor();
        await view.getByRole('button', { name: 'Settings' }).click();
        await view.locator('#telegram-state', { hasText: 'Not paired.' }).waitFor();
        await view.getByRole('button', { name: 'Pair' }).click();
        const link = (await view.getByRole('link', { name: 'Open in Telegram' }).getAttribute('href'))!;
        assert.match(link, /^https:\/\/t\.me\/mind_palace_test_bot\?start=[A-Za-z0-9_-]+$/);
        bot.push(ADA, { text: `/start ${new URL(link).searchParams.get('start')}` });
        await view.locator('#telegram-state', { hasText: 'Paired with Ada Lovelace.' }).waitFor({ timeout: 8000 });
        assert.equal(await view.getByRole('link', { name: 'Open in Telegram' }).isVisible(), false);
        await shot(view, 'desktop-11-telegram');
        await view.getByRole('button', { name: 'Unpair' }).click();
        await view.locator('#telegram-state', { hasText: 'Not paired.' }).waitFor();
      } finally {
        await view.close();
        await contact.close();
        await bot.close();
      }
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
      for (const component of COMPONENT_IDS) {
        assert.ok((await count(page, `.card[data-id^="show-"][data-component="${component}"]`)) > 0, `${component} is drawn`);
      }
      for (const id of STRUCTURED_IDS) assert.equal(await page.locator(`.card[data-id="${STRUCTURED[id]}"]`).getAttribute('data-component'), id);
      await run.pipeline.idle();
      assert.equal(run.mind.treeNodes('show').filter((node) => node.view.by !== 'renderer').length, 0);
      assert.equal(run.pipeline.undoLabel(), 'Add every shape', 'the stand-in Renderer, which draws by the real rules, found no card of the tree to redraw');
      assert.ok(run.pipeline.userCommands('Add an unknown shape', unknownShape()));
      const unknown = page.locator('.card', { hasText: 'A shape this client has never heard of' });
      await unknown.waitFor();
      await run.pipeline.idle();
      assert.equal(run.mind.treeNodes(PLACED)[0]!.view.component, 'hologram');
      assert.equal(await unknown.getAttribute('data-component'), 'note');
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
      await page.locator('.pane-open', { hasText: 'Close' }).click();
      await until('the pile to close', async () => (await count(page, '.card.is-under')) === 4);
    });

    await check('a card whose item holds a date, a place, people or an origin shows them as one line of chips', async () => {
      const up = await desktop.request.post(`${run.url}/api/assets?name=still.png`, { headers: { Authorization: 'Bearer secret', 'Content-Type': 'image/png' }, data: Buffer.from(PNG) });
      assert.ok(run.pipeline.userCommands('Add cards with chips', chipped(((await up.json()) as { url: string }).url)));
      await page.locator('.tree-chip', { hasText: 'With chips' }).click();
      await settle(page);
      const card = (id: string) => page.locator(`.card[data-id="${id}"]`);
      const chips = (id: string) => card(id).locator('.chip').allTextContents();
      const tall = (id: string) => card(id).evaluate((el: HTMLElement) => [parseFloat(el.style.width), parseFloat(el.style.height)]);

      assert.deepEqual(await chips(CHIPPED.photo), ['12 May 1958', 'Bodega Bay']);
      const [photo, plain] = [await tall(CHIPPED.photo), await tall(CHIPPED.plainPhoto)];
      assert.deepEqual(photo, [plain[0], plain[1]! + 28], 'the photo with chips is taller by the chip line and no wider');
      assert.equal(await card(CHIPPED.plainNote).locator('.chip-line').count(), 0, 'a card with nothing to say has no chip line');
      assert.deepEqual(await chips(CHIPPED.link), ['2019'], 'a link does not repeat its site, as its origin or as its author');
      assert.equal(await card(CHIPPED.museum).getAttribute('data-component'), 'artwork', 'a work a museum holds is drawn as an artwork');
      assert.deepEqual(await card(CHIPPED.museum).locator('.artwork-by, .artwork-holder').allTextContents(), ['Utagawa Hiroshige, 1857', 'The Metropolitan Museum of Art']);
      assert.deepEqual(await chips(CHIPPED.museum), [], 'and no chip repeats the date and the holder on its plate');
      assert.equal(await card(CHIPPED.paper).getAttribute('data-component'), 'reference', 'a paper is drawn as a reference');
      assert.deepEqual(await card(CHIPPED.paper).locator('.reference-year, .reference-authors, .reference-venue').allTextContents(), ['2019', 'T. Screech, M. Forrer, H. Smith', 'Journal of Japanese Studies']);
      assert.deepEqual(await chips(CHIPPED.paper), [], 'and no chip repeats its year, its authors or its journal');
      const four = await chips(CHIPPED.four);
      assert.deepEqual(four, ['Summer 1958', 'Bancroft Library'], 'the origin comes straight after the date, and what has no room is left to the opened card');
      assert.equal(await card(CHIPPED.four).locator('.chip[data-kind="origin"]').getAttribute('title'), 'Origin: Bancroft Library');

      const clipped = (el: HTMLElement) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis';
      const crew = card(CHIPPED.people).locator('.chip');
      assert.equal(await crew.locator('.chip-text').textContent(), 'Ada Lovelace, Grace Hopper');
      assert.equal(await crew.locator('.chip-count').textContent(), '+3');
      assert.ok(await crew.locator('.chip-text').evaluate(clipped), 'five people on a note: the names are clipped with an ellipsis');
      assert.ok(await crew.evaluate((el) => el.querySelector('.chip-count')!.getBoundingClientRect().right <= el.getBoundingClientRect().right), 'and the count is whole inside the chip');
      const long = card(CHIPPED.longPlace).locator('.chip-text');
      assert.equal(await long.textContent(), LONG_PLACE);
      assert.ok(await long.evaluate(clipped), 'a long place is clipped with an ellipsis');
      const dates = await page.locator('.card[data-id^="chips-"] .chip[data-kind="when"] .chip-text').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent));
      assert.deepEqual(dates, [], 'every date is whole');
      const loose = await page.locator('.card[data-id^="chips-"] .chip').evaluateAll((els) => els.flatMap((el) => {
        const chip = el as HTMLElement;
        const line = chip.parentElement!;
        const scale = line.getBoundingClientRect().width / line.offsetWidth;
        const wide = chip.getBoundingClientRect().width / scale;
        const text = chip.querySelector('.chip-text')!;
        const past = chip.getBoundingClientRect().right > line.getBoundingClientRect().right + 0.5;
        const short = text.scrollWidth > text.clientWidth && wide < parseFloat(chip.style.flexBasis) - 0.5;
        return past || short ? [`${chip.textContent} is ${wide.toFixed(1)} px for a box of ${chip.style.flexBasis}`] : [];
      }));
      assert.deepEqual(loose, [], 'no chip runs past its line, and a clipped chip has at least its box');
      const lines = await page.locator('.card[data-id^="chips-"] .chip-line').evaluateAll((els) => els.map((el) => (el as HTMLElement).offsetHeight));
      assert.ok(lines.length >= 7 && lines.every((height) => height === 20), `every chip line is one line tall, got ${lines}`);
      assert.deepEqual(await overlaps(page), []);
      assert.deepEqual(await spills(page), []);

      const box = (id: string) => card(id).evaluate((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
      const top = await box(CHIPPED.pileTop);
      for (const [i, id] of CHIPPED.pileUnder.entries()) {
        const under = await box(id);
        assert.ok(Math.abs(under[2]! - top[2]!) < 0.5 && Math.abs(under[3]! - top[3]!) < 0.5, 'a card under a plain top card is cut to the top card, though its own chips make it taller');
        assert.ok(under[0]! > top[0]! + i && under[1]! > top[1]! + i, 'and shows only below and to the right of it');
      }

      await card(CHIPPED.four).click();
      const facts = page.locator('#panel .facts');
      assert.deepEqual(await facts.locator('dd[data-chip]').allTextContents(), ['Summer 1958', 'Bancroft Library', 'Bodega Bay', 'Ada Lovelace, Grace Hopper, Edsger Dijkstra'], 'the opened card lists every source in full');
      assert.deepEqual((await facts.locator('dt').allTextContents()).slice(0, 4), ['When', 'Origin', 'Where', 'People']);
      assert.ok(!(await facts.locator('dt').allTextContents()).includes('From'), 'what the agents brought names its origin, and no second place it came from');
      await card(CHIPPED.plainNote).click();
      assert.equal(await facts.locator('dd[data-chip]').count(), 0);
      assert.deepEqual((await facts.locator('dt').allTextContents()).slice(0, 1), ['From'], 'what the user added says how it arrived');

      await card(CHIPPED.museum).click();
      assert.deepEqual(await facts.locator('dd[data-chip]').allTextContents(), ['1857', 'The Metropolitan Museum of Art'], 'the opened artwork still lists its date and its holder');

      const size = await tall(CHIPPED.four);
      await card(CHIPPED.four).click();
      await page.locator('#panel').getByRole('button', { name: 'Keep', exact: true }).click();
      await until('the card to be kept', async () => (await card(CHIPPED.four).getAttribute('aria-label'))!.startsWith('Card:'));
      await settle(page);
      assert.deepEqual(await chips(CHIPPED.four), four, 'a kept pick still says where it came from');
      assert.deepEqual(await tall(CHIPPED.four), size, 'and is the size it was as a pick');
      assert.deepEqual(await facts.locator('dd[data-chip="origin"]').allTextContents(), ['Bancroft Library']);
      await page.keyboard.press('Escape');
    });

    await check('each of the fourteen structured types is drawn from what the service makes of a pasted text or a request', async () => {
      const paste = (text: string) => page.evaluate((pasted) => {
        const data = new DataTransfer();
        data.setData('text/plain', pasted);
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, text);
      /** What to paste for each type, words its card then shows, and a part only that type draws, with how many of it. */
      const pasted: [string, string, string, string, number][] = [
        ['facts', 'Tokyo Tower\nHeight = 333 m\nBuilt = 1958\nFloors = 2', '333 m', '.figure', 3],
        ['table', 'Tier | Cost\nBasic | $5\nPlus | $12', 'Basic', '.table-cell.is-number:not(.is-head)', 2],
        ['list', 'Packing\n[x] passport\n[ ] charger', 'passport', '.list-box', 2],
        ['breakdown', 'Budget\nChart: Rent 50%, Food 30%, Other 20%', '50%', '.breakdown-bar', 3],
        ['qa', 'Q: Why is the sky blue?\nA: Air scatters short wavelengths the most.', 'Air scatters', '.qa-voice', 2],
        ['callout', 'Varnishing the table\nCaution: wet varnish scratches for a week.', 'wet varnish', '.callout.is-caution', 1],
        ['excerpt', 'The house remembers.\n> Every stair keeps the weight of who climbed it.\nAt: Chapter 3', 'Every stair keeps', '.excerpt-where', 1],
        ['definition', 'Term: Bokeh\nDefinition: the look of the parts of a picture that are out of focus', 'out of focus', '.definition-text', 1],
        ['idea', 'Build a treehouse', 'Build a treehouse', '.idea-spark', 1],
        ['proscons', 'Buying the van\nPros: room for the dog, cheap to insure\nCons: slow uphill', 'slow uphill', '.proscons-mark', 3],
        ['swatch', 'Palette: Rust #B7410E, Moss #8A9A5B', '#8A9A5B', '.swatch-block', 2],
        ['place', 'Lisbon\nWhere: Lisbon', 'Lisbon', '.place-pin', 1],
      ];
      await page.keyboard.press('Escape');
      for (const [type, text, shown, part, parts] of pasted) {
        await paste(`Start a tree on this:\n${text}`);
        const made = page.locator(`.card.is-kept[data-component="${type}"]`, { hasText: shown }).last();
        await made.waitFor();
        assert.equal(await made.locator(part).count(), parts, `${type} draws ${parts} of ${part}`);
        // Each paste starts a tree the view follows, but one can sit off the screen while the field settles, so each tree is visited until the card is on screen.
        for (const chip of [null, ...(await page.locator('.tree-chip').all())]) {
          if (chip) await chip.click();
          await settle(page);
          const box = await made.boundingBox();
          const view = page.viewportSize()!;
          if (box && box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height) break;
        }
        await made.click();
        const printed = (await page.locator('#panel .panel-summary, #panel .panel-text').allInnerTexts()).join('\n');
        assert.ok(!printed.includes(shown), `an opened ${type} does not print "${shown}" again under its own form`);
        const opened = await page.locator('#panel .panel-scroll').innerText();
        if (type === 'table' || type === 'callout') assert.equal(opened.split(shown).length, 2, `an opened ${type} says "${shown}" once`);
        if (type === 'table') assert.equal(await page.locator('#panel .panel-text').count(), 0, 'an opened table does not print the pasted rows again under its cells');
        if (type === 'table') {
          const drawn = await page.locator('#panel .detail-table').elementHandle();
          const known = Number((await page.locator('.kb-chip').textContent())!.replace(/\D+/g, ''));
          await paste('Remember to water the fig tree on Sunday morning');
          await page.locator('.kb-chip', { hasText: `Knowledge base ${known + 1}` }).waitFor();
          await run.pipeline.idle();
          assert.ok(await drawn!.evaluate((el) => el.isConnected), 'an opened table is not drawn again when something else arrives, so it keeps its scroll place');
        }
        await page.keyboard.press('Escape');
      }
      await run.pipeline.idle();
      const asked: [string, string, string, string][] = [
        ['artwork', 'find a museum painting of stairs', 'Stairwell, seen from above', '.artwork-mat img'],
        ['reference', 'find a paper on the dolly zoom', 'Perceived depth under opposed zoom and camera motion', '.reference-head'],
      ];
      for (const [type, need, title, part] of asked) {
        await page.locator('.card.is-kept[data-component="place"]', { hasText: 'Lisbon' }).last().click();
        await page.getByLabel('Ask about this card').fill(need);
        await page.getByRole('button', { name: 'Ask', exact: true }).click();
        const brought = page.locator(`.card.is-pick[data-component="${type}"]`, { hasText: title });
        await brought.waitFor();
        assert.equal(await brought.locator(part).count(), 1, `${type} draws ${part}`);
        assert.deepEqual(await brought.locator('.chip').allTextContents(), [], `no chip repeats what the ${type} shows`);
        await run.pipeline.idle();
      }
      await until('the museum picture to load', () => page.locator('.card[data-component="artwork"] .artwork-mat img').last().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0));
      await page.keyboard.press('Escape');
      await settle(page);
      assert.deepEqual(await spills(page), []);
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

    await check('opening a card shows it and brings no picks', async () => {
      const target = 'show-2';
      assert.equal(run.mind.children(target).length, 0);
      await page.locator(`.card[data-id="${target}"]`).click();
      await page.locator('#panel').getByRole('button', { name: 'More' }).waitFor();
      await new Promise((r) => setTimeout(r, 1500));
      await run.pipeline.idle();
      assert.equal(run.mind.children(target).length, 0);
      assert.equal(await page.locator(`.card[data-id="${target}"].is-thinking`).count(), 0);
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
        for (const type of COMPONENT_IDS) {
          assert.ok(stated.some((line) => new RegExp(`^${type} \\d+ by \\d+$`).test(line)), `${type} states its footprint`);
        }
        for (const type of COMPONENT_IDS) {
          const cards = view.locator(`#components .card[data-component="${type}"]`);
          assert.ok((await cards.filter({ has: view.locator('.chip-line') }).count()) > 0, `${type} is shown with chips`);
          assert.ok((await cards.filter({ hasNot: view.locator('.chip-line') }).count()) > 0, `${type} is shown without chips`);
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

/**
 * A spoken clip for the fake microphone, made with a macOS voice: quiet, the words, then quiet for the page to notice the pause.
 * The quiet is a faint hiss, 60 dB below full scale, as a real room is never silent.
 */
function spoken(text: string, dir: string, quietFirst = 1, wordsPerMinute?: number): string {
  const aiff = join(dir, 'clip.aiff');
  const wav = join(dir, `${text.replace(/\W+/g, '-').slice(0, 30)}-${quietFirst}-${wordsPerMinute ?? 'usual'}.wav`);
  execFileSync('say', ['-v', 'Samantha', ...(wordsPerMinute ? ['-r', String(wordsPerMinute)] : []), '-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, join(dir, 'speech.wav')]);
  const speech = readFileSync(join(dir, 'speech.wav'));
  const pcm = speech.subarray(speech.indexOf('data') + 8);
  let seed = 1;
  const quiet = (seconds: number) => {
    const hiss = Buffer.alloc(16000 * 2 * seconds);
    for (let at = 0; at < hiss.length; at += 2) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      hiss.writeInt16LE(Math.round((seed / 2 ** 31 - 0.5) * 114), at);
    }
    return hiss;
  };
  const body = Buffer.concat([quiet(quietFirst), pcm, quiet(4)]);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + body.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24);
  head.writeUInt32LE(32000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(body.length, 40);
  writeFileSync(wav, Buffer.concat([head, body]));
  rmSync(aiff);
  return wav;
}

/** The real model's scores for the pieces "hey", "hi", "high" and "Momo" are made of, and the letters they could fall back on. */
const STAND_IN_PIECES: [string, number][] = [
  ['▁HE', -5.315], ['Y', -4.518], ['▁HI', -7.776], ['▁HIGH', -7.966], ['▁MO', -6.187], ['MO', -7.022], ['OM', -6.61],
  ['▁', -4.624], ['H', -6.175], ['E', -4.197], ['I', -5.195], ['G', -5.024], ['M', -4.591], ['O', -4.663],
];

/**
 * A stand-in for sherpa-onnx's spotter, in a copy of the client, for when the listener files are not here.
 * It cannot tell words apart: it "hears the phrase" at the first sound that lasts 0.6 seconds, and places the phrase where that sound began.
 * It keeps the keywords the page gave it, so the check can read them.
 */
function clientWithout(dir: string, name: string): string {
  const client = join(dir, name);
  cpSync(join(here, '../client'), client, { recursive: true, filter: (from) => !from.includes('/vendor') });
  return client;
}

function standInClient(dir: string): string {
  const client = clientWithout(dir, 'stand-in');
  const vendor = join(client, 'vendor/sherpa-onnx');
  mkdirSync(vendor, { recursive: true });
  const varint = (n: number) => {
    const out: number[] = [];
    for (; n > 127; n >>>= 7) out.push((n & 127) | 128);
    return Buffer.from([...out, n]);
  };
  const field = (key: number, body: Buffer) => Buffer.concat([Buffer.from([key]), varint(body.length), body]);
  writeFileSync(join(vendor, 'bpe.model'), Buffer.concat(STAND_IN_PIECES.map(([text, score]) => {
    const value = Buffer.alloc(4);
    value.writeFloatLE(score);
    return field(0x0a, Buffer.concat([field(0x0a, Buffer.from(text)), Buffer.from([0x15]), value]));
  })));
  writeFileSync(join(vendor, 'versions.json'), JSON.stringify({ standIn: true }));
  writeFileSync(join(vendor, 'sherpa-onnx-wasm-kws-main.js'), 'self.Module.onRuntimeInitialized();\n');
  writeFileSync(join(vendor, 'sherpa-onnx-kws.js'), `function createKws(Module, config) {
  self.standInKeywords = config.keywords;
  return {
    createStream: () => ({
      seconds: 0, loudSince: null, heard: null, ready: false,
      acceptWaveform(rate, piece) {
        const level = Math.sqrt(piece.reduce((sum, s) => sum + s * s, 0) / piece.length);
        if (level < 0.02) this.loudSince = null;
        else if (this.loudSince === null) this.loudSince = this.seconds;
        this.seconds += piece.length / rate;
        if (this.loudSince !== null && this.seconds - this.loudSince >= 0.6 && !this.fired) this.heard = this.loudSince;
        this.ready = true;
      },
      free() {},
    }),
    isReady: (s) => s.ready,
    decode: (s) => { s.ready = false; },
    getResult: (s) => (s.heard === null || s.fired ? { keyword: '' } : (s.fired = true, { keyword: 'HEY_MOMO', start_time: 0, timestamps: [s.heard] })),
    reset() {},
    free() {},
  };
}
`);
  return client;
}

/** What the service was sent, judged by its loudness in tenths of a second. */
interface Upload {
  mime: string;
  seconds: number;
  /** Seconds of quiet before the first sound. */
  quietFirst: number;
  /** Stretches of sound with at least 0.2 seconds of quiet between them. */
  sounds: number;
  loudest: number;
}

function upload(audio: Uint8Array, mime: string): Upload {
  const samples = new Int16Array(audio.slice(44).buffer);
  const level = (from: number, to: number) => Math.sqrt(samples.slice(from, to).reduce((sum, s) => sum + (s / 32768) ** 2, 0) / Math.max(1, to - from));
  const loud = Array.from({ length: Math.floor(samples.length / 1600) }, (_, i) => level(i * 1600, (i + 1) * 1600) >= 0.01);
  const sounds = loud.filter((on, i) => on && !loud[i - 1] && !loud[i - 2]).length;
  return { mime, seconds: samples.length / 16000, quietFirst: loud.indexOf(true) / 10, sounds, loudest: Math.max(...loud.map((_, i) => level(i * 1600, (i + 1) * 1600))) };
}

/** A service whose transcriber hears "Hey Momo, show me more like this." in anything, and keeps what it was sent and what the Conductor acted on. */
async function listeningService(dir: string, clientDir: string) {
  const acted: string[] = [];
  const posted: Upload[] = [];
  const server = await startServer({
    port: 0, host: '127.0.0.1', dataDir: mkdtempSync(join(dir, 'data-')), clientDir, model: new FakeModel(), token: 'secret',
    roles: { ...fakeRoles, conductor: async (ctx, input) => (acted.push(input.utterance), fakeRoles.conductor(ctx, input)) },
    transcribe: async (audio, mime) => {
      posted.push(upload(audio, mime));
      return 'Hey Momo, show me more like this.';
    },
  });
  await server.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
  await server.pipeline.idle();
  return { server, acted, posted };
}

/**
 * A page of `server` in a browser whose microphone plays `clip`. `micStates()` lists the mic's states since it was first pressed.
 * With `holdMicMs`, the page's microphone requests are counted (`asked`), held that long like a permission prompt, and their streams kept (`opened`).
 */
async function openWithMicrophone(server: Running, clip: string, holdMicMs?: number) {
  const browser = await chromium.launch({
    executablePath: browserPath(), headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${clip}%noloop`, '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (err) => problems.push(String(err)));
  if (holdMicMs !== undefined) await page.addInitScript(watchMicrophone, holdMicMs);
  await page.goto(`${server.url}/#token=secret`);
  await page.locator('#status[data-state="live"]').waitFor();
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { micStates: string[] }).micStates = seen;
    new MutationObserver(() => seen.push(document.querySelector('#mic')!.getAttribute('data-state')!)).observe(document.querySelector('#mic')!, { attributes: true, attributeFilter: ['data-state'] });
  });
  const micStates = async () => {
    const seen = await page.evaluate(() => (window as unknown as { micStates: string[] }).micStates);
    return seen.slice(seen.indexOf('starting')).filter((state, i, all) => state !== all[i - 1]);
  };
  const mic = () => page.getAttribute('#mic', 'data-state');
  return { browser, page, problems, micStates, mic };
}

/** Runs in the page before its scripts: see `holdMicMs` in openWithMicrophone. */
function watchMicrophone(holdMs: number): void {
  const w = window as unknown as { asked: number; opened: MediaStream[] };
  w.asked = 0;
  w.opened = [];
  const ask = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    w.asked += 1;
    await new Promise((later) => setTimeout(later, holdMs));
    const stream = await ask(constraints);
    w.opened.push(stream);
    return stream;
  };
}

/**
 * The page listening for its name, with a clip played into a fake microphone. Needs macOS's `say`.
 * With the listener files (npm run fetch-wake), the real spotter hears the clips. Without them a stand-in does, which tests the page's half only,
 * and the checks that need the real spotter to tell words apart are skipped and say so.
 */
async function wakeChecks(): Promise<void> {
  const real = existsSync(join(here, '../client/vendor/sherpa-onnx/versions.json'));
  const needsReal = (name: string) => console.log(`skip ${name}: it needs the real spotter (npm run fetch-wake)`);
  const dir = mkdtempSync(join(tmpdir(), 'mp-wake-'));
  const main = await listeningService(dir, real ? join(here, '../client') : standInClient(dir));
  const { server, acted, posted } = main;
  try {
    const woke = real
      ? 'the page wakes on "hey Momo", records what follows, and the service acts on it without the name'
      : 'with a stand-in spotter, the page records from just before the phrase to the pause, the service acts without the name, and the page does not listen while the reply plays';
    await check(woke, async () => {
      // Three seconds of quiet first: the spotter clears itself after 1.5 seconds of it, which must neither lose the phrase nor move where the recording starts.
      const { browser, page, problems, micStates, mic } = await openWithMicrophone(server, spoken('Hey Momo, show me more like this.', dir, 3));
      try {
        await page.locator('.card').first().click();
        await page.locator('#mic').click();
        await until('the page waiting for its name', async () => (await mic()) === 'waiting', 15000);
        assert.equal(await page.getAttribute('#talk-text', 'placeholder'), 'Say "Hey Momo", or type');
        if (!real) assert.equal(await page.workers()[0]!.evaluate(() => (self as unknown as { standInKeywords: string }).standInKeywords), '▁HE Y ▁MO MO @HEY_MOMO\n▁HI ▁MO MO @HI_MOMO\n▁HIGH ▁MO MO @HI_MOMO');
        await until('the page hearing the speaker', async () => (await micStates()).includes('hearing'), 15000);
        await until('the recording posted', async () => posted.length === 1, 15000);
        await page.locator('#caption').getByText('Show me more like this.').waitFor();
        // The reply, then the line on what the run brought, which may cut the reply short with the stand-in agents' instant runs.
        await until('the reply heard and the page waiting again', async () => /^starting,waiting,hearing,working,waiting,speaking(,waiting,speaking)?,waiting$/.test((await micStates()).join()), 25000);
        assert.deepEqual(acted, ['Show me more like this.']);
        assert.equal(posted[0]!.mime, 'audio/wav');
        assert.ok(posted[0]!.seconds > 2.4 && posted[0]!.seconds < 4.6, `the recording holds the phrase, the command and the pause: ${posted[0]!.seconds} s`);
        assert.ok(posted[0]!.quietFirst > 0 && posted[0]!.quietFirst <= 0.6 && posted[0]!.loudest > 0.05, `the recording starts a moment before the phrase: ${JSON.stringify(posted[0])}`);
        assert.deepEqual(problems, []);
      } finally {
        await browser.close();
      }
    });

    const quietThenTalk = 'after quiet and other talk, nothing said before "hey Momo" is sent';
    if (!real) needsReal(quietThenTalk);
    else await check(quietThenTalk, async () => {
      const before = posted.length;
      const { browser, page, problems, mic } = await openWithMicrophone(server, spoken('I was reading about winter bread all morning. Hey Momo, show me more like this.', dir, 4));
      try {
        await page.locator('.card').first().click();
        await page.locator('#mic').click();
        await until('the recording posted', async () => posted.length === before + 1, 20000);
        const sent = posted.at(-1)!;
        assert.ok(sent.quietFirst > 0 && sent.sounds <= 2, `the recording holds "Hey Momo" and what follows, not the talk before: ${JSON.stringify(sent)}`);
        assert.equal(acted.at(-1), 'Show me more like this.');
        await until('the page waiting again, the reply and the run\'s line read', async () => (await mic()) === 'waiting', 25000);
        assert.deepEqual(problems, []);
      } finally {
        await browser.close();
      }
    });

    const quick = 'a quick "hey Momo, more" is sent as soon as the speaker stops';
    if (!real) needsReal(quick);
    else await check(quick, async () => {
      const before = posted.length;
      const { browser, page, problems, micStates } = await openWithMicrophone(server, spoken('Hey Momo, more.', dir, 1, 210));
      try {
        await page.locator('.card').first().click();
        await page.locator('#mic').click();
        await until('the page hearing the speaker', async () => (await micStates()).includes('hearing'), 15000);
        await until('the recording posted within 4 seconds of the name', async () => posted.length === before + 1, 4000);
        assert.deepEqual(problems, []);
      } finally {
        await browser.close();
      }
    });

    const without = 'without "hey Momo" nothing is recorded or sent';
    if (!real) needsReal(without);
    else await check(without, async () => {
      const before = posted.length;
      const actedBefore = acted.length;
      const { browser, page, problems, micStates, mic } = await openWithMicrophone(server, spoken('Show me more like this, and keep the first two.', dir));
      try {
        await page.locator('#mic').click();
        await until('the page waiting for its name', async () => (await mic()) === 'waiting', 15000);
        await page.waitForTimeout(8000);
        assert.equal(posted.length, before);
        assert.equal(acted.length, actedBefore);
        assert.deepEqual(await micStates(), ['starting', 'waiting']);
        await page.locator('#mic').click();
        assert.equal(await mic(), 'off');
        assert.deepEqual(problems, []);
      } finally {
        await browser.close();
      }
    });

    await check('turning listening off while the browser asks for the microphone closes the microphone', async () => {
      const { browser, page, problems, mic } = await openWithMicrophone(server, spoken('Show me more like this.', dir), 1500);
      try {
        await page.locator('#mic').click();
        await until('the microphone asked for', () => page.evaluate(() => (window as unknown as { asked: number }).asked === 1), 15000);
        await page.locator('#mic').click();
        await page.waitForTimeout(2500);
        assert.equal(await mic(), 'off');
        const live = await page.evaluate(() => (window as unknown as { opened: MediaStream[] }).opened.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);
        assert.equal(live, 0);
        assert.deepEqual(problems, []);
      } finally {
        await browser.close();
      }
    });

    await check('turning listening off and on just after a reply ends does not leave the page deaf', async () => {
      const { browser, page, problems, mic } = await openWithMicrophone(server, spoken('Show me more like this.', dir));
      try {
        await page.locator('#mic').click();
        await until('the page waiting for its name', async () => (await mic()) === 'waiting', 15000);
        await page.getByLabel('Talk to the librarian').fill('note to self, buy flour');
        await page.getByRole('button', { name: 'Send' }).click();
        await until('the reply playing', async () => (await mic()) === 'speaking', 10000);
        await page.locator('#mute').click();
        await page.locator('#mic').click();
        await page.locator('#mic').click();
        await until('the page started again', async () => (await mic()) !== 'starting', 15000);
        await page.waitForTimeout(1000);
        assert.equal(await mic(), 'waiting');
        assert.deepEqual(problems, []);
      } finally {
        await browser.close();
      }
    });

    await check('a hold that arrives while the listener records does not lose the recording', async () => {
      const standIn = await listeningService(dir, standInClient(mkdtempSync(join(dir, 'worker-'))));
      const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`${standIn.server.url}/#token=secret`);
        // A string, because the TypeScript runner names inner functions with a helper the page does not have.
        const outcome = (await page.evaluate(`(async () => {
          const worker = new Worker('js/wake-worker.js');
          const audio = new MessageChannel();
          const said = [];
          worker.addEventListener('message', (e) => said.push(e.data.t));
          const next = (kind) => new Promise((done) => {
            const heard = (e) => { if (e.data.t === kind) { worker.removeEventListener('message', heard); done(); } };
            worker.addEventListener('message', heard);
          });
          const piece = (loud) => Float32Array.from({ length: 1600 }, (_, i) => (loud ? loud * Math.sin(i / 3) : (Math.random() - 0.5) * 0.002));
          const feed = (count, loud) => { for (let i = 0; i < count; i++) audio.port1.postMessage(piece(loud)); };
          const ready = next('ready');
          worker.postMessage({ t: 'start', name: 'Momo', tuning: { threshold: 0.05, boost: 1.5, highForHi: true }, audio: audio.port2 }, [audio.port2]);
          await ready;
          worker.postMessage({ t: 'listen' });
          const woke = next('wake');
          feed(10, 0);
          feed(12, 0.2);
          await woke;
          worker.postMessage({ t: 'hold' });
          const recorded = next('recorded');
          feed(5, 0.2);
          feed(20, 0);
          return Promise.race([recorded.then(() => said), new Promise((done) => setTimeout(() => done(said), 3000))]);
        })()`)) as string[];
        assert.ok(outcome.includes('recorded'), `the listener said ${outcome.join(', ')}`);
      } finally {
        await browser.close();
        await standIn.server.close();
      }
    });

    await check('on a page that cannot listen for its name, the first press says why and records nothing, and the next press records once', async () => {
      const plain = await listeningService(dir, clientWithout(dir, 'plain'));
      const { browser, page, problems, mic } = await openWithMicrophone(plain.server, spoken('Show me more like this.', dir), 0);
      try {
        await page.locator('#mic').click();
        await page.locator('#toast').getByText('Tap the microphone again to talk once.').waitFor();
        assert.equal(await mic(), 'idle');
        assert.match((await page.getAttribute('#mic', 'title'))!, /Hands-free listening is off because the listener files are not on this service/);
        await page.waitForTimeout(1000);
        assert.equal(await page.evaluate(() => (window as unknown as { asked: number }).asked), 0);
        assert.equal(plain.posted.length, 0);
        await page.locator('#mic').click();
        await until('one recording sent', async () => plain.posted.length === 1, 15000);
        assert.equal(await page.evaluate(() => (window as unknown as { asked: number }).asked), 1);
        assert.deepEqual(problems.filter((p) => !p.includes('404')), []);
      } finally {
        await browser.close();
        await plain.server.close();
      }
    });
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mp-e2e-'));
const boot = (port: number) => bootFake({ port, dataDir, asPlaced: (treeId) => treeId === PLACED });
let run: Running = await boot(0);
try {
  // E2E_WAKE_ONLY=1 runs only the listening checks.
  if (!process.env.E2E_WAKE_ONLY) await main();
  await wakeChecks();
  console.log(`\n${passed} checks passed. Screenshots are in ${shots}.`);
  if (failed.length > 0) {
    console.log(`${failed.length} failed:\n${failed.map((name) => `  ${name}`).join('\n')}`);
    process.exitCode = 1;
  }
} finally {
  await run.close();
}
