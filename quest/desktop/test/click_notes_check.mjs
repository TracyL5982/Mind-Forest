// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs), with the mixer on and
// writing to a file (nothing is heard), and checks Kai's sound design on one of the service's trees: a press on each of
// five neighbouring cards of one layer sounds a different note, all of that layer's chord (synth.py's ladder,
// `chordNotes` in core/ocean/oceanmodel_sound.cpp).
// The cards are the first five round the root of the first tree with five, in their order. A press names each as the
// scene draws it (`-pickRef`): a piece of the headset's library as that piece (`film:3`), anything else as the
// service's card (`note:agent-<node id>`).
//
//   quest/desktop/build.sh && node quest/desktop/test/click_notes_check.mjs --data <data folder> [--shots <folder>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checker, flag, standIn, until } from './standin.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const workIndex = new Map(JSON.parse(readFileSync(join(repo, 'public/works/works.json'), 'utf8')).works.map((w) => [w.id, w.index]));

// The ladder's notes in each of the five chords, as oceanmodel_sound.cpp holds them: layer k plays chord k % 5.
const CHORDS = [[0, 1, 3, 6, 7, 10], [1, 2, 4, 7, 8, 11], [2, 5, 8, 9], [1, 3, 4, 7, 10, 11], [2, 4, 5, 8, 11]];

const stand = await standIn('click-notes-check', flag('--data'));
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();

const before = await stand.state();
const items = new Map(before.items.map((i) => [i.id, i]));
const childrenOf = (id) => before.nodes.filter((n) => n.parent === id).sort((a, b) => a.order - b.order);
/** How the scene names a card: a piece of the headset's library as that piece, anything else as the service's card. */
const refOf = (n) => {
  const [from, kind, key] = n.itemId.split(':');
  if (from !== 'library') return `note:agent-${n.id}`;
  return kind === 'work' ? `work:${workIndex.get(key)}` : `${kind}:${key}`;
};
const tree = before.trees.find((t) => childrenOf(t.rootId).length >= 5);
if (!tree) throw new Error('no tree here has five cards round its root');
const cards = childrenOf(tree.rootId).slice(0, 5);
console.log(`tree "${tree.title}": pressing ${cards.map((n) => `"${items.get(n.itemId).title}" (${refOf(n)})`).join(', ')}`);

const presses = [4, 5, 6, 7, 8];
const suffixes = ['', '2', '3', '4', '5'];
// Then a question picked under the last card opened: the service's cards come round it, as the gardener's do.
const askAt = 10;
const run = stand.launch(shots, 'click-notes', 15, [
  ...cards.flatMap((n, i) => [`-pickRef${suffixes[i]}`, refOf(n), `-pickAt${suffixes[i]}`, String(presses[i])]),
  '-askAt', String(askAt), '-ask', '1',
], { sound: true });
try {
  await until(run.log, /^\[agent\] connected/);
  // To the root: its cards are the layer that stands then. (A tree gone to as a tree stands on its deepest layer.)
  stand.inject({ t: 'navigate', treeId: tree.id, nodeId: tree.rootId, yours: true });
  await run.done;
} finally {
  writeFileSync(join(shots, 'click-notes.log'), run.log.map((l) => `${l.at.toFixed(2)} ${l.line}`).join('\n') + '\n');
  await stand.close();
}

// What each press sounded: the first card sound after its flag ran ("[ocean] -pickAt runs"), before the next press.
const ran = run.log.filter((l) => /^\[ocean\] -pickAt\d? runs$/.test(l.line));
const heard = ran.map((r, i) => {
  const until = ran[i + 1]?.at ?? Infinity;
  const sound = run.log.find((l) => l.at >= r.at && l.at < until && /^\[sound\] (take(_\d\d)?|note_\d\d)\b/.test(l.line));
  return sound ? sound.line.replace(/^\[sound\] /, '').split(' ')[0] : 'nothing';
});
console.log(`the five presses sounded: ${heard.join(', ')}`);
check(ran.length === 5, `five presses ran (${ran.length})`);
// A press is "take" moved to the card's own note (take_03 is take on note_03), so it still sounds like a press.
const notes = heard.filter((h) => /^take_\d\d$/.test(h)).map((h) => Number(h.slice(5)));
check(notes.length === 5 && new Set(notes).size === 5, `each press sounded take on a note of its own (${heard.join(', ')})`);
const chord = CHORDS.findIndex((c) => notes.length > 0 && notes.every((n) => c.includes(n)));
check(chord >= 0, `all of one layer's chord${chord >= 0 ? ` (chord ${chord}: ladder notes ${CHORDS[chord].join(' ')})` : ''}`);

// The service's cards brought by the question: one note each, their own, 90 ms apart, up the chord of the layer they come to.
const came = run.log.find((l) => /^\[agent\] \d+ new cards$/.test(l.line) && l.at >= (ran.at(-1)?.at ?? 0));
const count = came ? Number(came.line.match(/(\d+) new cards/)[1]) : 0;
const rung = came ? run.log.filter((l) => l.at >= came.at - 0.05 && l.at < came.at + 1 && /^\[sound\] note_\d\d\b/.test(l.line)).map((l) => l.line.replace(/^\[sound\] /, '')) : [];
const rang = rung.map((l) => l.split(' ')[0]);
const after = rung.map((l) => Number(l.match(/ in ([\d.]+) s/)?.[1] ?? 0));
check(came && rang.length === count && new Set(rang).size === Math.min(count, 6) && after.every((t, i) => i === 0 || t > after[i - 1] + 0.08),
  `the ${count} cards the service brought each sounded a note of their own, one after another (${rung.join(', ') || 'nothing'})`);
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
