import { SENT_MS } from './wake.js';

/** A turn waits this long for its reply before it stops thinking, as the service does. */
const LONGEST_THINKING_MS = 15000;
/** After the Conductor's run ends, how long a reply has to begin arriving before none is expected. */
const NO_REPLY_MS = 1000;

/**
 * Where the user's turn with the agent stands, as the page shows and plays it (docs/protocol.md, the end of "The live voice"):
 * waiting for the name, listening to the user, sent as their turn ends (the tone), thinking until the reply is heard (the loop),
 * responding while the agent is heard, working while a step it started goes on, then waiting again.
 * The Conductor's run is the agent deciding what to say, so it is part of thinking and is not work.
 * `onState(state, from)` is called on every change, and again while working when the latest step changes.
 */
export class Turn {
  constructor(onState) {
    this.onState = onState;
    /** 'waiting' | 'listening' | 'sent' | 'thinking' | 'responding' | 'working' */
    this.state = 'waiting';
    /** The steps that have started and not ended, by activity id: what each is doing. */
    this.steps = new Map();
    /** The turn was typed or picked, so the work starting ends its thinking, as a reply that may never come would not. */
    this.typed = false;
    /** A reply has arrived for this turn and is about to be heard. */
    this.answered = false;
    this.phase = null;
    this.noReply = null;
  }

  /** What the latest step still going is doing, or null. */
  get step() {
    return [...this.steps.values()].at(-1) ?? null;
  }

  get pending() {
    return this.state === 'sent' || this.state === 'thinking';
  }

  /** The name was heard: the user has the floor, whatever was going on. */
  listen() {
    this.set('listening');
  }

  /** The user's turn is over and on its way: spoken (`typed` false), or a question typed or picked. */
  over(typed = false) {
    if (this.state === 'sent') return;
    this.typed = typed;
    this.answered = false;
    this.set('sent');
  }

  /** Nothing was said, no reply is coming, or the voice failed. */
  quiet() {
    if (this.state === 'listening' || this.pending) this.rest();
  }

  /** The agent started or stopped being heard. */
  speaking(on) {
    if (on && this.state !== 'listening') this.set('responding');
    else if (!on && this.state === 'responding') this.rest();
  }

  /** A line of the agent's arrived. `silent`: it will not be heard here (muted, with no live voice), so the reply is over as it comes. */
  said(silent) {
    if (!this.pending) return;
    this.answered = true;
    clearTimeout(this.noReply);
    if (silent) this.rest();
  }

  /** A step of the agent's work started or ended. */
  activity({ id, role, state, message, label }) {
    if (role === 'conductor') {
      if (state !== 'start' && this.pending && !this.answered) {
        clearTimeout(this.noReply);
        this.noReply = setTimeout(() => this.pending && !this.answered && this.rest(), NO_REPLY_MS);
      }
      return;
    }
    if (state === 'start') this.steps.set(id, label || message);
    else this.steps.delete(id);
    if (state === 'start' && this.typed && this.pending) this.set('working');
    else if (this.state === 'waiting' || this.state === 'working') this.rest();
  }

  /** The connection was lost: work that was running will never report back. */
  reset() {
    this.steps.clear();
    if (this.state !== 'listening') this.set('waiting');
  }

  rest() {
    this.set(this.steps.size > 0 ? 'working' : 'waiting');
  }

  set(state) {
    const from = this.state;
    if (state === from && state !== 'working') return;
    clearTimeout(this.phase);
    if (state !== 'sent' && state !== 'thinking') clearTimeout(this.noReply);
    this.state = state;
    if (state === 'sent') this.phase = setTimeout(() => this.set('thinking'), SENT_MS);
    if (state === 'thinking') this.phase = setTimeout(() => this.rest(), LONGEST_THINKING_MS);
    this.onState(state, from);
  }
}
