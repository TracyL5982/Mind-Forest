/**
 * The page listening for its name in a real browser, with recorded speech played into a fake microphone.
 * 1. Wakes on a clip with the phrase and a command, transcribed by OpenAI when its key is present, and reports what the service acted on.
 * 2. Measures the CPU the browser spends while it waits for its name, with a clip of talk without the phrase playing in a loop,
 *    against the same page with the microphone off.
 * Usage: tsx scripts/wake-check.ts <clip with "hey Momo" and a command.wav> <talk without it.wav> [seconds to measure, default 30]
 * Needs the listener files (npm run fetch-wake).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserServer } from 'playwright-core';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { loadEnv } from '../src/node/env.ts';
import { startServer } from '../src/node/server.ts';
import { openaiTranscribe } from '../src/node/speech-openai.ts';

const [wakeClip, talkClip, secondsArg] = process.argv.slice(2);
if (!wakeClip || !talkClip) throw new Error('usage: wake-check.ts <clip with the phrase.wav> <talk without it.wav> [seconds]');
const seconds = Number(secondsArg ?? 30);
const env = loadEnv();
const dataDir = mkdtempSync(join(tmpdir(), 'mp-wake-check-'));
const acted: string[] = [];
const run = await startServer({
  port: 0, host: '127.0.0.1', dataDir, clientDir: join(resolve(import.meta.dirname, '..'), 'client'), model: new FakeModel(), token: 'wake',
  roles: { ...fakeRoles, conductor: async (ctx, input) => (acted.push(input.utterance), fakeRoles.conductor(ctx, input)) },
  ...(env.OPENAI_API_KEY ? { transcribe: openaiTranscribe(fetch, { apiKey: env.OPENAI_API_KEY }) } : {}),
});
await run.pipeline.dump([{ kind: 'text', text: 'Start a tree on this: Sourdough rises slowly in winter' }]);
await run.pipeline.idle();

const chrome = join(homedir(), 'Library/Caches/ms-playwright');
async function launch(clip: string, loop: boolean): Promise<{ browser: Browser; server: BrowserServer }> {
  const shell = readdirSync(chrome).filter((d) => d.startsWith('chromium-')).sort().at(-1)!;
  const server = await chromium.launchServer({
    executablePath: join(chrome, shell, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(clip)}${loop ? '' : '%noloop'}`],
  });
  return { browser: await chromium.connect(server.wsEndpoint()), server };
}

/** CPU seconds used so far by the browser and every process under it. */
function cpu(server: BrowserServer): number {
  const root = server.process().pid;
  if (!root) return NaN;
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time='], { encoding: 'utf8' }).trim().split('\n').map((line) => line.trim().split(/\s+/));
  const tree = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of rows) if (tree.has(Number(ppid)) && !tree.has(Number(pid))) (tree.add(Number(pid)), (grew = true));
  }
  const toSeconds = (t: string) => t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  return rows.filter(([pid]) => tree.has(Number(pid))).reduce((sum, row) => sum + toSeconds(row[2]!), 0);
}

{
  const { browser, server } = await launch(wakeClip, false);
  const page = await browser.newPage();
  await page.goto(`${run.url}/#token=wake`);
  await page.locator('#status[data-state="live"]').waitFor();
  await page.locator('.card').first().click();
  const pressed = Date.now();
  const [reply] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/transcribe'), { timeout: 30000 }), page.click('#mic')]);
  const heard = ((await reply.json()) as { text?: string }).text ?? '';
  await run.pipeline.idle();
  console.log(JSON.stringify({ check: 'wake', transcriber: env.OPENAI_API_KEY ? 'openai' : 'fake model', heard, acted, msFromPressToText: Date.now() - pressed }));
  await browser.close();
  await server.close();
}

{
  const { browser, server } = await launch(talkClip, true);
  const page = await browser.newPage();
  await page.goto(`${run.url}/#token=wake`);
  await page.locator('#status[data-state="live"]').waitFor();
  await page.waitForTimeout(3000);
  const measure = async () => {
    const [c0, t0] = [cpu(server), Date.now()];
    await page.waitForTimeout(seconds * 1000);
    return (cpu(server) - c0) / ((Date.now() - t0) / 1000);
  };
  const off = await measure();
  await page.click('#mic');
  await page.waitForFunction(() => document.querySelector('#mic')?.getAttribute('data-state') === 'waiting', null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  const busyBefore = await page.evaluate(() => (window as unknown as { handsFreeBusy: () => Promise<{ decodeMs: number; audioS: number }> }).handsFreeBusy());
  const waiting = await measure();
  const busyAfter = await page.evaluate(() => (window as unknown as { handsFreeBusy: () => Promise<{ decodeMs: number; audioS: number }> }).handsFreeBusy());
  const spotted = { decodeMs: busyAfter.decodeMs - busyBefore.decodeMs, audioS: busyAfter.audioS - busyBefore.audioS };
  console.log(JSON.stringify({
    check: 'cpu', seconds, cores: Number(execFileSync('sysctl', ['-n', 'hw.ncpu'], { encoding: 'utf8' })), load: execFileSync('uptime', { encoding: 'utf8' }).trim(),
    browserCoresMicOff: Number(off.toFixed(3)), browserCoresWaiting: Number(waiting.toFixed(3)),
    spotterMsPerSecondOfSound: Number((spotted.decodeMs / spotted.audioS).toFixed(1)), soundSpottedS: Number(spotted.audioS.toFixed(1)),
    state: await page.getAttribute('#mic', 'data-state'),
  }));
  await browser.close();
  await server.close();
}
await run.close();
rmSync(dataDir, { recursive: true, force: true });
