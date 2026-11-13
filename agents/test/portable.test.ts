import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

test('the agent core uses nothing that only Node has, so it can move onto a headset', () => {
  const core = join(import.meta.dirname, '../src/core');
  const offenders: string[] = [];
  for (const file of files(core)) {
    const source = readFileSync(file, 'utf8');
    if (/from\s+['"]node:|require\(|\bprocess\.|\bBuffer\b|__dirname|from\s+['"](fs|path|os|crypto|http|ws)['"]/.test(source)) {
      offenders.push(file.slice(core.length + 1));
    }
  }
  assert.deepEqual(offenders, []);
});
