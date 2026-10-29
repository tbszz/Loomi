import assert from 'node:assert/strict';
import { test } from 'node:test';

const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
const model = 'gemini-embedding-001';
const apiKey = 'dummy-google-key';
const options = { baseUrl, model, apiKey, dimensions: 768, revision: '2026-10-10' };
const vector = value => Array.from({ length: 768 }, (_, index) => index === 0 ? value : 0);
const reply = value => new Response(JSON.stringify({ embedding: { values: vector(value) } }));
const create = async extra => (await import('./googleEmbeddingClient.js')).createGoogleEmbeddingProvider({ ...options, ...extra });

await test('embedContent sends one text with retrieval task type, header key and pinned dimensions', async () => {
  const provider = await create({ fetchImpl: async (url, request) => {
    assert.equal(url, `${baseUrl}/models/${model}:embedContent`);
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers['x-goog-api-key'], apiKey);
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(request.body), { model: `models/${model}`, content: { parts: [{ text: 'synthetic query' }] }, taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 });
    return reply(2);
  } });
  assert.deepEqual(await provider.embed({ texts: ['synthetic query'], purpose: 'query' }), [vector(2)]);
  assert.match(provider.id, /^google:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(provider).includes(apiKey), false);
  assert.equal(String(provider.embed).includes(apiKey), false);
});

await test('document purpose maps to RETRIEVAL_DOCUMENT and batches fan out sequentially in order', async () => {
  let active = false;
  const requests = [];
  const provider = await create({ fetchImpl: async (_url, request) => {
    assert.equal(active, false); active = true;
    const body = JSON.parse(request.body);
    requests.push(body);
    await Promise.resolve(); active = false;
    return new Response(JSON.stringify({ embedding: { values: vector(Number(body.content.parts[0].text)) } }));
  } });
  const texts = Array.from({ length: 32 }, (_, index) => String(index + 1));
  assert.deepEqual(await provider.embed({ texts, purpose: 'document' }), texts.map(value => vector(Number(value))));
  assert.equal(requests.length, 32);
  assert.ok(requests.every(body => body.taskType === 'RETRIEVAL_DOCUMENT' && body.outputDimensionality === 768));
  assert.deepEqual(requests.map(body => body.content.parts[0].text), texts);
});

await test('rejects malformed embedding, model and vector responses', async () => {
  const valid = { model: `models/${model}`, embedding: { values: vector(1) } };
  const invalid = [
    {}, { embedding: null }, { embedding: {} }, { embedding: { values: [] } },
    { embedding: { values: [1] } }, { embedding: { values: vector(0) } },
    { embedding: { values: ['1', ...vector(1).slice(1)] } },
    { embedding: { values: 'encoded-vector' } },
    { ...valid, model: 'models/other-model' }, { ...valid, model: null },
  ];
  for (const result of invalid) {
    const provider = await create({ fetchImpl: async () => new Response(JSON.stringify(result)) });
    await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'document' }), /无效向量/);
  }
  const infinite = JSON.stringify(valid).replace('"values":[1,', '"values":[1e400,');
  const provider = await create({ fetchImpl: async () => new Response(infinite) });
  await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'query' }), /无效向量/);
});

await test('validates complete input before any request is sent', async () => {
  let calls = 0;
  const provider = await create({ fetchImpl: async () => { calls++; return reply(1); } });
  for (const texts of [[], Array(1), [' '], [42], ['a'.repeat(8193)], Array(33).fill('x'), Array(32).fill('x'.repeat(8192)), [...Array(20).fill('valid'), '']]) {
    await assert.rejects(provider.embed({ texts, purpose: 'document' }), /输入/);
  }
  await assert.rejects(provider.embed({ texts: ['a'], purpose: 'unknown' }), /输入/);
  assert.equal(calls, 0);
});

await test('only the explicitly approved endpoint, model, dimensions and bounded revision are accepted', async () => {
  const { createGoogleEmbeddingProvider } = await import('./googleEmbeddingClient.js');
  for (const url of ['http://generativelanguage.googleapis.com/v1beta', 'https://elsewhere.example/v1beta', `${baseUrl}?key=dummy`, `${baseUrl}#dummy`, `${baseUrl}?`, `${baseUrl}#`, 'https://dummy:dummy@generativelanguage.googleapis.com/v1beta', 'https://generativelanguage.googleapis.com', `${baseUrl}/other`, `${baseUrl}/v1/models`, 'https://generativelanguage.googleapis.com:444/v1beta', `${baseUrl}/v1beta/`]) {
    assert.throws(() => createGoogleEmbeddingProvider({ ...options, baseUrl: url }), error => !error.message.includes(url) && !error.message.includes('dummy'));
  }
  for (const extra of [{ model: 'text-embedding-004' }, { dimensions: 1024 }, { dimensions: 256 }, { dimensions: '768' }, { revision: '' }, { revision: 'x'.repeat(81) }, { revision: 'bad revision' }, { apiKey: '' }, { apiKey: 'dummy\nsecret' }]) {
    assert.throws(() => createGoogleEmbeddingProvider({ ...options, ...extra }));
  }
  for (const dimensions of [768, 1536, 3072]) assert.match(createGoogleEmbeddingProvider({ ...options, dimensions }).id, /^google:/);
  assert.notEqual(createGoogleEmbeddingProvider(options).id, createGoogleEmbeddingProvider({ ...options, dimensions: 1536 }).id);
  assert.notEqual(createGoogleEmbeddingProvider(options).id, createGoogleEmbeddingProvider({ ...options, revision: 'next-revision' }).id);
  assert.equal(createGoogleEmbeddingProvider(options).id, createGoogleEmbeddingProvider({ ...options, apiKey: 'different-dummy-key' }).id);
});

await test('default dimension is 3072 and the batch snapshot cannot change during transport', async () => {
  const texts = Array(3).fill('synthetic');
  const provider = await create({ dimensions: undefined, fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.outputDimensionality, 3072);
    texts[1] = 'mutated';
    return new Response(JSON.stringify({ embedding: { values: Array(3072).fill(1) } }));
  } });
  assert.equal((await provider.embed({ texts, purpose: 'document' })).length, 3);
});

await test('HTTP, redirects, parse and transport errors never expose provider errors or input', async () => {
  const secret = `${apiKey} synthetic-private-text ${baseUrl}`;
  for (const fetchImpl of [
    async () => { throw new Error(secret); },
    async () => new Response(secret, { status: 401 }),
    async () => new Response(secret, { status: 302, headers: { location: 'https://evil.example' } }),
    async () => new Response(secret),
    async () => ({ ok: true, redirected: true, url: 'https://evil.example' }),
    async () => ({ ok: true, url: 'https://evil.example' }),
  ]) {
    const provider = await create({ fetchImpl });
    await assert.rejects(provider.embed({ texts: ['synthetic-private-text'], purpose: 'query' }), error => {
      assert.equal(error.message.includes(apiKey), false);
      assert.equal(error.message.includes(baseUrl), false);
      assert.equal(error.message.includes('synthetic-private-text'), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

await test('streamed responses are capped at 2 MiB and cancelled on failure', async () => {
  let cancelled = false;
  const provider = await create({ fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'query' }), /大小限制/);
  assert.equal(cancelled, true);
});

await test('abort before dispatch is sanitized and sends nothing', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort(new Error(apiKey));
  const provider = await create({ fetchImpl: async () => { calls++; return reply(1); } });
  await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'query', signal: controller.signal }), error => /取消/.test(error.message) && !error.message.includes(apiKey));
  assert.equal(calls, 0);
});

await test('caller abort between single-text requests cancels the remaining fan-out', async () => {
  let calls = 0;
  const controller = new AbortController();
  const provider = await create({ fetchImpl: async () => {
    calls++;
    if (calls === 2) setTimeout(() => controller.abort(new Error(apiKey)), 5);
    return new Promise(resolve => setTimeout(() => resolve(reply(1)), 20));
  } });
  await assert.rejects(provider.embed({ texts: ['a', 'b', 'c', 'd'], purpose: 'query', signal: controller.signal }), error => /取消/.test(error.message) && !error.message.includes(apiKey));
  assert.ok(calls <= 3);
});

await test('timeout bounds each request even when an injected transport ignores the signal', async () => {
  let active;
  const provider = await create({ timeoutMs: 15, fetchImpl: async (_url, request) => { active = request.signal; return new Promise(() => {}); } });
  await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'query' }), /超时/);
  assert.equal(active.aborted, true);
});

await test('timeout and caller abort cancel a stalled response body', async () => {
  for (const abortByCaller of [false, true]) {
    let cancelled = false;
    const controller = new AbortController();
    const provider = await create({ timeoutMs: 30, fetchImpl: async () => {
      if (abortByCaller) setTimeout(() => controller.abort(new Error(apiKey)), 5);
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    } });
    await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'query', signal: controller.signal }), error => /超时|取消/.test(error.message) && !error.message.includes(apiKey));
    assert.equal(cancelled, true);
  }
});

await test('stalled stream cancellation cannot extend the response deadline', async () => {
  const provider = await create({ timeoutMs: 15, fetchImpl: async () => new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } })) });
  await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'query' }), /超时/);
});

await test('a failed request returns no embeddings and never retries', async () => {
  let calls = 0;
  const provider = await create({ fetchImpl: async () => {
    calls++;
    return new Response('dummy upstream failure', { status: 429 });
  } });
  await assert.rejects(provider.embed({ texts: Array(32).fill('synthetic'), purpose: 'document' }), /未成功返回/);
  assert.equal(calls, 1);
});
