// WS98: joined to the service, the welcome tree stays in the forest after the walk. Runs the Mac preview twice against the
// fake service on a fresh copy of a data folder (standin.mjs), as a first launch and the next one, and checks from the
// preview's log, what it sends and the files it writes:
//   launch 1   a first launch: the walk stands the welcome tree by itself, and it is put away (-pressAt); it is written to
//              welcome-shelf.json, alone, and the headset's own shelf file is not written
//   launch 2   the walk does not come again; the welcome tree is on the desk, once, at the place it was left, among the
//              service's trees, every one of which is on the desk too; nothing the preview sends names it; the file still
//              holds it alone
//   launch 3   the same again, turned to where the welcome tree stands, for a picture of it among the service's trees
//
//   quest/desktop/build.sh && node quest/desktop/test/welcome_check.mjs --data <data folder> [--shots <folder>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, find, flag, standIn } from './standin.mjs';

const welcomeTitle = 'Welcome to Mind Forest';
const stand = await standIn('welcome-check', flag('--data'));
const { previewData, state } = stand;
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();
const welcomeFile = join(previewData, 'welcome-shelf.json');
const ownShelf = join(previewData, 'ocean-shelf.json');
const readWelcome = () => (existsSync(welcomeFile) ? JSON.parse(readFileSync(welcomeFile, 'utf8')) : null);
const isWelcome = (t) => (t.tree?.nodes ?? []).some((n) => n.ref === 'note:welcome');
const placed = (log) =>
  log.map((l) => /^\[ocean\] on the desk: (.*) at (-?[\d.]+), (-?[\d.]+), (its own place|a free place)$/.exec(l.line)).filter(Boolean)
    .map((m) => ({ title: m[1], plot: [Number(m[2]), Number(m[3])], own: m[4] === 'its own place' }));
const near = (a, b) => Boolean(a && b) && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.002;
const show = (p) => (p ? `${p[0].toFixed(2)}, ${p[1].toFixed(2)}` : 'none');
const keepLog = (name, log) => writeFileSync(join(shots, `log-${name}.txt`), log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));

try {
  const trees = (await state()).trees;

  // Launch 1: a first launch. The walk's tree stands by itself, and is put away early.
  const first = stand.launch(shots, 'launch1', 26, ['-pressAt', '14']);
  await first.done;
  keepLog('launch1', first.log);
  check(find(first.log, /^\[guide\] on: first time$/), 'launch 1 is a first launch');
  check(find(first.log, /^\[agent\] connected: \d+ trees/), `launch 1 joined the service and its ${trees.length} trees`);
  const put1 = placed(first.log).filter((p) => p.title === welcomeTitle);
  check(put1.length === 1, `the welcome tree was put away on the desk once (${put1.map((p) => show(p.plot)).join(' | ') || 'never'})`);
  const file1 = readWelcome();
  check(file1 && file1.version === 3 && file1.trees.length === 1 && isWelcome(file1.trees[0]),
    `welcome-shelf.json holds the welcome tree alone (${file1 ? file1.trees.length + ' trees' : 'no file'})`);
  check(file1 && near(file1.trees[0]?.plot, put1[0]?.plot), `at the place it was put away (${show(file1?.trees[0]?.plot)})`);
  check(!existsSync(ownShelf), "the headset's own shelf file is not written while joined");

  // Launch 2: the next launch.
  const second = stand.launch(shots, 'launch2', 22, []);
  await second.done;
  keepLog('launch2', second.log);
  check(find(second.log, /^\[guide\] on: welcomed before$/), 'launch 2 is not a first launch');
  check(!find(second.log, /^\[guide\] lesson 1 on its card/), 'the walk does not come again by itself');
  check(find(second.log, /^\[ocean\] shelf: the welcome tree kept from last time \(1\)$/), 'the welcome tree is read from its own file');
  const put2 = placed(second.log);
  const welcome2 = put2.filter((p) => p.title === welcomeTitle);
  check(welcome2.length === 1 && welcome2[0].own && near(welcome2[0].plot, put1[0]?.plot),
    `launch 2: the welcome tree is on the desk once, at its own place from launch 1 (${welcome2.map((p) => `${show(p.plot)}, ${p.own ? 'its own' : 'a free'} place`).join(' | ') || 'not there'})`);
  const served = put2.filter((p) => trees.some((t) => t.title === p.title));
  check(served.length === trees.length, `and every one of the service's ${trees.length} trees is on the desk with it (${served.length})`);
  check(new Set(put2.map((p) => show(p.plot))).size === put2.length, 'no two trees share a place');
  const named = [...first.sentAll(), ...second.sentAll()].filter((m) => JSON.stringify(m).includes(welcomeTitle));
  check(named.length === 0, `nothing sent to the service names the welcome tree (${named.map((m) => m.t).join(', ') || 'none'})`);
  const file2 = readWelcome();
  check(file2 && file2.trees.length === 1 && isWelcome(file2.trees[0]), `the file still holds it alone (${file2 ? file2.trees.length : 0})`);
  check(!existsSync(ownShelf), "the headset's own shelf file is still not written");

  // Launch 3: again, turned to the right, where the welcome tree was left, for a picture of it among the service's trees.
  const third = stand.launch(shots, 'launch3-forest', 22, ['-moveAt', '12', '-yaw', '38', '-pitch', '-8']);
  await third.done;
  keepLog('launch3-forest', third.log);
  const welcome3 = placed(third.log).filter((p) => p.title === welcomeTitle);
  check(welcome3.length === 1 && welcome3[0].own && near(welcome3[0].plot, put1[0]?.plot), `launch 3: still once, at its own place (${welcome3.map((p) => show(p.plot)).join(' | ')})`);
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
