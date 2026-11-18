/**
 * A tree that grows on a headset with a line from Momo, as the demo's daily tree does and a tree shared with the user does. It is
 * held back until the headset is next put on, then planted as the headset's own work, so it stands in front of the user and not
 * on the desk, and its cards come a layer at a time. Nothing here knows where the tree came from: a demo's showcase file, or (to
 * come) a copy of a tree a friend shared, made in this person's forest.
 */
import type { Command, Id, Origin } from './domain.ts';

/** A tree as it grows: its first card with the tree, then each layer of its cards, in the order they come. */
export interface Planting {
  title: string;
  rootId: Id;
  first: Command[];
  layers: Command[][];
}

/** What a growing does on the service it runs on. */
export interface Grower {
  /** Applies commands as the headset's own work: the change is marked `yours` to it, so a new tree stands there. */
  stage(origin: Origin, label: string, commands: Command[]): void;
  /**
   * Resolves once the headset says the tree stands (it focuses the tree's first card), true, or false after a while. Null where
   * no headset is joined, and nothing is waited for.
   */
  stands(rootId: Id): Promise<boolean> | null;
  /** Momo says the tree's line, from now. */
  speak(): void;
  /** False once the growing should stop where it is, as when the tree is held back again. */
  going(): boolean;
  pause(ms: number): Promise<void>;
  log(line: string): void;
}

/**
 * Grows a tree: its first card as the headset's own tree, then, once the headset says it stands, Momo's line and the layers over
 * `ms`. A headset puts the standing tree away before it stands a new one, and a card that lands on a tree that is not standing is
 * simply there when it does: so the layers wait for it. The layers come as `layers` says, which for an agent's origin is one card
 * after another with a note each.
 */
export async function grow(planting: Planting, origins: { first: Origin; layers: Origin }, ms: number, grower: Grower): Promise<void> {
  const { title, rootId, first, layers } = planting;
  const stood = grower.stands(rootId);
  grower.stage(origins.first, `"${title}" grows`, first);
  if (stood && !(await stood)) grower.log(`"${title}" was not seen to stand in time: it grows anyway`);
  if (!grower.going()) return;
  grower.speak();
  for (const [n, layer] of layers.entries()) {
    await grower.pause(ms / layers.length);
    if (!grower.going()) return;
    grower.stage(origins.layers, `"${title}" grows, layer ${n + 1} of ${layers.length}`, layer);
  }
}

/** A tree held back to grow when the headset is next put on: whether it may grow yet, whether it grew, and whether a return started it. */
export interface Held {
  ready: boolean;
  grown: boolean;
  /** A headset's return started it already: it grows once for each time it is held back. */
  auto: boolean;
}

/** The shortest time off, in ms, that counts as the headset taken off and put on again: its menu leaves the app for a moment too. */
export const PUT_ON_AWAY = 5000;

/**
 * Whether a held tree grows now that a headset returned: joined (`away` undefined), or put on again after `away` seconds off while
 * it stayed joined, which counts only from `least` ms off.
 */
export function growsOnReturn(held: Held | null, away?: number, least = PUT_ON_AWAY): boolean {
  if (!held?.ready || held.grown || held.auto) return false;
  return away === undefined || away * 1000 >= least;
}
