/**
 * Writes the sample map tiles that client/library.html and the tests draw, so neither asks a tile
 * server for anything. Each is a plain square, one of two shades by where it sits, so a seam or a
 * tile out of place shows. It writes the tiles that cover each point below at the sizes a place
 * card and its opened view draw, as client/js/map.js lays them out.
 *
 * Run: node --no-warnings --import tsx scripts/sample-tiles.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Tile = { z: number; x: number; y: number };
const { layout } = (await import(new URL('../client/js/map.js', import.meta.url).href)) as {
  layout: (map: { centre: { lat: number; lon: number }; zoom: number; width: number; height: number }) => { tiles: Tile[] };
};

/** The points the library page and the tests put on a map. */
export const POINTS = {
  lisbon: { lat: 38.7223, lon: -9.1393 },
  vilnius: { lat: 54.6872, lon: 25.2797 },
  moganshan: { lat: 30.6086, lon: 119.8664 },
};
/** A place card's map and the opened card's, as client/js/components/place.js draws them. */
const SIZES = [{ width: 256, height: 112, zoom: 12 }, { width: 348, height: 200, zoom: 12 }];
const SHADES = ['#5f7d6d', '#6e8a79'];

const dir = join(import.meta.dirname, '../client/samples/tiles');
rmSync(dir, { recursive: true, force: true });
const written = new Set<string>();
for (const centre of Object.values(POINTS)) {
  for (const size of SIZES) {
    for (const { z, x, y } of layout({ centre, ...size }).tiles) {
      const path = join(dir, String(z), String(x), `${y}.svg`);
      if (written.has(path)) continue;
      mkdirSync(join(dir, String(z), String(x)), { recursive: true });
      writeFileSync(path, `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${SHADES[(x + y) % 2]}"/></svg>\n`);
      written.add(path);
    }
  }
}
console.log(`${written.size} tiles in ${dir}`);
