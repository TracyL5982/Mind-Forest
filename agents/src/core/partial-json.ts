/**
 * The objects of the array under `key` that are already whole in `text`, the start of a JSON reply still being written.
 * Read in order up to the first one not yet closed. An object that does not parse is skipped.
 */
export function completeElements(text: string, key: string): unknown[] {
  const opened = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*\\[`).exec(text);
  if (!opened) return [];
  const found: unknown[] = [];
  let i = opened.index + opened[0].length;
  while (i < text.length) {
    const c = text[i]!;
    if (c === ']') break;
    if (c !== '{') {
      i++;
      continue;
    }
    const end = closingBrace(text, i);
    if (end < 0) break;
    try {
      found.push(JSON.parse(text.slice(i, end + 1)));
    } catch {
      // A malformed element is left out; the next may still be whole.
    }
    i = end + 1;
  }
  return found;
}

/** Where the object that opens at `start` closes, or -1 while it is still open. Braces inside strings do not count. */
function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}
