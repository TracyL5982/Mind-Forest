// Runs the Mac preview against the walkthrough demo (standin.mjs with `demo`, the fake service with no model) and checks that a
// card of the service's whose video is a file the service holds plays it where it stands, as a film of the library does:
//   1. the demo's whole tree is built, and its film card ("Disney's multiplane camera") is a video card with a file
//   2. taken to that card, the preview plays its video from the service
//   3. the address it plays streams: with the token the service answers byte ranges of the file (so the player can start at
//      once and seek), and without it the service refuses
//   4. a film card with no file (a link) plays nothing
//   5. a video card whose file is elsewhere, over https, plays it from where it lies, with no token of the service's
//   6. one over plain http plays nothing, and the log says why
// The preview's own player is a stand-in that shows nothing (desktop/platform_mac.mm), so what is checked here is that the card
// chooses to play and from where, and that the service's address serves the file; the picture plays on the headset. The files
// elsewhere are on example.org, never fetched.
//
//   quest/desktop/build.sh && node quest/desktop/test/service_video_check.mjs [--shots <folder>]
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checker, escape, find, flag, later, standIn, until } from './standin.mjs';

// The demo builds its own tree, so it starts from an empty mindstorm.
const seed = mkdtempSync(join(tmpdir(), 'service-video-seed-'));
writeFileSync(join(seed, 'mindstorm.sqlite'), '');
const stand = await standIn('service-video-check', seed, { demo: true });
const shots = flag('--shots', join(stand.work, 'shots'));
mkdirSync(shots, { recursive: true });
const { check, failed, summary } = checker();

const said = () => readFileSync(join(stand.work, 'service.log'), 'utf8').split('\n');
/** The demo has set its tree up again for the preview that just joined. */
const setUp = async () => {
  const from = said().length;
  for (let i = 0; i < 1800; i++) {
    const lines = said().slice(from - 1);
    const joined = lines.findIndex((l) => l.includes('[demo] a headset joined'));
    if (joined >= 0 && lines.slice(joined).some((l) => l.includes('[demo] set up for'))) return true;
    await later(0.1);
  }
  return false;
};

try {
  await stand.api('/api/demo/goto', { method: 'POST', body: JSON.stringify({ round: 'end' }) });
  for (let i = 0; i < 600 && (await (await stand.api('/api/demo/status')).json()).busy; i++) await later(0.1);

  const run = stand.launch(shots, 'service-video', 40, []);
  const ready = setUp();
  try {
    await until(run.log, /^\[agent\] connected/, 0, 30);
    check(await ready, 'the demo set its tree up for the preview');
    const state = await stand.state();
    const items = new Map(state.items.map((i) => [i.id, i]));
    const film = state.nodes.find((n) => n.view.component === 'video' && String(n.view.props.src ?? '').startsWith('/assets/'));
    const title = film ? items.get(film.itemId).title : '';
    check(film, `the demo's tree has a video card with a file${film ? `: "${title}", ${film.view.props.src}` : ''}`);
    const link = state.nodes.find((n) => n.view.component === 'link' && items.get(n.itemId)?.data?.kind === 'film');

    if (film) {
      const sent = run.at();
      stand.inject({ t: 'navigate', nodeId: film.id, yours: true });
      const played = await until(run.log, new RegExp(`^\\[ocean\\] ${escape(title)} plays its video from the service$`), sent, 15);
      check(played, `taken to it, the preview plays its video from the service (${played?.line ?? 'no such line'})`);

      const address = `${stand.serviceAddress}${film.view.props.src}`;
      const head = await fetch(`${address}?token=${encodeURIComponent(stand.token)}`, { headers: { Range: 'bytes=0-1023' } });
      const tail = await fetch(`${address}?token=${encodeURIComponent(stand.token)}`, { headers: { Range: 'bytes=5000000-5001023' } });
      const bare = await fetch(address);
      check(head.status === 206 && /^video\//.test(head.headers.get('content-type') ?? '') && tail.status === 206,
        `its address streams the file: ${head.status} ${head.headers.get('content-type')} ${head.headers.get('content-range')}, and later in it ${tail.status} ${tail.headers.get('content-range')}`);
      check(bare.status === 401, `without the token the service refuses it (${bare.status})`);
    }

    if (link) {
      const linkTitle = items.get(link.itemId).title;
      const sent = run.at();
      stand.inject({ t: 'navigate', nodeId: link.id, yours: true });
      await until(run.log, new RegExp(`^\\[agent\\] went to ${escape(linkTitle)}`), sent, 15);
      await later(1.5);
      check(!find(run.log, /plays its video from the service$/, sent), `a film card with no file, "${linkTitle}", plays nothing`);
    }

    // Two video cards whose files are elsewhere, added under the root as a client would: one over https, one over http.
    const tree = state.trees.find((t) => t.id === film?.treeId) ?? state.trees[0];
    const capturedAt = new Date().toISOString();
    const elsewhere = [
      { key: 'https', title: 'A film elsewhere', src: 'https://media.example.org/films/ws67.mp4?sig=abc' },
      { key: 'http', title: 'A film over http', src: 'http://media.example.org/films/ws67.mp4' },
    ];
    const ws = new stand.WebSocket(`ws://127.0.0.1:${stand.servicePort}/ws?token=${encodeURIComponent(stand.token)}`);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({
      t: 'commands',
      label: 'Two films elsewhere',
      commands: elsewhere.flatMap((f, i) => [
        { type: 'addItem', item: { id: `ws67-item-${f.key}`, kind: 'video', title: f.title, text: '', summary: '', tags: [], data: { mediaUrl: f.src }, source: { from: 'paste', capturedAt }, origin: { by: 'user' }, archived: false, revision: 0 } },
        { type: 'addNode', node: { id: `ws67-node-${f.key}`, treeId: tree.id, itemId: `ws67-item-${f.key}`, parent: tree.rootId, status: 'kept', why: '', importance: 1, origin: { by: 'user' }, view: { component: 'video', props: { src: f.src }, by: 'default' }, order: 1000 + i } },
      ]),
    }));
    await later(1.5);
    ws.close();
    const added = await stand.state();
    for (const f of elsewhere) {
      const node = added.nodes.find((n) => n.id === `ws67-node-${f.key}`);
      check(node?.view.component === 'video' && node.view.props.src === f.src, `the service holds "${f.title}" as a video card whose src is ${f.src} (${node ? `${node.view.component}, ${node.view.props.src}` : 'no such card'})`);
    }

    let sent = run.at();
    stand.inject({ t: 'navigate', nodeId: 'ws67-node-https', yours: true });
    const away = await until(run.log, /^\[ocean\] A film elsewhere plays its video from /, sent, 15);
    check(away && away.line.endsWith('from https://media.example.org/films/ws67.mp4') && !/token/.test(away.line),
      `over https it plays from where it lies, with no token of the service's (${away?.line ?? 'no such line'})`);

    sent = run.at();
    stand.inject({ t: 'navigate', nodeId: 'ws67-node-http', yours: true });
    const plain = await until(run.log, /^\[agent\] A film over http's video is not over https, so it does not play$/, sent, 15);
    await later(1.5);
    check(plain && !find(run.log, /^\[ocean\] A film over http plays/, sent), `over plain http it plays nothing, and says why (${plain?.line ?? 'no such line'})`);
    run.stop();
    await run.done;
  } finally {
    writeFileSync(join(shots, 'service-video.log'), run.log.map((l) => `${l.at.toFixed(2)} ${l.line}`).join('\n') + '\n');
  }
} finally {
  await stand.close();
}
console.log(summary(shots));
process.exit(failed() ? 1 : 0);
