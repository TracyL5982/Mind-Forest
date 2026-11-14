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
