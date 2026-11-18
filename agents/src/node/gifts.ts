/**
 * Trees a friend shared with this person, held in their space until they next put the headset on, then grown as their own tree
 * (`core/growing.ts`) with Momo's recorded line for it. Kept in the space's folder, so a restart of the service keeps them.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Command, Id, Origin } from '../core/domain.ts';
import { grow, growsOnReturn, PUT_ON_AWAY, type Held, type Planting } from '../core/growing.ts';

/** A shared tree held here: the code it was shared under, which tells the sharer once it grows, and what it grows into. */
export interface Gift extends Held {
  code: string;
  title: string;
  planting: Planting & { treeId: Id };
}

export interface GiftPace {
  /** From the first card to the last layer. */
  grow: number;
  /** From the headset's return to the first card. */
  after: number;
  /** The longest wait for the headset to say the tree stands. */
  stand: number;
  /** The shortest time off that counts as the headset taken off and put on again. */
  wornAway: number;
}

export const GIFT_PACE: GiftPace = { grow: 5000, after: 2000, stand: 9000, wornAway: PUT_ON_AWAY };

/** The first card, as the headset's own tree, so it stands there; then the layers, as an agent's cards come: no undo takes them. */
const ORIGINS: { first: Origin; layers: Origin } = { first: { by: 'user', role: 'shared' }, layers: { by: 'agent', role: 'shared' } };

export interface GiftDeps {
  file: string;
  pace?: Partial<GiftPace>;
  /** Applies commands as the headset's own work. */
  stage(origin: Origin, label: string, commands: Command[]): void;
  /** Whether a headset is joined to grow it on. */
  watched(): boolean;
  /** Whether the tree is in the forest already, as one half grown when the service stopped. */
  planted(treeId: Id): boolean;
  /** Momo says the shared tree's line from its recording, and how long it lasts in ms; 0 when she cannot be heard. */
  speak(): number;
  /** The tree grew: its sharer is told. */
  grew(gift: Gift): void;
  log(line: string): void;
}

export class Gifts {
  private held: Gift[] = [];
  private readonly pace: GiftPace;
  /** The tree growing now, and until when Momo is told nothing of what lands. */
  private busyUntil = 0;
  private stands = new Map<Id, () => void>();

  constructor(private readonly deps: GiftDeps) {
    this.pace = { ...GIFT_PACE, ...deps.pace };
    if (existsSync(deps.file)) this.held = (JSON.parse(readFileSync(deps.file, 'utf8')) as Gift[]).filter((gift) => !deps.planted(gift.planting.treeId));
  }

  /** Holds a shared tree here, to grow at the headset's next return. */
  hold(gift: Omit<Gift, keyof Held>): void {
    this.held.push({ ...gift, ready: true, grown: false, auto: false });
    this.keep();
    this.deps.log(`[shared] "${gift.title}" is held to grow when the headset is next put on`);
  }

  /** Trees held here now. */
  get waiting(): number {
    return this.held.length;
  }

  /** Whether a tree is growing, or Momo's line for it is still being said: she is told nothing of the cards meanwhile. */
  growing(): boolean {
    return Date.now() < this.busyUntil;
  }

  /** The headset said a card is open: a tree it stood says so by its first card. */
  focused(nodeId: Id): void {
    this.stands.get(nodeId)?.();
  }

  /**
   * A headset joined (`away` undefined), or was put on again after `away` seconds off: the oldest held tree grows a moment later.
   * One grows each time; the next waits for the next return. True when one does.
   */
  returned(away?: number): boolean {
    const gift = this.held[0];
    if (!gift || this.growing() || !growsOnReturn(gift, away, this.pace.wornAway)) return false;
    gift.auto = true;
    this.deps.log(`[shared] the headset is on: "${gift.title}" grows in ${this.pace.after / 1000} s`);
    this.busyUntil = Number.POSITIVE_INFINITY;
    setTimeout(() => void this.grow(gift).catch((err) => this.deps.log(`[shared] "${gift.title}" did not grow: ${err instanceof Error ? err.message : String(err)}`)), this.pace.after);
    return true;
  }

  private async grow(gift: Gift): Promise<void> {
    // Taken from those held before it grows: a service stopped while it grew leaves it half grown, never planted twice.
    this.held = this.held.filter((g) => g !== gift);
    this.keep();
    let said = Date.now();
    let spoken = 0;
    try {
      if (this.deps.planted(gift.planting.treeId)) return;
      await grow(gift.planting, ORIGINS, this.pace.grow, {
        stage: (origin, label, commands) => this.deps.stage(origin, `Shared: ${label}`, commands),
        stands: (rootId) => (this.deps.watched() ? this.until(rootId) : null),
        speak: () => {
          said = Date.now();
          spoken = this.deps.speak();
        },
        going: () => true,
        pause: (ms) => new Promise((done) => setTimeout(done, ms)),
        log: (line) => this.deps.log(`[shared] ${line}`),
      });
      gift.grown = true;
      this.deps.log(`[shared] "${gift.title}" grew: ${gift.planting.layers.length} layers`);
      this.deps.grew(gift);
    } finally {
      this.busyUntil = Math.max(Date.now(), said + spoken) + 500;
    }
  }

  private until(rootId: Id): Promise<boolean> {
    return new Promise((done) => {
      const timer = setTimeout(() => (this.stands.delete(rootId), done(false)), this.pace.stand);
      this.stands.set(rootId, () => (clearTimeout(timer), this.stands.delete(rootId), done(true)));
    });
  }

  private keep(): void {
    writeFileSync(`${this.deps.file}.tmp`, JSON.stringify(this.held));
    renameSync(`${this.deps.file}.tmp`, this.deps.file);
  }
}
