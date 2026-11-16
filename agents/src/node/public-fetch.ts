import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';

/**
 * Addresses a page or a picture is never fetched from on the hosted service: this machine, private networks, link-local, CGNAT,
 * multicast and reserved ranges, and in IPv6 the unique-local range, which holds Fly's private network (fdaa::/16), and the forms
 * that carry an IPv4 address inside (mapped, NAT64, 6to4).
 */
const V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const V6: [string, number][] = [['::', 127], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]];
// Two lists, since one list matches an IPv4 address against its IPv6 rules too, and ::ffff:0:0/96 would then hold them all.
const INSIDE_V4 = new BlockList();
const INSIDE_V6 = new BlockList();
for (const [net, prefix] of V4) INSIDE_V4.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of V6) INSIDE_V6.addSubnet(net, prefix, 'ipv6');

/** Whether an IP address is on the public internet. */
export function isPublic(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !INSIDE_V4.check(address, 'ipv4') : family === 6 && !INSIDE_V6.check(address, 'ipv6');
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MOST_HOPS = 5;

export interface PublicFetchDeps {
  lookup: typeof dnsLookup;
  isPublic: (address: string) => boolean;
}

/**
 * A GET of a page or a picture whose address came from outside the code: a dumped link, a search result, a page's own picture.
 * Only http and https, and only to public addresses, checked on the address each connection is made to, after DNS, so a name that
 * resolves inside is refused, and again at every redirect, which it follows itself. Asks for no compression, so the body is as sent.
 */
export function publicFetch(deps: PublicFetchDeps = { lookup: dnsLookup, isPublic }): typeof fetch {
  const lookup = ((hostname: string, options: { all?: boolean }, done: (err: Error | null, address?: string | LookupAddress[], family?: number) => void) =>
    deps.lookup(hostname, { all: true }, (err, found: LookupAddress[]) => {
      if (err) return done(err);
      if (found.length === 0 || found.some((a) => !deps.isPublic(a.address))) return done(new Error(`${hostname} is not a public address`));
      if (options.all) done(null, found);
      else done(null, found[0]!.address, found[0]!.family);
    })) as unknown as RequestOptions['lookup'];

  const one = (url: URL, headers: Record<string, string>, signal?: AbortSignal | null) =>
    new Promise<IncomingMessage>((done, fail) => {
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(url, { method: 'GET', headers: { ...headers, 'accept-encoding': 'identity' }, lookup, ...(signal ? { signal } : {}) }, done);
      req.on('error', fail);
      req.end();
    });

  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method && init.method.toUpperCase() !== 'GET') throw new Error('only a GET reaches outside addresses');
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    let url = new URL(input instanceof Request ? input.url : String(input));
    for (let hop = 0; ; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${url.protocol} addresses are not fetched`);
      const host = url.hostname.replace(/^\[|\]$/g, '');
      if (isIP(host) && !deps.isPublic(host)) throw new Error(`${host} is not a public address`);
      const res = await one(url, headers, init?.signal);
      const location = res.headers.location;
      if (REDIRECTS.has(res.statusCode ?? 0) && location) {
        res.resume();
        if (hop + 1 >= MOST_HOPS || init?.redirect === 'error') throw new Error(`too many redirects from ${String(input)}`);
        url = new URL(location, url);
        continue;
      }
      const status = res.statusCode ?? 502;
      const given = new Headers();
      for (const [name, value] of Object.entries(res.headers)) for (const v of [value ?? []].flat()) given.append(name, v);
      const body = status === 204 || status === 304 ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
      const response = new Response(body, { status, statusText: res.statusMessage ?? '', headers: given });
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    }
  }) as typeof fetch;
}
