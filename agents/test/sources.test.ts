import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelClient, Page, WebResult } from '../src/core/ports.ts';
import { FakeModel } from '../src/fake/model.ts';
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

/** Sources over a scripted network: the first address that contains a key answers with its body, anything else fails. */
function scripted(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const send = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const key = Object.keys(answers).find((k) => url.includes(k));
    return key ? Response.json(answers[key]) : new Response('', { status: 500 });
  }) as typeof fetch;
  return { asked, found: makeSources({ send, model: new FakeModel(), read: async () => null }) };
}

const ABSTRACT = Object.fromEntries(Array.from({ length: 60 }, (_v, n) => [`word${n}`, [n]]));

/** One OpenAlex work with an abstract long enough to be kept. */
const openAlexWork = (more: object) => ({ id: 'https://openalex.org/W9', title: 'A work', publication_year: 2011, authorships: [{ author: { display_name: 'A. Researcher' } }], abstract_inverted_index: ABSTRACT, cited_by_count: 40, ...more });

test('a work from the paper index is filed as what the index says it is: a paper, a book, or neither', async () => {
  const types = ['article', 'preprint', 'review', 'conference-paper', 'book', 'monograph', 'book-chapter', 'dataset', undefined];
  const { asked, found } = scripted({ 'api.openalex.org': { results: types.map((type) => openAlexWork({ type })) } });

  const works = await found.search('papers', 'visual perception');

  assert.match(asked[0]!, /select=[^&]*\btype\b/);
  assert.deepEqual(works.map((w) => w.kind), ['paper', 'paper', 'paper', 'paper', 'book', 'book', undefined, undefined, undefined]);
});

test('a paper whose author list the index cut short says so', async () => {
  const many = Array.from({ length: 100 }, (_v, n) => ({ author: { display_name: `Author ${n}` } }));
  const { asked, found } = scripted({
    'api.openalex.org': { results: [openAlexWork({ type: 'article', authorships: many }), openAlexWork({ type: 'article', is_authors_truncated: true }), openAlexWork({ type: 'article' })] },
  });

  const [capped, flagged, whole] = await found.search('papers', 'gravitational waves');

  assert.match(asked[0]!, /select=[^&]*is_authors_truncated/);
  assert.equal(capped!.authors!.length, 100);
  assert.deepEqual([capped!.authorsCut, flagged!.authorsCut, 'authorsCut' in whole!], [true, true, false]);
});

test('a paper comes back with every author and its venue, and the venue is asked for', async () => {
  const { asked, found } = scripted({
    'api.openalex.org': {
      results: [
        {
          id: 'https://openalex.org/W1',
          doi: 'https://doi.org/10.1/zoom',
          type: 'article',
          title: 'Vertigo and the dolly zoom',
          publication_year: 2011,
          authorships: ['A. Researcher', 'B. Scholar', 'C. Fellow'].map((display_name) => ({ author: { display_name } })),
          primary_location: { source: { display_name: 'Journal of Vision' } },
          abstract_inverted_index: ABSTRACT,
          cited_by_count: 40,
        },
      ],
    },
  });

  const [paper] = await found.search('papers', 'dolly zoom');

  assert.match(asked[0]!, /select=[^&]*primary_location/);
  assert.equal(paper!.kind, 'paper');
  assert.deepEqual(paper!.authors, ['A. Researcher', 'B. Scholar', 'C. Fellow']);
  assert.equal(paper!.venue, 'Journal of Vision');
  assert.equal(paper!.by, 'A. Researcher et al.');
});

test('a museum work comes back as an artwork with the museum that holds it, and a medium only when the catalogue gives one', async () => {
  const { found } = scripted({
    'api.artic.edu': { data: [{ id: 7, title: 'Stairwell', artist_title: 'A. Maker', date_display: '1920', medium_display: 'Gelatin silver print', image_id: 'abc' }] },
    'clevelandart.org': {
      data: [
        { title: 'Stair study', creation_date: '1931', technique: 'etching', type: 'Print', url: 'https://cma.example/1', images: { web: { url: 'https://img.example/1.jpg' } } },
        { title: 'Rain choker', creation_date: '1998', technique: '', type: 'Garment', url: 'https://cma.example/2', images: { web: { url: 'https://img.example/2.jpg' } } },
      ],
    },
    'api.vam.ac.uk': { records: [{ systemNumber: 'O1', _primaryTitle: 'Spiral teapot', _primaryMaker: { name: 'B. Potter' }, _primaryDate: '1890', objectType: 'Teapot', _images: { _iiif_image_base_url: 'https://img.example/O1/' } }] },
  });

  const works = await found.search('museums', 'spiral');

  assert.deepEqual(works.map((w) => [w.kind, w.medium, w.holder, w.from, w.text]), [
    ['artwork', 'Gelatin silver print', 'Art Institute of Chicago', 'Art Institute of Chicago', 'Gelatin silver print'],
    ['artwork', 'etching', 'Cleveland Museum of Art', 'Cleveland Museum of Art', 'etching'],
    ['artwork', undefined, 'Victoria and Albert Museum', 'Victoria and Albert Museum', 'Teapot'],
    ['artwork', undefined, 'Cleveland Museum of Art', 'Cleveland Museum of Art', 'Garment'],
  ]);
  assert.deepEqual(works.map((w) => 'medium' in w), [true, true, false, false]);
});

test('a book comes back as a book with every author, split from the one name Apple gives them', async () => {
  const { found } = scripted({
    'itunes.apple.com': { results: [{ trackName: 'Nudge', artistName: 'Henry Louis Gates, Jr., Cass R. Sunstein & Richard H. Thaler', releaseDate: '2008-04-08T07:00:00Z', description: LONG, trackViewUrl: 'https://books.apple.com/us/book/id3' }] },
  });

  const [book] = await found.search('books', 'nudge');

  assert.equal(book!.kind, 'book');
  assert.deepEqual(book!.authors, ['Henry Louis Gates, Jr.', 'Cass R. Sunstein', 'Richard H. Thaler']);
  assert.equal(book!.by, 'Henry Louis Gates, Jr., Cass R. Sunstein & Richard H. Thaler');
});

/** One Commons file as the API's file search answers with it. */
const commonsFile = (index: number, title: string, info: Record<string, unknown>, meta: Record<string, string>) => ({
  index,
  title,
  imageinfo: [{
    mime: 'image/jpeg', width: 3000, thumburl: `https://upload.example/thumb/${index}/500px.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    extmetadata: Object.fromEntries(Object.entries(meta).map(([k, value]) => [k, { value }])),
    ...info,
  }],
});

test('a Commons search brings each file as a picture with its author, licence and file page, and leaves out icons and drawings', async () => {
  const agents: string[] = [];
  const pages = [
    commonsFile(2, 'File:Ghost dance.jpg', {}, {
      ObjectName: 'The Ghost Dance of the Sioux',
      Artist: '<a href="//commons.wikimedia.org/wiki/User:A">Amédée Forestier</a>',
      DateTimeOriginal: '1891<div style="display: none;">date QS:P571,+1891</div>',
      ImageDescription: '<i>The Ghost Dance</i> of the Sioux, an engraving.',
      LicenseShortName: 'Public domain',
    }),
    commonsFile(1, 'File:Arapaho_Ghost_Dance,_1900.jpg', {}, { Artist: '<div class="fn">Unknown author<span style="display: none;">Unknown author</span></div>', DateTimeOriginal: 'photo 1900', LicenseShortName: 'CC BY-SA 4.0' }),
    commonsFile(3, 'File:Flag icon.png', { mime: 'image/png', width: 120 }, {}),
    commonsFile(4, 'File:Dance diagram.svg', { mime: 'image/svg+xml' }, {}),
  ];
  const send = (async (input: string | URL | Request, init?: RequestInit) => {
    agents.push(new Headers(init?.headers).get('User-Agent') ?? '');
    const at = new URL(String(input));
    assert.equal(at.searchParams.get('gsrsearch'), 'Ghost Dance filetype:bitmap', 'only files that are pictures are searched');
    return Response.json({ query: { pages } });
  }) as typeof fetch;

  const found = await makeSources({ send, model: new FakeModel(), read: async () => null }).search('commons', 'Ghost Dance');

  assert.match(agents[0]!, /\(.*https?:\/\//, 'Wikimedia is told how to reach whoever runs the program');
  assert.deepEqual(found.map((f) => [f.title, f.by, f.date, f.licence]), [
    ['Arapaho Ghost Dance, 1900', 'Unknown author', '1900', 'CC BY-SA 4.0'],
    ['The Ghost Dance of the Sioux', 'Amédée Forestier', '1891', 'Public domain'],
  ]);
  assert.deepEqual(found[1]!.credit, { text: 'Amédée Forestier, Public domain, via Wikimedia Commons', url: 'https://commons.wikimedia.org/wiki/File%3AGhost%20dance.jpg' });
  assert.equal(found[1]!.url, found[1]!.credit!.url);
  assert.equal(found[1]!.image, 'https://upload.example/thumb/2/500px.jpg');
  assert.equal(found[1]!.text, 'The Ghost Dance of the Sioux, an engraving.');
  assert.ok(makeSources({ send, model: new FakeModel(), read: async () => null }).list().find((s) => s.id === 'commons')?.visual, 'Commons is offered with no key, as pictures');
});

/** Unsplash over a scripted network that counts down its hourly allowance in the header it sends. */
function unsplash(left = 40) {
  const asked: { url: string; auth: string }[] = [];
  const send = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, auth: new Headers(init?.headers).get('Authorization') ?? '' });
    const headers = { 'x-ratelimit-remaining': String(left--) };
    if (url.includes('/download')) return Response.json({ url: 'https://images.unsplash.com/photo-1' }, { headers });
    return Response.json({
      results: [{
        id: 'p1', created_at: '2021-03-04T10:00:00Z', description: null, alt_description: 'fog over a harbour at dawn',
        user: { name: 'Jeff Sheldon', username: 'ugmonk', links: { html: 'https://unsplash.com/@ugmonk' } },
        urls: { raw: 'https://images.unsplash.com/photo-1?ixid=abc123', small: 'https://images.unsplash.com/photo-1?ixid=abc123&w=400' },
        links: { html: 'https://unsplash.com/photos/p1', download_location: 'https://api.unsplash.com/photos/p1/download?ixid=abc123' },
      }],
    }, { headers });
  }) as typeof fetch;
  return { asked, sources: makeSources({ send, model: new FakeModel(), read: async () => null, keys: { UNSPLASH_ACCESS_KEY: 'key-1' } }) };
}

test('Unsplash is offered only with its key, and its photos keep its own addresses, credit the photographer and link back with where they came from', async () => {
  assert.ok(!makeSources({ send: fetch, model: new FakeModel(), read: async () => null }).list().some((s) => s.id === 'photos'));
  const { asked, sources } = unsplash();
  const offered = sources.list().find((s) => s.id === 'photos');
  assert.deepEqual([offered?.visual, offered?.hotlink], [true, true]);

  const [photo] = await sources.search('photos', 'fog harbour');

  assert.equal(asked[0]!.auth, 'Client-ID key-1', 'the key goes in a header, never in an address');
  assert.ok(!asked[0]!.url.includes('key-1'));
  const image = new URL(photo!.image!);
  assert.equal(image.origin + image.pathname, 'https://images.unsplash.com/photo-1', "the picture is Unsplash's own address");
  assert.equal(image.searchParams.get('ixid'), 'abc123', 'resized, it keeps the ixid Unsplash asks to be kept');
  assert.equal(photo!.preview, 'https://images.unsplash.com/photo-1?ixid=abc123&w=400', 'its small copy, for the model to look at');
  assert.equal(photo!.title, 'Fog over a harbour at dawn');
  assert.deepEqual(photo!.credit, { text: 'Photo by Jeff Sheldon on Unsplash', url: 'https://unsplash.com/@ugmonk?utm_source=mind_palace&utm_medium=referral' });
  assert.equal(photo!.url, 'https://unsplash.com/photos/p1?utm_source=mind_palace&utm_medium=referral');

  await sources.report('photos', photo!);
  await sources.report('photos', { ...photo!, report: 'https://elsewhere.example/steal' });

  assert.deepEqual(asked.slice(1).map((a) => [a.url, a.auth]), [['https://api.unsplash.com/photos/p1/download?ixid=abc123', 'Client-ID key-1']], 'the download is reported to Unsplash alone');
});

test('Unsplash stops being offered when its hourly allowance comes down to the few kept for download reports', async () => {
  const { sources } = unsplash(6);
  await sources.search('photos', 'fog harbour');
  assert.ok(sources.list().some((s) => s.id === 'photos'), 'six left: still offered');
  await sources.search('photos', 'fog harbour');
  assert.ok(!sources.list().some((s) => s.id === 'photos'), 'five left: kept for the reports');
});
