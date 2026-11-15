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
