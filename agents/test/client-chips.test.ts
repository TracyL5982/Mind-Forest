import assert from 'node:assert/strict';
import { test } from 'node:test';

type Chip = { kind: string; text: string; count?: number };
type Source = { kind: string; label: string; text: string };
type Chips = {
  chips: (item: unknown, shown?: string[]) => Chip[];
  chipSources: (item: unknown) => Source[];
};

const { chips, chipSources }: Chips = await import(new URL('../client/js/chips.js', import.meta.url).href);

const item = (data: Record<string, unknown>) => ({ title: 'A card', data, origin: { by: 'user' } });
const brought = (data: Record<string, unknown>) => ({ title: 'A card', data, origin: { by: 'agent', role: 'scout' } });

const FIVE = { when: '12 May 1958', where: 'Bodega Bay', people: ['Ada', 'Grace', 'Edsger'], from: 'The Met', site: 'metmuseum.org' };

test('an item with no chip source gives no chips', () => {
  assert.deepEqual(chips(item({})), []);
  assert.deepEqual(chips({ title: 'No data at all' }), []);
  assert.deepEqual(chips(brought({ when: '  ', date: 1958, where: 7, people: 'Ada', authors: [], by: ' ', from: null })), []);
  assert.deepEqual(chips(item({ people: [] })), []);
});

test('what the user made has its chips in the order when, where, people', () => {
  assert.deepEqual(chips(item({ people: ['Ada'], where: 'Bodega Bay', when: '1958' })), [
    { kind: 'when', text: '1958' },
    { kind: 'where', text: 'Bodega Bay' },
    { kind: 'people', text: 'Ada' },
  ]);
});

test('what the agents brought says where it came from straight after its date', () => {
  assert.deepEqual(chips(brought({ from: 'The Met', people: ['Ada'], where: 'Bodega Bay' })), [
    { kind: 'origin', text: 'The Met' },
    { kind: 'where', text: 'Bodega Bay' },
    { kind: 'people', text: 'Ada' },
  ]);
  assert.deepEqual(chips(brought(FIVE)), [
    { kind: 'when', text: '12 May 1958' },
    { kind: 'origin', text: 'metmuseum.org' },
    { kind: 'where', text: 'Bodega Bay' },
  ], 'four sources give three chips');
});

test('five people give two names and a count', () => {
  assert.deepEqual(chips(item({ people: ['Ada', 'Grace', 'Edsger', 'Barbara', 'Alan'] })), [{ kind: 'people', text: 'Ada, Grace', count: 3 }]);
  assert.deepEqual(chips(item({ people: ['Ada', 'Grace'] })), [{ kind: 'people', text: 'Ada, Grace' }]);
  assert.deepEqual(chips(item({ people: ['Ada', '', 3, ' Grace '] })), [{ kind: 'people', text: 'Ada, Grace' }]);
});

test('the date is data.when, else data.date, which is the key the Scout writes', () => {
  assert.deepEqual(chips(item({ when: '12 May 1958', date: '1958' })), [{ kind: 'when', text: '12 May 1958' }]);
  assert.deepEqual(chips(item({ date: '1857' })), [{ kind: 'when', text: '1857' }]);
  assert.deepEqual(chips(item({ when: ' ', date: '1857' })), [{ kind: 'when', text: '1857' }]);
});

test('the people are data.people, else data.authors, else the one data.by names', () => {
  const all = { people: ['Ada', 'Grace'], authors: ['T. Screech', 'M. Forrer', 'H. Smith'], by: 'Screech et al.' };
  assert.deepEqual(chips(item(all)), [{ kind: 'people', text: 'Ada, Grace' }]);
  assert.deepEqual(chips(item({ ...all, people: [] })), [{ kind: 'people', text: 'T. Screech, M. Forrer', count: 1 }]);
  assert.deepEqual(chips(item({ by: 'Utagawa Hiroshige' })), [{ kind: 'people', text: 'Utagawa Hiroshige' }]);
  assert.deepEqual(chips(item({ authors: 'T. Screech', by: ' ' })), []);
});

test('the origin is the first of holder, venue, site and from that holds more than spaces', () => {
  const all = { holder: 'Rijksmuseum', venue: 'Journal of Japanese Studies', site: 'example.com', from: 'The web' };
  const origin = (data: Record<string, unknown>) => chips(brought(data));
  assert.deepEqual(origin(all), [{ kind: 'origin', text: 'Rijksmuseum' }]);
  assert.deepEqual(origin({ ...all, holder: undefined }), [{ kind: 'origin', text: 'Journal of Japanese Studies' }]);
  assert.deepEqual(origin({ site: 'example.com', from: 'The web' }), [{ kind: 'origin', text: 'example.com' }]);
  assert.deepEqual(origin({ from: 'Research papers' }), [{ kind: 'origin', text: 'Research papers' }]);
  assert.deepEqual(origin({ holder: '   ', venue: '', site: 7, from: ' The web ' }), [{ kind: 'origin', text: 'The web' }], 'a blank or a value that is not a string is passed over');
});

test('an item the user added shows no origin, whatever its data holds', () => {
  assert.deepEqual(chips(item({ from: 'The Met', holder: 'Rijksmuseum', venue: 'Nature', site: 'example.com' })), []);
  assert.deepEqual(chips({ title: 'No origin recorded', data: { from: 'The Met' } }), []);
  assert.deepEqual(chipSources(item({ when: '1857', from: 'The Met' })), [{ kind: 'when', label: 'When', text: '1857' }]);
});

test('a source the card type already shows is left out, and so is one that says the same', () => {
  assert.deepEqual(chips(brought({ site: 'example.com' }), ['site']), []);
  assert.deepEqual(chips(brought({ site: 'example.com', from: 'The web' }), ['site']), [], 'the site is the origin, so nothing vaguer stands in for it');
  assert.deepEqual(chips(brought({ date: '2019', site: 'example.com' }), ['site']), [{ kind: 'when', text: '2019' }]);
  assert.deepEqual(chips(brought({ site: 'example.com', holder: 'example.com' }), ['site']), [], 'an origin equal to the site shown is not repeated');
  assert.deepEqual(chips(brought({ site: 'example.com', holder: 'Rijksmuseum' }), ['site']), [{ kind: 'origin', text: 'Rijksmuseum' }]);
  assert.deepEqual(chips(brought(FIVE), ['when', 'where']), [
    { kind: 'origin', text: 'metmuseum.org' },
    { kind: 'people', text: 'Ada, Grace', count: 1 },
  ]);
});

test('a source that repeats an earlier one is left out', () => {
  assert.deepEqual(chips(brought({ site: 'example.com', by: 'example.com', from: 'The web' })), [{ kind: 'origin', text: 'example.com' }]);
  assert.deepEqual(chipSources(brought({ site: 'example.com', by: 'example.com' })), [{ kind: 'origin', label: 'Origin', text: 'example.com' }]);
  assert.deepEqual(chips(item({ when: 'Edo', where: 'Edo' })), [{ kind: 'when', text: 'Edo' }]);
});

test('the opened card is given every source in full', () => {
  assert.deepEqual(chipSources(brought({ ...FIVE, people: ['Ada', 'Grace', 'Edsger', 'Barbara', 'Alan'] })), [
    { kind: 'when', label: 'When', text: '12 May 1958' },
    { kind: 'origin', label: 'Origin', text: 'metmuseum.org' },
    { kind: 'where', label: 'Where', text: 'Bodega Bay' },
    { kind: 'people', label: 'People', text: 'Ada, Grace, Edsger, Barbara, Alan' },
  ]);
  assert.deepEqual(chipSources(item({})), []);
});

test('chips do not change the item or depend on anything else', () => {
  const given = brought(FIVE);
  const before = JSON.stringify(given);
  assert.deepEqual(chips(given), chips(given));
  assert.equal(JSON.stringify(given), before);
});
