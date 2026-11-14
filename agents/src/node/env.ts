import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Keys live outside the repo. `MIND_PALACE_ENV` names the file; the default is ~/.muse-garden.env.
 * Real environment variables win over the file.
 */
export function loadEnv(): Record<string, string | undefined> {
  const path = process.env.MIND_PALACE_ENV ?? join(homedir(), '.muse-garden.env');
  const fromFile: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      fromFile[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // No file: run on real environment variables alone.
  }
  return { ...fromFile, ...process.env };
}
