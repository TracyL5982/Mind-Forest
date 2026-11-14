/* global importScripts, createKws */
/**
 * The wake phrase, off the page's thread. Hears the microphone at 16 kHz from the audio thread, spots "hey <name>" or "hi <name>"
 * with sherpa-onnx's keyword spotter, then records until the speaker pauses and hands back that recording as a WAV.
 * Nothing is recorded before the phrase except a short ring of the last seconds, kept here, so the words right after it are not lost.
 *
 * mode: 'loading' | 'held' | 'waiting' | 'hearing'
 */
const VENDOR = new URL('../vendor/sherpa-onnx/', self.location).href;
const RATE = 16000;
const PIECE_S = 0.1;
const RING_S = 3;
const BEFORE_PHRASE_S = 0.3;
const SHORTEST_BEFORE_S = 0.9;
const PAUSE_S = 1.2;
const NOTHING_SAID_S = 8;
const LONGEST_S = 60;
const GREETINGS = ['HEY', 'HI'];

let mode = 'loading';
let tuning = null;
let name = '';
let kws = null;
let stream = null;
let fed = 0;
const ring = [];
let heard = null;
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
    if (mode !== 'loading') listen();
  } else if (m.t === 'hold') {
    if (mode !== 'loading') mode = 'held';
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
    maxActivePaths: 4,
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
  fed = 0;
  heard = null;
  mode = 'waiting';
}

function hear(piece) {
  ring.push(piece);
  while (ring.length * PIECE_S > RING_S) ring.shift();
  if (mode === 'waiting') spot(piece);
  else if (mode === 'hearing') record(piece);
}

function spot(piece) {
  const started = performance.now();
  stream.acceptWaveform(RATE, piece);
  fed += piece.length;
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

/** Starts the recording a moment before the phrase, which the spotter's timestamps place, so what follows it is kept whole. */
function wake(result) {
  const phrase = (result.start_time ?? 0) + (result.timestamps?.[0] ?? 0);
  const ago = fed / RATE - phrase + BEFORE_PHRASE_S;
  const before = Math.min(RING_S, Math.max(SHORTEST_BEFORE_S, Number.isFinite(ago) ? ago : SHORTEST_BEFORE_S));
  const pieces = ring.slice(-Math.ceil(before / PIECE_S));
  heard = { pieces, quietest: Math.min(...pieces.map(level)), spoke: false, sinceWake: 0, lastVoice: 0 };
  mode = 'hearing';
  self.postMessage({ t: 'wake', keyword: result.keyword, beforeS: pieces.length * PIECE_S });
}

/** The same rule as the page's recorder: speech is louder than both a floor and three times the quietest moment. */
function record(piece) {
  heard.pieces.push(piece);
  heard.sinceWake += PIECE_S;
  const loud = level(piece);
  heard.quietest = Math.min(heard.quietest, loud);
  if (loud > Math.max(0.015, heard.quietest * 3)) {
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
