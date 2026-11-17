/**
 * Writes down what Momo says in each round of the walkthrough demo, in her own live voice. For each round the real Momo is asked:
 * the realtime model with her own instructions and her voice, told where the user is, given the user's line, and then given the
 * very notes a real round gives her as its cards land (`Narration`), on the round's own schedule. What she answers aloud is the
 * recording, and what she says she said is the line's text, so the words and the delivery are hers. How long she talks decides
 * which cards have landed by the time she is free for the next remark.
 *
 * Each recording is written out again from its sound. One whose words are not the text's is recorded again by asking her to say
 * the line as written (`momo-voice.ts`). If she does not, the closest wording she did say becomes the line. No other voice is used.
 *
 * It writes `demo/lines.json`, one recording per line in `demo/voice/`, and `demo/voice/voices.json`, which says which voice each
 * recording is in. A round that is written already is left as it is.
 * Usage: node --no-warnings --import tsx scripts/demo-lines.ts [--only r1,n2] [--again] [--check]
 *   --again   writes the named rounds afresh.
 *   --check   has every recording written out again from its sound, and says where the words differ from the line.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { toolSpecs, whereNote } from '../src/core/voice-tools.ts';
import { spokenName } from '../src/core/wake.ts';
import { LinesFile, recordingName } from '../src/demo/lines.ts';
import { loadScript, type ScriptPhase } from '../src/demo/script.ts';
import { compare, record as recordLine, wavOf, type Voice, type VoiceOptions } from '../src/demo/momo-voice.ts';
import { planLines, type Line, type LineKind } from '../src/demo/take.ts';
import { FakeModel } from '../src/fake/model.ts';
import { fakeRoles } from '../src/fake/roles.ts';
import { loadEnv } from '../src/node/env.ts';
import { cost, instructions, type RealtimeEvent, type Usage } from '../src/node/live.ts';
import { startServer } from '../src/node/server.ts';
import { openaiRealtime, openaiTranscribe, SPEECH_VOICE } from '../src/node/speech-openai.ts';
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

const spent = { responses: 0, dollars: 0, seconds: 0, heard: 0, own: 0, retaken: 0, takes: 0, reworded: 0 };
/** The most this run may spend on the realtime model, in dollars, by its own count. */
const BUDGET = 12;

/** One conversation with the realtime model, aloud: each `ask` gives what she says next, as sound, and what she says she said. */
function conversation() {
  let waiting: { chunks: Buffer[]; said: string; done: (out: { pcm: Uint8Array; text: string }) => void; fail: (err: Error) => void } | null = null;
  const session = openaiRealtime({ apiKey, model })({
    event: (e: RealtimeEvent) => {
      if (e.type === 'error') return waiting?.fail(new Error(JSON.stringify(e.error)));
      if (e.type === 'response.output_audio.delta' && waiting) waiting.chunks.push(Buffer.from(String(e.delta ?? ''), 'base64'));
      if (e.type === 'response.output_audio_transcript.done' && waiting) waiting.said += ` ${String(e.transcript ?? '')}`;
      if (e.type !== 'response.done' || !waiting) return;
      const response = e.response as { usage?: Usage; output?: { type: string; call_id?: string }[] };
      spent.responses++;
      spent.dollars += (response.usage && cost(model, response.usage)) || 0;
      // A call she made is answered as the service answers it, and she is asked for nothing more: its cards come as notes.
      for (const out of response.output ?? []) if (out.type === 'function_call' && out.call_id) session.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: out.call_id, output: STARTED } });
      const { done, chunks, said } = waiting;
      waiting = null;
      done({ pcm: new Uint8Array(Buffer.concat(chunks)), text: said.replace(/\s+/g, ' ').trim() });
    },
    closed: (why: string) => waiting?.fail(new Error(why)),
  });
  session.send({
    type: 'session.update',
    session: {
      type: 'realtime', model, output_modalities: ['audio'], instructions: `${instructions(name, today)}\n\n${RECORDING}`, tools: toolSpecs(), tool_choice: 'auto',
      audio: { output: { format: { type: 'audio/pcm', rate: 24_000 }, voice } },
    },
  });
  const note = (text: string) => session.send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
  const ask = () =>
    new Promise<{ pcm: Uint8Array; text: string }>((done, fail) => {
      waiting = { chunks: [], said: '', done, fail };
      session.send({ type: 'response.create' });
      setTimeout(() => waiting && fail(new Error('the realtime model did not answer in 90 s')), 90_000).unref();
    });
  return {
    note,
    said: (text: string) => session.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }),
    ask,
    close: () => session.close(),
  };
}

const transcribe = openaiTranscribe(fetch, { apiKey, model: env.MIND_PALACE_HEARING_MODEL });
const hear = async (wav: Uint8Array, likely: string) => (spent.heard++, transcribe(wav, 'audio/wav', { name, words: likely }));
const voiceOptions: VoiceOptions = {
  open: openaiRealtime({ apiKey, model }), model, voice, name, hear,
  spent: (dollars) => (spent.dollars += dollars),
  log: (line) => console.log(`    ${line}`),
};
const voiceDir = join(demoDir, 'voice');
mkdirSync(voiceDir, { recursive: true });
const voicesFile = join(voiceDir, 'voices.json');
const voices: Record<string, Voice> = existsSync(voicesFile) ? JSON.parse(readFileSync(voicesFile, 'utf8')) : {};

/**
 * Keeps a line's recording, and gives the line's words. What she said aloud in the conversation is kept when its sound holds the
 * words of the text. Otherwise she is asked to say the line as written; and if she does not, the closest wording she did say,
 * with its own take, is the line.
 */
async function keep(text: string, kind: LineKind, own: Uint8Array, likely: string): Promise<{ text: string; ms: number; how: string }> {
  let pcm = own;
  let how = 'her own answer';
  const heard = own.length > 12_000 ? await hear(wavOf(own), likely) : '';
  if (compare(text, heard) === 'differs') {
    console.log(`    her answer's sound was not its text; heard: ${heard.slice(0, 140)}`);
    const again = await recordLine(voiceOptions, text, kind, likely);
    spent.takes += again.takes;
    if ('unsaid' in again) {
      if (!again.pcm || !again.closest) throw new Error(`she did not say this line as written, nor any wording of it twice the same: ${text}`);
      text = again.closest;
      pcm = again.pcm;
      how = `her closest wording, after ${again.takes} takes`;
      spent.reworded++;
    } else {
      pcm = again.pcm;
      how = `said again as written, ${again.takes} take${again.takes === 1 ? '' : 's'}`;
      spent.retaken++;
    }
  } else spent.own++;
  const file = recordingName(voice, text);
  writeFileSync(join(voiceDir, file), pcm);
  voices[file] = 'realtime';
  spent.seconds += pcm.length / 48_000;
  return { text, ms: pcm.length / 48, how };
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
  const titles = new Map(script.phases.map((phase): [string, string] => [phase.id, phase.cards.map((card) => card.title).join(', ')]));
  const count = { exact: 0, close: 0, differs: 0 };
  for (const [round, said] of Object.entries(lines.rounds)) {
    if (only && !only.has(round)) continue;
    for (const line of said) {
      const recording = join(voiceDir, recordingName(voice, line.text));
      if (!line.text || !existsSync(recording)) continue;
      const heard = await hear(wavOf(new Uint8Array(readFileSync(recording))), titles.get(round) ?? '');
      const how = compare(line.text, heard);
      count[how]++;
      if (how !== 'exact') console.log(`${round} ${line.id} (${voices[recordingName(voice, line.text)] ?? 'NOT THE REALTIME VOICE'}): ${how}\n  written: ${line.text}\n  heard:   ${heard}`);
    }
  }
  console.log(`${count.exact} recordings were heard word for word as written, ${count.close} with only a spelling by ear or a space apart, ${count.differs} with a word added, dropped or changed (${spent.heard} transcriptions)`);
  process.exit(0);
}

/** The lines `--lines` names, as `round:line`. */
const chosen = args.includes('--lines') ? new Set((args[args.indexOf('--lines') + 1] ?? '').split(',')) : null;
/** A recording written out twice: the second hearing is given when the first is the line's own words, so a take passes only on both. */
const twice = async (wav: Uint8Array, likely: string) => {
  const first = await hear(wav, likely);
  return heardLine && compare(heardLine, first) === 'differs' ? first : hear(wav, likely);
};
let heardLine = '';
if (flag('--retake')) {
  // Every line with no recording in her realtime voice is put to her again, or with --lines, the lines named.
  for (const [round, said] of Object.entries(lines.rounds)) {
    if (only && !only.has(round)) continue;
    const likely = script.phases.find((phase) => phase.id === round)?.cards.map((card) => card.title).join(', ') ?? '';
    for (const line of said) {
      const recording = recordingName(voice, line.text);
      const named = chosen?.has(`${round}:${line.id}`);
      heardLine = line.text;
      if (!line.text || (chosen ? !named : voices[recording] === 'realtime' && existsSync(join(voiceDir, recording)))) continue;
      // A named line is one whose recording was heard two ways: its new take must be heard as written twice over.
      const again = await recordLine(named ? { ...voiceOptions, hear: twice } : voiceOptions, line.text, line.kind, likely);
      if ('unsaid' in again) {
        console.log(`${round} ${line.id}: she did not say it as written in ${again.takes} takes; ${existsSync(join(voiceDir, recording)) ? 'her recording is left as it was' : 'IT HAS NO RECORDING'}. Closest: ${again.closest}`);
        continue;
      }
      writeFileSync(join(voiceDir, recording), again.pcm);
      voices[recording] = 'realtime';
      writeFileSync(voicesFile, `${JSON.stringify(voices, null, 1)}\n`);
      console.log(`${round} ${line.id}: in her realtime voice, ${again.takes} take${again.takes === 1 ? '' : 's'} (${(again.pcm.length / 48_000).toFixed(1)} s)`);
    }
  }
  console.log(`$${spent.dollars.toFixed(2)} on the realtime model, ${spent.heard} transcriptions`);
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
  const likely = phase.cards.map((card) => card.title).join(', ');
  const momo = conversation();
  try {
    momo.note(`[Where the user is] ${where}`);
    return await planLines(phase, under, async ({ kind, cards, note }) => {
      // Many cards at once: the demo has always asked her to count them and name one, where the live note asks for every name.
      if (note) momo.note(kind === 'more' && cards.length > 2 ? note.replace(/Tell the user in one short sentence that names them\.$/, 'Say how many came and name the one you like best, in one short sentence.') : note);
      else momo.said(phase.say.replace(/^hey momo,?\s*/i, ''));
      if (spent.dollars > BUDGET) throw new Error(`this run has spent $${spent.dollars.toFixed(2)}, past its budget of $${BUDGET}`);
      let said = await momo.ask();
      // She may call the search without a word: then she is asked once more for the words that go with it.
      if (!said.text && kind === 'answer') said = await momo.ask();
      if (!said.text) return { text: '', ms: 0 };
      const kept = await keep(said.text, kind, said.pcm, likely);
      console.log(`  ${kind.padEnd(6)} ${(kept.ms / 1000).toFixed(1).padStart(5)} s  ${kept.how}: ${kept.text}`);
      return { text: kept.text, ms: kept.ms };
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
    writeFileSync(voicesFile, `${JSON.stringify(voices, null, 1)}\n`);
    console.log(`  so far $${spent.dollars.toFixed(2)} on the realtime model`);
  }
} finally {
  await run.close();
  rmSync(dataDir, { recursive: true, force: true });
}
// A recording no line's words name any more is of a line that was written again: it goes, with its entry.
const named = new Set(Object.values(lines.rounds).flatMap((said) => said.map((line) => recordingName(voice, line.text))));
for (const old of readdirSync(voiceDir)) if (old.endsWith('.pcm') && !named.has(old)) rmSync(join(voiceDir, old));
for (const old of Object.keys(voices)) if (!named.has(old)) delete voices[old];
writeFileSync(voicesFile, `${JSON.stringify(voices, null, 1)}\n`);
console.log(
  `${spent.responses} answers from the realtime model, $${spent.dollars.toFixed(2)} by its own count; ${spent.own} lines kept as she answered, ${spent.retaken} said again as written ` +
    `(${spent.takes} takes for those and the next), ${spent.reworded} given her closest wording; ${spent.seconds.toFixed(0)} s of voice; ${spent.heard} transcriptions`,
);
process.exit(0);
