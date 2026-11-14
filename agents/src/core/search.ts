import type { Id } from './domain.ts';

const STOP = new Set(
  'a an and are as at be but by for from has have i in is it its of on or that the this to was were will with you your not no so if we they he she them his her our what which who how why when where do does did can could would should about into than then there here just also very more most some any all each'.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export interface SearchDoc {
  title: string;
  body: string;
  tags: readonly string[];
}

export interface Hit {
  id: Id;
  /** Raw BM25 score. Comparable within one query only. */
  score: number;
  /** Share of the query's distinct terms this document contains, 0…1. Comparable across queries. */
  coverage: number;
}

const K1 = 1.4;
const B = 0.75;
const TITLE_WEIGHT = 3;
const TAG_WEIGHT = 2;

/** BM25 over a small corpus, in plain TypeScript so it runs in any host. */
export class SearchIndex {
  private readonly docs = new Map<Id, { terms: Map<string, number>; length: number }>();
  private readonly postings = new Map<string, Set<Id>>();
  private totalLength = 0;

  get size(): number {
    return this.docs.size;
  }

  set(id: Id, doc: SearchDoc): void {
    this.remove(id);
    const terms = new Map<string, number>();
    const add = (text: string, weight: number) => {
      for (const t of tokenize(text)) terms.set(t, (terms.get(t) ?? 0) + weight);
    };
    add(doc.title, TITLE_WEIGHT);
    add(doc.tags.join(' '), TAG_WEIGHT);
    add(doc.body, 1);
    let length = 0;
    for (const [term, n] of terms) {
      length += n;
      let ids = this.postings.get(term);
      if (!ids) this.postings.set(term, (ids = new Set()));
      ids.add(id);
    }
    this.docs.set(id, { terms, length });
    this.totalLength += length;
  }

  remove(id: Id): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    for (const term of doc.terms.keys()) {
      const ids = this.postings.get(term);
      ids?.delete(id);
      if (ids?.size === 0) this.postings.delete(term);
    }
    this.totalLength -= doc.length;
    this.docs.delete(id);
  }

  search(query: string, opts: { limit?: number; skip?: (id: Id) => boolean } = {}): Hit[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 || this.docs.size === 0) return [];
    const avg = this.totalLength / this.docs.size;
    const scores = new Map<Id, { score: number; matched: number }>();
    for (const term of terms) {
      const ids = this.postings.get(term);
      if (!ids) continue;
      const idf = Math.log(1 + (this.docs.size - ids.size + 0.5) / (ids.size + 0.5));
      for (const id of ids) {
        if (opts.skip?.(id)) continue;
        const doc = this.docs.get(id)!;
        const tf = doc.terms.get(term)!;
        const part = (idf * (tf * (K1 + 1))) / (tf + K1 * (1 - B + (B * doc.length) / avg));
        const entry = scores.get(id) ?? { score: 0, matched: 0 };
        entry.score += part;
        entry.matched += 1;
        scores.set(id, entry);
      }
    }
    return [...scores]
      .map(([id, s]) => ({ id, score: s.score, coverage: s.matched / terms.length }))
      .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1))
      .slice(0, opts.limit ?? 10);
  }
}
