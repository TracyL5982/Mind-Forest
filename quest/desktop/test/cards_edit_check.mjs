// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and checks the open card's
// pills, its long pinch and its edit pencil, from the preview's log and from what it sends the service:
//   1. under the open card at most 3 of the service's questions stand as pills, though it sends 4
//   2. a pinch-drag scrolls the card with the pencil off, and again with it on
//   3. the pencil turns on; the line under it says what a long pinch will do where the hand points
//   4. with it on, a long pinch on words and a drag highlights them, and one elsewhere draws a line: both are sent to the
//      service as edits of that card, and a long pinch never asks for anything
//   5. a short pinch on an edit takes it off; the pencil turns off when the card closes
//   6. the card opened again shows its edits, and with the pencil off a long pinch asks for more like it, leaning on what is
//      highlighted; it leads a layer of its own
//   7. a second preview, as after a restart or on another headset, opens the card with its edits; a line drawn there is
//      kept by the service, and an undo there takes it off the card
// The pictures for the user are taken on the way: the pills, the pencil off and on with each line, a highlight, a line,
// the ring round a long pinch, and the card opened again with its edits.
//
//   quest/desktop/build.sh && node quest/desktop/test/cards_edit_check.mjs --data <data folder> [--shots <folder>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, escape, find, flag, standIn, until } from './standin.mjs';

const stand = await standIn('cards-edit-check', flag('--data'));
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();

const before = await stand.state();
const items = new Map(before.items.map((i) => [i.id, i]));
const node = (id) => before.nodes.find((n) => n.id === id);
const own = (n) => n && items.get(n.itemId)?.source?.from !== 'library';
const childrenOf = (snapshot, id) => snapshot.nodes.filter((n) => n.parent === id);
// A suggestion of the user's own with words enough to scroll, under a root of the user's own.
const fits = (n) => n.status === 'pick' && own(n) && childrenOf(before, n.id).length === 0 && (items.get(n.itemId).text || '').length > 300;
const tree = before.trees.find((t) => own(node(t.rootId)) && childrenOf(before, t.rootId).some(fits));
if (!tree) throw new Error('no tree here has a root of the user\'s own and a long suggestion of theirs under it');
const root = node(tree.rootId);
const pick = childrenOf(before, root.id).find(fits);
// Another card of the same tree, untouched by the rest, for the picture of the ring.
const other = childrenOf(before, root.id).find((n) => n.id !== pick.id && n.status === 'pick' && own(n) && childrenOf(before, n.id).length === 0);
const title = items.get(pick.itemId).title;
console.log(`tree "${tree.title}": the suggestion ${pick.id} "${title}"`);
const four = ['Which painters used glazes first?', 'Show me a Vermeer glaze up close', 'How long does each layer dry?', 'What pigments did Vermeer use?'];

// Pictures are taken every 2 s: the pills and the pencil off at 12 s, the pencil on with each of its lines at 14 and 16 s,
// a highlight at 20 s, a line at 22 s, and the card opened again with its edits at 32 s; the ring round a long pinch is ring.png.
const FLAG = { opened: 'pickAt', pencil: 'pencilAt', aimWords: 'aimAt', aimElse: 'aimAgainAt', highlight: 'holdAt', draw: 'drawAt', longOn: 'longPinchAt', erase: 'eraseAt', scrollOn: 'scrollAt', away: 'pickAt2', back: 'pickAt3', longOff: 'longPinchAgainAt', scroll: 'scrollAgainAt' };
const T = { opened: 8, zoom: 10, pencil: 12.5, aimWords: 13, aimElse: 15, highlight: 16.5, draw: 19.5, longOn: 22.5, erase: 24, scrollOn: 25.5, away: 27.5, back: 28.5, zoomBack: 30, longOff: 33.75, scroll: 37, end: 42 };
const run = stand.launch(shots, 'edit', T.end, [
  '-pickRef', `note:agent-${pick.id}`, '-pickAt', String(T.opened), '-zoomAt', String(T.zoom),
  '-scrollAt', String(T.scrollOn), '-scrollAgainAt', String(T.scroll), '-scrollBy', '0.3',
  '-pencilAt', String(T.pencil), '-aimAt', String(T.aimWords), '-aim', 'words', '-aimAgainAt', String(T.aimElse), '-aimAgain', 'elsewhere',
  '-holdAt', String(T.highlight), '-drawAt', String(T.draw), '-longPinchAt', String(T.longOn), '-longPinchOn', 'words', '-eraseAt', String(T.erase),
  '-pickRef2', `note:agent-${root.id}`, '-pickAt2', String(T.away), '-pickRef3', `note:agent-${pick.id}`, '-pickAt3', String(T.back),
  '-zoomAgainAt', String(T.zoomBack), '-longPinchAgainAt', String(T.longOff),
]);
try {
  await until(run.log, /^\[agent\] connected/);
  stand.inject({ t: 'navigate', treeId: tree.id, yours: true });
  const opened = await until(run.log, /^\[agent\] opened /);
  // The service's own questions come first, then 4 in their place, as an older card's could be.
  await until(run.log, new RegExp(`^\\[agent\\] \\d questions for ${escape(title)}`), opened.at);
  stand.inject({ t: 'questions', nodeId: pick.id, questions: four });
  await run.done;
  // The preview's clock falls behind the wall's while it takes pictures, so each step is looked for from when the preview
  // says its flag ran, until the next step's.
  const ran = Object.fromEntries(Object.entries(FLAG).map(([step, name]) => [step, find(run.log, new RegExp(`^\\[ocean\\] -${name} runs$`))?.at ?? NaN]));
  const when = (step) => (step === 'end' ? Infinity : ran[step]);
  const between = (pattern, from, to = 'end') => run.log.filter((l) => l.at >= when(from) && l.at < when(to) && pattern.test(l.line));
  const sentBetween = (t, from, to = 'end') => run.sent(t).filter((m) => m.at >= when(from) && m.at < when(to));
  const edits = (from, to) => sentBetween('commands', from, to).flatMap((m) => m.commands.filter((c) => c.id === pick.id && /Edit$/.test(c.type)));

  const pills = between(/^\[cards\] \d+ pills under /, 'opened', 'pencil').find((l) => l.line.includes(four[0]))?.line ?? '';
  const shown = four.filter((q) => pills.includes(q));
  check(shown.length === 3 && pills.includes(four[0]) && !pills.includes(four[3]), `1. 3 of the 4 questions stand as pills, the first three (${pills})`);

  check(between(/^\[cards\] the pencil is on$/, 'pencil', 'aimWords').length === 1, '3. a pinch on the pencil turns it on');
  check(between(/^\[cards\] under the pencil: Long pinch to highlight$/, 'aimWords', 'aimElse').length === 1, '3. pointed at words, the line under it says "Long pinch to highlight"');
  check(between(/^\[cards\] under the pencil: Long pinch to draw$/, 'aimElse', 'highlight').length === 1, '3. pointed elsewhere, "Long pinch to draw"');

  const highlighted = between(/^\[cards\] highlighted "/, 'highlight', 'draw')[0];
  const sentHighlight = edits('highlight', 'draw');
  check(highlighted && sentHighlight.length === 1 && sentHighlight[0].type === 'addEdit' && sentHighlight[0].edit.kind === 'highlight', `4. a long pinch on words and a drag highlights them, and the service is sent it (${highlighted?.line})`);
  const drew = between(/^\[cards\] drew a line of (\d+) points$/, 'draw', 'longOn')[0];
  const sentLine = edits('draw', 'longOn');
  check(drew && sentLine.length === 1 && sentLine[0].edit.kind === 'stroke' && sentLine[0].edit.points.every((v) => v >= 0 && v <= 1), `4. a long pinch elsewhere and a drag draws a line, sent as points 0 to 1 (${drew?.line})`);
  const askedWhileOn = ['more', 'ask', 'keep'].flatMap((t) => sentBetween(t, 'pencil', 'away').map((m) => m.t));
  const annotated = between(/^\[cards\] the pencil begins /, 'longOn', 'erase');
  check(askedWhileOn.length === 0 && annotated.length === 1, `4. with the pencil on a long pinch annotates (${annotated[0]?.line}) and nothing is asked (${askedWhileOn.join(', ') || 'no more, ask or keep sent'})`);
  check(between(/^\[cards\] scrolled to /, 'scrollOn', 'away').length === 1, `2. a pinch-drag scrolls it with the pencil on too (${between(/^\[cards\] scrolled/, 'scrollOn', 'away')[0]?.line})`);

  const erased = between(/^\[cards\] erased /, 'erase', 'scrollOn')[0];
  const sentErase = edits('erase', 'scrollOn').filter((c) => c.type === 'removeEdit');
  check(erased && sentErase.length === 1, `5. a short pinch on the newest edit takes it off, at the service too (${erased?.line})`);
  check(between(/^\[cards\] the pencil is off: its card closed$/, 'away', 'back').length === 1, '5. the pencil turns off when the card closes');

  const after = await stand.state();
  const kept = after.nodes.find((n) => n.id === pick.id)?.edits ?? [];
  check(kept.length === 2 && kept[0].kind === 'highlight' && kept[1].kind === 'stroke', `the service keeps the card's highlight and line (${kept.map((e) => e.kind).join(', ')})`);
  const reopened = between(/^\[cards\] opened with \d+ edits/, 'back', 'longOff')[0];
  check(reopened && /^\[cards\] opened with 2 edits/.test(reopened.line), `6. opened again, the card shows its edits (${reopened?.line})`);
  check(!between(/^\[cards\] the pencil is on$/, 'back', 'end').length, '6. and its pencil is off');
  check(between(/^\[cards\] scrolled to [1-9]/, 'scroll').length === 1, `2. a pinch-drag scrolls it with the pencil off (${between(/^\[cards\] scrolled/, 'scroll')[0]?.line})`);
  const more = sentBetween('more', 'longOff', 'end');
  const quote = kept[0]?.quote;
  check(more.length === 1 && more[0].nodeId === pick.id, `6. with the pencil off, a long pinch asks for more like the card (${JSON.stringify(more[0])})`);
  check(quote && more[0]?.need?.includes(`"${quote}"`) && /^More like this, especially what I highlighted: /.test(more[0]?.need ?? ''), '6. leaning on what it highlighted');
  check(sentBetween('keep', 'longOff', 'end').some((m) => m.nodeIds.includes(pick.id)) && find(run.log, /^\[agent\] \d+ new cards$/, when('longOff')), `6. it is kept, and what the service brings stands round it (${find(run.log, /^\[agent\] \d+ new cards$/, when('longOff'))?.line})`);
  writeFileSync(join(shots, 'log-edit.txt'), run.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
  writeFileSync(join(shots, 'sent-edit.json'), JSON.stringify(['commands', 'more', 'keep', 'questions'].flatMap((t) => run.sent(t)), null, 2));

  // Another preview, as after a restart or on a second headset: it draws a line there, and an undo at the service takes it back.
  const second = stand.launch(shots, 'again', 18, ['-pickRef', `note:agent-${pick.id}`, '-pickAt', '8', '-zoomAt', '9.5', '-pencilAt', '11.5', '-drawAt', '12']);
  await until(second.log, /^\[agent\] connected/);
  stand.inject({ t: 'navigate', treeId: tree.id, yours: true });
  const shownAgain = await until(second.log, /^\[cards\] opened with \d+ edits/);
  check(shownAgain && /^\[cards\] opened with 2 edits/.test(shownAgain.line), `7. a second preview opens the card with its edits (${shownAgain?.line})`);
  const drawnThere = await until(second.log, /^\[cards\] drew a line/);
  await until(second.log, /^\[cards\] 3 edits on /);
  const ws = new stand.WebSocket(`ws://127.0.0.1:${stand.servicePort}/ws?token=${stand.token}`);
  await new Promise((r) => ws.on('open', r));
  const undoneAt = second.at();
  ws.send(JSON.stringify({ t: 'undo' }));
  const undone = await until(second.log, /^\[cards\] 2 edits on /, undoneAt);
  check(drawnThere && undone, `7. the line drawn there comes back from the service, and an undo there takes it off the card (${undone?.line})`);
  ws.close();
  await second.done;

  // The ring round a long pinch shows for a third of a second: a preview whose clock runs a frame at a time takes its picture
  // as it fills, 0.3 s into the hold.
  const ring = stand.launch(shots, 'ring', 12, ['-pickRef', `note:agent-${(other ?? pick).id}`, '-pickAt', '8', '-zoomAt', '9.5', '-longPinchAt', '11.7'], { realtime: false });
  await until(ring.log, /^\[agent\] connected/);
  stand.inject({ t: 'navigate', treeId: tree.id, yours: true });
  await ring.done;
  check(find(ring.log, /^\[cards\] the ring fills$/) && !find(ring.log, /^\[cards\] a long pinch/), `the picture ${join(shots, 'ring.png')} is taken while the ring fills`);
  writeFileSync(join(shots, 'log-again.txt'), second.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
