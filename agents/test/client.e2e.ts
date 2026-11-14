/**
 * Drives the web client in a real browser against the service with stand-in agents.
 * Run: node --no-warnings --import tsx test/client.e2e.ts
 * Screenshots land in docs/screenshots. Set MIND_PALACE_CHROMIUM to use another browser.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Locator, type Page } from 'playwright-core';
import type { Command, Item, Node } from '../src/core/domain.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { startServer, type Running } from '../src/node/server.ts';

const here = import.meta.dirname;
const shots = join(here, '../docs/screenshots');
mkdirSync(shots, { recursive: true });

function browserPath(): string {
  if (process.env.MIND_PALACE_CHROMIUM) return process.env.MIND_PALACE_CHROMIUM;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).sort().reverse() : [];
  for (const build of builds) {
    for (const inner of [
      'chrome-headless-shell-mac-arm64/chrome-headless-shell',
      'chrome-headless-shell-mac-x64/chrome-headless-shell',
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ]) {
      if (existsSync(join(cache, build, inner))) return join(cache, build, inner);
    }
  }
  throw new Error('No Chromium found. Set MIND_PALACE_CHROMIUM to a browser executable.');
}

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

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAHUlEQVQI12NkYPjPgA0wYRWlqgTj////cRhFJzsAGGgEB+4vOSMAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

/** One tree that holds every component and every composite, and a link to another tree. */
function showcase(image: string, other: string): Command[] {
  const at = new Date().toISOString();
  const commands: Command[] = [];
  let n = 0;
  const add = (parent: string | null, component: string, props: Record<string, unknown>, title: string, extra: Partial<Item> = {}, status: Node['status'] = 'kept'): string => {
    const id = `show-${n++}`;
    const item: Item = { id: `item-${id}`, kind: 'text', title, text: '', summary: '', tags: [], data: {}, source: { from: 'paste', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0, ...extra };
    const node: Node = { id, treeId: 'show', itemId: item.id, parent, status, why: status === 'pick' ? 'Worth a look' : '', importance: 0.5, origin: { by: 'user' }, view: { component, props, by: 'renderer' }, order: n };
    commands.push({ type: 'addItem', item });
    if (parent === null) commands.push({ type: 'createTree', tree: { id: 'show', title: 'Every shape', rootId: id, digest: '', createdAt: at }, root: node });
    else commands.push({ type: 'addNode', node });
    return id;
  };
  const group = (anchor: string, composite: string, title: string, members: string[], props: Record<string, unknown>) =>
    commands.push({ type: 'setGroup', group: { id: `group-${composite}`, treeId: 'show', anchor, composite, title, members, props } });

  const root = add(null, 'note', { emphasis: 'one of each' }, 'Every way a card can be drawn', { summary: 'Eleven components and six ways to arrange them.' });
  const quote = add(root, 'quote', { text: 'The camera is a tool for learning how to see without a camera.', by: 'Dorothea Lange' }, 'Lange on seeing');
  add(root, 'fact', { value: '42%', label: 'of viewers leave in the first minute' }, 'Drop-off in minute one');
  add(root, 'image', { src: image, caption: 'A still from the beach scene' }, 'Beach still');
  add(root, 'video', { src: image, poster: image, caption: 'The dolly zoom, slowed down' }, 'Dolly zoom clip');
  add(root, 'link', { url: 'https://example.com/vertigo', site: 'example.com', description: 'How one shot changed the grammar of suspense.' }, 'The Vertigo effect, explained');
  add(root, 'chart', { chart: 'line', labels: ['1960', '1980', '2000', '2020'], values: [3, 9, 14, 11], unit: 'films', mark: 2 }, 'Use by decade');
  add(root, 'person', { name: 'Irmin Roberts', role: 'Second-unit cameraman' }, 'Who built it');
  add(root, 'chat', { messages: [{ role: 'user', text: 'Why does the room seem to stretch?' }, { role: 'assistant', text: 'The lens zooms in while the camera pulls back, so the subject holds still and the background rushes away.' }], source: 'claude' }, 'Asking about the stretch');
  add(root, 'code', { language: 'js', source: 'const fov = 2 * Math.atan(width / (2 * distance));\ncamera.zoom = base / Math.tan(fov / 2);\nrender();' }, 'Field of view');
  add(root, 'steps', { steps: ['Pick a subject', 'Move away while zooming in', 'Keep the subject the same size'] }, 'How to try it');
  add(root, 'hologram', { depth: 3 }, 'A shape this client has never heard of', { summary: 'Unknown shapes fall back to a note.' });

  const gallery = [1, 2, 3].map((i) => add(quote, 'image', { src: image }, `Frame ${i}`));
  group(quote, 'gallery', 'Frames', gallery, {});
  const timeline = ['1958', '1975', '1990'].map((year) => add(gallery[0]!, 'note', {}, `Used in ${year}`, { summary: 'A famous use of the shot.' }));
  group(gallery[0]!, 'timeline', 'Through the years', timeline, { labels: Object.fromEntries(timeline.map((id, i) => [id, ['1958', '1975', '1990'][i]])) });
  const compared = ['Zoom lens', 'Prime and a dolly'].map((name) => add(timeline[2]!, 'note', {}, name, { summary: 'One way to get the shot.' }, 'pick'));
  group(timeline[2]!, 'comparison', 'Two ways to shoot it', compared, { criteria: ['Cost', 'Look'], cells: { [compared[0]!]: ['Low', 'Slight breathing'], [compared[1]!]: ['High', 'Clean'] } });
  const sequence = ['Frame the subject', 'Start the pull', 'Land the zoom'].map((name) => add(compared[1]!, 'note', {}, name));
  group(compared[1]!, 'sequence', 'The move', sequence, {});
  const cluster = ['Unease', 'Vertigo', 'Dread'].map((name) => add(sequence[2]!, 'fact', { value: name, label: 'what it evokes' }, name));
  group(sequence[2]!, 'cluster', '', cluster, { theme: 'Feelings' });
  const pile = Array.from({ length: 5 }, (_, i) => add(cluster[2]!, 'note', {}, `Another example ${i + 1}`, { summary: 'One more film that uses it.' }));
  group(cluster[2]!, 'stack', '5 more', pile, {});
  commands.push({ type: 'link', link: { id: 'show-link', a: quote, b: other, why: 'Same shot', strength: 0.9 } });
  return commands;
}

function crowd(total: number): Command[] {
  const at = new Date().toISOString();
  const commands: Command[] = [];
  for (let i = 0; i < total; i++) {
    const item: Item = { id: `crowd-item-${i}`, kind: 'text', title: `Thought ${i + 1}`, text: '', summary: 'One of many, to see how the field holds up.', tags: [], data: {}, source: { from: 'paste', capturedAt: at }, origin: { by: 'user' }, archived: false, revision: 0 };
    const node: Node = { id: `crowd-${i}`, treeId: 'crowd', itemId: item.id, parent: i === 0 ? null : `crowd-${Math.floor((i - 1) / 4)}`, status: i % 3 === 2 ? 'pick' : 'kept', why: i % 3 === 2 ? 'Related' : '', importance: 0.5, origin: { by: 'user' }, view: { component: 'note', props: {}, by: 'default' }, order: i };
    commands.push({ type: 'addItem', item });
    if (i === 0) commands.push({ type: 'createTree', tree: { id: 'crowd', title: 'A crowd', rootId: node.id, digest: '', createdAt: at }, root: node });
    else commands.push({ type: 'addNode', node });
  }
  return commands;
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
      await shot(page, 'desktop-8-every-shape');
      await page.getByRole('button', { name: 'Open 5' }).click();
      await until('the pile to open', async () => (await count(page, '.card.is-under')) === 0);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await until('the pile to close', async () => (await count(page, '.card.is-under')) === 4);
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

    await check('nothing was written to the console as an error', async () => {
      assert.deepEqual(problems, []);
    });
  } finally {
    await browser.close();
  }
}

/** A spoken clip for the fake microphone, made with a macOS voice: a second of quiet, the words, then quiet for the page to notice the pause. */
function spoken(text: string, dir: string): string {
  const aiff = join(dir, 'clip.aiff');
  const wav = join(dir, `${text.replace(/\W+/g, '-').slice(0, 30)}.wav`);
  execFileSync('say', ['-v', 'Samantha', '-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, join(dir, 'speech.wav')]);
  const speech = readFileSync(join(dir, 'speech.wav'));
  const pcm = speech.subarray(speech.indexOf('data') + 8);
  const quiet = (seconds: number) => Buffer.alloc(16000 * 2 * seconds);
  const body = Buffer.concat([quiet(1), pcm, quiet(4)]);
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
function standInClient(dir: string): string {
  const client = join(dir, 'client');
  cpSync(join(here, '../client'), client, { recursive: true, filter: (from) => !from.includes('/vendor') });
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

/**
 * The page listening for its name, with a clip played into a fake microphone. Needs macOS's `say`.
 * With the listener files (npm run fetch-wake), the real spotter hears the clips. Without them a stand-in does, which tests the page's half only,
 * and the check that needs the real spotter to tell words apart is skipped and says so.
 */
async function wakeChecks(): Promise<void> {
  const real = existsSync(join(here, '../client/vendor/sherpa-onnx/versions.json'));
  const dir = mkdtempSync(join(tmpdir(), 'mp-wake-'));
  const acted: string[] = [];
  const posted: { mime: string; seconds: number; firstTenthLevel: number; loudest: number }[] = [];
  const server = await startServer({
    port: 0, host: '127.0.0.1', dataDir: join(dir, 'data'), clientDir: real ? join(here, '../client') : standInClient(dir), model: new FakeModel(), token: 'secret',
    roles: { ...fakeRoles, conductor: async (ctx, input) => (acted.push(input.utterance), fakeRoles.conductor(ctx, input)) },
    transcribe: async (audio, mime) => {
      const samples = new Int16Array(audio.slice(44).buffer);
      const level = (from: number, to: number) => Math.sqrt(samples.slice(from, to).reduce((sum, s) => sum + (s / 32768) ** 2, 0) / Math.max(1, to - from));
      let loudest = 0;
      for (let at = 0; at < samples.length; at += 1600) loudest = Math.max(loudest, level(at, at + 1600));
      posted.push({ mime, seconds: samples.length / 16000, firstTenthLevel: level(0, 1600), loudest });
      return 'Hey Momo, show me more like this.';
    },
  });
  await server.pipeline.dump([{ kind: 'text', text: 'Sourdough rises slowly in winter' }]);
  await server.pipeline.idle();
  const open = async (clip: string) => {
    const browser = await chromium.launch({
      executablePath: browserPath(), headless: true,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${clip}%noloop`, '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    const problems: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (err) => problems.push(String(err)));
    await page.goto(`${server.url}/#token=secret`);
    await page.locator('#status[data-state="live"]').waitFor();
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { micStates: string[] }).micStates = seen;
      new MutationObserver(() => seen.push(document.querySelector('#mic')!.getAttribute('data-state')!)).observe(document.querySelector('#mic')!, { attributes: true, attributeFilter: ['data-state'] });
    });
    /** The mic's states since it was pressed, each run of one state counted once. */
    const states = async () => {
      const seen = await page.evaluate(() => (window as unknown as { micStates: string[] }).micStates);
      return seen.slice(seen.indexOf('starting')).filter((state, i, all) => state !== all[i - 1]);
    };
    return { browser, page, problems, states };
  };
  try {
    const woke = real
      ? 'the page wakes on "hey Momo", records what follows, and the service acts on it without the name'
      : 'with a stand-in spotter, the page records from just before the phrase to the pause, the service acts without the name, and the page does not listen while the reply plays';
    await check(woke, async () => {
      const { browser, page, problems, states } = await open(spoken('Hey Momo, show me more like this.', dir));
      try {
        await page.locator('.card').first().click();
        await page.locator('#mic').click();
        await until('the page waiting for its name', async () => (await page.getAttribute('#mic', 'data-state')) === 'waiting', 15000);
        assert.equal(await page.getAttribute('#talk-text', 'placeholder'), 'Say "Hey Momo", or type');
        if (!real) assert.equal(await page.workers()[0]!.evaluate(() => (self as unknown as { standInKeywords: string }).standInKeywords), '▁HE Y ▁MO MO @HEY_MOMO\n▁HI ▁MO MO @HI_MOMO\n▁HIGH ▁MO MO @HI_MOMO');
        await until('the page hearing the speaker', async () => (await states()).includes('hearing'), 15000);
        await until('the recording posted', async () => posted.length === 1, 15000);
        await page.locator('#caption').getByText('Show me more like this.').waitFor();
        await until('the reply heard and the page waiting again', async () => (await states()).join() === 'starting,waiting,hearing,working,waiting,speaking,waiting', 10000);
        assert.deepEqual(acted, ['Show me more like this.']);
        assert.equal(posted[0]!.mime, 'audio/wav');
        assert.ok(posted[0]!.seconds > 2.4 && posted[0]!.seconds < 5, `the recording holds the phrase, the command and the pause: ${posted[0]!.seconds} s`);
        assert.ok(posted[0]!.firstTenthLevel < 0.01 && posted[0]!.loudest > 0.05, `the recording starts in the quiet before the phrase: ${JSON.stringify(posted[0])}`);
        assert.deepEqual(problems, []);
      } finally {
        await browser.close();
      }
    });

    if (!real) console.log('skip without "hey Momo" nothing is recorded or sent: it needs the real spotter (npm run fetch-wake)');
    else await check('without "hey Momo" nothing is recorded or sent', async () => {
      const before = posted.length;
      const { browser, page, problems, states } = await open(spoken('Show me more like this, and keep the first two.', dir));
      try {
        await page.locator('#mic').click();
        await until('the page waiting for its name', async () => (await page.getAttribute('#mic', 'data-state')) === 'waiting', 15000);
        await page.waitForTimeout(8000);
        assert.equal(posted.length, before);
        assert.equal(acted.length, 1);
        assert.deepEqual(await states(), ['starting', 'waiting']);
        await page.locator('#mic').click();
        assert.equal(await page.getAttribute('#mic', 'data-state'), 'off');
        assert.deepEqual(problems, []);
      } finally {
        await browser.close();
      }
    });
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'mp-e2e-'));
const boot = (port: number) => startServer({ port, host: '127.0.0.1', dataDir, clientDir: join(here, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret' });
let run: Running = await boot(0);
try {
  await main();
  await wakeChecks();
  console.log(`\n${passed} checks passed. Screenshots are in docs/screenshots.`);
} finally {
  await run.close();
}
