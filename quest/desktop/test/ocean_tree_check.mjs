// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and checks that a tree
// made from an ocean item is the service's, like every other tree, with Momo there:
//   1. bringing an ocean film in with no tree standing asks Momo for a tree about it, as the user would by voice
//   2. the service makes that tree, rooted on the film's own library item
//   3. the preview goes to it
// The voice is on, muted, and hears a silent clip in place of the microphone, so Momo shows and nothing is heard.
//
//   quest/desktop/build.sh && node quest/desktop/test/ocean_tree_check.mjs --data <data folder> [--shots <folder>] [--film <index>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, escape, find, flag, standIn, until } from './standin.mjs';

const stand = await standIn('ocean-tree-check', flag('--data'));
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const film = Number(flag('--film', '0'));
const { check, failed, summary } = checker();

/** Two seconds of 16 kHz mono silence, heard in place of the microphone. */
function silence(path) {
  const bytes = 16000 * 2 * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(bytes, 40);
  writeFileSync(path, wav);
  return path;
}

const before = await stand.state();
const [peekAt, bringAt, end] = [3, 5, 16];
const run = stand.launch(shots, 'ocean-tree', end, [
  '-agentVoice', 'on', '-wakeClip', silence(join(stand.work, 'silence.wav')),
  '-peekFilm', String(film), '-peekAt', String(peekAt), '-bringAt', String(bringAt),
]);
try {
  const peeked = await until(run.log, /^\[ocean\] peek: /, 0, end);
  const title = peeked ? peeked.line.replace(/^\[ocean\] peek: /, '') : '';
  check(peeked, `the preview peeked at film ${film}${title ? `, "${title}"` : ''}`);
  await run.done;
  const utters = run.sent('utter');
  check(utters.some((u) => u.final && /tree about/i.test(u.text)), `bringing it in asked Momo for a tree about it (sent: ${utters.map((u) => JSON.stringify(u.text)).join(', ') || 'nothing'})`);
  const after = await stand.state();
  const rootOf = (t) => after.nodes.find((n) => n.id === t.rootId);
  const made = after.trees.filter((t) => !before.trees.some((b) => b.id === t.id));
  const rooted = made.find((t) => rootOf(t)?.itemId === `library:film:${film}`);
  check(rooted, `the service made a tree rooted on library:film:${film} (new: ${made.map((t) => `"${t.title}" on ${rootOf(t)?.itemId}`).join(', ') || 'none'})`);
  check(rooted && find(run.log, new RegExp(`^\\[agent\\] (navigate to tree ${escape(rooted.id)}|went to .* in "${escape(rooted.title)}")`)), "the preview went to the service's tree");
} finally {
  writeFileSync(join(shots, 'ocean-tree.log'), run.log.map((l) => `${l.at.toFixed(1)} ${l.line}`).join('\n') + '\n');
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
