import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JsonRequest, ModelClient } from '../src/core/ports.ts';
import { forDevice } from '../src/node/hosted/ledger.ts';
import { DEVICE_CALLS, DEVICE_WAITING, DeviceModel } from '../src/node/hosted/overflow.ts';

/** A model whose calls stay under way until the test lets them end, so it can count how many are under way at once. */
function heldModel() {
  let now = 0;
  let most = 0;
  const devices: (string | undefined)[] = [];
  const ending: (() => void)[] = [];
  const json = async <T,>(_req: JsonRequest<T>): Promise<T> => {
    now++;
    most = Math.max(most, now);
    devices.push(forDevice.getStore());
    await new Promise<void>((end) => ending.push(end));
    now--;
    return {} as T;
  };
  const model = { json, search: async () => [], image: async () => ({ bytes: new Uint8Array(), mime: 'image/png' }), transcribe: async () => '' } as ModelClient;
  return { model, most: () => most, devices, endAll: () => ending.splice(0).forEach((end) => end()) };
}

const req = { role: 'conductor', system: '', user: 'go up' } as unknown as JsonRequest<unknown>;
const tick = () => new Promise((done) => setImmediate(done));

test("one device's model calls are at most DEVICE_CALLS at once, the rest wait their turn, and past DEVICE_WAITING more are refused", async () => {
  const held = heldModel();
  let refusal: string | null = null;
  const device = new DeviceModel(held.model, 'device-a', () => refusal);
  const asked = DEVICE_CALLS + DEVICE_WAITING + 5;
  const results = Array.from({ length: asked }, () => device.json(req).then(() => 'answered', (err: Error) => err.message));
  await tick();
  assert.equal(held.most(), DEVICE_CALLS, 'no more than DEVICE_CALLS under way');
  const refusedAtOnce = await Promise.race([Promise.all(results.slice(-5)), new Promise((done) => setTimeout(() => done('still waiting'), 50))]);
  assert.deepEqual(refusedAtOnce, Array(5).fill('Too much is being asked at once on this headset. Give it a moment and try again.'));

  held.endAll();
  await tick();
  assert.equal(held.most(), DEVICE_CALLS, 'the waiting ones start as places free, never more at once');
  refusal = "This headset has reached today's limit.";
  held.endAll();
  const settled = await Promise.all(results.slice(0, -5));
  assert.equal(settled.filter((r) => r === 'answered').length, 2 * DEVICE_CALLS, 'the first two rounds were answered');
  assert.ok(settled.slice(2 * DEVICE_CALLS).every((r) => r === "This headset has reached today's limit."), 'calls that waited stop once the share is spent');
  assert.ok(held.devices.every((d) => d === 'device-a'), "each call ran as the device's work");
});

test("another device's calls do not wait on a busy one", async () => {
  const held = heldModel();
  const a = new DeviceModel(held.model, 'device-a', () => null);
  const b = new DeviceModel(held.model, 'device-b', () => null);
  for (let n = 0; n < DEVICE_CALLS + 4; n++) void a.json(req);
  void b.json(req);
  await tick();
  assert.equal(held.devices.filter((d) => d === 'device-b').length, 1, 'device B started at once');
  held.endAll();
});
