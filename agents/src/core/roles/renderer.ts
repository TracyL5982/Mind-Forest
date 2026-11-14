import { z } from 'zod';
import type { Command, Group, Id, Item, Node, View } from '../domain.ts';
import { COMPONENTS, isValidGroup, isValidView, mediaOf, siteOf, type ComponentId, type CompositeId } from '../views.ts';
import type { RoleContext, Roles } from './types.ts';

const ROLE = 'renderer';

type Props = Record<string, unknown>;
interface Draw {
  component: ComponentId;
  props: Props;
}
interface GroupDraft {
  composite: CompositeId;
  title: string;
  members: Id[];
  props: Props;
}
/** The siblings of one status under one parent. A composite never reaches outside its pool. */
interface Pool {
  parent: Node;
  nodes: Node[];
  standing: Group[];
  /** Members of a group that stands or was just made. */
  taken: Set<Id>;
  /** The ungrouped siblings the model was shown. */
  asked: Id[];
}

const TEXT_SENT = 1200;
const EXCERPT = 280;
const CAPTION = 140;
const AMBIGUOUS_FROM = 40;
const MAX_ASKED_ITEMS = 24;
const MAX_ASKED_POOLS = 8;
const MAX_ASKED_SIBLINGS = 12;
const STACK_ABOVE = 9;
const STACK_KEEPS = 6;

// ---- reply schemas. Structured output wants every key present, so an empty string or list means "none".

export const ComponentsReply = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      component: z.enum(['note', 'quote', 'fact', 'steps', 'chart']),
      quoteText: z.string(),
      quoteBy: z.string(),
      factValue: z.string(),
      factLabel: z.string(),
      steps: z.array(z.string()),
      chartLabels: z.array(z.string()),
      chartValues: z.array(z.number()),
      chartUnit: z.string(),
      emphasis: z.string(),
    }),
  ),
});
export type ComponentsReply = z.infer<typeof ComponentsReply>;

export const CompositesReply = z.object({
  groups: z.array(
    z.object({
      parent: z.string(),
      composite: z.enum(['timeline', 'comparison', 'sequence', 'cluster']),
      title: z.string(),
      members: z.array(z.string()),
      labels: z.array(z.string()),
      criteria: z.array(z.string()),
      cells: z.array(z.object({ member: z.string(), values: z.array(z.string()) })),
      theme: z.string(),
    }),
  ),
});
export type CompositesReply = z.infer<typeof CompositesReply>;

// ---- what an item's data may hold. Content roles fill it, so it is parsed, not trusted.

const Label = z.union([z.string(), z.number()]).transform(String);
const ChartData = z.object({ labels: z.array(Label), values: z.array(z.number()), unit: z.string().optional() });
const StepsData = z.array(z.string());
const QuoteData = z.object({ text: z.string().min(1), by: z.string().optional() });
const PersonData = z.object({ name: z.string().min(1), role: z.string().optional(), image: z.string().optional() });
const CodeData = z.object({ language: z.string().optional(), source: z.string().optional() });
const FactsData = z.array(z.object({ label: z.string().min(1), value: Label }));
const MessagesData = z.array(z.object({ role: z.string(), text: z.string() }));

function read<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// ---- text

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function flat(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function holds(text: string, claim: string): boolean {
  const c = flat(claim);
  return c.length > 0 && flat(text).includes(c);
}

function numbersIn(text: string): Set<number> {
  return new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ''))));
}

function numbersHeld(text: string, claim: string): boolean {
  const known = numbersIn(text);
  return [...numbersIn(claim)].every((n) => known.has(n));
}

function compact(props: Props): Props {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined && v !== ''));
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([x], [y]) => (x < y ? -1 : 1)))
      : v,
  );
}

function timeOf(label: string): number | null {
  const s = label.trim();
  const year = /^(\d{4})s?$/.exec(s);
  if (year) return Date.UTC(Number(year[1]), 0);
  // Without a four-digit year, Date.parse reads a bare "12" as a month.
  if (!/\b\d{4}\b/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function inTimeOrder(labels: string[]): boolean {
  const times = labels.map(timeOf);
  return times.every((t, i) => t !== null && (i === 0 || t > times[i - 1]!));
}

/** The words a claim about an item is checked against. The summary is left out: a model wrote it. */
function body(item: Item): string {
  return `${item.title}\n${item.text}`;
}

// ---- components by rule

type Rule = (item: Item, assetUrl: (id: string) => string) => Draw | null;

const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);

function chartDraw(labels: string[], values: number[], unit?: string): Draw {
  return { component: 'chart', props: compact({ chart: inTimeOrder(labels) ? 'line' : 'bar', labels, values, unit }) };
}

const VALUE_FIRST =
  /^((?:[$€£¥]\d[\d,.]*(?:k|m|b|bn)?(?: (?:thousand|million|billion))?)|(?:\d[\d,.]*(?:%|x|k|m|b|bn))|(?:\d[\d,.]* (?:percent|thousand|million|billion)))\s+(\S.{1,60})$/i;
const LABEL_FIRST = /^([^:=\n]{2,60})[:=]\s*([$€£¥]?\d[\d,.]*\s?[%\w/°]{0,12})$/;

function factInText(item: Item): Draw | null {
  if (item.kind !== 'text') return null;
  const text = (item.text.trim() || item.title).trim();
  if (text.length > 80 || text.includes('\n')) return null;
  const valueFirst = VALUE_FIRST.exec(text);
  if (valueFirst) return { component: 'fact', props: { value: valueFirst[1]!, label: valueFirst[2]!.replace(/[.\s]+$/, '') } };
  const labelFirst = LABEL_FIRST.exec(text);
  if (labelFirst) return { component: 'fact', props: { value: labelFirst[2]!.trim(), label: labelFirst[1]!.trim() } };
  return null;
}

function excerpt(messages: { role: string; text: string }[]): { role: string; text: string }[] {
  const spoken = messages.filter((m) => m.text.trim() && m.role !== 'system');
  const fromUser = (m: { role: string }) => /^(user|human)$/i.test(m.role);
  const firstUser = spoken.findIndex(fromUser);
  let best = -1;
  spoken.forEach((m, i) => {
    if (!fromUser(m) && (best < 0 || m.text.length > spoken[best]!.text.length)) best = i;
  });
  const chosen = new Set<number>();
  if (firstUser >= 0) chosen.add(firstUser);
  if (best >= 0) {
    // The question that drew the best reply, when it is not the opening one.
    if (best > 0 && fromUser(spoken[best - 1]!)) chosen.add(best - 1);
    chosen.add(best);
  }
  return [...chosen]
    .sort((a, b) => a - b)
    .slice(0, 4)
    .map((i) => ({ role: spoken[i]!.role, text: clip(spoken[i]!.text, EXCERPT) }));
}

/** First match wins. Structured data a content role filled in outranks the item's kind. */
const RULES: Rule[] = [
  (item) => {
    const chart = read(ChartData, item.data.chart);
    return chart && chart.labels.length >= 2 && chart.labels.length === chart.values.length
      ? chartDraw(chart.labels, chart.values, chart.unit)
      : null;
  },
  (item) => {
    const steps = read(StepsData, item.data.steps)?.filter((s) => s.trim());
    return steps && steps.length >= 2 ? { component: 'steps', props: { steps } } : null;
  },
  (item) => {
    const quote = read(QuoteData, item.data.quote);
    return quote ? { component: 'quote', props: compact({ text: quote.text, by: quote.by }) } : null;
  },
  (item) => {
    const person = read(PersonData, item.data.person);
    return person
      ? { component: 'person', props: compact({ name: person.name, role: person.role, image: person.image ?? str(item.data.image) }) }
      : null;
  },
  (item) => {
    const code = read(CodeData, item.data.code);
    const source = code?.source || (item.kind === 'code' ? item.text : '');
    return source || item.kind === 'code' ? { component: 'code', props: { language: code?.language || 'text', source } } : null;
  },
  (item) => {
    const facts = read(FactsData, item.data.facts);
    return facts?.length === 1 ? { component: 'fact', props: { value: facts[0]!.value, label: facts[0]!.label } } : factInText(item);
  },
  (item, assetUrl) => {
    if (item.kind !== 'image' && item.kind !== 'video') return null;
    const media = mediaOf(item, assetUrl);
    if (!media) return null;
    const caption = item.summary.trim() && item.summary.trim().length <= CAPTION ? item.summary.trim() : undefined;
    return item.kind === 'image'
      ? { component: 'image', props: compact({ src: media.src, caption }) }
      : { component: 'video', props: compact({ ...media, caption }) };
  },
  (item) => {
    const url = item.source.url;
    if (item.kind !== 'link' || !url) return null;
    return {
      component: 'link',
      props: compact({ url, site: str(item.data.site) ?? siteOf(url), description: item.summary.trim(), image: str(item.data.image) }),
    };
  },
  (item) => {
    if (item.kind !== 'chat') return null;
    const messages = excerpt(read(MessagesData, item.data.messages) ?? []);
    if (messages.length === 0) return null;
    const source = item.source.from.replace(/^chat-export:/, '');
    return { component: 'chat', props: compact({ messages, source }) };
  },
];

function byRule(item: Item, assetUrl: (id: string) => string): Draw {
  for (const rule of RULES) {
    const draw = rule(item, assetUrl);
    if (draw && isValidView(draw)) return draw;
  }
  return { component: 'note', props: {} };
}

// ---- components by model

/** Whether everything the view shows really stands in the item's own text. */
function grounded(view: { component: string; props: unknown }, item: Item): boolean {
  if (!isValidView(view)) return false;
  const text = body(item);
  switch (view.component as ComponentId) {
    case 'quote': {
      const p = COMPONENTS.quote.parse(view.props);
      return holds(text, p.text) && (p.by === undefined || holds(text, p.by));
    }
    case 'fact': {
      const p = COMPONENTS.fact.parse(view.props);
      return p.value.length <= 32 && holds(text, p.value) && p.label.trim() !== '';
    }
    case 'steps': {
      const p = COMPONENTS.steps.parse(view.props);
      return p.steps.length >= 2 && p.steps.every((s) => holds(text, s));
    }
    case 'chart': {
      const p = COMPONENTS.chart.parse(view.props);
      const known = numbersIn(text);
      return (
        p.labels.length >= 2 &&
        p.labels.length === p.values.length &&
        p.values.every((v) => known.has(Math.abs(v))) &&
        p.labels.every((l) => holds(text, l)) &&
        (p.unit === undefined || holds(text, p.unit))
      );
    }
    case 'note': {
      const p = COMPONENTS.note.parse(view.props);
      return p.emphasis === undefined || holds(text, p.emphasis);
    }
    default:
      return false;
  }
}

function claimed(reply: ComponentsReply['items'][number], item: Item): Draw {
  const text = body(item);
  const kept = (value: string) => (holds(text, value) ? value.trim() : undefined);
  switch (reply.component) {
    case 'quote':
      return {
        component: 'quote',
        props: compact({ text: reply.quoteText.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''), by: kept(reply.quoteBy) }),
      };
    case 'fact':
      return { component: 'fact', props: { value: reply.factValue.trim(), label: clip(reply.factLabel, 80) } };
    case 'steps':
      return { component: 'steps', props: { steps: reply.steps.map((s) => s.trim()).filter(Boolean) } };
    case 'chart':
      return chartDraw(
        reply.chartLabels.map((l) => l.trim()),
        reply.chartValues,
        kept(reply.chartUnit),
      );
    case 'note':
      return { component: 'note', props: compact({ emphasis: reply.emphasis.trim().length <= 120 ? kept(reply.emphasis) : undefined }) };
  }
}

const COMPONENTS_SYSTEM =
  'You are the Renderer of Mind Palace, a spatial brainstorming app. You choose the visual component that presents each piece of text most accurately.';

function componentsPrompt(open: { node: Node; item: Item }[]): string {
  const items = open.map(({ node, item }) => `id: ${node.id}\ntitle: ${item.title}\ntext: ${clip(item.text, TEXT_SENT)}`).join('\n\n');
  return `Below are text items from a user's brainstorm. Each is currently drawn as a plain note. For each item, decide whether another component is its truer form.

Components:
- note: a title and a few lines of text. The right answer for most items.
- quote: the item is mainly someone's words. Give quoteText, and quoteBy when the text names the speaker.
- fact: the item is mainly one number or short value. Give factValue as it is written in the text, and a factLabel of a few words saying what it measures.
- steps: the item is an ordered procedure of two or more steps. Give each step in steps.
- chart: the item gives several numbers of the same kind that are worth comparing. Give chartLabels and chartValues of equal length, and chartUnit when the text states one.

Rules:
- Take every value from the item's own text. Copy quoteText, factValue, each step, each chart label and the unit word for word. Leave out step numbers and bullets. Chart values must be numbers that appear in the text.
- Never add, estimate, convert or round a value. When the text does not hold what a component needs, choose note.
- For a note you may give emphasis: one short phrase copied from the text that deserves to stand out. Otherwise leave it empty.
- Return one entry per item, with the id exactly as given. Fill only the fields of the chosen component. Leave every other field as an empty string or an empty list.

Items:

${items}`;
}

async function askComponents(ctx: RoleContext, open: { node: Node; item: Item }[]): Promise<Map<Id, Draw>> {
  const out = new Map<Id, Draw>();
  const asked = open.slice(0, MAX_ASKED_ITEMS);
  if (asked.length === 0) return out;
  const byId = new Map(asked.map((o) => [o.node.id, o.item]));
  try {
    const reply = await ctx.model.json({
      role: `${ROLE}.components`,
      system: COMPONENTS_SYSTEM,
      user: componentsPrompt(asked),
      schema: ComponentsReply,
      effort: 'low',
    });
    for (const entry of reply.items) {
      const item = byId.get(entry.id);
      if (!item || out.has(entry.id)) continue;
      const draw = claimed(entry, item);
      if (grounded(draw, item)) out.set(entry.id, draw);
    }
  } catch (err) {
    ctx.note(ROLE, `The model could not choose components (${message(err)}). Kept the rule-based views.`);
  }
  return out;
}

// ---- composites

const STRUCTURE_IN_WHY =
  /\b(vs\.?|versus|alternatives?|options?|compar\w+|instead of|rather than|step \d+|timeline|phase|stage|precursor|successor|followed by|led to)\b/i;

function sameGroup(group: Group, draft: GroupDraft): boolean {
  return (
    group.composite === draft.composite &&
    group.members.length === draft.members.length &&
    draft.members.every((id) => group.members.includes(id)) &&
    stable(group.props) === stable(draft.props)
  );
}

function free(pool: Pool): Node[] {
  return pool.nodes.filter((n) => !pool.taken.has(n.id));
}

function add(ctx: RoleContext, pool: Pool, draft: GroupDraft, out: Command[]): void {
  if (!isValidGroup(draft)) return;
  out.push({ type: 'setGroup', group: { id: ctx.newId(), treeId: pool.parent.treeId, anchor: pool.parent.id, ...draft } });
  for (const id of draft.members) pool.taken.add(id);
}

/**
 * Brings one rule-made composite up to date. The pool's own group of that kind is left alone when
 * nothing changed, and replaced when its membership would. Groups of other kinds keep their members.
 */
function settle(
  ctx: RoleContext,
  pool: Pool,
  out: Command[],
  composite: CompositeId,
  fits: (node: Node) => boolean,
  build: (candidates: Node[]) => GroupDraft | null,
): void {
  const byId = new Map(pool.nodes.map((n) => [n.id, n]));
  const own = pool.standing.find((g) => g.composite === composite && g.members.every((id) => fits(byId.get(id)!)));
  const draft = build(pool.nodes.filter((n) => fits(n) && (!pool.taken.has(n.id) || own?.members.includes(n.id))));
  if (!draft || (own && sameGroup(own, draft))) return;
  if (own) {
    out.push({ type: 'removeGroup', id: own.id });
    pool.standing = pool.standing.filter((g) => g !== own);
    for (const id of own.members) pool.taken.delete(id);
  }
  add(ctx, pool, draft, out);
}

/** Splits each parent's children into pools, clears groups that no longer hold, and applies the gallery and timeline rules. */
function survey(ctx: RoleContext, parents: Node[], componentOf: (node: Node) => string, out: Command[]): Pool[] {
  const pools: Pool[] = [];
  const when = (node: Node) => str(ctx.mind.items.get(node.itemId)?.data.when);
  for (const parent of parents) {
    const children = ctx.mind.children(parent.id);
    const statusOf = new Map(children.map((n) => [n.id, n.status]));
    const anchored = [...ctx.mind.groups.values()].filter((g) => g.anchor === parent.id);
    for (const status of ['kept', 'pick'] as const) {
      const standing = anchored.filter((g) => g.members.every((id) => statusOf.get(id) === status));
      const pool: Pool = {
        parent,
        nodes: children.filter((n) => n.status === status),
        standing,
        taken: new Set(standing.flatMap((g) => g.members)),
        asked: [],
      };
      settle(
        ctx,
        pool,
        out,
        'gallery',
        (n) => componentOf(n) === 'image' || componentOf(n) === 'video',
        (nodes) => (nodes.length >= 3 ? { composite: 'gallery', title: '', members: nodes.map((n) => n.id), props: {} } : null),
      );
      settle(
        ctx,
        pool,
        out,
        'timeline',
        (n) => when(n) !== undefined,
        (nodes) => {
          if (nodes.length < 3) return null;
          const times = new Map(nodes.map((n) => [n.id, timeOf(when(n)!)]));
          const ordered = [...times.values()].every((t) => t !== null) ? [...nodes].sort((a, b) => times.get(a.id)! - times.get(b.id)!) : nodes;
          return {
            composite: 'timeline',
            title: '',
            members: ordered.map((n) => n.id),
            props: { labels: Object.fromEntries(ordered.map((n) => [n.id, clip(when(n)!, 40)])) },
          };
        },
      );
      pools.push(pool);
    }
    // A group that now mixes kept nodes with picks, or names a node that moved away, no longer holds.
    for (const g of anchored) {
      const status = statusOf.get(g.members[0]!);
      if (!status || g.members.some((id) => statusOf.get(id) !== status)) out.push({ type: 'removeGroup', id: g.id });
    }
  }
  return pools;
}

const COMPOSITES_SYSTEM =
  'You are the Renderer of Mind Palace, a spatial brainstorming app. You decide whether sibling notes in a tree should be drawn together as one arrangement.';

function compositesPrompt(ctx: RoleContext, pools: Pool[]): string {
  const line = (node: Node) => {
    const item = ctx.mind.items.get(node.itemId);
    const about = clip(item?.summary.trim() || item?.text || '', 200).replace(/\s+/g, ' ');
    const why = node.why.trim() ? ` | why it is here: ${clip(node.why, 120)}` : '';
    return `  - ${node.id} | ${clip(item?.title ?? '', 80)} | ${about}${why}`;
  };
  const byParent = new Map<Id, Pool[]>();
  for (const pool of pools) byParent.set(pool.parent.id, [...(byParent.get(pool.parent.id) ?? []), pool]);
  const blocks = [...byParent.values()].map((sets) => {
    const parent = sets[0]!.parent;
    const lists = sets.map((pool) => {
      const byId = new Map(pool.nodes.map((n) => [n.id, n]));
      const heading = pool.nodes[0]?.status === 'pick' ? 'Suggested siblings (not yet kept by the user)' : 'Kept siblings';
      return `${heading}:\n${pool.asked.map((id) => line(byId.get(id)!)).join('\n')}`;
    });
    return `Parent ${parent.id}: ${clip(ctx.mind.items.get(parent.itemId)?.title ?? '', 80)}\n${lists.join('\n')}`;
  });
  return `Below are parents in a user's brainstorm tree, each with sibling notes that hang from it. Propose groups of siblings only where drawing them as one arrangement shows something the separate notes do not.

No group is the right answer most of the time. Return an empty list unless the structure is plainly there in the content.

Arrangements:
- timeline: members that each belong to a date or period stated in their content. Give members in time order and one entry in labels per member, in the same order, copied from the content.
- comparison: 2 to 4 alternatives the user would weigh against each other. Give 2 to 4 criteria, and in cells one entry per member with one short value per criterion, in the order of criteria. Draw each value from that member's summary. Leave a value empty when the summary does not say.
- sequence: members whose order means something, such as steps or an argument. Give members in that order.
- cluster: members that share one theme the others do not. Give theme, a label of 1 to 3 words.

Rules:
- A timeline, sequence or cluster needs at least 3 members. A comparison needs 2 to 4.
- A node belongs to at most one group.
- Never put a kept sibling and a suggested sibling in the same group.
- Use the parent and member ids exactly as given.
- title is a few words: the theme, or what is being compared.
- Fill only the fields of the chosen arrangement. Leave the others as an empty string or an empty list.

${blocks.join('\n\n')}`;
}

function draftFrom(ctx: RoleContext, g: CompositesReply['groups'][number], ids: Id[]): GroupDraft | null {
  const content = (id: Id) => {
    const item = ctx.mind.itemOf(id);
    return `${item.title}\n${item.text}\n${item.summary}\n${str(item.data.when) ?? ''}`;
  };
  const title = clip(g.title, 40);
  switch (g.composite) {
    case 'timeline': {
      const label = new Map(g.members.map((id, i) => [id, (g.labels[i] ?? '').trim()]));
      const dated = ids.filter((id) => {
        const l = label.get(id)!;
        return l !== '' && (/\d/.test(l) ? numbersHeld(content(id), l) : holds(content(id), l));
      });
      if (dated.length < 3) return null;
      return { composite: 'timeline', title, members: dated, props: { labels: Object.fromEntries(dated.map((id) => [id, clip(label.get(id)!, 40)])) } };
    }
    case 'comparison': {
      const criteria = g.criteria.slice(0, 4).map((c) => clip(c, 40));
      if (criteria.length < 2 || criteria.some((c) => c === '')) return null;
      const rows = new Map(g.cells.map((row) => [row.member, row.values]));
      const members = ids.filter((id) => rows.has(id)).slice(0, 4);
      if (members.length < 2) return null;
      const cells = Object.fromEntries(
        members.map((id) => [
          id,
          criteria.map((_c, i) => {
            const cell = clip(rows.get(id)![i] ?? '', 80);
            // A number the member's own content does not hold was made up.
            return numbersHeld(content(id), cell) ? cell : '';
          }),
        ]),
      );
      return { composite: 'comparison', title, members, props: { criteria, cells } };
    }
    case 'sequence':
      return ids.length >= 3 ? { composite: 'sequence', title, members: ids, props: {} } : null;
    case 'cluster': {
      const theme = (g.theme.trim() || g.title.trim()).split(/\s+/).slice(0, 3).join(' ');
      return ids.length >= 3 && theme ? { composite: 'cluster', title: title || theme, members: ids, props: { theme } } : null;
    }
  }
}

async function askComposites(ctx: RoleContext, pools: Pool[], changed: ReadonlySet<Id>, out: Command[]): Promise<void> {
  const asked = pools
    .filter((pool) => {
      const open = free(pool);
      // Siblings that were already looked at and have not changed are not worth a second question.
      if (!open.some((n) => changed.has(n.id))) return false;
      return open.length >= 4 || (open.length >= 2 && open.some((n) => STRUCTURE_IN_WHY.test(n.why)));
    })
    .slice(0, MAX_ASKED_POOLS);
  if (asked.length === 0) return;
  for (const pool of asked) pool.asked = free(pool).slice(0, MAX_ASKED_SIBLINGS).map((n) => n.id);
  let reply: CompositesReply;
  try {
    reply = await ctx.model.json({
      role: `${ROLE}.composites`,
      system: COMPOSITES_SYSTEM,
      user: compositesPrompt(ctx, asked),
      schema: CompositesReply,
      effort: 'low',
    });
  } catch (err) {
    ctx.note(ROLE, `The model could not look for composites (${message(err)}). Kept the rule-based groups.`);
    return;
  }
  for (const g of reply.groups) {
    const members = [...new Set(g.members)];
    const pool = asked.find((p) => p.parent.id === g.parent && members.length > 0 && members.every((id) => p.asked.includes(id)));
    if (!pool) continue;
    const draft = draftFrom(
      ctx,
      g,
      members.filter((id) => !pool.taken.has(id)),
    );
    if (draft) add(ctx, pool, draft, out);
  }
}

function stack(ctx: RoleContext, pool: Pool, componentOf: (node: Node) => string, out: Command[]): void {
  for (const component of new Set(pool.nodes.map(componentOf))) {
    settle(
      ctx,
      pool,
      out,
      'stack',
      (n) => componentOf(n) === component,
      (nodes) => {
        if (nodes.length <= STACK_ABOVE) return null;
        const under = [...nodes].sort((a, b) => b.importance - a.importance || a.order - b.order).slice(STACK_KEEPS);
        return { composite: 'stack', title: `${under.length} more`, members: under.map((n) => n.id), props: {} };
      },
    );
  }
}

// ---- the role

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sameView(a: { component: string; props: unknown }, b: { component: string; props: unknown }): boolean {
  return a.component === b.component && stable(a.props) === stable(b.props);
}

/** Chooses a component for each given node and composites for their siblings. Rules first, the model only where rules cannot tell. */
export const renderer: Roles['renderer'] = async (ctx, { nodeIds }) => {
  const nodes = [...new Set(nodeIds)].flatMap((id) => ctx.mind.nodes.get(id) ?? []);
  const draws = new Map<Id, Draw>();
  const open: { node: Node; item: Item }[] = [];
  for (const node of nodes) {
    const item = ctx.mind.items.get(node.itemId);
    if (!item) continue;
    const draw = byRule(item, (id) => ctx.assets.url(id));
    const ambiguous = draw.component === 'note' && item.kind === 'text' && item.text.trim().length >= AMBIGUOUS_FROM;
    // An earlier choice that still stands in the text is kept, so a second pass costs no model call and cannot lose it.
    if (ambiguous && node.view.by === 'renderer' && grounded(node.view, item)) continue;
    draws.set(node.id, draw);
    if (ambiguous) open.push({ node, item });
  }
  const componentOf = (node: Node) => draws.get(node.id)?.component ?? node.view.component;

  const parentIds = new Set(nodes.flatMap((n) => n.parent ?? []));
  const parents = [...parentIds].flatMap((id) => ctx.mind.nodes.get(id) ?? []);
  const groups: Command[] = [];
  const pools = survey(ctx, parents, componentOf, groups);

  const [chosen] = await Promise.all([askComponents(ctx, open), askComposites(ctx, pools, new Set(nodes.map((n) => n.id)), groups)]);
  for (const [id, draw] of chosen) draws.set(id, draw);
  for (const pool of pools) stack(ctx, pool, componentOf, groups);

  const views: Command[] = [];
  for (const node of nodes) {
    const draw = draws.get(node.id);
    if (!draw || sameView(draw, node.view)) continue;
    const view: View = { ...draw, by: 'renderer' };
    views.push({ type: 'setView', id: node.id, view });
  }
  const removals = groups.filter((c) => c.type === 'removeGroup');
  return [...views, ...removals, ...groups.filter((c) => c.type !== 'removeGroup')];
};
