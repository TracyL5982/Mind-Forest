import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchTrees, plainAsk, treeLines } from '../src/node/tree-asks.ts';
import { kit } from './kit.ts';

test('plain words that ask for the trees, a handoff by name, a find or the latest handoff are read with no model', () => {
  for (const text of ['list my trees', 'What trees do I have?', 'show me my trees please', '/trees', 'my trees', 'Which trees do I have']) {
    assert.deepEqual(plainAsk(text), { kind: 'list' }, text);
  }
  for (const text of ['/handoff', 'Send me the handoff', 'please resend me the latest handoff again']) {
    assert.deepEqual(plainAsk(text), { kind: 'latest' }, text);
  }
  const handoffs: [string, string][] = [
    ['hand off the solar tree', 'solar'],
    ['Handoff my Solar panels tree, please', 'Solar panels'],
    ['send me the handoff for solar panels at home', 'solar panels at home'],
    ['/handoff “Kubrick”', 'Kubrick'],
    ['Can you hand off the tree about lenses?', 'lenses'],
    ['give me a handoff of the film tree.', 'film'],
  ];
  for (const [text, words] of handoffs) assert.deepEqual(plainAsk(text), { kind: 'handoff', words }, text);
  const finds: [string, string][] = [
    ['find the tree about heat pumps', 'heat pumps'],
    ['/find lenses', 'lenses'],
    ['which tree mentions Vertigo?', 'Vertigo'],
    ['do I have a tree about bread', 'bread'],
  ];
  for (const [text, words] of finds) assert.deepEqual(plainAsk(text), { kind: 'find', words }, text);
});

test('a thought, a link and a request for a new tree ask nothing by the rules', () => {
  for (const text of ['Solar panels pay back in nine years', 'https://example.com/trees', 'make a tree about Kubrick', 'Build a treehouse', '3']) {
    assert.equal(plainAsk(text), null, text);
  }
});

test('trees are listed newest first, each with its cards counted and what it is about', () => {
  const k = kit();
  k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  k.seedTree('Solar panels at home', ['Payback', 'Inverters', 'Roof angle']);
  assert.deepEqual(
    treeLines(k.mind).map((t) => [t.title, t.line]),
    [
      ['Solar panels at home', '3 cards. Solar panels at home'],
      ['Film', '2 cards. Film'],
    ],
  );
});

test('a full name, or the one name holding every word, is matched with no model call; names that tie are all returned', async () => {
  const k = kit();
  k.seedTree('Film', ['Camera moves']);
  k.seedTree('Solar panels at home', ['Payback']);
  k.seedTree('Solar system', ['Jupiter']);
  const titles = async (words: string) => (await matchTrees(k.mind, k.model, words)).map((t) => t.title);

  assert.deepEqual(await titles('film'), ['Film']);
  assert.deepEqual(await titles('The Solar System tree'), ['Solar system']);
  assert.deepEqual(await titles('panels'), ['Solar panels at home']);
  assert.deepEqual(await titles('solar'), ['Solar system', 'Solar panels at home'], 'both hold the word, so the person chooses');
  assert.deepEqual(k.model.calls, [], 'no model was asked');
});

test('words no name holds go to the model with each tree and its cards, and its numbers come back as trees', async () => {
  const k = kit();
  k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  k.seedTree('Home energy', ['Heat pumps', 'Inverters']);
  let asked = '';
  k.model.on('contact.match', (req) => {
    asked = req.user;
    return { matches: [Number(/^(\d+)\. Home energy/m.exec(req.user)![1]), 99] };
  });
  assert.deepEqual((await matchTrees(k.mind, k.model, 'the one about heat pumps')).map((t) => t.title), ['Home energy']);
  assert.match(asked, /^Words: "heat pumps"/);
  assert.match(asked, /\d\. Home energy \(2 cards\. Home energy\) Cards: Heat pumps; Inverters/);

  k.model.on('contact.match', () => ({ matches: [] }));
  assert.deepEqual(await matchTrees(k.mind, k.model, 'gardening'), []);
});

test('when the model does not answer, the trees whose cards hold the words are returned', async () => {
  const k = kit();
  k.seedTree('Film', ['Camera moves', 'Dolly zoom']);
  k.seedTree('Home energy', ['Heat pumps', 'Inverters']);
  k.model.on('contact.match', () => {
    throw new Error('no answer');
  });
  assert.deepEqual((await matchTrees(k.mind, k.model, 'heat pumps')).map((t) => t.title), ['Home energy']);
  assert.deepEqual(await matchTrees(k.mind, k.model, 'gardening'), []);
});
