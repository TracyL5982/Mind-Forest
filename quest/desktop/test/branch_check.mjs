// Runs the Mac preview against the fake service on a fresh copy of a data folder (standin.mjs) and checks, for each tree,
// that it stands as a tree grown in the app would, and that every branch of it can be reached by hand:
//   1. every card with cards under it leads their layer, and a tree nobody has stood in stands on its deepest layer: of
//      layers as deep, the first reached taking at each fork the first card in the service's order (`[agent] tree "…": …`);
//   2. gone to as a tree, it stands there;
//   3. from there each branch is reached by hand: a step back a layer at a time to the root's, as the fist takes one, then a
//      pinch on each card on the way to the branch, each in sight on the layer that stands then, and the last goes into the
//      branch's own layer (`-script`);
//   4. a last preview, as after a restart, finds each tree on the layer it was left on, the last branch gone into.
// One preview for each tree, its clock a frame at a time, and one more for 4.
//
//   quest/desktop/build.sh && node quest/desktop/test/branch_check.mjs --data <data folder> [--trees "<title>|<title>"] [--shots <folder>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checker, escape, flag, standIn, until } from './standin.mjs';

const stand = await standIn('branch-check', flag('--data'));
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();
// `[agent] tree "<title>": <n> cards, <l> layers, <k> cards leading one; it stands on layer <d>, of <title> (<node id>)[, where it was left]`
const planting = (title) => new RegExp(`^\\[agent\\] tree "${escape(title)}": (\\d+) cards, (\\d+) layers, (\\d+) cards leading one; it stands on layer (\\d+), of .* \\(([^()]+)\\)(, where it was left)?$`);
try {
  const before = await stand.state();
  const items = new Map(before.items.map((i) => [i.id, i]));
  const named = flag('--trees')?.split('|');
  const trees = before.trees.filter((t) => !named || named.includes(t.title));
  // A card's cards in the service's order, as the headset takes them (`Mirror::children`).
  const kidsOf = (id) => before.nodes.filter((n) => n.parent === id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const branch = (n) => before.nodes.some((c) => c.parent === n.id);
  const pathTo = (n) => (n.parent ? [...pathTo(before.nodes.find((p) => p.id === n.parent)), n] : [n]);
  // The headset names a card by its library piece when it is one; a work of the library is not named by flag here.
  const refOf = (n) => {
    const library = items.get(n.itemId)?.source?.from === 'library' ? items.get(n.itemId).data?.library : null;
    if (library) return library.kind === 'film' ? `film:${library.key}` : null;
    return `note:agent-${n.id}`;
  };
  const left = new Map();
  for (const tree of trees) {
    const root = before.nodes.find((n) => n.id === tree.rootId);
    // Every branch but the root, depth first in the service's order, as a judge might go through them.
    const branches = [];
    const visit = (n) => {
      for (const k of kidsOf(n.id)) {
        if (branch(k)) branches.push(k);
        visit(k);
      }
    };
    visit(root);
    const layers = Math.max(1, ...branches.map((b) => pathTo(b).length));
    // (`branches` is in that order already.)
    const first = branches.find((b) => pathTo(b).length === layers) ?? root;
    const named = branches.filter((b) => pathTo(b).slice(1).every(refOf));
    const steps = named.flatMap((b) => [...Array(layers - 1).fill('back'), ...pathTo(b).slice(1).map(refOf)]);
    const at = 6, every = 0.6;
    // (Ten quiet seconds at the end, for the headset to settle and write down where the tree was left.)
    const run = stand.launch(shots, `walk-${tree.id.slice(0, 12)}`, at + steps.length * every + 10,
      ['-script', steps.join('|'), '-scriptAt', String(at), '-scriptEvery', String(every), '-shotEvery', '100000'], { realtime: false });
    await until(run.log, /^\[agent\] connected/);
    const planted = await until(run.log, planting(tree.title), 0, 10);
    const [, , , leading, onLayer, standsOn] = planted ? planting(tree.title).exec(planted.line) : [];
    const leads = before.nodes.filter((n) => n.treeId === tree.id && branch(n)).length;
    check(Number(leading) === leads, `"${tree.title}" arrives as a tree: ${leading ?? 'no'} of its ${leads} cards with cards lead their layer`);
    check(standsOn === first.id, `1. it stands on its deepest layer, ${onLayer ?? '?'} of ${layers}, of "${items.get(first.itemId)?.title}" (${standsOn === first.id ? 'so it does' : `it stands on ${standsOn}`})`);
    stand.inject({ t: 'navigate', treeId: tree.id, yours: true });
    const went = await until(run.log, new RegExp(`^\\[agent\\] went to .* in "${escape(tree.title)}" \\((.+)\\), on the layer of`), 0, 20);
    check(went && went.line.includes(`(${first.id}), on the layer of ${first.id}`), `2. gone to as a tree, it stands there (${went?.line.replace(/^\[agent\] /, '') ?? 'not gone to'})`);
    await run.done;
    writeFileSync(join(shots, `log-walk-${tree.id.slice(0, 12)}.txt`), run.log.map((l) => `${l.at.toFixed(2).padStart(7)} ${l.line}`).join('\n'));
    // Each step's own line, in turn.
    const said = run.log.filter((l) => l.line.startsWith('[ocean] script: ')).map((l) => l.line.slice('[ocean] script: '.length));
    let k = 0;
    const unreached = [];
    for (const b of named) {
      const mine = said.slice(k, k + layers - 1 + pathTo(b).length - 1);
      k += layers - 1 + pathTo(b).length - 1;
      const pinches = mine.filter((s) => s.startsWith('pinched '));
      // `pinched <ref>, in sight on layer <d> while layer <t> stood; now on layer <n>, of <ref>`
      const blind = pinches.filter((s) => !/, in sight on layer (\d+) while layer \1 stood;/.test(s));
      const last = /now on layer (\d+), of (.+)$/.exec(pinches.at(-1) ?? '');
      const ref = refOf(b);
      const inside = last && Number(last[1]) === pathTo(b).length && (!ref.startsWith('note:') || last[2] === ref);
      if (!(mine.length && blind.length === 0 && inside)) unreached.push(`"${items.get(b.itemId)?.title}"${blind.length ? `: ${blind[0]}` : `: ${pinches.at(-1) ?? 'no pinch'}`}`);
    }
    check(said.length === steps.length && unreached.length === 0,
      `3. every branch is reached by hand, stepping back to the root's layer and pinching down to it: ${named.length - unreached.length} of ${named.length}${branches.length > named.length ? ` (${branches.length - named.length} under a work of the library, which no flag names)` : ''}${unreached.length ? `; not: ${unreached.slice(0, 3).join('; ')}` : ''}`);
    if (named.length) left.set(tree.id, named.at(-1));
  }
  // A last preview, as after a restart: each tree stands where it was left.
  const again = stand.launch(shots, 'again', 6, ['-shotEvery', '100000'], { realtime: false });
  await until(again.log, /^\[agent\] connected/);
  for (const tree of trees) {
    const planted = await until(again.log, planting(tree.title), 0, 10);
    const [, , , , onLayer, standsOn, remembered] = planted ? planting(tree.title).exec(planted.line) : [];
    const was = left.get(tree.id);
    if (!was) continue;
    check(standsOn === was.id && remembered, `4. "${tree.title}" stands again where it was left, on layer ${onLayer} of "${items.get(was.itemId)?.title}" (${standsOn === was.id ? 'so it does' : `it stands on ${standsOn}`})`);
  }
  await again.done;
  writeFileSync(join(shots, 'log-again.txt'), again.log.map((l) => `${l.at.toFixed(2).padStart(7)} ${l.line}`).join('\n'));
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
