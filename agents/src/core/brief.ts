/** Short forms of titles, for lines the agent says and for the live labels of its work. */

const SPACELESS = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}\p{scx=Thai}]/u;
/** Words a cut title must not end on. */
const DANGLING = new Set([
  'a', 'an', 'the', 'of', 'for', 'about', 'and', 'or', 'but', 'so', 'to', 'in', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'than', 'vs',
  'why', 'how', 'what', 'that', 'which', 'who', 'whose', 'when', 'where', 'is', 'are', 'was', 'were', 'be', 'it', 'its',
  'this', 'these', 'those', 'their', 'his', 'her', 'our', 'your', 'my', 'not',
]);

/** A word of a spaced language counts once, each character of a spaceless one once, since each is about a syllable. */
export function wordCount(text: string): number {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .reduce((n, word) => n + Math.max(1, [...word].filter((c) => SPACELESS.test(c)).length), 0);
}

function clipWords(text: string, most: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (wordCount(text) <= most) return text;
  const kept: string[] = [];
  for (const word of words) {
    if (wordCount([...kept, word].join(' ')) > most) {
      if (kept.length === 0) kept.push([...word].slice(0, most).join(''));
      break;
    }
    kept.push(word);
  }
  while (kept.length > 1 && DANGLING.has(kept.at(-1)!.toLowerCase())) kept.pop();
  return kept.join(' ').replace(/[\s,;:.!?—–-]+$/u, '');
}

/** A title as it is said or shown in a line: without its subtitle when it has one, and never longer than `most` words. */
export function briefly(title: string, most: number): string {
  const flat = title.replace(/\s+/g, ' ').trim().replace(/"/g, '');
  const main = flat.split(/\s*(?::|\(|\|)\s*/)[0]!;
  return clipWords(wordCount(main) >= 2 ? main : flat, most);
}

/** A label of at most `most` words: the words that say what is being done, then as much of `name` as fits. */
export function label(doing: string, name: string, most = LABEL_WORDS): string {
  const room = most - wordCount(doing);
  return room >= 1 && name.trim() ? `${doing} ${briefly(name, room)}` : doing;
}

/** The words of `text` that carry its meaning, without the small words a cut title must not end on. */
export function contentWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word && !DANGLING.has(word.toLowerCase().replace(/\p{P}+/gu, '')));
}

/** What a live label may hold: a few words, read at a glance. */
export const LABEL_WORDS = 7;
