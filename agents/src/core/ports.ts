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

/** A work held by a museum, from its open online collection. */
export interface Artwork {
  title: string;
  maker: string;
  date: string;
  medium: string;
  museum: string;
  /** The museum's own page for the work. */
  url: string;
  image: string;
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
  art: {
    /** Works with a picture from museum collections that match a short catalogue search. */
    search(query: string, max?: number): Promise<Artwork[]>;
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
