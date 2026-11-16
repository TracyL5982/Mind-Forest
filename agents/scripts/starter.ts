/**
 * Builds the starter trees every new judging space begins with: the trees with the most kept cards in a data folder, with the files
 * they show and the headset's library, as one change set that cannot be undone. Nothing else of the source comes along: no other
 * tree, nothing unplaced, no history, no token and no Telegram pairing. The source is only read, through a copy.
 * Usage: npm run starter -- --from <data folder> [--trees 3] [--tree <id> ...] [--out starter] [--list]
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inLibrary, type ChangeSet, type Patch } from '../src/core/domain.ts';
import { Mindstorm } from '../src/core/state.ts';
import { SqliteStore } from '../src/node/store.ts';

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    trees: { type: 'string', default: '3' },
    tree: { type: 'string', multiple: true },
    out: { type: 'string', default: resolve(import.meta.dirname, '../starter') },
    list: { type: 'boolean', default: false },
  },
});
if (!values.from) throw new Error('--from <data folder> is required');
const from = resolve(values.from);

const copy = mkdtempSync(join(tmpdir(), 'starter-'));
try {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = join(from, `mindstorm.sqlite${suffix}`);
    if (existsSync(file)) copyFileSync(file, join(copy, `mindstorm.sqlite${suffix}`));
  }
  const source = new SqliteStore(join(copy, 'mindstorm.sqlite'));
  const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => 'unused' });
  mind.load(source.all());
  source.close();

  const ranked = [...mind.trees.values()]
    .map((tree) => ({ tree, kept: mind.treeNodes(tree.id).filter((n) => n.status === 'kept').length, cards: mind.treeNodes(tree.id).length }))
    .sort((a, b) => b.kept - a.kept || b.cards - a.cards);
  if (values.list) {
    for (const r of ranked) console.log(`${String(r.kept).padStart(4)} kept ${String(r.cards).padStart(4)} cards  ${r.tree.id}  ${r.tree.title}`);
    process.exit(0);
  }
  const chosen = values.tree?.length ? ranked.filter((r) => values.tree!.includes(r.tree.id)) : ranked.slice(0, Number(values.trees));

  const treeIds = new Set(chosen.map((r) => r.tree.id));
  const nodes = [...mind.nodes.values()].filter((n) => treeIds.has(n.treeId));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const items = [...mind.items.values()].filter((i) => inLibrary(i) || nodes.some((n) => n.itemId === i.id));
  const links = [...mind.links.values()].filter((l) => nodeIds.has(l.a) && nodeIds.has(l.b));
  const groups = [...mind.groups.values()].filter((g) => treeIds.has(g.treeId));
  const created = <E extends Patch['entity']>(entity: E, list: { id: string }[]) => list.map((after) => ({ entity, id: after.id, before: null, after }) as Patch);
  const set: ChangeSet = {
    id: 'starter',
    seq: 1,
    at: new Date().toISOString(),
    // The Archivist's sets are housekeeping, which an undo never takes back, so a judge's first undo cannot empty the space.
    origin: { by: 'agent', role: 'archivist' },
    label: 'Starter trees',
    commands: [],
    patches: [
      ...created('item', items),
      ...created('tree', chosen.map((r) => r.tree)),
      ...created('node', nodes),
      ...created('link', links),
      ...created('group', groups),
    ],
  };

  const out = resolve(values.out!);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  const store = new SqliteStore(join(out, 'mindstorm.sqlite'));
  store.append(set);
  store.close();

  const assetIds = new Set<string>();
  for (const item of items.filter((i) => !inLibrary(i))) {
    if (item.source.asset) assetIds.add(item.source.asset);
    for (const m of JSON.stringify(item).matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)) assetIds.add(m[1]!);
  }
  let bytes = 0;
  let files = 0;
  for (const id of assetIds) {
    for (const name of [id, `${id}.json`]) {
      const file = join(from, 'assets', name);
      if (!existsSync(file)) continue;
      copyFileSync(file, join(out, 'assets', name));
      bytes += statSync(file).size;
      files++;
    }
  }
  // A linked asset names a file on this Mac, which a hosted service does not have.
  const linked = [...assetIds].filter((id) => existsSync(join(out, 'assets', `${id}.json`)) && 'from' in JSON.parse(readFileSync(join(out, 'assets', `${id}.json`), 'utf8'))).length;

  console.log(`starter trees in ${out}:`);
  for (const r of chosen) console.log(`  ${r.tree.title} (${r.kept} kept of ${r.cards} cards, ${r.tree.id})`);
  console.log(`  ${nodes.length} cards, ${items.length} items (${items.filter(inLibrary).length} of the library), ${links.length} links, ${groups.length} groups`);
  console.log(`  ${files} asset files, ${(bytes / 1e6).toFixed(1)} MB${linked ? `; ${linked} linked to files on this Mac, not served when hosted` : ''}`);
} finally {
  rmSync(copy, { recursive: true, force: true });
}
