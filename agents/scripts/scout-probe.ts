/**
 * Runs the Scout once against the saved mindstorm and prints what it would bring. Nothing is saved to the mindstorm.
 * Usage: tsx scripts/scout-probe.ts "<words from a card title>" ["what the user asks for"]
 *    or: tsx scripts/scout-probe.ts "new:<a thought to drop in>" ["what the user asks for"]
 */
import { join } from 'node:path';
import { DEFAULT_SETTINGS, makeItem, makeNode, type RoleContext } from '../src/core/roles/types.ts';
import { scout } from '../src/core/roles/scout.ts';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { SqliteStore } from '../src/node/store.ts';
import { makeTools } from '../src/node/tools.ts';

const env = loadEnv();
const dataDir = env.MIND_PALACE_DATA ?? join(import.meta.dirname, '../data');
const started = Date.now();
const at = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const model = new MetaModel({ apiKey: env.MODEL_API_KEY ?? '', onCall: (c) => console.log(`  [${at()}] ${c.kind} ${c.role} ${c.ok ? 'ok' : 'FAILED'} ${c.ms}ms ${c.tokens ?? ''}`) });
if (process.env.SHOW_CHOICES) {
  // Prints what the model was offered and what it chose, to judge whether a rejection was fair.
  const json = model.json.bind(model);
  model.json = (async (req: Parameters<typeof json>[0]) => {
    const out = await json(req);
    if (req.role === 'scout.curate') {
      const lines = req.user.split('\n');
      console.log(`\n## CHOICE ${lines[0]!.slice(0, 260)}\n   ${lines.find((l) => l.startsWith('A search of'))}`);
      lines.forEach((l, i) => /^\d+\. /.test(l) && console.log(`   ${l.slice(0, 150)}\n        ${(lines[i + 1] ?? '').trim().slice(0, 240)}`));
      console.log(`   => ${JSON.stringify(out).slice(0, 500)}`);
    }
    return out;
  }) as typeof model.json;
}
const assets = new DiskAssets(join(dataDir, 'assets'));
let n = 0;
const newId = () => `probe-${++n}`;
const now = () => new Date().toISOString();
const mind = new Mindstorm({ now, newId });
mind.load(new SqliteStore(join(dataDir, 'mindstorm.sqlite')).all());

const ctx: RoleContext = {
  mind, model, assets, newId, now,
  tools: makeTools({ model, assets, keys: env }),
  settings: { ...DEFAULT_SETTINGS },
  note: (role, message) => console.log(`  note ${role}: ${message}`),
};
const wanted = process.argv[2] ?? '';
let anchor = [...mind.nodes.values()].find((node) => node.status === 'kept' && mind.itemOf(node.id).title.toLowerCase().includes(wanted.toLowerCase()));
if (wanted.startsWith('new:')) {
  const USER = { by: 'user' as const };
  const item = makeItem(ctx, { kind: 'text', title: wanted.slice(4).slice(0, 80), text: wanted.slice(4), origin: USER, source: { from: 'paste' } });
  const treeId = newId();
  const root = makeNode(ctx, item, { treeId, parent: null, status: 'kept', why: '', origin: USER });
  mind.apply({ origin: USER, label: 'probe', commands: [{ type: 'addItem', item }, { type: 'createTree', tree: { id: treeId, title: item.title, rootId: root.id, digest: item.title, createdAt: now() }, root }] });
  anchor = root;
}
if (!anchor) throw new Error(`no kept card with "${wanted}" in its title`);
console.log(`anchor: "${mind.itemOf(anchor.id).title}" (${mind.itemOf(anchor.id).kind})`);

const show = (label: string, commands: Awaited<ReturnType<typeof scout>>) => {
  console.log(`\n== ${label} at ${at()}`);
  const whys = new Map(commands.flatMap((c) => (c.type === 'addNode' ? [[c.node.itemId, c.node.why] as const] : [])));
  for (const c of commands) {
    if (c.type === 'addItem') {
      const i = c.item;
      console.log(`- [${i.kind} via ${i.origin.tool}] ${i.title}\n    thread: ${whys.get(i.id)}\n    ${i.summary}${i.source.url ? `\n    source: ${i.source.url}` : ''}${i.source.asset ? `\n    asset: ${assets.url(i.source.asset)}` : ''}${i.data.steps ? `\n    steps: ${JSON.stringify(i.data.steps)}` : ''}${i.data.chart ? `\n    chart: ${JSON.stringify(i.data.chart)}` : ''}\n    text: ${i.text.replace(/\s+/g, ' ').slice(0, 260)}`);
    } else if (c.type !== 'addNode') console.log(`- ${c.type}`);
  }
};
const rest = await scout(ctx, { anchor: anchor.id, need: process.argv[3], mode: 'more', deliver: (commands) => show('delivered early', commands) });
show('returned', rest);
console.log(`\ntokens: ${model.spent}`);
