import { z } from 'zod';
import type { Command, Id, Item, ItemData, Node } from '../domain.ts';
import type { SocialPost, WebResult } from '../ports.ts';
import { siteOf } from '../views.ts';
import { AGENT, makeItem, makeNode, pickStatus, type RoleContext, type Roles } from './types.ts';

const ROLE = 'scout';
const MAX_QUERIES = 4;
const MAX_CANDIDATES = 24;
const MAX_POSTS = 4;
const MAX_LINK_CANDIDATES = 5;
const LINK_COVERAGE = 0.5;

const Plan = z.object({
  queries: z.array(z.string()),
  imagePrompt: z.string(),
  codePrompt: z.string(),
  instagram: z.boolean(),
});
type Plan = z.infer<typeof Plan>;

const Choice = z.object({
  picks: z.array(
    z.object({
      index: z.number(),
      title: z.string(),
      summary: z.string(),
      tags: z.array(z.string()),
      why: z.string(),
      importance: z.number(),
      quote: z.string(),
      quoteBy: z.string(),
      personName: z.string(),
      personRole: z.string(),
      when: z.string(),
      facts: z.array(z.object({ label: z.string(), value: z.string() })),
      steps: z.array(z.string()),
    }),
  ),
});
type Chosen = z.infer<typeof Choice>['picks'][number];

const Ratings = z.object({
  ratings: z.array(z.object({ itemId: z.string(), strength: z.number(), why: z.string() })),
});

/** Something gathered from outside the mindstorm that could become a pick. */
type Candidate = { title: string; snippet: string } & (
  | { tool: 'web'; url: string }
  | { tool: 'instagram'; url: string; post: SocialPost }
  | { tool: 'image-gen'; asset: string }
  | { tool: 'muse-code'; language: string; source: string }
);

interface Run {
  anchor: Node;
  item: Item;
  need: string;
  /** The anchor, its path and what hangs off it, as prose for every prompt of the run. */
  brief: string;
}

export const scout: Roles['scout'] = async (ctx, input) => {
  const anchor = ctx.mind.nodes.get(input.anchor);
  if (!anchor) {
    ctx.note(ROLE, `node ${input.anchor} is gone, nothing to scout for`);
    return [];
  }
  const item = ctx.mind.itemOf(anchor.id);
  const need = oneLine(input.need ?? '', 300);
  const run: Run = { anchor, item, need, brief: describe(ctx, anchor, item, need) };
  const count = Math.max(1, Math.floor(input.count ?? ctx.settings.picksPerRun));
  const replaced = input.mode === 'refresh' ? ctx.mind.picks(anchor.id) : [];

  const plan = await makePlan(ctx, run);
  const candidates = await gather(ctx, plan, count, known(ctx, replaced));
  if (candidates.length === 0) {
    ctx.note(ROLE, 'nothing new came back from outside, the picks stay as they are');
    return [];
  }

  const picks = await choose(ctx, run, candidates, count);
  const commands: Command[] = replaced.map((n) => ({ type: 'deleteNode', id: n.id }));
  picks.forEach(({ candidate, chosen }, offset) => {
    const pick = toItem(ctx, run, candidate, chosen);
    commands.push(
      { type: 'addItem', item: pick },
      {
        type: 'addNode',
        node: makeNode(ctx, pick, {
          treeId: anchor.treeId,
          parent: anchor.id,
          status: pickStatus(ctx),
          why: oneLine(chosen?.why ?? '', 80) || (need ? `for "${oneLine(need, 60)}"` : `more on ${oneLine(nameOf(item), 60)}`),
          importance: clamp(chosen?.importance ?? 0.5),
          origin: AGENT(ROLE, candidate.tool),
          offset,
        }),
      },
    );
  });
  commands.push(...(await links(ctx, run)));
  return commands;
};

const SYSTEM =
  'You are the Scout of a spatial brainstorming app. You bring the user new material from outside their own notes and hang it off the idea they are looking at.';

function describe(ctx: RoleContext, anchor: Node, item: Item, need: string): string {
  const path = ctx.mind.path(anchor.id).map((n) => oneLine(nameOf(ctx.mind.itemOf(n.id)), 60));
  const children = ctx.mind.children(anchor.id).slice(0, 20).map((n) => {
    const child = ctx.mind.itemOf(n.id);
    return `- "${oneLine(nameOf(child), 80)}"${child.source.url ? ` (${child.source.url})` : ''}`;
  });
  return [
    `The idea: "${oneLine(nameOf(item), 120)}" (${item.kind}). ${oneLine(item.summary || item.text, 400)}`,
    item.tags.length > 0 ? `Its tags: ${item.tags.slice(0, 8).join(', ')}.` : '',
    `Where it sits, from the root of the tree "${oneLine(ctx.mind.tree(anchor.treeId).title, 80)}" down: ${path.join(' > ')}.`,
    children.length > 0 ? `Already hanging off it, not to be repeated:\n${children.join('\n')}` : 'Nothing hangs off it yet.',
    need ? `What the user just asked for, which outranks everything else: "${need}"` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function makePlan(ctx: RoleContext, run: Run): Promise<Plan> {
  const title = oneLine(nameOf(run.item), 120);
  const plain: Plan = {
    queries: run.need ? [`${title} ${run.need}`, run.need] : [title],
    imagePrompt: '',
    codePrompt: '',
    instagram: false,
  };
  try {
    const plan = await ctx.model.json({
      role: `${ROLE}.plan`,
      system: SYSTEM,
      user: [
        run.brief,
        '',
        'Plan how to find new material for this idea.',
        '- queries: 2 to 4 web search queries, each aimed at a different angle (for example how it works, a notable example, a critique, the people behind it, the numbers). They must not be paraphrases of each other.',
        '- imagePrompt: a prompt for a generated picture, only when the user wants to see what something could look like. Otherwise an empty string.',
        '- codePrompt: a description of a small program to write, only when the need is something to build or compute. Otherwise an empty string.',
        "- instagram: true only when the topic concerns the user's own posts or their own art.",
        'Most runs need web search alone.',
      ].join('\n'),
      schema: Plan,
      effort: 'low',
    });
    const queries = [...new Set(plan.queries.map((q) => oneLine(q, 200)).filter(Boolean))].slice(0, MAX_QUERIES);
    return { ...plan, queries: queries.length > 0 ? queries : plain.queries };
  } catch (err) {
    ctx.note(ROLE, `could not plan the search (${message(err)}), searching for the title instead`);
    return plain;
  }
}

/** URLs the mindstorm already holds. `live` ones are never offered again; `stale` ones were shown once and discarded. */
function known(ctx: RoleContext, replaced: Node[]): { live: Set<string>; stale: Set<string> } {
  const going = new Set(replaced.flatMap((n) => ctx.mind.subtree(n.id).map((m) => m.id)));
  const live = new Set<string>();
  const stale = new Set<string>();
  for (const item of ctx.mind.items.values()) {
    if (!item.source.url) continue;
    const nodes = ctx.mind.nodesOfItem(item.id);
    const discarded = item.archived || (nodes.length > 0 && nodes.every((n) => going.has(n.id)));
    (discarded ? stale : live).add(urlKey(item.source.url));
  }
  return { live, stale };
}

async function gather(
  ctx: RoleContext,
  plan: Plan,
  count: number,
  seen: { live: Set<string>; stale: Set<string> },
): Promise<Candidate[]> {
  const quiet = async <T>(what: string, work: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      ctx.note(ROLE, `${what} failed (${message(err)})`);
      return empty;
    }
  };
  // Asking for more than `count` leaves room for what the mindstorm already holds.
  const perQuery = Math.min(20, count * 2 + seen.live.size);
  const [results, picture, sketch, posts] = await Promise.all([
    Promise.all(plan.queries.map((q) => quiet(`the search "${q}"`, () => ctx.tools.web.search(q, perQuery), [] as WebResult[]))),
    plan.imagePrompt ? quiet('image generation', () => ctx.tools.images.generate(plan.imagePrompt), null) : null,
    plan.codePrompt ? quiet('the code sketch', () => ctx.tools.code.generate(plan.codePrompt), null) : null,
    plan.instagram ? quiet('Instagram', () => ctx.tools.instagram.recent(10), [] as SocialPost[]) : ([] as SocialPost[]),
  ]);

  const made: Candidate[] = [];
  if (picture) made.push({ tool: 'image-gen', asset: picture.asset, title: oneLine(plan.imagePrompt, 80), snippet: plan.imagePrompt });
  if (sketch) {
    made.push({ tool: 'muse-code', title: sketch.title, snippet: plan.codePrompt, language: sketch.language, source: sketch.source });
  }

  // One result from each query in turn, so the first few candidates already cover every angle.
  const found: (Candidate & { url: string })[] = [];
  for (let rank = 0; results.some((r) => rank < r.length); rank++) {
    for (const r of results) {
      const hit = r[rank];
      if (hit?.url) found.push({ tool: 'web', url: hit.url, title: hit.title, snippet: hit.snippet });
    }
  }
  for (const post of posts.slice(0, MAX_POSTS)) {
    found.push({ tool: 'instagram', url: post.url, title: oneLine(post.caption, 80) || 'Instagram post', snippet: post.caption, post });
  }

  const fresh: Candidate[] = [];
  const shownBefore: Candidate[] = [];
  const taken = new Set<string>();
  for (const c of found) {
    const key = urlKey(c.url);
    if (taken.has(key) || seen.live.has(key)) continue;
    taken.add(key);
    (seen.stale.has(key) ? shownBefore : fresh).push(c);
  }
  const all = [...made, ...fresh];
  // Something discarded earlier comes back only when there is too little unseen material to fill the run.
  return (all.length < count ? [...all, ...shownBefore] : all).slice(0, MAX_CANDIDATES);
}

async function choose(
  ctx: RoleContext,
  run: Run,
  candidates: Candidate[],
  count: number,
): Promise<{ candidate: Candidate; chosen?: Chosen }[]> {
  const picked: { candidate: Candidate; chosen?: Chosen }[] = [];
  const used = new Set<number>();
  try {
    const lines = candidates.map((c, i) => {
      const where = c.tool === 'web' ? siteOf(c.url) : c.tool === 'instagram' ? `the user's own Instagram ${c.post.mediaType}` : FORMAT[c.tool];
      return `${i}. [${where}] "${oneLine(c.title, 120)}": ${oneLine(c.snippet, 300)}`;
    });
    const answer = await ctx.model.json({
      role: `${ROLE}.choose`,
      system: SYSTEM,
      user: [
        run.brief,
        '',
        'Candidates gathered just now, by index:',
        lines.join('\n'),
        '',
        `Pick the ${Math.min(count, candidates.length)} best for the user, each by its index. Favour variety of angle and of format (an article, a video, a picture, a data point, a person, a counter-view) over several versions of one thing. Skip anything that repeats what already hangs off the idea.`,
        'For each pick:',
        '- title: a short clear title.',
        '- summary: one or two sentences on what it actually says, from the snippet alone. Do not add facts that are not in the snippet.',
        '- tags: 2 to 5 short lowercase tags.',
        '- why: a short phrase tying it to the idea or to what the user asked for. It is shown on the thread that joins them.',
        '- importance: 0 to 1, how much it deserves attention.',
        '- quote and quoteBy, personName and personRole, when (a date), facts (label and value pairs, for numbers and data points), steps: fill these only with structure that is really present in the snippet. Leave the rest as empty strings and empty lists.',
      ].join('\n'),
      schema: Choice,
      effort: 'low',
    });
    for (const chosen of answer.picks) {
      const candidate = Number.isInteger(chosen.index) ? candidates[chosen.index] : undefined;
      if (!candidate || used.has(chosen.index) || picked.length >= count) continue;
      used.add(chosen.index);
      picked.push({ candidate, chosen });
    }
  } catch (err) {
    ctx.note(ROLE, `could not choose among the results (${message(err)}), taking the top ones in order`);
  }
  // The run owes the user `count` new things, so whatever the model left short is filled in search order.
  candidates.forEach((candidate, i) => {
    if (picked.length < count && !used.has(i)) picked.push({ candidate });
  });
  return picked;
}

const FORMAT = { 'image-gen': 'a picture generated for this', 'muse-code': 'a code sketch written for this' } as const;

function toItem(ctx: RoleContext, run: Run, c: Candidate, chosen?: Chosen): Item {
  const common = {
    title: oneLine(chosen?.title ?? '', 120) || oneLine(c.title, 120) || oneLine(nameOf(run.item), 100),
    summary: oneLine(chosen?.summary ?? '', 400) || oneLine(c.snippet, 400),
    tags: [...new Set((chosen?.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 6),
    origin: AGENT(ROLE, c.tool),
  };
  const data = structure(chosen);
  switch (c.tool) {
    case 'web':
      return makeItem(ctx, {
        ...common,
        kind: 'link',
        text: c.snippet,
        data: { ...data, site: siteOf(c.url) },
        source: { from: 'web', url: c.url },
      });
    case 'instagram':
      return makeItem(ctx, {
        ...common,
        kind: c.post.mediaType === 'video' ? 'video' : 'image',
        text: c.post.caption,
        data: { ...data, mediaUrl: c.post.mediaUrl ?? c.post.thumbnailUrl, when: c.post.postedAt, site: 'instagram.com' },
        source: { from: 'instagram', url: c.url },
      });
    case 'image-gen':
      return makeItem(ctx, { ...common, kind: 'image', text: c.snippet, data, source: { from: 'image-gen', asset: c.asset } });
    case 'muse-code':
      return makeItem(ctx, {
        ...common,
        kind: 'code',
        text: c.source,
        data: { ...data, code: { language: c.language, source: c.source } },
        source: { from: 'muse-code' },
      });
  }
}

function structure(chosen?: Chosen): ItemData {
  if (!chosen) return {};
  const data: ItemData = {};
  const quote = chosen.quote.trim();
  if (quote) data.quote = { text: quote, ...(chosen.quoteBy.trim() ? { by: chosen.quoteBy.trim() } : {}) };
  const name = chosen.personName.trim();
  if (name) data.person = { name, ...(chosen.personRole.trim() ? { role: chosen.personRole.trim() } : {}) };
  if (chosen.when.trim()) data.when = chosen.when.trim();
  const facts = chosen.facts.filter((f) => f.label.trim() && f.value.trim()).slice(0, 6);
  if (facts.length > 0) data.facts = facts;
  const steps = chosen.steps.map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (steps.length > 0) data.steps = steps;
  return data;
}

/** Links to what the user already has, drawn only when plain search and then the model both call the tie strong. */
async function links(ctx: RoleContext, run: Run): Promise<Command[]> {
  const { anchor, item } = run;
  if (ctx.settings.maxLinksPerRun <= 0) return [];
  const exclude = new Set<Id>([
    ...ctx.mind.path(anchor.id).map((n) => n.itemId),
    ...ctx.mind.subtree(anchor.id).map((n) => n.itemId),
    ...ctx.mind.linksOf(anchor.id).map((l) => ctx.mind.node(l.a === anchor.id ? l.b : l.a).itemId),
  ]);
  const target = (itemId: Id): Node | undefined => {
    const nodes = ctx.mind.nodesOfItem(itemId);
    return nodes.find((n) => n.treeId !== anchor.treeId) ?? nodes[0];
  };

  const coverage = new Map<Id, number>();
  for (const query of [`${item.title} ${item.tags.join(' ')}`, run.need]) {
    for (const hit of ctx.mind.search(query, { limit: 20, exclude })) {
      if (hit.coverage >= LINK_COVERAGE && target(hit.id)) coverage.set(hit.id, Math.max(coverage.get(hit.id) ?? 0, hit.coverage));
    }
  }
  const candidates = [...coverage].sort((a, b) => b[1] - a[1]).slice(0, MAX_LINK_CANDIDATES).map(([id]) => ctx.mind.item(id));
  if (candidates.length === 0) return [];

  try {
    const answer = await ctx.model.json({
      role: `${ROLE}.links`,
      system: SYSTEM,
      user: [
        run.brief,
        '',
        "These items are already elsewhere in the user's notes and share some words with the idea:",
        ...candidates.map((c) => `- item ${c.id} "${oneLine(nameOf(c), 100)}": ${oneLine(c.summary || c.text, 240)}`),
        '',
        'Rate how strongly each is connected to the idea, from 0 to 1, using the item ids exactly as written.',
        'Be strict. Sharing a word or a broad subject is weak (below 0.5). Only a connection the user would be glad to have pointed out, such as the same specific thing, a direct cause, a direct answer or a direct contradiction, is strong (0.8 or above). When in doubt, rate low: a missing link costs nothing and a forced one is noise.',
        'why: a short phrase naming the connection.',
      ].join('\n'),
      schema: Ratings,
      effort: 'low',
    });
    const offered = new Set(candidates.map((c) => c.id));
    const best = new Map<Id, { strength: number; why: string }>();
    for (const r of answer.ratings) {
      if (!offered.has(r.itemId) || best.has(r.itemId)) continue;
      best.set(r.itemId, { strength: clamp(r.strength), why: oneLine(r.why, 80) });
    }
    return [...best]
      .filter(([, r]) => r.strength >= ctx.settings.linkThreshold)
      .sort((a, b) => b[1].strength - a[1].strength)
      .slice(0, ctx.settings.maxLinksPerRun)
      .map(([itemId, r]) => ({
        type: 'link' as const,
        link: { id: ctx.newId(), a: anchor.id, b: target(itemId)!.id, why: r.why || 'closely related', strength: r.strength },
      }));
  } catch (err) {
    ctx.note(ROLE, `could not rate links to existing notes (${message(err)}), drawing none`);
    return [];
  }
}

function nameOf(item: Item): string {
  return item.title || item.summary || item.text || item.source.url || 'Untitled';
}

function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
