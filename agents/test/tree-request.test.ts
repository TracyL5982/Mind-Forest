import assert from 'node:assert/strict';
import { test } from 'node:test';
import { treeRequest } from '../src/core/tree-request.ts';

test('a request for a tree is heard at the start or the end of what was dropped, and the rest is kept as it was written', () => {
  const cases: [string, { subject: string; rest: string }][] = [
    ['make a tree about dolly zoom', { subject: 'dolly zoom', rest: '' }],
    ['Can you make me a new tree about Dr. Strangelove?', { subject: 'Dr. Strangelove', rest: '' }],
    ["let's start a tree on Kubrick's machines", { subject: "Kubrick's machines", rest: '' }],
    ['make a tree', { subject: '', rest: '' }],
    ['Start a tree on this: The dolly zoom makes dread', { subject: '', rest: 'The dolly zoom makes dread' }],
    ['Start a tree on this:\nTokyo Tower\nHeight = 333 m', { subject: '', rest: 'Tokyo Tower\nHeight = 333 m' }],
    ['make this a tree: lenses that bend space', { subject: '', rest: 'lenses that bend space' }],
    ['Make a tree about Kubrick - his machines', { subject: 'Kubrick', rest: 'his machines' }],
    ['The dolly zoom makes dread. Start a tree on this.', { subject: '', rest: 'The dolly zoom makes dread.' }],
    ['https://example.com/x turn this into a tree', { subject: '', rest: 'https://example.com/x' }],
  ];
  for (const [text, asked] of cases) assert.deepEqual(treeRequest(text), asked, text);
});

test('a text that only mentions a tree asks for none', () => {
  for (const text of ['Build a treehouse', 'Make a family tree for my grandparents', 'Open a tree nursery downtown', 'Remember to water the fig tree on Sunday morning', 'Plant a tree for every newborn', 'How do I start a tree from a cutting? It never roots.']) {
    assert.equal(treeRequest(text), null, text);
  }
});
