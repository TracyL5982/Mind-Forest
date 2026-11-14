import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelClient, Page, WebResult } from '../src/core/ports.ts';
import { makeSources, plain } from '../src/node/sources.ts';

const LONG = 'A paragraph with real substance. '.repeat(20);

function world(hits: WebResult[], pages: Record<string, Partial<Page>>, replies: Record<string, unknown> = {}) {
  const asked: string[] = [];
  const preferences: (string | undefined)[] = [];
  const model = {
    search: async (req: { query: string; prefer?: string }) => {
      preferences.push(req.prefer);
      return hits;
    },
  } as unknown as ModelClient;
  const send = (async (url: string) => {
    asked.push(String(url));
    const match = Object.keys(replies).find((start) => String(url).startsWith(start));
    return match ? new Response(JSON.stringify(replies[match]), { status: 200 }) : new Response('', { status: 500 });
  }) as typeof fetch;
  const read = async (url: string): Promise<Page | null> => (pages[url] ? { url, title: '', text: LONG, site: 'site.example', ...pages[url] } : null);
  return { sources: makeSources({ send, model, read }), asked, preferences };
}

const hit = (url: string, title = 'A title'): WebResult => ({ url, title, snippet: '' });

test('the web source reads the pages and leaves out encyclopedias, thin pages and pages with no name', async () => {
  const { sources, preferences } = world(
    [
      hit('https://en.wikipedia.org/wiki/Parking'),
      hit('https://good.example/essay', 'An essay'),
      hit('https://thin.example/stub'),
      hit('https://bare.example/file.txt', 'https://bare.example/file.txt'),
      hit('https://gone.example/404'),
    ],
    {
      'https://en.wikipedia.org/wiki/Parking': { title: 'Parking - Wikipedia' },
      'https://good.example/essay': { title: 'An essay on parking' },
      'https://thin.example/stub': { title: 'Stub', text: 'Too short.' },
      'https://bare.example/file.txt': {},
    },
  );

  const found = await sources.search('web', 'parking maximums');

  assert.deepEqual(found.map((f) => f.url), ['https://good.example/essay']);
  assert.equal(found[0]!.title, 'An essay on parking');
  assert.equal(found[0]!.image, undefined, 'an article is brought as words, not as its banner picture');
  assert.match(preferences[0] ?? '', /Leave out listicles/);
});

test('a book search is one request and brings the description and a large cover', async () => {
  const { sources, asked } = world([], {}, {
    'https://itunes.apple.com/search': {
      results: [
        { trackName: 'The High Cost of Free Parking', artistName: 'Donald Shoup', releaseDate: '2017-10-20T07:00:00Z', description: `<b>Off-street</b> parking requirements are devastating cities.<br/>${LONG}`, genres: ['Books', 'Urban Planning'], trackViewUrl: 'https://books.apple.com/us/book/id1', artworkUrl100: 'https://img.example/cover/100x100bb.jpg' },
        { trackName: 'No description', artistName: 'Nobody', trackViewUrl: 'https://books.apple.com/us/book/id2' },
      ],
    },
  });

  const found = await sources.search('books', 'free parking');

  assert.equal(asked.length, 1);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0]!.title, found[0]!.by, found[0]!.date], ['The High Cost of Free Parking', 'Donald Shoup', '2017']);
  assert.match(found[0]!.text, /^Off-street parking requirements are devastating cities\.\nA paragraph/);
  assert.match(found[0]!.text, /Shelved under: Urban Planning\.$/);
  assert.equal(found[0]!.image, 'https://img.example/cover/600x600bb.jpg');
});

test('a source that answers with an error is a failure, not an empty result', async () => {
  const { sources } = world([], {});
  await assert.rejects(sources.search('papers', 'anything'), /500/);
  assert.deepEqual(await sources.search('nowhere', 'anything'), []);
});

test('markup from a source is reduced to words', () => {
  assert.equal(plain('<p>Tom &amp; Jerry&#39;s <i>big</i> day&hellip;</p><p>Next</p>'), "Tom & Jerry's big day…\nNext");
});

test('a source that needs a key is only offered when its key is there', () => {
  const ids = (keys?: Record<string, string>) => makeSources({ send: fetch, model: {} as ModelClient, read: async () => null, keys }).list().map((s) => s.id);
  assert.ok(!ids().includes('films') && !ids().includes('heritage'));
  assert.ok(ids({ TMDB_API_KEY: 'k' }).includes('films'));
  assert.ok(ids({ EUROPEANA_API_KEY: 'k' }).includes('heritage'));
  assert.ok(!ids().includes('news') && ids({ GUARDIAN_API_KEY: 'k' }).includes('news'));
});

test('with an OpenAI key the web is searched there, and only pages the search really returned are used', async () => {
  const reply = {
    output: [
      { type: 'web_search_call', action: { sources: [{ url: 'https://good.example/essay?utm_source=openai' }, { url: 'https://other.example/report/' }] } },
      { type: 'message', content: [{ text: '1. An essay | https://good.example/essay\n2. **A report** | (https://other.example/report)\n3. Made up | https://invented.example/page' }] },
    ],
  };
  const posted: string[] = [];
  const send = (async (url: string, init?: RequestInit) => {
    posted.push(`${url} ${String(init?.body).includes('Leave out listicles')}`);
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  const read = async (url: string): Promise<Page | null> => ({ url, title: `Page at ${url}`, text: LONG, site: 'site.example' });
  const model = { search: async () => { throw new Error('the model search must not be used'); } } as unknown as ModelClient;

  const found = await makeSources({ send, model, read, keys: { OPENAI_API_KEY: 'k' } }).search('web', 'parking maximums');

  assert.deepEqual(posted, ['https://api.openai.com/v1/responses true']);
  assert.deepEqual(found.map((f) => f.url), ['https://good.example/essay', 'https://other.example/report']);
});

test('the archive brings films that play as an MP4 file, trying fewer words when all of them find nothing', async () => {
  const asked: string[] = [];
  const send = (async (url: string) => {
    const at = new URL(String(url));
    asked.push(at.pathname === '/advancedsearch.php' ? `search ${/title:\(([^)]*)\)/.exec(at.searchParams.get('q') ?? '')?.[1]}` : `item ${at.pathname}`);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (at.pathname === '/advancedsearch.php') {
      const docs = /title:\(steam locomotive\)/.test(at.searchParams.get('q') ?? '') ? [{ identifier: 'steam_1950' }, { identifier: 'audio_only' }] : [];
      return reply({ response: { docs } });
    }
    if (at.pathname === '/metadata/steam_1950') {
      return reply({
        metadata: { title: 'The Steam Locomotive', creator: 'New York Central', date: '1950-01-01', description: '<p>How a <b>locomotive</b> is built.</p>' },
        files: [
          { name: 'steam.mp4', format: 'MPEG4' },
          { name: 'steam_512kb.mp4', format: '512Kb MPEG4' },
          { name: 'steam.ogv', format: 'Ogg Video' },
        ],
      });
    }
    return reply({ metadata: { title: 'Only sound' }, files: [{ name: 'talk.mp3', format: 'VBR MP3' }] });
  }) as typeof fetch;

  const found = await makeSources({ send, model: {} as ModelClient, read: async () => null }).search('archive', 'steam locomotive factory');

  assert.deepEqual(asked.slice(0, 2), ['search steam locomotive factory', 'search steam locomotive']);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0]!.title, found[0]!.by, found[0]!.date, found[0]!.text], ['The Steam Locomotive', 'New York Central', '1950', 'How a locomotive is built.']);
  assert.equal(found[0]!.media, 'https://archive.org/download/steam_1950/steam_512kb.mp4', 'the copy every player can play, not the original');
  assert.equal(found[0]!.url, 'https://archive.org/details/steam_1950');
  assert.ok(found[0]!.image);
});
