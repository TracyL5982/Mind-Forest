import assert from 'node:assert/strict';
import { test } from 'node:test';

type Source = { kind: string; label: string; text: string };
type Chips = { chipSources: (item: unknown) => Source[] };

const { chipSources }: Chips = await import(new URL('../client/js/chips.js', import.meta.url).href);

const item = (data: Record<string, unknown>) => ({ title: 'A card', data, origin: { by: 'user' } });
const brought = (data: Record<string, unknown>) => ({ title: 'A card', data, origin: { by: 'agent', role: 'scout' } });
const LABEL: Record<string, string> = { when: 'When', where: 'Where', people: 'People', origin: 'Origin' };
const said = (sources: Source[]) => sources.map(({ kind, label, text }) => {
  assert.equal(label, LABEL[kind], `a ${kind} source is labelled ${LABEL[kind]}`);
  return [kind, text];
});

const FIVE = { when: '12 May 1958', where: 'Bodega Bay', people: ['Ada', 'Grace', 'Edsger', 'Barbara', 'Alan'], from: 'The Met', site: 'metmuseum.org' };

test('an item with no source gives the opened card none', () => {
  assert.deepEqual(chipSources(item({})), []);
  assert.deepEqual(chipSources({ title: 'No data at all' }), []);
  assert.deepEqual(chipSources(brought({ when: '  ', date: 1958, where: 7, people: 'Ada', authors: [], by: ' ', from: null })), []);
  assert.deepEqual(chipSources(item({ people: [] })), []);
});

test('what the user made lists its sources in the order when, where, people', () => {
  assert.deepEqual(said(chipSources(item({ people: ['Ada'], where: 'Bodega Bay', when: '1958' }))), [['when', '1958'], ['where', 'Bodega Bay'], ['people', 'Ada']]);
});

test('what the agents brought says where it came from straight after its date, and names every person', () => {
  assert.deepEqual(said(chipSources(brought({ from: 'The Met', people: ['Ada'], where: 'Bodega Bay' }))), [['origin', 'The Met'], ['where', 'Bodega Bay'], ['people', 'Ada']]);
  assert.deepEqual(said(chipSources(brought(FIVE))), [
    ['when', '12 May 1958'], ['origin', 'metmuseum.org'], ['where', 'Bodega Bay'], ['people', 'Ada, Grace, Edsger, Barbara, Alan'],
  ]);
  assert.deepEqual(said(chipSources(item({ people: ['Ada', '', 3, ' Grace '] }))), [['people', 'Ada, Grace']], 'a blank or a name that is not a string is passed over');
});

test('the date is data.when, else data.date, which is the key the Scout writes', () => {
  assert.deepEqual(said(chipSources(item({ when: '12 May 1958', date: '1958' }))), [['when', '12 May 1958']]);
  assert.deepEqual(said(chipSources(item({ date: '1857' }))), [['when', '1857']]);
  assert.deepEqual(said(chipSources(item({ when: ' ', date: '1857' }))), [['when', '1857']]);
});

test('the people are data.people, else data.authors, and never data.by', () => {
  const all = { people: ['Ada', 'Grace'], authors: ['T. Screech', 'M. Forrer', 'H. Smith'], by: 'Screech et al.' };
  assert.deepEqual(said(chipSources(item(all))), [['people', 'Ada, Grace']]);
  assert.deepEqual(said(chipSources(item({ ...all, people: [] }))), [['people', 'T. Screech, M. Forrer, H. Smith']]);
  assert.deepEqual(chipSources(item({ by: 'Utagawa Hiroshige' })), [], 'by alone names no people: it is as often a site or a score as a person');
  assert.deepEqual(chipSources(brought({ by: '312 points, 45 comments' })), []);
  assert.deepEqual(chipSources(item({ authors: 'T. Screech' })), []);
});

test('the origin is the first of holder, venue, site and from that holds more than spaces', () => {
  const all = { holder: 'Rijksmuseum', venue: 'Journal of Japanese Studies', site: 'example.com', from: 'The web' };
  const origin = (data: Record<string, unknown>) => said(chipSources(brought(data)));
  assert.deepEqual(origin(all), [['origin', 'Rijksmuseum']]);
  assert.deepEqual(origin({ ...all, holder: undefined }), [['origin', 'Journal of Japanese Studies']]);
  assert.deepEqual(origin({ site: 'example.com', from: 'The web' }), [['origin', 'example.com']]);
  assert.deepEqual(origin({ from: 'Research papers' }), [['origin', 'Research papers']]);
  assert.deepEqual(origin({ holder: '   ', venue: '', site: 7, from: ' The web ' }), [['origin', 'The web']], 'a blank or a value that is not a string is passed over');
});

test('an item the user added shows no origin, whatever its data holds', () => {
  assert.deepEqual(chipSources(item({ from: 'The Met', holder: 'Rijksmuseum', venue: 'Nature', site: 'example.com' })), []);
  assert.deepEqual(chipSources({ title: 'No origin recorded', data: { from: 'The Met' } }), []);
  assert.deepEqual(said(chipSources(item({ when: '1857', from: 'The Met' }))), [['when', '1857']]);
});

test('a source that repeats an earlier one is left out', () => {
  assert.deepEqual(said(chipSources(brought({ holder: 'Rijksmuseum', authors: ['Rijksmuseum'], from: 'The web' }))), [['origin', 'Rijksmuseum']]);
  assert.deepEqual(said(chipSources(item({ when: 'Edo', where: 'Edo' }))), [['when', 'Edo']]);
});

test('the sources do not change the item or depend on anything else', () => {
  const given = brought(FIVE);
  const before = JSON.stringify(given);
  assert.deepEqual(chipSources(given), chipSources(given));
  assert.equal(JSON.stringify(given), before);
});
