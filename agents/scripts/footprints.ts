/**
 * Rewrites the expected footprint of every sample in test/footprints.json from the web client's `sizeOf()`. Run it after a
 * deliberate change to how a card is sized, and read the diff.
 *
 * Run: node --no-warnings --import tsx scripts/footprints.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Sample = { type: string; item: Record<string, unknown>; props: Record<string, unknown>; size: number[]; chips?: unknown };
type Registry = { sizeOf: (node: unknown, item: unknown) => number[] };

const path = join(import.meta.dirname, '../test/footprints.json');
const { sizeOf } = (await import(new URL('../client/js/components/index.js', import.meta.url).href)) as Registry;
const file = JSON.parse(readFileSync(path, 'utf8')) as { about: string; samples: Sample[] };
let changed = 0;
for (const sample of file.samples) {
  const size = sizeOf({ view: { component: sample.type, props: sample.props } }, sample.item);
  if (JSON.stringify(size) !== JSON.stringify(sample.size) || 'chips' in sample) changed += 1;
  sample.size = size;
  delete sample.chips;
}
const lines = file.samples.map((sample) => `    ${JSON.stringify(sample)}`).join(',\n');
writeFileSync(path, `{\n  "about": ${JSON.stringify(file.about)},\n  "samples": [\n${lines}\n  ]\n}\n`);
console.log(`${file.samples.length} samples, ${changed} changed`);
