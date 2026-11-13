import { z } from 'zod';
import type { Id, Item, Node } from '../domain.ts';
import type { Handoff, RoleContext, Roles, Scope } from './types.ts';

const ROLE = 'packager';
const MAX_OWN_TEXT = 3000;
const MAX_AGENT_TEXT = 600;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_TEXT = 500;
const MAX_OUTLINE = 150;

export const PackagerReply = z.object({
  brief: z.string(),
  nextPrompt: z.string(),
  openQuestions: z.array(z.string()),
});

const SYSTEM = `You are the Packager of Mind Palace, a spatial brainstorming app. You write the cover notes of a handoff file. The user takes the file to another AI agent, which has no access to the app and must continue the work from the file alone.

You are given an outline of the trees in the handoff, and the user's instruction for the next agent when there is one. Each outline line is a node: its label, its title and a one-line summary. The label "own" is the user's own content, "kept" is an agent suggestion the user kept, and "suggestion" is an agent suggestion the user has not kept.

Return three fields.
- "brief": two to four sentences that say what the user was exploring and where the thinking stands. Give the user's own content the most weight. Do not describe the file format.
- "nextPrompt": a prompt addressed to the receiving agent that it can act on at once. Say what to produce, what to treat as settled, and what to treat as open. Follow the user's instruction when there is one. Write it as plain prose with no headings.
- "openQuestions": 3 to 6 questions the material raises and does not answer. Each is one sentence that a person could act on.

Use only what the outline says. Do not invent facts, names or sources.`;

const Messages = z.array(z.object({ role: z.string(), text: z.string() }));

export type HandoffLabel = 'own' | 'kept' | 'suggestion';

const LABEL_TEXT: Record<HandoffLabel, string> = {
  own: "the user's own",
  kept: 'agent pick, kept by the user',
  suggestion: 'agent suggestion, not kept',
};

export interface HandoffNode {
  id: Id;
  itemId: Id;
  label: HandoffLabel;
  kind: Item['kind'];
  title: string;
  why: string;
  summary: string;
  /** Null when the item has no text. */
  text: string | null;
  /** True when `text` was cut short. */
  textTrimmed: boolean;
  url: string | null;
  /** `assets/<id>` when the item has a file. */
  asset: string | null;
  tags: string[];
  data: Item['data'];
  /** How the item arrived, for example paste, web or voice. */
  from: string;
  children: HandoffNode[];
}

export interface HandoffTree {
  id: Id;
  title: string;
  /** False when `root` is a branch of the tree and not the tree's own root. */
  whole: boolean;
  /** Titles from the tree's root down to the parent of `root`. Empty for a whole tree. */
  path: string[];
  root: HandoffNode;
}

export interface HandoffJson {
  format: 'mind-palace-handoff';
  version: 1;
  createdAt: string;
  note: string | null;
  brief: string;
  nextPrompt: string;
  openQuestions: string[];
  trees: HandoffTree[];
  links: { id: Id; a: Id; b: Id; why: string; strength: number }[];
  sources: { url: string; title: string }[];
  assets: { id: string; file: string; mime: string; name: string }[];
}

/** The top nodes the scope covers, with any node already under another one removed. */
function topNodes(ctx: RoleContext, scope: Scope): Node[] {
  const { mind } = ctx;
  const asked: Id[] = [];
  for (const treeId of scope.treeIds) {
    if (mind.trees.has(treeId)) asked.push(mind.tree(treeId).rootId);
    else ctx.note(ROLE, `the scope names tree ${treeId}, which does not exist`);
  }
  for (const nodeId of scope.nodeIds) {
    if (mind.nodes.has(nodeId)) asked.push(nodeId);
    else ctx.note(ROLE, `the scope names node ${nodeId}, which does not exist`);
  }
  if (scope.treeIds.length + scope.nodeIds.length === 0) {
    return [...mind.trees.values()].map((t) => mind.node(t.rootId));
  }
  const ids = new Set(asked);
  return [...ids]
    .filter((id) => !mind.path(id).some((n) => n.id !== id && ids.has(n.id)))
    .map((id) => mind.node(id));
}

function clip(text: string, max: number): { text: string; trimmed: boolean } {
  const clean = text.trim();
  return clean.length > max ? { text: clean.slice(0, max), trimmed: true } : { text: clean, trimmed: false };
}

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function nest(ctx: RoleContext, node: Node): HandoffNode {
  const item = ctx.mind.itemOf(node.id);
  const own = item.origin.by === 'user';
  const body = clip(item.text, own ? MAX_OWN_TEXT : MAX_AGENT_TEXT);
  return {
    id: node.id,
    itemId: item.id,
    label: own ? 'own' : node.status === 'kept' ? 'kept' : 'suggestion',
    kind: item.kind,
    title: item.title,
    why: node.why,
    summary: item.summary,
    text: body.text || null,
    textTrimmed: body.trimmed,
    url: item.source.url ?? null,
    asset: item.source.asset ? `assets/${item.source.asset}` : null,
    tags: item.tags,
    data: item.data,
    from: item.source.from,
    children: ctx.mind.children(node.id).map((child) => nest(ctx, child)),
  };
}

function flatten(node: HandoffNode): HandoffNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

function compactOutline(trees: HandoffTree[]): string {
  const lines: string[] = [];
  let left = MAX_OUTLINE;
  const walk = (node: HandoffNode, depth: number) => {
    if (left-- <= 0) return;
    lines.push(`${'  '.repeat(depth)}- [${node.label}] ${oneLine(node.title, 80)}: ${oneLine(node.summary || node.text || '', 140)}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const tree of trees) {
    lines.push(`Tree "${oneLine(tree.title, 80)}"${tree.whole ? '' : ` (the branch "${oneLine(tree.root.title, 80)}" only)`}`);
    walk(tree.root, 0);
  }
  return lines.join('\n');
}

function quote(text: string, indent: string): string[] {
  return text.split('\n').map((line) => `${indent}> ${line}`.trimEnd());
}

function nodeMarkdown(node: HandoffNode, depth: number): string[] {
  const pad = '  '.repeat(depth);
  const sub = `${pad}  `;
  const lines = [`${pad}- **${oneLine(node.title, 200) || '(untitled)'}** (${LABEL_TEXT[node.label]}, ${node.kind}, id \`${node.id}\`)`];
  if (node.why) lines.push(`${sub}- why it is here: ${oneLine(node.why, 400)}`);
  if (node.summary) lines.push(`${sub}- summary: ${oneLine(node.summary, 600)}`);
  if (node.url) lines.push(`${sub}- url: ${node.url}`);
  if (node.asset) lines.push(`${sub}- file: ${node.asset}`);
  if (node.text && node.text !== node.summary && node.text !== node.title) {
    lines.push(`${sub}- text${node.textTrimmed ? ' (trimmed, the original is longer)' : ''}:`, '', ...quote(node.text, `${sub}  `), '');
  }
  const messages = Messages.safeParse(node.data.messages);
  if (messages.success && messages.data.length > 0) {
    lines.push(`${sub}- messages:`);
    for (const m of messages.data.slice(0, MAX_MESSAGES)) {
      lines.push(`${sub}  - ${m.role}: ${oneLine(m.text, MAX_MESSAGE_TEXT)}`);
    }
    if (messages.data.length > MAX_MESSAGES) {
      lines.push(`${sub}  - (${messages.data.length - MAX_MESSAGES} more messages are not shown)`);
    }
  }
  for (const child of node.children) lines.push(...nodeMarkdown(child, depth + 1));
  return lines;
}

function markdown(doc: HandoffJson, title: string): string {
  const byId = new Map(doc.trees.flatMap((t) => flatten(t.root)).map((n) => [n.id, n]));
  const name = (id: Id) => `**${oneLine(byId.get(id)!.title, 80)}** (\`${id}\`)`;
  const out: string[] = [
    `# ${title}`,
    '',
    `This file is a handoff from Mind Palace, a spatial brainstorming app, written on ${doc.createdAt.slice(0, 10)} for an agent that cannot open the app. ${doc.brief}`,
    '',
  ];
  if (doc.note) out.push("The user's instruction for you:", '', ...quote(doc.note, ''), '');

  out.push('## What to do next', '', doc.nextPrompt, '');

  out.push(
    '## Outline',
    '',
    `Each bold line is one node, followed by its label, its kind and its id. "${LABEL_TEXT.own}" is content the user added. "${LABEL_TEXT.kept}" is content an agent found and the user chose to keep. "${LABEL_TEXT.suggestion}" is content an agent found that the user has not accepted, so give it less weight.`,
    '',
  );
  for (const tree of doc.trees) {
    out.push(`### ${tree.title}`, '');
    if (!tree.whole) out.push(`This is one branch of the tree "${tree.title}", found under ${tree.path.map((t) => `"${t}"`).join(', then ')}.`, '');
    out.push(...nodeMarkdown(tree.root, 0), '');
  }

  out.push('## Connections', '');
  if (doc.links.length === 0) out.push('No links join the nodes in this handoff.', '');
  else out.push(...doc.links.map((l) => `- ${name(l.a)} and ${name(l.b)}: ${oneLine(l.why, 300) || 'no reason recorded'}`), '');

  if (doc.openQuestions.length > 0) {
    out.push('## Open questions', '', ...doc.openQuestions.map((q) => `- ${q}`), '');
  }

  out.push('## Sources', '');
  if (doc.sources.length === 0) out.push('Nothing in this handoff has a URL.', '');
  else out.push(...doc.sources.map((s) => `- [${oneLine(s.title, 120) || s.url}](${s.url})`), '');

  out.push('## Attached files', '');
  if (doc.assets.length === 0) out.push('No files are attached.', '');
  else out.push(...doc.assets.map((a) => `- \`${a.file}\`: ${a.name} (${a.mime})`), '');

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function list(titles: string[]): string {
  const quoted = titles.map((t) => `"${t}"`);
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

export const packager: Roles['packager'] = async (ctx, { scope, note }): Promise<Handoff> => {
  const { mind } = ctx;
  const createdAt = ctx.now();
  const instruction = note?.trim() || null;

  const trees: HandoffTree[] = topNodes(ctx, scope).map((top) => {
    const tree = mind.tree(top.treeId);
    return {
      id: tree.id,
      title: tree.title,
      whole: top.parent === null,
      path: mind
        .path(top.id)
        .slice(0, -1)
        .map((n) => mind.itemOf(n.id).title),
      root: nest(ctx, top),
    };
  });
  const nodes = trees.flatMap((t) => flatten(t.root));
  const included = new Set(nodes.map((n) => n.id));

  const links = [...mind.links.values()]
    .filter((l) => included.has(l.a) && included.has(l.b))
    .map((l) => ({ id: l.id, a: l.a, b: l.b, why: l.why, strength: l.strength }));

  const sources: HandoffJson['sources'] = [];
  for (const n of nodes) {
    if (n.url && !sources.some((s) => s.url === n.url)) sources.push({ url: n.url, title: n.title });
  }

  const assetNodes = new Map<string, HandoffNode>();
  for (const n of nodes) {
    const id = n.asset?.slice('assets/'.length);
    if (id && !assetNodes.has(id)) assetNodes.set(id, n);
  }
  const assets: HandoffJson['assets'] = [];
  for (const [id, node] of assetNodes) {
    const stored = await ctx.assets.get(id).catch(() => null);
    if (!stored) ctx.note(ROLE, `asset ${id} is listed but its bytes were not found`);
    assets.push({
      id,
      file: `assets/${id}`,
      mime: stored?.mime ?? 'application/octet-stream',
      name: stored?.name ?? node.title,
    });
  }

  const subjects = trees.map((t) => (t.whole ? t.title : t.root.title));
  const everything = scope.treeIds.length + scope.nodeIds.length === 0;

  let brief = trees.length === 0
    ? 'The mindstorm had nothing in it when this file was written.'
    : `The user was brainstorming on ${list(subjects)}. This handoff holds ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'} in ${trees.length} ${trees.length === 1 ? 'tree' : 'trees'}.`;
  let nextPrompt = `Read the outline below and continue the user's work on ${list(subjects) || 'this mindstorm'}. Treat the user's own content as the starting point and the agent suggestions as leads to check.${instruction ? ` The user asks: ${instruction}` : ''}`;
  let openQuestions: string[] = [];

  if (trees.length > 0) {
    if (nodes.length > MAX_OUTLINE) ctx.note(ROLE, `the model saw ${MAX_OUTLINE} of ${nodes.length} nodes when it wrote the brief`);
    try {
      const reply = await ctx.model.json({
        role: ROLE,
        system: SYSTEM,
        user: [
          instruction ? `The user's instruction for the next agent: ${oneLine(instruction, 1000)}` : 'The user gave no instruction for the next agent.',
          'Outline:',
          compactOutline(trees),
        ].join('\n\n'),
        schema: PackagerReply,
        effort: 'medium',
      });
      if (reply.brief.trim()) brief = reply.brief.trim();
      if (reply.nextPrompt.trim()) nextPrompt = reply.nextPrompt.trim();
      openQuestions = reply.openQuestions.map((q) => oneLine(q, 400)).filter(Boolean).slice(0, 6);
    } catch (err) {
      ctx.note(ROLE, `the model failed, so the brief is a plain one and there are no open questions: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const json: HandoffJson = {
    format: 'mind-palace-handoff',
    version: 1,
    createdAt,
    note: instruction,
    brief,
    nextPrompt,
    openQuestions,
    trees,
    links,
    sources,
    assets,
  };

  const subject = everything || subjects.length === 0 ? 'mindstorm' : slug(subjects[0]!) || 'mindstorm';
  const more = !everything && subjects.length > 1 ? `-and-${subjects.length - 1}-more` : '';
  const title = `Handoff: ${everything || subjects.length === 0 ? 'the whole mindstorm' : subjects.join(', ')}`;

  return {
    name: `${subject}${more}-handoff-${createdAt.slice(0, 10)}`,
    markdown: markdown(json, title),
    json,
    assets: assets.map((a) => a.id),
  };
};
