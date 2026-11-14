import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Item } from '../src/core/domain.ts';
import type { JsonRequest } from '../src/core/ports.ts';
import { intake } from '../src/core/roles/intake.ts';
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

test('structure is kept only when the content holds it', async () => {
  const k = kit();
  const text = 'Recipe: 1. Boil water. 2. Add 200 g of pasta. 3. Drain. As Nonna says, "salt it like the sea". Cost: Jan 12, Feb 15.';
  k.model.on('intake.text', () => ({
    entries: [
      {
        dump: 0,
        text: '',
        ...described('Pasta', {
          steps: ['Boil water', 'Add pasta', 'Drain'],
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

  assert.deepEqual(item!.data.steps, ['Boil water', 'Add pasta', 'Drain']);
  assert.deepEqual(item!.data.facts, [{ label: 'Pasta', value: '200 g' }]);
  assert.deepEqual(item!.data.quote, { text: 'Salt it like the sea', by: 'Nonna' });
  assert.equal(item!.data.chart, undefined, 'a chart value the text does not state is dropped');
  assert.equal('when' in item!.data, false);
  assert.equal('person' in item!.data, false);
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
    text: 'Moving to Rust.\nPros: no data races, one binary.\nCons: slow builds.',
    reply: { pros: ['No data races', 'one binary'] },
    kept: { pros: ['No data races', 'one binary'] },
    wrong: { pros: ['It is fashionable'] },
  },
  {
    field: 'cons',
    text: 'Moving to Rust.\nPros: no data races, one binary.\nCons: slow builds.',
    reply: { cons: ['slow builds'] },
    kept: { cons: ['slow builds'] },
    wrong: { cons: ['Nobody knows it'] },
  },
  {
    field: 'table',
    text: 'Plan | Price | Seats\nSolo | $8 | 1\nTeam | $20 | 5\nOrg | $1,200 | 100',
    reply: { tableHeads: ['Plan', 'Price', 'Seats'], tableRows: ['Solo | $8 | 1', '| Team | $20 | 5 |', 'Org | $1,200 | 100'] },
    kept: { table: { heads: ['Plan', 'Price', 'Seats'], rows: [['Solo', '$8', '1'], ['Team', '$20', '5'], ['Org', '$1,200', '100']] } },
    wrong: { tableHeads: ['Plan', 'Price', 'Seats'], tableRows: ['Solo | $8 | 1', 'Team | $45 | 5', 'Org | $1,200'] },
    left: { table: { heads: ['Plan', 'Price', 'Seats'], rows: [['Solo', '$8', '1']] } },
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
    reply: { term: 'Parallax', definition: 'the apparent shift of an object when the viewer moves' },
    kept: { term: 'Parallax', definition: 'the apparent shift of an object when the viewer moves' },
    wrong: { term: 'Parallax', definition: 'an error in a viewfinder' },
  },
  {
    field: 'items and checklist',
    text: 'Packing:\n[x] passport\n[ ] charger\n[x] rain coat',
    reply: { items: ['passport', 'charger', 'rain coat'], checklist: [true, false, true] },
    kept: { items: ['passport', 'charger', 'rain coat'], checklist: [true, false, true] },
    wrong: { items: ['passport', 'sunglasses', 'rain coat'], checklist: [true, false, true] },
    left: { items: ['passport', 'rain coat'], checklist: [true, true] },
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

test('a list is a checklist only when every item has a mark', async () => {
  const data = await extracted('Bring: tent, stove, map.', { items: ['tent', 'stove', 'map'], checklist: [true] });
  assert.deepEqual(data, { items: ['tent', 'stove', 'map'] });
});

test('a photo has no text to check against, so what the model reads in it is kept', async () => {
  const k = kit();
  const { id } = await k.assets.put(new Uint8Array([1, 2, 3]), 'image/jpeg', 'beach.jpg');
  k.model.on('intake.image', () => ({ ...described('Two friends on a beach', { where: 'Nazaré', people: ['Ana Lima', 'Ben Okri'] }), description: 'Two people on sand.' }));

  const [photo] = await intake(k.ctx, [{ kind: 'asset', asset: id, mime: 'image/jpeg', name: 'beach.jpg' }]);

  assert.deepEqual(photo!.data, { where: 'Nazaré', people: ['Ana Lima', 'Ben Okri'] });
});

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
    transcribe: () => k.model.transcribe(),
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
