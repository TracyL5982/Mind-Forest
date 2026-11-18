import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { LIBRARY, type Command, type Id, type Item, type LibraryRef, type Node, type Origin } from '../core/domain.ts';
import type { Assets } from '../core/ports.ts';
import type { Draft, Mindstorm } from '../core/state.ts';
import { byRule } from '../core/roles/renderer.ts';

/**
 * The headset's library as items of the mindstorm: its 100 films, 750 works, the notes and tags of ocean.json, and its saved trees.
 * Ids are made from the library's own keys, so an import adds only what the mindstorm lacks and a second run adds nothing.
 */

// ---- the files, read at the boundary

const Clips = z.object({
  atlas: z.object({ poster: z.string() }),
  clips: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      title: z.string(),
      year: z.number().int(),
      genres: z.array(z.string()),
      cast: z.array(z.string()),
      videoid: z.string(),
      scene: z.string(),
      description: z.string(),
      tile: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      full: z.object({ src: z.string() }),
    }),
  ),
});

const TagFile = z.object({ id: z.string(), name: z.string(), kind: z.string(), films: z.array(z.number().int()).default([]), works: z.array(z.number().int()).default([]) });

const Works = z.object({
  works: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      id: z.string().min(1),
      museum: z.string(),
      title: z.string(),
      maker: z.string(),
      date: z.string(),
      year: z.number().int(),
      place: z.string(),
      medium: z.string(),
      kind: z.string(),
      about: z.string(),
      url: z.string(),
      file: z.string(),
    }),
  ),
  tags: z.array(TagFile).default([]),
});

const Ocean = z.object({
  tags: z.array(TagFile),
  notes: z.array(
    z.object({
      id: z.string(),
      kicker: z.string(),
      headline: z.string(),
      highlight: z.string(),
      summary: z.string(),
      tags: z.array(z.string()),
      links: z.array(z.object({ to: z.string(), why: z.string() })),
      image: z.string().optional(),
      clip: z.number().int().optional(),
      chart: z.object({ labels: z.array(z.string()), values: z.array(z.number()), source: z.string().optional() }).optional(),
      link: z.object({ url: z.string(), site: z.string() }).optional(),
    }),
  ),
  briefs: z.array(z.object({ id: z.string(), line: z.string(), title: z.string(), root: z.string() })),
  saved: z.array(z.object({ title: z.string(), maker: z.string(), steps: z.array(z.string()) })),
});

/** What scripts/saved-trees.ts writes: each saved tree's steps as the Quest app's replay hangs them. */
const Replayed = z.array(
  z.object({
    title: z.string(),
    walked: z.array(z.string()),
    steps: z.array(z.object({ ref: z.string(), parent: z.number().int().nullable(), why: z.string() })),
  }),
);

export interface LibraryFiles {
  /** The repository: library/ocean.json, library/clips and library/works are read from it. */
  repo: string;
  /** The saved trees as replayed. Defaults to the copy beside this file. */
  saved?: string;
}

/** Turns pictures a browser may not show into JPEGs. A picture that could not be made is missing from the answer. */
export interface Pictures {
  /** `quality` from 1 to 100, 82 when not given. */
  jpeg(paths: string[], longest: number, quality?: number): Promise<Map<string, Uint8Array>>;
  /** One rectangle of a picture, `[x, y, width, height]` in its pixels. */
  crop(path: string, box: [number, number, number, number]): Promise<Uint8Array | null>;
}

// ---- the library as entries

/** How an entry's picture and recording are made, before any is. */
type Media =
  | { kind: 'none' }
  | { kind: 'work'; heic: string }
  | { kind: 'film'; atlas: string; tile: [number, number, number, number]; video: string }
  | { kind: 'file'; path: string }
  | { kind: 'of-film'; film: number };

interface Entry {
  id: Id;
  ref: LibraryRef;
  fields: Pick<Item, 'kind' | 'title' | 'text' | 'summary' | 'tags' | 'data'> & { url?: string };
  media: Media;
}

interface Library {
  entries: Entry[];
  /** The headset's own names for its pieces in saved trees and links: "film:3", "work:12" (a work's place in works.json), "note:x", "tag:y". */
  byKey: Map<string, Entry>;
  saved: z.infer<typeof Replayed>;
}

const ITEM = (ref: LibraryRef): Id => `library:${ref.kind}:${ref.key}`;
const USER: Origin = { by: 'user' };

export function readLibrary(files: LibraryFiles): Library {
  const read = <T>(schema: z.ZodType<T>, path: string): T => schema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const library = join(files.repo, 'library');
  const clips = read(Clips, join(library, 'clips/clips.json'));
  const works = read(Works, join(library, 'works/works.json'));
  const ocean = read(Ocean, join(library, 'ocean.json'));
  const saved = read(Replayed, files.saved ?? join(import.meta.dirname, 'library-saved.json'));

  // The headset gathers a tag from both files when both name it, as its catalog does.
  const tags = new Map<string, z.infer<typeof TagFile>>();
  for (const tag of [...ocean.tags, ...works.tags]) {
    const known = tags.get(tag.id);
    tags.set(tag.id, known ? { ...known, films: union(known.films, tag.films), works: union(known.works, tag.works) } : tag);
  }
  const named = (ids: Iterable<string>) => [...ids].flatMap((id) => (tags.has(id) ? [tags.get(id)!.name.toLowerCase()] : []));
  const filmTags = new Map<number, string[]>();
  const workTags = new Map<number, string[]>();
  for (const tag of tags.values()) {
    for (const f of tag.films) filmTags.set(f, [...(filmTags.get(f) ?? []), tag.id]);
    for (const w of tag.works) workTags.set(w, [...(workTags.get(w) ?? []), tag.id]);
  }

  const byKey = new Map<string, Entry>();
  const add = (key: string, entry: Omit<Entry, 'id'>) => byKey.set(key, { ...entry, id: ITEM(entry.ref) });

  for (const c of clips.clips) {
    add(`film:${c.index}`, {
      ref: { kind: 'film', key: c.index },
      fields: {
        kind: 'video',
        title: c.title,
        summary: `${c.scene}: ${c.description}`,
        text: [c.description, c.cast.length > 0 ? `With ${c.cast.slice(0, 4).join(', ')}.` : '', `${c.year}. ${c.genres.join(', ')}.`].filter(Boolean).join(' '),
        tags: [...new Set([...c.genres.map((g) => g.toLowerCase()), ...named(filmTags.get(c.index) ?? [])])],
        data: { when: String(c.year), from: 'Your film library' },
        url: `https://www.youtube.com/watch?v=${c.videoid}`,
      },
      media: { kind: 'film', atlas: join(library, clips.atlas.poster), tile: c.tile, video: join(library, c.full.src) },
    });
  }
  for (const w of works.works) {
    const line = [w.maker, w.date, w.medium, w.museum].filter(Boolean).join(', ');
    add(`work:${w.index}`, {
      ref: { kind: 'work', key: w.id },
      fields: {
        kind: 'image',
        title: w.title,
        summary: line,
        text: [line, w.about].filter(Boolean).join('\n\n'),
        tags: [...new Set([w.kind.toLowerCase(), ...(w.place ? [w.place.toLowerCase()] : []), ...named(workTags.get(w.index) ?? [])])],
        data: { by: w.maker, date: w.date, from: w.museum, when: String(w.year) },
        url: w.url,
      },
      media: { kind: 'work', heic: join(library, 'works', w.file) },
    });
  }
  const briefOf = new Map(ocean.briefs.map((b) => [b.root, b]));
  for (const n of ocean.notes) {
    const brief = briefOf.get(`note:${n.id}`);
    const still = n.clip ?? (n.image?.startsWith('still:') ? Number(n.image.slice(6)) : undefined);
    add(`note:${n.id}`, {
      ref: { kind: 'note', key: n.id },
      fields: {
        kind: n.clip !== undefined ? 'video' : n.image ? 'image' : 'text',
        title: n.headline,
        summary: n.summary,
        text: [brief ? `${brief.title}: ${brief.line}` : '', n.highlight, n.summary].filter(Boolean).join('\n\n'),
        tags: named(n.tags),
        data: { kicker: n.kicker, ...(n.chart ? { chart: { labels: n.chart.labels, values: n.chart.values } } : {}), ...(n.link ? { site: n.link.site } : {}) },
        ...(n.link ? { url: n.link.url } : {}),
      },
      media: still !== undefined ? { kind: 'of-film', film: still } : n.image ? { kind: 'file', path: join(library, 'notes', n.image) } : { kind: 'none' },
    });
  }
  for (const t of tags.values()) {
    const films = t.films.flatMap((f) => (clips.clips[f] ? [`${clips.clips[f]!.title} (${clips.clips[f]!.year})`] : []));
    const gathered = t.works.flatMap((w) => (works.works[w] ? [works.works[w]!.title] : []));
    add(`tag:${t.id}`, {
      ref: { kind: 'tag', key: t.id },
      fields: {
        kind: 'text',
        title: t.name,
        summary: [films.length ? `${films.length} films` : '', gathered.length ? `${gathered.length} works` : ''].filter(Boolean).join(' and '),
        text: [films.length ? `Films: ${films.join('; ')}.` : '', gathered.length ? `Works: ${gathered.join('; ')}.` : ''].filter(Boolean).join('\n'),
        tags: [t.kind],
        data: {},
      },
      media: { kind: 'none' },
    });
  }

  // Replayed trees are only good while they were made from these saved trees.
  for (const spec of ocean.saved) {
    const replay = saved.find((s) => s.title === spec.title);
    if (!replay || replay.walked.join() !== spec.steps.join()) {
      throw new Error(`The saved tree "${spec.title}" changed since src/node/library-saved.json was made. Run npm run saved-trees.`);
    }
    for (const step of replay.steps) if (!byKey.has(step.ref)) throw new Error(`The saved tree "${spec.title}" names ${step.ref}, which the library does not hold.`);
  }
  return { entries: [...byKey.values()], byKey, saved: saved.filter((s) => ocean.saved.some((spec) => spec.title === s.title)) };
}

// ---- adding it to a mindstorm

export interface Imported {
  /** Null when the mindstorm already holds everything. */
  draft: Draft | null;
  added: { films: number; works: number; notes: number; tags: number; trees: number; pictures: number };
}

/** What the mindstorm lacks of the library, with each new picture made and stored. Nothing is applied. */
export async function libraryDraft(opts: { files: LibraryFiles; mind: Mindstorm; assets: Assets; pictures: Pictures; now: () => string; log?: (line: string) => void }): Promise<Imported> {
  const { mind, assets, pictures } = opts;
  const library = readLibrary(opts.files);
  const missing = library.entries.filter((e) => !mind.items.has(e.id));
  const media = await makeMedia(missing, library, mind, assets, pictures, opts.log ?? (() => {}));

  const items: Item[] = missing.map((e) => {
    const made = media.get(e.id) ?? {};
    const { url, ...fields } = e.fields;
    return {
      ...fields,
      kind: fields.kind === 'image' && !made.asset ? 'text' : fields.kind === 'video' && !made.mediaUrl ? 'text' : fields.kind,
      id: e.id,
      data: { ...fields.data, library: e.ref, ...(made.mediaUrl ? { mediaUrl: made.mediaUrl } : {}), ...(made.thumbnailUrl ? { thumbnailUrl: made.thumbnailUrl } : {}) },
      source: { from: LIBRARY, ...(url ? { url } : {}), ...(made.asset ? { asset: made.asset } : {}), capturedAt: opts.now() },
      origin: USER,
      archived: false,
      revision: 0,
    };
  });

  const known = (id: Id) => mind.items.get(id) ?? items.find((i) => i.id === id)!;
  const commands: Command[] = items.map((item): Command => ({ type: 'addItem', item }));
  let trees = 0;
  for (const saved of library.saved) {
    const treeId = `library:saved:${slug(saved.title)}`;
    // A saved tree the user has since deleted is not brought back.
    if (everExisted(mind, treeId)) continue;
    const nodeIds = saved.steps.map((_s, i) => `${treeId}:${i}`);
    const siblings = new Map<number | null, number>();
    const nodes = saved.steps.map((step, i): Node => {
      const order = siblings.get(step.parent) ?? 0;
      siblings.set(step.parent, order + 1);
      const item = known(library.byKey.get(step.ref)!.id);
      return {
        id: nodeIds[i]!,
        treeId,
        itemId: item.id,
        parent: step.parent === null ? null : nodeIds[step.parent]!,
        status: 'kept',
        why: step.why,
        importance: 0.5,
        origin: USER,
        view: { ...byRule(item, (id) => assets.url(id)), by: 'default' },
        order,
      };
    });
    const digest = nodes.map((n) => known(n.itemId).title).join('; ').slice(0, 400);
    commands.push({ type: 'createTree', tree: { id: treeId, title: saved.title, rootId: nodes[0]!.id, digest, createdAt: opts.now() }, root: nodes[0]! });
    for (const node of nodes.slice(1)) commands.push({ type: 'addNode', node });
    trees++;
  }

  const count = (kind: LibraryRef['kind']) => items.filter((i) => (i.data.library as LibraryRef).kind === kind).length;
  return {
    draft: commands.length > 0 ? { origin: USER, label: "Add the headset's library", commands } : null,
    added: { films: count('film'), works: count('work'), notes: count('note'), tags: count('tag'), trees, pictures: [...media.values()].filter((m) => m.asset || m.thumbnailUrl).length },
  };
}

interface Made {
  /** The item's own file: a work's picture, a note's picture, or a film's video. */
  asset?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
}

async function makeMedia(missing: Entry[], library: Library, mind: Mindstorm, assets: Assets, pictures: Pictures, log: (line: string) => void): Promise<Map<Id, Made>> {
  const made = new Map<Id, Made>();
  const works = missing.flatMap((e) => (e.media.kind === 'work' ? [{ e, heic: e.media.heic }] : []));
  const jpegs = works.length > 0 ? await pictures.jpeg(works.map((w) => w.heic), 512) : new Map<string, Uint8Array>();
  for (const { e, heic } of works) {
    const bytes = jpegs.get(heic);
    if (bytes) made.set(e.id, { asset: (await assets.put(bytes, 'image/jpeg', `${basename(heic, extname(heic))}.jpg`)).id });
  }
  if (works.length > 0) log(`${jpegs.size} of ${works.length} works' pictures made`);

  const films = missing.flatMap((e) => (e.media.kind === 'film' ? [{ e, media: e.media }] : []));
  await inTurn(films, 8, async ({ e, media }) => {
    const still = await pictures.crop(media.atlas, media.tile);
    const video = existsSync(media.video) ? (await assets.link(media.video, 'video/mp4', basename(media.video))).id : undefined;
    made.set(e.id, {
      ...(video ? { asset: video, mediaUrl: assets.url(video) } : {}),
      ...(still ? { thumbnailUrl: assets.url((await assets.put(still, 'image/jpeg', `${e.id}.jpg`)).id) } : {}),
    });
  });

  for (const e of missing) {
    if (e.media.kind === 'file' && existsSync(e.media.path)) {
      const path = e.media.path;
      const bytes = /\.(jpe?g|png)$/i.test(path) ? new Uint8Array(readFileSync(path)) : (await pictures.jpeg([path], 1024)).get(path);
      if (bytes) made.set(e.id, { asset: (await assets.put(bytes, /\.png$/i.test(path) ? 'image/png' : 'image/jpeg', basename(path))).id });
    }
    if (e.media.kind === 'of-film') {
      // A note that shows a film plays that film's own file, made now or by an earlier import.
      const film = library.byKey.get(`film:${e.media.film}`);
      const from = film ? (made.get(film.id) ?? filmMade(mind.items.get(film.id))) : undefined;
      if (from) made.set(e.id, e.fields.kind === 'video' ? from : from.thumbnailUrl ? { asset: idOf(from.thumbnailUrl) } : {});
    }
  }
  return made;
}

function filmMade(item: Item | undefined): Made | undefined {
  if (!item) return undefined;
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return { asset: item.source.asset, mediaUrl: text(item.data.mediaUrl), thumbnailUrl: text(item.data.thumbnailUrl) };
}

function idOf(address: string): string {
  return address.slice(address.lastIndexOf('/') + 1);
}

function everExisted(mind: Mindstorm, treeId: Id): boolean {
  return mind.trees.has(treeId) || mind.changes().some((set) => set.patches.some((p) => p.entity === 'tree' && p.id === treeId));
}

async function inTurn<T>(all: T[], width: number, each: (one: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, all.length) }, async () => {
    while (next < all.length) await each(all[next++]!);
  }));
}

function union(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])];
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---- pictures made with sips, which every Mac has

const run = promisify(execFile);
const BATCH = 100;

/** HEIC to JPEG and crops with macOS's own `sips`, several at once. Elsewhere every picture is missing. */
export const sipsPictures: Pictures = {
  async jpeg(paths, longest, quality = 82) {
    const out = mkdtempSync(join(tmpdir(), 'library-'));
    try {
      const batches = Array.from({ length: Math.ceil(paths.length / BATCH) }, (_v, i) => paths.slice(i * BATCH, (i + 1) * BATCH));
      await inTurn(batches, 8, async (batch) => {
        await run('sips', ['-Z', String(longest), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), ...batch, '--out', out]).catch(() => null);
      });
      const made = new Map<string, Uint8Array>();
      for (const path of paths) {
        const file = join(out, `${basename(path, extname(path))}.jpg`);
        if (existsSync(file)) made.set(path, new Uint8Array(readFileSync(file)));
      }
      return made;
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
  async crop(path, [x, y, width, height]) {
    const out = mkdtempSync(join(tmpdir(), 'library-'));
    try {
      const file = join(out, 'crop.jpg');
      await run('sips', ['-c', String(height), String(width), '--cropOffset', String(y), String(x), '-s', 'format', 'jpeg', path, '--out', file]);
      return new Uint8Array(readFileSync(file));
    } catch {
      return null;
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
};
