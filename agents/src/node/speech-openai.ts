export const SPEECH_VOICE = 'marin';
const SPEECH_MODEL = 'gpt-4o-mini-tts';
const MANNER = 'Warm, calm and unhurried, like a friend who knows a lot and is glad to share it. Natural pauses. Not salesy.';

export type Speak = (text: string, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;

/** Spoken replies from OpenAI's speech model, as MP3 that arrives while it is made, so playback starts early. */
export function openaiSpeech(send: typeof fetch, opts: { apiKey: string; model?: string; voice?: string }): Speak {
  return async (text, signal) => {
    const res = await send('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model || SPEECH_MODEL, voice: opts.voice || SPEECH_VOICE, input: text, instructions: MANNER, response_format: 'mp3' }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`OpenAI speech answered ${res.status}`);
    return res.body;
  };
}
