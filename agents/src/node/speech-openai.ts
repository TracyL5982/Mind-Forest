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

const HEARING_MODEL = 'gpt-4o-transcribe';
const EXTENSION: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };

/** Words the user is likely to say: what they call the agent, and the titles of their cards. */
export interface Hints {
  name: string;
  words: string;
}

/** Turns recorded speech into text, told the words the user is likely to say. */
export type Transcribe = (audio: Uint8Array, mime: string, hints: Hints) => Promise<string>;

/**
 * Speech to text with OpenAI's transcription model, told what the user calls it and what their cards are called.
 * Measured on 24 spoken commands: names and topic words were the only errors, and the card titles removed nearly all of them.
 */
export function openaiTranscribe(send: typeof fetch, opts: { apiKey: string; model?: string }): Transcribe {
  return async (audio, mime, hints) => {
    const type = mime.split(';')[0]!.trim();
    const form = new FormData();
    form.append('model', opts.model || HEARING_MODEL);
    form.append('file', new Blob([audio as BlobPart], { type }), `speech.${EXTENSION[type] ?? 'webm'}`);
    const cards = hints.words ? ` Their cards include: ${hints.words}.` : '';
    form.append('prompt', `Someone is talking to their brainstorming app, which they call ${hints.name}, and may begin with "Hey ${hints.name}".${cards}`);
    const res = await send('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`OpenAI transcription answered ${res.status}`);
    return (((await res.json()) as { text?: string }).text ?? '').trim();
  };
}
