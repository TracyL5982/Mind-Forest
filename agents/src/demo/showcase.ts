import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ScriptCard } from './script.ts';

/**
 * The showcase trees: whole trees that stand in the demo's forest beside the walkthrough's, so the space looks lived in. Each is
 * a folder of `agents/demo/showcase` with a `tree.json` and its pictures in `media`. They are not played round by round: they are
 * planted complete, their cards kept, and are opened and asked on like any tree the user has. `check.py` beside them checks one
 * as it is written.
 */

/** A card of a showcase tree: a card as the script writes one, with the card it hangs from, `root` for the tree's first. */
export const ShowCard = ScriptCard.extend({ parent: z.string().min(1) });
export type ShowCard = z.infer<typeof ShowCard>;

export const ShowTree = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    /** The tree's name. */
    title: z.string().min(1),
    /** The words of the tree's first card. */
    topic: z.string().min(1),
    cards: z.array(ShowCard).min(1),
  })
  .superRefine((tree, ctx) => {
    const byId = new Map<string, ShowCard>();
    const titles = new Set<string>();
    for (const card of tree.cards) {
      if (byId.has(card.id)) ctx.addIssue({ code: 'custom', message: `two cards are called ${card.id}` });
      byId.set(card.id, card);
      // A tree keeps one of two cards with one title, so the second would never hang.
      if (titles.has(card.title.toLowerCase())) ctx.addIssue({ code: 'custom', message: `two cards have the title "${card.title}"` });
      titles.add(card.title.toLowerCase());
    }
    for (const card of tree.cards) {
      const seen = new Set<string>([card.id]);
      for (let at = card.parent; at !== 'root'; at = byId.get(at)!.parent) {
        if (!byId.has(at)) {
          ctx.addIssue({ code: 'custom', message: `the card ${card.id} hangs from "${at}", which is no card of the tree` });
          break;
        }
        if (seen.has(at)) {
          ctx.addIssue({ code: 'custom', message: `the card ${card.id} hangs from itself, by way of ${at}` });
          break;
        }
        seen.add(at);
      }
    }
  });
export type ShowTree = z.infer<typeof ShowTree>;

export interface Showcase {
  tree: ShowTree;
  /** The folder its pictures are in. */
  mediaDir: string;
  /** The file as it was read, so a tree that changed is planted again and its older self taken down. */
  text: string;
}

/**
 * Every tree of the folder that holds together, by name, and what is wrong with the others: a tree that does not is left out and
 * said, since the walkthrough should start whatever state a showcase tree is in.
 */
export function loadShowcase(dir: string): { trees: Showcase[]; problems: string[] } {
  const trees: Showcase[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) return { trees, problems };
  for (const name of readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const file = join(dir, name, 'tree.json');
    if (!existsSync(file)) continue;
    try {
      const text = readFileSync(file, 'utf8');
      const tree = ShowTree.parse(JSON.parse(text));
      if (tree.id !== name) throw new Error(`its id is ${tree.id}, and its folder is ${name}`);
      trees.push({ tree, mediaDir: join(dir, name, 'media'), text });
    } catch (err) {
      const why = err instanceof z.ZodError ? err.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : err instanceof Error ? err.message : String(err);
      problems.push(`the showcase tree "${name}" is left out: ${why}`);
    }
  }
  return { trees, problems };
}

/** The tree's cards with each card after the one it hangs from, a layer at a time, in the order they are written. */
export function inLayers(tree: ShowTree): ShowCard[] {
  const out: ShowCard[] = [];
  let layer = tree.cards.filter((card) => card.parent === 'root');
  while (layer.length > 0) {
    out.push(...layer);
    const ids = new Set(layer.map((card) => card.id));
    layer = tree.cards.filter((card) => ids.has(card.parent));
  }
  return out;
}
