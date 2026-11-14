import type { Command, Item } from '../core/domain.ts';
import type { Found } from '../core/ports.ts';
import { codeIn } from '../core/roles/intake/code.ts';
import { structure } from '../core/roles/intake/describe.ts';
import { byRule, drawn, unsure } from '../core/roles/renderer.ts';
import { catalogued } from '../core/roles/scout.ts';
import { AGENT, makeItem, makeNode, pickStatus, type RoleContext, type Roles } from '../core/roles/types.ts';
import { choose, describe } from './model.ts';

const WORK: Found = {
  kind: 'artwork', title: 'Stairwell, seen from above', by: 'Ilse Brandt', date: '1928', text: 'Gelatin silver print',
  medium: 'Gelatin silver print', holder: 'The Example Museum of Art', from: 'The Example Museum of Art', url: 'https://museum.example/works/1928-14',
};
const PAPER: Found = {
  kind: 'paper', title: 'Perceived depth under opposed zoom and camera motion', by: 'M. Okafor et al.', date: '2011',
  text: 'Viewers judged the room to stretch by half when the lens zoomed in as the camera pulled back.',
  authors: ['M. Okafor', 'L. Haas', 'R. Itō'], venue: 'Journal of Example Vision', url: 'https://doi.example/10.1000/zoom.2011',
};
const STAIRS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="320" height="240" fill="#1d1b1a"/>${Array.from({ length: 9 }, (_v, n) => `<rect x="${40 + n * 14}" y="${20 + n * 12}" width="${240 - n * 28}" height="${200 - n * 24}" fill="none" stroke="#d8cfc0" stroke-opacity="${1 - n * 0.09}" stroke-width="3" transform="rotate(${n * 7} 160 120)"/>`).join('')}</svg>`;

/** One pick made from a source record the way the Scout makes it, with a stored picture when the record is a work to look at. */
async function found(ctx: RoleContext, record: Found, source: { id: string; name: string }): Promise<Item> {
  const picture = record.kind === 'artwork' ? await ctx.assets.put(new TextEncoder().encode(STAIRS), 'image/svg+xml', 'stairwell.svg') : null;
  const from = record.from ?? source.name;
  return makeItem(ctx, {
    kind: picture ? 'image' : 'text', title: record.title, text: `${record.text}\n\n${record.by}, ${record.date}, ${from}`, summary: record.text, tags: [record.kind ?? 'find'],
    data: { site: new URL(record.url).hostname, by: record.by, date: record.date, from, ...catalogued(record) },
    origin: AGENT('scout', source.id), source: { from: 'web', url: record.url, ...(picture ? { asset: picture.id } : {}) },
  });
}

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
        const title = d.name ?? 'Dropped file';
        // The real rules caption a picture with its summary, so the summary names the file as a description would.
        return makeItem(ctx, { kind, title, summary: `${title}, a ${kind} you dropped in.`, tags: [kind], origin: { by: 'user' }, source: { from: 'drop', asset: d.asset } });
      }
      const first = d.text.split('\n')[0]!.slice(0, 60);
      return makeItem(ctx, { kind: 'text', title: first, text: d.text, summary: d.text.slice(0, 160), data: { ...structure(describe(d.text), d.text), ...(codeIn(d.text) ? { code: codeIn(d.text) } : {}) }, tags: first.toLowerCase().split(/\W+/).filter((w) => w.length > 4).slice(0, 3), origin: { by: 'user' }, source: { from: 'paste' } });
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
    // Asked for a museum work or a paper, the fake brings one as its first pick, so a card that draws a source's own record can be seen offline.
    const asked = /\b(museum|artwork|painting)/i.test(need ?? '') ? await found(ctx, WORK, { id: 'museums', name: 'Museum collections' }) : /\b(paper|study|research)/i.test(need ?? '') ? await found(ctx, PAPER, { id: 'papers', name: 'Research papers' }) : null;
    const drafts: Item[] = [
      asked ?? makeItem(ctx, { kind: 'link', title: `An essay on ${topic}`, summary: 'A long read that argues the idea from first principles.', tags: ['essay'], origin: AGENT('scout', 'web'), source: { from: 'web', url: `https://example.com/essay-${n}` } }),
      makeItem(ctx, { kind: 'text', title: '7 in 10 notice it without naming it', text: 'In a small survey, 7 in 10 viewers noticed the effect without being able to name it.', summary: 'A survey figure.', tags: ['data'], data: { facts: [{ label: 'viewers who notice it', value: '70%' }] }, origin: AGENT('scout', 'web'), source: { from: 'web', url: `https://example.com/survey-${n}` } }),
      makeItem(ctx, { kind: 'text', title: 'How to try it', summary: 'Three steps.', tags: ['how-to'], data: { steps: ['Pick a subject', 'Move away while zooming in', 'Keep the subject the same size'] }, origin: AGENT('scout', 'web'), source: { from: 'web', url: `https://example.com/howto-${n}` } }),
      makeItem(ctx, { kind: 'text', title: 'Where it turns up', summary: 'How often each genre uses it.', tags: ['history'], data: { chart: { labels: ['Horror', 'Thriller', 'Drama', 'Comedy'], values: [14, 11, 9, 3], unit: 'films' } }, origin: AGENT('scout', 'web'), source: { from: 'web', url: `https://example.com/chart-${n}` } }),
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
    const assetUrl = (id: string) => ctx.assets.url(id);
    return nodeIds.flatMap((id): Command[] => {
      const node = ctx.mind.nodes.get(id);
      const item = node && ctx.mind.items.get(node.itemId);
      if (!node || !item) return [];
      const ruled = byRule(item, assetUrl);
      // Where the real Renderer would ask the model, the fake's own choice goes through the same checks.
      const draw = (unsure(item, ruled) && drawn(ctx, { id, ...choose(item.text, ruled.component === 'idea' ? 'idea' : 'note') }, item)) || ruled;
      const same = draw.component === node.view.component && JSON.stringify(draw.props) === JSON.stringify(node.view.props);
      return same ? [] : [{ type: 'setView', id, view: { ...draw, by: 'renderer' } }];
    });
  },

  async packager(ctx, { scope, note }) {
    const trees = (scope.treeIds.length ? scope.treeIds : [...ctx.mind.trees.keys()]).map((id) => ctx.mind.tree(id));
    const lines = trees.flatMap((t) => [`## ${t.title}`, ...ctx.mind.treeNodes(t.id).map((n) => `${'  '.repeat(ctx.mind.depth(n.id))}- ${ctx.mind.item(n.itemId).title}`)]);
    return { name: `handoff-${ctx.now().slice(0, 10)}`, markdown: `# Handoff\n\n${note ?? ''}\n\n${lines.join('\n')}\n`, json: { format: 'mind-palace-handoff', version: 1, trees: trees.map((t) => t.title) }, assets: [] };
  },
};
