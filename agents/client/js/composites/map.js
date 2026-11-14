import { h } from '../dom.js';
import { drawMap } from '../map.js';
import { HEAD, PAD } from './shared.js';

export const name = 'Map';

/** The map, the size the service fits its centre and zoom to (`MAP` in src/core/map.ts). */
export const MAP = { width: 400, height: 320 };
/** The room between the map and the members, the band above each row of members that holds their numbers, and the room between two cards. */
const BESIDE = 24;
const NUMBER = 30;
const GAP = 16;

/**
 * The map at the top left with a numbered pin for each place, and the members beside it in pin order, in rows of two, or of three
 * past four members. Each member has the number of its pin above its left edge.
 */
export function arrange(group, ids, sizes) {
  const { centre, zoom, pins } = group.props;
  const number = new Map(pins.flatMap((pin, n) => pin.members.map((id) => [id, n + 1])));
  const columns = ids.length <= 4 ? 2 : 3;
  const cell = Math.ceil(Math.max(...ids.map((id) => sizes.get(id)[0])));
  const left = PAD + MAP.width + BESIDE;
  const at = new Map();
  const numbers = [];
  let top = HEAD;
  for (let start = 0; start < ids.length; start += columns) {
    const row = ids.slice(start, start + columns);
    row.forEach((id, i) => {
      const [w, hgt] = sizes.get(id);
      const x = left + i * (cell + GAP);
      at.set(id, { x: x + w / 2, y: top + NUMBER + hgt / 2 });
      if (number.has(id)) numbers.push(h('div', { class: 'map-n', style: { left: `${x}px`, top: `${top}px` }, text: String(number.get(id)) }));
    });
    top += NUMBER + Math.ceil(Math.max(...row.map((id) => sizes.get(id)[1]))) + GAP;
  }
  const used = Math.min(columns, ids.length);
  return {
    at,
    w: left + used * cell + (used - 1) * GAP + PAD,
    h: Math.max(HEAD + MAP.height, top - GAP) + PAD,
    marks: [
      h('div', { class: 'arr-map', style: { left: `${PAD}px`, top: `${HEAD}px`, width: `${MAP.width}px`, height: `${MAP.height}px` } },
        drawMap({ ...MAP, centre, zoom, pins: pins.map((pin, n) => ({ lat: pin.lat, lon: pin.lon, label: String(n + 1) })) }, 'arr-map-ground')),
      numbers,
    ],
  };
}
