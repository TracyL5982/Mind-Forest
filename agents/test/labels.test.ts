import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LABEL_WORDS, wordCount } from '../src/core/brief.ts';
import type { Id } from '../src/core/domain.ts';
import { Pipeline, type Activity, type Outbound } from '../src/core/pipeline.ts';
import { roles } from '../src/core/roles/index.ts';
import { kit } from './kit.ts';

const PAPERS = { id: 'papers', name: 'Research papers', goodFor: 'What studies found.', query: 'Title words.', show: 1 };
const WEB = { id: 'web', name: 'The web', goodFor: 'Anything current.', query: 'A web search.', show: 1 };
const direction = (format: string, title: string, more: Record<string, unknown> = {}) => ({ angle: title, format, title, body: 'Something new.', why: 'new', tags: [], lines: [], pros: [], cons: [], subject: '', passage: '', by: '', controls: [], images: [], source: '', lookups: [], ...more });

/** Every role the service runs, over a scripted model, with what each tells the clients kept in order. */
function service() {
  const k = kit({ picksPerRun: 4 });
  k.model.describing();
  k.world.sources = [WEB, PAPERS];
  k.world.found.set('papers:dolly zoom unease', [{ title: 'Vertigo and the dolly zoom', by: 'A. Researcher', date: '2011', text: 'We measured viewer discomfort.', url: 'https://doi.example/10.1/zoom', kind: 'paper' }]);
  k.world.web = [{ title: 'Jaws beach scene', url: 'https://www.youtube.com/watch?v=abcdefghijk', snippet: '' }];
  k.world.videos.set('https://www.youtube.com/watch?v=abcdefghijk', { title: 'Jaws beach scene', url: 'https://www.youtube.com/watch?v=abcdefghijk', embed: 'https://www.youtube.com/embed/abcdefghijk' });
  k.model
    .on('scout.ideate', () => ({
      reading: 'A film technique the user is studying, and the long passage that explains why it unsettles so many viewers.',
      directions: [
        direction('note', 'The house at the bend'),
        direction('find', 'What the studies measured about the dolly zoom and unease in viewers', { source: 'papers', lookups: ['dolly zoom unease'] }),
        direction('image', 'The same staircase at night', { images: [{ title: 'Night stairs seen from far above the landing', prompt: 'the staircase at night' }] }),
        direction('video', 'Watch the Jaws beach shot', { lookups: ['Jaws beach dolly zoom shot from the 1975 film'] }),
      ],
    }))
    .on('scout.rate', (req) => ({ ratings: [...req.user.matchAll(/item (\S+) "/g)].map(([, itemId]) => ({ itemId, strength: 0.2, why: 'shares a word' })) }))
    .on('scout.curate', () => ({ chosen: [{ number: 1, note: '', excerpt: '' }] }))
    .on('renderer.components', () => ({ items: [] }))
    .on('renderer.composites', () => ({ groups: [] }))
    .on('filer', () => ({ placements: [] }))
    .on('organizer', () => {
      throw new Error('model down');
    })
    .on('packager', () => ({ brief: 'A study of the dolly zoom.', nextPrompt: 'Write a shot list.', openQuestions: ['Which lens?'] }));
  const heard: Outbound[] = [];
  const pipeline = new Pipeline({
    mind: k.mind,
    roles,
    model: k.model,
    tools: k.ctx.tools,
    assets: k.assets,
    store: { append() {}, all: () => [] },
    settings: k.ctx.settings,
    newId: k.ctx.newId,
    now: k.ctx.now,
    emit: (m) => heard.push(m),
    settleMs: 5,
    playback: () => k.playback,
  });
  return { k, pipeline, heard };
}

test('every step of every role is labelled in a few words, starts and ends, and a Scout run shows each kind of step on its card', async () => {
  const { k, pipeline, heard } = service();
  await pipeline.dump([{ kind: 'text', text: 'The dolly zoom in horror films' }]);
  pipeline.utter('make a tree about why the dolly zoom in horror films makes people feel uneasy', { selection: [] }, true);
  await pipeline.idle();
  const [tree] = [...k.mind.trees.values()];
  const root: Id = tree!.rootId;
  k.model.on('conductor', () => ({ kind: 'ask', anchorId: root, need: 'why it feels like dread', nodeId: '', treeId: '', request: '', scopeNodeIds: [], scopeTreeIds: [], note: '', text: '', keepNodeIds: [], say: 'Looking into it.' }));
  pipeline.utter('why does this feel like dread', { focus: root, selection: [] }, true);
  await pipeline.idle();
  await pipeline.organize('put the pictures together', { treeIds: [tree!.id], nodeIds: [] });
  await pipeline.handoff({ treeIds: [tree!.id], nodeIds: [] });
  await pipeline.idle();

  const activities = heard.flatMap((m) => (m.t === 'activity' ? [m.activity] : []));
  const labels = [...new Set(activities.map((a) => `${a.role}: ${a.label}`))];
  for (const a of activities) {
    assert.ok(wordCount(a.label) >= 2 && wordCount(a.label) <= LABEL_WORDS, `"${a.label}" (${a.role}) is ${wordCount(a.label)} words`);
    assert.ok(a.label.length <= 60 && !a.label.includes('\n'), `"${a.label}" fits a line`);
    if (a.state !== 'error') assert.equal(a.message, a.label, 'older clients read the label as the message');
  }
  const ended = (a: Activity) => activities.some((b) => b.id === a.id && b.state !== 'start');
  assert.deepEqual(activities.filter((a) => a.state === 'start' && !ended(a)).map((a) => a.label), [], 'every step that starts ends');
  for (const role of ['conductor', 'intake', 'filer', 'scout', 'renderer', 'organizer', 'packager']) assert.ok(activities.some((a) => a.role === role), `${role} shows what it does`);
  const scoutSteps = activities.filter((a) => a.role === 'scout' && a.state === 'start' && a.nodeId === root).map((a) => a.label);
  for (const step of [/^Thinking of directions for /, /^Checking what you already have$/, /^Searching research papers for dolly zoom/, /^Reading 1 result from research papers$/, /^Making a picture of Night stairs/, /^Looking for a video of Jaws/]) {
    assert.ok(scoutSteps.some((l) => step.test(l)), `a Scout run on the card shows ${step}: ${JSON.stringify(scoutSteps)}`);
  }
  assert.ok(labels.length > 10, JSON.stringify(labels));
});

test('the reply to what was said and the line on what a run brought are told apart', async () => {
  const { pipeline, heard } = service();
  pipeline.utter('make a tree about the dolly zoom', { selection: [] }, true);
  await pipeline.idle();

  const says = heard.flatMap((m) => (m.t === 'say' ? [[m.kind, m.text]] : []));
  assert.equal(says[0]![0], 'reply');
  assert.equal(says.at(-1)![0], 'results');
  assert.match(says.at(-1)![1]!, /new things? under/);
});
