// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and checks the rule for
// opening a card and starting a layer, from the preview's log and from what it sends the service:
//   1. a pinch on a card of the service's tree opens it where it stands: no layer starts, and neither a focus nor an ask
//      reaches the service; the other cards keep their places, only those under the open card step aside, and none is
//      left under it
//   2. a question picked under it is a conversation about it: it is kept, leads a layer of its own, the service hears
//      the ask, and the picks the service brings stand on that layer
//   3. a card that already leads a layer is gone to, the root and then the asked card again: the same two layers, and
//      no ask
// The tree is the first whose root and one of whose suggestions are the user's own (not the headset's library), so a
// pinch can name them by flag (`-pickRef note:agent-<node id>`).
//
//   quest/desktop/build.sh && node quest/desktop/test/layer_check.mjs --data <data folder> [--shots <folder>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, find, flag, standIn, until } from './standin.mjs';

const stand = await standIn('layer-check', flag('--data'));
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();

const before = await stand.state();
const items = new Map(before.items.map((i) => [i.id, i]));
const node = (id) => before.nodes.find((n) => n.id === id);
const own = (n) => n && items.get(n.itemId)?.source?.from !== 'library';
const childrenOf = (snapshot, id) => snapshot.nodes.filter((n) => n.parent === id);
const tree = before.trees.find((t) => own(node(t.rootId)) && childrenOf(before, t.rootId).some((n) => n.status === 'pick' && own(n) && childrenOf(before, n.id).length === 0));
if (!tree) throw new Error('no tree here has a root and a suggestion of the user\'s own');
const root = node(tree.rootId);
const pick = childrenOf(before, root.id).find((n) => n.status === 'pick' && own(n) && childrenOf(before, n.id).length === 0);
console.log(`tree "${tree.title}": the root ${root.id}, the suggestion ${pick.id} "${items.get(pick.itemId).title}"`);

const [opened, asked, back, again, end] = [8, 12, 18, 22, 26];
const run = stand.launch(shots, 'layers', end, [
  '-placesAt', String(opened - 1), '-placesAgainAt', String(asked - 1),
  '-pickRef', `note:agent-${pick.id}`, '-pickAt', String(opened),
  '-askAt', String(asked), '-ask', '1',
  '-pickRef2', `note:agent-${root.id}`, '-pickAt2', String(back),
  '-pickRef3', `note:agent-${pick.id}`, '-pickAt3', String(again),
]);
try {
  await until(run.log, /^\[agent\] connected/);
  stand.inject({ t: 'navigate', treeId: tree.id, yours: true });
  await run.done;

  // `[ocean] layers: root > [asked] | in focus: … | n on this layer in g groups, …`: the layers in line, the one stood on in brackets.
  const layers = (from, to = Infinity) =>
    run.log
      .filter((l) => l.at >= from && l.at < to)
      .map((l) => /^\[ocean\] layers: (.*) \| in focus: (.*) \| (\d+) on this layer in (\d+) groups/.exec(l.line))
      .filter(Boolean)
      .map(([, steps, focus, onLayer]) => {
        const route = steps.split(' > ');
        return { route: route.map((s) => s.replace(/^\[|\]$/g, '')), stands: route.findIndex((s) => s.startsWith('[')), focus, onLayer: Number(onLayer) };
      });
  const last = (from, to) => layers(from, to).at(-1);
  const sentBetween = (t, from, to = Infinity) => run.sent(t).filter((m) => m.at >= from && m.at < to);
  const went = find(run.log, /^\[agent\] went to /);
  check(went && went.at < opened, `the tree stands on its root's layer before the pinch (${went?.line})`);

  const open = last(opened, asked);
  check(find(run.log, /^\[agent\] opened /, opened), `1. a pinch on the suggestion opens it where it stands (${find(run.log, /^\[agent\] opened /, opened)?.line})`);
  check(open && open.route.length === 1 && open.stands === 0, `1. and no layer starts: one layer, the root's, still stands (${open?.route.length} layers)`);
  // `[ocean] place x y half down up open title`: where each card on the layer is headed, and how far it reaches, m.
  const places = (flagName) => {
    const from = run.log.findIndex((l) => l.line === `[ocean] -${flagName} runs`);
    const out = [];
    for (let i = from + 1; from >= 0 && i < run.log.length; i++) {
      const m = /^\[ocean\] place (\S+) (\S+) (\S+) (\S+) (\S+) (\d) (.*)$/.exec(run.log[i].line);
      if (!m) break;
      const [x, y, half, down, up] = m.slice(1, 6).map(Number);
      out.push({ x, y, lo: [x - half, y - down], hi: [x + half, y + up], open: m[6] === '1', title: m[7] });
    }
    return out;
  };
  const overlap = (a, b, by = 0.003) => a.lo[0] < b.hi[0] - by && b.lo[0] < a.hi[0] - by && a.lo[1] < b.hi[1] - by && b.lo[1] < a.hi[1] - by;
  const was = places('placesAt'), now = places('placesAgainAt');
  const openCard = now.find((p) => p.open);
  const moved = now.filter((p) => !p.open).map((p) => {
    const then = was.find((q) => q.title === p.title);
    return { p, then, far: then ? Math.hypot(p.x - then.x, p.y - then.y) : NaN };
  });
  const strays = moved.filter(({ then, far }) => !(far < 0.005 || (then && openCard && overlap(then, openCard))));
  const openWas = openCard && was.find((q) => q.title === openCard.title);
  const openMoved = openWas ? Math.hypot(openCard.x - openWas.x, openCard.y - openWas.y) : NaN;
  check(openCard && openMoved < 0.005, `1. the open card grows where it stood (it moved ${openMoved.toFixed(3)} m)`);
  check(openCard && was.length >= 3 && moved.length === was.length - 1 && strays.length === 0,
    `1. the other ${moved.length} cards keep their places; ${moved.filter((m) => m.far >= 0.005).length} under the open card step aside (${strays.map((s) => `"${s.p.title}" moved ${s.far.toFixed(3)} m`).join(', ') || 'no other moves'})`);
  const under = now.filter((p) => !p.open && openCard && overlap(p, openCard));
  check(openCard && under.length === 0, `1. and none is left under the open card (${under.map((p) => `"${p.title}"`).join(', ') || 'none'})`);
  const early = ['focus', 'ask', 'keep', 'utter', 'more'].flatMap((t) => sentBetween(t, opened, asked).map((m) => m.t));
  check(early.length === 0, `1. the service hears no focus and no ask for it (${early.length ? early.join(', ') : 'nothing but its questions'})`);

  const askSent = sentBetween('ask', asked, back);
  const keepSent = sentBetween('keep', asked, back);
  check(askSent.length === 1 && askSent[0].nodeId === pick.id, `2. the picked question reaches the service as an ask about it ("${askSent[0]?.need}")`);
  check(keepSent.length === 1 && keepSent[0].nodeIds.includes(pick.id), '2. asking about a suggestion keeps it');
  const led = layers(asked, back).find((l) => l.route.length === 2 && l.stands === 1);
  check(led, `2. it leads a layer of its own, the second, and that layer stands (${led ? 'standing on layer 2 of 2' : 'never'})`);
  check(sentBetween('focus', asked, back).some((m) => m.nodeId === pick.id), '2. the service hears it is open once it leads a layer');
  const after = await stand.state();
  const brought = childrenOf(after, pick.id);
  const arrived = find(run.log, /^\[agent\] (\d+) new cards$/, asked);
  const standing = last(asked, back);
  check(brought.length > 0 && arrived, `2. the service brought ${brought.length} picks round it (${arrived?.line})`);
  check(standing && standing.stands === 1 && standing.onLayer >= brought.length, `2. and they stand on its layer (${standing?.onLayer} cards on layer 2)`);

  const toRoot = last(back, again);
  check(toRoot && toRoot.route.length === 2 && toRoot.stands === 0, `3. a pinch on the root, which leads a layer, goes back to its layer (standing on layer ${toRoot ? toRoot.stands + 1 : '?'} of ${toRoot?.route.length})`);
  const toPick = last(again);
  check(toPick && toPick.route.length === 2 && toPick.stands === 1, `3. a pinch on the asked card goes to its layer again (standing on layer ${toPick ? toPick.stands + 1 : '?'} of ${toPick?.route.length})`);
  const late = ['ask', 'keep', 'more', 'utter'].flatMap((t) => sentBetween(t, back).map((m) => m.t));
  check(late.length === 0 && !find(run.log, /^\[agent\] opened /, back), `3. with no new layer, no ask and nothing opened where it stands (${late.join(', ') || 'none sent'})`);
  writeFileSync(join(shots, 'log-layers.txt'), run.log.map((l) => `${l.at.toFixed(2).padStart(6)} ${l.line}`).join('\n'));
  writeFileSync(join(shots, 'sent-layers.json'), JSON.stringify(['focus', 'ask', 'keep', 'questions'].flatMap((t) => run.sent(t)), null, 2));
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
