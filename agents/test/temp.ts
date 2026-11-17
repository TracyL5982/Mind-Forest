import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';

/**
 * Temp folders for a test file. Each test file runs in a process of its own, so every folder made through here is removed when
 * that file's tests end. A folder made straight from `mkdtempSync` stays in the system's temp directory for good, and thousands did.
 */
const made: string[] = [];
after(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A new folder in the system's temp directory, named `<prefix><random>`, removed when the file's tests end. */
export function tempDir(prefix: string): string {
  made.push(mkdtempSync(join(tmpdir(), prefix)));
  return made.at(-1)!;
}
