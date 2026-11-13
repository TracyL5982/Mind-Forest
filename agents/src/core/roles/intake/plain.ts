export const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Keeps the start and the end of a long text, where the framing and the conclusions usually are. */
export function middleOut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  return `${text.slice(0, head)}\n[… ${text.length - max} characters left out …]\n${text.slice(text.length - (max - head))}`;
}

export const TITLE_MAX = 69;

export function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return squash(line.replace(/^[\s#>*\-_]+/, '').replace(/[*_`]+/g, ''));
}

export function nameStem(name: string): string {
  return squash(name.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[-_.]+/g, ' '));
}

const STOP = new Set(
  `a about after all also an and any are as at be because been but by can could did do does for from had has have he her
  his how i if in into is it its just like me more most my no not of on one or our out she so some than that the their
  them then there these they this to up us was we were what when which who why will with would you your said
  http https www com org net html`.split(/\s+/),
);

/** The most frequent meaningful words, most frequent first. */
export function keywords(text: string, max: number): string[] {
  const counts = new Map<string, number>();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  for (const part of segmenter.segment(text.slice(0, 20_000))) {
    if (!part.isWordLike) continue;
    const word = part.segment.toLowerCase();
    if (word.length < 2 || STOP.has(word) || /^[\d.,]+$/.test(word)) continue;
    if (word.length < 3 && /^[a-z]+$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([word]) => word);
}

/** 2 to 6 lowercase tags: the given ones cleaned, topped up from `spare` when there are fewer than two. */
export function tidyTags(tags: string[], spare: string[]): string[] {
  const clean = (list: string[]) => list.map((t) => squash(t.replace(/^#+/, '')).toLowerCase().slice(0, 30)).filter(Boolean);
  const out = [...new Set(clean(tags))].slice(0, 6);
  for (const tag of clean(spare)) {
    if (out.length >= 2) break;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

export interface Described {
  title: string;
  summary: string;
  tags: string[];
}

/** What an item gets when the model is not there to describe it. */
export function plainly(text: string, kind: string, name?: string): Described {
  const stem = name ? nameStem(name) : '';
  return {
    title: clip(stem || firstLine(text) || `Untitled ${kind}`, TITLE_MAX),
    summary: clip(squash(text), 200),
    tags: tidyTags(keywords(`${stem} ${text}`, 4), [kind, 'unsorted']),
  };
}

export function asUrl(text: string): string | null {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) && URL.canParse(trimmed) ? trimmed : null;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const TEXT_MIME = /^(text\/|application\/(json|xml|x-ndjson|yaml|x-yaml|javascript|markdown)\b)/i;
const TEXT_NAME = /\.(md|markdown|txt|json|csv|tsv|ya?ml|xml|html?)$/i;

function mostlyPrintable(text: string): boolean {
  const sample = text.slice(0, 4000);
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) control++;
  }
  return sample.length > 0 && control / sample.length < 0.01;
}

/** The file's content as text, or null when it is not a text file. */
export function decodeText(bytes: Uint8Array, mime: string, name = ''): string | null {
  const declared = TEXT_MIME.test(mime) || TEXT_NAME.test(name);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return declared || mostlyPrintable(text) ? text : null;
  } catch {
    return declared ? new TextDecoder().decode(bytes) : null;
  }
}
