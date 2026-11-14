import type { Command, Item } from '../core/domain.ts';
import { AGENT, makeItem, makeNode, pickStatus, type Roles } from '../core/roles/types.ts';

/**
 * Stand-in roles with no model behind them, for building and testing clients offline.
 * They return plausible content of every kind so each component and composite gets drawn.
 */
export const fakeRoles: Roles = {
  async conductor(_ctx, { utterance, scene }) {
    const anchor = scene.selection[0] ?? scene.focus;
    const text = utterance.toLowerCase();
    if (/^undo\b/.test(text)) return { intent: { kind: 'undo' }, say: 'Undone.' };
    if (!anchor) return { intent: { kind: 'capture', text: utterance }, say: 'Noted.' };
    if (/\bmore\b/.test(text)) return { intent: { kind: 'more', anchor }, say: 'Here is more.' };
    if (/\b(clean|organi[sz]e|move|delete|rename)\b/.test(text)) {
      return { intent: { kind: 'organize', request: utterance, scope: { treeIds: [], nodeIds: scene.selection }, }, say: 'On it.' };
    }
    if (/\b(package|export|hand ?off)\b/.test(text)) {
      return { intent: { kind: 'handoff', scope: { treeIds: scene.treeId ? [scene.treeId] : [], nodeIds: [] }, note: utterance }, say: 'Packaging it.' };
    }
    return { intent: { kind: 'ask', anchor, need: utterance }, say: 'Looking into that.' };
  },

  async intake(ctx, dumps) {
    return dumps.map((d): Item => {
      if (d.kind === 'link') {
        return makeItem(ctx, { kind: 'link', title: d.url.replace(/^https?:\/\//, '').slice(0, 60), summary: 'A page you dropped in.', tags: ['link'], origin: { by: 'user' }, source: { from: 'link', url: d.url } });
      }
      if (d.kind === 'asset') {
        const kind = d.mime.startsWith('image/') ? 'image' : d.mime.startsWith('video/') ? 'video' : 'file';
        return makeItem(ctx, { kind, title: d.name ?? 'Dropped file', summary: `A ${kind} you dropped in.`, tags: [kind], origin: { by: 'user' }, source: { from: 'drop', asset: d.asset } });
      }
      const first = d.text.split('\n')[0]!.slice(0, 60);
      return makeItem(ctx, { kind: 'text', title: first, text: d.text, summary: d.text.slice(0, 160), tags: first.toLowerCase().split(/\W+/).filter((w) => w.length > 4).slice(0, 3), origin: { by: 'user' }, source: { from: 'paste' } });
    });
  },

  async filer(ctx, items) {
    const commands: Command[] = [];
    for (const item of items) {
      const hit = ctx.mind.search(`${item.title} ${item.tags.join(' ')}`, { limit: 1 })[0];
      const home = hit && hit.coverage >= 0.5 ? ctx.mind.nodesOfItem(hit.id)[0] : undefined;
      if (home) {
        commands.push({ type: 'addNode', node: makeNode(ctx, item, { treeId: home.treeId, parent: home.id, status: 'kept', why: 'Same topic', origin: item.origin }) });
      } else {
        const treeId = ctx.newId();
        const root = makeNode(ctx, item, { treeId, parent: null, status: 'kept', why: '', origin: item.origin });
        commands.push({ type: 'createTree', tree: { id: treeId, title: item.title.slice(0, 40), rootId: root.id, digest: item.summary, createdAt: ctx.now() }, root });
      }
    }
    return commands;
  },

  async scout(ctx, { anchor, need, mode }) {
    await new Promise((r) => setTimeout(r, 900));
    const node = ctx.mind.node(anchor);
    const topic = need ?? ctx.mind.itemOf(anchor).title;
    const n = ctx.mind.children(anchor).length;
    const drafts: Item[] = [
      makeItem(ctx, { kind: 'link', title: `An essay on ${topic}`, summary: 'A long read that argues the idea from first principles.', tags: ['essay'], origin: AGENT('scout', 'web'), source: { from: 'web', url: `https://example.com/essay-${n}` } }),
      makeItem(ctx, { kind: 'text', title: '7 in 10 notice it without naming it', text: 'In a small survey, 7 in 10 viewers noticed the effect without being able to name it.', summary: 'A survey figure.', tags: ['data'], data: { facts: [{ label: 'viewers who notice it', value: '70%' }] }, origin: AGENT('scout', 'web'), source: { from: 'web', url: `https://example.com/survey-${n}` } }),
      makeItem(ctx, { kind: 'text', title: 'How to try it', summary: 'Three steps.', tags: ['how-to'], data: { steps: ['Pick a subject', 'Move away while zooming in', 'Keep the subject the same size'] }, origin: AGENT('scout', 'web'), source: { from: 'web', url: `https://example.com/howto-${n}` } }),
      makeItem(ctx, { kind: 'text', title: 'Use over the decades', summary: 'How often it appears.', tags: ['history'], data: { chart: { labels: ['1960s', '1980s', '2000s', '2020s'], values: [3, 9, 14, 11], unit: 'films' } }, origin: AGENT('scout', 'web'), source: { from: 'web', url: `https://example.com/chart-${n}` } }),
    ];
    const commands: Command[] = mode === 'refresh' ? ctx.mind.picks(anchor).map((p) => ({ type: 'deleteNode', id: p.id })) : [];
    drafts.slice(0, ctx.settings.picksPerRun).forEach((item, i) => {
      commands.push({ type: 'addItem', item });
      commands.push({ type: 'addNode', node: makeNode(ctx, item, { treeId: node.treeId, parent: anchor, status: pickStatus(ctx), why: ['Background', 'Evidence', 'Try it', 'History'][i]!, importance: 0.8 - i * 0.15, origin: item.origin, offset: i }) });
    });
    return commands;
  },

  async organizer(ctx, { scope }) {
    const commands: Command[] = [];
    for (const id of scope.nodeIds) for (const p of ctx.mind.picks(id)) commands.push({ type: 'deleteNode', id: p.id });
    return { commands, summary: commands.length ? `Dropped ${commands.length} unkept picks.` : 'Nothing needed tidying.' };
  },

  async renderer(ctx, { nodeIds }) {
    const commands: Command[] = [];
    for (const id of nodeIds) {
      const item = ctx.mind.itemOf(id);
      const d = item.data as { facts?: { label: string; value: string }[]; steps?: string[]; chart?: { labels: string[]; values: number[]; unit?: string } };
      if (d.facts?.[0]) commands.push({ type: 'setView', id, view: { component: 'fact', props: d.facts[0], by: 'renderer' } });
      else if (d.steps) commands.push({ type: 'setView', id, view: { component: 'steps', props: { steps: d.steps }, by: 'renderer' } });
      else if (d.chart) commands.push({ type: 'setView', id, view: { component: 'chart', props: { chart: 'bar', ...d.chart }, by: 'renderer' } });
    }
    return commands;
  },

  async packager(ctx, { scope, note }) {
    const trees = (scope.treeIds.length ? scope.treeIds : [...ctx.mind.trees.keys()]).map((id) => ctx.mind.tree(id));
    const lines = trees.flatMap((t) => [`## ${t.title}`, ...ctx.mind.treeNodes(t.id).map((n) => `${'  '.repeat(ctx.mind.depth(n.id))}- ${ctx.mind.item(n.itemId).title}`)]);
    return { name: `handoff-${ctx.now().slice(0, 10)}`, markdown: `# Handoff\n\n${note ?? ''}\n\n${lines.join('\n')}\n`, json: { format: 'mind-palace-handoff', version: 1, trees: trees.map((t) => t.title) }, assets: [] };
  },
};
