/**
 * Plays a recorded sentence into a fake microphone in a real browser, presses the mic, and reports what the service heard.
 * Usage: tsx scripts/hearing-check.ts <clip.wav> ["what was said"]
 * The clip should end in silence, so the page can notice the pause and stop by itself.
 */
import { mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { loadEnv } from '../src/node/env.ts';
import { startServer } from '../src/node/server.ts';
import { openaiTranscribe } from '../src/node/speech-openai.ts';

const [clip, said] = process.argv.slice(2);
if (!clip) throw new Error('usage: hearing-check.ts <clip.wav> ["what was said"]');
const env = loadEnv();
const run = await startServer({
  port: 0, host: '127.0.0.1', dataDir: mkdtempSync(join(tmpdir(), 'mp-hear-')), clientDir: join(resolve(import.meta.dirname, '..'), 'client'),
  model: new FakeModel(), roles: fakeRoles, token: 'hear',
  transcribe: openaiTranscribe(fetch, { apiKey: env.OPENAI_API_KEY ?? '' }),
});
await run.pipeline.dump([{ kind: 'text', text: 'Sourdough rises slowly in winter' }, { kind: 'text', text: 'Rooftop solar with batteries' }]);
await run.pipeline.idle();

const cache = join(homedir(), 'Library/Caches/ms-playwright');
const shell = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().at(-1)!;
const browser = await chromium.launch({
  executablePath: join(cache, shell, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(clip)}%noloop`],
});
const page = await browser.newPage();
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${run.url}/#token=hear`);
await page.waitForFunction(() => document.querySelector('#mic') !== null);
await page.waitForTimeout(800);
const pressed = Date.now();
const [reply] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/transcribe'), { timeout: 30000 }), page.click('#mic')]);
const heard = ((await reply.json()) as { text?: string }).text ?? '';
const answered = Date.now() - pressed;
await page.waitForFunction(() => document.querySelector('#mic')?.getAttribute('data-state') === 'idle', null, { timeout: 10000 }).catch(() => {});
console.log(JSON.stringify({ said, heard, status: reply.status(), msFromPressToText: answered, micBackToIdle: (await page.getAttribute('#mic', 'data-state')) === 'idle', errors }));
await browser.close();
await run.close();
