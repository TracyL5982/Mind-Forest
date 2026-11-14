import assert from 'node:assert/strict';
import { test } from 'node:test';

type Chip = { kind: string; text: string; keep?: string };
type Source = Chip & { label: string };
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
  assert.deepEqual(chips(brought({ when: '  ', where: 7, people: 'Ada', from: null })), []);
  assert.deepEqual(chips(item({ people: [] })), []);
});

test('chips come in the order when, where, people, origin', () => {
  assert.deepEqual(chips(brought({ from: 'The Met', people: ['Ada'], where: 'Bodega Bay' })), [
    { kind: 'where', text: 'Bodega Bay' },
    { kind: 'people', text: 'Ada' },
    { kind: 'origin', text: 'The Met' },
  ]);
});

test('five sources give three chips', () => {
  assert.deepEqual(chips(brought(FIVE)), [
    { kind: 'when', text: '12 May 1958' },
    { kind: 'where', text: 'Bodega Bay' },
    { kind: 'people', text: 'Ada, Grace +1', keep: ' +1' },
  ]);
});

test('five people give two names and a count', () => {
  assert.deepEqual(chips(item({ people: ['Ada', 'Grace', 'Edsger', 'Barbara', 'Alan'] })), [{ kind: 'people', text: 'Ada, Grace +3', keep: ' +3' }]);
  assert.deepEqual(chips(item({ people: ['Ada', 'Grace'] })), [{ kind: 'people', text: 'Ada, Grace' }]);
  assert.deepEqual(chips(item({ people: ['Ada', '', 3, ' Grace '] })), [{ kind: 'people', text: 'Ada, Grace' }]);
});

test('an item the agents brought shows where it came from, and the origin is the first of from, holder and site', () => {
  assert.deepEqual(chips(brought({ from: 'The Met', holder: 'Rijksmuseum', site: 'example.com' })), [{ kind: 'origin', text: 'The Met' }]);
  assert.deepEqual(chips(brought({ holder: 'Rijksmuseum', site: 'example.com' })), [{ kind: 'origin', text: 'Rijksmuseum' }]);
  assert.deepEqual(chips(brought({ site: 'example.com' })), [{ kind: 'origin', text: 'example.com' }]);
});

test('an item the user added shows no origin, whatever its data holds', () => {
  assert.deepEqual(chips(item({ from: 'The Met', holder: 'Rijksmuseum', site: 'example.com' })), []);
  assert.deepEqual(chips({ title: 'No origin recorded', data: { from: 'The Met' } }), []);
  assert.deepEqual(chipSources(item({ when: '1857', from: 'The Met' })), [{ kind: 'when', label: 'When', text: '1857' }]);
});

test('a source the card type already shows is left out', () => {
  assert.deepEqual(chips(brought({ site: 'example.com' }), ['site']), []);
  assert.deepEqual(chips(brought({ when: '1958', site: 'example.com' }), ['site']), [{ kind: 'when', text: '1958' }]);
  assert.deepEqual(chips(brought(FIVE), ['when', 'where']), [
    { kind: 'people', text: 'Ada, Grace +1', keep: ' +1' },
    { kind: 'origin', text: 'The Met' },
  ]);
});

test('the opened card is given every source in full', () => {
  assert.deepEqual(chipSources(brought({ ...FIVE, people: ['Ada', 'Grace', 'Edsger', 'Barbara', 'Alan'] })), [
    { kind: 'when', label: 'When', text: '12 May 1958' },
    { kind: 'where', label: 'Where', text: 'Bodega Bay' },
    { kind: 'people', label: 'People', text: 'Ada, Grace, Edsger, Barbara, Alan' },
    { kind: 'origin', label: 'Origin', text: 'The Met' },
  ]);
  assert.deepEqual(chipSources(item({})), []);
});

test('chips do not change the item or depend on anything else', () => {
  const given = brought(FIVE);
  const before = JSON.stringify(given);
  assert.deepEqual(chips(given), chips(given));
  assert.equal(JSON.stringify(given), before);
});
