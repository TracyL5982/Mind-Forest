import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { DiskAssets } from '../src/node/assets.ts';
import { tempDir } from './temp.ts';

test('what the service kept itself is counted again after a restart, and uploads and links never are', async () => {
  const dir = join(tempDir('mp-made-'), 'assets');
  const assets = new DiskAssets(dir, '', dir, 1_000_000);
  await assets.put(new Uint8Array(400_000), 'image/jpeg', 'found.jpg');
  await assets.putStream(Readable.from([new Uint8Array(900_000)]), 'application/pdf', 'upload.pdf', 2_000_000, () => new Error('too large'));
  await assets.link('https://example.com/film.mp4', 'video/mp4');
  assert.equal(assets.made(), 400_000);
  const again = new DiskAssets(dir, '', dir, 1_000_000);
  assert.equal(again.made(), 400_000, 'counted from the disk after a restart');
  await assert.rejects(again.put(new Uint8Array(700_000), 'image/jpeg', 'big.jpg'), /no room to keep big\.jpg/);
  await again.put(new Uint8Array(500_000), 'image/jpeg', 'fits.jpg');
  assert.equal(again.made(), 900_000);
  const mac = new DiskAssets(dir);
  await mac.put(new Uint8Array(2_000_000), 'image/jpeg', 'mac.jpg');
  assert.ok(true, 'with no limit, as on the Mac, nothing is refused');
});
