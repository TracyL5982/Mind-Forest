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
// With --demo as well, the stand-in runs the walkthrough demo on the data folder (which should hold its tree), so the tree
// reaches the preview the other way: the demo sets it up again round by round for the preview as it joins, each round's card
// opened where it stands before its cards arrive round it. The walk waits for that and then checks every layer as above.
// Then a second preview, set up the same way, is taken to the tree's first card and to the card of its last round, and on
// each layer, once it has settled, everything drawn is looked at along the eye's sight lines (`-depthAuditEvery`): no two
// surfaces of different things, one of them writing depth, may lie within 0.05 mm of each other, where the headset's depth
// buffer could not keep them apart. Every pair within 2 mm is printed. (The pieces of one card are stacked 0.3 mm and more
// apart on purpose; they are reported, not held to it.)
//
//   quest/desktop/build.sh && node quest/desktop/test/room_check.mjs --data <data folder> [--trees "<title>|<title>"] [--walk [--demo]] [--shots <folder>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, escape, find, flag, later, layer, places, room, standIn, until } from './standin.mjs';

const demo = process.argv.includes('--demo');
const stand = await standIn('room-check', flag('--data'), { demo });
// The demo's own account of setting the tree up for a preview that joined: done once it says where it is set up for.
const setUp = async () => {
  const said = () => readFileSync(join(stand.work, 'service.log'), 'utf8').split('\n');
  const from = said().length;
  for (let i = 0; i < 1800; i++) {
    const lines = said().slice(from - 1);
    const joined = lines.findIndex((l) => l.includes('[demo] a headset joined'));
    if (joined >= 0 && lines.slice(joined).some((l) => l.includes('[demo] set up for'))) return true;
    await later(0.1);
  }
  return false;
};
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();
let skipped = 0;
try {
  // (The demo makes its cards again, with new ids, each time it sets its tree up: the state is read again after that.)
  let before, items, trees;
  const named = flag('--trees')?.split('|');
  const read = async () => {
    before = await stand.state();
    items = new Map(before.items.map((i) => [i.id, i]));
    trees = before.trees.filter((t) => !named || named.includes(t.title));
  };
  await read();
  if (process.argv.includes('--walk')) {
    // How far the leading card may stand from the middle of its cards, as a share of their half spread.
    const MOST_OFF = 0.5;
    const run = stand.launch(shots, 'walk', 3600, ['-placesOnGo', '-shotEvery', '100000']);
    const ready = demo ? setUp() : null;
    await until(run.log, /^\[agent\] connected/);
    if (ready) {
      check(await ready, 'the demo set its tree up again for the preview, round by round');
      await read();
    }
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
    run.stop();
  }
  if (process.argv.includes('--walk') && demo) {
    // Two surfaces nearer than this along the eye's sight can fight over which shows. The headset's depth buffer is 24 bits
    // from 5 cm to 60 m, which tells apart about 3 µm at 1.5 m and 11 µm at 3 m; this leaves a margin of 5 to 15 times that.
    // (The audit lists every pair within 2 mm all the same.)
    const FIGHT_MM = 0.05;
    const run = stand.launch(shots, 'depth', 3600, ['-depthAuditEvery', '3', '-shotEvery', '100000']);
    const ready = setUp();
    await until(run.log, /^\[agent\] connected/);
    await ready;
    await read();
    const walkthrough = trees.find((t) => /headset/.test(t.title)) ?? trees[0];
    const own = before.nodes.filter((n) => n.treeId === walkthrough.id);
    // The last round's cards are the newest; the card they hang from is where the walkthrough ends.
    const last = own.filter((n) => n.parent).at(-1);
    for (const [where, node] of [['its first card', own.find((n) => !n.parent)], ['the card of its last round', own.find((n) => n.id === last.parent)]]) {
      stand.inject({ t: 'navigate', treeId: walkthrough.id, nodeId: node.id, yours: true });
      const went = await until(run.log, new RegExp(`^\\[agent\\] went to .*\\(${escape(node.id)}\\)`), run.at() - 0.5, 20);
      // The first look that starts once the layer has settled (2.5 s), to its end.
      const start = went && (await until(run.log, /^\[ocean\] depth: of /, went.at + 2.5, 20));
      const done = start && (await until(run.log, /^\[ocean\] depth: done$/, start.at, 20));
      const said = start && done ? run.log.slice(run.log.indexOf(start), run.log.indexOf(done) + 1).map((l) => l.line) : [];
      const near = said.map((l) => /^\[ocean\] depth: (.*): (\d+) sight lines, closest ([\d.]+) mm$/.exec(l)).filter(Boolean).filter((m) => m[1] !== 'within one card' && Number(m[3]) < FIGHT_MM);
      for (const l of said) console.log(`     ${l}`);
      check(said.length > 0 && near.length === 0, `"${walkthrough.title}", ${where}: nothing drawn within ${FIGHT_MM} mm of anything else along the eye's sight (${near.map((m) => `${m[1]} at ${m[3]} mm`).join('; ') || 'none'})`);
    }
    writeFileSync(join(shots, 'log-depth.txt'), run.log.map((l) => `${l.at.toFixed(2).padStart(7)} ${l.line}`).join('\n'));
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
