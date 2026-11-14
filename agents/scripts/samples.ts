/**
 * Rewrites client/library-samples.js from `SAMPLES` and `SHEETS` in src/core/samples.ts, so the
 * library page draws each structured card type from the item and the props the Renderer's rules
 * give it, and each sample sheet as the service holds it. Run it
 * after a change to the samples or to a rule, and read the diff. `npm test` fails when the file is
 * out of date.
 *
 * Run: node --no-warnings --import tsx scripts/samples.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES, SHEETS } from '../src/core/samples.ts';

export const SAMPLES_PATH = join(import.meta.dirname, '../client/library-samples.js');

export const samplesFile = (): string =>
  `/** Written by scripts/samples.ts from src/core/samples.ts. Do not edit. */\nexport const SAMPLES = ${JSON.stringify(SAMPLES, null, 2)};\n\nexport const SHEETS = ${JSON.stringify(SHEETS, null, 2)};\n`;

if (import.meta.filename === process.argv[1]) {
  writeFileSync(SAMPLES_PATH, samplesFile());
  console.log(`${Object.keys(SAMPLES).length} samples written`);
}
