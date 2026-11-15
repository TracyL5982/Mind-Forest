import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fittedTitle, shortTitleOf } from '../src/core/fitted.ts';
import { labels } from '../src/core/roles/intake/describe.ts';
import { makeItem } from '../src/core/roles/types.ts';
import { kit } from './kit.ts';

type Shared = {
  linesOf: (str: string, column: number, measure: string) => number;
  fit: (str: string, column: number, measure: string, most: number, ellipsis?: boolean) => { words: string; lines: number; whole: boolean };
  faceTitleOf: (item: unknown) => string;
};
type Card = { size: (item: unknown, props: unknown) => number[] };
const shared = (await import(new URL('../client/js/components/shared.js', import.meta.url).href)) as Shared;
const { COMPONENTS } = (await import(new URL('../client/js/components/index.js', import.meta.url).href)) as { COMPONENTS: Record<string, Card> };
const lines = (title: string) => shared.linesOf(title, 177, 'title');
const USER = { by: 'user' as const };

const LONG = {
  clause: 'The dolly zoom: how Hitchcock made the floor drop away from James Stewart',
  words: 'A title that runs on well past the two lines a small face gives any title at all',
  han: '记忆宫殿把每一个想法都放在一张卡片上研究笔记与灵感可以自由排列组合',
  paper: 'Perceived depth under opposed zoom and camera motion in early cinema',
  work: '千里江山图卷，北宋王希孟所作青绿山水长卷，现藏于北京故宫博物院',
};

test('a title the model writes is held to the two lines a small face gives a title, at a clause or a whole word, with no ellipsis', () => {
  assert.equal(fittedTitle('Short title'), 'Short title', 'a title that fits is kept whole');
  assert.equal(fittedTitle(LONG.clause), 'The dolly zoom', 'its first whole clause when that says something');
  assert.equal(fittedTitle(LONG.words), 'A title that runs on well past the two', 'else its first whole words');
  assert.equal(fittedTitle(LONG.han), '记忆宫殿把每一个想法都放在一张卡片上', 'else its first characters, where a script has no spaces');
  for (const title of Object.values(LONG)) {
    const fitted = fittedTitle(title);
    assert.ok(lines(fitted) <= 2 && title.startsWith(fitted) && !/…$/.test(fitted), `${title} gives ${fitted}`);
  }
  const plain = { title: 'notes from the site visit on tuesday morning with the whole crew.txt', summary: '', tags: [] };
  assert.equal(labels({ title: LONG.words, summary: '', tags: [] }, plain).title, fittedTitle(LONG.words), 'Intake holds the model\'s title');
  assert.equal(labels({ title: '', summary: '', tags: [] }, plain).title, plain.title, 'and keeps a file\'s own name whole when the model gave none');
});

test('a title from a source is kept whole, and the item carries the start of it a small face shows as data.shortTitle', () => {
  const k = kit();
  const made = (title: string) => makeItem(k.ctx, { kind: 'text', title, origin: USER, source: { from: 'paste' } });
  for (const title of [LONG.paper, LONG.work]) {
    const item = made(title);
    assert.equal(item.title, title, 'the source\'s title is never rewritten');
    assert.equal(item.data.shortTitle, fittedTitle(title));
    assert.ok(lines(item.data.shortTitle as string) <= 2);
  }
  assert.equal(shortTitleOf('Vertigo'), undefined);
  assert.equal('shortTitle' in made('Vertigo').data, false, 'a title that fits has no short title');

  const { nodeIds } = k.seedTree('Film', ['Root', 'A']);
  const itemId = k.mind.node(nodeIds[1]!).itemId;
  const edit = (title: string) => {
    k.mind.apply({ origin: USER, label: 'edit', commands: [{ type: 'editItem', id: itemId, patch: { title } }] });
    return k.mind.item(itemId);
  };
  assert.equal(edit(LONG.paper).data.shortTitle, fittedTitle(LONG.paper), 'a new title brings its own short title');
  assert.equal('shortTitle' in edit('Vertigo').data, false, 'and a title that fits drops the old one');
});

test('a small face shows a title whole on up to two lines, else its first two cut at a whole word with an ellipsis, and a short title in its place', () => {
  const note = (item: Record<string, unknown>) => COMPONENTS.note!.size({ summary: '', text: '', data: {}, ...item }, {})[1];
  for (const title of [LONG.words, LONG.han]) {
    const shown = shared.fit(title, 177, 'title', 2, true);
    assert.ok(shown.whole && shown.lines === 2 && shown.words.endsWith('…'), `${title}: ${shown.words}`);
    assert.ok(title.startsWith(shown.words.slice(0, -1)), 'the start of the title, cut where a word or a character ends');
    assert.equal(note({ title }), 30 + 2 * 24, 'two lines and no cue');
  }
  assert.equal(shared.fit(LONG.words, 177, 'title', 2, true).words, 'A title that runs on well past the two…');
  assert.equal(shared.fit(LONG.han, 177, 'title', 2, true).words, '记忆宫殿把每一个想法都放在一张卡片…');
  const sourced = { title: LONG.paper, data: { shortTitle: fittedTitle(LONG.paper) } };
  assert.equal(shared.faceTitleOf(sourced), fittedTitle(LONG.paper), 'the face shows the short title');
  assert.equal(note(sourced), 30 + lines(fittedTitle(LONG.paper)) * 24);
});
