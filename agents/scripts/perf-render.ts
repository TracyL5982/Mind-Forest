/**
 * Times the two pure passes every item goes through on its way to a card:
 * Intake's `structure()` over 500 descriptions, and the Renderer's rule pass over 500 items.
 * `structure()` is timed twice: over descriptions that fill every kind of field, and over ones that fill only
 * the fields the first version of Intake read, which is the like-for-like figure across checkouts.
 * Prints one line per metric, the median of RUNS in milliseconds, or `absent` when this checkout has no such pass to time.
 *
 *   node --no-warnings --import tsx scripts/perf-render.ts
 */
import type { Item } from '../src/core/domain.ts';

const COUNT = 500;
const WARMUPS = 5;
const RUNS = 15;

const FILLER = 'The camera pulls back while the lens zooms in, so the subject holds its size and the room behind it seems to stretch away. ';

function pasted(n: number): string {
  return [
    `Note ${n}. We met Ana Lima and Ben Okri in Lisbon on 12 March.`,
    'Pros: fast builds, one small binary. Cons: a steep start.',
    'Plan | Price | Seats\nSolo | $8 | 1\nTeam | $20 | 5\nOrg | $1,200 | 100',
    'Why is the sky blue? Air scatters short wavelengths the most.',
    'Parallax: the apparent shift of an object when the viewer moves.',
    'Bring the tent, the stove and the map.',
    'Palette: Ember #E4572E, Lagoon #17BEBB and plain navy.',
    'As Nonna says, "salt it like the sea". Every stair keeps the weight of who climbed it.',
    `Sales: Jan 12, Feb 15, Mar ${n}.`,
    FILLER.repeat(6),
  ].join('\n');
}

const EMPTY = {
  title: '', summary: '', tags: [] as string[], steps: [] as string[], facts: [] as { label: string; value: string }[], quoteText: '', quoteBy: '',
  chartLabels: [] as string[], chartValues: [] as number[], chartUnit: '', personName: '', personRole: '', when: '', where: '', people: [] as string[],
  pros: [] as string[], cons: [] as string[], tableHeads: [] as string[], tableRows: [] as string[], question: '', answer: '', term: '', definition: '',
  items: [] as string[], checklist: [] as boolean[], colours: [] as { name: string; value: string }[], excerptText: '', excerptAt: '',
};

const EARLIER: ((n: number) => Partial<typeof EMPTY>)[] = [
  () => ({ steps: ['Pull back', 'Zoom in', 'Hold the subject size'], quoteText: 'Salt it like the sea', quoteBy: 'Nonna' }),
  (n) => ({ chartLabels: ['Jan', 'Feb', 'Mar'], chartValues: [12, 15, n], chartUnit: 'sales', when: '12 March' }),
  () => ({ facts: [{ label: 'Seats', value: '100' }, { label: 'Price', value: '$1,200' }], personName: 'Ana Lima', personRole: 'Editor' }),
  () => ({ quoteText: 'Every wall keeps a secret.', chartLabels: ['Jan', 'Feb'], chartValues: [12, 99] }),
  () => ({}),
];

/** What a model might say of `pasted(n)`: a few fields filled, some stated by the text and some not. */
const SAID: ((n: number) => Partial<typeof EMPTY>)[] = [
  EARLIER[0]!,
  EARLIER[1]!,
  () => ({ where: 'Lisbon', people: ['Ana Lima', 'Ben Okri', 'Carl Jung'], personName: 'Ana Lima' }),
  () => ({ pros: ['fast builds', 'one small binary', 'it is fashionable'], cons: ['a steep start'] }),
  () => ({ tableHeads: ['Plan', 'Price', 'Seats'], tableRows: ['Solo | $8 | 1', 'Team | $20 | 5', 'Org | $1,200 | 100', 'Max | $9,999 | 500'] }),
  () => ({ question: 'Why is the sky blue?', answer: 'Air scatters short wavelengths the most.', facts: [{ label: 'Seats', value: '100' }] }),
  () => ({ term: 'Parallax', definition: 'the apparent shift of an object when the viewer moves' }),
  () => ({ items: ['the tent', 'the stove', 'the map', 'a compass'], checklist: [true, false, true, false] }),
  () => ({ colours: [{ name: 'Ember', value: '#E4572E' }, { name: 'Lagoon', value: '#17BEBB' }, { name: '', value: 'navy' }, { name: 'Gold', value: '#FFC914' }] }),
  () => ({ excerptText: 'Every stair keeps the weight of who climbed it.', excerptAt: 'Chapter 3', where: 'Porto' }),
];

const DRAWN: ((n: number) => Partial<Item>)[] = [
  () => ({ data: { chart: { labels: ['1960s', '1980s', '2000s'], values: [3, 9, 14], unit: 'films' } } }),
  () => ({ data: { steps: ['Pull back', 'Zoom in', 'Hold the subject size'] } }),
  () => ({ data: { quote: { text: 'Salt it like the sea', by: 'Nonna' } } }),
  () => ({ data: { person: { name: 'Ana Lima', role: 'Editor' } } }),
  () => ({ data: { facts: [{ label: 'viewers who notice it', value: '70%' }] } }),
  (n) => ({ kind: 'image', summary: 'A stairwell seen from above.', source: { from: 'drop', asset: `asset-${n}`, capturedAt: '2026-11-14T00:00:00.000Z' } }),
  (n) => ({ kind: 'link', summary: 'A long read.', data: { site: 'example.com' }, source: { from: 'link', url: `https://example.com/read-${n}`, capturedAt: '2026-11-14T00:00:00.000Z' } }),
  () => ({ kind: 'chat', data: { messages: [{ role: 'user', text: 'Why does the room stretch?' }, { role: 'assistant', text: 'The lens zooms in while the camera pulls back.' }] } }),
  () => ({ data: { pros: ['fast builds'], cons: ['a steep start'], table: { heads: ['Plan', 'Price'], rows: [['Solo', '$8']] } } }),
  (n) => ({ text: pasted(n) }),
  () => ({ data: { chart: { labels: ['Rent', 'Food', 'Other'], values: [50, 30, 20], unit: '%' } } }),
  () => ({ data: { table: { heads: ['Plan', 'Price', 'Seats'], rows: [['Solo', '$8', '1'], ['Team', '$20', '5'], ['Org', '$1,200', '100']] } } }),
  () => ({ data: { items: ['the tent', 'the stove', 'the map'], checklist: [true, false, true] } }),
  () => ({ data: { question: 'Why is the sky blue?', answer: 'Air scatters short wavelengths the most.' } }),
  () => ({ data: { term: 'Parallax', definition: 'the apparent shift of an object when the viewer moves' } }),
  () => ({ data: { excerpt: { text: 'Every stair keeps the weight of who climbed it.', at: 'Chapter 3' }, site: 'example.com' } }),
  () => ({ data: { pros: ['fast builds', 'one small binary'], cons: ['a steep start'] } }),
  () => ({ data: { colours: [{ name: 'Ember', value: '#E4572E' }, { name: 'Lagoon', value: '#17BEBB' }, { name: 'navy', value: 'navy' }] } }),
  () => ({ data: { facts: [{ label: 'Seats', value: '100' }, { label: 'Price', value: '$1,200' }, { label: 'Plan', value: 'Org' }] } }),
  (n) => ({
    kind: 'image', origin: { by: 'agent', role: 'scout' }, data: { kind: 'artwork', by: 'Ilse Brandt', date: '1928', medium: 'Gelatin silver print', holder: 'The Example Museum of Art' },
    source: { from: 'web', url: `https://museum.example/works/${n}`, asset: `asset-${n}`, capturedAt: '2026-11-14T00:00:00.000Z' },
  }),
  (n) => ({
    origin: { by: 'agent', role: 'scout' }, data: { kind: 'paper', by: 'M. Okafor et al.', date: '2011', authors: ['M. Okafor', 'L. Haas'], authorsCut: true, venue: 'Journal of Example Vision' },
    source: { from: 'web', url: `https://doi.example/${n}`, capturedAt: '2026-11-14T00:00:00.000Z' },
  }),
  (n) => ({ title: `Lisbon ${n}`, data: { where: 'Lisbon' } }),
  (n) => ({ title: `A thought ${n}`, text: '' }),
  (n) => ({ kind: 'image', title: `beach-${n}.jpg`, data: { where: '杭州西湖' }, source: { from: 'drop', asset: `asset-${n}`, capturedAt: '2026-11-14T00:00:00.000Z' } }),
];

function item(n: number): Item {
  return {
    id: `item-${n}`, kind: 'text', title: `Item ${n}`, text: 'A short note.', summary: '', tags: [], data: {},
    source: { from: 'paste', capturedAt: '2026-11-14T00:00:00.000Z' }, origin: { by: 'user' }, archived: false, revision: 0,
    ...DRAWN[n % DRAWN.length]!(n),
  };
}

/** The median time of one pass, and what the pass returned, so a pass that did no work shows as zero. */
function time(pass: () => number): { ms: number; work: number } {
  let work = 0;
  for (let n = 0; n < WARMUPS; n++) work = pass();
  const took: number[] = [];
  for (let n = 0; n < RUNS; n++) {
    const from = performance.now();
    work = pass();
    took.push(performance.now() - from);
  }
  took.sort((a, b) => a - b);
  return { ms: took[Math.floor(RUNS / 2)]!, work };
}

const line = (metric: string, timed: { ms: number; work: number } | null, unit: string) =>
  console.log(`${metric}: ${timed ? `${timed.ms.toFixed(2)} ms (median of ${RUNS}, ${timed.work} ${unit})` : 'absent'}`);

const describe = (await import('../src/core/roles/intake/describe.ts').catch(() => null)) as { structure?: (d: any, grounding?: string) => Record<string, unknown> } | null;
const renderer = (await import('../src/core/roles/renderer.ts').catch(() => null)) as { byRule?: (item: Item, assetUrl: (id: string) => string) => { component: string } } | null;

const texts = Array.from({ length: COUNT }, (_v, n) => pasted(n));
const described = (said: typeof SAID) => texts.map((_text, n) => ({ ...EMPTY, title: `Note ${n}`, summary: 'A note.', tags: ['note'], ...said[n % said.length]!(n) }));
const items = Array.from({ length: COUNT }, (_v, n) => item(n));

const { structure } = describe ?? {};
for (const [label, descriptions] of [['', described(SAID)], [', earlier fields only', described(EARLIER)]] as const) {
  line(
    `structure() over ${COUNT} descriptions${label}`,
    structure ? time(() => descriptions.reduce((kept, d, n) => kept + Object.keys(structure(d, texts[n])).length, 0)) : null,
    'data keys kept',
  );
}

const { byRule } = renderer ?? {};
line(
  `rule pass over ${COUNT} items`,
  byRule ? time(() => items.reduce((drawn, i) => drawn + (byRule(i, (id) => `/assets/${id}`).component === 'note' ? 0 : 1), 0)) : null,
  'items drawn as more than a note',
);
if (byRule) console.log(`types drawn: ${[...new Set(items.map((i) => byRule(i, (id) => `/assets/${id}`).component))].sort().join(' ')}`);
