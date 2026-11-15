import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fit, MAP } from '../src/core/map.ts';
import { MEMBERS, ROOM, type CompositeId } from '../src/core/views.ts';

/** Just enough of a page for an arrangement to build its marks: each element keeps its class, its style and what it holds. */
interface Element { class: string; style: Record<string, string>; text: string; kids: Element[] }
const page = {
  createElement: (): Element & Record<string, unknown> => {
    const el = { class: '', style: {}, text: '', kids: [] as Element[], dataset: {} } as Element & Record<string, unknown>;
    return Object.assign(el, {
      setAttribute: (key: string, value: string) => { if (key === 'class') el.class = value; },
      addEventListener: () => {},
      append: (...kids: Element[]) => el.kids.push(...kids),
      set textContent(value: string) { el.text = value; },
    });
  },
};
Object.assign(globalThis, { document: { ...page, createElementNS: (_space: string) => page.createElement() } });

const load = (path: string) => import(new URL(`../client/js/${path}`, import.meta.url).href);

/** A seeded run of numbers, so a failure can be run again. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 2 ** 32;
  };
}

const WORDS = ['the', 'lens', 'sharp', 'stop', 'harbour', 'council', 'rebuilt', 'state-of-the-art', 'Okafor', '1958', 'costs', 'most', 'widest', 'Summicron'];
const HAN = '记忆宫殿港口的墙用石头重建了一遍比原来高两米这是最便宜的镜头';

function words(next: () => number, most: number): string {
  if (next() < 0.35) return Array.from({ length: 1 + Math.floor(next() * (most / 2)) }, () => HAN[Math.floor(next() * HAN.length)]).join('').slice(0, most / 2);
  let said = '';
  while (said.length < most * next()) said += `${said ? ' ' : ''}${WORDS[Math.floor(next() * WORDS.length)]}`;
  return said.slice(0, most).trim() || 'Sharp.';
}

/** Props for an arrangement of these members, with every line as long as the service lets it be at most. */
function propsFor(composite: CompositeId, ids: string[], next: () => number): Record<string, unknown> {
  const line = () => (next() < 0.2 ? '' : words(next, ROOM.reason.spaced));
  if (composite === 'ranked') return { reasons: Object.fromEntries(ids.map((id) => [id, line()])) };
  if (composite === 'beforeafter') return { changes: Object.fromEntries(ids.slice(1).map((id) => [id, line()])) };
  if (composite === 'matrix') return { x: words(next, ROOM.axis), y: words(next, ROOM.axis), reasons: Object.fromEntries(ids.map((id) => [id, line()])) };
  if (composite === 'map') {
    const spread = 10 ** (next() * 5 - 3);
    const [lat, lon] = [next() * 140 - 70, next() * 300 - 150];
    return { ...fit(ids.map((id) => [id, { lat: lat + (next() - 0.5) * spread, lon: lon + (next() - 0.5) * spread }] as const)) };
  }
  return {};
}

/** Where a mark is drawn, from its style, or from the size style.css gives its class. */
function box(mark: Element): { left: number; top: number; width: number; height: number } | null {
  const px = (value: string | undefined) => (value === undefined ? undefined : Number.parseFloat(value));
  const fixed = /rank-n|map-n/.test(mark.class) ? 22 : /lead-rule|is-across|is-right/.test(mark.class) ? 1 : undefined;
  const [left, top] = [px(mark.style.left), px(mark.style.top)];
  const width = px(mark.style.width) ?? (/rank-n|map-n/.test(mark.class) ? 22 : /is-up|is-down/.test(mark.class) ? 1 : undefined);
  const height = px(mark.style.height) ?? (mark.class.includes('mx-name') ? 17 : fixed);
  return left === undefined || top === undefined || width === undefined || height === undefined ? null : { left, top, width, height };
}

const NEW: CompositeId[] = ['ranked', 'beforeafter', 'lead', 'overview', 'moodboard', 'matrix', 'map'];
const EPS = 1e-6;

test('500 member sets of each new arrangement place no card over another or outside the frame, and no mark over a card', async () => {
  const { arrange } = await load('composites/index.js');
  const { PAD, HEAD } = await load('composites/shared.js');
  for (const composite of NEW) {
    const next = random(composite.length * 7919);
    const [fewest, most] = MEMBERS[composite];
    for (let run = 0; run < 500; run++) {
      const count = fewest + Math.floor(next() * (Math.min(most, 12) - fewest + 1));
      const ids = Array.from({ length: count }, (_, i) => `m${i}`);
      const scale = next() < 0.5 ? 0.86 : 1;
      const sizes = new Map(ids.map((id): [string, [number, number]] => [id, [(119 + Math.floor(next() * 400)) * scale, (40 + Math.floor(next() * 560)) * scale]]));
      const group = { id: 'g', composite, title: '', members: ids, props: propsFor(composite, ids, next) };
      const arr = arrange(group, ids, sizes, false);
      const told = `${composite} run ${run}: ${JSON.stringify([...sizes.values()])} ${JSON.stringify(group.props)}`;
      assert.equal(arr.label === 'Cluster', false, `${told}: drawn as its own kind`);
      const cards = ids.map((id) => {
        const { x, y } = arr.at.get(id);
        const [w, hgt] = sizes.get(id)!;
        return { id, left: x - w / 2, top: y - hgt / 2, right: x + w / 2, bottom: y + hgt / 2 };
      });
      for (const c of cards) {
        assert.ok(c.left >= PAD - EPS && c.right <= arr.w - PAD + EPS && c.top >= HEAD - EPS && c.bottom <= arr.h - PAD + EPS, `${told}: ${c.id} is inside the frame`);
      }
      const apart = (a: { left: number; top: number; right: number; bottom: number }, b: typeof a) => a.right <= b.left + EPS || b.right <= a.left + EPS || a.bottom <= b.top + EPS || b.bottom <= a.top + EPS;
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) assert.ok(apart(cards[i]!, cards[j]!), `${told}: ${cards[i]!.id} and ${cards[j]!.id} do not overlap`);
      for (const mark of (arr.marks as unknown[]).flat(Infinity).filter(Boolean) as Element[]) {
        const at = box(mark);
        assert.ok(at, `${told}: ${mark.class} has a place and a size`);
        const r = { left: at.left, top: at.top, right: at.left + at.width, bottom: at.top + at.height };
        assert.ok(r.left >= -EPS && r.right <= arr.w + EPS && r.top >= -EPS && r.bottom <= arr.h + EPS, `${told}: ${mark.class} is inside the frame`);
        for (const c of cards) assert.ok(apart(r, c), `${told}: ${mark.class} is clear of ${c.id}`);
      }
    }
  }
});

test('every arrangement in views.ts has a client module, in the same order', async () => {
  const { COMPOSITES } = await load('composites/index.js');
  assert.deepEqual(Object.keys(COMPOSITES), Object.keys(MEMBERS));
});

test('the map the service fits to its points draws every point inside its margins, each pin apart from the others, at the largest zoom that holds them', async () => {
  const { MAP: DRAWN } = await load('composites/map.js');
  const { layout } = await load('map.js');
  assert.deepEqual(DRAWN, { width: MAP.width, height: MAP.height }, 'the client draws the map at the size the service fits it to');
  const next = random(1931);
  for (let run = 0; run < 2000; run++) {
    const spread = 10 ** (next() * 5 - 3.5);
    const [lat, lon] = [next() * 150 - 75, next() * 320 - 160];
    const points = Array.from({ length: 3 + Math.floor(next() * 10) }, (_, n) => [`m${n}`, { lat: lat + (next() - 0.5) * spread, lon: lon + (next() - 0.5) * spread }] as const);
    const { centre, zoom, pins } = fit(points);
    const told = `run ${run}: ${JSON.stringify(points)}`;
    const drawn = (z: number, at: { lat: number; lon: number }[]) => layout({ centre, zoom: z, width: MAP.width, height: MAP.height, pins: at }).pins as { left: number; top: number }[];
    const inside = (p: { left: number; top: number }) => p.left >= MAP.side - 1 && p.left <= MAP.width - MAP.side + 1 && p.top >= MAP.edge - 1 && p.top <= MAP.height - MAP.edge + 1;
    assert.ok(drawn(zoom, points.map(([, at]) => at)).every(inside), `${told}: every point is inside the margins at zoom ${zoom}`);
    const placed = drawn(zoom, pins);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(Math.hypot(placed[i]!.left - placed[j]!.left, placed[i]!.top - placed[j]!.top) >= MAP.apart - 1, `${told}: pins ${i + 1} and ${j + 1} are apart`);
    assert.deepEqual(pins.flatMap((pin) => pin.members).sort(), points.map(([id]) => id).sort(), `${told}: every point is under one pin`);
    if (zoom < MAP.most) {
      const closer = layout({ centre, zoom: zoom + 1, width: MAP.width, height: MAP.height, pins: points.map(([, at]) => at) }).pins as { left: number; top: number }[];
      const xs = closer.map((p) => p.left);
      const ys = closer.map((p) => p.top);
      assert.ok(Math.max(...xs) - Math.min(...xs) > MAP.width - 2 * MAP.side || Math.max(...ys) - Math.min(...ys) > MAP.height - 2 * MAP.edge, `${told}: zoom ${zoom + 1} would not hold them`);
    }
  }
});
