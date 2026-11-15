import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
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
}

/** The headset's films, played from the repository. The only folder a linked file may be in. */
export const LIBRARY_FILMS = resolve(import.meta.dirname, '../../../public/clips/full');

/** What `/assets/<id>` sends: bytes held here, a file on this host, or a remote address relayed as it streams. */
export type Stored = { mime: string } & ({ bytes: Uint8Array } | { file: string; size: number } | { url: string });

/**
 * Dropped and generated files on disk, each beside a small JSON record of its type and name. A linked asset is the record alone.
 * A linked file must be inside `files`, checked when it is linked and again when it is served, so an edited record cannot reach the rest of the disk.
 */
export class DiskAssets implements Assets {
  constructor(
    private readonly dir: string,
    private readonly baseUrl = '',
    private readonly files = LIBRARY_FILMS,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  async put(bytes: Uint8Array, mime: string, name?: string): Promise<{ id: string }> {
    const id = newId(mime, name);
    writeFileSync(join(this.dir, id), bytes);
    this.write(id, { mime: bare(mime), name });
    return { id };
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
