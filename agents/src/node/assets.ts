import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { join, resolve, sep } from 'node:path';
import type { Assets } from '../core/ports.ts';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

interface Meta {
  mime: string;
  name?: string;
  /** A linked asset's bytes: the absolute path of a file on this host, or a remote address. */
  from?: string;
  /** Kept by the service itself (`put`): a picture it fetched, made or copied in, not an upload. */
  made?: true;
}

/** The headset's films, played from the repository. The only folder a linked file may be in. */
export const LIBRARY_FILMS = resolve(import.meta.dirname, '../../../library/clips/full');

/** What `/assets/<id>` sends: bytes held here, a file on this host, or a remote address relayed as it streams. */
export type Stored = { mime: string } & ({ bytes: Uint8Array } | { file: string; size: number } | { url: string });

/**
 * Dropped and generated files on disk, each beside a small JSON record of its type and name. A linked asset is the record alone.
 * A linked file must be inside `files`, checked when it is linked and again when it is served, so an edited record cannot reach the rest of the disk.
 */
export class DiskAssets implements Assets {
  private madeBytes = 0;

  /** With `madeLimit`, the files the service keeps here itself come to at most that many bytes; a `put` past it is refused. */
  constructor(
    private readonly dir: string,
    private readonly baseUrl = '',
    private readonly files = LIBRARY_FILMS,
    private readonly madeLimit?: number,
  ) {
    mkdirSync(dir, { recursive: true });
    if (madeLimit !== undefined) this.madeBytes = this.madeOnDisk();
  }

  /** The bytes of the files the service kept here itself. Uploads are not among them: they have a limit of their own. */
  made(): number {
    return this.madeBytes;
  }

  room(bytes: number): boolean {
    return this.madeLimit === undefined || this.madeBytes + bytes <= this.madeLimit;
  }

  async put(bytes: Uint8Array, mime: string, name?: string): Promise<{ id: string }> {
    if (!this.room(bytes.length)) {
      throw new Error(`no room to keep ${name ?? 'a file'}: this headset's files come to ${(this.madeLimit! / 1e6).toFixed(0)} MB at most`);
    }
    const id = newId(mime, name);
    writeFileSync(join(this.dir, id), bytes);
    this.write(id, { mime: bare(mime), name, made: true });
    this.madeBytes += bytes.length;
    return { id };
  }

  /** A file written to disk as it arrives, never held whole. Past `limit` bytes it is removed, and `tooLarge()` is thrown. */
  async putStream(body: AsyncIterable<Uint8Array>, mime: string, name: string | undefined, limit: number, tooLarge: () => Error): Promise<{ id: string; size: number }> {
    const id = newId(mime, name);
    const file = join(this.dir, id);
    const out = createWriteStream(file);
    let size = 0;
    try {
      for await (const chunk of body) {
        size += chunk.length;
        if (size > limit) throw tooLarge();
        if (!out.write(chunk)) await once(out, 'drain');
      }
      out.end();
      await finished(out);
    } catch (err) {
      // The stream opens its file on its own time, so it is removed once the stream has closed, or it would come back empty.
      out.destroy();
      await finished(out).catch(() => {});
      rmSync(file, { force: true });
      throw err;
    }
    this.write(id, { mime: bare(mime), name });
    return { id, size };
  }

  async link(from: string, mime: string, name?: string): Promise<{ id: string }> {
    if (!/^https?:\/\//i.test(from) && !this.inside(from)) throw new Error(`an asset links to a web address or a file in ${this.files}, not "${from}"`);
    const id = newId(mime, name ?? from);
    this.write(id, { mime: bare(mime), name, from });
    return { id };
  }

  async get(id: string): Promise<{ bytes: Uint8Array; mime: string; name?: string } | null> {
    const stored = this.open(id);
    if (!stored || 'url' in stored) return null;
    try {
      const bytes = 'bytes' in stored ? stored.bytes : new Uint8Array(readFileSync(stored.file));
      return { bytes, mime: stored.mime, name: this.read(id)?.name };
    } catch {
      return null;
    }
  }

  open(id: string): Stored | null {
    const meta = this.read(id);
    if (!meta) return null;
    try {
      if (!meta.from) return { mime: meta.mime, bytes: new Uint8Array(readFileSync(join(this.dir, id))) };
      if (/^https?:\/\//i.test(meta.from)) return { mime: meta.mime, url: meta.from };
      if (!this.inside(meta.from)) return null;
      return { mime: meta.mime, file: meta.from, size: statSync(meta.from).size };
    } catch {
      return null;
    }
  }

  url(id: string): string {
    return `${this.baseUrl}/assets/${id}`;
  }

  /** Whether a path, with every link and `..` followed, is a file in the folder linked files may come from. */
  private inside(path: string): boolean {
    try {
      return realpathSync(path).startsWith(realpathSync(this.files) + sep) && statSync(path).isFile();
    } catch {
      return false;
    }
  }

  private madeOnDisk(): number {
    let bytes = 0;
    for (const name of readdirSync(this.dir)) {
      const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
      if (!this.read(id)?.made) continue;
      try {
        bytes += statSync(join(this.dir, id)).size;
      } catch {
        // Its record without its file: nothing is kept.
      }
    }
    return bytes;
  }

  private read(id: string): Meta | null {
    if (!/^[a-f0-9]{16}\.[a-z0-9]{1,5}$/.test(id)) return null;
    try {
      return JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')) as Meta;
    } catch {
      return null;
    }
  }

  private write(id: string, meta: Meta): void {
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(meta));
  }
}

function newId(mime: string, name?: string): string {
  const ext = EXT[bare(mime)] ?? name?.match(/\.([a-z0-9]{1,5})(?:[?#].*)?$/i)?.[1]?.toLowerCase() ?? 'bin';
  return `${randomBytes(8).toString('hex')}.${ext}`;
}

function bare(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase();
}
