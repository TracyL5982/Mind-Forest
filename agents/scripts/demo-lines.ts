/**
 * Writes down what Momo says in each round of the walkthrough demo, and records it. For each round the real Momo is asked: the
 * realtime model with her own instructions, told where the user is, given the user's line, and then given the very notes a real
 * round gives her as its cards land (`Narration`), on the round's own schedule. Each answer is recorded in her voice at once,
 * since how long she talks decides which cards have landed by the time she is free for the next remark.
 *
 * It writes `demo/lines.json` and one recording per line in `demo/voice/`. A round that is written already is left as it is.
 * Usage: node --no-warnings --import tsx scripts/demo-lines.ts [--only r1,n2] [--again] [--check]
 *   --again   writes the named rounds afresh.
 *   --check   has every recording written out again from its sound, and says where the words differ from the line.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { toolSpecs, whereNote } from '../src/core/voice-tools.ts';
import { spokenName } from '../src/core/wake.ts';
import { LinesFile, recordingName } from '../src/demo/lines.ts';
import { loadScript, type ScriptPhase } from '../src/demo/script.ts';
import { planLines, type Line } from '../src/demo/take.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { loadEnv } from '../src/node/env.ts';
import { instructions, type RealtimeEvent } from '../src/node/live.ts';
import { startServer } from '../src/node/server.ts';
import { openaiRealtime, openaiSpeech, openaiTranscribe, SPEECH_VOICE } from '../src/node/speech-openai.ts';
import { DEFAULT_SETTINGS } from '../src/core/roles/types.ts';

const root = resolve(import.meta.dirname, '..');
const demoDir = join(root, 'demo');
const env = loadEnv();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const only = args.includes('--only') ? new Set((args[args.indexOf('--only') + 1] ?? '').split(',')) : null;
if (!env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set: Momo cannot be asked or recorded.');
  process.exit(1);
}
const apiKey = env.OPENAI_API_KEY;
const voice = env.MIND_PALACE_VOICE || SPEECH_VOICE;
const model = env.MIND_PALACE_LIVE_MODEL || 'gpt-realtime-2.1';
const name = spokenName(DEFAULT_SETTINGS.agentName);
const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * What Momo is told beside her own instructions here: what the demo told her before her lines were recorded, so she answers a
 * round's line as she would live, with a few words of her own and then the search.
 */
const RECORDING = `# Recording a walkthrough
The user is recording a walkthrough of one tree, and each thing they say is a take. So, only here:
- With no tree open, "let's jam on…", "let's brainstorm…" or a subject alone asks for a tree: say a few lively words of your own and call start_tree with the subject, and ask nothing first.
- A [Where the user is] note may end with a line that begins "Recording:". When it says a new layer: say a few lively words of your own and call find_new on the open card, their words as the need, even when they put it as a question, a reaction or a single word, and ask nothing back. When it says to answer aloud: answer from the card in a sentence or two, and call no tool.
- A round here lands many cards at once. At [More cards landed] with more than two cards, never say their titles one after another: say how many came and name the one you like best, in one short line.`;
const STARTED = JSON.stringify({ started: true, note: 'Started. Cards will land over the next seconds and you will get a note as each does. Describe none until then.' });

const spent = { responses: 0, tokens: 0, spoken: 0, seconds: 0, heard: 0 };

/** One conversation with the realtime model, in text: each `ask` gives what she says next. */
function conversation() {
  let waiting: { text: string; done: (text: string) => void; fail: (err: Error) => void } | null = null;
  const session = openaiRealtime({ apiKey, model })({
    event: (e: RealtimeEvent) => {
      if (e.type === 'error') return waiting?.fail(new Error(JSON.stringify(e.error)));
      if (e.type === 'response.output_text.delta' && waiting) waiting.text += String(e.delta ?? '');
      if (e.type !== 'response.done' || !waiting) return;
      const response = e.response as { status?: string; usage?: { total_tokens?: number }; output?: { type: string; call_id?: string; content?: { type: string; text?: string }[] }[] };
      spent.responses++;
      spent.tokens += response.usage?.total_tokens ?? 0;
      const said = (response.output ?? []).flatMap((out) => (out.type === 'message' ? (out.content ?? []).map((c) => c.text ?? '') : [])).join(' ').trim() || waiting.text.trim();
      // A call she made is answered as the service answers it, and she is asked for nothing more: its cards come as notes.
      for (const out of response.output ?? []) if (out.type === 'function_call' && out.call_id) session.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: out.call_id, output: STARTED } });
      const { done } = waiting;
      waiting = null;
      done(said.replace(/\s+/g, ' '));
    },
    closed: (why: string) => waiting?.fail(new Error(why)),
  });
  session.send({
    type: 'session.update',
    session: { type: 'realtime', model, output_modalities: ['text'], instructions: `${instructions(name, today)}\n\n${RECORDING}`, tools: toolSpecs(), tool_choice: 'auto' },
  });
  const note = (text: string) => session.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
  const ask = () =>
    new Promise<string>((done, fail) => {
      waiting = { text: '', done, fail };
      session.send({ type: 'response.create' });
      setTimeout(() => waiting && fail(new Error('the realtime model did not answer in 40 s')), 40_000).unref();
    });
  return {
    note,
    said: (text: string) => session.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }),
    ask,
    close: () => session.close(),
  };
}

const speak = openaiSpeech(fetch, { apiKey, model: env.MIND_PALACE_VOICE_MODEL, voice, format: 'pcm', firstByteMs: 30_000 });
const voiceDir = join(demoDir, 'voice');
mkdirSync(voiceDir, { recursive: true });

/** The line recorded in Momo's voice, kept by its words, and how long it is. */
async function record(text: string): Promise<number> {
  const file = join(voiceDir, recordingName(voice, text));
  if (!existsSync(file)) {
    writeFileSync(file, new Uint8Array(await new Response(await speak(text, AbortSignal.timeout(60_000))).arrayBuffer()));
    spent.spoken++;
  }
  const ms = readFileSync(file).length / 48;
  spent.seconds += ms / 1000;
  return ms;
}

const script = loadScript(join(demoDir, 'script.json'));
const file = join(demoDir, 'lines.json');
const lines: LinesFile = existsSync(file) ? LinesFile.parse(JSON.parse(readFileSync(file, 'utf8'))) : { version: 1, voice, rounds: {} };
if (lines.voice !== voice) {
  console.error(`demo/lines.json was recorded in the voice "${lines.voice}", and this run would record in "${voice}". Delete it and demo/voice to change voices.`);
  process.exit(1);
}

if (flag('--check')) {
  // Each recording is written out again from its sound alone, and the words are compared with the line as it is written.
  const hear = openaiTranscribe(fetch, { apiKey, model: env.MIND_PALACE_HEARING_MODEL });
  const words = (text: string) => text.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ');
  const wav = (pcm: Uint8Array) => {
    const out = new Uint8Array(44 + pcm.length);
    const view = new DataView(out.buffer);
    const tag = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    tag(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); tag(8, 'WAVE'); tag(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, pcm.length, true);
    out.set(pcm, 44);
    return out;
  };
  let same = 0;
  let checked = 0;
  for (const [round, said] of Object.entries(lines.rounds)) {
    if (only && !only.has(round)) continue;
    for (const line of said) {
      const recording = join(voiceDir, recordingName(voice, line.text));
      if (!line.text || !existsSync(recording)) continue;
      const heard = await hear(wav(new Uint8Array(readFileSync(recording))), 'audio/wav', { name, words: '' });
      spent.heard++;
      checked++;
      const [a, b] = [words(line.text), words(heard)];
      if (a.join(' ') === b.join(' ')) same++;
      else console.log(`${round} ${line.id}: the words differ\n  written: ${line.text}\n  heard:   ${heard}`);
    }
  }
  console.log(`${same} of ${checked} recordings were heard word for word as written (${spent.heard} transcriptions)`);
  process.exit(0);
}

// A copy of the demo with stand-in roles tells where the user is at each round as the real service would, at no cost.
const dataDir = mkdtempSync(join(tmpdir(), 'mp-demo-lines-'));
const run = await startServer({ port: 0, host: '127.0.0.1', dataDir, clientDir: join(root, 'client'), model: new FakeModel(), roles: fakeRoles, token: 'lines', demo: { script, mediaDir: join(demoDir, 'media') } });
const titleOf = new Map(script.phases.flatMap((phase) => phase.cards.map((card): [string, string] => [card.id, card.title])));

async function write(phase: ScriptPhase): Promise<Line[]> {
  await run.demo!.goto(phase.id);
  const head = phase.head === 'root' ? undefined : [...run.mind.nodes.values()].find((node) => run.mind.item(node.itemId).title === titleOf.get(phase.head));
  const under = head ? run.mind.item(head.itemId).title : script.topic;
  const where = head
    ? `${whereNote(run.pipeline.ctx, { focus: head.id, treeId: head.treeId, selection: [] })}\nRecording: with this card open, the next thing the user says ${phase.cards.length > 0 ? 'asks for a new layer on it' : 'is a question to answer aloud from this card'}.`
    : whereNote(run.pipeline.ctx, { selection: [] });
  const momo = conversation();
  try {
    momo.note(`[Where the user is] ${where}`);
    return await planLines(phase, under, async ({ kind, cards, note }) => {
      // Many cards at once: the demo has always asked her to count them and name one, where the live note asks for every name.
      if (note) momo.note(kind === 'more' && cards.length > 2 ? note.replace(/Tell the user in one short sentence that names them\.$/, 'Say how many came and name the one you like best, in one short sentence.') : note);
      else momo.said(phase.say.replace(/^hey momo,?\s*/i, ''));
      let text = await momo.ask();
      // She may call the search without a word: then she is asked once more for the words that go with it.
      if (!text && kind === 'answer') text = await momo.ask();
      const ms = text ? await record(text) : 0;
      console.log(`  ${kind.padEnd(6)} ${(ms / 1000).toFixed(1).padStart(5)} s  ${text}`);
      return { text, ms };
    });
  } finally {
    momo.close();
  }
}

try {
  for (const phase of script.phases) {
    if (only && !only.has(phase.id)) continue;
    if (lines.rounds[phase.id] && !flag('--again')) continue;
    console.log(`${phase.id}: ${phase.title} (${phase.say ? `"${phase.say}"` : phase.ask ? `the question "${phase.ask}" picked` : 'no words'}, ${phase.cards.length} cards)`);
    lines.rounds[phase.id] = await write(phase);
    writeFileSync(file, `${JSON.stringify(lines, null, 1)}\n`);
  }
} finally {
  await run.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(`${spent.responses} answers from the realtime model (${spent.tokens} tokens), ${spent.spoken} lines recorded, ${spent.seconds.toFixed(0)} s of Momo's voice in the rounds written`);
process.exit(0);
