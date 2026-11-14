import type { Id, Item } from '../src/core/domain.ts';
import type { Assets, Page, Artwork, Playable, SocialPost, Tools, WebResult } from '../src/core/ports.ts';
import { AGENT, DEFAULT_SETTINGS, makeItem, makeNode, type RoleContext, type Settings } from '../src/core/roles/types.ts';
import { Mindstorm } from '../src/core/state.ts';
import { FakeModel } from '../src/fake/model.ts';

export class MemoryAssets implements Assets {
  readonly files = new Map<string, { bytes: Uint8Array; mime: string; name?: string }>();
  async put(bytes: Uint8Array, mime: string, name?: string) {
    const id = `asset-${this.files.size + 1}`;
    this.files.set(id, { bytes, mime, name });
    return { id };
  }
  async get(id: string) {
    return this.files.get(id) ?? null;
  }
  url(id: string) {
    return `/assets/${id}`;
  }
}

export interface FakeWorld {
  pages: Map<string, Page>;
  posts: SocialPost[];
  web: WebResult[];
  /** Encyclopedia entries by the name asked for. */
  artworks: Map<string, Artwork[]>;
  /** Picture addresses that can be downloaded. */
  pictures: Set<string>;
  videos: Map<string, Playable>;
}

export interface Kit {
  ctx: RoleContext;
  mind: Mindstorm;
  model: FakeModel;
  assets: MemoryAssets;
  world: FakeWorld;
  notes: string[];
  /** Adds a user tree with one kept node per title, the first as root, the rest as its children. */
  seedTree(title: string, titles: string[], texts?: Record<string, string>): { treeId: Id; nodeIds: Id[] };
  item(fields: Partial<Item> & { title: string }): Item;
}

/** A role context over fakes: scripted model, in-memory assets, deterministic ids and clock. */
export function kit(settings: Partial<Settings> = {}): Kit {
  let n = 0;
  let tick = 0;
  const newId = () => `id-${++n}`;
  const now = () => new Date(Date.UTC(2026, 10, 13, 0, 0, tick++)).toISOString();
  const mind = new Mindstorm({ now, newId });
  const model = new FakeModel();
  const assets = new MemoryAssets();
  const world: FakeWorld = { pages: new Map(), posts: [], web: [], artworks: new Map(), pictures: new Set(), videos: new Map() };
  const notes: string[] = [];
  const tools: Tools = {
    web: {
      search: async (query, max = 5) => {
        const scripted = await model.search({ role: 'tool', query, max });
        return scripted.length > 0 ? scripted : world.web.slice(0, max);
      },
      read: async (url) => world.pages.get(url) ?? null,
      picture: async (url) => (world.pictures.has(url) ? { asset: (await assets.put(new Uint8Array([1]), 'image/jpeg', 'found')).id } : null),
      video: async (url) => world.videos.get(url) ?? null,
    },
    art: { search: async (query, max = 10) => (world.artworks.get(query) ?? []).slice(0, max) },
    instagram: { recent: async (limit = 10) => world.posts.slice(0, limit) },
    images: {
      generate: async (prompt) => {
        const made = await model.image({ role: 'tool', prompt });
        return { asset: (await assets.put(made.bytes, made.mime, 'generated.png')).id };
      },
    },
    code: { generate: async (prompt) => ({ title: prompt.slice(0, 40), language: 'js', source: `// ${prompt}` }) },
  };
  const ctx: RoleContext = {
    mind,
    model,
    tools,
    assets,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    newId,
    now,
    note: (role, message) => notes.push(`${role}: ${message}`),
  };
  const USER = { by: 'user' as const };
  const item: Kit['item'] = (fields) => ({
    ...makeItem(ctx, { kind: 'text', title: fields.title, origin: USER, source: { from: 'paste' } }),
    ...fields,
  });
  return {
    ctx,
    mind,
    model,
    assets,
    world,
    notes,
    item,
    seedTree(title, titles, texts = {}) {
      const treeId = newId();
      const items = titles.map((t) => item({ title: t, text: texts[t] ?? t }));
      const root = makeNode(ctx, items[0]!, { treeId, parent: null, status: 'kept', why: '', origin: USER });
      mind.apply({
        origin: USER,
        label: `seed ${title}`,
        commands: [
          ...items.map((i) => ({ type: 'addItem' as const, item: i })),
          { type: 'createTree', tree: { id: treeId, title, rootId: root.id, digest: title, createdAt: now() }, root },
        ],
      });
      const nodeIds = [root.id];
      for (const child of items.slice(1)) {
        const node = makeNode(ctx, child, { treeId, parent: root.id, status: 'kept', why: '', origin: USER });
        mind.apply({ origin: USER, label: 'seed', commands: [{ type: 'addNode', node }] });
        nodeIds.push(node.id);
      }
      return { treeId, nodeIds };
    },
  };
}

export { AGENT };
