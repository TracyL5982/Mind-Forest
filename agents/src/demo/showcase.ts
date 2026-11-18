import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Item } from '../core/domain.ts';
import { withShortTitle } from '../core/roles/types.ts';
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

/**
 * A card as every judge's space shows it (`scripts/starter.ts`). The showcase trees' pins are the user's own, and in the demo they
 * read so: "Pinterest, your Graph board". In the starter every judge begins with they are no judge's, so they read as Pinterest pins
 * (the user's call, 2026-11-18): the source "Pinterest", the credit "Pinterest pin", and the line under the card's words the same.
 */
export function forJudges(item: Item): Item {
  return ownForJudges(pinForJudges(item));
}

function pinForJudges(item: Item): Item {
  const from = typeof item.data.from === 'string' ? item.data.from : '';
  const credit = (item.data.credit as { text?: string } | undefined)?.text ?? '';
  const yours = /^Pinterest, your\b/i.test(from) || /^Your pin\b/i.test(credit);
  if (!yours) return item;
  // The line under the words names the source last, after the maker and the date where the card has them: "Pylinsky, Pinterest, your Graph board".
  const lines = item.text.split('\n').map((line) => (line && (line === from || line === credit) ? 'Pinterest pin' : from && line.endsWith(`, ${from}`) ? `${line.slice(0, -from.length)}Pinterest` : line));
  const kept = lines.filter((line, n) => line !== 'Pinterest pin' || lines.indexOf(line) === n);
  while (kept.length > 1 && kept.at(-1) === '') kept.pop();
  return { ...item, text: kept.join('\n'), data: { ...item.data, from: 'Pinterest', credit: { text: 'Pinterest pin', ...(item.source.url ? { url: item.source.url } : {}) } } };
}

/** The walkthrough's own things, as its credits name them for the film's user, and as they read to a judge (WS102). */
const OWN_CREDITS: [RegExp, string][] = [
  // The flower tree's photo, as the user put it for the judges (WS102).
  [/^Your photo · sent to Momo on Telegram$/, 'Photo · Tracy sent to Momo on Telegram'],
  [/^Your picture\b/, 'Saved picture'],
  [/^Your photo\b/, 'Photo'],
  [/^Your note$/, 'Note'],
  [/^Your prototype\b/, 'Prototype'],
];

/**
 * The walkthrough tree's own cards for a judge: a credit that says "Your picture", "Your photo", "Your note" or "Your prototype"
 * says what it is without "your"; a title that begins "Your" begins "A"; a note whose words are only "Your own note" is "A note";
 * and a link to the film's user's own Claude page goes, since it is theirs alone.
 */
function ownForJudges(item: Item): Item {
  const credit = (item.data.credit as { text?: string; url?: string } | undefined) ?? undefined;
  const rule = credit?.text ? OWN_CREDITS.find(([re]) => re.test(credit.text!)) : undefined;
  const theirs = [item.source.url, credit?.url].some((url) => url && /^https:\/\/claude\.ai\//.test(url));
  const title = /^Your /.test(item.title) ? item.title.replace(/^Your /, 'A ') : item.title;
  const own = (line: string) => (line === 'Your own note' ? 'A note' : line);
  if (!rule && !theirs && title === item.title && !item.text.split('\n').some((line) => own(line) !== line)) return item;
  const after = rule ? credit!.text!.replace(rule[0], rule[1]) : credit?.text;
  let lines = item.text.split('\n').map((line) => (rule && line === credit!.text ? after! : own(line)));
  const data: Item['data'] = { ...item.data };
  const source = { ...item.source };
  if (theirs) {
    lines = lines.filter((line) => line !== credit?.text);
    delete data.credit;
    delete data.site;
    if (data.from === 'claude.ai') delete data.from;
    delete source.url;
  } else if (rule) {
    data.credit = { ...credit, text: after };
  }
  return { ...item, title, text: lines.join('\n'), summary: own(item.summary), source, data: withShortTitle(data, title) };
}

/** The words on a walkthrough card's thread that speak to the film's user, as they read to a judge. */
const OWN_WHYS: Record<string, string> = {
  'where your own ideas are sorted now': 'where the ideas are sorted now',
  'your own note on layers': 'a note on layers',
};

export function whyForJudges(why: string): string {
  return OWN_WHYS[why] ?? why;
}

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
  return layersOf(tree).flat();
}

/** A tree's cards a layer at a time: those under its first card, then those under them, and so on, each in its file's order. */
export function layersOf(tree: ShowTree): ShowCard[][] {
  const out: ShowCard[][] = [];
  let layer = tree.cards.filter((card) => card.parent === 'root');
  while (layer.length > 0) {
    out.push(layer);
    const ids = new Set(layer.map((card) => card.id));
    layer = tree.cards.filter((card) => ids.has(card.parent));
  }
  return out;
}
