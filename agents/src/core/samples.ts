import type { Item } from './domain.ts';
import { fit, type Fitted } from './map.ts';
import type { LatLon } from './ports.ts';
import { byModel, byRule, type Entry } from './roles/renderer.ts';
import { COMPONENT_IDS, type ComponentId, type PropsOf } from './views.ts';

export { COMPONENT_IDS };

/** The card types a rule chooses from the structure an item carries, and `callout`, `sheet` and `explorable`, which only a model chooses. */
export const STRUCTURED_IDS = [
  'facts', 'table', 'list', 'breakdown', 'qa', 'callout', 'excerpt', 'definition', 'idea', 'proscons', 'swatch', 'artwork', 'reference', 'place', 'sheet', 'explorable',
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
  'Five days of amoxicillin against ten\n\n' +
  'Children with pneumonia treated at home were given amoxicillin for five days or for ten, and treatment failed about as often in both groups.\n' +
  'Children randomised: 824\nFailed, five-day group: 12.6%\nFailed, ten-day group: 12.4%';

const PORTO =
  'We took the early train on Friday and walked the river both days.\n' +
  'Two nights: €240\nTrain, each: €38\n' +
  'Best:\n- the bridge at dusk\n- the tiled station\n- grilled sardines by the water\n' +
  'Ines said, "I would come back just for the sardines."';

const OUTING =
  '下个月的团建要在周五前定下来，预算是每人三百元以内，一共二十二个人。\n\n' +
  '方案 | 人均 | 时长\n爬山加农家菜 | 180元 | 一整天\n陶艺体验 | 260元 | 半天\n剧本杀 | 150元 | 四小时\n\n' +
  '还没有落实的事：\n- 包车\n- 忌口统计\n- 下雨的备选';

/** Three items no single card covers, each with the sheet assembled for it: every section a part of the item, and together all of it. */
export const SHEETS: { item: Item; props: PropsOf<'sheet'> }[] = [
  {
    item: item('sheet-report', { title: 'Five days of amoxicillin against ten', text: TRIAL }),
    props: {
      sections: [
        { kind: 'heading', text: 'Five days of amoxicillin against ten' },
        { kind: 'text', text: 'Children with pneumonia treated at home were given amoxicillin for five days or for ten, and treatment failed about as often in both groups.' },
        { kind: 'figures', facts: [{ label: 'Children randomised', value: '824' }, { label: 'Failed, five-day group', value: '12.6%' }, { label: 'Failed, ten-day group', value: '12.4%' }] },
      ],
    },
  },
  {
    item: item('sheet-trip', { title: 'Weekend in Porto', text: PORTO }),
    props: {
      sections: [
        { kind: 'text', text: 'We took the early train on Friday and walked the river both days.' },
        { kind: 'figures', facts: [{ label: 'Two nights', value: '€240' }, { label: 'Train, each', value: '€38' }] },
        { kind: 'list', label: 'Best:', items: ['the bridge at dusk', 'the tiled station', 'grilled sardines by the water'] },
        { kind: 'excerpt', text: '"I would come back just for the sardines."', by: 'Ines said' },
      ],
    },
  },
  {
    item: item('sheet-outing', { title: '下个月的团建', text: OUTING }),
    props: {
      sections: [
        { kind: 'text', text: '下个月的团建要在周五前定下来，预算是每人三百元以内，一共二十二个人。' },
        { kind: 'table', heads: ['方案', '人均', '时长'], rows: [['爬山加农家菜', '180元', '一整天'], ['陶艺体验', '260元', '半天'], ['剧本杀', '150元', '四小时']] },
        { kind: 'list', label: '还没有落实的事：', items: ['包车', '忌口统计', '下雨的备选'] },
      ],
    },
  },
];

const EMPTY: Omit<Entry, 'id' | 'component'> = {
  subject: '', passage: '', by: '', tone: '', lines: [], labels: [], numbers: [], left: [], right: [], unit: '', emphasis: '', sections: [], controls: [], formula: '',
};
type Control = Entry['controls'][number];
/** Each state's text is its whole line, its name and colon included, because a card shows only whole units of its item. */
const line = ([name, text]: [string, string], colon: string) => `${name}${colon}${text}`;
const states = (kind: 'toggle' | 'segmented', label: string, given: [string, string][], colon = ': '): Control => ({
  kind, label, states: given.map(([name]) => name), texts: given.map((state) => line(state, colon)), name: '', unit: '', min: 0, max: 0, values: [],
});

const DOLLY: [string, string][] = [
  ['Zoom only', 'the lens zooms in while the camera stays put, so the background grows with the subject.'],
  ['Dolly only', 'the camera moves in on a fixed lens, so the subject grows and the background barely changes.'],
  ['Both', 'the camera pulls back as the lens zooms in, so the subject holds its size and the background swells behind it.'],
];
const APERTURE: [string, string][] = [
  ['大光圈', '背景虚化得很厉害，只有对焦的那一层是清楚的。'],
  ['小光圈', '从前景到远山都清楚，但快门要放慢。'],
];

/**
 * Three items that explain by changing something, each with the explorable that the Renderer's model path builds from a reply: a
 * slider for the field of view against focal length, a three-way control for a dolly zoom, and a toggle in Chinese.
 */
export const EXPLORABLES: { item: Item; props: PropsOf<'explorable'> }[] = ([
  {
    item: item('explorable-field', {
      title: 'Field of view against focal length',
      text: 'On a full-frame camera the sensor is 36 mm wide, so the field of view narrows as the focal length grows. At 24 mm the field of view is 73.7°. At 50 mm it is 39.6°. At 200 mm it is 10.3°.',
    }),
    reply: {
      controls: [{ kind: 'slider', label: 'focal length', states: [], texts: [], name: 'f', unit: 'mm', min: 12, max: 300, values: [24, 50, 200] }],
      formula: '2 * atan(18 / f) * 57.2958', subject: 'field of view', unit: '°', numbers: [73.7, 39.6, 10.3],
    },
  },
  {
    item: item('explorable-dolly', { title: 'Three ways to shoot a dolly zoom', text: `Three ways to shoot a dolly zoom.\n${DOLLY.map((state) => line(state, ': ')).join('\n')}` }),
    reply: { controls: [states('segmented', 'Three ways to shoot a dolly zoom', DOLLY)] },
  },
  {
    item: item('explorable-aperture', { title: '光圈与景深', text: `光圈开大还是收小，决定了照片里有多少是清楚的。\n${APERTURE.map((state) => line(state, '：')).join('\n')}` }),
    reply: { controls: [states('toggle', '光圈', APERTURE, '：')] },
  },
] satisfies { item: Item; reply: Partial<Entry> }[]).map(({ item: made, reply }) => {
  const verdict = byModel({ ...EMPTY, ...reply, id: made.id, component: 'explorable' }, made, sampleAssetUrl);
  if (!('draw' in verdict)) throw new Error(`the sample explorable "${made.title}" is refused: ${JSON.stringify(verdict)}`);
  return { item: made, props: verdict.draw.props as PropsOf<'explorable'> };
});

const ITEMS: Record<StructuredId, Item> = {
  facts: item('facts', {
    title: 'Eiffel Tower',
    text: 'Height: 330 m. Built: 1889. Floors: 3. Steps: 1,665. Weight: 10,100 tonnes. Architect: Stephen Sauvestre.',
    data: {
      facts: [
        { label: 'Height', value: '330 m' }, { label: 'Built', value: '1889' }, { label: 'Floors', value: '3' }, { label: 'Steps', value: '1,665' },
        { label: 'Weight', value: '10,100 tonnes' }, { label: 'Architect', value: 'Stephen Sauvestre' },
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
    text: 'Feed it once a day with equal parts flour and water. Rinse the jar with cold water only. Anything above 40 °C kills the yeast.',
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
    data: { term: 'Parallax', definition: 'Parallax: the apparent shift of an object against its background when the viewer moves.' },
  }),
  idea: item('idea', { title: '把书房搬到阁楼', text: '把书房搬到阁楼' }),
  proscons: item('proscons', {
    title: 'Moving the team to Rust',
    text: 'Pros:\n- no data races\n- one small binary\n- fast at run time\n\nCons:\n- slow builds\n- a steep start',
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
  explorable: EXPLORABLES[0]!.item,
};

/** The props of the types no rule chooses. */
const CHOSEN: Partial<Record<StructuredId, Record<string, unknown>>> = {
  callout: { text: 'Anything above 40 °C kills the yeast.', tone: 'caution', above: ['Feed it once a day with equal parts flour and water. Rinse the jar with cold water only.'] } satisfies PropsOf<'callout'>,
  sheet: SHEETS[0]!.props,
  explorable: EXPLORABLES[0]!.props,
};

/** One realistic item for each of these types, with the props the Renderer gives it. */
export const SAMPLES = Object.fromEntries(
  STRUCTURED_IDS.map((id) => [id, { item: ITEMS[id], props: CHOSEN[id] ?? byRule(ITEMS[id], sampleAssetUrl).props }]),
) as Record<StructuredId, { item: Item; props: Record<string, unknown> }>;

/** One map the library page draws: its members in pin order, each a picture or a note at the point its data holds, and the props the map rule gives them. */
export interface MapSample {
  label: string;
  status: 'kept' | 'pick';
  members: { id: string; picture?: 'river' | 'fields' | 'night' | 'quilt'; item: Item }[];
  props: Fitted<string>;
}

function mapSample(label: string, status: MapSample['status'], members: MapSample['members']): MapSample {
  const props = fit(members.map(({ id, item }) => [id, item.data.at as LatLon] as const));
  const order = props.pins.flatMap((pin) => pin.members);
  return { label, status, members: [...members].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)), props };
}

const at = (id: string, title: string, data: Item['data'], fields: Partial<Item> = {}) => ({ id: `sample-map-${id}`, item: item(`map-${id}`, { title, data, ...fields }) });

/** A trip of four photos from three places, and five places in Chinese as picks, two of them under one pin. */
export const MAPS: MapSample[] = [
  mapSample('Four photos from three places', 'kept', [
    { ...at('alfama', 'Washing lines in Alfama', { where: 'Lisbon', at: { lat: 38.7139, lon: -9.1334 } }, { kind: 'image' }), picture: 'river' },
    { ...at('porto', 'The bridge at dusk', { where: 'Porto', at: { lat: 41.1406, lon: -8.611 } }, { kind: 'image' }), picture: 'night' },
    { ...at('evora', 'Cork oaks outside Évora', { at: { lat: 38.5714, lon: -7.9135 } }, { kind: 'image' }), picture: 'fields' },
    { ...at('alfama-2', 'The tram up to Graça', { where: 'Lisbon', at: { lat: 38.7141, lon: -9.1337 } }, { kind: 'image' }), picture: 'quilt' },
  ]),
  mapSample('Five places in Chinese, as picks', 'pick', [
    { ...at('xihu', '西湖骑车', { where: '杭州', at: { lat: 30.2431, lon: 120.15 } }, { summary: '从断桥骑到苏堤，大约一个小时。' }) },
    { ...at('suzhou', '苏州园林', { where: '苏州', at: { lat: 31.299, lon: 120.5853 } }, { summary: '拙政园早上八点开门，人少。' }) },
    { ...at('bund', '外滩夜景', { where: '上海', at: { lat: 31.2304, lon: 121.4737 } }, { summary: '晚上七点以后灯才全亮。' }) },
    { ...at('lingyin', '灵隐寺', { where: '杭州', at: { lat: 30.2408, lon: 120.1017 } }, { summary: '早点去，人少。' }) },
    { ...at('moganshan', '莫干山民宿', { where: '莫干山', at: { lat: 30.6086, lon: 119.8664 } }, { summary: '竹林里的小路，一直走到山顶的老别墅。' }) },
  ]),
];
