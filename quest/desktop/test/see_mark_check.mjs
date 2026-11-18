// Runs the Mac preview against the walkthrough demo (standin.mjs with `demo`, the fake service with no model) and checks that
// what the user rings on a card's picture with the pen is what the headset gives Momo to see (WS89):
//   1. taken to a picture card of the demo's tree, gone into, the pen taken up and a ring drawn on its picture, the preview
//      sends the service a `look` for that card a moment after the line is kept
//   2. the look holds the part of the picture the ring is round (its box: about 0.62 across and 0.4 down, as the ring was
//      drawn) and two JPEGs, the part and the whole picture, each within the service's limits
//   3. the eraser takes the marks off, and the preview sends a look with no pictures: Momo is shown nothing of them
//   4. on the welcome walk (a stand-in service with nothing in it, -guideDemo tour), the sketch lesson's picture ringed with
//      the marker and sent: the preview sends a look of the sketch, by the work's title, round where the ring was drawn
// The pictures are written to the shots folder (look-part.jpg, look-whole.jpg; sketch-part.jpg, sketch-whole.jpg) to be
// looked at: the ring must be on them in red, round what it was drawn round on the card.
//
//   quest/desktop/build.sh && node quest/desktop/test/see_mark_check.mjs [--shots <folder>]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checker, escape, flag, later, standIn, until } from './standin.mjs';

const seed = mkdtempSync(join(tmpdir(), 'see-mark-seed-'));
writeFileSync(join(seed, 'mindstorm.sqlite'), '');
const stand = await standIn('see-mark-check', seed, { demo: true });
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
/** Writes a look's two pictures to the shots folder as `<name>-part.jpg` and `<name>-whole.jpg`, and checks each is a JPEG within the limit. */
const keep = (look, name) => {
  for (const [part, url] of [['part', look.crop], ['whole', look.whole]]) {
    const bytes = Buffer.from(url.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    writeFileSync(join(shots, `${name}-${part}.jpg`), bytes);
    check(url.length <= 300_000 && bytes[0] === 0xff && bytes[1] === 0xd8, `the ${part} is a JPEG within the service's limit: ${Math.round(bytes.length / 1024)} KB, ${url.length} characters`);
  }
};
/** The middle of a look's part is near where a ring was drawn round, 0…1 of the picture. */
const round = (look, x, y) => {
  const [bx, by, bw, bh] = look.box;
  check(Math.abs(bx + bw / 2 - x) < 0.08 && Math.abs(by + bh / 2 - y) < 0.08, `the part is round where the ring was drawn: middle ${(bx + bw / 2).toFixed(2)} across, ${(by + bh / 2).toFixed(2)} down; ${bw.toFixed(2)} × ${bh.toFixed(2)}`);
};
const { check, failed, summary } = checker();

const said = () => readFileSync(join(stand.work, 'service.log'), 'utf8').split('\n');
/** The demo has set its tree up again for the preview that just joined, with new cards. */
const setUp = async () => {
  const from = said().length;
  for (let i = 0; i < 1800; i++) {
    const lines = said().slice(from - 1);
    const joined = lines.findIndex((l) => l.includes('[demo] a headset joined'));
    if (joined >= 0 && lines.slice(joined).some((l) => l.includes('[demo] set up for'))) return true;
    await later(0.1);
  }
  return false;
};

try {
  await stand.api('/api/demo/goto', { method: 'POST', body: JSON.stringify({ round: 'end' }) });
  for (let i = 0; i < 600 && (await (await stand.api('/api/demo/status')).json()).busy; i++) await later(0.1);
  // Taken to the card once the demo has set its tree up for the preview, gone into at 22 s, the pen up at 24, a ring drawn at
  // 26, the eraser at 34.
  const run = stand.launch(shots, 'see-mark', 42, ['-zoomAt', '22', '-toolAt', '24', '-tool', 'pen', '-ringPictureAt', '26', '-toolAt2', '34', '-tool2', 'eraser']);
  const ready = setUp();
  try {
    await until(run.log, /^\[agent\] connected/, 0, 30);
    check(await ready, 'the demo set its tree up for the preview');
    const state = await stand.state();
    const items = new Map(state.items.map((i) => [i.id, i]));
    const card = state.nodes.find((n) => items.get(n.itemId)?.title === 'Corals');
    check(card, `the demo's tree has the picture card "Corals"${card ? ` (${card.view.component})` : ''}`);
    if (!card) throw new Error('no card to mark');
    check(run.at() < 18, `it is set up in time, at ${run.at().toFixed(1)} s`);
    stand.inject({ t: 'navigate', nodeId: card.id, yours: true });
    const shown = await until(run.log, /^\[agent\] Momo is shown what is marked on Corals \(/, 0, 30);
    check(shown, `a moment after the ring is kept, the preview says Momo is shown it (${shown?.line ?? 'no such line'})`);
    await later(1);
    const looks = run.sent('look');
    const look = looks.find((l) => l.crop);
    check(look && look.nodeId === card.id && look.title === 'Corals', `the service is sent a look for that card${look ? ` at ${look.at.toFixed(1)} s` : ''}`);
    if (look) {
      round(look, 0.62, 0.4);
      keep(look, 'look');
    }
    const erased = await until(run.log, /^\[agent\] Momo is shown nothing of Corals: its marks are gone$/, 0, 20);
    check(erased, `the eraser takes the marks off, and Momo is shown nothing of them (${erased?.line ?? 'no such line'})`);
    check(run.sent('look').some((l) => !l.crop && l.nodeId === card.id), 'the service is sent a look with no pictures');
    await run.done;
  } finally {
    run.stop();
    writeFileSync(join(shots, 'see-mark.log'), run.log.map((l) => `${l.at.toFixed(1)} ${l.line}`).join('\n'));
  }
} finally {
  await stand.close();
}

// The welcome walk: it walks itself to the sketch lesson (Step 6, about 35 s in), which is gone into, the marker taken up, a
// ring drawn on the picture, and Send pinched.
const empty = mkdtempSync(join(tmpdir(), 'see-sketch-seed-'));
writeFileSync(join(empty, 'mindstorm.sqlite'), '');
const walk = await standIn('see-sketch-check', empty);
try {
  const run = walk.launch(shots, 'see-sketch', 56, ['-guideDemo', 'tour', '-guideStep', '6', '-zoomAt', '38', '-toolAt', '41', '-tool', 'pen', '-ringPictureAt', '43', '-toolAt2', '47', '-tool2', 'send']);
  try {
    const shown = await until(run.log, /^\[agent\] Momo is shown what is marked on .+ \(the part/, 0, 70);
    check(shown, `the sketch sent, the preview says Momo is shown it (${shown?.line ?? 'no such line'})`);
    await later(1);
    const look = run.sent('look').find((l) => l.crop);
    check(look && !look.nodeId && look.title, `the service is sent a look of the sketch, by its title alone${look ? `: "${look.title}"` : ''}`);
    if (look) {
      round(look, 0.62, 0.4);
      keep(look, 'sketch');
    }
    await run.done;
  } finally {
    run.stop();
    writeFileSync(join(shots, 'see-sketch.log'), run.log.map((l) => `${l.at.toFixed(1)} ${l.line}`).join('\n'));
  }
} finally {
  await walk.close();
}
console.log(summary());
process.exit(failed() ? 1 : 0);
