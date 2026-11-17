// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and checks that a piece of
// the ocean brought in becomes the service's, like every other card and tree, with Momo there. Two launches:
// A. With no tree standing:
//   1. bringing an ocean film in asks Momo for a tree about it, as the user would by voice
//   2. the service makes that tree, rooted on the film's own library item
//   3. the preview goes to it
// B. With one of the service's trees standing (the first on the desk):
//   4. bringing in a film no tree holds sends it to the service, and Kai's own card is not made
//   5. the service holds it on that tree, kept and the user's, under the card the preview named
//   6. its look is the service's: the card drawn in progress has been composed
//   7. the preview draws it as one of the tree's cards
// C. With that tree standing again:
//   8. pinched, the card opens with Momo's rows, not Kai's three questions
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
const voice = ['-agentVoice', 'on', '-wakeClip', silence(join(stand.work, 'silence.wav'))];
const logged = (run, name) => writeFileSync(join(shots, `${name}.log`), run.log.map((l) => `${l.at.toFixed(1)} ${l.line}`).join('\n') + '\n');

try {
  // A. No tree standing.
  const before = await stand.state();
  const [peekAt, bringAt, end] = [3, 5, 16];
  const run = stand.launch(shots, 'ocean-tree', end, [...voice, '-peekFilm', String(film), '-peekAt', String(peekAt), '-bringAt', String(bringAt)]);
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
    logged(run, 'ocean-tree');
  }

  // B. One of the service's trees standing: a film that no tree holds yet is brought into it.
  const held = await stand.state();
  const piece = [...Array(100).keys()].find((k) => k !== film && !held.nodes.some((n) => n.itemId === `library:film:${k}`));
  const [peekAt2, bringAt2, end2] = [4, 6, 14];
  const into = stand.launch(shots, 'into-tree', end2, [...voice, '-saved', '0', '-peekFilm', String(piece), '-peekAt', String(peekAt2), '-bringAt', String(bringAt2)]);
  try {
    const peeked = await until(into.log, /^\[ocean\] peek: /, 0, end2);
    const title = peeked ? peeked.line.replace(/^\[ocean\] peek: /, '') : '';
    await into.done;
    const added = find(into.log, new RegExp(`^\\[agent\\] added .* \\(library:film:${piece}\\) to "(.*)" under (\\S+)$`));
    const sent = into.sent('commands').flatMap((m) => m.commands).filter((c) => c.type === 'addNode' && c.node.itemId === `library:film:${piece}`);
    check(added && sent.length === 1 && !find(into.log, /^\[ocean\] brought in: /),
      `bringing film ${piece}${title ? `, "${title}",` : ''} into the standing tree sent it to the service (${sent.length} addNode), and no card of Kai's was made`);
    const after = await stand.state();
    const node = after.nodes.find((n) => n.itemId === `library:film:${piece}`);
    const parent = added ? added.line.match(/ under (\S+)$/)[1] : '';
    const tree = node && after.trees.find((t) => t.id === node.treeId);
    check(node && held.trees.some((t) => t.id === node.treeId) && node.parent === parent && node.status === 'kept' && node.origin.by === 'user',
      `the service holds it on "${tree?.title ?? '?'}", which stood, under ${parent || '?'}, kept and the user's (${node ? `${node.status}, ${node.origin.by}, under ${node.parent}` : 'no such card'})`);
    check(node && !node.view.composing, `its look is the service's (${node ? `${node.view.component}, by ${node.view.by}${node.view.composing ? ', still composing' : ''}` : 'no card'})`);
    const drawn = added && find(into.log, /^\[agent\] \d+ new cards?$/, added.at);
    check(drawn, "the preview drew it among the tree's cards");
    logged(into, 'into-tree');

    // C. Its tree stood again and the card pinched: it opens with Momo's rows, not Kai's three questions. (A card of the
    // headset's library is drawn as that piece, so the pinch names it as one: `film:<n>`.)
    if (node) {
      const opened = stand.launch(shots, 'opened', 10, [...voice, '-pickRef', `film:${piece}`, '-pickAt', '5']);
      try {
        await until(opened.log, /^\[agent\] connected/);
        stand.inject({ t: 'navigate', treeId: node.treeId, yours: true });
        await opened.done;
        const pills = find(opened.log, new RegExp(`^\\[cards\\] \\d+ pills under ${escape(title)}: `));
        check(pills && /Type your own question/.test(pills.line) && !/What came before it\?/.test(pills.line), `pinched, it opens with Momo's rows (${pills?.line.replace(/^\[cards\] /, '') ?? 'no pills'})`);
      } finally {
        logged(opened, 'opened');
      }
    }
  } catch (err) {
    logged(into, 'into-tree');
    throw err;
  }
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
