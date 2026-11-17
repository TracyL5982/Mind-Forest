// Runs the Mac preview against a stand-in service and checks, from the preview's log, the welcome walk's lesson of
// talking to Momo (core/ocean/oceanmodel_guide.cpp, "Talking to Momo"): the walk goes to its fifth lesson by itself
// (-guideDemo tour -guideStep 5) and waits for words; the preview hears a recording in place of the microphone
// (-wakeClip) in which "Hey Momo, …" is said twice; the stand-in transcribes the first as something else and the
// second as the question the lesson asks for. So:
//   the first turn   is heard by the walk, is not sent to the service, and the walk says it was something else
//   the second turn  is answered: the layer of what Momo can do is made, and the lesson is finished
// The welcome tree must still stand at the end. The preview runs with -mute, so nothing is heard.
// (Its web socket is written out here, the little of one it needs, so that it runs without the agents' packages.)
//
//   node quest/desktop/test/walk_talk_check.mjs [--port 8797] [--shots <folder>]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const quest = join(here, '../..');
const fixtures = join(quest, 'core/agent/test/fixtures');

const flag = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const port = Number(flag('--port', '8797'));
const shots = flag('--shots');
const turns = ['Start a tree on trains.', 'What can you do for me?'];

const began = Date.now();
const clock = () => (Date.now() - began) / 1000;
const log = [];
const note = (who, line) => log.push({ at: clock(), who, line });

let transcribed = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'POST' && url.pathname === '/api/transcribe') {
    req.resume();
    const text = turns[Math.min(transcribed++, turns.length - 1)];
    note('service', `transcribes as "${text}"`);
    req.on('end', () => setTimeout(() => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ text })), 600));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/speak') {
    note('service', `speak asked: ${url.searchParams.get('text')}`);
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }).end(readFileSync(join(here, 'reply.mp3')));
    return;
  }
  res.writeHead(404).end();
});
const hello = JSON.parse(readFileSync(join(fixtures, 'hello.json'), 'utf8'));
// The service's socket, as much of one as the preview needs: the handshake, text out, text in, and a pong for a ping.
const frame = (text, opcode = 1) => {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x80 | opcode, body.length]) : body.length < 65536 ? Buffer.from([0x80 | opcode, 126, body.length >> 8, body.length & 255]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(body.length)); return b; })()]);
  return Buffer.concat([head, body]);
};
const open = new Set();
server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  open.add(socket);
  socket.on('close', () => open.delete(socket));
  socket.on('error', () => open.delete(socket));
  let held = Buffer.alloc(0);
  let text = '';
  socket.on('data', (chunk) => {
    held = Buffer.concat([held, chunk]);
    for (;;) {
      if (held.length < 2) return;
      const opcode = held[0] & 15, last = (held[0] & 0x80) !== 0, masked = (held[1] & 0x80) !== 0;
      let length = held[1] & 127, at = 2;
      if (length === 126) { if (held.length < 4) return; length = held.readUInt16BE(2); at = 4; }
      else if (length === 127) { if (held.length < 10) return; length = Number(held.readBigUInt64BE(2)); at = 10; }
      if (held.length < at + (masked ? 4 : 0) + length) return;
      const mask = masked ? held.subarray(at, at + 4) : null;
      at += masked ? 4 : 0;
      const body = Buffer.from(held.subarray(at, at + length));
      if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
      held = held.subarray(at + length);
      if (opcode === 8) return socket.end(frame('', 8));
      if (opcode === 9) { socket.write(frame(body, 10)); continue; }
      if (opcode !== 0 && opcode !== 1) continue;
      text += body.toString('utf8');
      if (!last) continue;
      try {
        const message = JSON.parse(text);
        note('client', `sends ${message.t}${message.text ? ` "${message.text}"` : ''}`);
      } catch {}
      text = '';
    }
  });
  socket.write(frame(JSON.stringify({ ...hello, settings: { ...hello.settings, agentName: 'momo' }, voice: true, hearing: 'service' })));
  note('service', 'hello');
});
server.listen(port, '127.0.0.1');

// What the preview hears: quiet while the walk gets to its fifth lesson, "Hey Momo, show me more like this." (which the
// stand-in transcribes as it likes), quiet, the same again, and quiet after.
const work = mkdtempSync(join(tmpdir(), 'walk-talk-check-'));
const samples = (file) => {
  const bytes = readFileSync(file);
  for (let at = 12; at + 8 <= bytes.length; at += 8 + bytes.readUInt32LE(at + 4) + (bytes.readUInt32LE(at + 4) & 1)) {
    if (bytes.toString('latin1', at, at + 4) === 'data') return bytes.subarray(at + 8, at + 8 + bytes.readUInt32LE(at + 4));
  }
  throw new Error(`no sound in ${file}`);
};
const quiet = (seconds) => Buffer.alloc(Math.round(seconds * 16000) * 2);
const command = samples(join(fixtures, 'voice/command.wav'));
const pcm = Buffer.concat([quiet(30), command, quiet(14), command, quiet(60)]);
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
writeFileSync(join(work, 'clip.wav'), Buffer.concat([header, pcm]));
const shotArgs = shots ? ['-shot', join(shots, 'walk-talk.png'), '-shotEvery', '2'] : ['-shot', join(work, 'end.png')];
const preview = spawn(
  join(quest, 'desktop/preview'),
  ['-agent', `ws://127.0.0.1:${port}`, '-agentToken', 'standin', '-wakeClip', join(work, 'clip.wav'), '-freshGuide', '-guideDemo', 'tour', '-guideStep', '5', ...shotArgs, '-shotAt', '200', '-realtime', '-mute'],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
let partial = '';
let done = false;
const finish = () => {
  if (done) return;
  done = true;
  preview.kill();
  server.close();
  for (const s of open) s.destroy();
  const when = (who, pattern, after = 0) => log.find((l) => l.who === who && l.at >= after && pattern.test(l.line));
  let failed = 0;
  const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failed++;
  };
  const waits = when('preview', /\[guide\] lesson 5 waits for words/);
  const first = when('preview', /\[voice\] said to the walk: Start a tree on trains\./, waits?.at);
  const other = when('preview', /\[guide\] something else was asked: Start a tree on trains\./, first?.at);
  const second = when('preview', /\[guide\] lesson 5 answered: What can you do for me\?/, other?.at);
  check(!!waits, 'the walk comes to its fifth lesson and waits for words, joined to the service');
  check(!!when('preview', /\[voice\] heard (HEY|HI)_MOMO/, waits?.at), 'the name is heard while it waits');
  check(!!first, 'what was said after it goes to the walk');
  check(!!other, 'said to be something else, and the lesson still waits');
  check(!!second, 'the second turn, asking what Momo can do, is answered');
  check(!!when('preview', /\[ocean\] answer: 6 new/, second?.at), "Momo's layer is made: the way on and five things to ask for");
  check(!!when('preview', /\[guide\] lesson 5 finished/, second?.at), 'the lesson is finished');
  check(!log.some((l) => l.who === 'client' && /sends utter/.test(l.line)), 'neither turn was sent to the service as an utter');
  check(!when('preview', /\[guide\] the walk ends/), 'the welcome tree still stands');
  if (failed || process.argv.includes('--log')) for (const l of log) if (l.who !== 'preview' || /\[(guide|voice)\]|answer:/.test(l.line)) console.log(`  ${l.at.toFixed(1).padStart(6)} ${l.who}: ${l.line}`);
  console.log(`${failed} failed`);
  process.exit(failed ? 1 : 0);
};
preview.stderr.on('data', (chunk) => {
  partial += String(chunk);
  const lines = partial.split('\n');
  partial = lines.pop();
  for (const line of lines) {
    note('preview', line);
    if (/\[guide\] lesson 5 finished/.test(line)) setTimeout(finish, 3000);
  }
});
preview.on('exit', () => setTimeout(finish, 200));
setTimeout(finish, 150000);
