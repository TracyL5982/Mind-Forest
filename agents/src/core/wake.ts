/** What the user calls the agent, and the phrase that wakes it: "hey" or "hi", then the name. */

/** The name as it is spoken and shown: "momo" becomes "Momo". */
export function spokenName(name: string): string {
  return name.trim().replace(/(^|\s)(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What was said after a leading "hey <name>" or "hi <name>", with its first letter raised: "Hey Momo, show me more" is "Show me more".
 * Case, punctuation, and a space or hyphen inside the name ("Hi, Mo-mo!") do not matter. Text that does not start with the phrase is returned as it was.
 */
export function withoutWakePhrase(text: string, name: string): string {
  const letters = [...name.normalize('NFKC').toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (letters.length === 0) return text;
  const spelled = letters.map(escape).join("[\\s'’-]*");
  const wake = new RegExp(`^[\\s"“'‘(]*(?:hey|hi)(?![\\p{L}\\p{N}])[\\s,.!?;:—–-]*${spelled}(?![\\p{L}\\p{N}'’])[\\s,.!?;:—–"”'’)-]*`, 'iu');
  const found = wake.exec(text);
  if (!found) return text;
  const rest = text.slice(found[0].length);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** "Hey" and "hi" as a transcription writes them down. */
const GREETINGS = 'hey|hi|hay|hai|hei|heya|hiya|high';

/**
 * Whether the sound that woke a device, written down, holds "hey <name>" or "hi <name>": the check of a wake, since the spotter on the
 * device also wakes on things that only sound like the name (DECISIONS.md 70). The phrase may stand anywhere in so short a stretch,
 * because a word of what came before, or the first words of the request, may be in it. Case, punctuation, and a space or hyphen inside
 * the name do not matter. A name that goes on ("Hey Momoko") or belongs to something ("Hey Momo's bakery") is not it.
 */
export function saysWakePhrase(text: string, name: string): boolean {
  const letters = [...name.normalize('NFKC').toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (letters.length === 0) return false;
  const spelled = letters.map(escape).join("[\\s'’-]*");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${GREETINGS})(?![\\p{L}\\p{N}])[\\s,.!?;:—–-]*${spelled}(?![\\p{L}\\p{N}'’])`, 'iu').test(text);
}
