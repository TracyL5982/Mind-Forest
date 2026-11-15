/** Written last by scripts/fetch-wake.ts, so it is there only when every listener file is. */
const LISTENER = 'vendor/sherpa-onnx/versions.json';
/** Measured on synthetic speech (scripts/wake-measure.py, DECISIONS.md). */
const TUNING = { threshold: 0.05, boost: 2.0, highForHi: true };
const AFTER_REPLY_MS = 300;
/** A reply that never reports its end stops holding the listener after this long. */
const LONGEST_REPLY_MS = 90000;

/** Why this page cannot listen for the agent's name, or null when it can. */
export async function wakeProblem() {
  if (!window.isSecureContext) return 'the microphone only works on a secure address (https, or localhost)';
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.Worker || typeof WebAssembly !== 'object') return 'this browser cannot run the listener';
  const found = await fetch(LISTENER, { cache: 'no-store' }).then((r) => r.ok, () => false);
  return found ? null : 'the listener files are not on this service (npm run fetch-wake)';
}

/**
 * Hands-free talking. While on, the page listens on this device for "hey <name>" or "hi <name>" and sends no sound anywhere.
 * On the phrase it chimes, records until the speaker pauses, and hands the recording to `onRecorded`. It does not listen while a reply plays.
 * state: 'off' | 'starting' | 'waiting' | 'hearing' | 'working' | 'speaking'
 */
export class HandsFree {
  constructor({ onState, onRecorded, onProblem }) {
    Object.assign(this, { onState, onRecorded, onProblem });
    this.state = 'off';
    this.replying = false;
    this.parts = null;
    this.resume = null;
  }

  get on() {
    return this.state !== 'off';
  }

  async start(name) {
    if (this.on) return;
    this.name = name;
    this.set('starting');
    const worker = new Worker('js/wake-worker.js');
    const channel = new MessageChannel();
    const parts = { worker, stream: null, context: null, cancel: null };
    this.parts = parts;
    const current = () => {
      if (this.parts !== parts) throw new Error('stopped while starting');
    };
    try {
      await new Promise((ready, failed) => {
        parts.cancel = failed;
        worker.onmessage = (event) => {
          if (event.data.t === 'ready') ready();
          if (event.data.t === 'failed') failed(new Error(event.data.message));
        };
        worker.onerror = (event) => failed(new Error(event.message || 'the listener did not load'));
        worker.postMessage({ t: 'start', name, tuning: TUNING, audio: channel.port2 }, [channel.port2]);
      });
      current();
      parts.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      current();
      const source = microphoneAt16k(parts);
      await parts.context.audioWorklet.addModule('js/wake-tap.js');
      current();
      const tap = new AudioWorkletNode(parts.context, 'wake-tap');
      const silent = parts.context.createGain();
      silent.gain.value = 0;
      source.connect(tap).connect(silent).connect(parts.context.destination);
      tap.port.postMessage(channel.port1, [channel.port1]);
    } catch (err) {
      // Pressed off while starting: whatever this start opened is closed, and a newer start is left alone.
      if (this.parts !== parts) return release(parts);
      this.stop();
      this.onProblem(err?.name === 'NotAllowedError' ? 'The microphone is blocked for this page.' : `Listening could not start: ${err?.message ?? err}`);
      return;
    }
    worker.onmessage = (event) => this.heard(event.data);
    worker.onerror = (event) => this.heard({ t: 'failed', message: event.message || 'the listener crashed' });
    this.set('waiting');
    this.sync();
  }

  stop() {
    if (this.parts) release(this.parts);
    this.parts = null;
    this.set('off');
  }

  /** A new name rebuilds the spotter, which drops a phrase being said, so the same name does nothing. */
  rename(name) {
    if (name === this.name) return;
    this.name = name;
    this.parts?.worker.postMessage({ t: 'name', name });
  }

  /** The recording has been dealt with: listen for the name again. */
  done() {
    if (this.state === 'working') this.set('waiting');
    this.sync();
  }

  /** A reply started or stopped playing. The room's echo of it fades for a moment before listening starts again. */
  replyPlaying(playing) {
    clearTimeout(this.resume);
    this.replying = true;
    this.resume = setTimeout(() => {
      this.replying = false;
      this.sync();
    }, playing ? LONGEST_REPLY_MS : AFTER_REPLY_MS);
    this.sync();
  }

  /** How busy the listener is: milliseconds spent spotting, and seconds of sound it spotted in. */
  busy() {
    return new Promise((answer) => {
      const worker = this.parts?.worker;
      if (!worker) return answer(null);
      worker.addEventListener('message', function once(event) {
        if (event.data.t !== 'busy') return;
        worker.removeEventListener('message', once);
        answer({ decodeMs: event.data.decodeMs, audioS: event.data.audioS });
      });
      worker.postMessage({ t: 'busy' });
    });
  }

  heard(m) {
    if (m.t === 'wake') {
      chime(this.parts?.context);
      this.set('hearing');
    } else if (m.t === 'nothing') {
      this.set('waiting');
      this.sync();
      this.onProblem('Nothing was said after the name.');
    } else if (m.t === 'recorded') {
      this.set('working');
      this.onRecorded(new Blob([m.wav], { type: 'audio/wav' }));
    } else if (m.t === 'failed') {
      this.stop();
      this.onProblem(`Listening stopped: ${m.message}.`);
    } else if (m.t === 'unspellable') {
      this.onProblem(`"${m.name}" cannot be listened for, so the page still listens for the old name.`);
    }
  }

  /** Between recordings the listener spots the name, except while a reply plays. While hearing or working it holds by itself. */
  sync() {
    if (!this.parts || (this.state !== 'waiting' && this.state !== 'speaking')) return;
    this.set(this.replying ? 'speaking' : 'waiting');
    this.parts.worker.postMessage({ t: this.replying ? 'hold' : 'listen' });
  }

  set(state) {
    this.state = state;
    this.onState(state);
  }
}

/** Closes what a start opened. Safe to call again on the same parts. */
function release(parts) {
  parts.cancel?.(new Error('stopped'));
  parts.worker.terminate();
  for (const track of parts.stream?.getTracks() ?? []) track.stop();
  void parts.context?.close().catch(() => {});
  parts.stream = null;
  parts.context = null;
}

/** The microphone at the spotter's own rate where the browser can resample it, and at the device's rate where it cannot (the tap then averages it down). */
function microphoneAt16k(parts) {
  try {
    parts.context = new AudioContext({ sampleRate: 16000 });
    return parts.context.createMediaStreamSource(parts.stream);
  } catch {
    void parts.context?.close();
    parts.context = new AudioContext();
    return parts.context.createMediaStreamSource(parts.stream);
  }
}

/** Two short rising notes: the agent heard its name. */
function chime(context) {
  if (!context) return;
  const now = context.currentTime;
  for (const [i, pitch] of [660, 990].entries()) {
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = pitch;
    gain.gain.setValueAtTime(0, now + i * 0.09);
    gain.gain.linearRampToValueAtTime(0.18, now + i * 0.09 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.12);
    tone.connect(gain).connect(context.destination);
    tone.start(now + i * 0.09);
    tone.stop(now + i * 0.09 + 0.13);
  }
}
