import { z } from 'zod';
import { inLibrary, type Command, type Id, type Item, type ItemData, type Node } from '../domain.ts';
import type { Found, Source } from '../ports.ts';
import { givesWay, KNOWN_MOST, LIBRARY_TOOL, MINDSTORM, newSlots, ROUND_MOST, sameness, treeKeys, urlKey } from '../round.ts';
import { siteOf } from '../views.ts';
import { toBase64 } from './intake/plain.ts';
import { AGENT, idFrom, makeItem, makeNode, pickStatus, type RoleContext, type Roles, type Turn } from './types.ts';

const ROLE = 'scout';
const MAX_GENERATED_IMAGES = 4;
const GALLERY_SIZE = 3;
const FOUND_SHOWN_TO_MODEL = 10;
const VISUAL_SHOWN_TO_MODEL = 8;
const SEARCHES_PER_FIND = 3;
const ENOUGH_FOUND = 6;
const THIN_POOL = 3;
const EXCERPT = 900;
/** Things the user already has that share words with the card, offered to the model to rate. */
const KNOWN_CANDIDATES = 20;
const KNOWN_COVERAGE = 0.5;
const HISTORY_TURNS = 6;

const Ideas = z.object({
  reading: z.string(),
  directions: z.array(
    z.object({
      angle: z.string(),
      format: z.enum(['note', 'steps', 'image', 'gallery', 'find', 'video']),
      title: z.string(),
      body: z.string(),
      why: z.string(),
      tags: z.array(z.string()),
      steps: z.array(z.string()),
      images: z.array(z.object({ title: z.string(), prompt: z.string() })),
      source: z.string(),
      lookups: z.array(z.string()),
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
 * a written idea, a generated picture, a set of pictures, real material found in a source that suits the subject, a video that plays in place.
 * Nothing it brings is a bare link out of the app. Beside the new content, the things the user already has that are strongly tied
 * to the card come into the same round, the strongest first, leaving room for new content. Nothing it brings repeats what the tree holds.
 * It never takes a pick away. When the round could pass its cap, the picks already there are rated against what the user is asking
 * now, and that rating becomes their importance, so the pipeline lets the least related ones give way.
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
  const wanted = Math.max(1, Math.floor(input.count ?? ctx.settings.picksPerRun));
  // Nothing the run brings may repeat what the tree holds, except that what the user already has may take the place of the same thing brought new.
  const seen = new Set(treeKeys(ctx.mind, anchor.treeId).keys());
  const firm = new Set(treeKeys(ctx.mind, anchor.treeId, new Set(ctx.mind.treeNodes(anchor.treeId).filter(givesWay).map((n) => n.id))).keys());

  // Ties to what the user already has are rated while the directions are thought of. Its failure is caught here, where it starts:
  // awaited only after the directions, it would otherwise go unhandled while they are thought of.
  const rating = rate(ctx, run, firm, wanted).catch((err): Rated => {
    ctx.note(ROLE, `ties to what is already here were not rated (${message(err)})`);
    return { ties: [], relevance: new Map() };
  });
  let directions: Direction[];
  try {
    // Some searches find nothing that fits, so one direction more than the count is asked for.
    directions = await ideate(ctx, run, wanted >= 3 ? wanted + 1 : wanted);
  } catch (err) {
    ctx.note(ROLE, `could not think of directions (${message(err)}), the picks stay as they are`);
    return [];
  }
  if (directions.length === 0) {
    ctx.note(ROLE, 'no directions came back, the picks stay as they are');
    return [];
  }
  const { ties, relevance } = await rating;
  for (const tie of ties) for (const key of sameness(tie.item)) seen.add(key);
  const slots = newSlots(ties.length, wanted);
  directions = directions.slice(0, slots >= 3 ? slots + 1 : slots);
  // A source can return several records and a set several pictures, so the new content is counted per pick, up to what was asked for.
  let room = slots;

  let placed = 0;
  const under = (pick: Item, fields: { why: string; importance: number; tool: string }): Command => ({
    type: 'addNode',
    node: makeNode(ctx, pick, { treeId: anchor.treeId, parent: anchor.id, status: pickStatus(ctx), why: fields.why, importance: fields.importance, origin: AGENT(ROLE, fields.tool), offset: placed++ }),
  });
  const hang = (pick: Item, d: Direction, tool: string): Command[] => {
    const keys = sameness(pick);
    if (room <= 0 || keys.some((key) => seen.has(key))) return [];
    room--;
    for (const key of keys) seen.add(key);
    const why = oneLine(d.why, 80) || oneLine(d.angle, 80) || (need ? `for "${oneLine(need, 60)}"` : `from ${oneLine(nameOf(item), 60)}`);
    // Made for what the user asked just now, so nothing in the round is more related to it.
    return [{ type: 'addItem', item: pick }, under(pick, { why, importance: 1, tool })];
  };

  const written = directions.filter((d) => d.format === 'note' || d.format === 'steps');
  const made = directions.filter((d) => !written.includes(d));
  let commands: Command[] = [
    ...[...relevance].map(([node, importance]): Command => ({ type: 'setWhy', id: node.id, why: node.why, importance })),
    // What the user already has is shown in place, the item itself and not a copy.
    ...ties.map((tie) => under(tie.item, { why: tie.why, importance: tie.strength, tool: inLibrary(tie.item) ? LIBRARY_TOOL : MINDSTORM })),
    ...written.flatMap((d) => hang(writtenItem(ctx, d), d, 'idea')),
  ];
  const flush = () => {
    if (!input.deliver || commands.length === 0) return;
    input.deliver(commands);
    commands = [];
    placed = 0;
  };
  // Written ideas and what the user already has need no tool, so the user gets them while the rest is still being fetched.
  if (written.length + ties.length > 0 && made.length > 0) flush();

  if (room <= 0 || made.length === 0) return commands;
  let imagesLeft = MAX_GENERATED_IMAGES;
  const taken = knownUrls(ctx);
  // Each made direction is owed a slot, and there is one direction more than the slots in case a find comes back empty. So a
  // direction's first pick lands the moment it is ready, except into a slot held by a picture still being made, since a picture is
  // paid for when it is started. A further pick waits until every direction still out keeps a slot, then lands in the order it came.
  const out = new Set(made);
  const waiting: { pick: Item; d: Direction; tool: string }[] = [];
  const pictured = (d: Direction) => d.format === 'image' || d.format === 'gallery';
  const land = (d: Direction, items: Made[]) => {
    out.delete(d);
    const held = [...out].filter(pictured).length;
    let landed = false;
    for (const { item: pick, tool } of items) {
      const hung = !landed && room > held ? hang(pick, d, tool) : null;
      if (!hung) waiting.push({ pick, d, tool });
      else if (hung.length > 0) {
        commands.push(...hung);
        landed = true;
      }
    }
    while (waiting.length > 0 && room > out.size) {
      const next = waiting.shift()!;
      commands.push(...hang(next.pick, next.d, next.tool));
    }
    // Each direction is shown the moment it is ready, so a slow search never holds back a finished picture.
    flush();
  };
  // A gallery makes only the pictures it could keep: one, and more only when there are slots to spare.
  const spare = Math.max(0, room - made.length);
  // The run is over once its slots are full, so what it says it brought does not wait on work that can no longer land. With somewhere
  // to deliver, it is also over when only pictures are still being made, or every slot left is held by one: a picture takes 10 to
  // 20 s and is delivered when it is ready, and a find still out lands after it only if a picture fails.
  const over = () => {
    const held = [...out].filter(pictured).length;
    return out.size === 0 || room <= 0 || (input.deliver !== undefined && (held === out.size || room <= held));
  };
  await new Promise<void>((done) => {
    if (over()) done();
    for (const d of made) {
      const budget = d.format === 'gallery' ? Math.min(GALLERY_SIZE, imagesLeft, 1 + spare) : d.format === 'image' ? Math.min(1, imagesLeft) : 0;
      imagesLeft -= budget;
      void realize(ctx, d, budget, taken)
        .catch((err) => {
          ctx.note(ROLE, `"${oneLine(d.title, 60)}" could not be made (${message(err)})`);
          return [] as Made[];
        })
        .then((items) => {
          land(d, items);
          if (over()) done();
        });
    }
  });
  return commands;
};

const SYSTEM = `You are the Scout of Mind Palace, a spatial brainstorming app. People think with it about anything: a product, a research question, a business, a trip, a story, a design, a decision, something to learn. The user drops things in, often a single line or a picture with no explanation. You work out what the thing is and what they are likely doing with it, then bring back new material that extends it in different directions, so they can see where it could go.

You are a widely read partner, as at home in science, technology, business and history as in art, film and craft. You are not a search engine. Everything you bring is shown as a card inside the app, so each card must be the content itself: something to read, look at, listen to or watch on the spot. Never tell the user to go and look something up.`;

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
      'First, in reading, say in one sentence what kind of thing this is, what field it belongs to, and what the user is most likely doing with it. Let that decide the angles, the formats and the sources. A startup idea wants evidence, numbers, people who tried it and what they learned. A research question wants studies and counter-evidence. A picture wants things to look at. A trip wants places and practicalities.',
      '',
      `Return exactly ${count} directions.`,
      'Diversity rules:',
      '- No two directions share an angle. Angles to draw from: the evidence or data behind it, how others have built or solved it, the strongest objection or a counterexample, a neighbouring field that met the same problem, a what-if that changes one thing, a detail worth zooming into, where it comes from historically, the people working on it, what it would look or sound like, the same idea in another medium, a concrete next step.',
      '- A direction that would fit any subject is a failure. Name specifics.',
      count >= 4
        ? '- Mix the formats: at least three "find" directions that use different sources, and at least one "note". At most one "gallery" and one "video".'
        : count === 3
          ? '- Mix the formats: at least one "find" and at least one "note".'
          : '- Prefer different formats.',
      '- Use "image" or "gallery" when seeing something new helps: the user has a picture or a visual subject, or asked to see something. Then include at least one. For a subject that is not visual, leave them out.',
      '',
      'For each direction:',
      '- angle: two to five words naming the direction.',
      '- format: one of the formats below.',
      '- title: under 60 characters, specific, no trailing period.',
      '- why: under eight words, shown on the thread that joins this card to the original. It names where this direction goes ("what the studies found").',
      '- tags: 2 to 4 short lowercase words.',
      '- body, steps, images, source, lookups: as the format says. Leave the ones a format does not use empty.',
      '',
      'Formats:',
      '- "note": body is two to four sentences of real substance: a concrete idea, a what-if, an objection, a piece of knowledge. Not a description of what the user already has, and not advice to explore something.',
      '- "steps": steps is three to six short steps for making or trying something. body is one sentence saying what the steps achieve.',
      '- "image": images has one entry. Its prompt is a complete prompt for an image generator: subject, composition, style, palette, light. When it extends a picture the user dropped, carry over that picture\'s style and palette so it reads as the same world. body is one sentence saying what it shows.',
      `- "gallery": images has exactly ${GALLERY_SIZE} entries, variations on one theme, each with its own short title and full prompt. title names the set.`,
      '- "find": real material from one source. source is one id from the list of sources, chosen for what this direction needs. lookups is two or three searches for the same thing in different words, the shortest and broadest first. Every source except the web is a keyword catalogue where each extra word removes results, so keep each search to two or three plain words and never put a whole question in one. title names what you hope to find. body is one or two sentences on what the user should get from it.',
      '- "video": when watching teaches more than reading: a technique shown by hand, a performance, a process, a place in motion, a talk worth hearing. lookups has one search phrase, the way you would type it into a video site. body is one sentence on what to watch for.',
      '',
      'Sources for "find":',
      ...ctx.tools.sources.list().map((src) => `- ${src.id}: ${src.name}. ${src.goodFor} Search: ${src.query}`),
    ].join('\n'),
    schema: Ideas,
    images: run.picture ? [run.picture] : undefined,
    effort: 'low',
  });
  if (answer.reading.trim()) ctx.note(ROLE, `reads it as: ${oneLine(answer.reading, 200)}`);
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
    case 'find': {
      const sources = ctx.tools.sources.list();
      const web = sources.find((src) => src.id === 'web');
      const source = sources.find((src) => src.id === d.source.trim()) ?? web;
      if (!source) return [];
      const wanted = d.lookups.map((l) => oneLine(l, 120)).filter(Boolean);
      const onWeb = () => gather(ctx, web!, [oneLine(d.title, 120)], taken);
      const pool = await gather(ctx, source, wanted.length > 0 ? wanted : [oneLine(d.title, 120)], taken);
      const rescue = web && source.id !== 'web';
      // A thin pool usually ends with nothing, so the slow web search starts now instead of after the model has said no.
      const early = rescue && pool.fresh.length < THIN_POOL ? onWeb() : null;
      const first = await choose(ctx, d, source, pool, taken);
      if (first.length > 0 || !rescue) return first;
      // A catalogue only holds what it holds. The open web is asked once before the direction is given up.
      ctx.note(ROLE, `trying the web for "${oneLine(d.title, 60)}"`);
      return choose(ctx, d, web!, await (early ?? onWeb()), taken);
    }
    case 'video': {
      const wanted = oneLine(d.lookups[0] || d.title, 160);
      // A client that cannot show a player from another site would get only a still, so while one is connected a film that plays as a file is looked for first.
      const files = ctx.playback().embeds ? undefined : ctx.tools.sources.list().find((src) => src.id === 'archive');
      if (files) {
        const played = await choose(ctx, d, files, await gather(ctx, files, [wanted], taken), taken);
        if (played.length > 0) return played;
      }
      for (const video of await ctx.tools.web.videos(wanted)) {
        if (taken.has(urlKey(video.url))) continue;
        taken.add(urlKey(video.url));
        // A client that cannot embed a player shows the still, so it is brought in like any other picture.
        const still = video.poster ? await ctx.tools.web.picture(video.poster) : null;
        return [
          {
            tool: 'web',
            item: makeItem(ctx, {
              ...common(d, 'web'),
              title: oneLine(d.title || video.title, 120),
              kind: 'video',
              text: [d.body.trim(), video.title].filter(Boolean).join('\n\n'),
              summary: oneLine(d.body || video.title, 400),
              data: { site: siteOf(video.url), embed: video.embed, ...(still ? { thumbnailUrl: ctx.assets.url(still.asset) } : {}) },
              source: { from: 'web', url: video.url },
            }),
          },
        ];
      }
      ctx.note(ROLE, `no playable video found for "${oneLine(d.lookups[0] || d.title, 60)}", left out`);
      return [];
    }
    default:
      return [];
  }
}

interface Pool {
  fresh: Found[];
  query: string;
  failed: string;
}

/** Searches one source, in up to three wordings, for records the mindstorm does not hold yet. */
async function gather(ctx: RoleContext, source: Source, wanted: string[], taken: Set<string>): Promise<Pool> {
  // The web search is slow and costly, so it runs once. Catalogues answer in under a second, so every wording is tried.
  const queries = wanted.slice(0, source.id === 'web' ? 1 : SEARCHES_PER_FIND);
  // The broadest wording goes first. The next is only tried while the pool is thin, which keeps the load on each source light.
  const fresh: Found[] = [];
  let failed = '';
  for (const each of queries) {
    if (fresh.length >= ENOUGH_FOUND) break;
    try {
      for (const record of await ctx.tools.sources.search(source.id, each)) {
        if (record.media && !playable(ctx, record.media)) continue;
        if (!taken.has(urlKey(record.url)) && !fresh.some((f) => urlKey(f.url) === urlKey(record.url))) fresh.push(record);
      }
    } catch (err) {
      failed = message(err);
    }
  }
  return { fresh, query: queries.join('" or "'), failed };
}

/** Lets the model choose from what a search gathered and returns its choices as items. Empty when nothing fit. */
async function choose(ctx: RoleContext, d: Direction, source: Source, { fresh, query, failed }: Pool, taken: Set<string>): Promise<Made[]> {
  if (fresh.length === 0 && failed) {
    ctx.note(ROLE, `${source.name} could not be reached (${failed}), "${oneLine(d.title, 60)}" left out`);
    return [];
  }
  // Things to look at are brought in first, so the model chooses among them by sight and a missing picture is never shown.
  const found = source.visual
    ? (await Promise.all(fresh.slice(0, VISUAL_SHOWN_TO_MODEL).map(async (f) => ({ ...f, stored: f.image ? await ctx.tools.web.picture(f.image) : null })))).filter((f) => f.stored)
    : fresh.slice(0, FOUND_SHOWN_TO_MODEL).map((f) => ({ ...f, stored: null }));
  if (found.length === 0) {
    ctx.note(ROLE, `${source.name} has nothing for "${query}", left out`);
    return [];
  }
  // A search matches words, so the model picks the records that carry the direction before any is shown.
  const chosen = await curate(ctx, d, source, found, source.visual ? await dataUrls(ctx, found.map((f) => f.stored!.asset)) : undefined);
  if (chosen.length === 0) ctx.note(ROLE, `none of the ${found.length} records ${source.name} returned for "${query}" fit, left out`);
  const made = await Promise.all(
    chosen.map(async ({ index, note, excerpt }): Promise<Made | null> => {
      const record = found[index]!;
      if (taken.has(urlKey(record.url))) return null;
      taken.add(urlKey(record.url));
      const picture = record.stored ?? (record.image ? await ctx.tools.web.picture(record.image) : null);
      // A recording plays from the service, which streams it from its source, so a client only ever fetches from the service.
      const media = record.media ? await ctx.assets.link(record.media, mediaType(record.media)) : null;
      const label = [...new Set([record.by, record.date, record.from ?? source.name].filter(Boolean))].join(', ');
      const passage = excerpt || clipText(record.text, EXCERPT);
      return {
        tool: source.id,
        item: makeItem(ctx, {
          ...common(d, source.id),
          title: oneLine(record.title, 120),
          kind: media ? 'video' : picture ? 'image' : 'text',
          text: [passage, label].filter(Boolean).join('\n\n'),
          summary: oneLine(note || passage || label, 400),
          data: {
            site: siteOf(record.url),
            by: record.by,
            date: record.date,
            from: record.from ?? source.name,
            ...catalogued(record),
            ...(record.chart ? { chart: record.chart } : {}),
            ...(record.steps && !picture ? { steps: record.steps } : {}),
            ...(media ? { mediaUrl: ctx.assets.url(media.id), ...(picture ? { thumbnailUrl: ctx.assets.url(picture.asset) } : {}) } : {}),
          },
          source: { from: 'web', url: record.url, ...(picture && !media ? { asset: picture.asset } : {}) },
        }),
      };
    }),
  );
  return made.flatMap((m) => m ?? []);
}

/** What a source's catalogue says about a record, as `item.data` keys a card can draw. */
export function catalogued(record: Found): ItemData {
  return {
    ...(record.kind ? { kind: record.kind } : {}),
    ...(record.medium ? { medium: record.medium } : {}),
    ...(record.holder ? { holder: record.holder } : {}),
    ...(record.authors?.length ? { authors: record.authors } : {}),
    ...(record.authors?.length && record.authorsCut ? { authorsCut: true } : {}),
    ...(record.venue ? { venue: record.venue } : {}),
  };
}

const Chosen = z.object({ chosen: z.array(z.object({ number: z.number(), note: z.string(), excerpt: z.string() })) });

async function dataUrls(ctx: RoleContext, assets: string[]): Promise<string[] | undefined> {
  const files = await Promise.all(assets.map((id) => ctx.assets.get(id).catch(() => null)));
  return files.every(Boolean) ? files.map((file) => `data:${file!.mime};base64,${toBase64(file!.bytes)}`) : undefined;
}

async function curate(ctx: RoleContext, d: Direction, source: Source, found: Found[], pictures?: string[]): Promise<{ index: number; note: string; excerpt: string }[]> {
  const perRecord = Math.floor(9000 / found.length);
  const ask = (images?: string[]) =>
    ctx.model.json({
      role: `${ROLE}.curate`,
      system: SYSTEM,
      user: [
        `You are extending what the user has in this direction: ${oneLine(d.angle, 80)}. ${oneLine(d.title, 120)}. ${oneLine(d.body, 400)}`,
        '',
        `A search of ${source.name} returned these records:`,
        ...found.map((f, i) => `${i + 1}. "${oneLine(f.title, 140)}"${f.by ? ` by ${oneLine(f.by, 80)}` : ''}${f.date ? `, ${f.date}` : ''}${f.from ? ` (${f.from})` : ''}${f.text ? `\n   ${oneLine(f.text, perRecord)}` : ''}`),
        ...(images ? ['', 'Their pictures are attached in the same order. Look at them and judge by what you see.'] : []),
        '',
        `Choose up to ${source.show} that would really help the user in this direction, best first, and prefer different makers. The direction was written before the search, so a strong record that comes at it from a slightly different side still belongs. Leave out records that are off the subject, thin, promotional, or that only share a word with the search. Choose none when none are worth the user's time.`,
        'For each:',
        '- number.',
        `- note: one or two sentences on what the user should take from it and how it bears on what they have. Say only what the record ${images ? 'or its picture ' : ''}supports.`,
        '- excerpt: the passage of the record\'s text that carries the point, copied exactly, one to four sentences. Empty when the record has no such passage.',
      ].join('\n'),
      schema: Chosen,
      ...(images ? { images } : {}),
      // Measured on 11 searches, the quick model chose as the main one did in 8 and as well in the rest, in a fifth of the time.
      quick: true,
    });
  try {
    const answer = pictures
      ? await ask(pictures).catch((err) => {
          ctx.note(ROLE, `the model could not look at the pictures (${message(err)}), choosing from the records alone`);
          return ask();
        })
      : await ask();
    const seen = new Set<number>();
    return answer.chosen
      .flatMap(({ number, note, excerpt }) => {
        const index = Math.round(number) - 1;
        const record = found[index];
        if (!record || seen.has(index)) return [];
        seen.add(index);
        // Only words that are really in the record are shown as its words.
        const quoted = excerpt.trim();
        return [{ index, note: note.trim(), excerpt: quoted && squash(record.text).includes(squash(quoted)) ? clipText(quoted, EXCERPT) : '' }];
      })
      .slice(0, source.show);
  } catch (err) {
    ctx.note(ROLE, `could not choose among what ${source.name} returned (${message(err)}), left out`);
    return [];
  }
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

function clipText(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Whether every client that named the files it plays can play this one. A file whose type its address does not show is given the benefit of the doubt. */
function playable(ctx: RoleContext, url: string): boolean {
  const { files } = ctx.playback();
  const ext = /\.([a-z0-9]{2,4})$/i.exec(url.split(/[?#]/)[0]!)?.[1]?.toLowerCase();
  return files.length === 0 || !ext || files.includes(ext);
}

/** The type a recording is served as until its source says otherwise. */
function mediaType(url: string): string {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(url.split(/[?#]/)[0]!)?.[1]?.toLowerCase();
  return { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', m4a: 'audio/mp4', ogg: 'audio/ogg' }[ext ?? ''] ?? 'audio/mpeg';
}

function knownUrls(ctx: RoleContext): Set<string> {
  const urls = new Set<string>();
  for (const item of ctx.mind.items.values()) {
    if (item.source.url && !item.archived) urls.add(urlKey(item.source.url));
  }
  return urls;
}

interface Tie {
  item: Item;
  strength: number;
  why: string;
}

interface Rated {
  ties: Tie[];
  /** The picks already around the card, each with how related it is to what the user is asking now. */
  relevance: Map<Node, number>;
}

/**
 * What the user already has that belongs beside the card: their dumps, cards of their other trees, the library. Found by plain
 * search, rated by the model, and kept only when the model calls the tie strong, the strongest first and never more than the round holds.
 * When the round could pass its cap, the same call rates the picks already around the card against the question and the conversation.
 */
async function rate(ctx: RoleContext, run: Run, seen: ReadonlySet<string>, wanted: number): Promise<Rated> {
  const { item, anchor } = run;
  const coverage = new Map<Id, number>();
  for (const query of [item.title, `${item.title} ${item.tags.join(' ')}`, run.need]) {
    if (!query.trim()) continue;
    for (const hit of ctx.mind.search(query, { limit: KNOWN_CANDIDATES * 2 })) {
      if (hit.coverage < KNOWN_COVERAGE || !ctx.mind.known(hit.id) || sameness(hit.item).some((key) => seen.has(key))) continue;
      coverage.set(hit.id, Math.max(coverage.get(hit.id) ?? 0, hit.coverage));
    }
  }
  const candidates = [...coverage].sort((a, b) => b[1] - a[1]).slice(0, KNOWN_CANDIDATES).map(([id]) => ctx.mind.item(id));
  const round = ctx.mind.picks(anchor.id);
  const shown = round.length + wanted + Math.min(candidates.length, KNOWN_MOST) > ROUND_MOST ? round : [];
  if (candidates.length + shown.length === 0) return { ties: [], relevance: new Map() };

  const line = (c: Item) => `- item ${c.id} "${oneLine(nameOf(c), 100)}": ${oneLine(c.summary || c.text, 240)}`;
  const answer = await ctx.model.json({
    role: `${ROLE}.rate`,
    system: SYSTEM,
    user: [
      run.brief,
      ...(candidates.length > 0
        ? ['', 'These are things the user already has: what they dropped in, cards of their other trees, films and works of their library. Each shares some words with what they are looking at:', ...candidates.map(line)]
        : []),
      ...(shown.length > 0 ? ['', 'These are already shown under it as suggestions:', ...shown.map((n) => line(ctx.mind.itemOf(n.id)))] : []),
      '',
      'Rate how strongly each belongs beside what the user is looking at, given what they are asking now and the recent conversation, from 0 to 1, using the item ids exactly as written. The strong ones the user already has are shown under it beside new material, and the suggestions rated lowest make room for them.',
      'Be strict. Sharing a word or a broad subject is weak (below 0.5). Only a connection the user would be glad to have pointed out, such as the same specific thing, a direct cause, a direct answer or a direct contradiction, is strong (0.8 or above). When in doubt, rate low: a missing tie costs nothing and a forced one is noise.',
      'why: a short phrase naming the connection.',
    ].join('\n'),
    schema: Ratings,
    effort: 'low',
  });
  const offered = new Set(candidates.map((c) => c.id));
  const showing = new Map(shown.map((n) => [n.itemId, n]));
  const best = new Map<Id, { strength: number; why: string }>();
  const relevance = new Map<Node, number>();
  for (const r of answer.ratings) {
    const itemId = idFrom(r.itemId);
    const there = showing.get(itemId);
    if (there && !relevance.has(there)) relevance.set(there, clamp(r.strength));
    if (!offered.has(itemId) || best.has(itemId)) continue;
    best.set(itemId, { strength: clamp(r.strength), why: oneLine(r.why, 80) });
  }
  // Two things the user has can be the same content, such as one film held twice. The stronger is brought.
  const chosen = new Set<string>();
  const ties = [...best]
    .filter(([, r]) => r.strength >= ctx.settings.strongTie)
    .sort((a, b) => b[1].strength - a[1].strength)
    .flatMap(([itemId, r]) => {
      const keys = sameness(ctx.mind.item(itemId));
      if (keys.some((key) => chosen.has(key))) return [];
      for (const key of keys) chosen.add(key);
      return [{ item: ctx.mind.item(itemId), strength: r.strength, why: r.why || 'closely related' }];
    })
    .slice(0, KNOWN_MOST);
  return { ties, relevance };
}

function nameOf(item: Item): string {
  return item.title || item.summary || item.text || item.source.url || 'Untitled';
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
