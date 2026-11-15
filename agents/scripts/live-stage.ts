// A stand-in Scout for the live voice's measuring scripts: realistic cards that land over 35 s as a real run's do, with no model.
import type { Command } from '../src/core/domain.ts';
import { AGENT, makeItem, makeNode, pickStatus, type Roles } from '../src/core/roles/types.ts';

/** Cards that land as a Scout run's do: the first at 4 s, three more by 7 s, two by 20 s; the run ends before its picture, as a real run may. */
export const staged: Roles['scout'] = async (ctx, { anchor, need, deliver }) => {
  const node = ctx.mind.node(anchor);
  const topic = need ?? ctx.mind.itemOf(anchor).title;
  const cards: { at: number; title: string; kind: 'text' | 'image'; by?: string; date?: string; from: string; summary: string; why: string; tool: string }[] = [
    { at: 4000, title: 'Still Life with Flowers in a Wan-Li Vase', kind: 'image', by: 'Ambrosius Bosschaert the Elder', date: '1609-1610', from: 'Rijksmuseum', summary: 'Tulips, roses and irises that flower in different months, painted together from separate studies.', why: `A bouquet that could never have existed, for ${topic}`, tool: 'museums' },
    { at: 6000, title: 'Vermeer and the Camera Obscura', kind: 'text', by: 'Philip Steadman', date: '2001', from: 'Research papers', summary: 'Argues from the rooms Vermeer painted that he worked with a camera obscura.', why: 'The optics question behind the light', tool: 'papers' },
    { at: 6500, title: 'Tim\'s Vermeer', kind: 'image', by: 'Teller', date: '2013', from: 'The Movie Database', summary: 'An inventor spends five years trying to repaint The Music Lesson with a mirror device.', why: 'A film that tests the camera obscura idea', tool: 'films' },
    { at: 7000, title: 'The Milkmaid', kind: 'image', by: 'Johannes Vermeer', date: 'about 1660', from: 'Rijksmuseum', summary: 'A kitchen maid pours milk by a window; the bread glints with dots of light.', why: 'Light falling from a left window', tool: 'museums' },
    { at: 19000, title: 'Glaze layers in Dutch painting', kind: 'text', from: 'idea', summary: 'Try building a colour from three thin transparent layers instead of one thick one.', why: 'A way to try the light yourself', tool: 'idea' },
    { at: 20500, title: 'Delft in the 1650s', kind: 'text', by: 'Rijksmuseum Research', date: '2020', from: 'Research papers', summary: 'A short history of the town where Vermeer lived and worked.', why: 'Where the light was', tool: 'papers' },
    { at: 34000, title: 'Morning light through leaded glass', kind: 'image', from: 'image-gen', summary: 'A made picture of a Dutch interior at dawn.', why: 'A picture made for this card', tool: 'image-gen' },
  ];
  const t0 = Date.now();
  for (const c of cards) {
    // A picture made last lands after the run is over, so the run ends without it.
    if (c.at > 30000) break;
    await new Promise((r) => setTimeout(r, Math.max(0, c.at - (Date.now() - t0))));
    const item = makeItem(ctx, { kind: c.kind, title: c.title, summary: c.summary, text: c.summary, data: { ...(c.by ? { by: c.by } : {}), ...(c.date ? { date: c.date } : {}), from: c.from }, origin: AGENT('scout', c.tool), source: { from: c.tool === 'idea' ? 'idea' : 'web' } });
    const commands: Command[] = [
      { type: 'addItem', item },
      { type: 'addNode', node: makeNode(ctx, item, { treeId: node.treeId, parent: anchor, status: pickStatus(ctx), why: c.why, importance: 0.7, origin: item.origin }) },
    ];
    deliver?.(commands);
  }
  return [];
};

