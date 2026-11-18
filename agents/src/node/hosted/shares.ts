/**
 * Trees shared from the judges' headsets, each kept on the volume under a one-time code until a friend opens its link, for a
 * week at most: the copy taken when it was shared, and its files. The sharer keeps their tree; this is a copy.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { SharedFile, TreeCopy } from '../../core/sharing.ts';

/** How long a shared tree's link works. */
export const SHARE_MS = 7 * 24 * 3_600_000;
/** Trees one headset may share in a day, so the bot cannot be made to post without end. */
export const SHARES_PER_DAY = 20;
/** How long a code is remembered after its week, so a friend opening it late is told it expired. */
const FORGET_MS = 30 * 24 * 3_600_000;

const Entry = z.object({
  device: z.string(),
  title: z.string(),
  made: z.number(),
  expires: z.number(),
  /** When a friend's space took it, and whose. */
  used: z.number().nullable(),
  to: z.string().nullable(),
});
type Entry = z.infer<typeof Entry>;
const Index = z.record(z.string(), Entry);
const FileMeta = z.object({ id: z.string(), mime: z.string(), name: z.string().optional(), link: z.string().optional() });

/** A link's code: twelve characters Telegram passes on in a `start` link. */
const CODE = /^[A-Za-z0-9_-]{12}$/;

export type Found = { state: 'live'; entry: Entry; copy: TreeCopy; files: SharedFile[] } | { state: 'unknown' | 'used' | 'expired'; entry?: Entry };

export class Shares {
  private index: Record<string, Entry>;
  private readonly file: string;

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'index.json');
    this.index = existsSync(this.file) ? Index.parse(JSON.parse(readFileSync(this.file, 'utf8'))) : {};
    this.sweep();
  }

  /** Trees the headset shared in the last day. */
  today(device: string): number {
    const since = this.now() - 24 * 3_600_000;
    return Object.values(this.index).filter((entry) => entry.device === device && entry.made > since).length;
  }

  /** Keeps a copy and its files under a new code. */
  make(device: string, copy: TreeCopy, files: SharedFile[]): string {
    let code: string;
    do code = randomBytes(9).toString('base64url');
    while (this.index[code] || existsSync(join(this.dir, code)));
    const folder = join(this.dir, code);
    mkdirSync(folder);
    for (const file of files) if (file.bytes) writeFileSync(join(folder, `file-${files.indexOf(file)}`), file.bytes);
    const meta = files.map(({ id, mime, name, link }) => ({ id, mime, ...(name ? { name } : {}), ...(link ? { link } : {}) }));
    writeFileSync(join(folder, 'copy.json'), JSON.stringify({ copy, files: meta }));
    const now = this.now();
    this.index[code] = { device, title: copy.title, made: now, expires: now + SHARE_MS, used: null, to: null };
    this.keep();
    return code;
  }

  /** What a code is: a tree waiting, with its copy and files, or why not. */
  find(code: string): Found {
    const entry = CODE.test(code) ? this.index[code] : undefined;
    if (!entry) return { state: 'unknown' };
    if (entry.used !== null) return { state: 'used', entry };
    if (this.now() > entry.expires) return { state: 'expired', entry };
    const folder = join(this.dir, code);
    const saved = z.object({ copy: z.custom<TreeCopy>(), files: z.array(FileMeta) }).parse(JSON.parse(readFileSync(join(folder, 'copy.json'), 'utf8')));
    const files = saved.files.map((meta, n): SharedFile => (meta.link ? meta : { ...meta, bytes: new Uint8Array(readFileSync(join(folder, `file-${n}`))) }));
    return { state: 'live', entry, copy: saved.copy, files };
  }

  /** A friend's space took the tree: the code works no more, and its files go, their copies being there now. */
  use(code: string, to: string): void {
    const entry = this.index[code];
    if (!entry) return;
    this.index[code] = { ...entry, used: this.now(), to };
    this.keep();
    rmSync(join(this.dir, code), { recursive: true, force: true });
  }

  /** The entry of a code, used or not, while it is kept. */
  entry(code: string): Entry | undefined {
    return this.index[code];
  }

  /** A share that could not be offered goes, as if never made. */
  drop(code: string): void {
    const { [code]: _gone, ...rest } = this.index;
    this.index = rest;
    this.keep();
    rmSync(join(this.dir, code), { recursive: true, force: true });
  }

  /**
   * A code past its week loses its files at once, and its entry a month later, until when a friend opening it is told it expired.
   * A folder no live code names goes too.
   */
  sweep(): void {
    const now = this.now();
    const kept = Object.entries(this.index).filter(([, entry]) => now <= entry.expires + FORGET_MS);
    if (kept.length !== Object.keys(this.index).length) {
      this.index = Object.fromEntries(kept);
      this.keep();
    }
    for (const name of readdirSync(this.dir)) {
      const entry = this.index[name];
      if (name === 'index.json' || name.endsWith('.tmp') || (entry && entry.used === null && now <= entry.expires)) continue;
      rmSync(join(this.dir, name), { recursive: true, force: true });
    }
  }

  private keep(): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.index));
    renameSync(`${this.file}.tmp`, this.file);
  }
}
