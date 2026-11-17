// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and opens, where it stands,
// every card that hangs from the root of each tree, one preview each, its clock a frame at a time. Each time it checks,
// from where the cards are headed before the pinch and after (`-placesAt`, standin.mjs `room`), that:
//   - the open card grows where it stood;
//   - the other cards stay, or step straight out from it;
//   - none is left under it;
//   - no two cards overlap that did not before.
//
//   quest/desktop/build.sh && node quest/desktop/test/room_check.mjs --data <data folder> [--trees "<title>|<title>"] [--shots <folder>]
import { join } from 'node:path';
import { checker, find, flag, places, room, standIn, until } from './standin.mjs';

const stand = await standIn('room-check', flag('--data'));
const shots = flag('--shots', join(stand.work, 'shots'));
const { check, failed, summary } = checker();
let skipped = 0;
try {
  const before = await stand.state();
  const items = new Map(before.items.map((i) => [i.id, i]));
  const named = flag('--trees')?.split('|');
  const trees = before.trees.filter((t) => !named || named.includes(t.title));
  for (const tree of trees) {
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
