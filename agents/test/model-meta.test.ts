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

test('the run log is told which model and effort answered each request and how many tries it took', async () => {
  const reply = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"yes"}' }] }], usage: { total_tokens: 12 } };
  let asked = 0;
  const fetch = (async (_url: string, init: RequestInit) => {
    asked++;
    if (JSON.parse(String(init.body)).stream) return streamed(['{"answer":"yes"}']);
    return asked === 1 ? new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429 }) : new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof globalThis.fetch;
  const calls: { model?: string; effort?: string; tries?: number; ok: boolean }[] = [];
  const model = new MetaModel({ apiKey: 'k', fetch, rateWindowMs: 50, onCall: ({ model, effort, tries, ok }) => calls.push({ model, effort, tries, ok }) });

  await model.json({ ...ask, quick: true });
  await model.json({ ...ask, onText: () => {} });

  assert.deepEqual(calls, [
    { model: 'muse-ember-1.0', effort: 'minimal', tries: 2, ok: true },
    { model: 'muse-spark-1.3', effort: 'low', tries: 1, ok: true },
  ]);
});

/** A reply as the Responses API streams it: server-sent events, the text in pieces, split across reads wherever the network splits it. */
function streamed(pieces: string[], cutEvery = 7, headers: Record<string, string> = {}): Response {
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
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream', ...headers } });
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

/**
 * An API that keeps a rate limit as the real one does: so many requests in any window, each counted, refused or not, until a window
 * after its answer ended, every answer saying how many are left, and a refusal that says none are and to retry after a minute.
 * `others` are requests another program on the key has just made.
 */
function limitedApi(limit: number, windowMs: number, others = 0, answerMs = 20) {
  const counted = Array.from({ length: others }, () => ({ until: Date.now() + windowMs }));
  const seen: { role: string; at: number; status: number }[] = [];
  let open = 0;
  let most = 0;
  const reply = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"yes"}' }] }], usage: { total_tokens: 12 } };
  const fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { stream?: boolean; text: { format: { name: string } } };
    const at = Date.now();
    counted.splice(0, counted.length, ...counted.filter((c) => c.until > at));
    const status = counted.length < limit ? 200 : 429;
    const request = { until: Infinity };
    counted.push(request);
    seen.push({ role: body.text.format.name, at, status });
    const headers = (left: number) => ({
      'x-ratelimit-limit-requests': String(limit),
      'x-ratelimit-limit-tokens': '2100000',
      'x-ratelimit-remaining-requests': String(left),
      'x-ratelimit-remaining-tokens': '2000000',
    });
    if (status === 429) {
      request.until = Date.now() + windowMs;
      return new Response('{"error":{"code":"rate_limit_exceeded"}}', { status, headers: { ...headers(0), 'retry-after': '60' } });
    }
    open++;
    most = Math.max(most, open);
    await new Promise((r) => setTimeout(r, answerMs));
    open--;
    request.until = Date.now() + windowMs;
    return body.stream ? streamed(['{"answer":"yes"}'], 7, headers(limit - counted.length)) : new Response(JSON.stringify(reply), { status, headers: headers(limit - counted.length) });
  }) as typeof globalThis.fetch;
  return { fetch, seen, most: () => most };
}

test('a burst past the rate limit is held until its first requests leave the window, and every request is answered', { timeout: 10_000 }, async () => {
  const api = limitedApi(5, 300);
  const model = new MetaModel({ apiKey: 'k', fetch: api.fetch, rateWindowMs: 300 });
  const started = Date.now();

  const answers = await Promise.all(Array.from({ length: 10 }, (_, i) => model.json({ ...ask, role: `r${i}`, ...(i % 2 ? { onText: () => {} } : {}) })));

  assert.deepEqual(answers, Array.from({ length: 10 }, () => ({ answer: 'yes' })));
  // Before any answer said what the limit is, the burst ran into it. After that nothing was sent into a full window.
  const refused = api.seen.filter((s) => s.status === 429);
  assert.equal(refused.length, 5);
  assert.ok(refused.every((s) => s.at - started < 100));
  const answered = api.seen.filter((s) => s.status === 200).map((s) => s.at - started);
  assert.equal(answered.filter((ms) => ms < 300).length, 5);
  assert.equal(answered.filter((ms) => ms >= 300).length, 5);
});

test('a request held a window and a half in all is given up then, and says so', { timeout: 10_000 }, async () => {
  const api = limitedApi(2, 200);
  const calls: { role: string; heldMs?: number; gaveUp?: boolean }[] = [];
  const model = new MetaModel({ apiKey: 'k', fetch: api.fetch, rateWindowMs: 200, onCall: ({ role, heldMs, gaveUp }) => calls.push({ role, heldMs, gaveUp }) });
  await Promise.all([0, 1].map((i) => model.json({ ...ask, role: `early${i}` })));

  const later = await Promise.allSettled([0, 1, 2, 3].map((i) => model.json({ ...ask, role: `later${i}` })));

  assert.deepEqual(later.map((r) => r.status), ['fulfilled', 'fulfilled', 'rejected', 'rejected']);
  const given = calls.filter((c) => c.gaveUp);
  assert.deepEqual(given.map((c) => c.role), ['later2', 'later3']);
  assert.ok(given.every((c) => c.heldMs! >= 300 && c.heldMs! < 400), JSON.stringify(given));
  assert.ok(api.seen.every((s) => s.status === 200), 'never refused');
});

test('requests held for the rate window let the user\'s out first, and background work leaves the last of the limit to the user', { timeout: 10_000 }, async () => {
  const api = limitedApi(10, 600);
  const held = new Map<string, number | undefined>();
  const model = new MetaModel({ apiKey: 'k', fetch: api.fetch, rateWindowMs: 600, onCall: ({ role, heldMs }) => held.set(role, heldMs) });

  await Promise.all(Array.from({ length: 9 }, (_, i) => model.json({ ...ask, role: `early${i}` })));
  const composites = model.json({ ...ask, role: 'composites', priority: 'background' });
  await model.json({ ...ask, role: 'conductor' });
  const questions = model.json({ ...ask, role: 'questions' });
  await Promise.all([composites, questions]);

  const early = api.seen[0]!.at;
  assert.deepEqual(api.seen.slice(9).map((s) => [s.role, s.at - early >= 600]), [['conductor', false], ['questions', true], ['composites', true]]);
  assert.ok(api.seen.every((s) => s.status === 200), 'held on what the answers said is left, never refused');
  assert.equal(held.get('conductor'), 0);
  assert.ok(held.get('questions')! > 0 && held.get('composites')! > 0);
});

test('requests other programs on the key have made, as the answers count them, are left room for', { timeout: 10_000 }, async () => {
  const api = limitedApi(10, 400, 8);
  const model = new MetaModel({ apiKey: 'k', fetch: api.fetch, rateWindowMs: 400 });
  const started = Date.now();

  await model.json({ ...ask, role: 'first' });
  await model.json({ ...ask, role: 'second' });
  await model.json({ ...ask, role: 'third' });

  assert.ok(api.seen.every((s) => s.status === 200), 'never refused');
  assert.deepEqual(api.seen.map((s) => [s.role, s.at - started >= 400]), [['first', false], ['second', false], ['third', true]]);
});

test('nothing is held while the window has room', { timeout: 10_000 }, async () => {
  const api = limitedApi(60, 60_000, 0, 300);
  const held: (number | undefined)[] = [];
  const model = new MetaModel({ apiKey: 'k', fetch: api.fetch, onCall: ({ heldMs }) => held.push(heldMs) });

  await Promise.all(Array.from({ length: 16 }, (_, i) => model.json({ ...ask, role: `r${i}` })));

  assert.equal(api.most(), 16);
  assert.deepEqual(held, Array(16).fill(0));
});

test('a refusal that says nothing of the window holds the request for a window, and one that cannot go within a window and a half in all is given up', { timeout: 10_000 }, async () => {
  let sent = 0;
  const fetch = (async () => {
    sent++;
    return new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429 });
  }) as typeof globalThis.fetch;
  const calls: { ok: boolean; tries?: number; gaveUp?: boolean }[] = [];
  const started = Date.now();

  const model = new MetaModel({ apiKey: 'k', fetch, rateWindowMs: 100, onCall: ({ ok, tries, gaveUp }) => calls.push({ ok, tries, gaveUp }) });
  await assert.rejects(model.json(ask), /gave up after \d+ms held for the rate window, last refused: 429 .*rate_limit_exceeded/);

  assert.ok(Date.now() - started >= 100 && Date.now() - started < 1000);
  assert.equal(sent, 2);
  assert.deepEqual(calls, [{ ok: false, tries: 2, gaveUp: true }]);
});

test('a refusal its counts do not explain holds the request for as long as the refusal asks, and a second at least', { timeout: 10_000 }, async () => {
  const at: number[] = [];
  const reply = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":"yes"}' }] }], usage: { total_tokens: 12 } };
  const fetch = (async () => {
    at.push(Date.now());
    const headers = { 'x-ratelimit-limit-requests': '60', 'x-ratelimit-remaining-requests': '50', 'x-ratelimit-limit-tokens': '2100000', 'x-ratelimit-remaining-tokens': '9000' };
    return at.length === 1
      ? new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429, headers: { ...headers, 'retry-after': '0.2' } })
      : new Response(JSON.stringify(reply), { status: 200, headers });
  }) as typeof globalThis.fetch;

  assert.deepEqual(await new MetaModel({ apiKey: 'k', fetch }).json(ask), { answer: 'yes' });

  assert.equal(at.length, 2);
  assert.ok(at[1]! - at[0]! >= 1000 && at[1]! - at[0]! < 2000, `sent again after ${at[1]! - at[0]!} ms`);
});

test('a refusal that asks for a longer wait than a request may be held gives up that request, and every one after it, at once', { timeout: 10_000 }, async () => {
  let sent = 0;
  const fetch = (async () => {
    sent++;
    const headers = { 'x-ratelimit-limit-requests': '60', 'x-ratelimit-remaining-requests': '50', 'retry-after': '3600' };
    return new Response('{"error":{"code":"insufficient_quota"}}', { status: 429, headers });
  }) as typeof globalThis.fetch;
  const calls: { ok: boolean; gaveUp?: boolean }[] = [];
  const model = new MetaModel({ apiKey: 'k', fetch, onCall: ({ ok, gaveUp }) => calls.push({ ok, gaveUp }) });
  const started = Date.now();

  await assert.rejects(model.json(ask), /gave up after \d+ms held for the rate window, last refused: 429 .*insufficient_quota/);
  await assert.rejects(model.json({ ...ask, priority: 'background' }), /gave up/);

  assert.ok(Date.now() - started < 1000);
  assert.equal(sent, 1);
  assert.deepEqual(calls, [{ ok: false, gaveUp: true }, { ok: false, gaveUp: true }]);
});

test('a request counts against the limit until a whole window after its answer ended', { timeout: 10_000 }, async () => {
  const api = limitedApi(5, 400, 0, 200);
  const model = new MetaModel({ apiKey: 'k', fetch: api.fetch, rateWindowMs: 400 });

  await Promise.all(Array.from({ length: 5 }, (_, i) => model.json({ ...ask, role: `early${i}`, ...(i % 2 ? { onText: () => {} } : {}) })));
  await model.json({ ...ask, role: 'late' });

  assert.ok(api.seen.every((s) => s.status === 200), 'never refused');
  assert.ok(api.seen.at(-1)!.at - api.seen[0]!.at >= 600);
});
