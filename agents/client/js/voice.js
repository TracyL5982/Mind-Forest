const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const RECORDING = ['audio/webm', 'audio/mp4', 'audio/ogg'];
const PAUSE_MS = 1200;
const NOTHING_SAID_MS = 8000;
const LONGEST_MS = 60000;

/**
 * The microphone. When the service hears better than the browser (`serviceHears`), sound is recorded,
 * stopped when the speaker pauses, and sent to be transcribed. Otherwise the browser's own recognition
 * is used when it has one, and recording with a tap to stop when it does not.
 * state: 'idle' | 'listening' | 'working'
 */
export class Voice {
  constructor({ onWords, onState, onProblem, transcribe }) {
    Object.assign(this, { onWords, onState, onProblem, transcribe });
    this.live = Boolean(Recognition);
    this.serviceHears = false;
    this.active = null;
  }

  get available() {
    return this.live || Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  toggle() {
    if (this.active) return this.active.stop();
    hush();
    if (this.serviceHears) return this.record({ untilPause: true });
    if (this.live) return this.listen();
    return this.record({ untilPause: false });
  }

  listen() {
    const rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let heard = '';
    rec.onresult = (event) => {
      heard = [...event.results].map((result) => result[0].transcript).join(' ').trim();
      if (heard) this.onWords(heard, false);
    };
    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      // Chrome's recognition needs Google's servers. Off the internet it fails, so record instead.
      this.live = false;
      this.onProblem(event.error === 'not-allowed' ? 'The microphone is blocked for this page.' : 'Live speech is not available here. Tap the microphone again to record instead.');
    };
    rec.onend = () => {
      this.active = null;
      this.onState('idle');
      if (heard) this.onWords(heard, true);
    };
    this.active = rec;
    this.onState('listening');
    try {
      rec.start();
    } catch {
      this.active = null;
      this.onState('idle');
    }
  }

  async record({ untilPause }) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return this.onProblem(window.isSecureContext ? 'This browser cannot record sound.' : 'The microphone only works on a secure address (https, or localhost).');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return this.onProblem('The microphone is blocked for this page.');
    }
    const mimeType = RECORDING.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const pause = untilPause ? watchForPause(stream, () => recorder.state === 'recording' && recorder.stop()) : null;
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      this.active = null;
      if (pause && !pause.stop()) {
        this.onState('idle');
        return this.onProblem('Nothing was heard.');
      }
      this.onState('working');
      try {
        const text = (await this.transcribe(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }))).trim();
        if (text) this.onWords(text, true);
        else this.onProblem('Nothing was heard.');
      } catch {
        this.onProblem('That recording could not be turned into text.');
      }
      this.onState('idle');
    };
    this.active = recorder;
    this.onState('listening');
    recorder.start();
  }
}

/**
 * Calls `done` once the speaker has talked and then gone quiet, or never talked, or talked too long.
 * Loudness is judged against the quietest moment so far, so a noisy room needs a louder voice.
 * Returns `stop()`, which ends the watch and says whether any speech was heard.
 */
function watchForPause(stream, done) {
  const context = new AudioContext();
  const meter = context.createAnalyser();
  meter.fftSize = 2048;
  context.createMediaStreamSource(stream).connect(meter);
  const samples = new Float32Array(meter.fftSize);
  const started = performance.now();
  let quietest = Infinity;
  let spoke = false;
  let lastVoice = started;
  const timer = setInterval(() => {
    meter.getFloatTimeDomainData(samples);
    const level = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    quietest = Math.min(quietest, level);
    const now = performance.now();
    if (level > Math.max(0.015, quietest * 3)) {
      spoke = true;
      lastVoice = now;
    }
    if ((spoke && now - lastVoice > PAUSE_MS) || (!spoke && now - started > NOTHING_SAID_MS) || now - started > LONGEST_MS) done();
  }, 100);
  return {
    stop() {
      clearInterval(timer);
      void context.close();
      return spoke;
    },
  };
}

let playing = null;
let onPlaying = () => {};

/** Tells `listener` when a reply starts and stops being heard, so a microphone can stop listening meanwhile. */
export function watchReplies(listener) {
  onPlaying = listener;
}

/** Plays the service's voice for a reply. Without one, or if it fails, the browser's own voice reads it. */
export function speak(text, url) {
  hush();
  onPlaying(true);
  if (!url) return browserSpeak(text);
  const audio = new Audio(url);
  playing = audio;
  const fallback = () => {
    if (playing !== audio) return;
    browserSpeak(text);
  };
  audio.onerror = fallback;
  audio.onended = () => {
    if (playing !== audio) return;
    playing = null;
    onPlaying(false);
  };
  audio.play().catch(fallback);
}

function browserSpeak(text) {
  if (!('speechSynthesis' in window)) {
    playing = null;
    return onPlaying(false);
  }
  window.speechSynthesis.cancel();
  const line = new SpeechSynthesisUtterance(text);
  playing = line;
  const ended = () => {
    if (playing !== line) return;
    playing = null;
    onPlaying(false);
  };
  line.onend = line.onerror = ended;
  // Some browsers never report that a line ended, and a microphone waiting for it would wait for good.
  setTimeout(ended, 2000 + text.length * 90);
  window.speechSynthesis.speak(line);
}

export function hush() {
  const was = playing;
  playing = null;
  if (was instanceof HTMLAudioElement) {
    was.pause();
    was.removeAttribute('src');
    was.load();
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (was) onPlaying(false);
}
