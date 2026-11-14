import { mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { WebSocket } from 'ws';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { loadEnv } from '../src/node/env.ts';
import { startServer } from '../src/node/server.ts';
import { openaiSpeech } from '../src/node/speech-openai.ts';

const env = loadEnv();
const root = resolve(import.meta.dirname, '..');
const run = await startServer({
  port: 0, host: '127.0.0.1', dataDir: mkdtempSync(join(tmpdir(), 'mp-voice-')), clientDir: join(root, 'client'),
  model: new FakeModel(), roles: fakeRoles, token: 'voice',
  speak: process.env.NO_VOICE ? undefined : openaiSpeech(fetch, { apiKey: env.OPENAI_API_KEY ?? '' }),
});
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const shell = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().at(-1)!;
const browser = await chromium.launch({ executablePath: join(cache, shell, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing') });
const page = await browser.newPage();
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript(() => {
  (window as unknown as { browserVoice: number }).browserVoice = 0;
  speechSynthesis.speak = () => { (window as unknown as { browserVoice: number }).browserVoice++; };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const p = play.call(this);
    p.then(() => ((window as unknown as { playedAt: number }).playedAt = performance.now()), () => {});
    return p;
  };
});
const spoken: { status: number; type: string | null; bytes: number }[] = [];
page.on('response', async (r) => {
  if (!r.url().includes('/api/speak')) return;
  spoken.push({ status: r.status(), type: r.headers()['content-type'] ?? null, bytes: (await r.body().catch(() => Buffer.alloc(0))).length });
});
await page.goto(`${run.url}/#token=voice`);
await page.waitForTimeout(800);
await page.mouse.click(5, 5);
const ws = new WebSocket(`${run.url.replace('http', 'ws')}/ws?token=voice`);
await new Promise((r) => ws.on('open', r));
const sentAt = await page.evaluate(() => performance.now());
ws.send(JSON.stringify({ t: 'utter', text: 'remember to look at trains', final: true, scene: {} }));
await page.waitForFunction(() => (window as unknown as { playedAt?: number }).playedAt !== undefined || (window as unknown as { browserVoice: number }).browserVoice > 0, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);
const state = await page.evaluate(() => ({ playedAt: (window as unknown as { playedAt?: number }).playedAt, browserVoice: (window as unknown as { browserVoice: number }).browserVoice }));
console.log(JSON.stringify({ spoken, playedAfterMs: state.playedAt ? Math.round(state.playedAt - sentAt) : null, browserVoiceUsed: state.browserVoice, errors }));
ws.close();
await browser.close();
await run.close();
