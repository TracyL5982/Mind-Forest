// Runs the Mac preview against a stand-in service and checks, from the preview's log, how it carries out `navigate`.
// The stand-in serves the recorded session's tree and an older copy of it, transcribes every recording as the same
// words, answers every reply with reply.mp3 (3.6 s of silence from ffmpeg's anullsrc, so no voice is heard), and sends:
//   2 s after hello       navigate to the copy's tree, which hangs on the shelf
//   1.5 s after the name  navigate to a card two layers up in the copy, while the user is recorded (-wakeClip)
//   0.3 s after the utter navigate to a card the copy hangs from a card that leads no layer (added to the copy)
//   1.5 s after the utter a reply, and with it a navigate to a card of the first tree
//   12 s after the utter  navigate to a card that is not there
//   14 s after the utter  a reply whose sound never comes, and with it a navigate, which goes after 20 s anyway
// Each card gone to must open on its parent's layer, a tree's root on its own. The preview runs with -mute, but the
// voice's chime on the name still plays aloud once: -mute does not reach the voice's sounds yet.
//
//   quest/desktop/build.sh && node quest/desktop/test/navigate_check.mjs [--shots <folder>] [--port <port>]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const quest = join(here, '../..');
const fixtures = join(quest, 'core/agent/test/fixtures');
const { WebSocketServer } = createRequire(join(quest, '../agents/package.json'))('ws');

const flag = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const port = Number(flag('--port', '8796'));
const shots = flag('--shots');
const transcript = 'Show me more like this.';
const reply = 'Bringing more. Here is the first of them, about the dolly zoom.';
const stalled = 'This reply never comes.';
const firstByte = 0.6;
const bytesPerSecond = 9000;

const began = Date.now();
const clock = () => (Date.now() - began) / 1000;
const log = [];
const note = (who, line) => log.push({ at: clock(), who, line });

// The session's tree, and an older copy of it that hangs on the shelf.
const hello = JSON.parse(readFileSync(join(fixtures, 'hello.json'), 'utf8'));
const snapshot = hello.snapshot;
const first = snapshot.trees[0];
const copy = (id) => `${id}-older`;
const older = { ...first, id: copy(first.id), rootId: copy(first.rootId), title: `${first.title}, older`, createdAt: '2026-01-01T00:00:00.000Z' };
const nodes = snapshot.nodes.filter((n) => n.treeId === first.id);
snapshot.trees.push(older);
for (const n of nodes) snapshot.nodes.push({ ...n, id: copy(n.id), treeId: older.id, parent: n.parent ? copy(n.parent) : null });
const treeOf = (id) => snapshot.trees.find((t) => t.id === snapshot.nodes.find((n) => n.id === id).treeId).title;
const wentTo = (id) => new RegExp(` in "${escape(treeOf(id))}" \\(${escape(id)}\\), on the layer of ${escape(parentOf(id) ?? id)}$`);
const childrenOf = (id) => nodes.filter((n) => n.parent === id);
const kept = childrenOf(first.rootId).find((n) => n.status === 'kept' && childrenOf(n.id).length > 0);
const deep = copy(childrenOf(kept.id)[0].id);
const picks = childrenOf(first.rootId).filter((n) => n.status === 'pick');
const near = picks[0].id;
const far = picks[1].id;
const under = 'under-a-pick-older';
snapshot.nodes.push({ ...picks[2], id: under, treeId: older.id, parent: copy(picks[2].id) });
const parentOf = (id) => snapshot.nodes.find((n) => n.id === id).parent;

// The stand-in.
let socket = null;
// Every navigate here stands in for one the headset asked for, which the service marks yours.
const send = (message) => {
  const sent = message.t === 'navigate' ? { ...message, yours: true } : message;
  note('service', `sends ${JSON.stringify(sent)}`);
  socket?.send(JSON.stringify(sent));
};
const later = (seconds, run) => setTimeout(run, seconds * 1000);
let spoke = false;
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'POST' && url.pathname === '/api/transcribe') {
    req.resume();
    req.on('end', () => later(0.6, () => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ text: transcript }))));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/speak') {
    const mp3 = readFileSync(join(here, 'reply.mp3'));
    note('service', 'speak asked');
    if (url.searchParams.get('text') === stalled) return;
    let at = 0;
    const step = Math.round(bytesPerSecond / 20);
    later(firstByte, () => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
      const timer = setInterval(() => {
        res.write(mp3.subarray(at, (at += step)));
        if (at < mp3.length) return;
        clearInterval(timer);
        res.end();
        note('service', `speak sent all ${mp3.length} bytes`);
      }, 50);
    });
    return;
  }
  res.writeHead(404).end();
});
const sockets = new WebSocketServer({ server, path: '/ws' });
sockets.on('connection', (ws) => {
  socket = ws;
  ws.on('message', (data) => {
    const message = JSON.parse(String(data));
    note('client', `sends ${message.t}${message.text ? ` "${message.text}"` : ''}`);
    if (message.t !== 'utter' || spoke) return;
    spoke = true;
    later(0.3, () => send({ t: 'navigate', nodeId: under }));
    later(1.5, () => {
      send({ t: 'say', text: reply });
      send({ t: 'navigate', nodeId: near });
    });
    later(12, () => send({ t: 'navigate', nodeId: 'not-a-card' }));
    later(14, () => {
      send({ t: 'say', text: stalled });
      send({ t: 'navigate', nodeId: far });
    });
    later(37, finish);
  });
  ws.send(JSON.stringify({ ...hello, snapshot, settings: { ...hello.settings, agentName: 'momo' }, voice: true, hearing: 'service' }));
  note('service', 'hello');
  later(2, () => send({ t: 'navigate', treeId: older.id }));
});
server.listen(port, '127.0.0.1');

// The preview, hearing four seconds of quiet, then "Hey Momo, show me more like this. I was reading about winter bread all
// morning.", recorded for about five seconds, and quiet after.
const work = mkdtempSync(join(tmpdir(), 'navigate-check-'));
const samples = (file) => {
  const bytes = readFileSync(file);
  for (let at = 12; at + 8 <= bytes.length; at += 8 + bytes.readUInt32LE(at + 4) + (bytes.readUInt32LE(at + 4) & 1)) {
    if (bytes.toString('latin1', at, at + 4) === 'data') return bytes.subarray(at + 8, at + 8 + bytes.readUInt32LE(at + 4));
  }
  throw new Error(`no sound in ${file}`);
};
const quiet = (seconds) => Buffer.alloc(Math.round(seconds * 16000) * 2);
const pcm = Buffer.concat([quiet(4), samples(join(fixtures, 'voice/command.wav')), quiet(0.3), samples(join(fixtures, 'voice/before.wav')), quiet(30)]);
const header = Buffer.alloc(44);
header.write('RIFF', 0, 'latin1');
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8, 'latin1');
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(16000, 24);
header.writeUInt32LE(32000, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36, 'latin1');
header.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([header, pcm]);
writeFileSync(join(work, 'clip.wav'), wav);
const shotArgs = shots ? ['-shot', join(shots, 'navigate.png'), '-shotEvery', '0.5'] : ['-shot', join(work, 'end.png')];
const preview = spawn(join(quest, 'desktop/preview'), ['-agent', `ws://127.0.0.1:${port}`, '-agentToken', 'standin', '-wakeClip', join(work, 'clip.wav'), ...shotArgs, '-shotAt', '160', '-realtime', '-mute'], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
let partial = '';
let woken = false;
preview.stderr.on('data', (chunk) => {
  const lines = (partial + chunk).split('\n');
  partial = lines.pop();
  for (const line of lines) {
    if (!/^\[(voice|agent)\]/.test(line)) continue;
    note('preview', line);
    // The name is heard when the preview has loaded its listener, which takes longer on a busy Mac.
    if (/heard HEY_MOMO/.test(line) && !woken) {
      woken = true;
      later(1.5, () => send({ t: 'navigate', nodeId: deep }));
    }
  }
});
const timeout = later(150, () => finish('the run did not reach its end'));

function finish(why) {
  clearTimeout(timeout);
  preview.kill();
  sockets.close();
  server.close();
  for (const { at, who, line } of log) console.log(`${at.toFixed(2).padStart(6)} ${who.padEnd(7)} ${line}`);
  const when = (who, pattern, after = -1) => log.find((l) => l.who === who && l.at > after && pattern.test(l.line))?.at;
  const checks = [];
  const check = (ok, what) => checks.push({ ok: Boolean(ok), what });
  if (why) check(false, why);

  const toTree = when('service', /navigate","treeId/);
  const standsOlder = when('preview', wentTo(older.rootId), toTree);
  check(standsOlder && standsOlder - toTree < 3, `navigate to a tree on the shelf stands it at its root (${seconds(standsOlder, toTree)})`);

  const woke = when('preview', /heard HEY_MOMO/);
  const recorded = when('preview', /recorded/);
  const toDeep = when('service', new RegExp(`navigate","nodeId":"${deep}`));
  check(woke < toDeep && toDeep < recorded, `the navigate to the deep card came while the user was recorded (woke ${woke?.toFixed(2)}, sent ${toDeep?.toFixed(2)}, recorded ${recorded?.toFixed(2)})`);
  const atDeep = when('preview', wentTo(deep), toDeep);
  check(atDeep && atDeep >= recorded, `it went to the deep card once the recording ended, not before (${seconds(atDeep, recorded)} after)`);

  const toNear = when('service', new RegExp(`navigate","nodeId":"${near}`));
  const doneSpeaking = when('preview', /done speaking/, toNear);
  const atNear = when('preview', wentTo(near), toNear);
  check(doneSpeaking && atNear && atNear >= doneSpeaking, `a navigate sent with a reply waits until the reply has played (${seconds(atNear, doneSpeaking)} after it ended)`);

  const toUnder = when('service', new RegExp(`navigate","nodeId":"${under}`));
  check(when('preview', wentTo(under), toUnder), "a card hanging from one that leads no layer opens on its parent's layer, which stands first");

  const missing = when('service', /not-a-card/);
  check(when('preview', /nothing here to go to/, missing), 'a navigate to a card that is not there is let go');

  const toFar = when('service', new RegExp(`navigate","nodeId":"${far}`));
  const atFar = when('preview', wentTo(far), toFar);
  const gaveUp = when('preview', /could not be spoken/, toFar);
  check(atFar - toFar > 19 && atFar - toFar < 22 && !(gaveUp < atFar), `a reply that never comes holds a navigate only 20 s (${seconds(atFar, toFar)})`);

  for (const c of checks) console.log(`${c.ok ? 'ok    ' : 'FAILED'} ${c.what}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function seconds(a, b) {
  return a === undefined || b === undefined ? 'never' : `${(a - b).toFixed(2)} s`;
}
