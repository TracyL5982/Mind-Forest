import { h, s } from './dom.js';

/**
 * A map is described as a centre, a zoom and pins. This module turns that into the tiles that cover
 * it and the place each pin falls, and draws them. Tiles are the square pictures of the Web Mercator
 * projection every common provider serves: at zoom `z` the world is `2^z` tiles of 256 px across and
 * down, numbered from the top-left. docs/libraries.md gives the same rule for a second client.
 */
export const TILE = 256;
/** How far north and south the projection reaches, so the world's map is square. */
const EDGE = 85.0511287798;

let provider = null;

/**
 * The tile provider the service names, `{ tiles, credit, link? }`, or null when maps are off. With
 * none, a map asks for no tile: it is the plain ground with its pins and no credit.
 */
export function useMaps(maps) {
  provider = maps && typeof maps.tiles === 'string' && typeof maps.credit === 'string' ? { tiles: maps.tiles, credit: maps.credit, link: maps.link } : null;
}

/** `item.data.at` when it is a point on the earth: `{ lat, lon }` in degrees, each a finite number in range. */
export function atOf(value) {
  const inRange = (v, most) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= most;
  return value && inRange(value.lat, 90) && inRange(value.lon, 180) ? { lat: value.lat, lon: value.lon } : null;
}

/** Where a point falls on the whole world's map at a zoom, in px from its top-left corner. */
export function project({ lat, lon }, zoom) {
  const world = TILE * 2 ** zoom;
  const sin = Math.sin((Math.max(-EDGE, Math.min(EDGE, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * world, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world };
}

/**
 * A map `width` by `height` px around `centre` at `zoom`: `tiles`, each `{ z, x, y, left, top }`
 * with its top-left corner in px from the map's, and `pins`, each `{ left, top }`, the point it
 * marks. The map's own corner is put on a whole px of the world, so the tiles meet with no seam. A
 * column past either edge of the world wraps round to the other side, and a row past the top or the
 * bottom has no tile.
 */
export function layout({ centre, zoom, width, height, pins = [] }) {
  const middle = project(centre, zoom);
  const left = Math.round(middle.x - width / 2);
  const top = Math.round(middle.y - height / 2);
  const across = 2 ** zoom;
  const tiles = [];
  for (let row = Math.floor(top / TILE); row * TILE < top + height; row++) {
    if (row < 0 || row >= across) continue;
    for (let column = Math.floor(left / TILE); column * TILE < left + width; column++) {
      tiles.push({ z: zoom, x: ((column % across) + across) % across, y: row, left: column * TILE - left, top: row * TILE - top });
    }
  }
  return {
    tiles,
    pins: pins.map((pin) => {
      const at = project(pin, zoom);
      return { left: at.x - left, top: at.y - top };
    }),
  };
}

/** A tile's address: the provider's with `{z}`, `{x}` and `{y}` filled in. */
export const tileUrl = (tiles, { z, x, y }) => tiles.replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y));

const PIN = 'M11 27C5.2 19.9 2 15.1 2 10.6a9 9 0 0 1 18 0c0 4.5-3.2 9.3-9 16.4Z';

/**
 * The map, drawn as `layout` places it in a layer `width` by `height` px at the middle of its box,
 * so a box a little wider or narrower than the map still has its centre in the middle. Each tile is
 * drawn only as far as it lies inside the map, so no part of a map reaches past it. A tile that
 * fails to load is taken away and leaves the plain ground. `link` makes the credit a link, which a
 * card on the field cannot have, because a click there opens the card.
 */
export function drawMap({ centre, zoom, width, height, pins = [], link = false }, className) {
  const { tiles, pins: placed } = layout({ centre, zoom, width, height, pins });
  const layer = h('div', { class: 'map-layer', style: { width: `${width}px`, height: `${height}px`, marginLeft: `${-width / 2}px`, marginTop: `${-height / 2}px` } },
    provider && tiles.map((tile) => {
      const [left, top] = [Math.max(0, tile.left), Math.max(0, tile.top)];
      const img = h('img', { class: 'map-tile', src: tileUrl(provider.tiles, tile), alt: '', draggable: 'false', style: {
        left: `${left}px`, top: `${top}px`,
        width: `${Math.min(width, tile.left + TILE) - left}px`, height: `${Math.min(height, tile.top + TILE) - top}px`,
        objectPosition: `${tile.left - left}px ${tile.top - top}px`,
      } });
      img.addEventListener('error', () => img.remove());
      return img;
    }),
    placed.map(({ left, top }) => s('svg', { class: 'map-pin', viewBox: '0 0 22 28', width: 22, height: 28, 'aria-hidden': 'true', style: { left: `${left - 11}px`, top: `${top - 27}px` } },
      s('path', { d: PIN }), s('circle', { cx: 11, cy: 10.5, r: 3.4 }))));
  const credit = provider && (link && provider.link
    ? h('a', { class: 'map-credit', href: provider.link, target: '_blank', rel: 'noopener', text: provider.credit })
    : h('span', { class: 'map-credit', text: provider.credit }));
  return h('div', { class: `map ${className}`, style: { height: `${height}px` } }, layer, credit);
}
