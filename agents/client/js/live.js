const RETRY_MS = 5000;
/** A little room before the first piece plays, so the next one arrives before it runs out. */
const LEAD_S = 0.05;

/**
 * Momo's live voice: the service's `/live` socket (docs/protocol.md, "The live voice"). After the name the page's microphone goes to the
 * service, whose realtime model hears the turn and answers it as Momo, and Momo's voice comes back and plays as it arrives, one
 * response after another.
 * `onReady(on)`: the voice is there or gone. `onOver()`: the user's turn has been heard and is on its way. `onHeard(text, final)`: what
 * the user said so far. `onQuiet()`: no reply is coming, or the voice failed. `onSpeaking(playing, interruptible)`: Momo started or
 * stopped being heard; saying the name stops it unless what it says names itself. `onText(text)`: what Momo has said so far.
 * `onNotNamed()`: the service found that what woke the page was not the name, so the turn it began is dropped.
 */
export class LiveVoice {
  constructor({ token, connection, name, onReady, onOver, onHeard, onQuiet, onSpeaking, onText, onNotNamed }) {
    Object.assign(this, { token, connection, name, onReady, onOver, onHeard, onQuiet, onSpeaking, onText, onNotNamed });
    this.ready = false;
    this.rate = 24000;
    /** The latest turn, and whether the microphone goes to the service for it. */
    this.turns = 0;
    this.streaming = false;
    this.context = null;
    this.sources = new Set();
    this.until = 0;
    /** The response heard last, and whether all of it has come. */
    this.current = null;
    this.complete = false;
    this.speaking = false;
    this.interruptible = true;
    /** Muted, Momo's responses go on being followed, unheard. */
    this.muted = false;
    this.open();
  }

  get scheme() {
    return location.protocol === 'https:' ? 'wss' : 'ws';
  }

  open() {
    const ws = new WebSocket(`${this.scheme}://${location.host}/live?token=${encodeURIComponent(this.token)}&connection=${encodeURIComponent(this.connection ?? '')}`);
    this.ws = ws;
    ws.onmessage = (event) => {
      if (this.ws === ws) this.frame(JSON.parse(event.data));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.ready;
      this.ready = false;
      const turn = this.streaming;
      this.streaming = false;
      this.stop();
      if (turn) this.onQuiet();
      if (was) this.onReady(false);
      this.retry = setTimeout(() => this.open(), RETRY_MS);
    };
  }

  /** The page's /ws connection, whose own work Momo walks through: a new one, after a reconnect, opens /live again for it. */
  link(connection) {
    if (connection === this.connection) return;
    this.connection = connection;
    const old = this.ws;
    this.open();
    old?.close();
  }

  /** Playing needs a gesture in most browsers: call this from one, such as the press that starts listening. */
  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume();
  }

  /** The user said the name: a new turn, and whatever Momo is saying stops. False when there is no live voice. */
  start(scene) {
    if (!this.ready) return false;
    this.stop();
    this.streaming = true;
    this.send({ t: 'start', turn: ++this.turns, scene });
    return true;
  }

  /**
   * The sound that woke the page, 16-bit PCM at 16 kHz, for the service to check: the spotter also wakes on what only sounds like the
   * name. Nothing waits for the answer here. If it was not the name, the service drops the turn and `onNotNamed` is called.
   */
  named(pcm) {
    if (this.ready) this.send({ t: 'name', pcm: base64(new Uint8Array(pcm)) });
  }

  /** 16-bit PCM at 16 kHz, heard after the name. */
  audio(pcm) {
    if (this.streaming) this.send({ t: 'audio', pcm: base64(new Uint8Array(pcm)) });
  }

  /** The page stopped streaming at its longest: what was sent is the turn. */
  end() {
    if (this.streaming) this.send({ t: 'end' });
    this.streaming = false;
  }

  /** Nothing was said after the name. */
  cancel() {
    if (this.streaming) this.send({ t: 'cancel' });
    this.streaming = false;
  }

  /** Stops Momo at once, and drops what was waiting to be heard. */
  stop() {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
    }
    this.sources.clear();
    this.until = 0;
    this.current = null;
    this.hushed();
  }

  send(frame) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  frame(f) {
    if (f.t === 'ready') {
      this.ready = true;
      this.rate = f.rate;
      this.onReady(true);
    } else if (f.t === 'over') {
      if (f.turn !== this.turns) return;
      this.streaming = false;
      this.onOver();
    } else if (f.t === 'heard') {
      if (f.turn === this.turns && f.text) this.onHeard(f.text, f.final);
    } else if (f.t === 'quiet') {
      if (f.turn === this.turns) this.onQuiet();
    } else if (f.t === 'failed') {
      this.streaming = false;
      this.stop();
      this.onQuiet();
    } else if (f.t === 'name') {
      if (f.ok) return;
      this.streaming = false;
      this.stop();
      this.onNotNamed?.();
    } else if (this.streaming) {
      // Sound and words for an answer the user's new turn is cancelling.
    } else if (f.t === 'audio') {
      this.play(f.id, f.pcm);
    } else if (f.t === 'text') {
      this.onText(f.text);
      const interruptible = !f.text.toLowerCase().includes(this.name().toLowerCase());
      if (interruptible === this.interruptible) return;
      this.interruptible = interruptible;
      if (this.speaking) this.onSpeaking(true, interruptible);
    } else if (f.t === 'done') {
      if (f.id === this.current) this.complete = true;
      this.settle();
    }
  }

  /** A piece of response `id`, heard unless muted. */
  play(id, pcm) {
    if (id !== this.current) {
      this.current = id;
      this.complete = false;
    }
    if (!this.muted) this.schedule(pcm);
    if (!this.speaking) {
      this.speaking = true;
      this.onSpeaking(true, this.interruptible);
    }
  }

  /** Queues a piece after what is already queued, so one response follows another without overlapping. */
  schedule(pcm) {
    this.context ??= new AudioContext();
    const bytes = Uint8Array.from(atob(pcm), (c) => c.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    if (samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, this.rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const at = Math.max(this.context.currentTime + LEAD_S, this.until);
    source.start(at);
    this.until = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      this.settle();
    };
  }

  /** Momo has stopped being heard once everything queued has played and the last response has no more to come. */
  settle() {
    if (this.sources.size === 0 && (this.complete || this.current === null)) this.hushed();
  }

  hushed() {
    if (!this.speaking) return;
    this.speaking = false;
    this.interruptible = true;
    this.onSpeaking(false, false);
  }
}

function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
