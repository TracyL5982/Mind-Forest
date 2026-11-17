import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { spokenFor, type Line } from './take.ts';

/**
 * What Momo says in each round of the demo, written down. The words she was given by the real Momo are in `agents/demo/lines.json`
 * with their recordings in `agents/demo/voice`, so every copy of the demo says the same. What the user writes over a line on the
 * control page is kept in the data folder with its own recording, and is what she says from then on.
 */

const StoredLine = z.object({ id: z.string().min(1), kind: z.enum(['answer', 'first', 'more', 'wrap']), cards: z.array(z.string()), text: z.string() });
export const LinesFile = z.object({
  version: z.literal(1),
  /** The voice the recordings were made in. Another voice is another set of recordings. */
  voice: z.string(),
  rounds: z.record(z.string(), z.array(StoredLine)),
});
export type LinesFile = z.infer<typeof LinesFile>;

/** The user's own words for lines, by round and line. */
const Edits = z.record(z.string(), z.record(z.string(), z.string()));
export type Edits = z.infer<typeof Edits>;

/** 16-bit mono at 24 kHz, the live voice's own format. */
const BYTES_PER_MS = 48;
/** A line is a few sentences. Longer is cut, so one box cannot ask for minutes of speech. */
export const MAX_LINE = 1200;

/** The file a recording of these exact words in this voice is kept in: the same words are the same file, wherever they are said. */
export const recordingName = (voice: string, text: string): string => `${createHash('sha1').update(`${voice}\n${text}`).digest('hex').slice(0, 20)}.pcm`;

export interface LineShown extends Line {
  /** The words the real Momo gave it. */
  written: string;
  edited: boolean;
}

export interface LinesOptions {
  /** `agents/demo`: `lines.json` and `voice/` are read from it. */
  demoDir: string;
  /** Where edits and their recordings are kept. */
  dataDir: string;
  voice: string;
  /** Says a line in Momo's voice, as 16-bit mono PCM at 24 kHz. Absent when the service has no voice. */
  speak?: (text: string) => Promise<Uint8Array>;
  log: (line: string) => void;
}

export class Lines {
  private readonly written: LinesFile['rounds'];
  private edits: Edits = {};
  private readonly editsFile: string;
  private readonly made: string;
  private readonly rendering = new Map<string, Promise<Uint8Array | null>>();

  constructor(private readonly opts: LinesOptions) {
    const file = join(opts.demoDir, 'lines.json');
    this.written = existsSync(file) ? LinesFile.parse(JSON.parse(readFileSync(file, 'utf8'))).rounds : {};
    this.editsFile = join(opts.dataDir, 'demo-lines.json');
    this.made = join(opts.dataDir, 'demo-voice');
    mkdirSync(this.made, { recursive: true });
    try {
      if (existsSync(this.editsFile)) this.edits = Edits.parse(JSON.parse(readFileSync(this.editsFile, 'utf8')));
    } catch {
      this.edits = {};
    }
  }

  /** A round's lines as Momo says them now: the user's words where they wrote any. */
  of(round: string): LineShown[] {
    return (this.written[round] ?? []).map((line) => {
      const own = this.edits[round]?.[line.id];
      return { ...line, written: line.text, text: own ?? line.text, edited: own !== undefined };
    });
  }

  /** Whether the service holds any words of the user's. The page sends its own copy again when it holds none, as after a restart with no volume. */
  get edited(): number {
    return Object.values(this.edits).reduce((n, round) => n + Object.keys(round).length, 0);
  }

  /** Writes the user's words over a line, or with `null` goes back to Momo's own. Returns false when the round has no such line. */
  edit(round: string, line: string, text: string | null): boolean {
    const there = this.written[round]?.find((l) => l.id === line);
    if (!there) return false;
    const clean = text?.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE);
    const round_ = { ...this.edits[round] };
    if (clean === undefined || clean === there.text) delete round_[line];
    else round_[line] = clean;
    this.edits = { ...this.edits, [round]: round_ };
    if (Object.keys(round_).length === 0) delete this.edits[round];
    writeFileSync(`${this.editsFile}.tmp`, JSON.stringify(this.edits, null, 1));
    renameSync(`${this.editsFile}.tmp`, this.editsFile);
    return true;
  }

  private name(text: string): string {
    return recordingName(this.opts.voice, text);
  }

  private file(text: string): string | null {
    const name = this.name(text);
    return [join(this.opts.demoDir, 'voice', name), join(this.made, name)].find((path) => existsSync(path)) ?? null;
  }

  /** How long the line takes to say: its recording's own length, or a reading of its words while there is none. */
  ms(text: string): number {
    if (!text.trim()) return 0;
    const file = this.file(text);
    return file ? Math.round(statSync(file).size / BYTES_PER_MS) : spokenFor(text);
  }

  /** Whether the line has a recording, so it is said exactly and its length is its own. */
  recorded(text: string): boolean {
    return !text.trim() || this.file(text) !== null;
  }

  /** The line in Momo's voice. Made once and kept; null when the service has no voice, or the voice did not answer. */
  audio(text: string): Promise<Uint8Array | null> {
    if (!text.trim()) return Promise.resolve(null);
    const file = this.file(text);
    if (file) return Promise.resolve(new Uint8Array(readFileSync(file)));
    const speak = this.opts.speak;
    if (!speak) return Promise.resolve(null);
    const name = this.name(text);
    let making = this.rendering.get(name);
    if (!making) {
      making = speak(text).then(
        (pcm) => {
          writeFileSync(join(this.made, `${name}.tmp`), pcm);
          renameSync(join(this.made, `${name}.tmp`), join(this.made, name));
          this.opts.log(`[demo] Momo's line recorded, ${(pcm.length / BYTES_PER_MS / 1000).toFixed(1)} s: ${text.slice(0, 70)}`);
          return pcm;
        },
        (err) => {
          this.opts.log(`[demo] Momo's line could not be recorded (${err instanceof Error ? err.message : String(err)}): ${text.slice(0, 70)}`);
          return null;
        },
      );
      this.rendering.set(name, making);
      void making.finally(() => this.rendering.delete(name));
    }
    return making;
  }

  /** Lines being recorded now. */
  get busy(): number {
    return this.rendering.size;
  }
}
