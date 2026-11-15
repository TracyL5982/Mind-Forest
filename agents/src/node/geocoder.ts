import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Geocoder, LatLon } from '../core/ports.ts';

/** What a client is told about the map provider: the address of its tiles and the credit every map shows. See docs/libraries.md. */
export interface Tiles {
  tiles: string;
  credit: string;
  /** Where the credit links to, in a view where a link can be followed. */
  link?: string;
}

/** Maps switched on: the tiles a client draws, and the geocoder Intake asks where a place is. */
export interface Maps extends Tiles {
  geocoder: Geocoder;
}

/**
 * The providers `MIND_PALACE_MAPS` may name. OpenStreetMap's public servers need no key, but allow light use only and ask for the
 * credit on every map, so a commercial provider replaces them before the product ships.
 */
const PROVIDERS: Record<string, Tiles & { search: string }> = {
  openstreetmap: {
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap contributors',
    link: 'https://www.openstreetmap.org/copyright',
    search: 'https://nominatim.openstreetmap.org/search',
  },
};

/** The maps a provider gives, with its lookups cached in `cacheFile`. Throws for a name no provider has. */
export function openMaps(name: string, cacheFile: string): Maps {
  const provider = PROVIDERS[name.trim().toLowerCase()];
  if (!provider) throw new Error(`MIND_PALACE_MAPS names no provider this service knows: "${name}". Known: ${Object.keys(PROVIDERS).join(', ')}.`);
  const { search, ...tiles } = provider;
  return { ...tiles, geocoder: new Nominatim({ search, cacheFile }) };
}

/** The name every lookup carries. It says what kind of client asks and nothing about who runs it. */
export const CLIENT_NAME = 'notes-place-lookup/1.0';
/** OpenStreetMap's lookup allows one request a second from a client. */
const GAP_MS = 1000;
const TIMEOUT_MS = 10_000;
/**
 * The kinds of result whose point stands for a place a note names: a settlement or a region, a natural feature, a sight. A shop, a
 * restaurant or a building that shares the name is not the place, so `The kitchen` finds nothing rather than a café.
 */
const KINDS = new Set(['place', 'boundary', 'natural', 'tourism', 'historic', 'leisure', 'waterway', 'landuse']);

export interface NominatimOptions {
  /** The search address of a Nominatim server. */
  search: string;
  cacheFile: string;
  fetch?: typeof fetch;
  /** Milliseconds on some clock, and a wait of so many. Tests pass a clock they move by hand. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Looks places up on a Nominatim server, at most one request a second, and keeps every answer in a file, a place that was not found
 * included, so a name is asked about once. A failed request is not kept, so it is asked again next time.
 */
export class Nominatim implements Geocoder {
  private readonly cache: Record<string, LatLon | null>;
  private readonly asking = new Map<string, Promise<LatLon | null>>();
  private queue: Promise<unknown> = Promise.resolve();
  private last = -Infinity;
  private readonly send: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: NominatimOptions) {
    this.cache = readCache(opts.cacheFile);
    this.send = opts.fetch ?? fetch.bind(globalThis);
    this.now = opts.now ?? (() => performance.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  }

  locate(name: string): Promise<LatLon | null> {
    const key = name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) return Promise.resolve(null);
    if (Object.hasOwn(this.cache, key)) return Promise.resolve(this.cache[key]!);
    const asked = this.asking.get(key) ?? this.inTurn(() => this.ask(key)).finally(() => this.asking.delete(key));
    this.asking.set(key, asked);
    return asked;
  }

  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const turn = this.queue.then(async () => {
      const wait = this.last + GAP_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      return work();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async ask(key: string): Promise<LatLon | null> {
    try {
      const res = await this.send(`${this.opts.search}?${new URLSearchParams({ q: key, format: 'jsonv2', limit: '5' })}`, {
        headers: { 'User-Agent': CLIENT_NAME, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const found = pointOf(await res.json());
      this.cache[key] = found;
      mkdirSync(dirname(this.opts.cacheFile), { recursive: true });
      writeFileSync(this.opts.cacheFile, JSON.stringify(this.cache, null, 1));
      return found;
    } catch {
      return null;
    }
  }
}

/** The first result of a kind that stands for a place, or null. */
function pointOf(results: unknown): LatLon | null {
  if (!Array.isArray(results)) return null;
  for (const result of results as Record<string, unknown>[]) {
    const [lat, lon] = [Number(result.lat), Number(result.lon)];
    if (KINDS.has(String(result.category)) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }
  return null;
}

function readCache(file: string): Record<string, LatLon | null> {
  try {
    const kept = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return typeof kept === 'object' && kept !== null && !Array.isArray(kept) ? (kept as Record<string, LatLon | null>) : {};
  } catch {
    return {};
  }
}
