import { z } from 'zod';
import type { JsonRequest, ModelClient, WebResult } from '../core/ports.ts';
import { LinkReply, type Description } from '../core/roles/intake/describe.ts';

type JsonHandler = (req: JsonRequest<unknown>) => unknown;

/**
 * A scripted model for tests. Register a handler per role; a request for a role with none throws.
 * Every reply is checked against the request's schema, as the real model's is.
 */
export class FakeModel implements ModelClient {
  readonly calls: { kind: 'json' | 'search' | 'image' | 'transcribe'; role: string; detail: string }[] = [];
  private readonly json_ = new Map<string, JsonHandler>();
  private search_: (query: string, max: number) => WebResult[] = () => [];
  private transcript = '';

  on(role: string, handler: JsonHandler): this {
    this.json_.set(role, handler);
    return this;
  }
  onSearch(handler: (query: string, max: number) => WebResult[]): this {
    this.search_ = handler;
    return this;
  }
  onTranscribe(text: string): this {
    this.transcript = text;
    return this;
  }

  /**
   * Answers Intake as `describe` does, so the real Intake runs with no model behind it.
   * A file is described from its name, which is all this fake can read of it.
   */
  describing(): this {
    const quoted = (user: string) => /"""\n([\s\S]*?)\n"""/.exec(user)?.[1] ?? '';
    const named: JsonHandler = (req) => ({ ...describe(req.user.replace(/^File name: /, '')), description: '' });
    return this.on('intake.text', (req) => ({
      entries: [...req.user.matchAll(/Dump (\d+)[^\n]*:\n"""\n([\s\S]*?)\n"""/g)].map((dump) => ({ dump: Number(dump[1]), text: '', ...describe(dump[2]!) })),
    }))
      .on('intake.link', (req) => describe(quoted(req.user)))
      .on('intake.image', named)
      .on('intake.video', named);
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    this.calls.push({ kind: 'json', role: req.role, detail: req.user });
    const handler = this.json_.get(req.role);
    if (!handler) throw new Error(`FakeModel has no script for role "${req.role}"`);
    return req.schema.parse(handler(req as JsonRequest<unknown>));
  }
  async search(req: { role: string; query: string; max?: number }): Promise<WebResult[]> {
    this.calls.push({ kind: 'search', role: req.role, detail: req.query });
    return this.search_(req.query, req.max ?? 5).slice(0, req.max ?? 5);
  }
  async image(req: { role: string; prompt: string }): Promise<{ bytes: Uint8Array; mime: string }> {
    this.calls.push({ kind: 'image', role: req.role, detail: req.prompt });
    return { bytes: PIXEL, mime: 'image/png' };
  }
  async transcribe(): Promise<string> {
    this.calls.push({ kind: 'transcribe', role: 'voice', detail: '' });
    return this.transcript;
  }
}

/** A 1×1 transparent PNG. */
const PIXEL = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

/** A description with every key present and nothing in it. Read off the schema, so it stays valid as the schema grows. */
export function blank(): Description {
  return LinkReply.parse(Object.fromEntries(Object.entries(LinkReply.shape).map(([key, type]) => [key, type instanceof z.ZodArray ? [] : ''])));
}

const BULLET = /^(?:[-*•]\s+)?(?:\[([ xX])\]\s+)?(.+)$/;
const isBullet = (line: string) => /^(?:[-*•]\s|\[[ xX]\]\s)/.test(line);

/**
 * What a model would say about a text, read by pattern instead. Each kind of structure has one plain way to write it:
 *   Where: Lisbon                     People: Ana Lima, Ben Okri
 *   Pros: fast, small                 Cons: (or either label followed by bulleted lines)
 *   Plan | Price                      a table, its first row the heads
 *   Q: ...   A: ...                   Term: ...   Definition: ...
 *   - one / - two                     a list, and a checklist when every line starts [ ] or [x]
 *   Ember #E4572E                     a colour, named by the capitalised word before it
 *   > a passage                       an excerpt, with an optional line "At: Chapter 3"
 * A text holding "fake:invent" is also given a place it never names, to show the grounding check dropping it.
 */
export function describe(text: string): Description {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const labelled = (label: string): string => lines.find((line) => line.toLowerCase().startsWith(`${label}:`))?.slice(label.length + 1).trim() ?? '';
  const list = (label: string): string[] => {
    const at = lines.findIndex((line) => line.toLowerCase().startsWith(`${label}:`));
    if (at < 0) return [];
    const inline = lines[at]!.slice(label.length + 1).trim();
    if (inline) return inline.split(/[,;]\s*/).map((entry) => entry.replace(/\.$/, '').trim()).filter(Boolean);
    const end = lines.findIndex((line, n) => n > at && !isBullet(line));
    return lines.slice(at + 1, end < 0 ? undefined : end).map((line) => BULLET.exec(line)![2]!);
  };

  const pros = list('pros');
  const cons = list('cons');
  const bullets = pros.length + cons.length > 0 ? [] : lines.filter(isBullet).map((line) => BULLET.exec(line)!);
  const rows = lines.filter((line) => line.includes('|'));
  const first = lines.find(Boolean) ?? '';

  return {
    ...blank(),
    title: first.slice(0, 60),
    summary: text.trim().slice(0, 160),
    tags: first.toLowerCase().split(/\W+/).filter((word) => word.length > 4).slice(0, 3),
    where: /fake:invent/.test(text) ? 'Atlantis' : labelled('where'),
    people: list('people'),
    pros,
    cons,
    ...(rows.length >= 2 ? { tableHeads: rows[0]!.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()), tableRows: rows.slice(1) } : {}),
    question: labelled('q'),
    answer: labelled('a'),
    term: labelled('term'),
    definition: labelled('definition'),
    ...(bullets.length >= 2 ? { items: bullets.map((b) => b[2]!), checklist: bullets.every((b) => b[1]) ? bullets.map((b) => b[1] !== ' ') : [] } : {}),
    colours: [...text.matchAll(/(?:([A-Z][\w-]*) )?(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))\b/g)].map((m) => ({ name: m[1] ?? '', value: m[2]! })),
    excerptText: lines.find((line) => line.startsWith('> '))?.slice(2).trim() ?? '',
    excerptAt: labelled('at'),
  };
}
