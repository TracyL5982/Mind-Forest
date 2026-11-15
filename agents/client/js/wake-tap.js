const RATE = 16000;
const PIECE = RATE / 10;

/**
 * Taps the microphone in the audio thread: brings it to 16 kHz and posts it in 100 ms pieces to the port it is given.
 * A context already at 16 kHz passes samples through. Any other rate is averaged down, which is enough for speech.
 */
class WakeTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / RATE;
    this.at = 0;
    this.sum = 0;
    this.count = 0;
    this.piece = new Float32Array(PIECE);
    this.filled = 0;
    this.out = null;
    this.port.onmessage = (event) => { this.out = event.data; };
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples || !this.out) return true;
    for (const sample of samples) {
      this.sum += sample;
      this.count += 1;
      this.at += 1;
      if (this.at < this.step) continue;
      this.at -= this.step;
      this.piece[this.filled++] = this.sum / this.count;
      this.sum = 0;
      this.count = 0;
      if (this.filled === PIECE) {
        this.out.postMessage(this.piece, [this.piece.buffer]);
        this.piece = new Float32Array(PIECE);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('wake-tap', WakeTap);
