// Reads what scripts/live-bench.ts wrote and reports it against the voice plan's targets: ways chosen right, the time from the end of
// speech to Momo's first sound, the web answers' lead-in and answer, and what a turn cost.
//   node --no-warnings --import tsx scripts/live-summary.ts <file.jsonl>...
import { readFileSync } from 'node:fs';

interface Row {
  id: string;
  group: string;
  model: string;
  expected: string[];
  chose: string[];
  right: boolean;
  cutOff?: boolean;
  overMs: number | null;
  firstSoundMs: number | null;
  answerMs: number | null;
  toolMs: number | null;
  responses: { purpose: string; text: string; firstAudioMs: number | null }[];
  cards?: { atMs: number | null; title: string }[];
  notes?: { atMs: number | null; text: string }[];
  dollars: { realtime: number; hearing: number; web: number };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const sec = (ms: number) => (ms / 1000).toFixed(2);
const spread = (xs: number[]) => (xs.length ? `median ${sec(median(xs))} s (${sec(Math.min(...xs))} to ${sec(Math.max(...xs))}, n=${xs.length})` : 'none');

for (const file of process.argv.slice(2)) {
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
  const nums = (xs: (number | null)[]) => xs.filter((x): x is number => typeof x === 'number');
  console.log(`## ${file.split('/').pop()} (${rows[0]?.model}, ${rows.length} requests)`);
  console.log(`right way: ${rows.filter((r) => r.right).length} of ${rows.length}`);
  for (const r of rows.filter((x) => !x.right)) console.log(`  wrong: ${r.id} expected ${r.expected.join('/')} chose ${r.chose.join('+')}: ${r.responses.map((x) => x.text).join(' | ').slice(0, 160)}`);
  console.log(`turn over after the end of speech: ${spread(nums(rows.map((r) => r.overMs)))}`);
  console.log(`first sound after the end of speech: ${spread(nums(rows.map((r) => r.firstSoundMs)))}, within 1.5 s in ${nums(rows.map((r) => r.firstSoundMs)).filter((x) => x <= 1500).length}`);
  const knows = rows.filter((r) => r.group === 'knows' && r.chose[0] === 'own');
  console.log(`known answers, first sound: ${spread(nums(knows.map((r) => r.firstSoundMs)))}`);
  const web = rows.filter((r) => r.chose.includes('web_answer'));
  console.log(`web: lead-in ${spread(nums(web.map((r) => r.firstSoundMs)))}; answer ${spread(nums(web.map((r) => r.answerMs)))}, within 5 s in ${nums(web.map((r) => r.answerMs)).filter((x) => x <= 5000).length}; the search ${spread(nums(web.map((r) => r.toolMs)))}`);
  const per = rows.map((r) => r.dollars.realtime + r.dollars.hearing + r.dollars.web);
  console.log(`cost a turn: median $${median(per).toFixed(4)}, mean $${(per.reduce((a, b) => a + b, 0) / per.length).toFixed(4)}, total $${per.reduce((a, b) => a + b, 0).toFixed(3)} (realtime $${rows.reduce((a, r) => a + r.dollars.realtime, 0).toFixed(3)}, hearing $${rows.reduce((a, r) => a + r.dollars.hearing, 0).toFixed(3)}, web $${rows.reduce((a, r) => a + r.dollars.web, 0).toFixed(3)})`);
  const words = rows.map((r) => r.responses.filter((x) => x.purpose !== 'results').map((x) => x.text).join(' ').split(/\s+/).filter(Boolean).length);
  const told = rows.filter((r) => (r.cards ?? []).length > 0);
  const mention = told.flatMap((r) => {
    const card = r.cards![0]!.atMs;
    const said = r.responses.find((x) => x.purpose === 'results' && x.firstAudioMs !== null);
    return card !== null && said ? [said.firstAudioMs! - card] : [];
  });
  if (told.length) console.log(`first card landed to Momo's first word about it: ${spread(mention)} over ${told.length} runs that brought cards`);
  console.log(`words in the answer to a turn: ${spread(words.map((w) => w * 1000))}`.replace(/ s/g, ''));
  console.log('');
}
