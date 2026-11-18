/**
 * Makes the clips the wake phrase is measured on: "hey Momo" and "hi Momo" alone, before a command and after other talk,
 * then what must not wake it: commands without the phrase, near misses, ordinary talk, and the agent's own replies.
 * Voices: macOS voices, native and accented, and OpenAI's speech model told to speak with an accent (about 3 minutes of audio, a few cents).
 * Usage: tsx scripts/wake-clips.ts <out dir>
 * Writes 16 kHz mono WAV files and <out dir>/clips.json. Clips already on disk are kept, so a rerun costs nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv } from '../src/node/env.ts';
import { SPEECH_VOICE } from '../src/node/speech-openai.ts';

type Set = 'phrase' | 'phrase+command' | 'talk+phrase' | 'command' | 'near-miss' | 'talk' | 'reply' | 'reply-naming';
interface Clip { file: string; set: Set; voice: string; text: string; wake: boolean }

const out = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: wake-clips.ts <out dir>');
mkdirSync(out, { recursive: true });
const env = loadEnv();
const repo = resolve(import.meta.dirname, '../..');

const PHRASE = ['Hey Momo.', 'Hi Momo.', 'Hey, Momo!', 'Hi Momo?'];
const PHRASE_COMMAND = [
  'Hey Momo, show me more like this.',
  'Hi Momo, undo that.',
  'Hey Momo, find papers on spaced repetition for early readers.',
  'Hi Momo, go back to the start.',
  'Hey Momo, keep the first two.',
  'Hi Momo, make a new tree for the Japan trip.',
];
const TALK_PHRASE = [
  'I was reading about winter bread all morning. Hey Momo, bring more on sourdough.',
  'Okay, so that one is done. Hi Momo, package this tree for the design team.',
];
const COMMAND = [
  'Make a new tree for the Japan trip and move the onsen card into it.',
  'Find me more like the Buffalo parking study, but for European cities.',
  'Keep the second pick and drop the rest.',
  'Undo that, I meant the sourdough tree, not the solar one.',
  'Show me more like this.',
  'Go back to the start.',
  'Package this tree as a handoff for the design team.',
];
const NEAR_MISS = [
  'Hey mama.', 'Hi mom.', 'Hey mom, are you coming tonight?', 'Hi mom, I miss you.', 'Memo.', 'Did you read the memo?',
  'Momentum.', 'We lost all our momentum this week.', 'Hey Moe.', 'Hi Moe, good to see you.', "Mo Mo's bakery.",
  "Let's grab coffee at Mo Mo's bakery.", 'I had steamed momos for lunch.', 'My cat is called Momo.', 'Hey, no more.',
  'Hey Nemo.', 'Hi Tomo.', 'Hey homie.', 'Hey mommy.', 'Hi Mo.', 'Hey Mo, more!', 'Hey Bobo.', 'Hi Coco.', 'Hey Jojo.',
];
const REPLY = [
  'Looking into that.', 'Bringing more.', 'Going there.', 'Got it, noted.', 'Undone.',
  'What should I look at? Point at a note or a tree.',
  'I found five pieces about winter sourdough, and two of them are videos.',
  'Your handoff is ready: japan trip.',
  'Kept the first two. The others are still dashed.',
  "Here's a study from 2021 on spaced repetition for early readers.",
  'I moved the onsen card into the Japan trip tree.',
];
const REPLY_NAMING = ["I'm Momo. I keep your trees and bring new things to them.", "Hi, I'm Momo. What should we look at?"];

const TALK = [
  `So the plan for Saturday is pretty loose. We could take the early train, get to the market around nine, and then just walk until somebody gets hungry. My mom wants to come for the morning part, which is fine, she likes the flower stalls. I told her we would be back home by four at the latest, because Monday is going to be a long day for all of us.`,
  `Honestly the hardest part of moving was the boxes. Every time I thought we were done there was another one hiding in a closet. Half of them were books I have not opened in years. At some point you have to decide whether you are keeping something because you love it or because you feel guilty getting rid of it.`,
  `Hi, sorry I'm late, the bus just sat there for ten minutes with the doors open. Did I miss anything important? Okay, good. Hey, can you pass me the notes from last week? I want to check what we promised the client about the timeline before we say anything new.`,
  `I have been trying to cook more at home. Last night was a lentil soup with lemon and a lot of cumin, and it came out better than I expected. The trick, apparently, is to fry the spices in the oil first, for a minute or so, before anything else goes in. My roommate had two bowls, which I am counting as a review.`,
  `The meeting went fine, I think. Nobody disagreed out loud, which with this team can mean anything. We agreed to try the new schedule for a month and then look at the numbers again. If it works we keep it, and if it doesn't we go back to the old one and nobody has to say I told you so.`,
  `Hello? Can you hear me now? I think the microphone was muted. Right, so what I was saying is that the garden needs water every other day while we are away. The tomatoes are the thirsty ones. The herbs can mostly look after themselves, but the basil sulks if it dries out, so give it a little extra.`,
  `My grandfather used to say that a good walk fixes most things. He walked every morning, rain or shine, the same loop around the reservoir. When I was little I went with him on weekends and he would name every bird we saw, even the ones I am fairly sure he made up.`,
  `Hey, quick question about the trip. Are we renting a car or doing everything by train? I looked at the prices and the train is cheaper if we book this week, but a car would let us stop at those little towns in the mountains. Either is fine with me, I just want to decide before the weekend.`,
  `The movie was long but I liked it. The middle dragged a little, there was a whole stretch on the boat where nothing happened, but the last half hour made up for it. The music was the best part. I have had the main theme stuck in my head since we left the cinema, so thank you for that.`,
  `I keep meaning to learn another language properly. I can order coffee and ask where the station is in about four languages, and that is roughly where it stops. Every January I download an app, do a two week streak, and then miss one day and never open it again. Maybe this year a real class would stick.`,
  `Okay, here is my honest take on the new office. The light is great and the coffee is better. The problem is the noise. With the open floor you can hear every phone call, and by three in the afternoon it feels like working in a train station. I have started booking the small room just to think for an hour.`,
  `Hi everyone, thanks for coming. This won't take long. The short version is that we are about two weeks behind, mostly because of the supplier, and we have a plan to catch up. I will go through it slide by slide, and please stop me if anything is unclear, I would rather answer questions now than in a month.`,
];

/**
 * Plain spoken prose from a Markdown document: headings, tables and code are reduced to words.
 * Sentences that name the agent are left out, since the documents now describe the phrase itself and talk must not hold it.
 */
function prose(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*\|?\s*-{3,}/.test(line))
    .join('\n')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*|>_]/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/mo[\s-]*mo/i.test(sentence))
    .join(' ')
    .trim();
}

const DOCS = ['agents/DECISIONS.md', 'agents/README.md', 'README.md', 'agents/docs/protocol.md', 'quest/agent-plan.md'];

interface Voice { name: string; make: (text: string, file: string) => Promise<void> }

function mono16k(from: string, to: string): void {
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', from, to]);
  rmSync(from);
}

const mac = (voice: string): Voice => ({
  name: `mac ${voice}`,
  make: async (text, file) => {
    const textFile = `${file}.txt`;
    writeFileSync(textFile, text);
    execFileSync('say', ['-v', voice, '-o', `${file}.aiff`, '-f', textFile]);
    rmSync(textFile);
    mono16k(`${file}.aiff`, file);
  },
});

const openai = (voice: string, manner: string, label: string): Voice => ({
  name: `openai ${voice} ${label}`,
  make: async (text, file) => {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, instructions: manner, response_format: 'wav' }),
    });
    if (!res.ok) throw new Error(`OpenAI speech answered ${res.status}`);
    writeFileSync(`${file}.src.wav`, Buffer.from(await res.arrayBuffer()));
    mono16k(`${file}.src.wav`, file);
  },
});

const NATIVE = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Rishi', 'Tessa', 'Flo (English (US))', 'Reed (English (UK))', 'Grandpa (English (US))', 'Sandy (English (US))'].map(mac);
const ACCENTED = ['Eddy (Chinese (China mainland))', 'Tingting', 'Thomas', 'Paulina', 'Anna', 'Kyoko', 'Lekha'].map(mac);
const OPENAI_VOICES = [
  openai('marin', 'Speak naturally, like talking to a friend.', 'plain'),
  openai('cedar', 'Speak casually with a noticeable Mandarin Chinese accent.', 'Mandarin accent'),
  openai('alloy', 'Speak casually with a noticeable Indian English accent.', 'Indian accent'),
  openai('coral', 'Speak casually with a noticeable Spanish accent.', 'Spanish accent'),
  openai('ash', 'Speak a little fast and mumbled, with a French accent, like thinking out loud.', 'French accent, fast'),
  openai('sage', 'Speak quietly and slowly, a little tired, at the end of a long day.', 'quiet and tired'),
];
const REPLY_VOICE = openai(SPEECH_VOICE, 'Warm, calm and unhurried, like a friend who knows a lot and is glad to share it. Natural pauses. Not salesy.', 'reply voice');

const plan: { set: Set; voice: Voice; text: string }[] = [];
const add = (set: Set, voices: Voice[], texts: string[]) => { for (const voice of voices) for (const text of texts) plan.push({ set, voice, text }); };
add('phrase', [...NATIVE, ...ACCENTED, ...OPENAI_VOICES], PHRASE);
add('phrase+command', [...NATIVE, ...ACCENTED], PHRASE_COMMAND);
add('phrase+command', OPENAI_VOICES, PHRASE_COMMAND.slice(0, 4));
add('talk+phrase', [...NATIVE, ...ACCENTED], TALK_PHRASE);
add('command', [...NATIVE, ...ACCENTED], COMMAND);
add('near-miss', [...NATIVE, ...ACCENTED], NEAR_MISS);
add('near-miss', OPENAI_VOICES.slice(0, 3), NEAR_MISS.slice(0, 12));
add('reply', [REPLY_VOICE], REPLY);
add('reply-naming', [REPLY_VOICE], REPLY_NAMING);
for (const voice of NATIVE.slice(0, 8)) plan.push({ set: 'talk', voice, text: TALK.join('\n\n') });
for (const [i, doc] of DOCS.entries()) plan.push({ set: 'talk', voice: [...NATIVE, ...ACCENTED.slice(0, 2)][i % 12]!, text: prose(readFileSync(join(repo, doc), 'utf8')) });

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const clips: Clip[] = [];
let made = 0;
for (const [i, step] of plan.entries()) {
  const dir = join(out, step.set);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug(step.voice.name)}-${i}-${slug(step.text.slice(0, 30))}.wav`);
  if (!existsSync(file)) {
    await step.voice.make(step.text, file);
    made++;
  }
  clips.push({ file, set: step.set, voice: step.voice.name, text: step.text.length > 200 ? `${step.text.slice(0, 200)}…` : step.text, wake: step.set.startsWith('phrase') || step.set === 'talk+phrase' });
}
writeFileSync(join(out, 'clips.json'), JSON.stringify(clips, null, 1));
console.log(JSON.stringify({ clips: clips.length, made, bySet: Object.fromEntries([...new Set(clips.map((c) => c.set))].map((s) => [s, clips.filter((c) => c.set === s).length])) }));
