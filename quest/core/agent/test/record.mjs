// Records one session with the scripted service as fixtures for the C++ tests.
//   cd agents && MIND_PALACE_PORT=8790 MIND_PALACE_DATA=<an empty folder> npm run dev:fake
//   node quest/core/agent/test/record.mjs <that folder> [port]
// fixtures/session.jsonl is every message of the first connection, as sent; fixtures/hello.json is
// the hello of a second connection made at the end; fixtures/sent.jsonl is what this script sent.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [dataDir, port = '8790'] = process.argv.slice(2);
if (!dataDir) {
  console.error('usage: node record.mjs <service data folder> [port]');
  process.exit(2);
}
const token = readFileSync(`${dataDir}/token`, 'utf8').trim();
const url = `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`;
const fixtures = new URL('./fixtures/', import.meta.url);
const QUIET_MS = 1500;

function connect() {
  const ws = new WebSocket(url);
  const texts = [];
  let last = Date.now();
  ws.addEventListener('message', (e) => {
    texts.push(String(e.data));
    last = Date.now();
  });
  const opened = new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => fail(new Error(`could not connect to ${url}`)), { once: true });
  });
  const quiet = async () => {
    await new Promise((r) => setTimeout(r, 300));
    while (Date.now() - last < QUIET_MS) await new Promise((r) => setTimeout(r, 100));
  };
  return { ws, texts, opened, quiet };
}

const sent = [];
const a = connect();
await a.opened;
await a.quiet();

async function send(message) {
  console.log(`send ${message.t}`);
  sent.push(JSON.stringify(message));
  a.ws.send(JSON.stringify(message));
  await a.quiet();
}

const messages = () => a.texts.map((t) => JSON.parse(t));
const changes = () => messages().filter((m) => m.t === 'change').map((m) => m.set);
const nodesNow = () => {
  const nodes = new Map();
  for (const set of changes()) {
    for (const p of set.patches) {
      if (p.entity !== 'node') continue;
      if (p.after === null) nodes.delete(p.id);
      else nodes.set(p.id, p.after);
    }
  }
  return [...nodes.values()];
};

await send({ t: 'dump', dumps: [{ kind: 'text', text: 'Dolly zoom\nThe camera moves away while zooming in, so the subject stays the same size and the background swells behind it.' }] });
const root = nodesNow().find((n) => n.parent === null);
if (!root) throw new Error('the dump made no tree');
const picks = () => nodesNow().filter((n) => n.parent === root.id && n.status === 'pick');
const [first, second] = picks();
if (!second) throw new Error('the Scout brought fewer than two picks');

await send({ t: 'keep', nodeIds: [first.id] });
await send({ t: 'focus', nodeId: first.id });
await send({ t: 'commands', label: 'Cut a card', commands: [{ type: 'deleteNode', id: second.id }] });
await send({ t: 'undo' });
await send({ t: 'settings', patch: { picksPerRun: 3 } });
await send({ t: 'utter', text: 'more like this', final: true, scene: { focus: root.id, selection: [], treeId: root.treeId } });
await send({ t: 'handoff', scope: { treeIds: [], nodeIds: [] } });
await send({ t: 'keep', nodeIds: [] });
a.ws.close();

const b = connect();
await b.opened;
await b.quiet();
b.ws.close();

mkdirSync(fixtures, { recursive: true });
writeFileSync(new URL('session.jsonl', fixtures), a.texts.join('\n') + '\n');
writeFileSync(new URL('hello.json', fixtures), b.texts[0] + '\n');
writeFileSync(new URL('sent.jsonl', fixtures), sent.join('\n') + '\n');

const kinds = new Map();
for (const m of messages()) kinds.set(m.t, (kinds.get(m.t) ?? 0) + 1);
console.log(`recorded ${a.texts.length} messages:`, Object.fromEntries(kinds));
const seqs = changes().map((s) => s.seq);
console.log('change set seqs:', seqs.join(' '));
console.log('second hello seq:', JSON.parse(b.texts[0]).snapshot.seq);
