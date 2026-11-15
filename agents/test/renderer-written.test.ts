import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Item } from '../src/core/domain.ts';
import { byRule } from '../src/core/roles/renderer.ts';
import { AGENT, kit } from './kit.ts';

const k = kit();
const written = (text: string, data: Item['data']): Item => ({ ...k.item({ title: 'A written idea', text, data }), origin: AGENT('scout', 'idea') });
const drawn = (item: Item) => byRule(item, (id) => k.assets.url(id));
const slider = { kind: 'slider' as const, label: 'Fuse length', states: [], texts: [], name: 'length', unit: 'cm', min: 0, max: 40, values: [10, 20, 30] };
const FUSE = 'Fuse length 10 cm: Seconds 5 s\nFuse length 20 cm: Seconds 10 s\nFuse length 30 cm: Seconds 15 s';

test('a callout written out with its item is drawn as one, with the lines over it', () => {
  const item = written('On set in 1982.\nA naked flame near a petrol can burns the crew.', { callout: { text: 'A naked flame near a petrol can burns the crew.', tone: 'caution' } });

  assert.deepEqual(drawn(item), { component: 'callout', props: { text: 'A naked flame near a petrol can burns the crew.', tone: 'caution', above: ['On set in 1982.'] } });
});

test('a callout whose words are not the whole item is no callout', () => {
  const item = written('A naked flame near a petrol can burns the crew. Keep water by the set.', { callout: { text: 'A naked flame near a petrol can burns the crew.', tone: 'caution' } });

  assert.equal(drawn(item).component, 'note');
});

test('an explorable written out with its item is drawn as the look call would build it, when its formula gives every result', () => {
  const item = written(FUSE, { explorable: { controls: [slider], formula: 'length / 2', subject: 'Seconds', unit: 's', numbers: [5, 10, 15] } });

  assert.deepEqual(drawn(item), {
    component: 'explorable',
    props: {
      controls: [{ kind: 'slider', name: 'length', label: 'Fuse length', unit: 'cm', min: 0, max: 40, step: 1, values: [10, 20, 30] }],
      output: { kind: 'chart', label: 'Seconds', unit: 's', formula: ['length', 2, '/'], values: [5, 10, 15] },
    },
  });
});

test('an explorable whose formula misses a result its item states, or cannot be read, is no explorable', () => {
  const wrong = written(FUSE, { explorable: { controls: [slider], formula: 'length * 2', subject: 'Seconds', unit: 's', numbers: [5, 10, 15] } });
  const unread = written(FUSE, { explorable: { controls: [slider], formula: 'length // 2', subject: 'Seconds', unit: 's', numbers: [5, 10, 15] } });

  assert.notEqual(drawn(wrong).component, 'explorable');
  assert.notEqual(drawn(unread).component, 'explorable');
});
