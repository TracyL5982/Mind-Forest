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

/** The picture maker over a scripted fal, with the keys given. */
function painter(keys: Record<string, string | undefined>, fal: (body: Record<string, unknown>) => Response) {
  const posted: { url: string; auth: string; body: Record<string, unknown> }[] = [];
  const send = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    posted.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') ?? '', body });
    return fal(body);
  }) as typeof fetch;
  const model = new FakeModel();
  const assets = new MemoryAssets();
  return { images: makeTools({ model, assets, fetch: send, keys }).images, model, assets, posted };
}

const JPEG = `data:image/jpeg;base64,${Buffer.from('a picture').toString('base64')}`;

test("with a fal key, a picture is made on fal's Muse Image, or the fal model named, and stored as the picture fal sent back", async () => {
  for (const [keys, endpoint] of [
    [{ FAL_KEY: 'fal-1' }, 'meta/muse-image/text-to-image'],
    [{ FAL_KEY: 'fal-1', MIND_PALACE_FAL_MODEL: 'blackforestlabs/flux-3/klein/text-to-image' }, 'blackforestlabs/flux-3/klein/text-to-image'],
  ] as const) {
    const { images, model, assets, posted } = painter(keys, () => Response.json({ images: [{ url: JPEG }] }));

    const { asset } = await images.generate('a lone dancer in an empty marble hall at night');

    assert.deepEqual(posted.map((p) => [p.url, p.auth, p.body.prompt]), [[`https://fal.run/${endpoint}`, 'Key fal-1', 'a lone dancer in an empty marble hall at night']]);
    assert.equal(new TextDecoder().decode(assets.files.get(asset)!.bytes), 'a picture');
    assert.equal(assets.files.get(asset)!.mime, 'image/jpeg');
    assert.equal(model.calls.filter((c) => c.kind === 'image').length, 0, 'the Meta model makes nothing');
  }
});

test('without the fal key, turned off, or when fal fails, the picture is made by the Meta model', async () => {
  for (const keys of [{ MIND_PALACE_FAL_MODEL: 'blackforestlabs/flux-3/klein/text-to-image' }, { FAL_KEY: 'fal-1', MIND_PALACE_FAL_MODEL: 'off' }, { FAL_KEY: 'fal-1' }] as Record<string, string>[]) {
    const { images, model, posted } = painter(keys, () => new Response('busy', { status: 503 }));
    const { asset } = await images.generate('a circle of dancers');
    assert.ok(asset, JSON.stringify(keys));
    assert.equal(model.calls.filter((c) => c.kind === 'image').length, 1, JSON.stringify(keys));
    assert.equal(posted.length, keys.FAL_KEY && keys.MIND_PALACE_FAL_MODEL !== 'off' ? 1 : 0, JSON.stringify(keys));
  }
});

test('a picture looked at for the model comes back as data and is kept nowhere', async () => {
  const at = (name: string) => `https://example.com/${name}`;
  const { web: tools, assets } = web({ [at('small.jpg')]: picture('image/jpeg', 20_000), [at('pixel.gif')]: picture('image/gif', 43) });

  const seen = await tools.look(at('small.jpg'));

  assert.equal(seen, `data:image/jpeg;base64,${Buffer.from(new Uint8Array(20_000)).toString('base64')}`);
  assert.equal(await tools.look(at('pixel.gif')), null);
  assert.equal(assets.files.size, 0);
});

test('a page or a picture is read only up to its cap, and the rest is never fetched', async () => {
  const { createServer } = await import('node:http');
  const sent = { page: 0, picture: 0 };
  const total = 30_000_000;
  const server = createServer((req, res) => {
    const kind = req.url === '/picture.jpg' ? 'picture' : 'page';
    res.writeHead(200, { 'content-type': kind === 'picture' ? 'image/jpeg' : 'text/html' });
    const chunk = Buffer.alloc(64 * 1024, kind === 'page' ? 'a' : 0);
    let stopped = false;
    res.on('close', () => (stopped = true));
    const more = () => {
      while (!stopped && sent[kind] < total) {
        sent[kind] += chunk.length;
        if (!res.write(chunk)) return void res.once('drain', more);
      }
      if (!stopped) res.end();
    };
    more();
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const web = makeTools({ model: new FakeModel(), assets: new MemoryAssets() }).web;
    const page = await web.read(`${base}/page`);
    assert.ok(page, 'the page is read from what came before the cap');
    assert.equal(await web.picture(`${base}/picture.jpg`), null, 'a picture past 8 MB is not kept');
    await new Promise((done) => setTimeout(done, 100));
    assert.ok(sent.page < 12_000_000, `the page's sender stopped early (${sent.page} bytes of ${total})`);
    assert.ok(sent.picture < 18_000_000, `the picture's sender stopped early (${sent.picture} bytes of ${total})`);
  } finally {
    server.close();
  }
});
