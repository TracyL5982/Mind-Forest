import { cost, instructions, type OpenRealtime, type RealtimeEvent, type Usage } from '../node/live.ts';
import type { LineKind } from './take.ts';

/**
 * Momo's recorded lines in the voice the headset hears live: the realtime model itself, as Momo, saying a given line. The model
 * cannot be held to a text word for word, so each take is written out again from its sound and kept only when its words are the
 * line's. After five takes that are not, the speech model reads the line, which is exact but is not her live voice, and the line
 * is marked so.
 */

/** Which voice a recording is in: the realtime model, as the headset hears Momo live, or the speech model reading the words. */
export type Voice = 'realtime' | 'speech';

export interface Recorded {
  pcm: Uint8Array;
  by: Voice;
  /** How many takes the realtime model made of it. */
  takes: number;
}

/** 16-bit mono at 24 kHz. */
const BYTES_PER_SECOND = 48_000;
const TAKES = 5;

const MOMENT: Record<LineKind, string> = {
  answer: 'your answer to what the user just asked, said as you start looking for things',
  first: 'the first card has just landed, and you tell the user about it',
  more: 'more cards have just landed, and you tell the user in a line',
  wrap: 'the search is over, and you wrap up: which you would look at first, and a next step',
};

const READING = `# Recording your lines
You are recording your own lines for a film of Mind Palace. Each message gives one line of yours and the moment you say it at. Say that line aloud, exactly as it is written: every word, in order, nothing before it and nothing after it, and no word changed. Say it as you would at that moment, in your own natural, warm delivery, at your usual pace. A name in quotation marks is a card's title: say it as written.`;

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** A text as its words, for comparing by ear: lower case, no punctuation, "%" as "percent", and a number up to twenty as its word. */
const plain = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/%/g, ' percent ')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => (/^\d+$/.test(word) && Number(word) <= 20 ? NUMBERS[Number(word)]! : word));

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = keep;
    }
  }
  return row[b.length]!;
}

/** A word as its consonants in order, doubled ones once: what "rows" and "rose", "centre" and "center", "Llull's" and "Lowell's" share. */
const consonants = (word: string): string => ((word[0] ?? '') + word.slice(1).replace(/[aeiouwhy]/g, '')).replace(/(.)\1+/g, '$1');

/**
 * Two spellings of what sounds like one word, as a listener who spells by ear gives them: one letter apart (two in a long word),
 * or the same consonants in the same order.
 */
const soundsLike = (a: string, b: string): boolean => a === b || distance(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1) || consonants(a) === consonants(b);

/**
 * How a recording's words, written out from its sound, compare with the line.
 * - `exact`: the same words.
 * - `close`: the same number of words, each the same or a spelling of the same sound, or the same letters with a space moved
 *   ("work room", "workroom"). The listener spells by ear, so this is what a faithful reading of a line with names in it gives.
 * - `differs`: a word is added, dropped or changed.
 */
export function compare(line: string, heard: string): 'exact' | 'close' | 'differs' {
  const [a, b] = [plain(line), plain(heard)];
  if (a.join(' ') === b.join(' ')) return 'exact';
  if (a.join('') === b.join('')) return 'close';
  if (a.length === b.length && a.every((word, i) => soundsLike(word, b[i]!))) return 'close';
  return 'differs';
}

/** A PCM recording as a WAV file, for a model that takes files. */
export function wavOf(pcm: Uint8Array, rate = 24_000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const tag = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export interface VoiceOptions {
  open: OpenRealtime;
  model: string;
  voice: string;
  /** Momo's name, as her instructions give it. */
  name: string;
  /** Writes a recording out from its sound, told the words it is likely to hold. */
  hear: (wav: Uint8Array, likely: string) => Promise<string>;
  /** The speech model reading the words, for a line the realtime model did not say as written in five takes. */
  speak: (text: string) => Promise<Uint8Array>;
  /** Told what each realtime take cost, in dollars. */
  spent?: (dollars: number) => void;
  log: (line: string) => void;
}

/** One take of a line by the realtime model as Momo: its sound, and what the model itself says it said. */
export function realtimeTake(opts: Pick<VoiceOptions, 'open' | 'model' | 'voice' | 'name' | 'spent'>, text: string, kind: LineKind): Promise<{ pcm: Uint8Array; said: string }> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let said = '';
    let over = false;
    const end = (act: () => void) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      session.close();
      act();
    };
    const session = opts.open({
      event: (e: RealtimeEvent) => {
        if (e.type === 'error') return end(() => fail(new Error(`the realtime model refused: ${JSON.stringify(e.error)}`)));
        if (e.type === 'response.output_audio.delta') chunks.push(Buffer.from(String(e.delta ?? ''), 'base64'));
        if (e.type === 'response.output_audio_transcript.done') said = String(e.transcript ?? '');
        if (e.type !== 'response.done') return;
        const usage = (e.response as { usage?: Usage } | undefined)?.usage;
        const dollars = usage ? cost(opts.model, usage) : null;
        if (dollars !== null) opts.spent?.(dollars);
        end(() => done({ pcm: new Uint8Array(Buffer.concat(chunks)), said: said.trim() }));
      },
      closed: (why) => end(() => fail(new Error(why))),
    });
    const timer = setTimeout(() => end(() => fail(new Error('the realtime model did not finish the line in 90 s'))), 90_000);
    timer.unref?.();
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    session.send({
      type: 'session.update',
      session: { type: 'realtime', model: opts.model, output_modalities: ['audio'], instructions: `${instructions(opts.name, today)}\n\n${READING}`, audio: { output: { format: { type: 'audio/pcm', rate: 24_000 }, voice: opts.voice } } },
    });
    session.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `The moment: ${MOMENT[kind]}.\nYour line: """${text}"""` }] } });
    session.send({ type: 'response.create' });
  });
}

/**
 * Records a line in Momo's live voice: up to five takes by the realtime model, each written out from its sound, the first whose
 * words are the line's kept. When none is, the speech model reads it.
 */
export async function record(opts: VoiceOptions, text: string, kind: LineKind, likely = ''): Promise<Recorded> {
  let takes = 0;
  for (; takes < TAKES; ) {
    takes++;
    try {
      const { pcm } = await realtimeTake(opts, text, kind);
      if (pcm.length < BYTES_PER_SECOND / 4) throw new Error('the take holds no sound');
      const heard = await opts.hear(wavOf(pcm), likely);
      const how = compare(text, heard);
      if (how !== 'differs') return { pcm, by: 'realtime', takes };
      opts.log(`[demo] take ${takes} of a line was not as written; heard: ${heard.slice(0, 160)}`);
    } catch (err) {
      opts.log(`[demo] take ${takes} of a line failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  opts.log(`[demo] the realtime voice did not say a line as written in ${TAKES} takes, so the speech model reads it: ${text.slice(0, 80)}`);
  return { pcm: await opts.speak(text), by: 'speech', takes };
}
