import type { z } from 'zod';

/** A request the user waits on, or background work that waits behind the user's when requests are held. */
export type Priority = 'user' | 'background';

export interface JsonRequest<T> {
  /** Which role is asking. The scripted fake routes on it. */
  role: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Public URLs or data: URLs the model should look at. */
  images?: string[];
  /** Public URLs or data: URLs of video the model should watch. */
  videos?: string[];
  /** How much the model reasons. A quick request reasons as little as the host allows unless this says otherwise. */
  effort?: 'minimal' | 'low' | 'medium' | 'high';
  /** An answer the user is waiting on. The host answers it with a smaller, faster model. */
  quick?: boolean;
  /**
   * Who waits on the answer, which decides its place when the host holds requests for a rate limit. A request that does not say is
   * one the user waits on, so a forgotten one never waits behind background work.
   */
  priority?: Priority;
  /**
   * Called with the reply's text so far each time more of it is written, for a role that acts on the start of a reply.
   * A host that cannot stream calls it once, with the whole text. The returned value is the whole reply, as without it.
   */
  onText?: (soFar: string) => void;
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * The model answered, and its answer is not of the schema asked for: empty, no JSON, or of another shape. A smaller question may
 * be answered where this one was not. A request that got no answer, as after a timeout or a lost connection, fails with any other error.
 */
export class Unreadable extends Error {
  /** For a role whose reply did not parse, or broke the schema where these issues say. */
  constructor(role: string, why: string | { path: PropertyKey[]; message: string }[]) {
    super(`${role}: the reply is unreadable (${typeof why === 'string' ? why : why.slice(0, 2).map(({ path, message }) => `${path.join('.') || 'reply'}: ${message}`).join('; ')})`);
  }
}

/** The model. Hosts provide the real one; tests provide a scripted one. */
export interface ModelClient {
  /** One reply, constrained to the schema and parsed. */
  json<T>(req: JsonRequest<T>): Promise<T>;
  /** Live web search. Returns the raw hits, best first. */
  /** `prefer` says which kinds of pages to favour and which to leave out. */
  search(req: { role: string; query: string; max?: number; prefer?: string }): Promise<WebResult[]>;
  image(req: { role: string; prompt: string }): Promise<{ bytes: Uint8Array; mime: string }>;
  transcribe(req: { audio: Uint8Array; mime: string }): Promise<string>;
}

export interface Page {
  url: string;
  title: string;
  text: string;
  site: string;
  image?: string;
}

/** A place the Scout can search for real material: the web, papers, books, museums and so on. */
export interface Source {
  id: string;
  name: string;
  /** What kind of direction this source serves, told to the model. */
  goodFor: string;
  /** How a search of this source should be written, told to the model. */
  query: string;
  /** How many of its records one direction may show. */
  show: number;
  /** Its records are things to look at, so one without a picture is not shown. */
  visual?: boolean;
}

/** One record a source returned. */
export interface Found {
  title: string;
  /** Who made or wrote it. */
  by: string;
  date: string;
  /** The words of the record itself: an abstract, a description, a page's text, a comment thread. */
  text: string;
  url: string;
  /** The collection or channel it came from, when that is narrower than the source. */
  from?: string;
  image?: string;
  /** A recording that plays in place, such as a podcast episode or a film. */
  media?: string;
  /** How long `media` plays, in seconds, when the source says. */
  seconds?: number;
  steps?: string[];
  chart?: { labels: string[]; values: number[]; unit?: string };
  /** What kind of thing the record is, when its source knows. */
  kind?: 'artwork' | 'paper' | 'book';
  /** What a work is made of, as its holder catalogues it. */
  medium?: string;
  /** The museum or collection that holds a work. */
  holder?: string;
  /** The authors in order, as many as the source lists. `by` may shorten them. */
  authors?: string[];
  /** True when the source cut `authors` short, so there are more than are listed. */
  authorsCut?: boolean;
  /** The journal, conference or repository a paper appeared in. */
  venue?: string;
}

/** A video that can be played inside a client. */
export interface Playable {
  title: string;
  url: string;
  embed: string;
  poster?: string;
}

export interface SocialPost {
  id: string;
  url: string;
  caption: string;
  mediaType: 'image' | 'video' | 'album';
  mediaUrl?: string;
  thumbnailUrl?: string;
  postedAt: string;
}

export interface Tools {
  web: {
    search(query: string, max?: number): Promise<WebResult[]>;
    /** The readable text of a page, or null when it cannot be fetched. */
    read(url: string): Promise<Page | null>;
    /** Downloads a picture and stores it, so a client shows it in place. Null when the address holds no usable picture. */
    picture(url: string): Promise<{ asset: string } | null>;
    /** Videos for a search that can be played in place, best first. */
    videos(query: string): Promise<Playable[]>;
  };
  sources: {
    list(): Source[];
    /** Searches one source. An unknown source or a failed search gives an empty list or throws. */
    search(id: string, query: string): Promise<Found[]>;
  };
  instagram: {
    /** The connected account's own recent posts. */
    recent(limit?: number): Promise<SocialPost[]>;
  };
  images: {
    /** Generates a picture and stores it. Returns the asset id. */
    generate(prompt: string): Promise<{ asset: string }>;
  };
  code: {
    generate(prompt: string): Promise<{ title: string; language: string; source: string }>;
  };
  /** Present only when maps are switched on, because a lookup sends a place's name off the machine. */
  geocoder?: Geocoder;
}

/** A point on the earth in degrees, as GPS gives it: `lat` from -90 to 90, north positive, and `lon` from -180 to 180, east positive. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Finds where a named place is. */
export interface Geocoder {
  /** Null when the place is not known or the lookup failed. Never throws. */
  locate(name: string): Promise<LatLon | null>;
}

export interface Assets {
  put(bytes: Uint8Array, mime: string, name?: string): Promise<{ id: string }>;
  /**
   * An asset whose bytes stay where they are, a remote address or a file on the host, streamed through the service when asked for.
   * For playable media too large to copy. Never called with an address a client supplied.
   */
  link(from: string, mime: string, name?: string): Promise<{ id: string }>;
  /** The bytes, when the host holds them. Null for an asset linked to a remote address. */
  get(id: string): Promise<{ bytes: Uint8Array; mime: string; name?: string } | null>;
  /** The address a client loads the asset from. */
  url(id: string): string;
}

/** Where change sets are kept between runs. */
export interface Store {
  append(set: import('./domain.ts').ChangeSet): void;
  all(): import('./domain.ts').ChangeSet[];
}
