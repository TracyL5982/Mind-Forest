import { readFileSync } from 'node:fs';
import type { Item, Node } from '../src/core/domain.ts';
import type { ModelClient } from '../src/core/ports.ts';
import { byModel, byRule, renderer, unsure, type ComponentsReply, type Entry, type Verdict } from '../src/core/roles/renderer.ts';
import { makeNode } from '../src/core/roles/types.ts';
import type { ComponentId, CompositeId } from '../src/core/views.ts';
import { kit } from './kit.ts';

export const ACTIVITIES = ['research', 'brainstorming', 'memories'] as const;
/**
 * Who wrote a sample and its key. `reviewers` are the 120 that two independent reviewers wrote before the model chose any card.
 * `authors` are those written with this work, for the kinds of content the model was added to draw.
 */
export const ORIGINS = ['reviewers', 'authors'] as const;

/** One item of the sample set, with the card a person would pick for it. */
export interface Sample {
  key: string;
  origin: (typeof ORIGINS)[number];
  activity: (typeof ACTIVITIES)[number];
  language: 'en' | 'zh';
  /** What the user did to make the item. */
  what: string;
  expect: ComponentId;
  /** Other cards a person would not mind. */
  accept: ComponentId[];
  /** The item as Intake or the Scout built it. */
  item: Item;
}

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/formats.json', import.meta.url), 'utf8')) as { items: Sample[]; pools: Pool[] };

export const samples = (): Sample[] => fixture().items;

/** Siblings under one parent, with the arrangement a person would draw them as, or `none` where no group is right. */
export interface Pool {
  key: string;
  activity: (typeof ACTIVITIES)[number];
  language: 'en' | 'zh';
  what: string;
  expect: CompositeId | 'none';
  siblings: { status: Node['status']; item: Item }[];
}

export const pools = (): Pool[] => fixture().pools;

export const assetUrl = (id: string): string => `/assets/${id}`;

export const agrees = (sample: Sample, component: string): boolean => component === sample.expect || sample.accept.includes(component as ComponentId);

/** What the Renderer made of one sample. */
export interface Outcome {
  sample: Sample;
  /** The card the rules alone draw. */
  ruled: string;
  /** Whether the Renderer asked the model about it. */
  asked: boolean;
  /** What the model answered, and what the checks made of the answer. Absent when it was not asked or gave no entry. */
  reply?: Entry;
  verdict?: Verdict;
  /** The card the Renderer drew in the end. */
  drawn: string;
}

/** The most unsure items one pass of the Renderer asks about. */
const ASKED_AT_ONCE = 24;

/**
 * A model that gives each sample the reply an earlier run saved for it, and none to a sample that run did not ask about.
 * It answers the Renderer's question about cards and nothing else. `keyOf` names the sample a node of this run holds.
 */
export function replaying(saved: { key: string; reply?: Entry }[], keyOf: (nodeId: string) => string | undefined): ModelClient {
  const said = new Map(saved.flatMap(({ key, reply }) => (reply ? [[key, reply] as const] : [])));
  const never = (): never => {
    throw new Error('a replay answers only for cards');
  };
  return {
    json: async (req) => {
      if (req.role !== 'renderer.components') return never();
      const items = [...req.user.matchAll(/^id: (.+)$/gm)].flatMap(([, id]) => {
        const reply = said.get(keyOf(id!) ?? '');
        return reply ? [{ ...reply, id: id! }] : [];
      });
      return req.schema.parse({ items });
    },
    search: never,
    image: never,
    transcribe: never,
  };
}

/**
 * Runs the real Renderer over the whole set with the given model, or with one made for this run from the sample each node holds.
 * Each sample is the root of its own tree, so no arrangement is looked for, and the unsure ones go through in passes of `ASKED_AT_ONCE`,
 * the most one pass asks about.
 */
export async function run(given: ModelClient | ((keyOf: (nodeId: string) => string | undefined) => ModelClient), list: Sample[] = samples()): Promise<{ outcomes: Outcome[]; notes: string[] }> {
  const k = kit();
  const keys = new Map<string, string>();
  const model = typeof given === 'function' ? given((nodeId) => keys.get(nodeId)) : given;
  const replies = new Map<string, Entry>();
  const listening: ModelClient = {
    json: async (req) => {
      const reply = await model.json(req);
      if (req.role === 'renderer.components') for (const entry of (reply as ComponentsReply).items) replies.set(entry.id, entry);
      return reply;
    },
    search: (req) => model.search(req),
    image: (req) => model.image(req),
    transcribe: (req) => model.transcribe(req),
  };
  const ctx = { ...k.ctx, model: listening };

  const placed = list.map((sample) => {
    const treeId = ctx.newId();
    const root = makeNode(ctx, sample.item, { treeId, parent: null, status: 'kept', why: '', origin: sample.item.origin });
    k.mind.apply({
      origin: sample.item.origin,
      label: 'sample',
      commands: [{ type: 'addItem', item: sample.item }, { type: 'createTree', tree: { id: treeId, title: sample.key, rootId: root.id, digest: '', createdAt: ctx.now() }, root }],
    });
    const ruled = byRule(sample.item, assetUrl);
    keys.set(root.id, sample.key);
    return { sample, id: root.id, ruled: ruled.component, asked: unsure(sample.item, ruled) };
  });

  const sure = placed.filter((one) => !one.asked).map((one) => one.id);
  const open = placed.filter((one) => one.asked).map((one) => one.id);
  const passes = [sure, ...Array.from({ length: Math.ceil(open.length / ASKED_AT_ONCE) }, (_v, n) => open.slice(n * ASKED_AT_ONCE, (n + 1) * ASKED_AT_ONCE))];
  for (const commands of await Promise.all(passes.map((nodeIds) => renderer(ctx, { nodeIds })))) {
    if (commands.length > 0) k.mind.apply({ origin: { by: 'agent', role: 'renderer' }, label: 'render', commands });
  }

  const outcomes = placed.map(({ sample, id, ruled, asked }): Outcome => {
    const reply = replies.get(id);
    return { sample, ruled, asked, ...(reply ? { reply, verdict: byModel(reply, sample.item, assetUrl) } : {}), drawn: k.mind.node(id).view.component };
  });
  return { outcomes, notes: k.notes };
}
