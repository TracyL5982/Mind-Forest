import { z } from 'zod';
import type { Command, Id, Item, Node } from '../domain.ts';
import { AGENT, makeItem, makeNode, type RoleContext, type Roles, type Scope } from './types.ts';

const ROLE = 'organizer';
const MAX_OUTLINE = 150;
const MAX_OUTLINE_EVERYTHING = 40;
const MAX_OPERATIONS = 200;

const text = z.string().nullish();

export const OrganizerOp = z.object({
  op: z.enum(['move', 'delete', 'rename', 'edit', 'create', 'newTree', 'mergeTree', 'keep', 'dropPicks']),
  nodeId: text,
  targetNodeId: text,
  treeId: text,
  title: text,
  text: text,
  why: text,
});
export type OrganizerOp = z.infer<typeof OrganizerOp>;

export const OrganizerReply = z.object({
  operations: z.array(OrganizerOp),
  summary: z.string(),
});

const SYSTEM = `You are the Organizer of Mind Forest, a spatial brainstorming app. The user asks by voice for their trees of notes to be tidied, and you turn the request into a list of operations.

You are given the request and an outline of the part of the mindstorm the request is about. A tree line reads "Tree <treeId> | <title> | root <nodeId>". Under it, each node line reads "<nodeId> | <depth> | <status> | <title> | <summary>". Status "kept" is content the user owns or has kept. Status "pick" is an agent suggestion the user has not kept yet.

Return "operations", which are applied in order, and "summary".

Each operation has "op" and only the fields that op needs. Leave the other fields out.
- move: put nodeId, with everything under it, under targetNodeId.
- delete: with nodeId, delete that node and everything under it. With treeId and no nodeId, delete the whole tree.
- rename: put the new name in "title". With nodeId, it sets that item's title. With treeId and no nodeId, it sets the tree's title. To rename a tree, always give its treeId from the "Tree" line.
- edit: change the title, the text, or both, of the item at nodeId.
- create: add a new text note under targetNodeId, from title and text. Use "why" for one short line on why it sits there.
- newTree: with nodeId, move that node and everything under it out into a tree of its own, titled title. Without nodeId, start a new tree titled title whose root is a new note with the given text.
- mergeTree: move the whole tree treeId under targetNodeId, which is in another tree.
- keep: keep the pick at nodeId.
- dropPicks: delete every unkept pick under targetNodeId, or every unkept pick in the outline when targetNodeId is left out.

To use a note or tree you create in a later operation, set nodeId on the create or newTree operation to a label you choose that starts with "new-", such as "new-1". Then use that label as a nodeId or targetNodeId afterwards. This is how you group nodes: create the group note, then move the nodes under it.

Rules:
- Use ids exactly as the outline gives them. Never invent an id other than a "new-" label.
- Do only what the request asks. Do not tidy further.
- Deleting is the dangerous operation. Delete only what the request clearly names. When the request is vague, such as "clean this up", prefer move, rename and dropPicks, and never delete kept content.
- Delete a whole tree only when the user asked to delete that tree.
- If the request cannot be done with these operations, return no operations.

"summary" is one sentence in the past tense, in the first person, that the agent says aloud to the user. Say what you changed. If you left something alone on purpose, say so. If you changed nothing, say why.`;

/** The mindstorm as it will be once the commands so far are applied, so each operation is checked against the ones before it. */
class Plan {
  readonly commands: Command[] = [];
  readonly notes: string[] = [];
  private readonly nodes = new Map<Id, Node>();
  /** Tree id to root node id. */
  private readonly trees = new Map<Id, Id>();
  private readonly newItems = new Map<Id, Item>();
  /** The model's "new-" labels, and nodes replaced by a split, to the node that stands for them now. */
  private readonly alias = new Map<string, Id>();

  constructor(
    private readonly ctx: RoleContext,
    private readonly scope: Set<Id>,
    private readonly treesOnly: boolean,
  ) {
    for (const n of ctx.mind.nodes.values()) this.nodes.set(n.id, { ...n });
    for (const t of ctx.mind.trees.values()) this.trees.set(t.id, t.rootId);
  }

  /** Returns why the operation was skipped, or nothing when it became commands. */
  run(op: OrganizerOp): string | void {
    if (this.treesOnly && !isTreeLevel(op)) return 'with no tree in focus only whole-tree changes are allowed';
    return this[op.op](op);
  }

  private move(op: OrganizerOp): string | void {
    const node = this.inScope(op.nodeId);
    const target = this.inScope(op.targetNodeId);
    if (!node) return `node ${op.nodeId} is not in scope`;
    if (!target) return `target ${op.targetNodeId} is not in scope`;
    if (this.isUnder(target.id, node.id)) return `${node.id} cannot move under itself or its own descendant`;
    if (node.parent === target.id) return `${node.id} is already under ${target.id}`;
    this.moveUnder(node, target);
  }

  private delete(op: OrganizerOp): string | void {
    const node = op.nodeId ? this.inScope(op.nodeId) : undefined;
    if (op.nodeId && !node) return `node ${op.nodeId} is not in scope`;
    if (node && node.parent !== null) {
      this.commands.push({ type: 'deleteNode', id: node.id });
      this.remove(node.id);
      return;
    }
    if (!op.treeId) return node ? `${node.id} is a tree root, and the request did not delete the tree` : 'it names nothing';
    const rootId = this.trees.get(op.treeId);
    if (!rootId || !this.scope.has(rootId)) return `tree ${op.treeId} is not in scope`;
    if (node && node.id !== rootId) return `${node.id} is not the root of tree ${op.treeId}`;
    this.commands.push({ type: 'deleteTree', id: op.treeId });
    this.remove(rootId);
  }

  private rename(op: OrganizerOp): string | void {
    // The live model sometimes puts the new name in "text".
    const title = op.title?.trim() || op.text?.trim();
    if (!title) return 'it has no title';
    if (op.nodeId) {
      const node = this.inScope(op.nodeId);
      if (!node) return `node ${op.nodeId} is not in scope`;
      this.commands.push({ type: 'editItem', id: node.itemId, patch: { title } });
      return;
    }
    const touched = this.scopeTrees();
    const treeId = op.treeId ?? (touched.size === 1 ? [...touched][0] : undefined);
    if (!treeId || !touched.has(treeId)) return `tree ${op.treeId ?? '(none named)'} is not in scope`;
    this.commands.push({ type: 'renameTree', id: treeId, title });
  }

  private edit(op: OrganizerOp): string | void {
    const node = this.inScope(op.nodeId);
    if (!node) return `node ${op.nodeId} is not in scope`;
    const title = op.title?.trim();
    const body = op.text?.trim();
    if (!title && !body) return 'it changes nothing';
    this.commands.push({
      type: 'editItem',
      id: node.itemId,
      patch: { ...(title ? { title } : {}), ...(body ? { text: body } : {}) },
    });
  }

  private create(op: OrganizerOp): string | void {
    const target = this.inScope(op.targetNodeId);
    if (!target) return `target ${op.targetNodeId} is not in scope`;
    const body = op.text?.trim() ?? '';
    const title = op.title?.trim() || oneLine(body, 60);
    if (!title) return 'it has no title and no text';
    const item = this.note(title, body);
    const node: Node = {
      ...makeNode(this.ctx, item, {
        treeId: target.treeId,
        parent: target.id,
        status: 'kept',
        why: op.why?.trim() ?? '',
        origin: AGENT(ROLE),
      }),
      order: this.nextOrder(target.id),
    };
    this.commands.push({ type: 'addItem', item }, { type: 'addNode', node });
    this.add(node, op.nodeId);
  }

  private newTree(op: OrganizerOp): string | void {
    const old = op.nodeId ? this.inScope(op.nodeId) : undefined;
    if (old) return this.split(old, op.title?.trim());
    if (op.nodeId && !isLabel(op.nodeId)) return `node ${op.nodeId} is not in scope`;
    const title = op.title?.trim();
    if (!title) return 'it has no title';
    const item = this.note(title, op.text?.trim() ?? '');
    const treeId = this.ctx.newId();
    const root = makeNode(this.ctx, item, { treeId, parent: null, status: 'kept', why: '', origin: AGENT(ROLE) });
    this.commands.push(
      { type: 'addItem', item },
      { type: 'createTree', tree: { id: treeId, title, rootId: root.id, digest: title, createdAt: this.ctx.now() }, root },
    );
    this.trees.set(treeId, root.id);
    this.add(root, op.nodeId);
  }

  /**
   * `moveNode` needs a parent, so a node cannot simply be moved out to be a root.
   * A new tree gets a new root node for the same item, the old node's children move under it, and the old node goes.
   */
  private split(old: Node, title: string | undefined): string | void {
    if (old.parent === null) {
      if (!title) return `${old.id} is already the root of its own tree`;
      this.commands.push({ type: 'renameTree', id: old.treeId, title });
      return;
    }
    const item = this.newItems.get(old.itemId) ?? this.ctx.mind.item(old.itemId);
    const treeId = this.ctx.newId();
    const root: Node = {
      ...makeNode(this.ctx, item, {
        treeId,
        parent: null,
        status: 'kept',
        why: '',
        origin: old.origin,
        importance: old.importance,
      }),
      view: old.view,
    };
    const name = title || item.title;
    this.commands.push({
      type: 'createTree',
      tree: { id: treeId, title: name, rootId: root.id, digest: name, createdAt: this.ctx.now() },
      root,
    });
    this.trees.set(treeId, root.id);
    this.add(root);
    for (const kid of this.kids(old.id)) this.moveUnder(kid, root, kid.order);
    this.commands.push({ type: 'deleteNode', id: old.id });
    this.remove(old.id);
    // Deleting the old node deletes its links, so they are drawn again from the new root.
    for (const link of this.ctx.mind.nodes.has(old.id) ? this.ctx.mind.linksOf(old.id) : []) {
      const other = link.a === old.id ? link.b : link.a;
      if (!this.nodes.has(other) || other === root.id) continue;
      this.commands.push({
        type: 'link',
        link: { id: this.ctx.newId(), a: root.id, b: other, why: link.why, strength: link.strength },
      });
    }
    this.alias.set(old.id, root.id);
  }

  private mergeTree(op: OrganizerOp): string | void {
    const rootId = op.treeId ? this.trees.get(op.treeId) : undefined;
    const root = rootId && this.scope.has(rootId) ? this.nodes.get(rootId) : undefined;
    if (!root) return `tree ${op.treeId} is not in scope`;
    const target = this.inScope(op.targetNodeId);
    if (!target) return `target ${op.targetNodeId} is not in scope`;
    if (target.treeId === root.treeId) return `target ${target.id} is inside the tree being merged`;
    this.moveUnder(root, target);
  }

  private keep(op: OrganizerOp): string | void {
    const node = this.inScope(op.nodeId);
    if (!node) return `node ${op.nodeId} is not in scope`;
    if (node.status !== 'pick') return `${node.id} is already kept`;
    this.commands.push({ type: 'keepPick', id: node.id });
    for (const n of this.pathTo(node)) n.status = 'kept';
  }

  private dropPicks(op: OrganizerOp): string | void {
    const base = op.targetNodeId ? this.inScope(op.targetNodeId) : undefined;
    if (op.targetNodeId && !base) return `target ${op.targetNodeId} is not in scope`;
    const picks = [...this.nodes.values()].filter(
      (n) =>
        n.status === 'pick' &&
        n.parent !== null &&
        this.scope.has(n.id) &&
        (!base || (n.id !== base.id && this.isUnder(n.id, base.id))),
    );
    const ids = new Set(picks.map((n) => n.id));
    const tops = picks.filter((n) => !this.pathTo(n).some((a) => a.id !== n.id && ids.has(a.id)));
    let dropped = 0;
    for (const top of tops) {
      if (this.under(top.id).some((n) => n.status === 'kept')) {
        this.notes.push(`left pick ${top.id} alone because kept content sits under it`);
        continue;
      }
      this.commands.push({ type: 'deleteNode', id: top.id });
      this.remove(top.id);
      dropped++;
    }
    if (dropped === 0) return 'there are no unkept picks to drop';
  }

  // ---- the working model

  private resolve(raw: string | null | undefined): Id | undefined {
    let id = raw?.trim();
    for (let hops = 0; id && this.alias.has(id) && hops < 8; hops++) id = this.alias.get(id);
    return id || undefined;
  }

  private inScope(raw: string | null | undefined): Node | undefined {
    const id = this.resolve(raw);
    return id && this.scope.has(id) ? this.nodes.get(id) : undefined;
  }

  private scopeTrees(): Set<Id> {
    const out = new Set<Id>();
    for (const id of this.scope) {
      const node = this.nodes.get(id);
      if (node) out.add(node.treeId);
    }
    return out;
  }

  private kids(id: Id): Node[] {
    return [...this.nodes.values()].filter((n) => n.parent === id).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  }

  /** From the root down to the node. */
  private pathTo(node: Node): Node[] {
    const out: Node[] = [];
    for (let n: Node | undefined = node; n; n = n.parent ? this.nodes.get(n.parent) : undefined) out.unshift(n);
    return out;
  }

  /** True when `id` is `ancestor` or sits anywhere under it. */
  private isUnder(id: Id, ancestor: Id): boolean {
    const node = this.nodes.get(id);
    return !!node && this.pathTo(node).some((n) => n.id === ancestor);
  }

  private under(id: Id): Node[] {
    return [...this.nodes.values()].filter((n) => this.isUnder(n.id, id));
  }

  private nextOrder(parent: Id): number {
    return this.kids(parent).reduce((max, n) => Math.max(max, n.order), -1) + 1;
  }

  private note(title: string, body: string): Item {
    const item = makeItem(this.ctx, { kind: 'text', title, text: body, origin: AGENT(ROLE), source: { from: ROLE } });
    this.newItems.set(item.id, item);
    return item;
  }

  private add(node: Node, label?: string | null): void {
    this.nodes.set(node.id, node);
    this.scope.add(node.id);
    if (label && isLabel(label)) this.alias.set(label.trim(), node.id);
  }

  private moveUnder(node: Node, target: Node, order = this.nextOrder(target.id)): void {
    this.commands.push({ type: 'moveNode', id: node.id, parent: target.id, order });
    const moved = this.under(node.id);
    if (node.parent === null) this.trees.delete(node.treeId);
    for (const n of moved) n.treeId = target.treeId;
    node.parent = target.id;
    node.order = order;
  }

  private remove(id: Id): void {
    for (const n of this.under(id)) {
      if (n.parent === null) this.trees.delete(n.treeId);
      this.nodes.delete(n.id);
    }
  }
}

function isLabel(id: string): boolean {
  return /^new\b/i.test(id.trim());
}

function isTreeLevel(op: OrganizerOp): boolean {
  if (op.op === 'mergeTree' || op.op === 'newTree' || op.op === 'dropPicks') return true;
  return (op.op === 'rename' || op.op === 'delete') && !op.nodeId;
}

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

interface Area {
  nodes: Set<Id>;
  /** True when the request named nothing and nothing is in focus, so it covers every tree. */
  everything: boolean;
}

function resolveArea(ctx: RoleContext, scope: Scope, focus: Id | undefined): Area | null {
  const { mind } = ctx;
  const nodes = new Set<Id>();
  for (const treeId of scope.treeIds) {
    if (!mind.trees.has(treeId)) ctx.note(ROLE, `the scope names tree ${treeId}, which does not exist`);
    else for (const n of mind.treeNodes(treeId)) nodes.add(n.id);
  }
  for (const nodeId of scope.nodeIds) {
    if (!mind.nodes.has(nodeId)) ctx.note(ROLE, `the scope names node ${nodeId}, which does not exist`);
    else for (const n of mind.subtree(nodeId)) nodes.add(n.id);
  }
  if (scope.treeIds.length + scope.nodeIds.length > 0) return nodes.size > 0 ? { nodes, everything: false } : null;
  if (focus && mind.nodes.has(focus)) {
    for (const n of mind.treeNodes(mind.node(focus).treeId)) nodes.add(n.id);
    return { nodes, everything: false };
  }
  return { nodes: new Set(mind.nodes.keys()), everything: true };
}

function outline(ctx: RoleContext, area: Area): string {
  const { mind } = ctx;
  const all = [...mind.trees.values()].flatMap((t) => mind.treeNodes(t.id)).filter((n) => area.nodes.has(n.id));
  const depth = new Map(all.map((n) => [n.id, mind.depth(n.id)]));
  const limit = area.everything ? MAX_OUTLINE_EVERYTHING : MAX_OUTLINE;
  // Across every tree the shallowest nodes say the most about what each tree is.
  const ranked = area.everything ? [...all].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!) : all;
  const shown = new Set(ranked.slice(0, limit).map((n) => n.id));
  if (all.length > limit) ctx.note(ROLE, `the outline shows ${limit} of ${all.length} nodes`);

  const lines: string[] = [];
  for (const tree of mind.trees.values()) {
    const mine = mind.treeNodes(tree.id).filter((n) => area.nodes.has(n.id));
    if (mine.length === 0) continue;
    const whole = area.nodes.has(tree.rootId);
    lines.push(`Tree ${tree.id} | ${oneLine(tree.title, 80)} | root ${tree.rootId}${whole ? '' : ' | only part of this tree is in scope'}`);
    for (const n of mine) {
      if (!shown.has(n.id)) continue;
      const item = mind.itemOf(n.id);
      lines.push(`${n.id} | ${depth.get(n.id)} | ${n.status} | ${oneLine(item.title, 80)} | ${oneLine(item.summary || item.text, 120)}`);
    }
    const hidden = mine.filter((n) => !shown.has(n.id)).length;
    if (hidden > 0) lines.push(`(${hidden} more nodes in this tree are not shown)`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

const nothing = (why: string) => ({ commands: [], summary: `Nothing was changed. ${why}` });

export const organizer: Roles['organizer'] = async (ctx, { request, scope, focus }) => {
  const area = resolveArea(ctx, scope, focus);
  if (!area) return nothing('I could not find what you were pointing at.');
  if (area.nodes.size === 0) return nothing('There is nothing in the mindstorm yet.');

  const user = [
    `Request: ${oneLine(request, 1000)}`,
    area.everything
      ? 'The request is about every tree. Only whole-tree operations are allowed: rename a tree, delete a tree, mergeTree, newTree and dropPicks.'
      : '',
    'Outline:',
    outline(ctx, area),
  ]
    .filter(Boolean)
    .join('\n\n');

  let reply: z.infer<typeof OrganizerReply>;
  try {
    reply = await ctx.model.json({ role: ROLE, system: SYSTEM, user, schema: OrganizerReply, effort: 'medium' });
  } catch (err) {
    ctx.note(ROLE, `the model failed, so nothing was changed: ${err instanceof Error ? err.message : String(err)}`);
    return nothing('I could not work out how to do that.');
  }

  if (reply.operations.length > MAX_OPERATIONS) {
    ctx.note(ROLE, `the model returned ${reply.operations.length} operations, and only the first ${MAX_OPERATIONS} were read`);
  }
  const plan = new Plan(ctx, area.nodes, area.everything);
  const skipped: string[] = [];
  for (const op of reply.operations.slice(0, MAX_OPERATIONS)) {
    const why = plan.run(op);
    if (why) {
      skipped.push(why);
      ctx.note(ROLE, `skipped ${op.op}: ${why}`);
    }
  }
  for (const note of plan.notes) ctx.note(ROLE, note);

  if (plan.commands.length === 0) {
    if (skipped.length > 0) return nothing(`I could not do it safely: ${skipped[0]}.`);
    return nothing(reply.summary.trim());
  }
  const left = skipped.length === 0 ? '' : skipped.length === 1 ? ' I left out one step that did not fit.' : ` I left out ${skipped.length} steps that did not fit.`;
  return { commands: plan.commands, summary: `${reply.summary.trim() || 'Done.'}${left}` };
};
