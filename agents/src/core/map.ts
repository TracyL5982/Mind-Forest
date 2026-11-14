import type { LatLon } from './ports.ts';

/**
 * The map the `map` arrangement draws, `width` by `height` px, which the service fits to its members' points and every client draws
 * at this size. The points are kept `side` px in from its left and right edges and `edge` px in from its top and bottom, so a pin
 * and the credit stay inside it. The zoom is at most `most`, and two points less than `apart` px from each other at the map's zoom
 * are one place, under one pin.
 */
export const MAP = { width: 400, height: 320, side: 24, edge: 36, most: 14, apart: 28 } as const;

/** How far north and south Web Mercator reaches, so the world's map is square. */
const EDGE = 85.0511287798;

/** Where a point falls on the world's map, as a share of its width and of its height from the top-left corner. */
function world({ lat, lon }: LatLon): { x: number; y: number } {
  const sin = Math.sin((Math.max(-EDGE, Math.min(EDGE, lat)) * Math.PI) / 180);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
}

const round = (degrees: number) => Math.round(degrees * 1e6) / 1e6;

export interface Pin<Id> extends LatLon {
  members: Id[];
}
export interface Fitted<Id> {
  centre: LatLon;
  zoom: number;
  pins: Pin<Id>[];
}

/**
 * The map of these points, taken in the order given. Its zoom is the largest, up to `MAP.most`, at which every point fits inside
 * the map's margins, and its centre puts the middle of their extent at the middle of the map. Each point joins the first pin less
 * than `MAP.apart` px from it at that zoom, or starts a pin of its own where it is.
 */
export function fit<Id>(points: readonly (readonly [Id, LatLon])[]): Fitted<Id> {
  const at = points.map(([, point]) => world(point));
  const xs = at.map((p) => p.x);
  const ys = at.map((p) => p.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fits = (zoom: number) => (right - left) * 256 * 2 ** zoom <= MAP.width - 2 * MAP.side && (bottom - top) * 256 * 2 ** zoom <= MAP.height - 2 * MAP.edge;
  let zoom: number = MAP.most;
  while (zoom > 0 && !fits(zoom)) zoom--;

  const scale = 256 * 2 ** zoom;
  const pins: (Pin<Id> & { x: number; y: number })[] = [];
  points.forEach(([id, point], n) => {
    const { x, y } = at[n]!;
    const near = pins.find((pin) => Math.hypot((pin.x - x) * scale, (pin.y - y) * scale) < MAP.apart);
    if (near) near.members.push(id);
    else pins.push({ lat: point.lat, lon: point.lon, members: [id], x, y });
  });
  const middle = { x: (left + right) / 2, y: (top + bottom) / 2 };
  return {
    centre: { lat: round((Math.atan(Math.sinh(Math.PI * (1 - 2 * middle.y))) * 180) / Math.PI), lon: round(middle.x * 360 - 180) },
    zoom,
    pins: pins.map(({ lat, lon, members }) => ({ lat, lon, members })),
  };
}
