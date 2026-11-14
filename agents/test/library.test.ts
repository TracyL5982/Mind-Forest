import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { LibraryRef } from '../src/core/domain.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { libraryDraft, sipsPictures, type Pictures } from '../src/node/library.ts';
import { startServer } from '../src/node/server.ts';
import { kit } from './kit.ts';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

/** A repository with two films, two works, two notes, two tags and one saved tree, laid out as the real one is. */
function fixture(): { repo: string; saved: string } {
  const repo = mkdtempSync(join(tmpdir(), 'library-'));
  const put = (path: string, value: unknown) => {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const clip = (index: number, title: string, year: number, videoid: string) => ({
    index, title, year, genres: ['Thriller'], cast: ['James Stewart'], videoid, scene: `${title} scene`, description: `What happens in ${title}.`,
    tile: [10 * index, 0, 190, 144], full: { src: `clips/full/${videoid}.mp4` },
  });
  put('public/clips/clips.json', { atlas: { src: 'clips/atlas.mp4', poster: 'clips/atlas.jpg' }, clips: [clip(0, 'Vertigo', 1958, 'aaaaaaaaaaa'), clip(1, 'Jaws', 1975, 'bbbbbbbbbbb')] });
  put('public/clips/full/aaaaaaaaaaa.mp4', 'film 0');
  put('public/clips/full/bbbbbbbbbbb.mp4', 'film 1');
  put('public/clips/atlas.jpg', 'atlas');
  const work = (index: number, id: string, title: string) => ({
    index, id, museum: 'The Met', title, maker: 'A maker', date: '1900', year: 1900, place: 'Paris', medium: 'Oil on canvas', kind: 'Painting', about: '', url: `https://museum.example/${id}`, file: `full/${id}.heic`,
  });
  put('public/works/works.json', { atlas: {}, works: [work(0, 'met-1', 'Stairs'), work(1, 'met-2', 'Mirror')], tags: [{ id: 'watching', name: 'Watching unseen', kind: 'story', works: [1] }] });
  put('visionos/MindPalace/Resources/ocean.json', {
    tags: [{ id: 'hitchcock', name: 'Alfred Hitchcock', kind: 'people', films: [0] }, { id: 'watching', name: 'Watching unseen', kind: 'story', films: [0] }],
    notes: [
      { id: 'zoom', kicker: 'Brief', tone: 'note', headline: 'The face stays put while the world stretches', highlight: '', summary: 'Why a dolly zoom feels like dread.', tags: ['watching'], links: [] },
      { id: 'shark', kicker: 'Video', tone: 'story', headline: 'The shark shows itself', highlight: '', summary: 'Watch his face.', tags: [], links: [], clip: 1 },
    ],
    briefs: [{ id: 'dolly', line: 'Why does a dolly zoom feel like dread?', title: 'The dolly zoom', root: 'note:zoom' }],
    saved: [{ title: 'Looking back', maker: 'you', steps: ['note:zoom', 'film:0', 'tag:watching', 'work:1'] }],
  });
  const saved = join(repo, 'saved.json');
  writeFileSync(saved, JSON.stringify([{
    title: 'Looking back',
    walked: ['note:zoom', 'film:0', 'tag:watching', 'work:1'],
    steps: [
      { ref: 'note:zoom', parent: null, why: '' },
      { ref: 'film:0', parent: 0, why: 'The lens as a character' },
      { ref: 'work:1', parent: 1, why: 'Watching unseen' },
      { ref: 'tag:watching', parent: 1, why: 'Story' },
    ],
  }]));
  return { repo, saved };
}

function fakePictures(): Pictures & { made: string[] } {
  const made: string[] = [];
  return {
    made,
    async jpeg(paths) {
      made.push(...paths);
      return new Map(paths.map((p) => [p, JPEG]));
    },
    async crop(path) {
      made.push(path);
      return JPEG;
    },
  };
}

async function load(k = kit(), files = fixture(), pictures = fakePictures()) {
  const imported = await libraryDraft({ files: { repo: files.repo, saved: files.saved }, mind: k.mind, assets: k.assets, pictures, now: () => '2026-11-14T00:00:00Z' });
  if (imported.draft) k.mind.apply(imported.draft);
  return { k, files, pictures, imported };
}

test('films, works, notes and tags become library items the headset can draw from its own media, and the web from the service', async () => {
  const { k, files } = await load();

  const vertigo = k.mind.item('library:film:0');
  assert.deepEqual(vertigo.data.library, { kind: 'film', key: 0 } satisfies LibraryRef);
  assert.equal(vertigo.source.from, 'library');
  assert.equal(vertigo.kind, 'video');
  assert.equal(k.assets.links.get(/^\/assets\/(.+)$/.exec(vertigo.data.mediaUrl as string)![1]!), join(files.repo, 'public/clips/full/aaaaaaaaaaa.mp4'), 'the film plays from the repository, not a copy');
  assert.ok(k.assets.files.has(/^\/assets\/(.+)$/.exec(vertigo.data.thumbnailUrl as string)![1]!), 'its still is a stored picture');
  assert.ok(vertigo.tags.includes('alfred hitchcock'), 'its tags are named as on the headset');

  const mirror = k.mind.item('library:work:met-2');
  assert.deepEqual(mirror.data.library, { kind: 'work', key: 'met-2' });
  assert.equal(mirror.kind, 'image');
  assert.deepEqual(k.assets.files.get(mirror.source.asset!)?.bytes, JPEG, 'the HEIC is shown as a JPEG');
  assert.ok(mirror.tags.includes('watching unseen'), 'a tag of works.json reaches the work by its place in the file');

  assert.match(k.mind.item('library:note:zoom').text, /Why does a dolly zoom feel like dread\?/, "the brief's question is part of its note");
  assert.equal(k.mind.item('library:note:shark').data.mediaUrl, k.mind.item('library:film:1').data.mediaUrl, 'a note that shows a film plays that film');
  assert.match(k.mind.item('library:tag:hitchcock').text, /Vertigo \(1958\)/);

  assert.deepEqual(k.mind.inbox(), [], 'the library is not waiting to be filed');
  assert.equal(k.mind.search('vertigo')[0]?.item.id, 'library:film:0', 'the library is searched');
});

test("a saved tree becomes kept cards hung as the headset's replay hangs them", async () => {
  const { k } = await load();

  const tree = [...k.mind.trees.values()].find((t) => t.title === 'Looking back')!;
  const shape = k.mind.treeNodes(tree.id).map((n) => [k.mind.itemOf(n.id).id, n.parent ? k.mind.itemOf(n.parent).id : null, n.status, n.why]);
  assert.deepEqual(shape, [
    ['library:note:zoom', null, 'kept', ''],
    ['library:film:0', 'library:note:zoom', 'kept', 'The lens as a character'],
    ['library:work:met-2', 'library:film:0', 'kept', 'Watching unseen'],
    ['library:tag:watching', 'library:film:0', 'kept', 'Story'],
  ]);
});

test('a second import adds nothing and makes no pictures, and a saved tree the user deleted stays deleted', async () => {
  const first = await load();
  const tree = [...first.k.mind.trees.values()][0]!;
  first.k.mind.apply({ origin: { by: 'user' }, label: 'delete', commands: [{ type: 'deleteTree', id: tree.id }] });
  const pictures = fakePictures();

  const again = await load(first.k, first.files, pictures);

  assert.equal(again.imported.draft, null);
  assert.deepEqual(pictures.made, []);
  assert.equal(first.k.mind.trees.size, 0);
});

test('saved trees replayed from an older ocean.json are refused', async () => {
  const files = fixture();
  writeFileSync(files.saved, JSON.stringify([{ title: 'Looking back', walked: ['note:zoom', 'film:0'], steps: [{ ref: 'note:zoom', parent: null, why: '' }] }]));

  await assert.rejects(load(kit(), files), /npm run saved-trees/);
});

test('the import will not write a data folder the running service is using', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mp-'));
  const run = await startServer({ port: 0, host: '127.0.0.1', dataDir, clientDir: join(import.meta.dirname, '../client'), model: new FakeModel(), roles: fakeRoles, token: 'secret' });

  const refused = spawnSync(process.execPath, ['--no-warnings', '--import', 'tsx', join(import.meta.dirname, '../scripts/import-library.ts')], { env: { ...process.env, MIND_PALACE_DATA: dataDir }, encoding: 'utf8' });

  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /service is running/);
  await run.close();
});

test('on a Mac, sips turns a real work into a JPEG and cuts a real film still from the atlas', { skip: process.platform !== 'darwin' }, async () => {
  const pub = join(import.meta.dirname, '../../public');
  const heic = join(pub, 'works/full/met-258425.heic');

  const made = await sipsPictures.jpeg([heic], 512);
  const still = await sipsPictures.crop(join(pub, 'clips/atlas.jpg'), [33, 0, 190, 144]);

  assert.deepEqual([...made.get(heic)!.slice(0, 3)], [0xff, 0xd8, 0xff]);
  assert.deepEqual([...still!.slice(0, 3)], [0xff, 0xd8, 0xff]);
});
