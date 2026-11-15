import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { MetaModel } from '../src/node/model-meta.ts';

function api(): { fetch: typeof fetch; sent: { model: string; reasoning: { effort: string } }[] } {
  const sent: { model: string; reasoning: { effort: string } }[] = [];
  const reply = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"yes"}' }] }], usage: { total_tokens: 12 } };
  return {
    sent,
    fetch: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as typeof fetch,
  };
}

const ask = { role: 'test', system: 's', user: 'u', schema: z.object({ answer: z.string() }) };

test('a quick request goes to the quick model with the least reasoning, and any other to the main model', async () => {
  const wire = api();
  const model = new MetaModel({ apiKey: 'k', fetch: wire.fetch });
  assert.deepEqual(await model.json({ ...ask, quick: true }), { answer: 'yes' });
  await model.json({ ...ask, effort: 'medium' });
  assert.deepEqual(wire.sent.map((b) => [b.model, b.reasoning.effort]), [['muse-ember-1.0', 'minimal'], ['muse-spark-1.3', 'medium']]);

  const chosen = api();
  await new MetaModel({ apiKey: 'k', fetch: chosen.fetch, quickModel: 'muse-other' }).json({ ...ask, quick: true });
  assert.equal(chosen.sent[0]!.model, 'muse-other');
});

test('a quick request that goes unanswered is tried again after its own short wait, not the main model\'s two minutes', async () => {
  let asked = 0;
  const reply = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"yes"}' }] }], usage: { total_tokens: 12 } };
  const fetch = (async (_url: string, init: RequestInit) => {
    asked++;
    if (asked > 1) return new Response(JSON.stringify(reply), { status: 200 });
    return new Promise<Response>((_, fail) => init.signal!.addEventListener('abort', () => fail(init.signal!.reason)));
  }) as typeof globalThis.fetch;
  const started = Date.now();
  // The wait's own timer does not hold the process open, as the service's server does.
  const open = setInterval(() => {}, 1000);

  assert.deepEqual(await new MetaModel({ apiKey: 'k', fetch, quickWaitMs: 50 }).json({ ...ask, quick: true }), { answer: 'yes' });
  clearInterval(open);
  assert.equal(asked, 2);
  assert.ok(Date.now() - started < 5000);
});
