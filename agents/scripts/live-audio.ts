// Audio for the live voice's measuring scripts: speech made into files, read back, and changed in rate.
import { readFileSync } from 'node:fs';

/** 24 kHz PCM to 16 kHz, by straight lines between samples. */
export function down(pcm: Buffer): Int16Array {
  const n = pcm.length >> 1;
  const out = new Int16Array(Math.floor((n * 2) / 3));
  for (let k = 0; k < out.length; k++) {
    const x = (k * 3) / 2;
    const i = Math.floor(x);
    const a = pcm.readInt16LE(Math.min(i, n - 1) * 2);
    const b = pcm.readInt16LE(Math.min(i + 1, n - 1) * 2);
    out[k] = Math.round(a + (b - a) * (x - i));
  }
  return out;
}

export function wav(samples: Int16Array, rate: number): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

export function samplesOf(file: string): Int16Array {
  const bytes = readFileSync(file);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'data') return new Int16Array(bytes.buffer.slice(bytes.byteOffset + at + 8, bytes.byteOffset + at + 8 + size));
    at += 8 + size + (size & 1);
  }
  throw new Error(`${file} has no data chunk`);
}

/** Words said by OpenAI's speech model, as 24 kHz 16-bit mono PCM. */
export async function speech(key: string, words: string, voice: string, manner: string): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: words, response_format: 'pcm', instructions: manner }),
  });
  if (!res.ok) throw new Error(`speech ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

