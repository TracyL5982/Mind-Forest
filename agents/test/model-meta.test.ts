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

test('a quick request goes to the quick model with the least reasoning unless it asks for more, and any other to the main model', async () => {
  const wire = api();
  const model = new MetaModel({ apiKey: 'k', fetch: wire.fetch });
  assert.deepEqual(await model.json({ ...ask, quick: true }), { answer: 'yes' });
  await model.json({ ...ask, effort: 'medium' });
  await model.json({ ...ask, quick: true, effort: 'low' });
  assert.deepEqual(wire.sent.map((b) => [b.model, b.reasoning.effort]), [['muse-ember-1.0', 'minimal'], ['muse-spark-1.3', 'medium'], ['muse-ember-1.0', 'low']]);

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

/** A reply as the Responses API streams it: server-sent events, the text in pieces, split across reads wherever the network splits it. */
function streamed(pieces: string[], cutEvery = 7): Response {
  const events = [
    { type: 'response.created' },
    { type: 'response.output_item.added', item: { type: 'message' } },
    ...pieces.map((delta) => ({ type: 'response.output_text.delta', delta })),
    { type: 'response.completed', response: { usage: { total_tokens: 30 } } },
  ];
  const wire = events.map((e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join('');
  const bytes = new TextEncoder().encode(wire);
  return new Response(new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += cutEvery) c.enqueue(bytes.slice(i, i + cutEvery));
      c.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

test('a request that reads its reply as it is written is streamed, and handed the text so far after each piece', async () => {
  const sent: { stream?: boolean }[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return streamed(['{"answer":', '"ye', 's"}']);
  }) as typeof globalThis.fetch;
  const seen: string[] = [];

  const reply = await new MetaModel({ apiKey: 'k', fetch }).json({ ...ask, onText: (soFar) => seen.push(soFar) });

  assert.deepEqual(reply, { answer: 'yes' });
  assert.deepEqual(seen, ['{"answer":', '{"answer":"ye', '{"answer":"yes"}']);
  assert.equal(sent[0]!.stream, true);
});

test('a streamed reply that breaks after some text was handed on is not asked again', async () => {
  let asked = 0;
  const fetch = (async () => {
    asked++;
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '{"ans' })}\n\n`);
    let reads = 0;
    return new Response(new ReadableStream({ pull(c) { if (reads++ === 0) c.enqueue(bytes); else c.error(new Error('connection cut')); } }), { status: 200 });
  }) as typeof globalThis.fetch;

  await assert.rejects(new MetaModel({ apiKey: 'k', fetch }).json({ ...ask, onText: () => {} }), /connection cut/);
  assert.equal(asked, 1);
});
