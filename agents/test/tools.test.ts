import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeModel } from '../src/fake/model.ts';
import { makeTools } from '../src/node/tools.ts';
import { MemoryAssets } from './kit.ts';

const PAGE = 'https://example.com/post/1';

/** The web as the service sees it. Each address answers with its response, and any other with a 404. */
function web(answers: Record<string, () => Response>) {
  const send = (async (input: string | URL | Request) => answers[String(input)]?.() ?? new Response('', { status: 404 })) as typeof fetch;
  const assets = new MemoryAssets();
  return { web: makeTools({ model: new FakeModel(), assets, fetch: send }).web, assets };
}

const page = (head: string) => () =>
  new Response(`<html><head><title>A post</title>${head}</head><body><p>Words worth reading.</p></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

const picture = (mime: string, size: number) => () => new Response(new Uint8Array(size), { headers: { 'content-type': mime } });

test('a page\'s own picture is read as a whole web address, a relative one against the page', async () => {
  for (const [named, image] of [
    ['https://cdn.example.org/wide.jpg', 'https://cdn.example.org/wide.jpg'],
    ['/img/wide.jpg', 'https://example.com/img/wide.jpg'],
    ['//cdn.example.org/wide.jpg', 'https://cdn.example.org/wide.jpg'],
  ]) {
    const read = await web({ [PAGE]: page(`<meta property="og:image" content="${named}">`) }).web.read(PAGE);
    assert.equal(read?.image, image, named);
  }
});

test('a picture address that is no web address is left out, and one that cannot be parsed does not stop the page being read', async () => {
  for (const named of ['data:image/png;base64,iVBORw0KGgo=', 'javascript:alert(1)', 'file:///etc/passwd', 'http://[']) {
    const read = await web({ [PAGE]: page(`<meta property="og:image" content="${named}">`) }).web.read(PAGE);
    assert.equal(read?.title, 'A post', named);
    assert.equal(read && 'image' in read, false, named);
  }
});

test('a picture is kept only when it loads as a picture of some size, which leaves out tracking pixels', async () => {
  const at = (name: string) => `https://example.com/${name}`;
  const { web: tools, assets } = web({
    [at('wide.jpg')]: picture('image/jpeg', 40_000),
    [at('pixel.gif')]: picture('image/gif', 43),
    [at('page.html')]: picture('text/html', 40_000),
  });

  assert.deepEqual(await tools.picture(at('wide.jpg')), { asset: 'asset-1' });
  assert.equal(assets.files.get('asset-1')?.mime, 'image/jpeg');
  for (const name of ['pixel.gif', 'page.html', 'gone.jpg']) assert.equal(await tools.picture(at(name)), null, name);
  assert.equal(assets.files.size, 1);
});
