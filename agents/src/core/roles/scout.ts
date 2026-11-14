import { z } from 'zod';
import type { Command, Id, Item, Node } from '../domain.ts';
import { siteOf } from '../views.ts';
import { toBase64 } from './intake/plain.ts';
import { AGENT, makeItem, makeNode, pickStatus, type RoleContext, type Roles, type Turn } from './types.ts';

const ROLE = 'scout';
const MAX_GENERATED_IMAGES = 4;
const GALLERY_SIZE = 3;
const MAX_LINK_CANDIDATES = 5;
const LINK_COVERAGE = 0.5;
const HISTORY_TURNS = 6;

const Ideas = z.object({
  directions: z.array(
    z.object({
      angle: z.string(),
      format: z.enum(['note', 'steps', 'image', 'gallery', 'reference', 'video']),
      title: z.string(),
      body: z.string(),
      why: z.string(),
      tags: z.array(z.string()),
      steps: z.array(z.string()),
      images: z.array(z.object({ title: z.string(), prompt: z.string() })),
      lookup: z.string(),
    }),
  ),
});
type Direction = z.infer<typeof Ideas>['directions'][number];

const Ratings = z.object({
  ratings: z.array(z.object({ itemId: z.string(), strength: z.number(), why: z.string() })),
});

interface Run {
  anchor: Node;
  item: Item;
  need: string;
  /** The anchor, where it sits, what surrounds it and what was said, as prose for every prompt of the run. */
  brief: string;
  /** The nearest picture at or above the anchor, for the model to look at. */
  picture?: string;
}

/**
 * Extends the anchor in several different directions and brings each back as content the user can take in on the spot:
 * a written idea, a generated picture, a set of pictures, a real work with its picture, a video that plays in place.
 * Nothing it brings is a bare link out of the app.
 */
export const scout: Roles['scout'] = async (ctx, input) => {
  const anchor = ctx.mind.nodes.get(input.anchor);
  if (!anchor) {
    ctx.note(ROLE, `node ${input.anchor} is gone, nothing to scout for`);
    return [];
  }
  const item = ctx.mind.itemOf(anchor.id);
  const need = oneLine(input.need ?? '', 400);
  const run: Run = { anchor, item, need, brief: describe(ctx, anchor, item, need, input.history ?? []), picture: await pictureFor(ctx, anchor) };
  const count = Math.max(1, Math.floor(input.count ?? ctx.settings.picksPerRun));
  const replaced = input.mode === 'refresh' ? ctx.mind.picks(anchor.id) : [];

  let directions: Direction[];
  try {
    directions = await ideate(ctx, run, count);
  } catch (err) {
    ctx.note(ROLE, `could not think of directions (${message(err)}), the picks stay as they are`);
    return [];
  }
  if (directions.length === 0) {
    ctx.note(ROLE, 'no directions came back, the picks stay as they are');
    return [];
  }

  let placed = 0;
  const hang = (pick: Item, d: Direction, tool: string): Command[] => [
    { type: 'addItem', item: pick },
    {
      type: 'addNode',
      node: makeNode(ctx, pick, {
        treeId: anchor.treeId,
        parent: anchor.id,
        status: pickStatus(ctx),
        why: oneLine(d.why, 80) || oneLine(d.angle, 80) || (need ? `for "${oneLine(need, 60)}"` : `from ${oneLine(nameOf(item), 60)}`),
        importance: 0.5,
        origin: AGENT(ROLE, tool),
        offset: placed++,
      }),
    },
  ];

  const written = directions.filter((d) => d.format === 'note' || d.format === 'steps');
  const made = directions.filter((d) => !written.includes(d));
  let commands: Command[] = [
    ...replaced.map((n): Command => ({ type: 'deleteNode', id: n.id })),
    ...written.flatMap((d) => hang(writtenItem(ctx, d), d, 'idea')),
  ];
  // Written ideas need no tool, so the user gets them while the pictures and references are still being fetched.
  if (input.deliver && written.length > 0 && made.length > 0) {
    input.deliver(commands);
    commands = [];
    placed = 0;
  }

  let imagesLeft = MAX_GENERATED_IMAGES;
  const taken = knownUrls(ctx);
  // Links are rated while the pictures are made, so they never hold the new content back.
  const linking = links(ctx, run);
  const results = await Promise.all(
    made.map((d) => {
      const budget = d.format === 'gallery' ? Math.min(GALLERY_SIZE, imagesLeft) : d.format === 'image' ? Math.min(1, imagesLeft) : 0;
      imagesLeft -= budget;
      return realize(ctx, d, budget, taken).catch((err) => {
        ctx.note(ROLE, `"${oneLine(d.title, 60)}" could not be made (${message(err)})`);
        return [] as Made[];
      });
    }),
  );
  results.forEach((items, i) => {
    for (const { item: pick, tool } of items) commands.push(...hang(pick, made[i]!, tool));
  });
  commands.push(...(await linking));
  return commands;
};

const SYSTEM = `You are the Scout of Mind Palace, a spatial brainstorming app. The user drops things in, often a picture or a single line with no explanation. You look closely at what they dropped and bring back new material that extends it in different directions, so they can see where it could go.

You are a well-read creative partner who knows art, film, design, writing, music, science, history and craft. You are not a search engine. Everything you bring is shown as a card inside the app, so each card must be the content itself: something to read, look at or watch on the spot. Never tell the user to go and look something up.`;

function describe(ctx: RoleContext, anchor: Node, item: Item, need: string, history: Turn[]): string {
  const { mind } = ctx;
  const path = mind.path(anchor.id);
  const above = path.slice(0, -1).map((n) => {
    const up = mind.itemOf(n.id);
    return `- "${oneLine(nameOf(up), 80)}" (${up.kind}): ${oneLine(up.summary || up.text, 200)}`;
  });
  const hanging = mind.children(anchor.id).slice(0, 24).map((n) => {
    const child = mind.itemOf(n.id);
    return `- "${oneLine(nameOf(child), 80)}"${n.why ? ` (direction: ${oneLine(n.why, 60)})` : ''}${n.status === 'kept' ? ' [kept by the user]' : ''}`;
  });
  const siblings = anchor.parent
    ? mind.children(anchor.parent).filter((n) => n.id !== anchor.id && n.status === 'kept').slice(0, 8).map((n) => `- "${oneLine(nameOf(mind.itemOf(n.id)), 80)}"`)
    : [];
  const said = history.slice(-HISTORY_TURNS).map((t) => `${t.who}: ${oneLine(t.text, 200)}`);
  const body = oneLine(item.text && item.text !== item.title ? item.text : '', 1500);
  return [
    `What the user is looking at: "${oneLine(nameOf(item), 120)}" (${item.kind}${item.origin.by === 'user' ? ', dropped in by the user' : ', brought by an agent'}).`,
    item.summary ? `What it is: ${oneLine(item.summary, 500)}` : '',
    body ? `Its full content: ${body}` : '',
    item.tags.length > 0 ? `Tags: ${item.tags.slice(0, 8).join(', ')}.` : '',
    `It is in the tree "${oneLine(mind.tree(anchor.treeId).title, 80)}".`,
    above.length > 0 ? `Above it in the tree, from the root down:\n${above.join('\n')}` : 'It is the root of its tree.',
    siblings.length > 0 ? `Beside it:\n${siblings.join('\n')}` : '',
    hanging.length > 0 ? `Already hanging off it. Do not repeat these or their directions:\n${hanging.join('\n')}` : 'Nothing hangs off it yet.',
    said.length > 0 ? `The recent conversation:\n${said.join('\n')}` : '',
    need ? `What the user just asked for: "${need}"` : 'The user has not said what they want.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The picture the run is about: the anchor's own, or the nearest one above it. */
async function pictureFor(ctx: RoleContext, anchor: Node): Promise<string | undefined> {
  for (const node of ctx.mind.path(anchor.id).reverse()) {
    const item = ctx.mind.itemOf(node.id);
    if (item.kind !== 'image') continue;
    if (!item.source.asset) return item.source.url && /^https:\/\//.test(item.source.url) ? item.source.url : undefined;
    try {
      const file = await ctx.assets.get(item.source.asset);
      return file ? `data:${file.mime};base64,${toBase64(file.bytes)}` : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function ideate(ctx: RoleContext, run: Run, count: number): Promise<Direction[]> {
  const asked = run.need
    ? `The user asked for "${run.need}". Every direction must serve that request as it applies to this very thing, not the topic in general. Asked for "world building" on a picture, you build the world of that picture: who lives there, its places, its history, its rules. Asked for "examples from horror films", every direction is such an example.`
    : 'The user gave no explanation, so show them where this could go. Each direction leaves from something specific you can see or read in it and heads somewhere different.';
  const answer = await ctx.model.json({
    role: `${ROLE}.ideate`,
    system: SYSTEM,
    user: [
      run.brief,
      ...(run.picture ? ['The picture is attached. Look at it closely: subject, composition, palette, style, mood, small details.'] : []),
      '',
      asked,
      '',
      `Return exactly ${count} directions.`,
      'Diversity rules:',
      '- No two directions share an angle. Angles to draw from: the world or story it implies, a real work or artist or place or tradition it echoes, the technique behind it, its opposite or a counterpoint, a what-if that changes one thing, a detail worth zooming into, the same idea in another medium or sense, where it comes from historically, a concrete next step to make something.',
      '- A direction that would fit any picture or any idea is a failure. Name specifics.',
      count >= 3
        ? '- Mix the formats: at least one to look at ("image" or "gallery"), at least one "reference", at least one "note". At most one "gallery" and one "video".'
        : '- Prefer different formats.',
      '',
      'For each direction:',
      '- angle: two to five words naming the direction.',
      '- format: one of the formats below.',
      '- title: under 60 characters, specific, no trailing period.',
      '- why: under eight words, shown on the thread that joins this card to the original. It names where this direction goes ("the town beyond the frame").',
      '- tags: 2 to 4 short lowercase words.',
      '- body, steps, images, lookup: as the format says. Leave the ones a format does not use empty.',
      '',
      'Formats:',
      '- "note": body is two to four sentences of real substance: a concrete idea, a what-if, a provocation, a piece of knowledge. Not a description of what the user already has, and not advice to explore something.',
      '- "steps": steps is three to six short steps for making or trying something. body is one sentence saying what the steps achieve.',
      '- "image": images has one entry. Its prompt is a complete prompt for an image generator: subject, composition, style, palette, light. When it extends a picture the user dropped, carry over that picture\'s style and palette so it reads as the same world. body is one sentence saying what it shows.',
      `- "gallery": images has exactly ${GALLERY_SIZE} entries, variations on one theme (three places, three moods, three characters), each with its own short title and full prompt. title names the set.`,
      '- "reference": a real, specific, named work, person, place, movement or technique that you are certain exists. lookup is its exact name as an encyclopedia would title it. body is two or three sentences on what it is and exactly how it connects to what the user has. Never invent one.',
      '- "video": only when seeing motion matters. lookup is a search phrase for one specific well-known video. body is one sentence on what to watch for.',
    ].join('\n'),
    schema: Ideas,
    images: run.picture ? [run.picture] : undefined,
    effort: 'low',
  });
  const seen = new Set<string>();
  return answer.directions
    .filter((d) => {
      const key = oneLine(d.title, 120).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count);
}

type Made = { item: Item; tool: string };

function common(d: Direction, tool: string) {
  return {
    title: oneLine(d.title, 120),
    tags: [...new Set(d.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 6),
    origin: AGENT(ROLE, tool),
  };
}

function writtenItem(ctx: RoleContext, d: Direction): Item {
  const steps = d.format === 'steps' ? d.steps.map((s) => oneLine(s, 200)).filter(Boolean).slice(0, 8) : [];
  const body = d.body.trim();
  return makeItem(ctx, {
    ...common(d, 'idea'),
    kind: 'text',
    text: steps.length >= 2 ? [body, ...steps.map((s, i) => `${i + 1}. ${s}`)].filter(Boolean).join('\n') : body,
    summary: oneLine(body, 400),
    data: steps.length >= 2 ? { steps } : {},
    source: { from: 'idea' },
  });
}

/** Turns one direction that needs a tool into the items it stands for. An empty list means it could not be made real. */
async function realize(ctx: RoleContext, d: Direction, imageBudget: number, taken: Set<string>): Promise<Made[]> {
  switch (d.format) {
    case 'image':
    case 'gallery': {
      const wanted = d.images.filter((i) => i.prompt.trim()).slice(0, imageBudget);
      const single = d.format === 'image';
      const made = await Promise.all(
        wanted.map(async (image): Promise<Made | null> => {
          try {
            const { asset } = await ctx.tools.images.generate(image.prompt);
            return {
              tool: 'image-gen',
              item: makeItem(ctx, {
                ...common(d, 'image-gen'),
                title: oneLine((single ? d.title : image.title) || d.title, 120),
                kind: 'image',
                text: image.prompt,
                summary: oneLine(single ? d.body : `${d.title}: ${image.title}`, 400),
                source: { from: 'image-gen', asset },
              }),
            };
          } catch (err) {
            ctx.note(ROLE, `a picture could not be generated (${message(err)})`);
            return null;
          }
        }),
      );
      return made.flatMap((m) => m ?? []);
    }
    case 'reference': {
      const name = oneLine(d.lookup || d.title, 120);
      const found = await ctx.tools.web.lookup(name);
      if (!found) {
        // Nothing confirms the thing exists, so it is not shown as fact.
        ctx.note(ROLE, `no entry found for "${name}", left out`);
        return [];
      }
      if (taken.has(urlKey(found.url))) return [];
      taken.add(urlKey(found.url));
      const body = d.body.trim();
      const stored = found.image ? await ctx.tools.web.picture(found.image) : null;
      // An entry's lead picture can show another sense of the word, so it is only used once the model has looked at it.
      const picture = stored && (await shows(ctx, stored.asset, `${found.title}. ${found.extract.split('. ')[0] ?? ''}`)) ? stored : null;
      return [
        {
          tool: 'web',
          item: makeItem(ctx, {
            ...common(d, 'web'),
            title: oneLine(d.title || found.title, 120),
            kind: picture ? 'image' : 'text',
            text: [body, found.extract].filter(Boolean).join('\n\n'),
            summary: oneLine(body || found.extract, 400),
            data: { site: siteOf(found.url), reference: found.title },
            source: { from: 'web', url: found.url, ...(picture ? { asset: picture.asset } : {}) },
          }),
        },
      ];
    }
    case 'video': {
      const hits = await ctx.tools.web.search(`${oneLine(d.lookup || d.title, 160)} youtube`, 6);
      for (const hit of hits) {
        if (taken.has(urlKey(hit.url))) continue;
        const video = await ctx.tools.web.video(hit.url);
        if (!video || taken.has(urlKey(video.url))) continue;
        taken.add(urlKey(video.url));
        return [
          {
            tool: 'web',
            item: makeItem(ctx, {
              ...common(d, 'web'),
              title: oneLine(d.title || video.title, 120),
              kind: 'video',
              text: [d.body.trim(), video.title].filter(Boolean).join('\n\n'),
              summary: oneLine(d.body || video.title, 400),
              data: { site: siteOf(video.url), embed: video.embed, ...(video.poster ? { thumbnailUrl: video.poster } : {}) },
              source: { from: 'web', url: video.url },
            }),
          },
        ];
      }
      ctx.note(ROLE, `no playable video found for "${oneLine(d.lookup || d.title, 60)}", left out`);
      return [];
    }
    default:
      return [];
  }
}

const Fits = z.object({ fits: z.boolean() });

async function shows(ctx: RoleContext, asset: string, subject: string): Promise<boolean> {
  try {
    const file = await ctx.assets.get(asset);
    if (!file) return false;
    const answer = await ctx.model.json({
      role: `${ROLE}.check`,
      system: 'You check whether a picture illustrates a subject.',
      user: `Subject: ${oneLine(subject, 500)}\nCould the attached picture be a picture of this subject? Answer fits: false only when it clearly shows a different kind of thing that merely shares the name.`,
      schema: Fits,
      images: [`data:${file.mime};base64,${toBase64(file.bytes)}`],
      effort: 'low',
    });
    return answer.fits;
  } catch {
    return false;
  }
}

function knownUrls(ctx: RoleContext): Set<string> {
  const urls = new Set<string>();
  for (const item of ctx.mind.items.values()) {
    if (item.source.url && !item.archived) urls.add(urlKey(item.source.url));
  }
  return urls;
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
        "These items are already elsewhere in the user's notes and share some words with it:",
        ...candidates.map((c) => `- item ${c.id} "${oneLine(nameOf(c), 100)}": ${oneLine(c.summary || c.text, 240)}`),
        '',
        'Rate how strongly each is connected to what the user is looking at, from 0 to 1, using the item ids exactly as written.',
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
