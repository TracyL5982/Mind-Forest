import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Item } from '../src/core/domain.ts';
import { byRule, grounded, unsure } from '../src/core/roles/renderer.ts';
import { COMPONENT_IDS, isValidView } from '../src/core/views.ts';
import { FakeModel } from '../src/fake/model.ts';
import { ACTIVITIES, agrees, assetUrl, ORIGINS, run, samples } from './formats.ts';

const SAMPLES = samples();

test('the sample set is whole: built items, a known card expected of each, and all three activities in both languages', () => {
  assert.ok(SAMPLES.length >= 150);
  assert.equal(new Set(SAMPLES.map((sample) => sample.key)).size, SAMPLES.length, 'every key is its own');
  assert.equal(new Set(SAMPLES.map((sample) => sample.item.id)).size, SAMPLES.length, 'every item is its own');
  for (const sample of SAMPLES) {
    assert.ok(Item.safeParse(sample.item).success, `${sample.key} is an item`);
    for (const component of [sample.expect, ...sample.accept]) assert.ok(COMPONENT_IDS.includes(component), `${sample.key} expects ${component}`);
    assert.ok(!sample.accept.includes(sample.expect), `${sample.key} accepts what it expects`);
  }
  for (const activity of ACTIVITIES) for (const language of ['en', 'zh']) assert.ok(SAMPLES.filter((sample) => sample.activity === activity && sample.language === language).length >= 10, `${activity} in ${language}`);
});

test('every sample says who wrote it: the 120 two independent reviewers wrote, and those the authors wrote for the cards the model draws', () => {
  for (const sample of SAMPLES) assert.equal(sample.origin, /^[AB]-/.test(sample.key) ? 'reviewers' : 'authors', sample.key);
  assert.deepEqual(ORIGINS.map((origin) => SAMPLES.filter((sample) => sample.origin === origin).length), [120, 53]);
});

/**
 * How many samples of each group and activity the rules alone draw as a person would. The two groups are held apart, because the
 * authors' samples are the kinds of content no rule can draw, and a gain there says nothing of the reviewers' set. A change to a rule
 * that lowers one of these made format choice worse: fix the rule, or change a sample's key only where a person would agree and say so
 * in docs/formats.md.
 */
const RULES_AGREE = { reviewers: { research: 39, brainstorming: 37, memories: 40 }, authors: { research: 5, brainstorming: 7, memories: 9 } };

test('the rules alone agree with a person on at least as many samples of each group and activity as they did', () => {
  for (const origin of ORIGINS) {
    for (const activity of ACTIVITIES) {
      const of = SAMPLES.filter((sample) => sample.origin === origin && sample.activity === activity);
      const missed = of.filter((sample) => !agrees(sample, byRule(sample.item, assetUrl).component)).map((sample) => `${sample.key} ${sample.expect} drawn as ${byRule(sample.item, assetUrl).component}`);
      const was = RULES_AGREE[origin][activity];
      assert.ok(of.length - missed.length >= was, `${origin}, ${activity}: ${of.length - missed.length} of ${of.length}, was ${was}. Missed: ${missed.join('; ')}`);
    }
  }
});

test('what the rules draw for every sample is a card the library accepts and the item states', () => {
  for (const sample of SAMPLES) {
    const draw = byRule(sample.item, assetUrl);
    assert.ok(isValidView(draw), `${sample.key} is a valid ${draw.component}`);
    assert.ok(grounded(draw, sample.item, assetUrl), `${sample.key} stands in its item`);
  }
});

test('the samples the model is asked about are text the rules left as a note or an idea, and there are enough of them to measure it', () => {
  const open = SAMPLES.filter((sample) => unsure(sample.item, byRule(sample.item, assetUrl)));
  assert.ok(open.length >= 65, `${open.length} samples go to the model`);
  for (const sample of open) assert.ok(sample.item.kind === 'text' && ['note', 'idea'].includes(byRule(sample.item, assetUrl).component), sample.key);
  const short = open.filter((sample) => sample.language === 'zh' && [...sample.item.text].length < 40);
  assert.ok(short.length >= 10, `${short.length} of them are Chinese texts of under 40 characters, which say as much as an English text of 40 or more`);
  assert.deepEqual([...new Set(SAMPLES.map((sample) => sample.item.kind))].sort(), ['chat', 'image', 'link', 'text', 'video']);
});

test('the whole set runs through the real Renderer with the fake model, which changes no card the rules were sure of', async () => {
  const model = new FakeModel().choosing();
  const { outcomes } = await run(model);
  assert.equal(outcomes.length, SAMPLES.length);
  const asked = outcomes.filter((outcome) => outcome.asked);
  assert.equal(model.calls.length, Math.ceil(asked.length / 8), 'one call for each 8 unsure items');
  assert.deepEqual(asked.filter((outcome) => !outcome.reply).map((outcome) => outcome.sample.key), [], 'the fake answers for every item it is asked about');
  for (const outcome of outcomes) if (!outcome.asked) assert.equal(outcome.drawn, outcome.ruled, outcome.sample.key);
  for (const outcome of asked) if (outcome.ruled === 'idea') assert.equal(outcome.drawn, 'idea', `${outcome.sample.key}: the fake keeps an idea`);
});
