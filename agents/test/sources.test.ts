import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeModel } from '../src/fake/model.ts';
import { makeSources } from '../src/node/sources.ts';

/** Sources over a scripted network: the first address that contains a key answers with its body, anything else fails. */
function sources(answers: Record<string, unknown>) {
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

test('a paper comes back with every author and its venue, and the venue is asked for', async () => {
  const { asked, found } = sources({
    'api.openalex.org': {
      results: [
        {
          id: 'https://openalex.org/W1',
          doi: 'https://doi.org/10.1/zoom',
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

test('a museum work comes back as an artwork with its medium and the museum that holds it', async () => {
  const { found } = sources({
    'api.artic.edu': { data: [{ id: 7, title: 'Stairwell', artist_title: 'A. Maker', date_display: '1920', medium_display: 'Gelatin silver print', image_id: 'abc' }] },
    'api.vam.ac.uk': { records: [{ systemNumber: 'O1', _primaryTitle: 'Spiral teapot', _primaryMaker: { name: 'B. Potter' }, _primaryDate: '1890', objectType: 'Teapot', _images: { _iiif_image_base_url: 'https://img.example/O1/' } }] },
  });

  const works = await found.search('museums', 'spiral');

  assert.deepEqual(works.map((w) => [w.kind, w.medium, w.holder, w.from, w.text]), [
    ['artwork', 'Gelatin silver print', 'Art Institute of Chicago', 'Art Institute of Chicago', 'Gelatin silver print'],
    ['artwork', 'Teapot', 'Victoria and Albert Museum', 'Victoria and Albert Museum', 'Teapot'],
  ]);
});

test('a book comes back as a book with every author', async () => {
  const { found } = sources({ 'openlibrary.org': { docs: [{ key: '/works/OL1W', title: 'Hitchcock', author_name: ['F. Truffaut', 'H. Scott', 'A. Third'], first_publish_year: 1966 }] } });

  const [book] = await found.search('books', 'hitchcock truffaut');

  assert.equal(book!.kind, 'book');
  assert.deepEqual(book!.authors, ['F. Truffaut', 'H. Scott', 'A. Third']);
  assert.equal(book!.by, 'F. Truffaut and H. Scott');
});
