// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and checks the pictures round
// each tree put away on the desk (its cover), from the preview's log:
//   1. every tree whose cards have pictures shows them: eight when its cards have eight or more, else as many as they have
//      (a card of the service's shows its own picture, which the service holds; a film or a work, the library's)
//   2. of them, the first five show while the forest lies on the ocean's floor, as it does while a tree stands
//   3. the service's pictures, which come after the cover is made, all come, and the cover shows them
//   5. with the service refusing a third of its pictures every time they are asked for, and holding a seventh of the rest back
//      3 s, every cover still shows a full set once they have settled (`-coversAt`): as many as the pictures its cards can
//      show, at most eight, and no place left waiting; a place whose picture was refused went to the next card, and one whose
//      picture was late (here after 0.5 s, `-coverWait`) to one on hand; and a late picture that came once its cover was full
//      left the cover as it was
//   4. a tree made in the app from a piece of the ocean (the first film, Dracula) and put away shows its pictures too: its
//      root's, when the service roots it on the library's film, and the service's cards' round it
// Then a last preview, with no tree standing (the welcome tree stood only the first time), has the forest on the desk with
// eight round each, for the picture.
// `[ocean] cover of <title>: <n> pictures of the <k> its cards have, <f> of them while it lies on the ocean's floor; <w> still to come`
// and `[ocean] cover of <title>: its <n> pictures all shown`.
//
//   quest/desktop/build.sh && node quest/desktop/test/cover_check.mjs --data <data folder> [--shots <folder>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, escape, flag, standIn, until } from './standin.mjs';

const stand = await standIn('cover-check', flag('--data'));
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();
try {
  const before = await stand.state();
  const run = stand.launch(shots, 'floor', 20, ['-shotEvery', '100']);
  await until(run.log, /^\[agent\] connected/);
  const made = /^\[ocean\] cover of (.*): (\d+) pictures of the (\d+) its cards have, (\d+) of them while it lies on the ocean's floor; (\d+) still to come$/;
  let total = 0;
  for (const tree of before.trees) {
    const line = await until(run.log, new RegExp(`^\\[ocean\\] cover of ${escape(tree.title)}: `), 0, 10);
    const m = line && made.exec(line.line);
    if (!m) {
      check(false, `"${tree.title}" is put away on the desk with a cover (${line?.line ?? 'no cover'})`);
      continue;
    }
    const [, , n, k, f, w] = m.map(Number);
    total += n;
    check(n === Math.min(8, k) && f === Math.min(5, n),
      `1, 2. "${tree.title}": ${n} pictures of the ${k} its cards have, ${f} on the ocean's floor`);
    if (w > 0) {
      const all = await until(run.log, new RegExp(`^\\[ocean\\] cover of ${escape(tree.title)}: its \\d+ pictures all shown$`), 0, 30);
      check(all, `3. "${tree.title}": the ${w} of the service's pictures came and show (${all ? `by ${all.at.toFixed(1)} s` : 'not all came'})`);
    }
  }
  check(total > 0, `the trees show ${total} pictures between them`);
  await run.done;
  writeFileSync(join(shots, 'log-floor.txt'), run.log.map((l) => `${l.at.toFixed(2).padStart(7)} ${l.line}`).join('\n'));
  // A tree made from a piece of the ocean, as the user makes one by bringing it in (ocean_tree_check.mjs), then put away. The
  // voice is on, muted, and hears a silent clip in place of the microphone.
  const silence = join(stand.work, 'silence.wav');
  const bytes = 16000 * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
  writeFileSync(silence, wav);
  const ocean = stand.launch(shots, 'from-the-ocean', 24, ['-agentVoice', 'on', '-wakeClip', silence, '-peekFilm', '0', '-peekAt', '3', '-bringAt', '5', '-pressAt', '17', '-shotEvery', '100']);
  await ocean.done;
  writeFileSync(join(shots, 'log-from-the-ocean.txt'), ocean.log.map((l) => `${l.at.toFixed(2).padStart(7)} ${l.line}`).join('\n'));
  const away = ocean.log.find((l) => /^\[ocean\] put away: /.test(l.line));
  const title = away?.line.replace(/^\[ocean\] put away: /, '');
  const cover = title && ocean.log.find((l) => l.line.startsWith(`[ocean] cover of ${title}: `));
  const m = cover && made.exec(cover.line);
  const [, , n, k] = m ? m.map(Number) : [];
  const after = await stand.state();
  const tree = after.trees.find((t) => t.title === title && !before.trees.some((b) => b.id === t.id));
  const root = tree && after.nodes.find((n) => n.id === tree.rootId);
  const onFilm = root?.itemId === 'library:film:0';
  check(m && n === Math.min(8, k) && (!onFilm || n >= 1),
    `4. "${title ?? 'no tree'}", made from the ocean's first film${onFilm ? ', rooted on it,' : ' (rooted on a note of the service\'s here)'} and put away: ${m ? `${n} pictures of the ${k} its cards have` : cover?.line ?? 'no cover'}`);

  // 5. Pictures refused and held back. The same third is refused each time it is asked for (by its address), so asking
  // again never brings it; a seventh of the rest come 3 s late. (Not longer, nor more: held at once they hold up every
  // picture behind them on the preview's few connections, which is a slow service, not a late picture.)
  const hash = (text) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  let refused = 0, held = 0;
  stand.pictures((path) => {
    const h = hash(path);
    if (h % 3 === 0) return (refused++, 'refuse');
    if (h % 7 === 1) return (held++, 3);
    return null;
  });
  const hard = stand.launch(shots, 'refused', 22, ['-coversAt', '20', '-coverWait', '0.5', '-shotEvery', '100']);
  await hard.done;
  stand.pictures(null);
  writeFileSync(join(shots, 'log-refused.txt'), hard.log.map((l) => `${l.at.toFixed(2).padStart(7)} ${l.line}`).join('\n'));
  const settled = /^\[ocean\] cover of (.*): (\d+) pictures showing, (\d+) places waiting, of the (\d+) its cards have$/;
  const refusedWay = hard.log.filter((l) => / could not be had\)$/.test(l.line)).length;
  const lateWay = hard.log.filter((l) => / late, given to \d+ on hand\)$/.test(l.line)).length;
  // Once a cover is full, nothing that comes later moves it: a free place is filled only in a cover that had one.
  const count = new Map();
  let fullThenFilled = 0;
  for (const l of hard.log) {
    const first = made.exec(l.line);
    const again = /^\[ocean\] cover of (.*): now (\d+) pictures of the \d+ its cards have, \d+ still to come \((.*)\)$/.exec(l.line);
    if (first) count.set(first[1], Number(first[2]));
    if (!again) continue;
    if (again[3] === 'a free place filled' && (count.get(again[1]) ?? 0) >= 8) fullThenFilled++;
    count.set(again[1], Number(again[2]));
  }
  for (const tree of before.trees) {
    const line = hard.log.filter((l) => l.line.startsWith(`[ocean] cover of ${tree.title}: `) && settled.test(l.line)).at(-1);
    const [, , showing, waiting, k] = line ? settled.exec(line.line).map(Number) : [];
    check(line && waiting === 0 && showing === Math.min(8, k),
      `5. "${tree.title}", with pictures refused and late: ${line ? `${showing} showing, ${waiting} waiting, of the ${k} its cards can show` : 'no cover'}`);
  }
  check(refused > 0 && refusedWay > 0 && lateWay > 0 && fullThenFilled === 0,
    `5. the stand-in refused ${refused} picture asks and held back ${held}; covers gave places on ${refusedWay} refusals and ${lateWay} late pictures, and filled no free place in a full cover (${fullThenFilled})`);

  // The forest on the desk.
  const desk = stand.launch(shots, 'desk', 10, ['-shotEvery', '100']);
  await desk.done;
  check(!desk.log.some((l) => /^\[ocean\] layers: /.test(l.line)), `no tree stands, so the forest stands on the desk: ${join(shots, 'desk.png')}`);
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
