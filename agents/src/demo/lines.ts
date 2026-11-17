import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Recorded, Unsaid, Voice } from './momo-voice.ts';
import { spokenFor, type Line, type LineKind } from './take.ts';

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
/** A Git LFS pointer file is about 130 bytes; the shortest recording, a word, is tens of thousands. */
const LFS_POINTER = 1000;
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
  /**
   * Records a line in Momo's live voice, as 16-bit mono PCM at 24 kHz, said as written, or says that she did not say it so and
   * what she said closest to it (`momo-voice.ts`). Absent when the service has no voice.
   */
  record?: (text: string, kind: LineKind) => Promise<Recorded | Unsaid>;
  log: (line: string) => void;
}

export class Lines {
  private readonly written: LinesFile['rounds'];
  private edits: Edits = {};
  private readonly editsFile: string;
  private readonly made: string;
  private readonly rendering = new Map<string, Promise<Uint8Array | null>>();
  /** Which voice each recording is in, by its file's name: the repository's, and those made here. */
  private readonly voices: Record<string, Voice>;
  private readonly voicesFile: string;
  /** Lines she did not say as written, by their words, with the closest wording she did say. */
  private readonly unsaid = new Map<string, string>();

  constructor(private readonly opts: LinesOptions) {
    const file = join(opts.demoDir, 'lines.json');
    this.written = existsSync(file) ? LinesFile.parse(JSON.parse(readFileSync(file, 'utf8'))).rounds : {};
    this.editsFile = join(opts.dataDir, 'demo-lines.json');
    this.made = join(opts.dataDir, 'demo-voice');
    mkdirSync(this.made, { recursive: true });
    this.voicesFile = join(this.made, 'voices.json');
    this.voices = { ...read(join(opts.demoDir, 'voice', 'voices.json')), ...read(this.voicesFile) };
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

  /**
   * Every round's lines as they are said now, as the file `demo/lines.json` is written: the user's words in place of Momo's
   * where they wrote any. Put in the repository, it makes those words every copy's.
   */
  file(): LinesFile {
    return { version: 1, voice: this.opts.voice, rounds: Object.fromEntries(Object.keys(this.written).map((round) => [round, this.of(round).map(({ id, kind, cards, text }) => ({ id, kind, cards, text }))])) };
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

  private kept(text: string): string | null {
    const name = this.name(text);
    // Only a recording noted as the realtime voice's is one: any other file is from before, and is never played. A recording
    // not yet fetched from Git LFS is a few lines of text in its place, which is no recording either.
    if (this.voices[name] !== 'realtime') return null;
    return [join(this.opts.demoDir, 'voice', name), join(this.made, name)].find((path) => existsSync(path) && statSync(path).size > LFS_POINTER) ?? null;
  }

  /** How long the line takes to say: its recording's own length, or a reading of its words while there is none. */
  ms(text: string): number {
    if (!text.trim()) return 0;
    const file = this.kept(text);
    return file ? Math.round(statSync(file).size / BYTES_PER_MS) : spokenFor(text);
  }

  /** Whether the line has a recording, so it is said exactly and its length is its own. */
  recorded(text: string): boolean {
    return !text.trim() || this.kept(text) !== null;
  }

  /** Which voice the line's recording is in, or null while it has none. */
  voice(text: string): Voice | null {
    return this.kept(text) ? 'realtime' : null;
  }

  /**
   * The closest wording Momo said, for a line she did not say as written, or null when the line is recorded, was not tried, or
   * is being tried now. Such a line is not ready: nothing is said in its place.
   */
  closest(text: string): string | null {
    return this.kept(text) || this.rendering.has(this.name(text)) ? null : (this.unsaid.get(text) ?? null);
  }

  /** Lets a line she did not say as written be tried again. */
  again(text: string): void {
    this.unsaid.delete(text);
  }

  /** The line in Momo's voice. Made once and kept; null when the service has no voice, or the voice did not answer. */
  audio(text: string, kind: LineKind = 'answer'): Promise<Uint8Array | null> {
    if (!text.trim()) return Promise.resolve(null);
    const file = this.kept(text);
    if (file) return Promise.resolve(new Uint8Array(readFileSync(file)));
    const record = this.opts.record;
    if (!record || this.unsaid.has(text)) return Promise.resolve(null);
    const name = this.name(text);
    let making = this.rendering.get(name);
    if (!making) {
      const keep = (file: string, pcm: Uint8Array) => {
        writeFileSync(join(this.made, `${file}.tmp`), pcm);
        renameSync(join(this.made, `${file}.tmp`), join(this.made, file));
        this.voices[file] = 'realtime';
        writeFileSync(this.voicesFile, JSON.stringify({ ...read(this.voicesFile), [file]: 'realtime' }, null, 1));
      };
      making = record(text, kind).then(
        (made) => {
          if ('unsaid' in made) {
            this.unsaid.set(text, made.closest);
            // Her closest wording's own take is kept under those words, so taking her wording needs no new recording.
            if (made.pcm && made.closest) keep(this.name(made.closest), made.pcm);
            this.opts.log(`[demo] Momo did not say a line as written, so it is not ready. Closest: ${made.closest.slice(0, 90)}`);
            return null;
          }
          keep(name, made.pcm);
          this.opts.log(`[demo] Momo's line recorded in her realtime voice, ${(made.pcm.length / BYTES_PER_MS / 1000).toFixed(1)} s, ${made.takes} take${made.takes === 1 ? '' : 's'}: ${text.slice(0, 70)}`);
          return made.pcm;
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

/** Which voice each recording of a folder is in, as its `voices.json` says. */
function read(file: string): Record<string, Voice> {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Voice>) : {};
  } catch {
    return {};
  }
}
