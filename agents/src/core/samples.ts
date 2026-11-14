import type { Item } from './domain.ts';
import { byRule } from './roles/renderer.ts';
import { COMPONENT_IDS, type ComponentId, type PropsOf } from './views.ts';

export { COMPONENT_IDS };

/** The card types a rule chooses from the structure an item carries, and `callout` and `sheet`, which only a model chooses. */
export const STRUCTURED_IDS = [
  'facts', 'table', 'list', 'breakdown', 'qa', 'callout', 'excerpt', 'definition', 'idea', 'proscons', 'swatch', 'artwork', 'reference', 'place', 'sheet',
] as const satisfies readonly ComponentId[];
export type StructuredId = (typeof STRUCTURED_IDS)[number];

/** Where a sample's stored picture is served from. */
export const sampleAssetUrl = (id: string): string => `/assets/${id}`;

const CAPTURED = '2026-11-14T00:00:00.000Z';

function item(id: string, fields: Partial<Item> & { title: string }): Item {
  return {
    id: `sample-${id}`, kind: 'text', text: '', summary: '', tags: [], data: {},
    source: { from: 'paste', capturedAt: CAPTURED }, origin: { by: 'user' }, archived: false, revision: 0,
    ...fields,
  };
}

const pick = { origin: { by: 'agent', role: 'scout' } } as const;

const TRIAL =
  'Children aged six months to five years with pneumonia that did not need hospital care were given amoxicillin for five days or for ten. ' +
  'In all, 824 children were randomised across nine clinics. Treatment had failed by day 30 in 12.6% of the five-day group and 12.4% of the ten-day group, ' +
  'a difference well inside the margin set in advance. Side effects were mild and no more common in either group, and parents in the shorter arm missed fewer days of work. ' +
  'The authors conclude that five days is enough for a child treated at home, and that guidelines asking for longer should be revisited.';

const PORTO =
  'We took the early train on Friday and walked the river both days. It rained on Saturday afternoon, so we sat in the bookshop until it closed ' +
  'and nobody minded. Two nights at the guesthouse came to €240 with breakfast, and the train was €38 each. ' +
  'Ines said, "I would come back just for the sardines." We agreed on what was best: the bridge at dusk, the tiled station, grilled sardines by the water. ' +
  'Next time we go in May, before the crowds, and stay an extra night.';

const OUTING =
  '下个月的团建要在周五前定下来，预算是每人三百元以内，一共二十二个人。行政部先给了三个方案，大家可以在群里投票。\n\n' +
  '方案 | 人均 | 时长\n爬山加农家菜 | 180元 | 一整天\n陶艺体验 | 260元 | 半天\n剧本杀 | 150元 | 四小时\n\n' +
  '还没有落实的事：包车、忌口统计、下雨的备选。去年有人说活动太赶，今年尽量不要安排在周末，结束后也不强制聚餐。';

/** Three items no single card covers, each with the sheet assembled for it. */
export const SHEETS: { item: Item; props: PropsOf<'sheet'> }[] = [
  {
    item: item('sheet-report', { title: 'Five days of amoxicillin against ten', text: TRIAL }),
    props: {
      sections: [
        { kind: 'heading', text: 'Five days of amoxicillin against ten' },
        { kind: 'text', text: 'The authors conclude that five days is enough for a child treated at home, and that guidelines asking for longer should be revisited.' },
        { kind: 'figures', facts: [{ label: 'Children randomised', value: '824' }, { label: 'Failed, five days', value: '12.6%' }, { label: 'Failed, ten days', value: '12.4%' }] },
      ],
    },
  },
  {
    item: item('sheet-trip', { title: 'Weekend in Porto', text: PORTO }),
    props: {
      sections: [
        { kind: 'text', text: 'We took the early train on Friday and walked the river both days.' },
        { kind: 'figures', facts: [{ label: 'Two nights', value: '€240' }, { label: 'Train, each', value: '€38' }] },
        { kind: 'list', items: ['the bridge at dusk', 'the tiled station', 'grilled sardines by the water'] },
        { kind: 'excerpt', text: 'I would come back just for the sardines.', by: 'Ines' },
      ],
    },
  },
  {
    item: item('sheet-outing', { title: '下个月的团建', text: OUTING }),
    props: {
      sections: [
        { kind: 'heading', text: '下个月的团建' },
        { kind: 'text', text: '下个月的团建要在周五前定下来，预算是每人三百元以内，一共二十二个人。' },
        { kind: 'table', heads: ['方案', '人均', '时长'], rows: [['爬山加农家菜', '180元', '一整天'], ['陶艺体验', '260元', '半天'], ['剧本杀', '150元', '四小时']] },
        { kind: 'list', items: ['包车', '忌口统计', '下雨的备选'] },
      ],
    },
  },
];

const ITEMS: Record<StructuredId, Item> = {
  facts: item('facts', {
    title: 'Eiffel Tower',
    text: 'Height: 330 m. Built: 1889. Floors: 3. Steps: 1,665. Weight: 10,100 tonnes. Architect: Stephen Sauvestre. Visitors a year: 6 million.',
    data: {
      facts: [
        { label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }, { label: 'Floors', value: '3' }, { label: 'Steps', value: '1,665' },
        { label: 'Weight', value: '10,100 tonnes' }, { label: 'Architect', value: 'Stephen Sauvestre' }, { label: 'Visitors a year', value: '6 million' },
      ],
    },
  }),
  table: item('table', {
    title: 'Plans compared',
    text: 'Plan | Price | Seats | Support\nSolo | $8 | 1 |\nTeam | $20 | 5 | Email\nOrg | $1,200 | 100 | Phone',
    data: { table: { heads: ['Plan', 'Price', 'Seats', 'Support'], rows: [['Solo', '$8', '1', ''], ['Team', '$20', '5', 'Email'], ['Org', '$1,200', '100', 'Phone']] } },
  }),
  list: item('list', {
    title: '周末露营清单',
    text: '周末露营清单\n[x] 帐篷\n[x] 睡袋\n[ ] 头灯\n[ ] 驱蚊水',
    data: { items: ['帐篷', '睡袋', '头灯', '驱蚊水'], checklist: [true, true, false, false] },
  }),
  breakdown: item('breakdown', {
    title: 'Where the month goes',
    text: 'Rent 45%, food 25%, transport 10%, savings 20%.',
    data: { chart: { labels: ['Rent', 'Food', 'Transport', 'Savings'], values: [45, 25, 10, 20], unit: '%' } },
  }),
  qa: item('qa', {
    title: '为什么天空是蓝色的',
    text: '为什么天空是蓝色的？因为空气分子对短波长的蓝光散射得最强。',
    data: { question: '为什么天空是蓝色的？', answer: '因为空气分子对短波长的蓝光散射得最强。' },
  }),
  callout: item('callout', {
    title: 'Feeding the starter',
    text: 'Feed it once a day with equal parts flour and water. Never rinse the jar with hot water. Anything above 40 °C kills the yeast.',
  }),
  excerpt: item('excerpt', {
    title: 'The Poetics of Space',
    text: 'Copied out of Chapter 1, on the house as the first universe of a child.\n\nThe house shelters day-dreaming, the house protects the dreamer.',
    summary: 'Bachelard on how rooms hold memory.',
    data: { excerpt: { text: 'The house shelters day-dreaming, the house protects the dreamer.', at: 'Chapter 1' }, site: 'example.org' },
  }),
  definition: item('definition', {
    title: 'Parallax',
    text: 'Parallax: the apparent shift of an object against its background when the viewer moves.',
    data: { term: 'Parallax', definition: 'the apparent shift of an object against its background when the viewer moves' },
  }),
  idea: item('idea', { title: '把书房搬到阁楼', text: '把书房搬到阁楼' }),
  proscons: item('proscons', {
    title: 'Moving the team to Rust',
    text: 'Pros: no data races, one small binary, fast at run time. Cons: slow builds, a steep start.',
    data: { pros: ['no data races', 'one small binary', 'fast at run time'], cons: ['slow builds', 'a steep start'] },
  }),
  swatch: item('swatch', {
    title: 'Kitchen palette',
    text: 'Ember #E4572E for the door, Lagoon #17BEBB for the tiles, and plain ivory on the walls.',
    data: { colours: [{ name: 'Ember', value: '#E4572E' }, { name: 'Lagoon', value: '#17BEBB' }, { name: 'ivory', value: 'ivory' }] },
  }),
  artwork: item('artwork', {
    ...pick,
    kind: 'image',
    title: 'Stairwell, seen from above',
    text: 'Gelatin silver print\n\nIlse Brandt, 1928, The Example Museum of Art',
    summary: 'A spiral stair photographed straight down.',
    data: { kind: 'artwork', site: 'museum.example', by: 'Ilse Brandt', date: '1928', from: 'The Example Museum of Art', medium: 'Gelatin silver print', holder: 'The Example Museum of Art' },
    source: { from: 'web', url: 'https://museum.example/works/1928-14', asset: 'sample-stairwell', capturedAt: CAPTURED },
  }),
  reference: item('reference', {
    ...pick,
    title: 'Perceived depth under opposed zoom and camera motion',
    text: 'Viewers judged the room to stretch by half when the lens zoomed in as the camera pulled back.\n\nM. Okafor et al., 2011, Research papers',
    summary: 'A study of how the dolly zoom changes perceived depth.',
    data: {
      kind: 'paper', site: 'doi.example', by: 'M. Okafor et al.', date: '2011-05-03', from: 'Research papers',
      authors: ['M. Okafor', 'L. Haas', 'R. Itō'], authorsCut: true, venue: 'Journal of Example Vision',
    },
    source: { from: 'web', url: 'https://doi.example/10.1000/zoom.2011', capturedAt: CAPTURED },
  }),
  place: item('place', {
    title: '西湖',
    text: '清晨的西湖，断桥上还没有游人，湖面起了一层薄雾。',
    summary: '清晨的西湖。',
    data: { where: '西湖', image: 'https://example.org/west-lake.jpg' },
  }),
  sheet: SHEETS[0]!.item,
};

/** The props of the types no rule chooses. */
const CHOSEN: Partial<Record<StructuredId, Record<string, unknown>>> = {
  callout: { text: 'Anything above 40 °C kills the yeast.', tone: 'caution' } satisfies PropsOf<'callout'>,
  sheet: SHEETS[0]!.props,
};

/** One realistic item for each of these types, with the props the Renderer gives it. */
export const SAMPLES = Object.fromEntries(
  STRUCTURED_IDS.map((id) => [id, { item: ITEMS[id], props: CHOSEN[id] ?? byRule(ITEMS[id], sampleAssetUrl).props }]),
) as Record<StructuredId, { item: Item; props: Record<string, unknown> }>;
