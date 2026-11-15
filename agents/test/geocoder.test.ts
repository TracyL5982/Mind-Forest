import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLIENT_NAME, Nominatim, openMaps } from '../src/node/geocoder.ts';

const LISBON = [{ category: 'boundary', lat: '38.7077507', lon: '-9.1365919' }];
const KITCHEN = [{ category: 'amenity', lat: '51.5', lon: '-0.1' }, { category: 'shop', lat: '51.6', lon: '-0.2' }];

/** A Nominatim over a scripted server and a clock that only moves when it is told to wait. */
function lookup(cacheFile: string, answer: (q: string) => Response | Promise<Response>) {
  let clock = 0;
  const asked: { q: string; at: number; agent: string | null }[] = [];
  const geocoder = new Nominatim({
    search: 'https://lookup.example/search',
    cacheFile,
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
    fetch: async (url, init) => {
      const q = new URL(String(url)).searchParams.get('q')!;
      asked.push({ q, at: clock, agent: new Headers(init?.headers).get('User-Agent') });
      return answer(q);
    },
  });
  return { geocoder, asked };
}

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('lookups wait a second after each other, and a name asked twice at once is asked about once', async () => {
  const { geocoder, asked } = lookup(join(mkdtempSync(join(tmpdir(), 'mp-geo-')), 'places.json'), (q) => json(q === 'lisbon' ? LISBON : []));

  const found = await Promise.all([geocoder.locate('Lisbon'), geocoder.locate('Porto'), geocoder.locate(' lisbon '), geocoder.locate('Faro')]);

  assert.deepEqual(found, [{ lat: 38.7077507, lon: -9.1365919 }, null, { lat: 38.7077507, lon: -9.1365919 }, null]);
  assert.deepEqual(asked.map(({ q, at }) => [q, at]), [['lisbon', 0], ['porto', 1000], ['faro', 2000]]);
  assert.ok(asked.every(({ agent }) => agent === CLIENT_NAME), 'every lookup carries the one generic client name');
});

test('answers are kept on disk, a place not found included, and a failed lookup is asked again', async () => {
  const cache = join(mkdtempSync(join(tmpdir(), 'mp-geo-')), 'places.json');
  let up = false;
  const first = lookup(cache, (q) => (q === 'lisbon' && !up ? new Response('busy', { status: 503 }) : json(q === 'lisbon' ? LISBON : [])));

  assert.equal(await first.geocoder.locate('Lisbon'), null);
  assert.equal(await first.geocoder.locate('Atlantis'), null);
  up = true;
  assert.deepEqual(await first.geocoder.locate('Lisbon'), { lat: 38.7077507, lon: -9.1365919 });
  assert.deepEqual(first.asked.map(({ q }) => q), ['lisbon', 'atlantis', 'lisbon']);

  const again = lookup(cache, () => json(LISBON));
  assert.deepEqual(await again.geocoder.locate('LISBON'), { lat: 38.7077507, lon: -9.1365919 });
  assert.equal(await again.geocoder.locate('Atlantis'), null);
  assert.deepEqual(again.asked, [], 'a second run asks about nothing it was answered before');
});

test('a shop or a café that shares the name is not the place, and a network failure gives no place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-geo-'));
  const { geocoder } = lookup(join(dir, 'places.json'), (q) => (q === 'the kitchen' ? json(KITCHEN) : Promise.reject(new TypeError('fetch failed'))));

  assert.equal(await geocoder.locate('The kitchen'), null);
  assert.equal(await geocoder.locate('Porto'), null);
  assert.equal(await geocoder.locate('   '), null);
});

test('maps open only for a provider the service knows, which names its tiles and its credit', () => {
  const maps = openMaps('openstreetmap', join(mkdtempSync(join(tmpdir(), 'mp-geo-')), 'places.json'));
  assert.equal(maps.tiles, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(maps.credit, '© OpenStreetMap contributors');
  assert.throws(() => openMaps('acme-maps', '/nowhere/places.json'), /acme-maps/);
});
