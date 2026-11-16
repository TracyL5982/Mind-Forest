import assert from 'node:assert/strict';
import type { LookupAddress } from 'node:dns';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { ClientMessage } from '../src/node/protocol.ts';
import { isPublic, publicFetch, type PublicFetchDeps } from '../src/node/public-fetch.ts';

test('a dumped link is an http or https address', () => {
  const link = (url: string) => ClientMessage.safeParse({ t: 'dump', dumps: [{ kind: 'link', url }] }).success;
  assert.deepEqual(['https://example.com/a', 'http://example.com/b'].map(link), [true, true]);
  assert.deepEqual(['file:///etc/hosts', 'ftp://example.com/x', 'javascript:alert(1)', 'gopher://example.com/'].map(link), [false, false, false, false]);
});

test('only public internet addresses count as public', () => {
  const inside = ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.20', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fdaa:0:1::3', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '::7f00:1', '::a00:1', '::ffff:0:7f00:1', '64:ff9b:1::a00:1'];
  const outside = ['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001::200e'];
  assert.deepEqual(inside.filter(isPublic), [], 'none of these is public');
  assert.deepEqual(outside.filter((a) => !isPublic(a)), [], 'all of these are');
  assert.equal(isPublic('not an address'), false);
});

test('a page is fetched only from a public address, checked after DNS and again at every redirect', async () => {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    asked.push(req.url ?? '');
    if (req.url === '/away') return void res.writeHead(302, { location: `http://inside.example:${port}/secret` }).end();
    if (req.url === '/on') return void res.writeHead(301, { location: '/fine' }).end();
    res.writeHead(200, { 'content-type': 'text/plain' }).end('a public page');
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const port = (server.address() as AddressInfo).port;
  // The test's own server stands in for a site on the internet: page.example resolves to it, and only its address counts as public here.
  const names: Record<string, string> = { 'page.example': '127.0.0.1', 'inside.example': '10.1.2.3' };
  const deps: PublicFetchDeps = {
    lookup: ((host: string, _options: unknown, done: (err: Error | null, found: LookupAddress[]) => void) =>
      names[host] ? done(null, [{ address: names[host], family: 4 }]) : done(Object.assign(new Error(`no ${host}`), { code: 'ENOTFOUND' }), [])) as unknown as PublicFetchDeps['lookup'],
    isPublic: (address) => address === '127.0.0.1' || isPublic(address),
  };
  const get = publicFetch(deps);
  try {
    const fine = await get(`http://page.example:${port}/on`);
    assert.equal(fine.status, 200);
    assert.equal(await fine.text(), 'a public page');
    assert.equal(fine.url, `http://page.example:${port}/fine`, 'a redirect to a public address is followed');

    await assert.rejects(get(`http://page.example:${port}/away`), /inside\.example is not a public address/);
    await assert.rejects(get(`http://inside.example:${port}/secret`), /not a public address/);
    await assert.rejects(get(`http://127.0.0.2:${port}/`), /127\.0\.0\.2 is not a public address/, 'an address written out is checked too');
    await assert.rejects(get(`http://[::1]:${port}/`), /not a public address/);
    await assert.rejects(get('file:///etc/hosts'), /file: addresses are not fetched/);
    await assert.rejects(get(`http://page.example:${port}/`, { method: 'POST' }), /only a GET/);
    assert.deepEqual(asked, ['/on', '/fine', '/away'], 'nothing inside was ever asked');
  } finally {
    server.close();
  }
});
