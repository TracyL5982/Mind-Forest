import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cardsOf, collapse, LIMITS, measure, parseFlat, place, type Box, type Flat, type Rect } from '../src/core/layout.ts';
import { BUILT, built } from '../scripts/layout-js.ts';

const { textWidth } = (await import(new URL('../client/js/components/shared.js', import.meta.url).href)) as { textWidth: (text: string) => number };
const SIZES = (JSON.parse(readFileSync(new URL('./footprints.json', import.meta.url), 'utf8')) as { samples: { size: [number, number] }[] }).samples.map((sample) => sample.size);

const box = (id: string, parent: string, kind: Flat['kind'] = 'row', label = '', join: Flat['join'] = 'none'): Flat => ({ id, parent, kind, role: 'normal', label, join });
const card = (id: string, parent: string, role: Flat['role'] = 'normal'): Flat => ({ id, parent, kind: 'card', role, label: '', join: 'none' });
const members = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);
const why = (parts: Flat[], allowed = members(13)) => {
  const parsed = parseFlat(parts, new Set(allowed));
  return 'why' in parsed ? parsed.why : 'accepted';
};

test('parseFlat refuses a loop, a missing parent, depth past four, too many members or containers, and a stranger', () => {
  const three = (parent: string) => members(3).map((id) => card(id, parent));
  assert.match(why([box('a', ''), box('b', 'c'), box('c', 'b'), ...three('a')]), /loop/);
  assert.match(why([box('a', ''), ...three('a'), card('m3', 'nowhere')]), /not there/);
  assert.match(why([box('a', ''), box('b', 'a'), box('c', 'b'), box('d', 'c'), box('e', 'd'), ...three('e')]), /5 containers deep/);
  assert.equal(why([box('a', ''), box('b', 'a'), box('c', 'b'), box('d', 'c'), ...three('d')]), 'accepted', 'four deep is allowed');
  assert.match(why([box('a', ''), ...members(13).map((id) => card(id, 'a'))]), /13 members/);
  assert.match(why([box('a', ''), ...Array.from({ length: 8 }, (_, i) => box(`b${i}`, 'a')), ...three('b0')]), /9 containers/);
  assert.match(why([box('a', ''), ...three('a'), card('m9', 'a')], members(3)), /not one of the siblings/);
  assert.match(why([box('a', ''), card('m0', 'a'), card('m1', 'a')]), /fewer than 3/);
  assert.match(why([box('a', ''), box('b', ''), ...three('a')]), /outermost/);
});

test('a container that holds one part and no label gives way to that part, and a labelled one stays', () => {
  const parsed = parseFlat([box('outer', '', 'row', 'Day one'), box('x', 'outer', 'column'), box('y', 'x', 'grid'), box('z', 'y'), card('m0', 'z'), card('m1', 'outer'), card('m2', 'outer')], new Set(members(3)));
  assert.ok('tree' in parsed);
  assert.deepEqual(collapse(parsed.tree), { kind: 'row', label: 'Day one', children: [{ kind: 'card', id: 'm0', role: 'normal' }, { kind: 'card', id: 'm1', role: 'normal' }, { kind: 'card', id: 'm2', role: 'normal' }] });
});

test('a lead has the first line of a row to itself and a minor comes last', () => {
  const parsed = parseFlat([box('r', ''), card('m0', 'r', 'minor'), card('m1', 'r'), card('m2', 'r', 'lead'), card('m3', 'r')], new Set(members(4)));
  assert.ok('tree' in parsed);
  assert.deepEqual(cardsOf(parsed.tree), ['m2', 'm1', 'm3', 'm0']);
  const at = place(measure(parsed.tree, () => [240, 100], textWidth)).cards;
  assert.equal(at.get('m2')!.y, 0);
  assert.ok([at.get('m1')!, at.get('m3')!, at.get('m0')!].every((r) => r.y >= 112), 'the others sit under the lead');
  assert.ok(at.get('m0')!.x > at.get('m3')!.x, 'the minor is last on its line');
});

/** A structure as a model might write it: up to twelve members in up to eight containers four deep, of random kinds, labels, joins and roles. */
function generate(random: () => number): { parts: Flat[]; ids: string[] } {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const LABELS = ['Food', 'Before the move', '早上', 'What it costs', 'Day two', 'Sources and further reading', '附近的咖啡馆'];
  const boxes = [{ id: 'b0', depth: 1 }];
  const parts: Flat[] = [box('b0', '', pick(['row', 'column', 'grid']), random() < 0.3 ? pick(LABELS) : '', pick(['none', 'arrow', 'line']))];
  const count = 1 + Math.floor(random() * LIMITS.boxes);
  while (boxes.length < count) {
    const parent = pick(boxes.filter((b) => b.depth < LIMITS.depth));
    const id = `b${boxes.length}`;
    boxes.push({ id, depth: parent.depth + 1 });
    parts.push(box(id, parent.id, pick(['row', 'column', 'grid']), random() < 0.4 ? pick(LABELS) : '', pick(['none', 'none', 'arrow', 'line'])));
  }
  const ids = members(LIMITS.least + Math.floor(random() * (LIMITS.cards - LIMITS.least + 1)));
  for (const id of ids) parts.push(card(id, pick(boxes).id, pick(['normal', 'normal', 'normal', 'lead', 'minor'])));
  return { parts, ids };
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;

test('five thousand structures place every card inside the block, none over another, and no arrow or label over a card', () => {
  let seed = 20261114;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let n = 0; n < 5000; n++) {
    const { parts, ids } = generate(random);
    const parsed = parseFlat(parts, new Set(ids));
    assert.ok('tree' in parsed, `structure ${n} is refused: ${'why' in parsed && parsed.why}`);
    const sizes = new Map(ids.map((id) => [id, SIZES[Math.floor(random() * SIZES.length)]!]));
    const tree: Box = collapse(parsed.tree);
    const placed = place(measure(tree, (id) => sizes.get(id)!, textWidth));
    const cards = [...placed.cards.values()];
    assert.deepEqual([...placed.cards.keys()].sort(), [...ids].sort(), `structure ${n} places every member once`);
    for (const [i, a] of cards.entries()) {
      assert.ok(inside(a, placed.w, placed.h), `structure ${n}: a card leaves the block`);
      for (const b of cards.slice(i + 1)) assert.ok(!overlap(a, b), `structure ${n}: two cards overlap`);
    }
    for (const mark of placed.marks) {
      assert.ok(inside(mark.at, placed.w, placed.h), `structure ${n}: a ${mark.kind} leaves the block`);
      if (mark.kind !== 'frame') assert.ok(cards.every((c) => !overlap(mark.at, c)), `structure ${n}: a ${mark.kind} lies over a card`);
    }
  }
});

test('the web client places cards with the built copy of layout.ts', () => {
  assert.equal(readFileSync(BUILT, 'utf8'), built(), 'run scripts/layout-js.ts');
});
