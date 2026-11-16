// Runs the Mac preview twice against the fake service on a fresh copy of a data folder (standin.mjs), and checks from
// the preview's log, what it sends, the files it writes and the service's state that the service's trees keep the
// forest's rules:
//   launch 1   nothing stands, every tree is put away on the desk, the newest first, each at a free place of its own;
//              one tree is carried over the desk to another place
//   launch 2   each tree stands where it stood, the carried one where it was put; a navigate to a tree on the desk
//              unfolds it; a tree asked for by another client is only put away, at a place of its own; a tree asked
//              for from the preview (-agentType) puts the standing one back at its place and stands; a tree deleted at
//              the service drops its place; a question row picked three times while its search runs is asked once
// The places are kept in agent-shelf.json (version 2, a plot on the desk for each tree), and the headset's own shelf
// file, seeded before the first launch, must be left as it was.
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
const plotsFile = join(previewData, 'agent-shelf.json');
const readPlots = () => {
  const file = existsSync(plotsFile) ? JSON.parse(readFileSync(plotsFile, 'utf8')) : {};
  return file.version === 2 ? file.services?.[stand.serviceAddress] ?? {} : {};
};
const near = (a, b) => Boolean(a && b) && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.002;
const show = (p) => (p ? `${p[0].toFixed(2)}, ${p[1].toFixed(2)}` : 'none');
// Where the preview says it put each tree on the desk, in the order it did.
const placed = (log, after = 0) =>
  log.filter((l) => l.at >= after).map((l) => /^\[ocean\] on the desk: (.*) at (-?[\d.]+), (-?[\d.]+), (its own place|a free place)$/.exec(l.line)).filter(Boolean)
    .map((m) => ({ title: m[1], plot: [Number(m[2]), Number(m[3])], own: m[4] === 'its own place' }));
const launch = (name, seconds, extra) => stand.launch(shots, name, seconds, extra);

try {
  // Launch 1.
  const first = launch('launch1', 14, ['-carryAt', '8', '-carry', '0', '-carryRight', '0.3', '-carryUp', '0.05']);
  await first.done;
  const joined = find(first.log, /^\[agent\] connected: (\d+) trees/);
  check(joined && Number(/(\d+) trees/.exec(joined.line)[1]) === before.trees.length, `launch 1 joined the service and its ${before.trees.length} trees (${joined?.line})`);
  check(!find(first.log, /^\[agent\] went to |was asked for here|^\[ocean\] put away/), 'launch 1: nothing stands');
  const put1 = placed(first.log);
  const madeAt = (title) => before.trees.find((t) => t.title === title)?.createdAt ?? '';
  const newestFirstPut = put1.every((p, i) => i === 0 || madeAt(put1[i - 1].title) >= madeAt(p.title));
  check(put1.length === before.trees.length && newestFirstPut && put1.every((p) => !p.own),
    `every tree is put away on the desk, the newest first, each at a free place (${put1.map((p) => `${p.title}: ${show(p.plot)}`).join(' | ')})`);
  check(new Set(put1.map((p) => show(p.plot))).size === put1.length, 'no two trees share a place');
  const carried = find(first.log, /^\[ocean\] carrying the cover of (.*) by flag, from (-?[\d.]+), (-?[\d.]+)$/);
  const [, carriedTitle, fromX, fromY] = carried ? /cover of (.*) by flag, from (-?[\d.]+), (-?[\d.]+)$/.exec(carried.line) : [];
  check(carriedTitle === newestFirst[0].title, `the first tree on the desk is the newest, "${newestFirst[0].title}" (carried: "${carriedTitle}")`);
  const plots1 = readPlots();
  check(before.trees.every((t) => plots1[t.id]), `every tree's plot is written down (${Object.keys(plots1).length} of ${before.trees.length})`);
  const carriedPlot = plots1[newestFirst[0].id];
  check(carriedPlot && !near(carriedPlot, [Number(fromX), Number(fromY)]), `the carried tree is kept where it was put (${show(carriedPlot)}), not where it stood (${fromX}, ${fromY})`);
  check(put1.slice(1).every((p) => near(plots1[before.trees.find((t) => t.title === p.title).id], p.plot)), 'the others are kept where they were put away');

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
  check(wentTo && wentTo.at - navigated < 4, `a navigate to "${goTo.title}" on the desk unfolds it (${wentTo ? (wentTo.at - navigated).toFixed(1) + ' s' : 'never'})`);
  const meanwhile = second.log.filter((l) => l.at >= dumped && l.at < (asked?.at ?? 999));
  check(find(meanwhile, /^\[agent\] tree ".*long take.*": \d+ cards/i), 'the tree asked for by another client reaches the preview');
  check(!find(meanwhile, /was asked for here|^\[ocean\] put away/), `and is only put away: "${goTo.title}" stays up, nothing is put away for it`);
  const leftBe = find(meanwhile, /^\[agent\] navigate to .* was asked for elsewhere, so the view stays$/);
  check(leftBe, `the navigate that ends the other client's first round leaves the headset where it is (${leftBe?.line ?? 'none came'})`);
  check(asked && /dolly zoom/i.test(asked.line), `the tree typed for on the preview stands (${asked?.line})`);
  const putAway = find(second.log, new RegExp(`^\\[ocean\\] put away: ${escape(goTo.title)}$`), asked?.at ?? 999);
  check(putAway && putAway.at - asked.at < 1, `and "${goTo.title}" was put away first (${putAway ? (putAway.at - asked.at).toFixed(2) + ' s after' : 'never'})`);
  check(find(second.log, new RegExp(`^\\[agent\\] tree "${escape(gone.title)}" was deleted at the service`), deleted), `"${gone.title}" was deleted at the service`);
  const asks = second.sent('ask');
  const refused = second.log.filter((l) => /^\[agent\] still asking, so not again: /.test(l.line));
  check(asks.length === 1 && refused.length === 2, `a row picked three times in 0.8 s while its search runs is asked once (${asks.length} sent, ${refused.length} held back: "${asks[0]?.need}")`);

  const put2 = placed(second.log);
  const kept = put2.filter((p) => newestFirst.some((t) => t.title === p.title) && p.own);
  check(kept.length >= before.trees.length - 1 && kept.every((p) => near(plots1[before.trees.find((t) => t.title === p.title).id], p.plot)),
    `launch 2: each tree stands at its own place from launch 1 (${kept.map((p) => `${p.title}: ${show(p.plot)}`).join(' | ')})`);
  const plots2 = readPlots();
  const after = await state();
  check(near(plots2[newestFirst[0].id], carriedPlot), `the carried tree stood where it was put, across the restart (${show(plots2[newestFirst[0].id])})`);
  check(near(plots2[goTo.id], plots1[goTo.id]), `"${goTo.title}" went back to its own place (${show(plots2[goTo.id])})`);
  check(!(gone.id in plots2), `the deleted tree's plot is dropped (${Object.keys(plots2).length} plots)`);
  const longTake = after.trees.find((t) => /long take/i.test(t.title));
  check(longTake && plots2[longTake.id] && !Object.entries(plots2).some(([id, p]) => id !== longTake.id && near(p, plots2[longTake.id])), `the other client's tree stands at a place of its own (${longTake && show(plots2[longTake.id])})`);
  check(readFileSync(join(previewData, 'ocean-shelf.json'), 'utf8') === ownShelf, "the headset's own shelf file is as it was");
  writeFileSync(join(shots, 'log-launch1.txt'), first.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
  writeFileSync(join(shots, 'log-launch2.txt'), second.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
  writeFileSync(join(shots, 'plots.json'), JSON.stringify({ launch1: plots1, launch2: plots2, trees: after.trees.map((t) => ({ id: t.id, title: t.title, createdAt: t.createdAt })) }, null, 2));
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
