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

/** One OpenAlex work with an abstract long enough to be kept. */
const openAlexWork = (more: object) => ({ id: 'https://openalex.org/W9', title: 'A work', publication_year: 2011, authorships: [{ author: { display_name: 'A. Researcher' } }], abstract_inverted_index: ABSTRACT, cited_by_count: 40, ...more });

test('a work from the paper index is filed as what the index says it is: a paper, a book, or neither', async () => {
  const types = ['article', 'preprint', 'review', 'book', 'monograph', 'book-chapter', 'dataset', undefined];
  const { asked, found } = sources({ 'api.openalex.org': { results: types.map((type) => openAlexWork({ type })) } });

  const works = await found.search('papers', 'visual perception');

  assert.match(asked[0]!, /select=[^&]*\btype\b/);
  assert.deepEqual(works.map((w) => w.kind), ['paper', 'paper', 'paper', 'book', 'book', undefined, undefined, undefined]);
});

test('a paper whose author list the index cut short says so', async () => {
  const many = Array.from({ length: 100 }, (_v, n) => ({ author: { display_name: `Author ${n}` } }));
  const { asked, found } = sources({
    'api.openalex.org': { results: [openAlexWork({ type: 'article', authorships: many }), openAlexWork({ type: 'article', is_authors_truncated: true }), openAlexWork({ type: 'article' })] },
  });

  const [capped, flagged, whole] = await found.search('papers', 'gravitational waves');

  assert.match(asked[0]!, /select=[^&]*is_authors_truncated/);
  assert.equal(capped!.authors!.length, 100);
  assert.deepEqual([capped!.authorsCut, flagged!.authorsCut, 'authorsCut' in whole!], [true, true, false]);
});

test('a paper comes back with every author and its venue, and the venue is asked for', async () => {
  const { asked, found } = sources({
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
  const { found } = sources({
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

test('a book comes back as a book with every author', async () => {
  const { found } = sources({ 'openlibrary.org': { docs: [{ key: '/works/OL1W', title: 'Hitchcock', author_name: ['F. Truffaut', 'H. Scott', 'A. Third'], first_publish_year: 1966 }] } });

  const [book] = await found.search('books', 'hitchcock truffaut');

  assert.equal(book!.kind, 'book');
  assert.deepEqual(book!.authors, ['F. Truffaut', 'H. Scott', 'A. Third']);
  assert.equal(book!.by, 'F. Truffaut and H. Scott');
});
