import assert from 'node:assert/strict';
import { test } from 'node:test';

const baseUrl = 'https://maas.qianwenaiapi.com/compatible-mode/v1';
const model = 'qwen3.7-text-embedding-flash';
const apiKey = 'dummy-embedding-key';
const options = { baseUrl, model, apiKey, dimensions: 256, revision: 'alias-2026-10-09' };
const vector = value => Array.from({ length: 256 }, (_, index) => index === 0 ? value : 0);
const reply = values => new Response(JSON.stringify({ object: 'list', model, data: values.map((value, index) => ({ object: 'embedding', index, embedding: vector(value) })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
const create = async extra => (await import('./cloudEmbeddingClient.js')).createQianwenEmbeddingProvider({ ...options, ...extra });

await test('compatible embeddings send the fixed model and isolated bearer key with no text_type', async () => {
  const provider = await create({ fetchImpl: async (url, request) => {
    assert.equal(url, `${baseUrl}/embeddings`);
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, `Bearer ${apiKey}`);
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(request.body), { model, input: ['synthetic query'], dimensions: 256, encoding_format: 'float' });
    return reply([2]);
  } });
  assert.deepEqual(await provider.embed({ texts: ['synthetic query'], purpose: 'query' }), [vector(2)]);
  assert.match(provider.id, /^qianwen:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(provider).includes(apiKey), false);
  assert.equal(String(provider.embed).includes(apiKey), false);
});

await test('32 inputs split sequentially into 20 plus 12 and preserve returned index order', async () => {
  const batchSizes = [];
  let active = false;
  const provider = await create({ fetchImpl: async (_url, request) => {
    assert.equal(active, false); active = true;
    const input = JSON.parse(request.body).input;
    batchSizes.push(input.length);
    await Promise.resolve(); active = false;
    const data = input.map((value, index) => ({ index, embedding: vector(Number(value)) })).reverse();
    return new Response(JSON.stringify({ data }));
  } });
  const texts = Array.from({ length: 32 }, (_, index) => String(index + 1));
  assert.deepEqual(await provider.embed({ texts, purpose: 'document' }), texts.map(value => vector(Number(value))));
  assert.deepEqual(batchSizes, [20, 12]);
});

await test('rejects malformed indices, dimension, model and vector responses', async () => {
  const entry = { index: 0, embedding: vector(1) };
  const invalid = [
    { data: [] }, { data: [entry, entry] }, { data: [{ ...entry, index: -1 }] },
    { data: [{ ...entry, index: '0' }] }, { data: [{ ...entry, index: 1 }] },
    { data: [{ ...entry, index: 0.5 }] }, { data: [{ embedding: vector(1) }] },
    { data: [{ ...entry, embedding: ['1', ...vector(1).slice(1)] }] },
    { data: [{ ...entry, embedding: vector(0) }] },
    { data: [{ ...entry, embedding: [1] }] },
    { data: [{ ...entry, embedding: 'encoded-vector' }] },
    { model: 'other-model', data: [entry] }, { model: null, data: [entry] },
  ];
  for (const result of invalid) {
    const provider = await create({ fetchImpl: async () => new Response(JSON.stringify(result)) });
    await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'document' }), /无效向量/);
  }
  const missing = await create({ fetchImpl: async () => new Response(JSON.stringify({ data: [entry, { ...entry, index: 0 }] })) });
  await assert.rejects(missing.embed({ texts: ['a', 'b'], purpose: 'query' }), /无效向量/);
});

await test('validates complete input before any batch is sent', async () => {
  let calls = 0;
  const provider = await create({ fetchImpl: async () => { calls++; return reply([1]); } });
  for (const texts of [[], Array(1), [' '], [42], ['a'.repeat(8193)], Array(33).fill('x'), Array(32).fill('x'.repeat(8192)), [...Array(20).fill('valid'), '']]) {
    await assert.rejects(provider.embed({ texts, purpose: 'document' }), /输入/);
  }
  await assert.rejects(provider.embed({ texts: ['a'], purpose: 'unknown' }), /输入/);
  assert.equal(calls, 0);
});

await test('only the explicitly approved endpoint, model, dimensions and bounded revision are accepted', async () => {
  const { createQianwenEmbeddingProvider } = await import('./cloudEmbeddingClient.js');
  for (const url of ['http://maas.qianwenaiapi.com/compatible-mode/v1', 'https://elsewhere.example/compatible-mode/v1', `${baseUrl}?api_key=dummy`, `${baseUrl}#dummy`, `${baseUrl}?`, `${baseUrl}#`, 'https://dummy:dummy@maas.qianwenaiapi.com/compatible-mode/v1', 'https://maas.qianwenaiapi.com/v1', `${baseUrl}/other`, 'https://maas.qianwenaiapi.com:444/compatible-mode/v1']) {
    assert.throws(() => createQianwenEmbeddingProvider({ ...options, baseUrl: url }), error => !error.message.includes(url) && !error.message.includes('dummy'));
  }
  for (const extra of [{ model: 'another-model' }, { dimensions: 3 }, { dimensions: '256' }, { revision: '' }, { revision: 'x'.repeat(81) }, { revision: 'bad revision' }, { apiKey: '' }, { apiKey: 'dummy\nsecret' }]) {
    assert.throws(() => createQianwenEmbeddingProvider({ ...options, ...extra }));
  }
  for (const dimensions of [256, 512, 768, 1024]) assert.match(createQianwenEmbeddingProvider({ ...options, dimensions }).id, /^qianwen:/);
  assert.notEqual(createQianwenEmbeddingProvider(options).id, createQianwenEmbeddingProvider({ ...options, dimensions: 512 }).id);
  assert.notEqual(createQianwenEmbeddingProvider(options).id, createQianwenEmbeddingProvider({ ...options, revision: 'next-revision' }).id);
  assert.equal(createQianwenEmbeddingProvider(options).id, createQianwenEmbeddingProvider({ ...options, apiKey: 'different-dummy-key' }).id);
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
  const provider = await create({ fetchImpl: async () => { calls++; return reply([1]); } });
  await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'query', signal: controller.signal }), error => /取消/.test(error.message) && !error.message.includes(apiKey));
  assert.equal(calls, 0);
});

await test('timeout bounds fetch even when an injected transport ignores the signal', async () => {
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

await test('non-finite JSON numbers and missing multi-input indices are rejected', async () => {
  const infinite = JSON.stringify({ data: [{ index: 0, embedding: vector(1) }] }).replace('"embedding":[1,', '"embedding":[1e400,');
  const provider = await create({ fetchImpl: async () => new Response(infinite) });
  await assert.rejects(provider.embed({ texts: ['synthetic'], purpose: 'query' }), /无效向量/);
  const missing = await create({ fetchImpl: async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: vector(1) }] })) });
  await assert.rejects(missing.embed({ texts: ['a', 'b'], purpose: 'query' }), /无效向量/);
});

await test('partial batch failures return no embeddings and never retry or continue', async () => {
  let calls = 0;
  const provider = await create({ fetchImpl: async (_url, request) => {
    calls++;
    if (calls === 2) return new Response('dummy upstream failure', { status: 429 });
    return reply(JSON.parse(request.body).input.map(() => 1));
  } });
  await assert.rejects(provider.embed({ texts: Array(32).fill('synthetic'), purpose: 'document' }), /未成功返回/);
  assert.equal(calls, 2);
});

await test('default dimension is 1024 and the batch snapshot cannot change during transport', async () => {
  const texts = Array(21).fill('synthetic');
  let calls = 0;
  const provider = await create({ dimensions: undefined, fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.dimensions, 1024);
    assert.equal(body.input.every(text => text === 'synthetic'), true);
    calls++; texts[20] = 'mutated';
    return new Response(JSON.stringify({ data: body.input.map((_, index) => ({ index, embedding: Array(1024).fill(1) })) }));
  } });
  assert.equal((await provider.embed({ texts, purpose: 'document' })).length, 21);
  assert.equal(calls, 2);
});
