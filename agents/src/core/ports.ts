import type { z } from 'zod';

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
  effort?: 'low' | 'medium' | 'high';
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
  search(req: { role: string; query: string; max?: number }): Promise<WebResult[]>;
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
  /** Audio or video that plays in place. */
  media?: string;
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
    /** Confirms a video address is real and returns how to play it in place. */
    video(url: string): Promise<Playable | null>;
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
}

export interface Assets {
  put(bytes: Uint8Array, mime: string, name?: string): Promise<{ id: string }>;
  get(id: string): Promise<{ bytes: Uint8Array; mime: string; name?: string } | null>;
  /** The address a client loads the asset from. */
  url(id: string): string;
}

/** Where change sets are kept between runs. */
export interface Store {
  append(set: import('./domain.ts').ChangeSet): void;
  all(): import('./domain.ts').ChangeSet[];
}
