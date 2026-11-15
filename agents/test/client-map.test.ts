import assert from 'node:assert/strict';
import { test } from 'node:test';

type Tile = { z: number; x: number; y: number; left: number; top: number };
type Map = { centre: { lat: number; lon: number }; zoom: number; width: number; height: number; pins?: { lat: number; lon: number }[] };
const { layout, tileUrl } = (await import(new URL('../client/js/map.js', import.meta.url).href)) as {
  layout: (map: Map) => { tiles: Tile[]; pins: { left: number; top: number }[] };
  tileUrl: (tiles: string, tile: Tile) => string;
};
const { sizeOf } = (await import(new URL('../client/js/components/index.js', import.meta.url).href)) as {
  sizeOf: (node: unknown, item: unknown) => number[];
};

const LISBON = { lat: 38.7223, lon: -9.1393 };

test('a map is the tiles that cover it, each where it sits, and its pin at the point it marks', () => {
  const { tiles, pins } = layout({ centre: LISBON, zoom: 12, width: 256, height: 112, pins: [LISBON] });

  assert.deepEqual(tiles.map(({ x, y }) => [x, y]), [[1943, 1569], [1944, 1569]]);
  assert.equal(tiles[1]!.left - tiles[0]!.left, 256);
  assert.ok(tiles[0]!.left <= 0 && tiles[0]!.top <= 0 && tiles[0]!.top + 256 >= 112, 'the tiles cover the whole map');
  assert.ok(Math.abs(pins[0]!.left - 128) <= 0.5 && Math.abs(pins[0]!.top - 56) <= 0.5, 'the centre is the middle, to the half px the corner is held to');
  assert.equal(tileUrl('https://tiles.example/{z}/{x}/{y}.png', tiles[0]!), 'https://tiles.example/12/1943/1569.png');
});

test('a map across the date line wraps its columns, and one past the top of the world has no row there', () => {
  assert.deepEqual(layout({ centre: { lat: 10, lon: 179.99 }, zoom: 2, width: 256, height: 10 }).tiles.map(({ x, y }) => [x, y]), [[3, 1], [0, 1]]);
  assert.deepEqual(layout({ centre: { lat: 85, lon: 10 }, zoom: 1, width: 10, height: 256 }).tiles.map(({ x, y }) => [x, y]), [[1, 0]]);
});

test('a place card\'s map takes at most four tiles and the opened card\'s at most six, wherever it is', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 500; n++) {
    const centre = { lat: random() * 170 - 85, lon: random() * 360 - 180 };
    assert.ok(layout({ centre, zoom: 12, width: 210, height: 88 }).tiles.length <= 4);
    assert.ok(layout({ centre, zoom: 12, width: 348, height: 200 }).tiles.length <= 6);
  }
});

test('a place card shows a 210 by 88 map under its name in place of its words, only when its item holds a point on the earth', () => {
  const card = (at?: unknown) => sizeOf({ view: { component: 'place', props: { name: 'Lisbon' } } }, { title: 'Lisbon', text: '', summary: 'Three days.', data: at === undefined ? {} : { at } });

  assert.deepEqual(card(LISBON), [210, 17 + 28 + 13 + 88], 'the border, 13 px and 2 to spare over the name, 13 px under it, and the map to the edges');
  assert.deepEqual(card(), [210, 30 + 28 + 8 + 22], 'the padded frame, the name, and its words on one line');
  for (const wrong of [null, { lat: 91, lon: 0 }, { lat: 0, lon: -181 }, { lat: '38.7', lon: -9.1 }, { lat: Number.NaN, lon: 0 }, [38.7, -9.1]]) {
    assert.deepEqual(card(wrong), card(), JSON.stringify(wrong));
  }
});
