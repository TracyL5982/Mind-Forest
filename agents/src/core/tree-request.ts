/**
 * Whether a dropped text or a line the user said asks for a new tree, read by plain rules so it costs no model call.
 * `subject` is what the tree is to be about, or empty when the words say "this". `rest` is the text without the words that asked.
 *
 * Heard at the start: "make a tree about Kubrick", "start a new tree on this: …", "make this a tree: …".
 * Heard at the end: "… Start a tree on this.", "… turn this into a tree".
 * "Build a treehouse" and "a family tree" ask for nothing.
 */
export interface Asked {
  subject: string;
  rest: string;
}

const LEAD = String.raw`(?:(?:please|ok|okay|now|so)\s+)?(?:(?:can|could|would|will) you\s+|let'?s\s+|i(?:'d| would)? like to\s+|i want to\s+)?`;
const TREE = String.raw`(?:start|make|create|begin|build|open)(?:\s+me)?\s+(?:a\s+)?(?:new\s+)?tree`;
const THIS = String.raw`(?:this|it|these|that|them|the following|what follows)`;
const BY = String.raw`(?:about|on|for|of|around|from|out of|with)`;
const MAKE_THIS = String.raw`(?:make|turn)\s+${THIS}\s+(?:into\s+)?(?:a\s+)?(?:new\s+)?tree`;
const END = String.raw`\s*[.!]?\s*(?:[:—–]\s*|-\s+|\n\s*|$)`;

const HEAD = new RegExp(String.raw`^\s*${LEAD}(?:${TREE}(?:\s+${BY}\s+([^:\n—–]+?))?|${MAKE_THIS})${END}`, 'i');
const TAIL = new RegExp(String.raw`(?:^|\s+)${LEAD}(?:${TREE}\s+${BY}\s+${THIS}|${MAKE_THIS})\s*[.!]?\s*$`, 'i');
const ONLY_THIS = new RegExp(String.raw`^${THIS}$`, 'i');

export function treeRequest(text: string): Asked | null {
  const head = HEAD.exec(text);
  if (head) {
    const object = (head[1] ?? '').trim().replace(/[.!?]+$/, '');
    return { subject: ONLY_THIS.test(object) ? '' : object, rest: text.slice(head[0].length).trim() };
  }
  const tail = TAIL.exec(text);
  return tail ? { subject: '', rest: text.slice(0, tail.index).trim() } : null;
}
