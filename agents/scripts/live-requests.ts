/**
 * The 40 requests Momo's live voice is measured on (scripts/live-bench.ts), each with the way it should be answered, written down
 * before any run. `own` is from what Momo knows, with no tool. They are said on the "Dutch artist" tree of the user's data, with
 * the pick "A Maid Asleep" open.
 */

export type Way = 'own' | 'web_answer' | 'look_up_mindstorm' | 'find_new' | 'start_tree' | 'more_like_this' | 'keep' | 'undo' | 'go_to' | 'organize' | 'hand_off' | 'save_note';

export interface Request {
  id: string;
  group: 'knows' | 'web' | 'saved' | 'new' | 'command' | 'small talk' | 'unclear';
  text: string;
  /** The right ways: the first is the expected one, any other is also right. */
  ways: Way[];
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
