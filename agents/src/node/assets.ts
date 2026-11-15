import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

/** Dropped and generated files on disk, each beside a small JSON record of its type and name. */
export class DiskAssets implements Assets {
  constructor(
    private readonly dir: string,
    private readonly baseUrl = '',
  ) {
    mkdirSync(dir, { recursive: true });
  }

  async put(bytes: Uint8Array, mime: string, name?: string): Promise<{ id: string }> {
    const type = mime.split(';')[0]!.trim().toLowerCase();
    const ext = EXT[type] ?? name?.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase() ?? 'bin';
    const id = `${randomBytes(8).toString('hex')}.${ext}`;
    writeFileSync(join(this.dir, id), bytes);
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify({ mime: type, name }));
    return { id };
  }

  async get(id: string): Promise<{ bytes: Uint8Array; mime: string; name?: string } | null> {
    if (!/^[a-f0-9]{16}\.[a-z0-9]{1,5}$/.test(id)) return null;
    try {
      const meta = JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')) as { mime: string; name?: string };
      return { bytes: new Uint8Array(readFileSync(join(this.dir, id))), mime: meta.mime, name: meta.name };
    } catch {
      return null;
    }
  }

  url(id: string): string {
    return `${this.baseUrl}/assets/${id}`;
  }
}
