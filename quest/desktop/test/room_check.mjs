// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and opens, where it stands,
// every card that hangs from the root of each tree, one preview each, its clock a frame at a time. Each time it checks,
// from where the cards are headed before the pinch and after (`-placesAt`, standin.mjs `room`), that:
//   - the open card grows where it stood;
//   - the other cards stay, or step straight out from it;
//   - none is left under it;
//   - no two cards overlap that did not before.
//
// With --walk it stands instead, in one preview, every layer of each tree, as the demo stands a tree that arrives whole: for each
// card with cards under it, it takes the preview to one of them. Then it goes to each such card, which opens leading its layer,
// and checks that layer (standin.mjs `layer`):
//   - the card that leads it stands in the middle of its cards, not off to one side of them;
//   - no two cards on it overlap;
//   - no two of its groups overlap, so no two panes lie over each other at one depth.
//
//   quest/desktop/build.sh && node quest/desktop/test/room_check.mjs --data <data folder> [--trees "<title>|<title>"] [--walk] [--shots <folder>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, escape, find, flag, later, layer, places, room, standIn, until } from './standin.mjs';

const stand = await standIn('room-check', flag('--data'));
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();
let skipped = 0;
try {
  const before = await stand.state();
  const items = new Map(before.items.map((i) => [i.id, i]));
  const named = flag('--trees')?.split('|');
  const trees = before.trees.filter((t) => !named || named.includes(t.title));
  if (process.argv.includes('--walk')) {
    // How far the leading card may stand from the middle of its cards, as a share of their half spread.
    const MOST_OFF = 0.5;
    const run = stand.launch(shots, 'walk', 3600, ['-placesOnGo', '-shotEvery', '100000']);
    await until(run.log, /^\[agent\] connected/);
    for (const tree of trees) {
      // Nearest the root first, so a card is stood before the cards under it.
      const depth = (n) => (n.parent ? 1 + depth(before.nodes.find((p) => p.id === n.parent)) : 0);
      const leads = before.nodes.filter((n) => n.treeId === tree.id && before.nodes.some((c) => c.parent === n.id)).sort((a, b) => depth(a) - depth(b));
      const go = async (node) => {
        const from = run.log.length;
        stand.inject({ t: 'navigate', treeId: tree.id, nodeId: node.id, yours: true });
        const went = await until(run.log, new RegExp(`^\\[agent\\] went to .*\\(${escape(node.id)}\\)`), run.log[from - 1]?.at ?? 0, 20);
        // (Its places follow it, the last line saying how many.)
        const at = run.log.indexOf(went);
        for (let i = 0; went && i < 100 && !run.log.slice(at).some((l) => /^\[ocean\] places: \d+$/.test(l.line)); i++) await later(0.1);
        return went;
      };
      // Every layer stood first, as the demo stands a whole tree: a card leads its layer once the headset is taken to a card
      // under it.
      for (const head of leads) if (head.parent) await go(before.nodes.find((c) => c.parent === head.id));
      for (const head of leads) {
        // Then each layer gone to, its first card open there, as the demo leaves a round's card.
        const went = await go(head);
        const title = items.get(head.itemId).title;
        const made = layer(went ? places(run.log, '', run.log.indexOf(went)) : []);
        const trouble = [
          !went && 'not gone to',
          went && !made.head && 'it is not open on the layer',
          made.off > MOST_OFF && `it stands ${made.off.toFixed(2)} of the way out of its ${made.own.length} cards`,
          ...made.crowded.map((pair) => `${pair} overlap`),
          ...made.panes.map((pair) => `groups ${pair} overlap`),
        ].filter(Boolean);
        check(trouble.length === 0, `"${tree.title}": the layer of "${title}", ${made.own.length} cards round it, off ${made.off.toFixed(2)}, ${made.groups} groups (${trouble.join('; ') || 'clear'})`);
      }
    }
    writeFileSync(join(shots, 'log-walk.txt'), run.log.map((l) => `${l.at.toFixed(2).padStart(7)} ${l.line}`).join('\n'));
  }
  for (const tree of process.argv.includes('--walk') ? [] : trees) {
    for (const card of before.nodes.filter((n) => n.parent === tree.rootId)) {
      // The headset names a card by its library piece when it is one; a work of the library is not named by flag here.
      const library = items.get(card.itemId)?.source?.from === 'library' ? items.get(card.itemId).data?.library : null;
      if (library && library.kind !== 'film') {
        skipped++;
        continue;
      }
      const ref = library ? `film:${library.key}` : `note:agent-${card.id}`;
      const run = stand.launch(shots, `room-${card.id.slice(0, 8)}`, 10.5,
        ['-placesAt', '7', '-pickRef', ref, '-pickAt', '8', '-placesAgainAt', '10', '-shotEvery', '100'], { realtime: false });
      await until(run.log, /^\[agent\] connected/);
      stand.inject({ t: 'navigate', treeId: tree.id, yours: true });
      await run.done;
      const made = room(places(run.log, 'placesAt'), places(run.log, 'placesAgainAt'));
      const trouble = [
        !find(run.log, /^\[agent\] opened /) && 'not opened where it stands',
        !made.open && 'no card opened',
        made.openMoved >= 0.005 && `it moved ${made.openMoved.toFixed(3)} m`,
        ...made.inward.map((p) => `"${p.title}" moved towards it`),
        ...made.under.map((p) => `"${p.title}" is under it`),
        ...made.crowded.map((pair) => `${pair} overlap`),
      ].filter(Boolean);
      check(trouble.length === 0, `"${tree.title}": "${items.get(card.itemId).title}" opens, ${made.moved.length} step out (${trouble.join('; ') || 'clear'})`);
    }
  }
} finally {
  await stand.close();
}
if (skipped) console.log(`${skipped} works of the library left out: a flag names them by their place in the catalog`);
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
