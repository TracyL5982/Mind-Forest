/**
 * Rewrites the expected footprint of every sample in test/footprints.json from the web client's
 * `sizeOf()`, and for a sample whose item holds `data`, the chips it draws from `chipsOf()`. Run
 * it after a deliberate change to how a card is sized or its chips are cut, and read the diff.
 *
 * Run: node --no-warnings --import tsx scripts/footprints.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Sample = { type: string; item: Record<string, unknown>; props: Record<string, unknown>; size: number[]; chips?: string[] };
type Registry = { sizeOf: (node: unknown, item: unknown) => number[]; chipsOf: (node: unknown, item: unknown) => { text: string }[] };

const path = join(import.meta.dirname, '../test/footprints.json');
const { sizeOf, chipsOf } = (await import(new URL('../client/js/components/index.js', import.meta.url).href)) as Registry;
const file = JSON.parse(readFileSync(path, 'utf8')) as { about: string; samples: Sample[] };
let changed = 0;
for (const sample of file.samples) {
  const node = { view: { component: sample.type, props: sample.props } };
  const size = sizeOf(node, sample.item);
  const chips = 'data' in sample.item ? chipsOf(node, sample.item).map((chip) => chip.text) : undefined;
  if (JSON.stringify([size, chips]) !== JSON.stringify([sample.size, sample.chips])) changed += 1;
  sample.size = size;
  if (chips) sample.chips = chips;
}
const lines = file.samples.map((sample) => `    ${JSON.stringify(sample)}`).join(',\n');
writeFileSync(path, `{\n  "about": ${JSON.stringify(file.about)},\n  "samples": [\n${lines}\n  ]\n}\n`);
console.log(`${file.samples.length} samples, ${changed} changed`);
