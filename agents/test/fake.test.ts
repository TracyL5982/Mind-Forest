import assert from 'node:assert/strict';
import { test } from 'node:test';
import { intake } from '../src/core/roles/intake.ts';
import { kit } from './kit.ts';

/** What the real Intake keeps of a pasted text when the fake clerk describes it. */
async function pasted(text: string) {
  const k = kit();
  k.model.describing();
  const [item] = await intake(k.ctx, [{ kind: 'text', text }]);
  return item!.data;
}

test('the fake clerk reads each kind of structure from its plain written form, and the real Intake keeps it', async () => {
  assert.deepEqual(await pasted('Moving to Rust\nWhere: Lisbon\nPeople: Ana Lima, Ben Okri\nPros:\n- no data races\n- one binary\nCons: slow builds, a steep start.'), {
    where: 'Lisbon',
    people: ['Ana Lima', 'Ben Okri'],
    pros: ['no data races', 'one binary'],
    cons: ['slow builds', 'a steep start'],
  });
  assert.deepEqual(await pasted('| Plan | Price |\n| --- | --- |\n| Solo | $8 |\n| Team | $20 |'), {
    table: { heads: ['Plan', 'Price'], rows: [['Solo', '$8'], ['Team', '$20']] },
  });
  assert.deepEqual(await pasted('Q: Why is the sky blue?\nA: Air scatters short wavelengths the most.\nTerm: Parallax\nDefinition: the apparent shift of an object when the viewer moves'), {
    question: 'Why is the sky blue?',
    answer: 'Air scatters short wavelengths the most.',
    term: 'Parallax',
    definition: 'the apparent shift of an object when the viewer moves',
  });
  assert.deepEqual(await pasted('Packing\n[x] passport\n[ ] charger'), { items: ['passport', 'charger'], checklist: [true, false] });
  assert.deepEqual(await pasted('Bring\n- tent\n- stove'), { items: ['tent', 'stove'] });
  assert.deepEqual(await pasted('Palette: Ember #E4572E, #17BEBB and #fff.'), {
    colours: [{ name: 'Ember', value: '#E4572E' }, { name: '#17BEBB', value: '#17BEBB' }, { name: '#fff', value: '#fff' }],
  });
  assert.deepEqual(await pasted('The house remembers.\n> Every stair keeps the weight of who climbed it.\nAt: Chapter 3'), {
    excerpt: { text: 'Every stair keeps the weight of who climbed it.', at: 'Chapter 3' },
  });
});

test('a plain sentence gets no structure from the fake clerk, and a place it invents is dropped', async () => {
  assert.deepEqual(await pasted('The dolly zoom makes dread out of geometry'), {});
  assert.deepEqual(await pasted('A walk by the river. fake:invent'), {});
});

test('the fake clerk answers for a link and a photo with a full reply', async () => {
  const k = kit();
  k.model.describing();
  const url = 'https://example.com/trip';
  k.world.pages.set(url, { url, title: 'Trip notes', text: 'Three days away.\nWhere: Porto', site: 'example.com' });
  const { id } = await k.assets.put(new Uint8Array([1]), 'image/jpeg', 'beach.jpg');

  const [link, photo] = await intake(k.ctx, [{ kind: 'link', url }, { kind: 'asset', asset: id, mime: 'image/jpeg', name: 'beach.jpg' }]);

  assert.deepEqual(link!.data, { where: 'Porto', site: 'example.com' });
  assert.equal(photo!.title, 'beach.jpg');
  assert.equal(k.notes.length, 0, 'no reply was refused by its schema');
});
