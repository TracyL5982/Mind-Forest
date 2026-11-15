import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Id } from '../src/core/domain.ts';
import { Pipeline, type Outbound } from '../src/core/pipeline.ts';
import { roles } from '../src/core/roles/index.ts';
import { DEFAULT_SETTINGS, type Handoff } from '../src/core/roles/types.ts';
import { Mindstorm } from '../src/core/state.ts';
import { DiskAssets } from '../src/node/assets.ts';
import { loadEnv } from '../src/node/env.ts';
import { MetaModel } from '../src/node/model-meta.ts';
import { SqliteStore } from '../src/node/store.ts';
import { makeTools } from '../src/node/tools.ts';

/**
 * The whole system against the live model, end to end, with no client:
 * dump a thought into the knowledge base, ask for a tree that draws on it, dump mixed things, ask, ask for more, keep,
 * organize, delete and undo, package a handoff.
 * Prints what a user would see and a list of checks. Exits non-zero if a check fails.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data-scenario');
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const env = loadEnv();
if (!env.MODEL_API_KEY) throw new Error('MODEL_API_KEY is not set');

const tally = { calls: 0, failed: 0, tokens: 0, ms: 0 };
const model = new MetaModel({
  apiKey: env.MODEL_API_KEY,
  model: env.MUSE_LLM_MODEL || undefined,
  onCall: (c) => {
    tally.calls++;
    tally.tokens += c.tokens ?? 0;
    tally.ms += c.ms;
    if (!c.ok) tally.failed++;
    console.log(`      · model ${c.kind} ${c.role} ${c.ok ? 'ok' : 'FAILED'} ${(c.ms / 1000).toFixed(1)}s`);
  },
});

const mind = new Mindstorm({ now: () => new Date().toISOString(), newId: () => randomUUID() });
const assets = new DiskAssets(join(dataDir, 'assets'));
const said: string[] = [];
const notes: string[] = [];
const handoffs: Handoff[] = [];
const navigations: { nodeId?: Id; treeId?: Id }[] = [];
const emit = (m: Outbound) => {
  if (m.t === 'say') (said.push(m.text), console.log(`      “${m.text}”`));
  if (m.t === 'note') (notes.push(`${m.role}: ${m.message}`), console.log(`      note ${m.role}: ${m.message}`));
  if (m.t === 'handoff') handoffs.push(m.handoff);
  if (m.t === 'navigate') navigations.push(m);
};
const pipeline = new Pipeline({
  mind,
  roles,
  model,
  tools: makeTools({
    model,
    assets,
    instagram: env.META_IG_TOKEN && env.META_IG_USER_ID ? { token: env.META_IG_TOKEN, userId: env.META_IG_USER_ID } : undefined,
  }),
  assets,
  store: new SqliteStore(join(dataDir, 'mindstorm.sqlite')),
  settings: { ...DEFAULT_SETTINGS },
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  emit,
  settleMs: 50,
});

const checks: { ok: boolean; what: string }[] = [];
const check = (ok: boolean, what: string) => {
  checks.push({ ok, what });
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${what}`);
};
const step = (title: string) => console.log(`\n== ${title}`);

function outline(): void {
  for (const tree of mind.trees.values()) {
    console.log(`   TREE ${tree.title}`);
    for (const n of mind.treeNodes(tree.id)) {
      const item = mind.item(n.itemId);
      const thread = n.parent === null ? '' : n.status === 'pick' ? '┄┄ ' : '── ';
      console.log(
        `   ${'   '.repeat(mind.depth(n.id))}${thread}[${n.view.component}] ${item.title.slice(0, 70)}${n.why ? `  (${n.why})` : ''}`,
      );
    }
    for (const g of mind.groups.values()) if (g.treeId === tree.id) console.log(`      group ${g.composite} "${g.title}" × ${g.members.length}`);
  }
  for (const l of mind.links.values()) {
    console.log(`   LINK ${mind.itemOf(l.a).title.slice(0, 40)} ⇠⇢ ${mind.itemOf(l.b).title.slice(0, 40)}  (${l.why}, ${l.strength})`);
  }
}

const treeOf = (word: string) =>
  [...mind.trees.values()].find((t) => mind.treeNodes(t.id).some((n) => new RegExp(word, 'i').test(`${mind.item(n.itemId).title} ${mind.item(n.itemId).text}`)));

// ---------------------------------------------------------------------------

step('1. Dump a thought, then ask for a tree');
await pipeline.dump([{ kind: 'text', text: 'The dolly zoom in Vertigo makes dread out of pure geometry: the subject stays the same size while the room stretches away.' }]);
await pipeline.idle();
check(mind.trees.size === 0 && mind.unplaced().length === 1, 'the thought went into the knowledge base and started no tree');
const thought = mind.unplaced()[0]!;
pipeline.utter('make a tree about the dolly zoom', { selection: [] }, true);
await pipeline.idle();
outline();
const film = treeOf('dolly|vertigo');
check(film !== undefined, 'asking made a tree');
const filmRoot = film!.rootId;
const firstPicks = mind.picks(filmRoot);
check(firstPicks.length >= 3 && firstPicks.length <= 10, `the agent hung picks off it, at most ten (${firstPicks.length})`);
check(firstPicks.some((p) => p.itemId === thought.id), 'the thought dropped earlier came into the first round, as itself');
check(firstPicks.some((p) => mind.item(p.itemId).origin.by === 'agent'), 'new content came too');
check(firstPicks.every((p) => mind.item(p.itemId).kind !== 'link'), 'no pick is a bare link');
check(mind.picks(filmRoot).every((p) => p.status === 'pick'), 'picks are provisional (dashed) until kept');

step('2. Dump an unrelated thought that asks for a tree, a link, a picture and a chat transcript');
const picture = await assets.put(new Uint8Array(readFileSync(resolve(root, '../visionos/MindPalace/Resources/Ocean/vertigo-mirror.jpg'))), 'image/jpeg', 'vertigo-mirror.jpg');
await pipeline.dump([
  { kind: 'text', text: 'Sourdough starter: feed it 1:5:5 at night when the kitchen is cold, 1:2:2 when it is warm. Hydration around 75% for an open crumb. Start a tree on this.' },
  { kind: 'link', url: 'https://en.wikipedia.org/wiki/Jaws_(film)' },
  { kind: 'asset', asset: picture.id, mime: 'image/jpeg', name: 'vertigo-mirror.jpg' },
  {
    kind: 'text',
    text: [
      'User: I want to shoot a short film with one dolly zoom. Where should it go?',
      'Assistant: Put it at the moment the character realises something irreversible. In Jaws it lands when Brody sees the attack: the beach he trusted becomes hostile. Save it for one beat only; a second use weakens the first.',
      'User: How do I do it without a dolly?',
      'Assistant: Use a slider or even a wheelchair, and a zoom lens of at least 24-70mm. Mark the start and end points, and rehearse the zoom pull against the move so the subject keeps the same size in frame.',
    ].join('\n'),
  },
]);
await pipeline.idle();
outline();
const bread = treeOf('sourdough');
check(bread !== undefined && bread.id !== film!.id, 'the thought that asked for a tree started its own');
check(mind.trees.size === 2, 'nothing else started a tree');
const chat = [...mind.items.values()].find((i) => i.kind === 'chat');
check(chat !== undefined && Array.isArray(chat.data.messages) && (chat.data.messages as unknown[]).length === 4, 'the pasted chat was read as a 4-message conversation');
const image = [...mind.items.values()].find((i) => i.kind === 'image' && i.origin.by === 'user');
check(image !== undefined && image.summary.length > 20, `the picture was looked at and described: "${image?.summary.slice(0, 90)}"`);
const jaws = [...mind.items.values()].find((i) => i.kind === 'link' && i.origin.by === 'user');
check(jaws !== undefined && /jaws/i.test(jaws.title), `the link was read: "${jaws?.title}"`);
const breadNodes = new Set(mind.treeNodes(bread!.id).map((n) => n.id));
check(![...mind.links.values()].some((l) => breadNodes.has(l.a) !== breadNodes.has(l.b)), 'no link was drawn between the bread tree and anything else');

step('3. Speak a need while looking at the first card');
const before = new Set(mind.picks(filmRoot).map((p) => p.itemId));
pipeline.utter('I need examples of this from horror films', { focus: filmRoot, selection: [], treeId: film!.id }, false);
await new Promise((r) => setTimeout(r, 200));
pipeline.utter('I need examples of this from horror films', { focus: filmRoot, selection: [], treeId: film!.id }, true);
await pipeline.idle();
outline();
const after = mind.picks(filmRoot);
check(after.length >= 3 && after.every((p) => !before.has(p.itemId)), 'the picks were replaced to match what was asked');
check(after.some((p) => /horror|shining|poltergeist|jaws|exorcist|scream|fear|terror/i.test(`${mind.item(p.itemId).title} ${mind.item(p.itemId).summary}`)), 'the new picks are about horror films');
check(said.length >= 1, `the agent said something back: "${said.at(-1)}"`);

step('4. Say "more"');
const count = mind.picks(filmRoot).length;
pipeline.utter('more', { focus: filmRoot, selection: [], treeId: film!.id }, true);
await pipeline.idle();
const grown = mind.picks(filmRoot);
check(grown.length > count, `more picks were added without removing any (${count} → ${grown.length})`);
const urls = grown.map((p) => mind.item(p.itemId).source.url).filter(Boolean);
check(new Set(urls).size === urls.length, 'no pick repeats a page');

step('5. Keep a pick, by voice');
pipeline.utter('keep the first one', { focus: filmRoot, selection: [], treeId: film!.id }, true);
await pipeline.idle();
check(mind.children(filmRoot).some((n) => n.status === 'kept' && mind.item(n.itemId).origin.by === 'agent'), 'one agent pick is now kept (solid)');

step('6. Organize by voice, then delete and undo');
pipeline.utter('rename this tree to Dread by geometry and drop the suggestions I have not kept', { focus: filmRoot, selection: [], treeId: film!.id }, true);
await pipeline.idle();
outline();
check(mind.tree(film!.id).title.toLowerCase().includes('dread'), `the tree was renamed: "${mind.tree(film!.id).title}"`);
check(mind.picks(filmRoot).length === 0, 'the unkept picks were dropped');
const snapshot = JSON.stringify(mind.snapshot().nodes.map((n) => n.id).sort());
const victim = mind.children(mind.tree(bread!.id).rootId)[0]?.id ?? mind.tree(bread!.id).rootId;
pipeline.userCommands('Delete a card', [{ type: 'deleteNode', id: victim }]);
check(!mind.nodes.has(victim), 'a card was deleted');
pipeline.undo();
check(JSON.stringify(mind.snapshot().nodes.map((n) => n.id).sort()) === snapshot, 'undo brought everything back');

step('7. Navigate by voice');
pipeline.utter('take me to the sourdough tree', { focus: filmRoot, selection: [], treeId: film!.id }, true);
await pipeline.idle();
const went = navigations.at(-1);
check(went !== undefined && (went.treeId === bread!.id || (went.nodeId !== undefined && mind.nodes.get(went.nodeId)?.treeId === bread!.id)), 'the agent navigated to the sourdough tree');

step('8. Package a handoff');
pipeline.utter('package this tree so I can keep working on the short film idea in Claude', { focus: filmRoot, selection: [], treeId: film!.id }, true);
await pipeline.idle();
const handoff = handoffs.at(-1);
check(handoff !== undefined, 'a handoff was made');
if (handoff) {
  writeFileSync(join(dataDir, `${handoff.name}.md`), handoff.markdown);
  writeFileSync(join(dataDir, `${handoff.name}.json`), JSON.stringify(handoff.json, null, 2));
  check(/dolly|vertigo/i.test(handoff.markdown) && !/sourdough/i.test(handoff.markdown), 'it holds the film tree and not the bread tree');
  check(/https?:\/\//.test(handoff.markdown), 'it lists sources');
  console.log(`   written to ${join(dataDir, `${handoff.name}.md`)} (${handoff.markdown.length} characters)`);
  console.log(handoff.markdown.split('\n').slice(0, 24).map((l) => `   | ${l}`).join('\n'));
}

step('9. Formats');
const components = new Map<string, number>();
for (const n of mind.nodes.values()) components.set(n.view.component, (components.get(n.view.component) ?? 0) + 1);
console.log(`   components in use: ${[...components].map(([c, n]) => `${c} × ${n}`).join(', ')}`);
console.log(`   composites in use: ${[...mind.groups.values()].map((g) => g.composite).join(', ') || 'none'}`);
check(components.size >= 3, 'at least three different components are in use');

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed.`);
console.log(`Model calls: ${tally.calls} (${tally.failed} failed), ${tally.tokens} tokens, ${(tally.ms / 1000).toFixed(0)}s of model time.`);
console.log(`Fallback notes: ${notes.length}`);
for (const f of failed) console.log(`FAILED: ${f.what}`);
process.exit(failed.length > 0 ? 1 : 0);
