/* global importScripts, createKws */
/**
 * The wake phrase, off the page's thread. Hears the microphone at 16 kHz from the audio thread, spots "hey <name>" or "hi <name>"
 * with sherpa-onnx's keyword spotter, then records until the speaker pauses and hands back that recording as a WAV.
 * Nothing is recorded before the phrase except a short ring of the last seconds, kept here, so the words right after it are not lost.
 * Streaming (the service's live voice), it hands back each piece after the phrase as it is heard instead, until the page says the turn is over.
 *
 * mode: 'loading' | 'held' | 'waiting' | 'hearing' | 'streaming'
 */
const VENDOR = new URL('../vendor/sherpa-onnx/', self.location).href;
const RATE = 16000;
const PIECE_S = 0.1;
const RING_S = 3;
/**
 * The phrase is spotted at least 0.2 seconds after it ends, and its last word piece lasts about a quarter second.
 * So it began no later than its span between first and last piece plus 0.45 seconds before it was spotted.
 */
const AFTER_LAST_PIECE_S = 0.45;
/** How far before that guess the start of the phrase is looked for, at most. */
const LOOK_BACK_S = 0.5;
/** The name is spotted 0.4 to 0.6 seconds after its sound ends, so the last three pieces before then come after it. */
const SPOTTED_AFTER_S = 0.3;
/**
 * The spotter clears itself after 1.5 seconds without speech, and a phrase that begins as it does is lost: after 1.5 or 3 seconds of quiet,
 * 11 and 0 phrases of 60 were caught (scripts/wake-quiet.py). Starting a fresh stream after each second of quiet, before it clears itself, catches 54 and 57.
 */
const FRESH_AFTER_QUIET_S = 1.0;
const PAUSE_S = 1.2;
const NOTHING_SAID_S = 8;
const LONGEST_S = 60;
const GREETINGS = ['HEY', 'HI'];
/**
 * Streaming, what follows the phrase goes out from this long before its first word, and the phrase itself only when the request follows
 * straight on. The live model took the pause after "Hey Momo." for the end of the turn and answered the greeting (DECISIONS.md 39).
 */
const HELD_BACK_S = 0.8;

let mode = 'loading';
let tuning = null;
let name = '';
let kws = null;
let stream = null;
const ring = [];
let heard = null;
/** Whether what follows the phrase is streamed rather than recorded, from the next phrase on. */
let streams = false;
let quietS = 0;
let vocabulary = null;
const busy = { decodeMs: 0, audioS: 0 };

self.Module = {
  locateFile: (file) => VENDOR + file,
  print: () => {},
  printErr: () => {},
  onRuntimeInitialized: () => ready(),
};

self.onmessage = (event) => {
  const m = event.data;
  if (m.t === 'start') {
    tuning = m.tuning;
    name = m.name;
    m.audio.onmessage = (e) => hear(e.data);
    Promise.all([fetch(VENDOR + 'bpe.model').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`bpe.model ${r.status}`))))])
      .then(([model]) => {
        vocabulary = pieces(new Uint8Array(model));
        importScripts(VENDOR + 'sherpa-onnx-kws.js', VENDOR + 'sherpa-onnx-wasm-kws-main.js');
      })
      .catch((err) => self.postMessage({ t: 'failed', message: String(err?.message ?? err) }));
  } else if (m.t === 'name') {
    if (kws && !keywords(m.name)) return self.postMessage({ t: 'unspellable', name: m.name });
    name = m.name;
    if (kws) build();
  } else if (m.t === 'listen') {
    if (mode === 'held' || mode === 'waiting') listen();
  } else if (m.t === 'hold') {
    if (mode === 'waiting') mode = 'held';
  } else if (m.t === 'stream') {
    streams = m.on;
  } else if (m.t === 'over') {
    if (mode === 'streaming') mode = 'held';
  } else if (m.t === 'busy') {
    self.postMessage({ t: 'busy', ...busy });
  }
};

function ready() {
  if (!keywords(name)) return self.postMessage({ t: 'failed', message: `"${name}" cannot be spelled in the listener's English word pieces` });
  build();
  mode = 'held';
  self.postMessage({ t: 'ready' });
}

function build() {
  stream?.free();
  stream = null;
  kws?.free();
  kws = createKws(self.Module, {
    featConfig: { samplingRate: RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: './encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
        decoder: './decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
        joiner: './joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
      },
      tokens: './tokens.txt',
      provider: 'cpu',
      modelType: '',
      numThreads: 1,
      debug: 0,
      modelingUnit: 'bpe',
      bpeVocab: '',
    },
    // 32 readings of the sound kept alive, not 4: with 4 the name's own reading was often dropped before its end, most of all
    // when the request ran straight on from it. It also wakes on one near miss in eight, so the service checks what woke it
    // (DECISIONS.md 69 and 70).
    maxActivePaths: 32,
    numTrailingBlanks: 1,
    keywordsScore: tuning.boost,
    keywordsThreshold: tuning.threshold,
    keywords: keywords(name),
  });
  if (mode === 'waiting') listen();
}

/**
 * The keyword lines for a name: each greeting and the name, as the model's word pieces, with "high" for "hi" because the model often hears that.
 * null when the name cannot be spelled in the model's English word pieces, since the spotter stops the whole module on a keyword it cannot read.
 */
function keywords(spoken) {
  const words = spoken.toUpperCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').trim();
  const label = words.replace(/\s+/g, '_');
  const lines = [];
  for (const greeting of [...GREETINGS, ...(tuning.highForHi ? ['HIGH'] : [])]) {
    const pieces = encode(`${greeting} ${words}`);
    if (!pieces) return null;
    lines.push(`${pieces} @${greeting === 'HIGH' ? 'HI' : greeting}_${label}`);
  }
  return lines.join('\n');
}

function listen() {
  stream?.free();
  stream = kws.createStream();
  quietS = 0;
  heard = null;
  mode = 'waiting';
}

function hear(piece) {
  ring.push(piece);
  while (ring.length * PIECE_S > RING_S) ring.shift();
  if (mode === 'waiting') spot(piece);
  else if (mode === 'hearing') record(piece);
  else if (mode === 'streaming') flow(piece);
}

function spot(piece) {
  const started = performance.now();
  quietS = speech(piece, Math.min(...ring.map(level))) ? 0 : quietS + PIECE_S;
  if (quietS >= FRESH_AFTER_QUIET_S) listen();
  stream.acceptWaveform(RATE, piece);
  let found = null;
  while (kws.isReady(stream)) {
    kws.decode(stream);
    const result = kws.getResult(stream);
    if (result.keyword) {
      found = result;
      kws.reset(stream);
      break;
    }
  }
  busy.decodeMs += performance.now() - started;
  busy.audioS += piece.length / RATE;
  if (found) wake(found);
}

/**
 * Starts the recording one piece before the phrase, so what follows it is kept whole and what came before stays here.
 * The spotter's timestamps place the phrase only by its span: they restart after 1.5 seconds of quiet while `start_time` does not move.
 * From the latest the phrase can have begun, the start is moved back to where its sound begins, or forward past quiet to it.
 * A short command said straight after the name ("hey Momo, more") can end before the name is spotted. So speech after the phrase counts, and the
 * pause that ends the recording is timed from it. The phrase ends at the first dip once its span has passed, since its first word piece
 * is reported after its sound begins and its last near the end. A dip is a piece under a fifth of the phrase's loudest, as a quick speaker may not go quiet,
 * and only a piece as loud as that after the dip is a word, so the fading end of "Momo" is not taken for one.
 * A speaker who does not stop at all ("hi Momo what is this") leaves no dip: then the sound just before the name was spotted is the request (DECISIONS.md 69).
 */
function wake(result) {
  const times = result.timestamps ?? [];
  const span = times.length > 1 ? times.at(-1) - times[0] : 0;
  const floor = Math.min(...ring.map(level));
  const guess = Math.max(0, ring.length - Math.ceil((span + AFTER_LAST_PIECE_S) / PIECE_S));
  let start = guess;
  if (speech(ring[start], floor)) {
    while (start > 0 && guess - start < LOOK_BACK_S / PIECE_S && speech(ring[start - 1], floor)) start--;
  } else {
    while (start < ring.length - 1 && !speech(ring[start], floor)) start++;
  }
  const pieces = ring.slice(Math.max(0, start - 1));
  const quietest = Math.min(...pieces.map(level));
  let phraseEnd = start + Math.max(0, Math.round(span / PIECE_S) - 1);
  const dip = Math.max(...ring.slice(start, phraseEnd + 1).map(level)) / 5;
  while (phraseEnd < ring.length && level(ring[phraseEnd]) >= dip) phraseEnd++;
  // A request said straight on from the name leaves no dip to find. The name's sound is over before the last pieces heard,
  // so two of them as loud as a word are the request, and the name ended before them.
  const tail = Math.max(start + 1, ring.length - Math.round(SPOTTED_AFTER_S / PIECE_S));
  const loudTail = ring.slice(tail).filter((piece) => level(piece) >= dip && speech(piece, floor)).length;
  if (loudTail >= 2) phraseEnd = Math.min(phraseEnd, tail - 1);
  let lastVoice = -Infinity;
  for (let i = phraseEnd + 1; i < ring.length; i++) if (level(ring[i]) >= dip) lastVoice = (i + 1 - ring.length) * PIECE_S;
  heard = { pieces, quietest, spoke: lastVoice > -Infinity, sinceWake: 0, lastVoice };
  mode = streams ? 'streaming' : 'hearing';
  // The sound taken for the name goes with the wake: the spotter also wakes on what only sounds like it, and the service checks.
  const sound = pcmOf(pieces);
  self.postMessage({ t: 'wake', keyword: result.keyword, beforeS: pieces.length * PIECE_S, streaming: streams, sound }, [sound]);
  if (!streams) return;
  if (heard.spoke) for (const piece of pieces) send(piece);
  else heard.held = ring.slice(Math.max(phraseEnd + 1, ring.length - HELD_BACK_S / PIECE_S));
}

/** Streaming: every piece goes to the page as it is heard, once the first word after the phrase has come. A pause does not end it. */
function flow(piece) {
  heard.sinceWake += PIECE_S;
  heard.quietest = Math.min(heard.quietest, level(piece));
  const words = speech(piece, heard.quietest);
  if (heard.spoke) send(piece);
  else if (words) {
    for (const before of heard.held) send(before);
    heard.held = [];
    heard.spoke = true;
    send(piece);
  } else {
    heard.held.push(piece);
    if (heard.held.length > HELD_BACK_S / PIECE_S) heard.held.shift();
  }
  const silent = !heard.spoke && heard.sinceWake > NOTHING_SAID_S;
  if (!silent && heard.sinceWake < LONGEST_S) return;
  mode = 'held';
  self.postMessage({ t: silent ? 'nothing' : 'cut' });
}

/** A piece as /live carries it: 16-bit little-endian PCM. */
function send(piece) {
  const pcm = pcmOf([piece]);
  self.postMessage({ t: 'piece', pcm }, [pcm]);
}

/** Pieces end to end as 16-bit little-endian PCM. */
function pcmOf(pieces) {
  const pcm = new Int16Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const piece of pieces) for (const s of piece) pcm[at++] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  return pcm.buffer;
}

function record(piece) {
  heard.pieces.push(piece);
  heard.sinceWake += PIECE_S;
  heard.quietest = Math.min(heard.quietest, level(piece));
  if (speech(piece, heard.quietest)) {
    heard.spoke = true;
    heard.lastVoice = heard.sinceWake;
  }
  const paused = heard.spoke && heard.sinceWake - heard.lastVoice > PAUSE_S;
  const silent = !heard.spoke && heard.sinceWake > NOTHING_SAID_S;
  if (!paused && !silent && heard.sinceWake < LONGEST_S) return;
  mode = 'held';
  if (!heard.spoke) return self.postMessage({ t: 'nothing' });
  const wav = toWav(heard.pieces);
  self.postMessage({ t: 'recorded', wav, seconds: (heard.pieces.length * PIECE_S) }, [wav]);
}

/** The same rule as the page's recorder: speech is louder than both a floor and three times the quietest moment. */
function speech(piece, quietest) {
  return level(piece) > Math.max(0.015, quietest * 3);
}

function level(piece) {
  let sum = 0;
  for (const s of piece) sum += s * s;
  return Math.sqrt(sum / piece.length);
}

function toWav(pieces) {
  const count = pieces.reduce((n, p) => n + p.length, 0);
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, count * 2, true);
  let at = 44;
  for (const piece of pieces) {
    for (const s of piece) {
      view.setInt16(at, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
      at += 2;
    }
  }
  return bytes;
}

// ---- the model's word pieces

/** Piece to log probability, read from the SentencePiece model file: field 1 holds each piece, with its text (1) and score (2). */
function pieces(bytes) {
  const scores = new Map();
  for (const [field, value] of fields(bytes, 0, bytes.length)) {
    if (field !== 1 || !(value instanceof Uint8Array)) continue;
    let piece = '';
    let score = 0;
    for (const [inner, v] of fields(value, 0, value.length)) {
      if (inner === 1) piece = new TextDecoder().decode(v);
      if (inner === 2) score = new DataView(v.buffer, v.byteOffset, 4).getFloat32(0, true);
    }
    scores.set(piece, score);
  }
  return scores;
}

function* fields(bytes, start, end) {
  let at = start;
  const varint = () => {
    let n = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[at++];
      n += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (b < 0x80) return n;
    }
  };
  while (at < end) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) yield [field, varint()];
    else if (wire === 1) { yield [field, bytes.subarray(at, at + 8)]; at += 8; }
    else if (wire === 2) { const n = varint(); yield [field, bytes.subarray(at, at + n)]; at += n; }
    else if (wire === 5) { yield [field, bytes.subarray(at, at + 4)]; at += 4; }
    else throw new Error(`unknown wire type ${wire}`);
  }
}

/** The model is a unigram SentencePiece model, so the split of each word with the highest total log probability is the one it was trained on. */
function encode(text) {
  const out = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const s = `▁${word}`;
    const best = [{ score: 0, split: [] }];
    for (let end = 1; end <= s.length; end++) {
      best[end] = { score: -Infinity, split: null };
      for (let start = 0; start < end; start++) {
        const score = vocabulary.get(s.slice(start, end));
        if (score === undefined || !best[start].split) continue;
        if (best[start].score + score > best[end].score) best[end] = { score: best[start].score + score, split: [...best[start].split, s.slice(start, end)] };
      }
    }
    if (!best[s.length].split) return null;
    out.push(...best[s.length].split);
  }
  return out.join(' ');
}
