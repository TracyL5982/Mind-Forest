import type { Intent, Scene } from '../src/core/roles/types.ts';
import type { Mindstorm } from '../src/core/state.ts';

/**
 * The requests Momo's live voice is measured on (scripts/live-bench.ts), each with the way it should be answered, written down
 * before any run. `own` is from what Momo knows, with no tool. The 40 are said on the "Dutch artist" tree of the user's data, with
 * the pick "A Maid Asleep" open. The 30 of `INTENT` each say where they are said, and how they should go typed, through the
 * Conductor (scripts/typed-bench.ts).
 */

/** `ask`: Momo asks one short question and starts nothing. */
export type Way = 'own' | 'ask' | 'web_answer' | 'look_up_mindstorm' | 'find_new' | 'start_tree' | 'more_like_this' | 'keep' | 'undo' | 'go_to' | 'organize' | 'hand_off' | 'save_note';

/** Where the user is as a request is said: a card open (the start of its node id), a tree open with no card (the start of the tree's id), or nothing. */
export type Where = { open: string } | { tree: string } | 'nothing';

export interface Request {
  id: string;
  group: 'knows' | 'web' | 'saved' | 'new' | 'command' | 'small talk' | 'unclear' | 'layer' | 'new tree' | 'nothing open' | 'no card' | 'layer or tree';
  text: string;
  /** The right ways: the first is the expected one, any other is also right. */
  ways: Way[];
  /** Where it is said; the bench's `--scene` card when not given. */
  where?: Where;
  /** Typed through the Conductor: the right kinds, the first expected. `reply` is right only as a question back. */
  typed?: Intent['kind'][];
}

/** The scene a request is said in, or null when what it names is not in the data. */
export function sceneAt(mind: Mindstorm, where: Where): Scene | null {
  if (where === 'nothing') return { selection: [] };
  if ('open' in where) {
    const node = [...mind.nodes.values()].find((n) => n.id.startsWith(where.open));
    return node ? { focus: node.id, treeId: node.treeId, selection: [] } : null;
  }
  const tree = [...mind.trees.values()].find((t) => t.id.startsWith(where.tree));
  return tree ? { treeId: tree.id, selection: [] } : null;
}

export const REQUESTS: Request[] = [
  { id: 'k1', group: 'knows', text: 'Who painted Girl with a Pearl Earring?', ways: ['own'] },
  { id: 'k2', group: 'knows', text: 'Why did Vermeer use so much blue?', ways: ['own'] },
  { id: 'k3', group: 'knows', text: "What's the difference between De Stijl and the Bauhaus?", ways: ['own'] },
  { id: 'k4', group: 'knows', text: 'Can you explain what a camera obscura is?', ways: ['own'] },
  { id: 'k5', group: 'knows', text: "What's a good film about a painter?", ways: ['own'] },
  { id: 'k6', group: 'knows', text: 'Which Mondrian painting should I look at first?', ways: ['own'] },
  { id: 'k7', group: 'knows', text: 'How did Kubrick light the candle scenes in Barry Lyndon?', ways: ['own'] },
  { id: 'k8', group: 'knows', text: 'What does a mixed-initiative interface mean?', ways: ['own'] },
  { id: 'k9', group: 'knows', text: 'Is the Red Blue Chair actually comfortable to sit in?', ways: ['own'] },
  { id: 'k10', group: 'knows', text: 'Tell me something surprising about Rembrandt.', ways: ['own'] },

  { id: 'w1', group: 'web', text: 'Who won the Booker Prize this year?', ways: ['web_answer'] },
  { id: 'w2', group: 'web', text: "What's on at the Rijksmuseum right now?", ways: ['web_answer'] },
  { id: 'w3', group: 'web', text: 'What did NASA launch this month?', ways: ['web_answer'] },
  { id: 'w4', group: 'web', text: 'Is the Mauritshuis open on Mondays?', ways: ['web_answer'] },
  { id: 'w5', group: 'web', text: "What's the latest news about OpenAI?", ways: ['web_answer'] },
  { id: 'w6', group: 'web', text: "What's the weather like in Amsterdam today?", ways: ['web_answer'] },
  { id: 'w7', group: 'web', text: 'When is the next big Vermeer exhibition?', ways: ['web_answer'] },
  { id: 'w8', group: 'web', text: 'How much is a ticket to the Van Gogh Museum?', ways: ['web_answer'] },

  { id: 's1', group: 'saved', text: 'What did I save about Mondrian?', ways: ['look_up_mindstorm'] },
  { id: 's2', group: 'saved', text: 'Do I have anything about Kubrick?', ways: ['look_up_mindstorm'] },
  { id: 's3', group: 'saved', text: 'What was that card about Vermeer painting windows first?', ways: ['look_up_mindstorm'] },
  { id: 's4', group: 'saved', text: 'Have I saved anything about standoffs in films?', ways: ['look_up_mindstorm'] },
  { id: 's5', group: 'saved', text: "Remind me what's in my generative UI tree.", ways: ['look_up_mindstorm'] },
  { id: 's6', group: 'saved', text: 'Did I keep any notes about yellow fields?', ways: ['look_up_mindstorm'] },

  { id: 'n1', group: 'new', text: 'Find me something interesting about Dutch still life painting.', ways: ['find_new'] },
  { id: 'n2', group: 'new', text: "Show me some examples of Vermeer's use of light.", ways: ['find_new'] },
  { id: 'n3', group: 'new', text: 'I need references for chairs that look like paintings.', ways: ['find_new'] },
  { id: 'n4', group: 'new', text: 'Can you dig up some films about forgery in art?', ways: ['find_new'] },
  { id: 'n5', group: 'new', text: 'Bring me some pictures of Delft.', ways: ['find_new'] },
  { id: 'n6', group: 'new', text: "Let's explore how Mondrian influenced fashion.", ways: ['find_new', 'start_tree'] },

  { id: 'c1', group: 'command', text: 'Keep that one.', ways: ['keep'] },
  { id: 'c2', group: 'command', text: 'Undo that.', ways: ['undo'] },
  { id: 'c3', group: 'command', text: 'Go up.', ways: ['go_to'] },
  { id: 'c4', group: 'command', text: "Start a tree on Hitchcock's camera tricks.", ways: ['start_tree'] },
  { id: 'c5', group: 'command', text: 'Hand this off to my coding agent.', ways: ['hand_off'] },
  { id: 'c6', group: 'command', text: 'Show me more like this.', ways: ['more_like_this', 'find_new'] },

  { id: 't1', group: 'small talk', text: "Thanks, that's really helpful!", ways: ['own'] },
  { id: 't2', group: 'small talk', text: "How's your night going?", ways: ['own'] },

  { id: 'u1', group: 'unclear', text: 'Hmm, what about the other one?', ways: ['own'] },
  { id: 'u2', group: 'unclear', text: 'Can you do the thing with the cards?', ways: ['own'] },
];

/** Requests said with a pause inside them, as people think aloud: whether the turn detection waits for the rest. */
export const PAUSED: (Request & { pauseMs: number })[] = [
  { id: 'p1', group: 'new', text: "I'd like to see... | something about old maps.", pauseMs: 900, ways: ['find_new'] },
  { id: 'p2', group: 'new', text: 'Can you find me, um, | pictures of Delft at night?', pauseMs: 700, ways: ['find_new'] },
  { id: 'p3', group: 'knows', text: "So what I'm wondering is | why Vermeer painted so few pictures.", pauseMs: 1000, ways: ['own'] },
  { id: 'p4', group: 'knows', text: 'What was the name of that painter who, | you know, did the cows?', pauseMs: 800, ways: ['own'] },
  { id: 'p5', group: 'command', text: 'Start a tree on, | hmm, | Dutch ceramics.', pauseMs: 600, ways: ['start_tree'] },
];

/** "Ghost Dance (The Vision of Life)", on layer 3 of "People who dance when they shouldn't": where the user said L1 on the headset. */
const GHOST: Where = { open: 'ffc3f5f8' };
/** "A Maid Asleep", on layer 2 of "Dutch artist". */
const MAID: Where = { open: '7d121822' };
/** The "Dutch artist" tree, no card open. */
const DUTCH: Where = { tree: '0ad949e3' };
const LAYER: Way[] = ['find_new', 'more_like_this'];

/**
 * Whether the user builds on the open card (a new layer) or starts a tree, and a question when Momo cannot tell. Clear requests go
 * the right way in every run; one Momo cannot tell gets the question and starts no tree.
 */
export const INTENT: Request[] = [
  { id: 'l1', group: 'layer', text: 'Start a new layer based on this one.', where: GHOST, ways: LAYER, typed: ['ask', 'more'] },
  { id: 'l2', group: 'layer', text: "Let's go deeper on this one.", where: GHOST, ways: LAYER, typed: ['ask', 'more'] },
  { id: 'l3', group: 'layer', text: 'Add another layer here about the music they danced to.', where: GHOST, ways: LAYER, typed: ['ask', 'more'] },
  { id: 'l4', group: 'layer', text: 'Build on this card with some paintings of sleeping women.', where: MAID, ways: LAYER, typed: ['ask', 'more'] },
  { id: 'l5', group: 'layer', text: 'Can you branch out from this into other Vermeer interiors?', where: MAID, ways: LAYER, typed: ['ask', 'more'] },
  { id: 'l6', group: 'layer', text: 'Keep building on this, find me photos from the 1890s.', where: GHOST, ways: LAYER, typed: ['ask', 'more'] },
  { id: 'l7', group: 'layer', text: "Next layer: Dutch genre painters who weren't Vermeer.", where: MAID, ways: LAYER, typed: ['ask', 'more'] },
  { id: 'l8', group: 'layer', text: 'Expand on this one.', where: GHOST, ways: LAYER, typed: ['ask', 'more'] },
  { id: 'l9', group: 'layer', text: 'Dig into this one more, the sleeping pose especially.', where: MAID, ways: LAYER, typed: ['ask', 'more'] },
  { id: 'l10', group: 'layer', text: "What about the government's side of it? Show me that.", where: GHOST, ways: LAYER, typed: ['ask', 'more'] },

  { id: 'f1', group: 'new tree', text: 'Start a new tree on Bauhaus furniture.', where: GHOST, ways: ['start_tree'], typed: ['tree'] },
  { id: 'f2', group: 'new tree', text: 'I want a fresh space for something totally different: space probes.', where: MAID, ways: ['start_tree'], typed: ['tree'] },
  { id: 'f3', group: 'new tree', text: "Let's start over with a separate tree about jazz in the 1920s.", where: GHOST, ways: ['start_tree'], typed: ['tree'] },
  { id: 'f4', group: 'new tree', text: 'Put this aside, I want a new tree for my kitchen renovation ideas.', where: MAID, ways: ['start_tree'], typed: ['tree'] },
  { id: 'f5', group: 'new tree', text: 'Make this card its own tree.', where: GHOST, ways: ['start_tree'], typed: ['tree'] },
  { id: 'f6', group: 'new tree', text: 'New topic, separate from all this: Japanese woodblock prints. Give it its own tree.', where: MAID, ways: ['start_tree'], typed: ['tree'] },

  // Nothing open: a find on a subject starts a tree on it, as start_tree does. Typed, the Conductor may instead ask where to look.
  { id: 'o1', group: 'nothing open', text: 'Find me some pictures of Delft at night.', where: 'nothing', ways: ['find_new', 'start_tree'], typed: ['tree', 'reply'] },
  { id: 'o2', group: 'nothing open', text: "Start a tree on Hitchcock's camera tricks.", where: 'nothing', ways: ['start_tree', 'find_new'], typed: ['tree'] },
  { id: 'o3', group: 'nothing open', text: 'I want to explore the history of tarot cards.', where: 'nothing', ways: ['find_new', 'start_tree'], typed: ['tree', 'reply'] },

  // A new layer with no card open: which card?
  { id: 'a1', group: 'no card', text: 'Start a new layer based on this one.', where: 'nothing', ways: ['ask'], typed: ['reply'] },
  { id: 'a2', group: 'no card', text: 'Add a new layer here.', where: DUTCH, ways: ['ask'], typed: ['reply'] },
  { id: 'a3', group: 'no card', text: 'Go one layer deeper.', where: 'nothing', ways: ['ask'], typed: ['reply'] },
  { id: 'a4', group: 'no card', text: 'Build on this one.', where: DUTCH, ways: ['ask'], typed: ['reply'] },

  // A subject the open card may or may not lead to: a new layer here, or its own tree?
  { id: 'u3', group: 'layer or tree', text: "Let's do something on jazz now.", where: GHOST, ways: ['ask'], typed: ['reply'] },
  { id: 'u4', group: 'layer or tree', text: 'Okay, now Japanese prints.', where: MAID, ways: ['ask'], typed: ['reply'] },
  { id: 'u5', group: 'layer or tree', text: 'Can we look at hip hop next?', where: GHOST, ways: ['ask'], typed: ['reply'] },
  { id: 'u6', group: 'layer or tree', text: "Now let's do street photography.", where: MAID, ways: ['ask'], typed: ['reply'] },
  { id: 'u7', group: 'layer or tree', text: 'Something about the dancing plague of 1518.', where: GHOST, ways: ['ask'], typed: ['reply'] },
  { id: 'u8', group: 'layer or tree', text: 'Start something new about Delft pottery.', where: MAID, ways: ['ask'], typed: ['reply'] },
  { id: 'u9', group: 'layer or tree', text: 'Okay, new idea: tango.', where: GHOST, ways: ['ask'], typed: ['reply'] },
];
