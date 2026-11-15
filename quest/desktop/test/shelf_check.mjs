// Runs the Mac preview twice against the fake service on a fresh copy of a data folder (standin.mjs), and checks from
// the preview's log, what it sends, the files it writes and the service's state that the service's trees keep the
// shelf's rules:
//   launch 1   nothing stands, every tree hangs as a cover; one cover is carried along the shelf
//   launch 2   each cover hangs where it hung, the carried one where it was put; a navigate to a tree on the shelf
//              unfolds it; a tree asked for by another client only hangs, and not at the standing tree's place; a tree
//              asked for from the preview (-agentType) presses the standing one back to its place and stands; a tree
//              deleted at the service drops its spot; a question row picked three times while its search runs is asked once
// The headset's own shelf file, seeded before the first launch, must be left as it was.
//
//   quest/desktop/build.sh && node quest/desktop/test/shelf_check.mjs --data <data folder> [--shots <folder>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, escape, find, flag, later, standIn, until } from './standin.mjs';

const stand = await standIn('shelf-check', flag('--data'));
const { previewData, token, servicePort, state, inject, WebSocket } = stand;
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();
const ownShelf = JSON.stringify({ version: 3, films: 0, trees: [], seeded: 'the headset keeps its own trees here' });
writeFileSync(join(previewData, 'ocean-shelf.json'), ownShelf);
const before = await state();
const newestFirst = [...before.trees].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
const spotsFile = join(previewData, 'agent-shelf.json');
const readSpots = () => (existsSync(spotsFile) ? JSON.parse(readFileSync(spotsFile, 'utf8')).services[stand.serviceAddress] ?? {} : {});
const launch = (name, seconds, extra) => stand.launch(shots, name, seconds, extra);

try {
  // Launch 1.
  const first = launch('launch1', 14, ['-carryAt', '8', '-carry', '0', '-carryRight', '0.1', '-carryUp', '0.05']);
  await first.done;
  const joined = find(first.log, /^\[agent\] connected: (\d+) trees/);
  check(joined && Number(/(\d+) trees/.exec(joined.line)[1]) === before.trees.length, `launch 1 joined the service and its ${before.trees.length} trees (${joined?.line})`);
  check(!find(first.log, /^\[agent\] went to |was asked for here|^\[ocean\] put away/), 'launch 1: nothing stands');
  const carried = find(first.log, /^\[ocean\] carrying the cover of (.*) by flag$/);
  const carriedTitle = carried && /cover of (.*) by flag$/.exec(carried.line)[1];
  check(carriedTitle === newestFirst[0].title, `the first cover on the shelf is the newest tree, "${newestFirst[0].title}" (carried: "${carriedTitle}")`);
  const spots1 = readSpots();
  check(before.trees.every((t) => spots1[t.id]), `every tree's spot is written down (${Object.keys(spots1).length} of ${before.trees.length})`);
  // OceanModel::shelfSpots, in the order freeSpot tries them.
  const usual = [[-39, 24], [-13, 24], [13, 24], [39, 24], [-64, 22], [64, 22], [-26, 37], [0, 37], [26, 37]].map(String);
  const carriedSpot = spots1[newestFirst[0].id];
  check(carriedSpot && !usual.includes(String(carriedSpot)), `the carried cover is kept where it was put, not at a usual place (${carriedSpot})`);
  const places = newestFirst.slice(1).map((t) => ({ t, k: usual.indexOf(String(spots1[t.id])) }));
  const inOrder = places.every((p, i) => p.k >= 1 && (i === 0 || p.k > places[i - 1].k || p.t.createdAt === places[i - 1].t.createdAt));
  check(inOrder && new Set(places.map((p) => p.k)).size === places.length, `the others hang at the usual places from the second on, a newer tree at an earlier one (${places.map((p) => `${p.t.title}: ${spots1[p.t.id]}`).join(' | ')})`);

  // Launch 2.
  const gone = newestFirst[newestFirst.length - 1];
  const goTo = newestFirst[1];
  const second = launch('launch2', 40, ['-agentType', 'start%20a%20tree%20about%20dolly%20zooms', '-agentTypeAt', '20', '-askAt', '12', '-ask', '0', '-askTimes', '3']);
  const joined2 = await until(second.log, /^\[agent\] connected/);
  await later(4);
  const navigated = second.at();
  inject({ t: 'navigate', treeId: goTo.id, yours: true });
  const wentTo = await until(second.log, new RegExp(`^\\[agent\\] went to .* in "${escape(goTo.title)}"`), navigated);
  await later(2);
  const elsewhere = new WebSocket(`ws://127.0.0.1:${servicePort}/ws?token=${token}`);
  await new Promise((r) => elsewhere.on('open', r));
  const dumped = second.at();
  elsewhere.send(JSON.stringify({ t: 'dump', dumps: [{ kind: 'text', text: 'Start a tree on this: the long take in Children of Men' }] }));
  const asked = await until(second.log, /^\[agent\] "(.*)" was asked for here, so it stands$/, dumped);
  await later(3);
  const deleted = second.at();
  elsewhere.send(JSON.stringify({ t: 'commands', label: 'Delete a tree', commands: [{ type: 'deleteTree', id: gone.id }] }));
  await second.done;
  elsewhere.close();

  const stood = find(second.log, /^\[agent\] went to |was asked for here|^\[ocean\] put away/);
  check(joined2 && (!stood || stood.at >= navigated), `launch 2: nothing stands until a navigate comes (first stand at ${stood?.at.toFixed(1)} s, navigate at ${navigated.toFixed(1)} s)`);
  check(wentTo && wentTo.at - navigated < 4, `a navigate to "${goTo.title}" on the shelf unfolds it (${wentTo ? (wentTo.at - navigated).toFixed(1) + ' s' : 'never'})`);
  const meanwhile = second.log.filter((l) => l.at >= dumped && l.at < (asked?.at ?? 999));
  check(find(meanwhile, /^\[agent\] tree ".*long take.*": \d+ cards/i), 'the tree asked for by another client reaches the preview');
  check(!find(meanwhile, /was asked for here|^\[ocean\] put away/), `and only hangs: "${goTo.title}" stays up, nothing is pressed for it`);
  const leftBe = find(meanwhile, /^\[agent\] navigate to .* was asked for elsewhere, so the view stays$/);
  check(leftBe, `the navigate that ends the other client's first round leaves the headset where it is (${leftBe?.line ?? 'none came'})`);
  check(asked && /dolly zoom/i.test(asked.line), `the tree typed for on the preview stands (${asked?.line})`);
  const putAway = find(second.log, new RegExp(`^\\[ocean\\] put away: ${escape(goTo.title)}$`), asked?.at ?? 999);
  check(putAway && putAway.at - asked.at < 1, `and "${goTo.title}" pressed itself onto the shelf first (${putAway ? (putAway.at - asked.at).toFixed(2) + ' s after' : 'never'})`);
  check(find(second.log, new RegExp(`^\\[agent\\] tree "${escape(gone.title)}" was deleted at the service`), deleted), `"${gone.title}" was deleted at the service`);
  const asks = second.sent('ask');
  const refused = second.log.filter((l) => /^\[agent\] still asking, so not again: /.test(l.line));
  check(asks.length === 1 && refused.length === 2, `a row picked three times in 0.8 s while its search runs is asked once (${asks.length} sent, ${refused.length} held back: "${asks[0]?.need}")`);

  const spots2 = readSpots();
  const after = await state();
  check(String(spots2[newestFirst[0].id]) === String(carriedSpot), `the carried cover hung where it was put, across the restart (${spots2[newestFirst[0].id]})`);
  check(String(spots2[goTo.id]) === String(spots1[goTo.id]), `"${goTo.title}" went back to its own place (${spots2[goTo.id]})`);
  check(!(gone.id in spots2), `the deleted tree's spot is dropped (${Object.keys(spots2).length} spots)`);
  const longTake = after.trees.find((t) => /long take/i.test(t.title));
  check(longTake && spots2[longTake.id] && !Object.entries(spots2).some(([id, s]) => id !== longTake.id && String(s) === String(spots2[longTake.id])), `the other client's tree hangs at a place of its own (${longTake && spots2[longTake.id]})`);
  check(readFileSync(join(previewData, 'ocean-shelf.json'), 'utf8') === ownShelf, "the headset's own shelf file is as it was");
  writeFileSync(join(shots, 'log-launch1.txt'), first.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
  writeFileSync(join(shots, 'log-launch2.txt'), second.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
  writeFileSync(join(shots, 'spots.json'), JSON.stringify({ launch1: spots1, launch2: spots2, trees: after.trees.map((t) => ({ id: t.id, title: t.title, createdAt: t.createdAt })) }, null, 2));
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
