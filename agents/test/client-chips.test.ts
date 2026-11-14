import assert from 'node:assert/strict';
import { test } from 'node:test';

type Chip = { kind: string; text: string; keep?: string };
type Source = Chip & { label: string };
type Chips = {
  chips: (item: unknown, node: unknown, shown?: string[]) => Chip[];
  chipSources: (item: unknown, node: unknown) => Source[];
};

const { chips, chipSources }: Chips = await import(new URL('../client/js/chips.js', import.meta.url).href);

const kept = { status: 'kept' };
const pick = { status: 'pick' };
const item = (data: Record<string, unknown>) => ({ title: 'A card', data });

const FIVE = { when: '12 May 1958', where: 'Bodega Bay', people: ['Ada', 'Grace', 'Edsger'], from: 'The Met', site: 'metmuseum.org' };

test('an item with no chip source gives no chips', () => {
  assert.deepEqual(chips(item({}), kept), []);
  assert.deepEqual(chips({ title: 'No data at all' }, kept), []);
  assert.deepEqual(chips(item({ when: '  ', where: 7, people: 'Ada', from: null }), pick), []);
  assert.deepEqual(chips(item({ people: [] }), kept), []);
});

test('chips come in the order when, where, people, origin', () => {
  assert.deepEqual(chips(item({ from: 'The Met', people: ['Ada'], where: 'Bodega Bay' }), pick), [
    { kind: 'where', text: 'Bodega Bay' },
    { kind: 'people', text: 'Ada' },
    { kind: 'origin', text: 'The Met' },
  ]);
});

test('five sources give three chips', () => {
  assert.deepEqual(chips(item(FIVE), pick), [
    { kind: 'when', text: '12 May 1958' },
    { kind: 'where', text: 'Bodega Bay' },
    { kind: 'people', text: 'Ada, Grace +1', keep: ' +1' },
  ]);
});

test('five people give two names and a count', () => {
  assert.deepEqual(chips(item({ people: ['Ada', 'Grace', 'Edsger', 'Barbara', 'Alan'] }), kept), [{ kind: 'people', text: 'Ada, Grace +3', keep: ' +3' }]);
  assert.deepEqual(chips(item({ people: ['Ada', 'Grace'] }), kept), [{ kind: 'people', text: 'Ada, Grace' }]);
  assert.deepEqual(chips(item({ people: ['Ada', '', 3, ' Grace '] }), kept), [{ kind: 'people', text: 'Ada, Grace' }]);
});

test('only a pick shows where it came from, and the origin is the first of from, holder and site', () => {
  assert.deepEqual(chips(item({ from: 'The Met' }), kept), []);
  assert.deepEqual(chips(item({ from: 'The Met', holder: 'Rijksmuseum', site: 'example.com' }), pick), [{ kind: 'origin', text: 'The Met' }]);
  assert.deepEqual(chips(item({ holder: 'Rijksmuseum', site: 'example.com' }), pick), [{ kind: 'origin', text: 'Rijksmuseum' }]);
  assert.deepEqual(chips(item({ site: 'example.com' }), pick), [{ kind: 'origin', text: 'example.com' }]);
});

test('a source the card type already shows is left out', () => {
  assert.deepEqual(chips(item({ site: 'example.com' }), pick, ['site']), []);
  assert.deepEqual(chips(item({ when: '1958', site: 'example.com' }), pick, ['site']), [{ kind: 'when', text: '1958' }]);
  assert.deepEqual(chips(item(FIVE), pick, ['when', 'where']), [
    { kind: 'people', text: 'Ada, Grace +1', keep: ' +1' },
    { kind: 'origin', text: 'The Met' },
  ]);
});

test('the opened card is given every source in full', () => {
  assert.deepEqual(chipSources(item({ ...FIVE, people: ['Ada', 'Grace', 'Edsger', 'Barbara', 'Alan'] }), pick), [
    { kind: 'when', label: 'When', text: '12 May 1958' },
    { kind: 'where', label: 'Where', text: 'Bodega Bay' },
    { kind: 'people', label: 'People', text: 'Ada, Grace, Edsger, Barbara, Alan' },
    { kind: 'origin', label: 'Origin', text: 'The Met' },
  ]);
  assert.deepEqual(chipSources(item({}), kept), []);
});

test('chips do not change the item or depend on anything else', () => {
  const given = item(FIVE);
  const before = JSON.stringify(given);
  assert.deepEqual(chips(given, pick), chips(given, pick));
  assert.equal(JSON.stringify(given), before);
});
