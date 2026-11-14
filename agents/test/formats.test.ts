import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Item } from '../src/core/domain.ts';
import { byRule, grounded, unsure } from '../src/core/roles/renderer.ts';
import { COMPONENT_IDS, isValidView } from '../src/core/views.ts';
import { FakeModel } from '../src/fake/model.ts';
import { ACTIVITIES, agrees, assetUrl, run, samples } from './formats.ts';

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

/**
 * How many samples of each activity the rules alone draw as a person would. A change to a rule that lowers one of these
 * made format choice worse: fix the rule, or change a sample's key only where a person would agree and say so in docs/formats.md.
 */
const RULES_AGREE = { research: 42, brainstorming: 41, memories: 45 };

test('the rules alone agree with a person on at least as many samples of each activity as they did', () => {
  for (const activity of ACTIVITIES) {
    const of = SAMPLES.filter((sample) => sample.activity === activity);
    const missed = of.filter((sample) => !agrees(sample, byRule(sample.item, assetUrl).component)).map((sample) => `${sample.key} ${sample.expect} drawn as ${byRule(sample.item, assetUrl).component}`);
    assert.ok(of.length - missed.length >= RULES_AGREE[activity], `${activity}: ${of.length - missed.length} of ${of.length}, was ${RULES_AGREE[activity]}. Missed: ${missed.join('; ')}`);
  }
});

test('what the rules draw for every sample is a card the library accepts and the item states', () => {
  for (const sample of SAMPLES) {
    const draw = byRule(sample.item, assetUrl);
    assert.ok(isValidView(draw), `${sample.key} is a valid ${draw.component}`);
    assert.ok(grounded(draw, sample.item, assetUrl), `${sample.key} stands in its item`);
  }
});

test('the samples the model is asked about are text the rules left as a note, and there are enough of them to measure it', () => {
  const open = SAMPLES.filter((sample) => unsure(sample.item, byRule(sample.item, assetUrl)));
  assert.ok(open.length >= 50, `${open.length} samples go to the model`);
  for (const sample of open) assert.ok(sample.item.kind === 'text' && byRule(sample.item, assetUrl).component === 'note', sample.key);
  assert.deepEqual([...new Set(SAMPLES.map((sample) => sample.item.kind))].sort(), ['chat', 'image', 'link', 'text', 'video']);
});

test('the whole set runs through the real Renderer with the fake model, which changes no card the rules were sure of', async () => {
  const model = new FakeModel().choosing();
  const { outcomes } = await run(model);
  assert.equal(outcomes.length, SAMPLES.length);
  const asked = outcomes.filter((outcome) => outcome.asked);
  assert.equal(model.calls.length, Math.ceil(asked.length / 24), 'one call for each 24 unsure items');
  assert.deepEqual(asked.filter((outcome) => !outcome.reply).map((outcome) => outcome.sample.key), [], 'the fake answers for every item it is asked about');
  for (const outcome of outcomes) if (!outcome.asked) assert.equal(outcome.drawn, outcome.ruled, outcome.sample.key);
});
