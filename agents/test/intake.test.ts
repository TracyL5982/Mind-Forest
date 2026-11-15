import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Item } from '../src/core/domain.ts';
import { gpsOf } from '../src/core/exif.ts';
import type { JsonRequest } from '../src/core/ports.ts';
import { intake } from '../src/core/roles/intake.ts';
import { fittedSummary } from '../src/core/roles/intake/describe.ts';
import { byRule } from '../src/core/roles/renderer.ts';
import { DEMO_MEMO, tones } from '../src/fake/model.ts';
import { kit, type Kit } from './kit.ts';

const NOTHING = {
  steps: [],
  facts: [],
  quoteText: '',
  quoteBy: '',
  chartLabels: [],
  chartValues: [],
  chartUnit: '',
  personName: '',
  personRole: '',
  when: '',
  where: '',
  people: [],
  pros: [],
  cons: [],
  tableHeads: [],
  tableRows: [],
  question: '',
  answer: '',
  term: '',
  definition: '',
  items: [],
  checklist: [],
  colours: [],
  excerptText: '',
  excerptAt: '',
};
const described = (title: string, more: object = {}) => ({
  title,
  summary: `About ${title}.`,
  tags: ['Alpha', 'beta'],
  ...NOTHING,
  ...more,
});

const bytes = (text: string) => new TextEncoder().encode(text);

function scriptChat(k: Kit, takeaways: { title: string; text: string }[] = []) {
  const seen: JsonRequest<unknown>[] = [];
  k.model.on('intake.chat', (req) => {
    seen.push(req);
    return { title: 'Model title', summary: 'They settled on a plan.', tags: ['planning', 'trip'], takeaways };
  });
  return seen;
}

function assertWellFormed(items: Item[]) {
  for (const item of items) {
    Item.parse(item);
    assert.ok(item.title.length > 0 && item.title.length < 70, `title length of "${item.title}"`);
    assert.ok(item.tags.length >= 2 && item.tags.length <= 6, `tag count of "${item.title}": ${item.tags}`);
    assert.deepEqual(item.tags, item.tags.map((t) => t.toLowerCase()));
  }
}

test('a summary stands whole under its title on a note\'s small face, cut at a whole sentence or clause, or dropped, and never with an ellipsis', async () => {
  type Card = { size: (item: unknown, props: unknown) => number[] };
  const { COMPONENTS } = (await import(new URL('../client/js/components/index.js', import.meta.url).href)) as { COMPONENTS: Record<string, Card> };
  const { linesOf } = (await import(new URL('../client/js/components/shared.js', import.meta.url).href)) as { linesOf: (str: string, column: number, measure: string) => number };
  /** A note's face leaves no cue exactly when it shows its whole summary: the frame, the title, 6 px and the summary's lines. */
  const whole = (title: string, summary: string) => COMPONENTS.note!.size({ title, summary, text: '' }, {})[1] === 30 + linesOf(title, 177, 'title') * 24 + (summary ? 6 + linesOf(summary, 177, 'body') * 22 : 0);
  const cases: [string, string, string][] = [
    ['A title', 'A short summary.', 'A short summary.'],
    ['If the river is the highway', 'Barges carry the grain out and the news in. The road behind the houses is used only by locals, so nobody drives it.', 'Barges carry the grain out and the news in.'],
    ['North window', 'The light falls across the table in the afternoon, which is why the painter moved her easel twice before settling.', 'The light falls across the table in the afternoon'],
    ['间隔重复', '间隔重复之所以有效，是因为遗忘是可以预测的，每次在快要忘记之前回想一次就行。', '间隔重复之所以有效，是因为遗忘是可以预测的'],
    ['A title', 'However, this one is a single clause that runs on and on past every line the note could possibly hold for it here', ''],
  ];
  for (const [title, summary, kept] of cases) {
    const fitted = fittedSummary(summary, title);
    assert.equal(fitted, kept, summary);
    assert.ok(whole(title, fitted), `${title}: the note shows ${JSON.stringify(fitted)} whole`);
    assert.ok(!/(…|\.\.\.)$/.test(fitted), 'no ellipsis');
  }
  let tall = 'A title';
  while (linesOf(tall, 177, 'title') < 4) tall += ' that runs on';
  assert.equal(fittedSummary('A short summary.', tall), '', 'a title of four lines leaves a summary no room, so the note shows its title alone');
  const one = 'Barges carry the grain out and the news in each day';
  assert.equal(linesOf(one, 177, 'body') <= 3, true);
  assert.equal(fittedSummary(one, 'A title'), one, 'three lines under a title of one line');
});

test('a text that is only a URL becomes a link item read from the page', async () => {
  const k = kit();
  const url = 'https://example.com/dolly-zoom';
  k.world.pages.set(url, { url, title: 'The dolly zoom', text: 'Hitchcock used it in Vertigo.', site: 'example.com' });
  let asked = '';
  k.model.on('intake.link', (req) => {
    asked = req.user;
    return described('How the dolly zoom works');
  });

  const items = await intake(k.ctx, [{ kind: 'text', text: `  ${url}\n` }]);

  assert.equal(items.length, 1);
  const [link] = items;
  assert.equal(link!.kind, 'link');
  assert.equal(link!.title, 'How the dolly zoom works');
  assert.equal(link!.source.url, url);
  assert.equal(link!.source.from, 'link');
  assert.deepEqual(link!.origin, { by: 'user' });
  assert.deepEqual(link!.tags, ['alpha', 'beta']);
  assert.equal(link!.data.site, 'example.com');
  assert.match(asked, /Hitchcock used it in Vertigo/);
  assertWellFormed(items);
});

test('a link that cannot be read still becomes an item, without asking the model', async () => {
  const k = kit();
  const items = await intake(k.ctx, [{ kind: 'link', url: 'https://www.youtube.com/watch?v=abc123' }]);

  assert.equal(items.length, 1);
  assert.equal(items[0]!.kind, 'link');
  assert.equal(items[0]!.source.url, 'https://www.youtube.com/watch?v=abc123');
  assert.match(items[0]!.title, /youtube\.com/);
  assert.equal(k.model.calls.length, 0);
  assert.equal(k.notes.length, 1);
  assertWellFormed(items);
});

test('an image is captioned by the model, which is sent the bytes as a data URL', async () => {
  const k = kit();
  const { id } = await k.assets.put(Uint8Array.from([137, 80, 78, 71]), 'image/png', 'IMG_0042.png');
  let request: JsonRequest<unknown> | undefined;
  k.model.on('intake.image', (req) => {
    request = req;
    return { ...described('Whiteboard sketch of the app'), description: 'A whiteboard with three boxes and arrows.' };
  });

  const items = await intake(k.ctx, [{ kind: 'asset', asset: id, mime: 'image/png', name: 'IMG_0042.png' }]);

  assert.deepEqual(request?.images, [`data:image/png;base64,${btoa(String.fromCharCode(137, 80, 78, 71))}`]);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.kind, 'image');
  assert.equal(items[0]!.title, 'Whiteboard sketch of the app');
  assert.equal(items[0]!.text, 'A whiteboard with three boxes and arrows.');
  assert.equal(items[0]!.source.asset, id);
  assert.equal(items[0]!.source.from, 'drop');
  assertWellFormed(items);
});

test('a small video is watched and a large one is filed by name with a note', async () => {
  const k = kit();
  const small = await k.assets.put(new Uint8Array(1024), 'video/mp4', 'clip.mp4');
  const large = await k.assets.put(new Uint8Array(15 * 1024 * 1024), 'video/mp4', 'beach-walk_take2.mp4');
  const sent: string[][] = [];
  k.model.on('intake.video', (req) => {
    sent.push(req.videos ?? []);
    return { ...described('A short clip'), description: 'Waves.' };
  });

  const items = await intake(k.ctx, [
    { kind: 'asset', asset: small.id, mime: 'video/mp4', name: 'clip.mp4' },
    { kind: 'asset', asset: large.id, mime: 'video/mp4', name: 'beach-walk_take2.mp4' },
  ]);

  assert.equal(sent.length, 1);
  assert.match(sent[0]![0]!, /^data:video\/mp4;base64,/);
  assert.deepEqual(items.map((i) => [i.kind, i.title]), [['video', 'A short clip'], ['video', 'beach walk take2']]);
  assert.equal(items[1]!.source.asset, large.id);
  assert.ok(k.notes.some((n) => n.includes('beach-walk_take2.mp4') && n.includes('15 MB')));
  assertWellFormed(items);
});

const MEASURED = { seconds: 20, peaks: [0.2, 1, 0.6, 0.35] };

test('a dropped recording is transcribed and its transcript described as a text is, so it is found by a word spoken in it', async () => {
  const k = kit();
  const memo = await k.assets.put(tones(3), 'audio/wav', 'garden-memo.wav');
  k.model.describing();

  const items = await intake(k.ctx, [{ kind: 'asset', asset: memo.id, mime: 'audio/wav', name: 'garden-memo.wav', sound: MEASURED }]);

  assert.equal(items.length, 1, 'a long transcript is one recording, never split into ideas');
  const [recording] = items;
  assert.equal(recording!.kind, 'audio');
  assert.equal(recording!.text, DEMO_MEMO);
  assert.equal(recording!.title, 'Garden notes for Thursday.');
  assert.deepEqual(recording!.data.sound, MEASURED);
  assert.deepEqual([recording!.source.from, recording!.source.asset], ['drop', memo.id]);
  assert.deepEqual(k.model.calls.map((c) => c.kind), ['transcribe', 'json']);
  assert.match(k.model.calls[1]!.detail, /the transcript of a recording, file name: garden-memo\.wav/);
  assert.deepEqual(byRule(recording!, (id) => `/assets/${id}`), { component: 'audio', props: { src: `/assets/${memo.id}`, ...MEASURED } });
  k.mind.apply({ origin: { by: 'user' }, label: 'Drop a memo', commands: [{ type: 'addItem', item: recording! }] });
  assert.deepEqual(k.mind.search('compost').map((hit) => hit.id), [recording!.id]);
  assertWellFormed(items);
});

test('a recording whose transcription fails is kept with no transcript and one line in the run log', async () => {
  const k = kit();
  const memo = await k.assets.put(tones(1), 'audio/mpeg', 'voice-note_0412.mp3');
  k.model.onTranscribe(new Error('the transcriber is down')).describing();

  const items = await intake(k.ctx, [{ kind: 'asset', asset: memo.id, mime: 'audio/mpeg', name: 'voice-note_0412.mp3', sound: MEASURED }]);

  assert.deepEqual(items.map((i) => [i.kind, i.title, i.text]), [['audio', 'voice note 0412', '']]);
  assert.equal(items[0]!.summary, 'A recording dropped in as voice-note_0412.mp3.');
  assert.deepEqual(items[0]!.data, { sound: MEASURED });
  assert.deepEqual(k.notes, ['intake: Could not transcribe "voice-note_0412.mp3", so it has no transcript.']);
  assert.equal(k.model.calls.filter((c) => c.kind === 'json').length, 0, 'nothing is described when nothing was heard');
  assertWellFormed(items);
});

test('a recording the client could not decode is filed by name, and nothing is sent to be transcribed', async () => {
  const k = kit();
  const junk = await k.assets.put(bytes('not sound at all'), 'audio/mpeg', 'interview.mp3');

  const items = await intake(k.ctx, [{ kind: 'asset', asset: junk.id, mime: 'audio/mpeg', name: 'interview.mp3' }]);

  assert.deepEqual(items.map((i) => [i.kind, i.title]), [['file', 'interview.mp3']]);
  assert.deepEqual(byRule(items[0]!, (id) => `/assets/${id}`).component, 'note');
  assert.deepEqual(k.notes, ['intake: "interview.mp3" could not be played as sound, so it is filed by name only.']);
  assert.equal(k.model.calls.length, 0);
});

test('a dropped text file is read as text and a binary file is filed by name', async () => {
  const k = kit();
  const notes = await k.assets.put(bytes('# Garden plan\nTomatoes go by the south wall.'), 'text/markdown', 'garden.md');
  const blob = await k.assets.put(Uint8Array.from([0, 255, 254, 0, 1, 2, 200, 0]), 'application/octet-stream', 'model.bin');
  let asked = '';
  k.model.on('intake.text', (req) => {
    asked = req.user;
    return { entries: [{ dump: 0, text: '', ...described('Garden plan') }] };
  });

  const items = await intake(k.ctx, [
    { kind: 'asset', asset: notes.id, mime: 'text/markdown', name: 'garden.md' },
    { kind: 'asset', asset: blob.id, mime: 'application/octet-stream', name: 'model.bin' },
  ]);

  assert.match(asked, /garden\.md/);
  assert.deepEqual(items.map((i) => i.kind), ['text', 'file']);
  assert.equal(items[0]!.text, '# Garden plan\nTomatoes go by the south wall.');
  assert.equal(items[0]!.source.from, 'drop');
  assert.equal(items[0]!.source.asset, notes.id);
  assert.equal(items[1]!.title, 'model.bin');
  assert.equal(items[1]!.source.asset, blob.id);
  assertWellFormed(items);
});

test('short texts share one model call and come back in the order they were dumped', async () => {
  const k = kit();
  k.model.on('intake.text', () => ({
    entries: [
      { dump: 1, text: '', ...described('Second thought') },
      { dump: 0, text: '', ...described('First thought') },
      { dump: 7, text: '', ...described('From nowhere') },
    ],
  }));

  const items = await intake(k.ctx, [
    { kind: 'text', text: 'what if the trees glow at night' },
    { kind: 'text', text: 'ask Mei about the Quest build' },
    { kind: 'text', text: '   ' },
  ]);

  assert.equal(k.model.calls.length, 1);
  assert.deepEqual(items.map((i) => i.title), ['First thought', 'Second thought']);
  assert.equal(items[0]!.text, 'what if the trees glow at night');
  assert.equal(items[0]!.source.from, 'paste');
  assertWellFormed(items);
});

test('a long text with separate ideas is split, and a short one never is', async () => {
  const k = kit();
  const long = `${'The onboarding flow needs a rethink. '.repeat(30)}\n\n${'Pricing should move to seats. '.repeat(30)}`;
  k.model.on('intake.text', (req) => ({
    entries: Array.from({ length: 8 }, (_, n) => ({ dump: 0, text: `Idea ${n} written out.`, ...described(`Idea ${n}`) })),
    seen: req.user,
  }));

  const split = await intake(k.ctx, [{ kind: 'text', text: long }]);
  assert.equal(split.length, 6);
  assert.equal(split[2]!.text, 'Idea 2 written out.');
  assertWellFormed(split);

  const whole = await intake(k.ctx, [{ kind: 'text', text: 'one short thought' }]);
  assert.equal(whole.length, 1);
  assert.equal(whole[0]!.text, 'one short thought');
});

test('structure is kept only when the content holds it, as the whole of it', async () => {
  const k = kit();
  const text = 'Recipe:\n1. Boil water.\n2. Add 200 g of pasta.\n3. Drain.';
  k.model.on('intake.text', () => ({
    entries: [
      {
        dump: 0,
        text: '',
        ...described('Pasta', {
          steps: ['Boil water.', 'Add 200 g of pasta.', 'Drain'],
          facts: [{ label: 'Pasta', value: '200 g' }, { label: '', value: 'x' }],
          quoteText: 'Salt it like the sea',
          quoteBy: 'Nonna',
          chartLabels: ['Jan', 'Feb'],
          chartValues: [12, 99],
          when: '',
        }),
      },
    ],
  }));

  const [item] = await intake(k.ctx, [{ kind: 'text', text }]);

  assert.deepEqual(item!.data.steps, ['Boil water.', 'Add 200 g of pasta.', 'Drain'], 'the steps are the whole text under its label');
  assert.equal(item!.data.facts, undefined, 'a figure picked out of a step is a part of the text');
  assert.equal(item!.data.quote, undefined, 'a quotation the text does not hold');
  assert.equal(item!.data.chart, undefined, 'a chart value the text does not state is dropped');
  const more = `${text}\n\nAs Nonna says, "salt it like the sea".`;
  assert.equal((await extracted(more, { steps: ['Boil water.', 'Add 200 g of pasta.', 'Drain.'] })).steps, undefined, 'steps with a line after them that the card would leave out');
  assert.equal('when' in item!.data, false);
  assert.equal('person' in item!.data, false);
  assert.equal((await extracted(text, { steps: ['Boil water.', 'Add pasta', 'Drain.'] })).steps, undefined, 'a step in other words leaves another procedure, so none is kept');
});

/** The data Intake keeps when the model answers a pasted `text` with `reply`. */
async function extracted(text: string, reply: object): Promise<Item['data']> {
  const k = kit();
  k.model.on('intake.text', () => ({ entries: [{ dump: 0, text: '', ...described('Pasted', reply) }] }));
  const [item] = await intake(k.ctx, [{ kind: 'text', text }]);
  return item!.data;
}

const STRUCTURED: { field: string; text: string; reply: object; kept: object; wrong: object; left?: object }[] = [
  {
    field: 'where',
    text: 'We stayed two nights in Lisbon, near the river.',
    reply: { where: 'Lisbon' },
    kept: { where: 'Lisbon' },
    wrong: { where: 'Porto' },
  },
  {
    field: 'people',
    text: 'Dinner with Ana Lima and Ben Okri after the talk.',
    reply: { people: ['Ana Lima', 'Ben Okri'] },
    kept: { people: ['Ana Lima', 'Ben Okri'] },
    wrong: { people: ['Ana Lima', 'Carl Jung'] },
    left: { people: ['Ana Lima'] },
  },
  {
    field: 'pros',
    text: 'Moving to Rust.\nPros:\n- no data races\n- one binary\nCons:\n- slow builds',
    reply: { pros: ['No data races', 'one binary'], cons: ['slow builds'] },
    kept: { pros: ['No data races', 'one binary'], cons: ['slow builds'] },
    wrong: { pros: ['It is fashionable'], cons: ['slow builds'] },
  },
  {
    field: 'cons',
    text: 'Moving to Rust.\nPros:\n- no data races\n- one binary\nCons:\n- slow builds',
    reply: { pros: ['no data races', 'one binary'], cons: ['slow builds'] },
    kept: { pros: ['no data races', 'one binary'], cons: ['slow builds'] },
    wrong: { pros: ['no data races', 'one binary'], cons: ['Nobody knows it'] },
  },
  {
    field: 'table',
    text: 'Plan | Price | Seats\nSolo | $8 | 1\nTeam | $20 | 5\nOrg | $1,200 | 100',
    reply: { tableHeads: ['Plan', 'Price', 'Seats'], tableRows: ['Solo | $8 | 1', '| Team | $20 | 5 |', 'Org | $1,200 | 100'] },
    kept: { table: { heads: ['Plan', 'Price', 'Seats'], rows: [['Solo', '$8', '1'], ['Team', '$20', '5'], ['Org', '$1,200', '100']] } },
    wrong: { tableHeads: ['Plan', 'Price', 'Seats'], tableRows: ['Solo | $8 | 1', 'Team | $45 | 5', 'Org | $1,200'] },
  },
  {
    field: 'question and answer',
    text: 'Why is the sky blue? Air scatters short wavelengths the most.',
    reply: { question: 'Why is the sky blue?', answer: 'Air scatters short wavelengths the most.' },
    kept: { question: 'Why is the sky blue?', answer: 'Air scatters short wavelengths the most.' },
    wrong: { question: 'Why is the sky blue?', answer: 'Because it reflects the sea.' },
  },
  {
    field: 'term and definition',
    text: 'Parallax: the apparent shift of an object when the viewer moves.',
    reply: { term: 'Parallax', definition: 'Parallax: the apparent shift of an object when the viewer moves.' },
    kept: { term: 'Parallax', definition: 'Parallax: the apparent shift of an object when the viewer moves.' },
    wrong: { term: 'Refraction', definition: 'the apparent shift of an object when the viewer moves' },
  },
  {
    field: 'items and checklist',
    text: 'Packing:\n[x] passport\n[ ] charger\n[x] rain coat',
    reply: { items: ['passport', 'charger', 'rain coat'], checklist: [true, false, true] },
    kept: { items: ['passport', 'charger', 'rain coat'], checklist: [true, false, true] },
    wrong: { items: ['passport', 'sunglasses', 'rain coat'], checklist: [true, false, true] },
  },
  {
    field: 'colours',
    text: 'Palette: Ember #E4572E, #17BEBB and plain navy.',
    reply: { colours: [{ name: 'Ember', value: '#E4572E' }, { name: 'Lagoon', value: '#17BEBB' }, { name: '', value: 'Navy' }] },
    kept: { colours: [{ name: 'Ember', value: '#E4572E' }, { name: '#17BEBB', value: '#17BEBB' }, { name: 'navy', value: 'navy' }] },
    wrong: { colours: [{ name: 'Gold', value: '#FFC914' }, { name: 'Ember', value: 'ember' }] },
  },
  {
    field: 'excerpt',
    text: 'Chapter 3. The house remembers. Every stair keeps the weight of who climbed it.',
    reply: { excerptText: 'Every stair keeps the weight of who climbed it.', excerptAt: 'Chapter 3' },
    kept: { excerpt: { text: 'Every stair keeps the weight of who climbed it.', at: 'Chapter 3' } },
    wrong: { excerptText: 'Every wall keeps a secret.', excerptAt: 'Chapter 3' },
  },
];

for (const { field, text, reply, kept, wrong, left = {} } of STRUCTURED) {
  test(`${field} is kept when the text states it and dropped when it does not`, async () => {
    assert.deepEqual(await extracted(text, reply), kept);
    assert.deepEqual(await extracted(text, wrong), left);
  });
}

test('where an excerpt sits is dropped alone when the text does not say it', async () => {
  const data = await extracted('The house remembers. Every stair keeps the weight.', { excerptText: 'Every stair keeps the weight.', excerptAt: 'the closing page' });
  assert.deepEqual(data, { excerpt: { text: 'Every stair keeps the weight.' } });
});

test('a list is a checklist only when the text itself marks each item, and the marks are the text\'s', async () => {
  assert.deepEqual(await extracted('Bring:\n- tent\n- stove\n- map', { items: ['tent', 'stove', 'map'], checklist: [true, true, false] }), { items: ['tent', 'stove', 'map'] });
  assert.deepEqual(await extracted('Bring: tent, stove, map.', { items: ['tent', 'stove', 'map'] }), {}, 'an entry is a whole line or sentence, never a piece of one');
  assert.deepEqual(await extracted('☑ tent\n☐ stove\nmap', { items: ['tent', 'stove', 'map'], checklist: [true, false, false] }), {}, 'boxes on some lines only: a list that leaves them off would hide them');
  assert.deepEqual(await extracted('Storing the vaccine\n✗ Keep it in the freezer.\n✓ Keep it in the fridge.', { items: ['Keep it in the freezer.', 'Keep it in the fridge.'], checklist: [false, true] }), {}, 'a cross and a tick are words of their lines, and no check boxes');
  assert.deepEqual(await extracted('Storing the vaccine\n✗ Keep it in the freezer.\n✓ Keep it in the fridge.', { items: ['✗ Keep it in the freezer.', '✓ Keep it in the fridge.'], checklist: [] }), { items: ['✗ Keep it in the freezer.', '✓ Keep it in the fridge.'] });
  assert.deepEqual(await extracted('[x] tent\n[ ] stove', { items: ['tent', 'stove'], checklist: [false, true] }), { items: ['tent', 'stove'], checklist: [true, false] });
  assert.deepEqual(await extracted('[x] tent\n[ ] stove', { items: ['tent', 'stove'], checklist: [] }), { items: ['tent', 'stove'], checklist: [true, false] }, 'the marks are the text\'s, whatever the model says of them');
});

test('a list needs two different entries, whatever their case', async () => {
  const text = 'Bring:\n- passport\n- charger';
  assert.deepEqual(await extracted(text, { items: ['passport'] }), {});
  assert.deepEqual(await extracted(text, { items: ['passport', 'Passport', 'PASSPORT'] }), {});
  assert.deepEqual(await extracted(text, { items: ['passport', 'umbrella'] }), {});
  assert.deepEqual(await extracted(text, { items: ['passport', 'Charger', 'charger'] }), { items: ['passport', 'Charger'] });
  assert.deepEqual(await extracted(text, { people: ['Charger', 'charger'] }), { people: ['Charger'] });
});

test('a word, a number or a symbol the text only holds inside something else is not stated', async () => {
  const text = 'A comparison of options for the manager, founded in 1950 with 1,200 euros. It was an important hundred-page report.';
  const reply = {
    where: 'Paris',
    people: ['Ana', '?'],
    pros: ['...', 'port'],
    cons: ['5', '200'],
    colours: [{ name: '', value: 'red' }, { name: '', value: 'tan' }, { name: '', value: '#195' }],
    question: 'Why?',
    answer: 'A comparison of options',
    term: 'manager',
    definition: '—',
  };
  assert.deepEqual(await extracted(text, reply), {});
  assert.deepEqual(await extracted(text, { where: 'the Manager', cons: ['1200', '1950'], pros: ['hundred page report'] }), { where: 'the Manager' }, 'a point is a whole sentence, never words inside one');
  assert.deepEqual(await extracted('Call 555 about the coffee.', { colours: [{ name: '', value: '#555' }, { name: '', value: '#fee' }] }), {}, 'a hex colour needs its "#" in the text');
  assert.deepEqual(await extracted('北京是中国的首都，人口2189万。', { where: '北京', people: ['上海'], cons: ['189'] }), { where: '北京' });
});

test('both halves of a pair must be in the text', async () => {
  const text = 'Why is the sky blue? Air scatters short wavelengths the most.\nParallax: the apparent shift of an object when the viewer moves.';
  assert.deepEqual(await extracted(text, { question: 'Why is grass green?', answer: 'Air scatters short wavelengths the most.' }), {});
  assert.deepEqual(await extracted(text, { term: 'Refraction', definition: 'the apparent shift of an object when the viewer moves' }), {});
});

test('a date and a named person are kept only when the text writes them, and a role only as a whole line or sentence of it', async () => {
  const text = 'Ada Lovelace wrote the first program in 1843. The notes ran to 65 pages.';
  const stated = { facts: [{ label: 'Notes', value: '65 pages' }], when: '1843', personName: 'Ada Lovelace', personRole: 'Mathematician' };
  assert.deepEqual(await extracted(text, stated), { when: '1843', person: { name: 'Ada Lovelace' } }, 'a figure picked out of prose, and a role the model named');
  assert.deepEqual(await extracted(text, { when: '4 July 1843', personName: 'Charles Babbage' }), {});
  assert.deepEqual(await extracted('Maria Chen\nHead of design at Orbit', { personName: 'Maria Chen', personRole: 'Head of design at Orbit' }), { person: { name: 'Maria Chen', role: 'Head of design at Orbit' } });
  assert.deepEqual(await extracted('Met Sarah Chen. She runs a repair café in Leeds.', { personName: 'Sarah Chen', personRole: 'Repair café owner' }), { person: { name: 'Sarah Chen' } });
});

test('figures and the points of a series are kept only as the whole text, each label as its line writes it before its value', async () => {
  const text = 'Monthly costs\nRent: 980 euros\nFood: 240 euros';
  assert.deepEqual(await extracted(text, { facts: [{ label: 'Rent', value: '980 euros' }, { label: 'Food', value: '240 euros' }] }), { facts: [{ label: 'Rent', value: '980 euros' }, { label: 'Food', value: '240 euros' }] });
  assert.deepEqual(await extracted(text, { facts: [{ label: 'Housing', value: '980 euros' }, { label: 'Food', value: '240 euros' }] }), {}, 'a label of the model\'s own');
  assert.deepEqual(await extracted(text, { facts: [{ label: 'Food', value: '980 euros' }, { label: 'Rent', value: '240 euros' }] }), {}, 'values under each other\'s labels');
  assert.deepEqual(await extracted(text, { facts: [{ label: 'Rent', value: '980 euros' }] }), {}, 'one figure of two');
  const prose = [{ label: 'One-to-one, per hour', value: '£40' }, { label: 'Groups', value: '£25' }];
  assert.deepEqual(await extracted('Charge £40 an hour for one-to-one and £25 a head for groups of three.', { facts: prose }), {}, 'figures picked out of a sentence, under labels the text does not write');
  assert.deepEqual(await extracted(text, { chartLabels: ['Rent', 'Food'], chartValues: [980, 240], chartUnit: 'euros' }), { chart: { labels: ['Rent', 'Food'], values: [980, 240], unit: 'euros' } });
  assert.deepEqual(await extracted(text, { chartLabels: ['Rent', 'Food'], chartValues: [240, 980], chartUnit: 'euros' }), {}, 'a series with its values under the wrong labels');
  assert.deepEqual(await extracted(text, { chartLabels: ['Housing', 'Food'], chartValues: [980, 240], chartUnit: 'euros' }), {});
});

test('a chart value is a whole number of the text, not digits inside another', async () => {
  const text = 'Sales, 1950\nMay 1,200\nJune 3.5';
  assert.deepEqual(await extracted(text, { chartLabels: ['May', 'June'], chartValues: [1200, 3.5] }), { chart: { labels: ['May', 'June'], values: [1200, 3.5] } });
  for (const chartValues of [[200, 3.5], [1200, 35], [1200, 5], [1200, -3.5]]) assert.deepEqual(await extracted(text, { chartLabels: ['May', 'June'], chartValues }), {}, String(chartValues));
});

test('a chart value written in a magnitude is kept with the unit that carries it', async () => {
  const text = '人口：北京2189万，上海2487万。';
  const chart = { labels: ['北京', '上海'], values: [2189, 2487], unit: '万' };
  assert.deepEqual(await extracted(text, { chartLabels: chart.labels, chartValues: chart.values, chartUnit: '万' }), { chart });
  assert.deepEqual(await extracted(text, { chartLabels: chart.labels, chartValues: chart.values }), {}, 'without the unit the bare numbers are not written');
  assert.deepEqual(await extracted(text, { chartLabels: chart.labels, chartValues: chart.values, chartUnit: '亿' }), {});
  assert.deepEqual(await extracted('Revenue\nQ1: $120k\nQ2: $140k', { chartLabels: ['Q1', 'Q2'], chartValues: [120, 140], chartUnit: '$k' }), {
    chart: { labels: ['Q1', 'Q2'], values: [120, 140], unit: '$k' },
  });
  assert.deepEqual(await extracted('Revenue was $120k in Q1 and $140k in Q2.', { chartLabels: ['Q1', 'Q2'], chartValues: [120, 140], chartUnit: '$k' }), {}, 'a series picked out of a sentence');
});

const CODE: [language: string, source: string][] = [
  ['javascript', 'function debounce(fn, ms) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n}'],
  ['python', 'import math\n\ndef area(r):\n    return math.pi * r ** 2\n\nprint(area(2))'],
  ['c', '#include <stdio.h>\n\nint main(void) {\n    printf("hello\\n");\n    return 0;\n}'],
  ['java', 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("hello");\n    }\n}'],
  ['rust', 'use std::collections::HashMap;\n\nfn main() {\n    let mut seen = HashMap::new();\n    seen.insert("a", 1);\n    println!("{:?}", seen);\n}'],
];

const PROSE = [
  'Dumplings\n2 cups flour\n1 cup water\nMix the flour and water, rest for 30 minutes.\nRoll thin, fill, and boil until they float.',
  'Two roads diverged in a yellow wood,\nAnd sorry I could not travel both\nAnd be one traveler, long I stood\nAnd looked down one as far as I could',
  'Packing:\n- tent\n- stove\n- map (the big one)\n- matches',
  '把客厅改成工作室这件事想了很久。\n书桌放在窗边，光线最好。\n沙发留一张小的，朋友来了还能坐。\n最麻烦的是那面书墙，要重新打。',
  'Meeting notes\nAna will draft the plan by Friday.\nBen checks the budget; Carl books the room.\nWe meet again on the 12th.',
  'Why the launch slipped:\n1. The vendor was late.\n2. QA found a crash (fixed).\n3. Legal wanted another week.',
  'Dear Mei,\nThank you for the tea set; we use it every Sunday.\nThe children ask when you will visit.\nWith love,\nNan',
  'Pros: fast builds, one small binary.\nCons: a steep start.\nVerdict: try it on the next service.',
  'Plan | Price | Seats\nSolo | $8 | 1\nTeam | $20 | 5\nOrg | $1,200 | 100',
  'Q: Why is the sky blue?\nA: Air scatters short wavelengths the most.\nThat is also why sunsets are red.',
  'if the weather holds we go on Saturday\nfor now nobody has a tent\nlet me know who can drive',
];

test('pasted code is kept as code, fenced or bare, in five languages', async () => {
  const k = kit();
  k.model.on('intake.text', (req) => ({ entries: [...req.user.matchAll(/Dump (\d+)/g)].map((dump) => ({ dump: Number(dump[1]), text: '', ...described('Snippet', { facts: [{ label: 'args', value: 'fn' }] }) })) }));
  const bare = await intake(k.ctx, CODE.map(([, source]) => ({ kind: 'text' as const, text: `\n${source}\n` })));
  assert.deepEqual(bare.map((item) => item.data.code), CODE.map(([, source]) => ({ source })));
  assert.deepEqual(bare.map((item) => item.kind), CODE.map(() => 'text'));
  assert.equal(bare[0]!.text, `\n${CODE[0]![1]}\n`, 'the paste itself is the text');
  assert.equal(bare[0]!.data.facts, undefined, 'a figure read off code is no figure of it');

  const fenced = await intake(k.ctx, CODE.map(([language, source]) => ({ kind: 'text' as const, text: `\`\`\`${language}\n${source}\n\`\`\`` })));
  assert.deepEqual(fenced.map((item) => item.data.code), CODE.map(([language, source]) => ({ language, source })));
  const [untagged, prose, two] = await intake(k.ctx, [
    { kind: 'text', text: '```\nSELECT name FROM users\n```' },
    { kind: 'text', text: 'Try this:\n```\nSELECT name FROM users\n```\nIt lists them.' },
    { kind: 'text', text: '```\na\n```\nand\n```\nb\n```' },
  ]);
  assert.deepEqual(untagged!.data.code, { source: 'SELECT name FROM users' });
  assert.equal(prose!.data.code, undefined, 'a fence inside prose is not the whole paste');
  assert.equal(two!.data.code, undefined);
  assertWellFormed([...bare, ...fenced]);
});

test('prose is never taken for code', async () => {
  const k = kit();
  k.model.on('intake.text', (req) => ({ entries: [...req.user.matchAll(/Dump (\d+)/g)].map((dump) => ({ dump: Number(dump[1]), text: '', ...described('Words') })) }));
  const items = await intake(k.ctx, PROSE.map((text) => ({ kind: 'text' as const, text })));
  items.forEach((item, n) => assert.equal(item.data.code, undefined, PROSE[n]));
  assert.equal(items.length, PROSE.length);
});

const COMMENTED: [what: string, source: string][] = [
  ['a table in a docstring', 'def rate(tier):\n    """\n    tier | rate\n    free | 10\n    pro  | 100\n    """\n    return {"free": 10, "pro": 100}[tier]\n\nprint(rate("pro"))'],
  ['prose in a block comment', '/*\n * Debounce waits until the calls stop.\n * It is the usual fix for a search box\n * that fires on every key\n */\nfunction debounce(fn, ms) {\n  let t;\n  return wrap(fn, ms, t);\n}'],
  ['prose in line comments', '// Reads the limit for a tier\n// The tiers are free and pro\n// Anything else is an error\nconst limit = RATES[tier];\nif (limit === undefined) throw new Error(tier);\nreturn limit;'],
  ['hash comments', '# The radius is in metres\n# The result is in square metres\n# Nothing is rounded\nimport math\ndef area(r):\n    return math.pi * r ** 2\nprint(area(2))'],
  ['a docstring in single quotes', "def area(r):\n    '''\n    Area of a circle\n    r is the radius in metres\n    Nothing is rounded here\n    '''\n    return 3.14159 * r ** 2\nprint(area(2))"],
  ['dash comments', '-- Everyone who signed up this year\n-- and has not paid yet\n-- newest first\nSELECT name FROM users WHERE (paid = 0);\nSELECT count(*) FROM users WHERE (paid != 0);\nDELETE FROM sessions WHERE (age > 30);'],
  ['a glob that looks like an open comment', 'import { glob } from "glob";\nconst files = glob("src/*.ts");\nfor (const file of files) {\n  check(file);\n}'],
];

const DOCUMENTS = [
  '# Trip to Lisbon\n\n## Getting there\nThe train from Porto takes three hours.\nBook the morning one.\n\n## Staying\nAlfama is steep but close to everything.',
  '# Reading list\n- The Poetics of Space\n- Ways of Seeing\n## Later\n- Species of Spaces',
  '# 周末计划\n\n## 周六\n上午去西湖边走走。\n下午在家整理书架。\n\n## 周日\n和朋友吃饭。',
  '# Notes\n// not sure about this yet\nAsk Ana about the budget.\nCall the venue.\n-- me',
  'Two comments and a thought:\n# first\n# second\nThat is all.',
  '"""\nA poem kept in quotes\nfor no reason at all\n"""\nand a line after it',
  '/* an aside\nthat runs over lines */\nThen the letter proper.\nIt has three lines\nand none is code.',
];

test('code is still code when its comments or docstring hold prose or a table', async () => {
  const k = kit();
  k.model.on('intake.text', (req) => ({ entries: [...req.user.matchAll(/Dump (\d+)/g)].map((dump) => ({ dump: Number(dump[1]), text: '', ...described('Snippet') })) }));
  const items = await intake(k.ctx, COMMENTED.map(([, source]) => ({ kind: 'text' as const, text: source })));
  items.forEach((item, n) => assert.deepEqual(item.data.code, { source: COMMENTED[n]![1] }, COMMENTED[n]![0]));
  const [two] = await intake(k.ctx, [{ kind: 'text', text: '# Only two lines are code\n# under these comments\nimport math\nprint(math.pi)' }]);
  assert.equal(two!.data.code, undefined, 'three lines of code must remain outside the comments');
});

test('a document with headings, or with a comment in it, is not code', async () => {
  const k = kit();
  k.model.on('intake.text', (req) => ({ entries: [...req.user.matchAll(/Dump (\d+)/g)].map((dump) => ({ dump: Number(dump[1]), text: '', ...described('Words') })) }));
  const items = await intake(k.ctx, DOCUMENTS.map((text) => ({ kind: 'text' as const, text })));
  items.forEach((item, n) => assert.equal(item.data.code, undefined, DOCUMENTS[n]));
});

const EVERYDAY: [what: string, text: string][] = [
  ['quantities in brackets', 'Milk (2 pints)\nEggs (a dozen)\nBread (wholemeal)\nButter (unsalted)\nApples (six)'],
  ['phone numbers with a label in brackets', 'Mum 07700 900123 (mobile)\nDad 07700 900456 (work)\nDr Patel 0161 496 0000 (surgery)\nSchool office 0161 496 0111 (mornings only)'],
  ['books with a year in brackets', 'The Body Keeps the Score, van der Kolk (2014)\nWhy We Sleep, Walker (2017)\nBreath, Nestor (2020)\nBeing Mortal, Gawande (2014)'],
  ['Chinese lines ending in a half-width bracket', '牛奶(两盒)\n鸡蛋(一打)\n豆腐(老的)\n小葱(一把)'],
  ['lines ending in a smiley', 'First day at the new school went fine :)\nShe already has a friend called Noor :)\nForgot her lunch box, the office lent her one :)'],
  ['arrows written as =>', 'rent goes up => we move further out\nfurther out => longer commute for both of us\nlonger commute => we need the second car after all'],
  ['chores that begin with a keyword', 'return library books\nclass photo money due friday\nlet the plumber in at ten\nimport contacts to the new phone'],
  ['a recipe with bracketed remarks', 'Roast the squash at 200 (fan 180)\nToast the seeds in a dry pan (watch them)\nBlend with the stock (about 800 ml)'],
  ['sentences ending in a semicolon', 'Things the solicitor said;\nthe searches take three weeks;\nthe seller has not answered the enquiries;\nwe should not book the removal van yet;'],
  ['a budget written with equals signs', 'rent = 800\nfood = 300\nfun = 100'],
  ['chores that begin as a query does', 'update the mailing list\ncreate a logo for the choir\njoin the gym before March\nselect a venue'],
  ['names with an at sign', '@ana\n@ben\n@carl'],
  ['prices with a dollar sign set apart', '$ 5 for coffee\n$ 12 for lunch\n$ 40 for the train'],
  ['a to-do list with headings', '# Today\ncall the bank\n# Tomorrow\npost the forms'],
];

test('everyday notes with brackets, arrows, smileys, semicolons or equals signs are not code', async () => {
  const k = kit();
  k.model.on('intake.text', (req) => ({ entries: [...req.user.matchAll(/Dump (\d+)/g)].map((dump) => ({ dump: Number(dump[1]), text: '', ...described('Words') })) }));
  const items = await intake(k.ctx, EVERYDAY.map(([, text]) => ({ kind: 'text' as const, text })));
  assert.equal(items.length, EVERYDAY.length);
  items.forEach((item, n) => assert.equal(item.data.code, undefined, EVERYDAY[n]![0]));
});

const UNFENCED: [what: string, language: string | undefined, source: string][] = [
  ['a Python function with a docstring, assignments and a loop', undefined, 'def amortise(principal, annual_rate, years):\n    """Monthly payment and total interest for a repayment loan."""\n    r = annual_rate / 12\n    n = years * 12\n    if r == 0:\n        return principal / n, 0.0\n    payment = principal * r / (1 - (1 + r) ** -n)\n    total = payment * n\n    return payment, total - principal\n\n\nfor rate in (0.0419, 0.0445):\n    monthly, interest = amortise(250_000, rate, 25)\n    print(f"{rate:.2%}: {monthly:,.0f} a month, {interest:,.0f} interest")'],
  ['Python with a decorator and typed assignments', undefined, '@dataclass\nclass Loan:\n    principal: float = 0.0\n    years: int = 25\n\nloan = Loan()\nrate: float = 0.04\ntry:\n    check(loan)\nexcept ValueError:\n    raise'],
  ['a SQL query with no semicolon inside it', undefined, "SELECT m.name, COUNT(p.id) AS payments, SUM(p.amount) AS total\nFROM members m\nLEFT JOIN payments p ON p.member_id = m.id\nWHERE p.paid_on >= DATE '2026-01-01'\nGROUP BY m.name\nHAVING SUM(p.amount) > 100\nORDER BY total DESC\nLIMIT 20;"],
  ['a SQL query in lower case', undefined, 'select name, email\nfrom members\nwhere joined > 2020\norder by name;'],
  ['a JSON object over lines', 'json', '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "strict": true\n  },\n  "include": ["src", "test"]\n}'],
  ['a JSON array over lines', 'json', '[\n  { "name": "Ana", "paid": true },\n  { "name": "Ben", "paid": false }\n]'],
  ['a terminal transcript that is mostly output', 'sh', "$ git status\nOn branch main\nYour branch is ahead of 'origin/main' by 2 commits.\n$ git log --oneline -2\n3f2a1bc Fix the date parser\n9e0d7aa Add tests for leap years\n$ git push"],
];

test('code with no fence is code: Python with a docstring, SQL, a JSON file as json and a terminal transcript as sh', async () => {
  const k = kit();
  k.model.on('intake.text', (req) => ({ entries: [...req.user.matchAll(/Dump (\d+)/g)].map((dump) => ({ dump: Number(dump[1]), text: '', ...described('Snippet') })) }));
  const items = await intake(k.ctx, UNFENCED.map(([, , source]) => ({ kind: 'text' as const, text: source })));
  items.forEach((item, n) => {
    const [what, language, source] = UNFENCED[n]!;
    assert.deepEqual(item.data.code, { ...(language ? { language } : {}), source }, what);
  });
  const [oneLine, broken, scalar, command] = await intake(k.ctx, [
    { kind: 'text', text: '{"name": "config", "retries": 3}' },
    { kind: 'text', text: '{\n  name: config,\n  retries: three\n}' },
    { kind: 'text', text: '"just\\na\\nstring"' },
    { kind: 'text', text: 'Run this first\n$ npm install\nand tell me what it prints' },
  ]);
  assert.equal(oneLine!.data.code, undefined, 'JSON on one line');
  assert.equal(broken!.data.code, undefined, 'braces around words that are not JSON');
  assert.equal(scalar!.data.code, undefined, 'a JSON string');
  assert.equal(command!.data.code, undefined, 'one command inside a note');
});

const LEFT_AS_NOTES: [what: string, language: string, source: string][] = [
  ['YAML', 'yaml', 'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n  db:\n    image: postgres:16\n    restart: unless-stopped'],
  ['HTML', 'html', '<form action="/join" method="post">\n  <label for="email">Email</label>\n  <input id="email" name="email" type="email" required>\n  <button type="submit">Join the choir list</button>\n</form>'],
  ['minified JavaScript', 'js', '!function(){var e=document.querySelectorAll("[data-toggle]");for(var t=0;t<e.length;t++)e[t].addEventListener("click",function(n){n.preventDefault();this.classList.toggle("open")})}();'],
];

test('YAML, HTML and one line of minified JavaScript are notes unless fenced, since YAML reads as a plain list', async () => {
  const k = kit();
  k.model.on('intake.text', (req) => ({ entries: [...req.user.matchAll(/Dump (\d+)/g)].map((dump) => ({ dump: Number(dump[1]), text: '', ...described('Config') })) }));
  const bare = await intake(k.ctx, LEFT_AS_NOTES.map(([, , source]) => ({ kind: 'text' as const, text: source })));
  bare.forEach((item, n) => assert.equal(item.data.code, undefined, LEFT_AS_NOTES[n]![0]));
  const fenced = await intake(k.ctx, LEFT_AS_NOTES.map(([, language, source]) => ({ kind: 'text' as const, text: `\`\`\`${language}\n${source}\n\`\`\`` })));
  assert.deepEqual(fenced.map((item) => item.data.code), LEFT_AS_NOTES.map(([, language, source]) => ({ language, source })));
});

test('a long paste of code stays one item, and code is kept when the model fails', async () => {
  const k = kit();
  const long = Array.from({ length: 80 }, (_v, n) => `const value${n} = compute(${n});`).join('\n');
  k.model.on('intake.text', () => ({ entries: Array.from({ length: 4 }, (_v, n) => ({ dump: 0, text: `Part ${n}.`, ...described(`Part ${n}`) })) }));
  const whole = await intake(k.ctx, [{ kind: 'text', text: long }]);
  assert.equal(whole.length, 1);
  assert.deepEqual([whole[0]!.text, whole[0]!.data.code], [long, { source: long }]);

  k.model.on('intake.text', () => {
    throw new Error('down');
  });
  const [plain] = await intake(k.ctx, [{ kind: 'text', text: CODE[1]![1] }]);
  assert.deepEqual(plain!.data, { code: { source: CODE[1]![1] } });
});

test('a quotation or an excerpt cannot be stitched across two sentences or two lines', async () => {
  const text = 'Air scatters short blue wavelengths more than long red ones.\nRayleigh scattering: scattering of light by small particles. It is why the sky is blue.';
  assert.deepEqual(await extracted(text, { excerptText: 'red ones Rayleigh scattering', quoteText: 'small particles it is why' }), {});
  assert.deepEqual(await extracted(text, { excerptText: 'Rayleigh scattering: scattering of light by small particles. It is why the sky is blue.' }), {
    excerpt: { text: 'Rayleigh scattering: scattering of light by small particles. It is why the sky is blue.' },
  });
  assert.deepEqual(await extracted(text, { excerptText: 'scattering of light by small particles. It is why the sky is blue.' }), {
    excerpt: { text: 'scattering of light by small particles. It is why the sky is blue.' },
  }, 'the line before it and the label that opens its line are drawn over it');
  assert.deepEqual(await extracted(text, { excerptText: 'Air scatters short blue wavelengths more than long red ones.' }), {}, 'a passage with the rest of the text after it');
});

test('a table is read from fenced rows without shifting a column, and its divider and repeated heads are left out', async () => {
  const text = '| Plan | Price | Seats |\n|---|:-:|--:|\n| Basic | 5 | 1 |\n| Team | 20 | 10 |';
  const heads = ['Plan', 'Price', 'Seats'];
  const whole = { table: { heads, rows: [['Basic', '5', '1'], ['Team', '20', '10']] } };
  assert.deepEqual(await extracted(text, { tableHeads: heads, tableRows: ['| Plan | Price | Seats |', '|---|:-:|--:|', '| Basic | 5 | 1 |', '| Team | 20 | 10 |'] }), whole);
  assert.deepEqual(await extracted(text, { tableHeads: heads, tableRows: ['--- | --- | ---', 'plan | price | seats', 'Basic | 5 | 1', 'Team | 20 | 10'] }), whole);
  assert.deepEqual(await extracted(text, { tableHeads: heads, tableRows: ['| Basic | 5 |', '| 5 |', '| Team | 20 | 10 |'] }), {}, 'a fenced row that is short is no row of the table, and never shifted');
  assert.deepEqual(await extracted(text, { tableHeads: heads, tableRows: ['Basic | 5 | ', 'Team |  | 10'] }), {}, 'an empty cell where the text writes a value');
  assert.deepEqual(await extracted('| Plan | Price | Seats |\n|---|---|---|\n| Basic | 5 | |', { tableHeads: heads, tableRows: ['Basic | 5 | '] }), { table: { heads, rows: [['Basic', '5', '']] } }, 'and one where it writes none');
  assert.deepEqual(await extracted(text, { tableHeads: heads, tableRows: ['|---|---|---|'] }), {});
});

test('a table needs every head and every cell in the text', async () => {
  const text = 'Plan | Price | Seats\nBasic | 5 | 1\nOrg | $1,200 | 100';
  const rows = ['Basic | 5 | 1'];
  assert.deepEqual(await extracted(text, { tableHeads: ['Plan', 'Cost', 'Seats'], tableRows: rows }), {});
  assert.deepEqual(await extracted(text, { tableHeads: ['Plan', 'Pri', 'Seat'], tableRows: rows }), {});
  assert.deepEqual(await extracted(text, { tableHeads: ['#', 'Plan', 'Price'], tableRows: ['1 | Basic | 5'] }), {});
  assert.deepEqual(await extracted(text, { tableHeads: ['Plan', 'Price', 'Seats'], tableRows: ['Org | $20 | 100', 'Basic | ✓ | 1', 'Seats Basic | 5 | 1', 'Basic | -5 | 1', 'Org | $1200 | 100'] }), {});
  assert.deepEqual(await extracted(text, { tableHeads: ['Plan', 'Price', 'Seats'], tableRows: ['Basic | 5 | 1', 'Org | $1200 | 100'] }), {
    table: { heads: ['Plan', 'Price', 'Seats'], rows: [['Basic', '5', '1'], ['Org', '$1200', '100']] },
  }, 'every row, each cell as the text writes it');
});

const INVENTED = { where: 'Atlantis', people: ['Carl Jung'], pros: ['cheap'], tableHeads: ['a', 'b'], tableRows: ['1 | 2'], excerptText: 'never written', colours: [{ name: 'Ghost', value: '#123456' }], when: '2077', personName: 'Carl Jung' };

test('a link is held to its page: a value the page does not write is dropped', async () => {
  const k = kit();
  const url = 'https://example.com/trip';
  k.world.pages.set(url, { url, title: 'Trip notes', text: 'Three days away in Porto with Ana Lima.', site: 'example.com' });
  k.model.on('intake.link', () => described('Trip', { ...INVENTED, where: 'Porto', people: ['Carl Jung', 'Ana Lima'] }));

  const [link] = await intake(k.ctx, [{ kind: 'link', url }]);

  assert.deepEqual(link!.data, { where: 'Porto', people: ['Ana Lima'], site: 'example.com' });
});

test('each part of a split text is held to the text: a value it does not write is dropped', async () => {
  const k = kit();
  const long = `${'First idea about Lisbon. '.repeat(40)}\n\n${'Second idea about Porto. '.repeat(40)}`;
  k.model.on('intake.text', () => ({
    entries: [
      { dump: 0, text: 'First idea about Lisbon.', ...described('First', { ...INVENTED, where: 'Lisbon' }) },
      { dump: 0, text: 'Second idea about Porto.', ...described('Second', INVENTED) },
    ],
  }));

  const parts = await intake(k.ctx, [{ kind: 'text', text: long }]);

  assert.deepEqual(parts.map((part) => part.data), [{ where: 'Lisbon' }, {}]);
});

for (const [kind, mime, name] of [['image', 'image/jpeg', 'beach.jpg'], ['video', 'video/mp4', 'nazare-clip.mp4']] as const) {
  test(`${kind === 'image' ? 'a photo' : 'a video'} is held to the model's own description and the file name`, async () => {
    const media = async (description: string, more: object) => {
      const k = kit();
      const { id } = await k.assets.put(new Uint8Array([1, 2, 3]), mime, name);
      k.model.on(`intake.${kind}`, () => ({ ...described('Two friends on a beach', more), description }));
      const [item] = await intake(k.ctx, [{ kind: 'asset', asset: id, mime, name }]);
      return item!.data;
    };
    const named = { where: 'Nazaré', people: ['Ana Lima', 'Ben Okri'] };

    assert.deepEqual(await media('Ana Lima and Ben Okri stand on the sand at Nazaré.', named), named);
    assert.deepEqual(await media('Two people on sand.', { ...INVENTED, ...named }), {});
    assert.deepEqual(await media('', { ...INVENTED, ...named }), {});
    assert.deepEqual(await media('Waves.', { where: kind === 'image' ? 'beach' : 'nazare' }), { where: kind === 'image' ? 'beach' : 'nazare' }, 'the file name counts as content');
  });
}

const CHATGPT_EXPORT = [
  {
    title: 'Trip to Lisbon',
    update_time: 1_760_000_000,
    current_node: 'n4',
    mapping: {
      root: { id: 'root', message: null, parent: null, children: ['n1'] },
      n1: { id: 'n1', parent: 'root', children: ['n2'], message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['You are ChatGPT'] } } },
      n2: { id: 'n2', parent: 'n1', children: ['n3', 'n4'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Plan three days in Lisbon'] } } },
      n3: { id: 'n3', parent: 'n2', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['An abandoned draft'] } } },
      n4: { id: 'n4', parent: 'n2', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Day 1: Alfama.', 'Day 2: Belém.'] } } },
    },
  },
];

const CLAUDE_EXPORT = [
  {
    uuid: 'c1',
    name: 'Naming the app',
    updated_at: '2026-10-01T10:00:00Z',
    chat_messages: [
      { sender: 'human', text: 'Help me name a spatial notes app' },
      { sender: 'assistant', text: '', content: [{ type: 'text', text: 'How about Mind Palace?' }] },
    ],
  },
];

test('a ChatGPT export follows the branch the user ended on', async () => {
  const k = kit();
  scriptChat(k);
  const { id } = await k.assets.put(bytes(JSON.stringify(CHATGPT_EXPORT)), 'application/json', 'conversations.json');

  const items = await intake(k.ctx, [{ kind: 'asset', asset: id, mime: 'application/json', name: 'conversations.json' }]);

  assert.equal(items.length, 1);
  const [chat] = items;
  assert.equal(chat!.kind, 'chat');
  assert.equal(chat!.title, 'Trip to Lisbon', "the export's own title is kept");
  assert.equal(chat!.summary, 'They settled on a plan.');
  assert.equal(chat!.source.from, 'chat-export:chatgpt');
  assert.equal(chat!.source.asset, id);
  assert.deepEqual(chat!.origin, { by: 'user' });
  assert.deepEqual(chat!.data.messages, [
    { role: 'user', text: 'Plan three days in Lisbon' },
    { role: 'assistant', text: 'Day 1: Alfama.\nDay 2: Belém.' },
  ]);
  assertWellFormed(items);
});

test('a ChatGPT export with no current node is walked from the root', async () => {
  const k = kit();
  scriptChat(k);
  const [conv] = CHATGPT_EXPORT;
  const items = await intake(k.ctx, [{ kind: 'text', text: JSON.stringify([{ ...conv, current_node: undefined }]) }]);
  assert.deepEqual(
    (items[0]!.data.messages as { text: string }[]).map((m) => m.text),
    ['Plan three days in Lisbon', 'Day 1: Alfama.\nDay 2: Belém.'],
  );
});

test('a Claude export reads text and content blocks', async () => {
  const k = kit();
  scriptChat(k);
  const items = await intake(k.ctx, [{ kind: 'text', text: JSON.stringify(CLAUDE_EXPORT), name: 'conversations.json' }]);

  assert.equal(items.length, 1);
  assert.equal(items[0]!.title, 'Naming the app');
  assert.equal(items[0]!.source.from, 'chat-export:claude');
  assert.deepEqual(items[0]!.data.messages, [
    { role: 'user', text: 'Help me name a spatial notes app' },
    { role: 'assistant', text: 'How about Mind Palace?' },
  ]);
});

test('generic role and content messages parse as an array or under a messages key', async () => {
  const messages = [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Why is the sky blue?' },
    { role: 'assistant', content: [{ type: 'text', text: 'Rayleigh scattering.' }] },
  ];
  const expected = [
    { role: 'user', text: 'Why is the sky blue?' },
    { role: 'assistant', text: 'Rayleigh scattering.' },
  ];
  for (const shape of [messages, { messages }]) {
    const k = kit();
    scriptChat(k);
    const items = await intake(k.ctx, [{ kind: 'text', text: JSON.stringify(shape) }]);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.kind, 'chat');
    assert.equal(items[0]!.title, 'Model title', 'the model names a conversation the export left untitled');
    assert.equal(items[0]!.source.from, 'chat-export:generic');
    assert.deepEqual(items[0]!.data.messages, expected);
  }
});

test('a pasted transcript parses by its speaker prefixes', async () => {
  const k = kit();
  scriptChat(k);
  const text = ['You: how do I keep basil alive', 'on a windowsill?', '', 'ChatGPT: Water it from below.', 'Me: and light?', 'Muse: Six hours a day.'].join('\n');

  const items = await intake(k.ctx, [{ kind: 'text', text }]);

  assert.equal(items[0]!.kind, 'chat');
  assert.equal(items[0]!.source.from, 'chat-export:transcript');
  assert.deepEqual(items[0]!.data.messages, [
    { role: 'user', text: 'how do I keep basil alive\non a windowsill?' },
    { role: 'assistant', text: 'Water it from below.' },
    { role: 'user', text: 'and light?' },
    { role: 'assistant', text: 'Six hours a day.' },
  ]);
});

test('prose and ordinary JSON are not mistaken for a chat', async () => {
  const k = kit();
  k.model.on('intake.text', (req) => ({
    entries: [...req.user.matchAll(/Dump (\d+)/g)].map((m) => ({ dump: Number(m[1]), text: '', ...described(`Note ${m[1]}`) })),
  }));
  const items = await intake(k.ctx, [
    { kind: 'text', text: 'Thinking about the launch.\nMe: nervous. Team: ready.' },
    { kind: 'text', text: '{"name": "config", "retries": 3}' },
  ]);
  assert.deepEqual(items.map((i) => i.kind), ['text', 'text']);
});

test('takeaways become separate agent-written items that point at their chat', async () => {
  const k = kit();
  const takeaways = Array.from({ length: 7 }, (_, n) => ({ title: `Takeaway ${n}`, text: `Idea number ${n} stands alone.` }));
  takeaways[1]!.text = '  ';
  scriptChat(k, takeaways);

  const items = await intake(k.ctx, [{ kind: 'text', text: 'User: plan my week\nAssistant: Batch the meetings on Tuesday.' }]);

  const [chat, ...rest] = items;
  assert.equal(chat!.kind, 'chat');
  assert.equal(rest.length, 5);
  for (const item of rest) {
    assert.equal(item.kind, 'text');
    assert.equal(item.data.fromChat, chat!.id);
    assert.deepEqual(item.origin, { by: 'agent', role: 'intake' });
    assert.equal(item.source.from, 'chat-export:transcript');
  }
  assert.deepEqual(rest.map((i) => i.title), ['Takeaway 0', 'Takeaway 2', 'Takeaway 3', 'Takeaway 4', 'Takeaway 5']);
  assert.equal(rest[0]!.text, 'Idea number 0 stands alone.');
  assertWellFormed(items);
});

test('a large export keeps the 20 most recent conversations, caps messages, and says so', async () => {
  const k = kit();
  const seen = scriptChat(k);
  const long = Array.from({ length: 260 }, (_, n) => ({ sender: n % 2 ? 'assistant' : 'human', text: n === 259 ? 'z'.repeat(5000) : `m${n}` }));
  const exported = Array.from({ length: 25 }, (_, n) => ({
    name: `Conversation ${n}`,
    updated_at: new Date(Date.UTC(2026, 0, 1 + n)).toISOString(),
    chat_messages: n === 24 ? long : [{ sender: 'human', text: 'hi' }, { sender: 'assistant', text: 'hello' }],
  }));

  const items = await intake(k.ctx, [{ kind: 'text', text: JSON.stringify(exported) }]);

  assert.equal(items.length, 20);
  assert.equal(seen.length, 20);
  assert.deepEqual([items[0]!.title, items[19]!.title], ['Conversation 5', 'Conversation 24']);
  const messages = items[19]!.data.messages as { role: string; text: string }[];
  assert.equal(messages.length, 200);
  assert.equal(messages[0]!.text, 'm60');
  assert.equal(messages[199]!.text.length, 4000);
  assert.ok(k.notes.some((n) => n.includes('25 conversations')));
  assert.ok(seen.every((req) => req.user.length < 14_000), 'the prompt stays bounded');
});

test('no more than four model calls run at once', async () => {
  const k = kit();
  let running = 0;
  let peak = 0;
  k.ctx.model = {
    search: (req) => k.model.search(req),
    image: (req) => k.model.image(req),
    transcribe: (req) => k.model.transcribe(req),
    json: async (req) => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return req.schema.parse({ ...described('Page'), description: '' });
    },
  };
  const dumps = Array.from({ length: 10 }, (_, n) => {
    const url = `https://example.com/${n}`;
    k.world.pages.set(url, { url, title: `Page ${n}`, text: 'Some text.', site: 'example.com' });
    return { kind: 'link' as const, url };
  });

  const items = await intake(k.ctx, dumps);

  assert.equal(items.length, 10);
  assert.equal(peak, 4);
  assert.deepEqual(items.map((i) => i.source.url), dumps.map((d) => d.url));
});

test('when the model throws, every dump still becomes an item described in plain code', async () => {
  const k = kit();
  const url = 'https://example.com/tides';
  k.world.pages.set(url, { url, title: 'Tide tables explained', text: 'Tides follow the moon. Tides are highest at new moon.', site: 'example.com' });
  const image = await k.assets.put(Uint8Array.from([1, 2, 3]), 'image/jpeg', 'harbour-at-dawn.jpg');

  const items = await intake(k.ctx, [
    { kind: 'text', text: '# Harbour notes\nThe harbour wall floods at spring tide. The harbour cafe opens at six.' },
    { kind: 'link', url },
    { kind: 'asset', asset: image.id, mime: 'image/jpeg', name: 'harbour-at-dawn.jpg' },
    { kind: 'text', text: 'Human: when is high tide?\nClaude: Around noon today.' },
  ]);

  assert.deepEqual(items.map((i) => i.kind), ['text', 'link', 'image', 'chat']);
  assert.equal(items[0]!.title, 'Harbour notes');
  assert.match(items[0]!.summary, /^# Harbour notes The harbour wall floods/);
  assert.equal(items[0]!.tags[0], 'harbour');
  assert.equal(items[1]!.title, 'Tide tables explained');
  assert.ok(items[1]!.tags.includes('tides'));
  assert.equal(items[2]!.title, 'harbour at dawn');
  assert.equal(items[3]!.title, 'when is high tide?');
  assert.equal((items[3]!.data.messages as unknown[]).length, 2);
  assert.ok(k.notes.some((n) => n.startsWith('intake:') && n.includes('4 of 4')));
  assertWellFormed(items);
});

/** A JPEG that holds nothing but an Exif block with the given GPS position, written in either byte order. */
function located(lat: number, lon: number, order: 'II' | 'MM' = 'II'): Uint8Array {
  const little = order === 'II';
  const tiff = new DataView(new ArrayBuffer(128));
  const u16 = (at: number, v: number) => tiff.setUint16(at, v, little);
  const u32 = (at: number, v: number) => tiff.setUint32(at, v, little);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => (u16(at, tag), u16(at + 2, type), u32(at + 4, count), u32(at + 8, value));
  const dms = (at: number, degrees: number) => {
    const whole = Math.abs(degrees);
    const minutes = (whole % 1) * 60;
    [[Math.floor(whole), 1], [Math.floor(minutes), 1], [Math.round((minutes % 1) * 60 * 1000), 1000]].forEach(([top, below], n) => (u32(at + n * 8, top!), u32(at + n * 8 + 4, below!)));
  };
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  u16(2, 42);
  u32(4, 8);
  u16(8, 1);
  entry(10, 0x8825, 4, 1, 26);
  u16(26, 4);
  entry(28, 1, 2, 2, 0);
  tiff.setUint8(36, (lat < 0 ? 'S' : 'N').charCodeAt(0));
  entry(40, 2, 5, 3, 80);
  entry(52, 3, 2, 2, 0);
  tiff.setUint8(60, (lon < 0 ? 'W' : 'E').charCodeAt(0));
  entry(64, 4, 5, 3, 104);
  dms(80, lat);
  dms(104, lon);
  const exif = [...bytes('Exif\0\0'), ...new Uint8Array(tiff.buffer)];
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif, 0xff, 0xd9]);
}

const near = (at: unknown, lat: number, lon: number) => {
  const { lat: y, lon: x } = at as { lat: number; lon: number };
  assert.ok(Math.abs(y - lat) < 1e-5 && Math.abs(x - lon) < 1e-5, `${JSON.stringify(at)} is ${lat}, ${lon}`);
};

test('a JPEG\'s own GPS position is read in either byte order, and a picture without one has none', () => {
  near(gpsOf(located(38.7223, -9.1393)), 38.7223, -9.1393);
  near(gpsOf(located(-33.8568, 151.2153, 'MM')), -33.8568, 151.2153);
  assert.equal(gpsOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.equal(gpsOf(Uint8Array.from([137, 80, 78, 71])), null);
  assert.equal(gpsOf(located(38.7223, -9.1393).slice(0, 60)), null, 'a block cut short');
});

test('a dropped photo is placed where it was taken, with maps on or off, and nothing is looked up for it', async () => {
  const k = kit();
  const asked: string[] = [];
  const photo = await k.assets.put(located(41.1496, -8.611), 'image/jpeg', 'ribeira.jpg');
  const png = await k.assets.put(Uint8Array.from([137, 80, 78, 71]), 'image/png', 'plan.png');
  k.model.on('intake.image', () => ({ ...described('A river front', { where: 'ribeira' }), description: 'Houses on a river front.' }));

  const off = await intake(k.ctx, [{ kind: 'asset', asset: photo.id, mime: 'image/jpeg', name: 'ribeira.jpg' }, { kind: 'asset', asset: png.id, mime: 'image/png', name: 'plan.png' }]);
  k.ctx.tools.geocoder = { locate: async (name) => (asked.push(name), { lat: 1, lon: 2 }) };
  const [on] = await intake(k.ctx, [{ kind: 'asset', asset: photo.id, mime: 'image/jpeg', name: 'ribeira.jpg' }]);

  near(off[0]!.data.at, 41.1496, -8.611);
  assert.equal(off[1]!.data.at, undefined);
  near(on!.data.at, 41.1496, -8.611);
  assert.deepEqual(asked, [], 'the photo says where it is, so its place name is not looked up');
});

test('a place a text names is looked up only when maps are on, and a place the geocoder does not know is left without one', async () => {
  const k = kit();
  const asked: string[] = [];
  const text = 'Three days in Lisbon in March.\n\nA week on Atlantis.';
  k.model.on('intake.text', () => ({
    entries: [
      { dump: 0, text: 'Three days in Lisbon in March.', ...described('Lisbon', { where: 'Lisbon' }) },
      { dump: 0, text: 'A week on Atlantis.', ...described('Atlantis', { where: 'Atlantis' }) },
    ],
  }));

  const off = await intake(k.ctx, [{ kind: 'text', text: `${text}\n\n${'More. '.repeat(300)}` }]);
  k.ctx.tools.geocoder = { locate: async (name) => (asked.push(name), name === 'Lisbon' ? { lat: 38.7223, lon: -9.1393 } : null) };
  const on = await intake(k.ctx, [{ kind: 'text', text: `${text}\n\n${'More. '.repeat(300)}` }]);

  assert.deepEqual(off.map((item) => item.data.at), [undefined, undefined]);
  assert.deepEqual(on.map((item) => item.data.at), [{ lat: 38.7223, lon: -9.1393 }, undefined]);
  assert.deepEqual(asked.sort(), ['Atlantis', 'Lisbon']);
});
