// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and checks the pictures round
// each tree put away on the desk (its cover), from the preview's log:
//   1. every tree whose cards have pictures shows them: eight when its cards have eight or more, else as many as they have
//      (a card of the service's shows its own picture, which the service holds; a film or a work, the library's)
//   2. of them, the first five show while the forest lies on the ocean's floor, as it does while a tree stands
//   3. the service's pictures, which come after the cover is made, all come, and the cover shows them
//   5. a cover's cards are its own, whatever the network does (`-coversAt` lists each cover's cards): with the service failing
//      one of a cover's pictures twice and then giving it, the cover ends with the same cards as an untroubled run; with the
//      service answering that picture not found, its place goes to the next card, and the cover has as many as before
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
  const run = stand.launch(shots, 'floor', 20, ['-coversAt', '14', '-shotEvery', '100']);
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

  // 5. What each cover shows once settled, by its cards: `… of the <k> its cards have: <ref> <ref> …`.
  const settled = /^\[ocean\] cover of (.*): (\d+) pictures showing, (\d+) places waiting, of the (\d+) its cards have:(.*)$/;
  const covers = (log) => new Map(log.map((l) => settled.exec(l.line)).filter(Boolean).map((m) => [m[1], { waiting: Number(m[3]), choices: Number(m[4]), cards: m[5].trim().split(' ').filter(Boolean) }]));
  const clean = covers(run.log);
  // One picture a cover shows in the untroubled run: a card of the service's whose look holds one picture alone, on a tree
  // with more pictures than its cover shows, so there is a next card.
  const pathsOf = (node) => JSON.stringify(node?.view?.props ?? {}).match(/\/assets\/[^"?\\]+/g) ?? [];
  let troubled = null;
  for (const [title, cover] of clean) {
    if (cover.choices <= cover.cards.length) continue;
    for (const ref of cover.cards) {
      const node = before.nodes.find((n) => `note:agent-${n.id}` === ref);
      const paths = [...new Set(pathsOf(node))];
      if (node && paths.length === 1) troubled ??= { title, ref, path: paths[0] };
    }
  }
  if (!troubled) {
    check(false, '5. a cover shows a picture of the service\'s to trouble');
  } else {
    // Failed twice (503), then given.
    let asked = 0;
    stand.pictures((path) => (path === troubled.path && ++asked <= 2 ? 'fail' : null));
    const late = stand.launch(shots, 'failed-twice', 18, ['-coversAt', '16', '-shotEvery', '100']);
    await late.done;
    writeFileSync(join(shots, 'log-failed-twice.txt'), late.log.map((l) => `${l.at.toFixed(2).padStart(7)} ${l.line}`).join('\n'));
    const after = covers(late.log);
    const same = [...clean].every(([title, c]) => after.get(title)?.waiting === 0 && after.get(title)?.cards.join(' ') === c.cards.join(' '));
    const retried = late.log.filter((l) => /^\[agent\] a picture did not come/.test(l.line)).length;
    check(asked >= 3 && retried >= 2 && same,
      `5. "${troubled.title}": its picture of ${troubled.ref} failed twice and then came (asked ${asked} times, ${retried} retries): every cover ends with the same cards as an untroubled run`);
    // Not found (404): the next card takes its place.
    stand.pictures((path) => (path === troubled.path ? 'refuse' : null));
    const gone = stand.launch(shots, 'not-found', 18, ['-coversAt', '16', '-shotEvery', '100']);
    await gone.done;
    stand.pictures(null);
    writeFileSync(join(shots, 'log-not-found.txt'), gone.log.map((l) => `${l.at.toFixed(2).padStart(7)} ${l.line}`).join('\n'));
    const was = clean.get(troubled.title).cards;
    const now = covers(gone.log).get(troubled.title);
    const added = now ? now.cards.filter((c) => !was.includes(c)) : [];
    const kept = now ? was.filter((c) => c !== troubled.ref).every((c) => now.cards.includes(c)) : false;
    check(now && now.waiting === 0 && !now.cards.includes(troubled.ref) && kept && added.length === 1 && now.cards.length === was.length,
      `5. "${troubled.title}": its picture of ${troubled.ref} not found, the next card takes its place (${added.join(', ') || 'none'}), the other ${was.length - 1} kept`);
  }

  // The forest on the desk.
  const desk = stand.launch(shots, 'desk', 10, ['-shotEvery', '100']);
  await desk.done;
  check(!desk.log.some((l) => /^\[ocean\] layers: /.test(l.line)), `no tree stands, so the forest stands on the desk: ${join(shots, 'desk.png')}`);
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
