// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and checks the open card's
// pills, its long pinch and the pen, eraser and Send on the card gone into, from the preview's log and from what it sends
// the service:
//   1. under the open card at most 3 of the service's questions stand as pills, though it sends 4
//   2. with the pen down a pinch-drag scrolls the card; with the pen up it marks it and does not scroll
//   3. gone into, a pinch on the pen takes it up
//   4. with the pen up, a drag from words highlights them and one from elsewhere draws a line: both are sent to the
//      service as edits of that card, and nothing is asked
//   5. one press of the eraser takes every mark off, at the service too, as one change that one undo brings back; the pen
//      is put down when the card closes
//   6. the card opened again shows its edits, and with the pen down a long pinch asks for more like it, leaning on what is
//      highlighted; it leads a layer of its own
//   7. gone into again, Send asks Momo about every mark on the card together, as a conversation about the card
//   8. a second preview, as after a restart or on another headset, opens the card with its edits; a line drawn there is
//      kept by the service, and an undo there takes it off the card
//   9. on a video of the service's, a drag along it with the pen up keeps a stretch with the card; a second takes the
//      first's place in one change, and an undo brings the first back to the card; Send asks about the stretch by its times
//  10. on a picture of the service's, two drags across it with the pen up draw two lines, and the card keeps both
// The pictures for the user are taken on the way: the pills, the pen up, a highlight, a line, the ring round a long
// pinch, and the card opened again with its edits.
//
//   quest/desktop/build.sh && node quest/desktop/test/cards_edit_check.mjs --data <data folder> [--shots <folder>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, escape, find, flag, later, standIn, until } from './standin.mjs';

const stand = await standIn('cards-edit-check', flag('--data'));
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();
const clock = (seconds) => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;
const nodeEdits = async (id) => (await stand.state()).nodes.find((n) => n.id === id)?.edits ?? [];
const settled = async (id, ok) => {
  for (let i = 0; i < 50 && !ok(await nodeEdits(id)); i++) await later(0.1);
  return nodeEdits(id);
};
const undo = async () => {
  const ws = new stand.WebSocket(`ws://127.0.0.1:${stand.servicePort}/ws?token=${stand.token}`);
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'undo' }));
  await later(0.3);
  ws.close();
};

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
// Each preview is taken to a tree's root, whose layer stands then: a tree gone to as a tree stands as it was left, which for one
// with branches is its deepest layer.
const rootOf = (treeId) => before.trees.find((t) => t.id === treeId).rootId;
const pick = childrenOf(before, root.id).find(fits);
// Another card of the same tree, untouched by the rest, for the picture of the ring.
const other = childrenOf(before, root.id).find((n) => n.id !== pick.id && n.status === 'pick' && own(n) && childrenOf(before, n.id).length === 0);
const title = items.get(pick.itemId).title;
console.log(`tree "${tree.title}": the suggestion ${pick.id} "${title}"`);
const four = ['Which painters used glazes first?', 'Show me a Vermeer glaze up close', 'How long does each layer dry?', 'What pigments did Vermeer use?'];

// Pictures are taken every 2 s: the pills at 10 s, the pen up at 12 s, a highlight at 14 s, a line at 18 s, and the card
// opened again with its edits at 26 s; the ring round a long pinch is ring.png.
const FLAG = { opened: 'pickAt', zoom: 'zoomAt', pen: 'toolAt', highlight: 'holdAt', draw: 'drawAt', markDrag: 'scrollAt', erase: 'toolAt2', away: 'pickAt2', back: 'pickAt3', scroll: 'scrollAgainAt', longOff: 'longPinchAgainAt', zoomBack: 'zoomAgainAt', send: 'toolAt3' };
const T = { opened: 8, zoom: 10, pen: 12, highlight: 13.5, draw: 16.5, markDrag: 19.5, erase: 22.5, away: 24.5, back: 25.5, scroll: 27.5, longOff: 30.5, zoomBack: 35, send: 36.5, end: 44 };
const run = stand.launch(shots, 'edit', T.end, [
  '-pickRef', `note:agent-${pick.id}`, '-pickAt', String(T.opened), '-zoomAt', String(T.zoom),
  '-toolAt', String(T.pen), '-tool', 'pen', '-holdAt', String(T.highlight), '-drawAt', String(T.draw),
  '-scrollAt', String(T.markDrag), '-scrollBy', '0.3', '-toolAt2', String(T.erase), '-tool2', 'eraser',
  '-pickRef2', `note:agent-${root.id}`, '-pickAt2', String(T.away), '-pickRef3', `note:agent-${pick.id}`, '-pickAt3', String(T.back),
  '-scrollAgainAt', String(T.scroll), '-longPinchAgainAt', String(T.longOff),
  '-zoomAgainAt', String(T.zoomBack), '-toolAt3', String(T.send), '-tool3', 'send',
]);
try {
  await until(run.log, /^\[agent\] connected/);
  stand.inject({ t: 'navigate', treeId: tree.id, nodeId: root.id, yours: true });
  const opened = await until(run.log, /^\[agent\] opened /);
  // The service's own questions come first, then 4 in their place, as an older card's could be.
  await until(run.log, new RegExp(`^\\[agent\\] \\d questions for ${escape(title)}`), opened.at);
  stand.inject({ t: 'questions', nodeId: pick.id, questions: four });
  // Once the eraser's change is at the service, one undo there, before the card is opened again.
  const erasing = await until(run.log, /^\[cards\] erased \d+ marks$/, 0, 60);
  const emptied = await settled(pick.id, (e) => e.length === 0);
  await undo();
  const restored = await settled(pick.id, (e) => e.length === 3);
  await run.done;
  // The preview's clock falls behind the wall's while it takes pictures, so each step is looked for from when the preview
  // says its flag ran, until the next step's.
  const ran = Object.fromEntries(Object.entries(FLAG).map(([step, name]) => [step, find(run.log, new RegExp(`^\\[ocean\\] -${name} runs$`))?.at ?? NaN]));
  const when = (step) => (step === 'end' ? Infinity : ran[step]);
  const between = (pattern, from, to = 'end') => run.log.filter((l) => l.at >= when(from) && l.at < when(to) && pattern.test(l.line));
  const sentBetween = (t, from, to = 'end') => run.sent(t).filter((m) => m.at >= when(from) && m.at < when(to));
  const edits = (from, to) => sentBetween('commands', from, to).flatMap((m) => m.commands.filter((c) => c.id === pick.id && /Edit$/.test(c.type)));

  const pills = between(/^\[cards\] \d+ pills under /, 'opened', 'pen').find((l) => l.line.includes(four[0]))?.line ?? '';
  const shown = four.filter((q) => pills.includes(q));
  check(shown.length === 3 && pills.includes(four[0]) && !pills.includes(four[3]), `1. 3 of the 4 questions stand as pills, the first three (${pills})`);

  check(between(/^\[ocean\] the pen is taken up$/, 'pen', 'highlight').length === 1, '3. gone into, a pinch on the pen takes it up');

  const highlighted = between(/^\[cards\] highlighted "/, 'highlight', 'draw')[0];
  const sentHighlight = edits('highlight', 'draw');
  check(highlighted && sentHighlight.length === 1 && sentHighlight[0].type === 'addEdit' && sentHighlight[0].edit.kind === 'highlight', `4. with the pen up a drag from words highlights them, and the service is sent it (${highlighted?.line})`);
  const drew = between(/^\[cards\] drew a line of (\d+) points$/, 'draw', 'markDrag')[0];
  const sentLine = edits('draw', 'markDrag');
  check(drew && sentLine.length === 1 && sentLine[0].edit.kind === 'stroke' && sentLine[0].edit.points.every((v) => v >= 0 && v <= 1), `4. a drag from elsewhere draws a line, sent as points 0 to 1 (${drew?.line})`);
  const askedWhileUp = ['more', 'ask', 'keep'].flatMap((t) => sentBetween(t, 'pen', 'away').map((m) => m.t));
  const ringWhileUp = between(/^\[cards\] the ring fills$/, 'pen', 'away');
  check(askedWhileUp.length === 0 && ringWhileUp.length === 0, `4. with the pen up a hold shows no ring and nothing is asked (${askedWhileUp.join(', ') || 'no more, ask or keep sent'})`);
  const markedByDrag = edits('markDrag', 'erase').filter((c) => c.type === 'addEdit');
  check(markedByDrag.length === 1 && !between(/^\[cards\] scrolled to /, 'markDrag', 'erase').length, `2. with the pen up a pinch-drag marks the card and does not scroll (${markedByDrag[0]?.edit.kind})`);

  const made = edits('highlight', 'erase').filter((c) => c.type === 'addEdit').map((c) => c.edit.id);
  const eraseMessages = sentBetween('commands', 'erase', 'away').filter((m) => m.commands.some((c) => c.type === 'removeEdit'));
  const erasedIds = eraseMessages[0]?.commands.filter((c) => c.type === 'removeEdit' && c.id === pick.id).map((c) => c.editId) ?? [];
  check(erasing && /erased 3 marks/.test(erasing.line) && eraseMessages.length === 1 && erasedIds.length === 3 && made.every((id) => erasedIds.includes(id)),
    `5. one press of the eraser takes all 3 marks off, at the service in one message (${erasing?.line}; ${eraseMessages.length} message, ${erasedIds.length} removeEdits)`);
  check(emptied.length === 0 && restored.length === 3 && restored.every((e, i) => e.id === made[i]), `5. the service then keeps none, and one undo brings all 3 back (${emptied.length}, then ${restored.map((e) => e.kind).join(', ')})`);
  check(between(/^\[ocean\] the pen is put down: its card was left$/, 'away', 'back').length === 1, '5. the pen is put down when its card is left');

  const after = await stand.state();
  const kept = after.nodes.find((n) => n.id === pick.id)?.edits ?? [];
  check(kept.length === 3 && kept[0].kind === 'highlight' && kept[1].kind === 'stroke' && kept[2].kind === 'stroke', `the service keeps the card's highlight and two lines (${kept.map((e) => e.kind).join(', ')})`);
  const reopened = between(/^\[cards\] opened with \d+ edits/, 'back', 'longOff')[0];
  check(reopened && /^\[cards\] opened with 3 edits/.test(reopened.line), `6. opened again, the card shows its edits (${reopened?.line})`);
  check(!between(/^\[ocean\] the pen is taken up$/, 'back', 'send').length, '6. and its pen is down');
  check(between(/^\[cards\] scrolled to [1-9]/, 'scroll', 'longOff').length === 1, `2. with the pen down a pinch-drag scrolls it (${between(/^\[cards\] scrolled/, 'scroll', 'longOff')[0]?.line})`);
  const more = sentBetween('more', 'longOff', 'zoomBack');
  const quote = kept[0]?.quote;
  check(more.length === 1 && more[0].nodeId === pick.id, `6. with the pen down, a long pinch asks for more like the card (${JSON.stringify(more[0])})`);
  check(quote && more[0]?.need?.includes(`"${quote}"`) && /^More like this, especially what I highlighted: /.test(more[0]?.need ?? ''), '6. leaning on what it highlighted');
  check(sentBetween('keep', 'longOff', 'zoomBack').some((m) => m.nodeIds.includes(pick.id)) && find(run.log, /^\[agent\] \d+ new cards$/, when('longOff')), `6. it is kept, and what the service brings stands round it (${find(run.log, /^\[agent\] \d+ new cards$/, when('longOff'))?.line})`);
  const told = sentBetween('ask', 'send');
  check(told.length === 1 && told[0].nodeId === pick.id && told[0].need === `Tell me more about these parts: "${quote}"; the parts I drew on`, `7. Send asks Momo about every mark together (${JSON.stringify(told[0])})`);
  check(find(run.log, /^\[agent\] asked: Tell me more about these parts: /, when('send')), '7. as a conversation about the card');
  writeFileSync(join(shots, 'log-edit.txt'), run.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
  writeFileSync(join(shots, 'sent-edit.json'), JSON.stringify(['commands', 'more', 'keep', 'ask', 'questions'].flatMap((t) => run.sent(t)), null, 2));

  // Another preview, as after a restart or on a second headset: it draws a line there, and an undo at the service takes it back.
  const second = stand.launch(shots, 'again', 18, ['-pickRef', `note:agent-${pick.id}`, '-pickAt', '8', '-zoomAt', '9.5', '-toolAt', '11', '-tool', 'pen', '-drawAt', '12']);
  await until(second.log, /^\[agent\] connected/);
  stand.inject({ t: 'navigate', treeId: tree.id, nodeId: root.id, yours: true });
  const shownAgain = await until(second.log, /^\[cards\] opened with \d+ edits/);
  check(shownAgain && /^\[cards\] opened with 3 edits/.test(shownAgain.line), `8. a second preview opens the card with its edits (${shownAgain?.line})`);
  const drawnThere = await until(second.log, /^\[cards\] drew a line/);
  await until(second.log, /^\[cards\] 4 edits on /);
  const undoneAt = second.at();
  await undo();
  const undone = await until(second.log, /^\[cards\] 3 edits on /, undoneAt);
  check(drawnThere && undone, `8. the line drawn there comes back from the service, and an undo there takes it off the card (${undone?.line})`);
  await second.done;

  // A video of the service's: a stretch, a second in its place, an undo, and Send.
  const film = before.nodes.find((n) => items.get(n.itemId)?.source?.from === 'library' && items.get(n.itemId)?.data?.library?.kind === 'film');
  if (!film) throw new Error('no tree here has a film of the library on it');
  const filmRef = `film:${items.get(film.itemId).data.library.key}`;
  const video = stand.launch(shots, 'stretch', 26, ['-pickRef', filmRef, '-pickAt', '8', '-zoomAt', '9.5', '-toolAt', '11', '-tool', 'pen',
    '-acrossPictureAt', '12', '-acrossPictureAgainAt', '14.5', '-toolAt2', '21', '-tool2', 'send']);
  await until(video.log, /^\[agent\] connected/);
  stand.inject({ t: 'navigate', treeId: film.treeId, nodeId: rootOf(film.treeId), yours: true });
  const stretches = () => video.sent('commands').flatMap((m) => m.commands).filter((c) => c.type === 'addEdit' && c.id === film.id && c.edit.kind === 'stretch');
  for (let i = 0; i < 400 && stretches().length < 2; i++) await later(0.1);
  const [first, again] = stretches().map((c) => c.edit);
  const replaced = await settled(film.id, (e) => e.some((x) => x.id === again?.id));
  const undoneStretchAt = video.at();
  await undo();
  const back = await settled(film.id, (e) => e.some((x) => x.id === first?.id));
  const shownBack = first && (await until(video.log, new RegExp(`^\\[cards\\] the card shows the stretch from ${clock(first.from)} to ${clock(first.to)}$`), undoneStretchAt));
  await video.done;
  check(first && first.from >= 0 && first.from < first.to && find(video.log, /^\[cards\] marked the stretch from /),
    `9. with the pen up a drag along the video keeps a stretch with the card (${first && `${clock(first.from)} to ${clock(first.to)}`})`);
  check(again && again.id !== first?.id && replaced.length === 1 && replaced[0].id === again.id && again.from > first.to,
    `9. a second stretch takes the first's place at the service, one a card (${replaced.map((e) => `${e.kind} ${clock(e.from)} to ${clock(e.to)}`).join(', ')})`);
  check(back.length === 1 && back[0].id === first?.id && shownBack, `9. one undo brings the first back, and the card shows it (${shownBack?.line})`);
  const toldStretch = video.sent('ask');
  const askedStretch = first && `Tell me more about this part: the stretch from ${clock(first.from)} to ${clock(first.to)}`;
  check(toldStretch.length === 1 && toldStretch[0].nodeId === film.id && toldStretch[0].need === askedStretch, `9. Send asks about the stretch by its times (${JSON.stringify(toldStretch[0])})`);
  writeFileSync(join(shots, 'log-stretch.txt'), video.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));

  // A picture of the service's: two lines across it, both kept.
  const still = before.nodes.find((n) => items.get(n.itemId)?.kind === 'image' && own(n) && n.status === 'kept' && !(n.edits ?? []).length);
  if (!still) throw new Error('no tree here has a picture of the user\'s own kept on it');
  const drawing = stand.launch(shots, 'picture', 18, ['-pickRef', `note:agent-${still.id}`, '-pickAt', '8', '-zoomAt', '9.5', '-toolAt', '11', '-tool', 'pen',
    '-acrossPictureAt', '12', '-acrossPictureAgainAt', '14.5']);
  await until(drawing.log, /^\[agent\] connected/);
  stand.inject({ t: 'navigate', treeId: still.treeId, nodeId: rootOf(still.treeId), yours: true });
  await drawing.done;
  const lines = drawing.sent('commands').flatMap((m) => m.commands).filter((c) => c.type === 'addEdit' && c.id === still.id);
  const onPicture = await settled(still.id, (e) => e.length === 2);
  check(lines.length === 2 && lines.every((c) => c.edit.kind === 'stroke') && onPicture.length === 2 && onPicture.every((e) => e.kind === 'stroke'),
    `10. two drags across a picture draw two lines, and the card keeps both (${onPicture.map((e) => `${e.kind} of ${e.points.length / 2} points`).join(', ')})`);
  writeFileSync(join(shots, 'log-picture.txt'), drawing.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));

  // The ring round a long pinch shows for a third of a second: a preview whose clock runs a frame at a time takes its picture
  // as it fills, 0.3 s into the hold.
  const ring = stand.launch(shots, 'ring', 12, ['-pickRef', `note:agent-${(other ?? pick).id}`, '-pickAt', '8', '-zoomAt', '9.5', '-longPinchAt', '11.7'], { realtime: false });
  await until(ring.log, /^\[agent\] connected/);
  stand.inject({ t: 'navigate', treeId: tree.id, nodeId: root.id, yours: true });
  await ring.done;
  check(find(ring.log, /^\[cards\] the ring fills$/) && !find(ring.log, /^\[cards\] a long pinch/), `the picture ${join(shots, 'ring.png')} is taken while the ring fills`);
  writeFileSync(join(shots, 'log-again.txt'), second.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
