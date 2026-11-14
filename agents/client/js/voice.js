const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const RECORDING = ['audio/webm', 'audio/mp4', 'audio/ogg'];

/**
 * The microphone. The browser's own speech recognition is used when it has one: it gives words as
 * they are spoken. Otherwise, or once that has failed, sound is recorded and sent to be transcribed.
 * state: 'idle' | 'listening' | 'working'
 */
export class Voice {
  constructor({ onWords, onState, onProblem, transcribe }) {
    Object.assign(this, { onWords, onState, onProblem, transcribe });
    this.live = Boolean(Recognition);
    this.active = null;
  }

  get available() {
    return this.live || Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  toggle() {
    if (this.active) return this.active.stop();
    if (this.live) return this.listen();
    return this.record();
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

  async record() {
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
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      this.active = null;
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

let playing = null;

/** Plays the service's voice for a reply. Without one, or if it fails, the browser's own voice reads it. */
export function speak(text, url) {
  hush();
  if (!url) return browserSpeak(text);
  const audio = new Audio(url);
  playing = audio;
  const fallback = () => {
    if (playing !== audio) return;
    playing = null;
    browserSpeak(text);
  };
  audio.onerror = fallback;
  audio.onended = () => { if (playing === audio) playing = null; };
  audio.play().catch(fallback);
}

function browserSpeak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

export function hush() {
  if (playing) {
    const audio = playing;
    playing = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
