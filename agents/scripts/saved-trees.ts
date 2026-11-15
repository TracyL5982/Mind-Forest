/**
 * Writes src/node/library-saved.json: the headset's saved trees as the Quest app's own code replays them.
 * The steps of a saved tree hang wherever the app's gardener had offered them, which only its code knows, so the import reads this file.
 * Run it after ocean.json's saved trees change. Needs clang++ (the Mac's command-line tools).
 * Usage: npm run saved-trees
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const agents = resolve(import.meta.dirname, '..');
const repo = resolve(agents, '..');
const core = join(repo, 'quest/core');
const build = mkdtempSync(join(tmpdir(), 'saved-trees-'));
try {
  const program = join(build, 'saved-trees');
  const sources = ['ocean/tree.cpp', 'ocean/catalog.cpp', 'ocean/library.cpp', 'base.cpp', 'json.cpp'].map((f) => join(core, f));
  execFileSync('clang++', ['-std=c++20', '-O1', `-I${core}`, join(agents, 'scripts/saved-trees.cpp'), ...sources, '-o', program], { stdio: 'inherit' });
  const out = join(agents, 'src/node/library-saved.json');
  writeFileSync(out, execFileSync(program, [repo], { encoding: 'utf8' }));
  console.log(`wrote ${out}`);
} finally {
  rmSync(build, { recursive: true, force: true });
}
