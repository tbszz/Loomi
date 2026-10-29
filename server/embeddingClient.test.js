import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';

await test('configured cloud embeddings require their own key and explicit provider revision', async () => {
  const { createConfiguredEmbeddingProvider } = await import('./embeddingClient.js');
  const config = { RESUME_EMBEDDING_PROVIDER: 'qianwen', RESUME_EMBEDDING_BASE_URL: 'https://maas.qianwenaiapi.com/compatible-mode/v1', RESUME_EMBEDDING_MODEL: 'qwen3.7-text-embedding-flash', RESUME_EMBEDDING_API_KEY: 'dummy-embedding-key', RESUME_EMBEDDING_DIMENSIONS: '256', RESUME_EMBEDDING_REVISION: 'alias-2026-10-09' };
  assert.match(createConfiguredEmbeddingProvider(config).id, /^qianwen:/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_API_KEY: undefined, MINIMAX_API_KEY: 'dummy-chat-key', ANTHROPIC_API_KEY: 'dummy-chat-key' }), /凭据/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_REVISION: undefined }), /版本/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_DIMENSIONS: '256junk' }), /维度/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_DIMENSIONS: '0x100' }), /维度/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_PROVIDER: 'unknown' }), /提供方/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_PROVIDER: '' }), /提供方/);
  assert.equal(createConfiguredEmbeddingProvider({ RESUME_EMBEDDING_PROVIDER: 'qianwen' }), null);
});

await test('configured google embeddings require their own key and accept only MRL dimensions', async () => {
  const { createConfiguredEmbeddingProvider } = await import('./embeddingClient.js');
  const config = { RESUME_EMBEDDING_PROVIDER: 'google', RESUME_EMBEDDING_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta', RESUME_EMBEDDING_MODEL: 'gemini-embedding-001', RESUME_EMBEDDING_API_KEY: 'dummy-google-key', RESUME_EMBEDDING_DIMENSIONS: '3072', RESUME_EMBEDDING_REVISION: '2026-10-10' };
  assert.match(createConfiguredEmbeddingProvider(config).id, /^google:/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_API_KEY: undefined, MINIMAX_API_KEY: 'dummy-chat-key', ANTHROPIC_API_KEY: 'dummy-chat-key' }), /凭据/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_REVISION: undefined }), /版本/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_DIMENSIONS: '1024' }), /维度/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_DIMENSIONS: '3072junk' }), /维度/);
  assert.throws(() => createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_PROVIDER: 'unknown' }), /提供方/);
  assert.equal(createConfiguredEmbeddingProvider({ RESUME_EMBEDDING_PROVIDER: 'google' }), null);
});

await test('embedding transport honors a configured proxy while the provider identity ignores it', async () => {
  const { createConfiguredEmbeddingProvider } = await import('./embeddingClient.js');
  const config = { RESUME_EMBEDDING_PROVIDER: 'google', RESUME_EMBEDDING_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta', RESUME_EMBEDDING_MODEL: 'gemini-embedding-001', RESUME_EMBEDDING_API_KEY: 'dummy-google-key', RESUME_EMBEDDING_DIMENSIONS: '768', RESUME_EMBEDDING_REVISION: '2026-10-10' };
  const direct = createConfiguredEmbeddingProvider(config);
  assert.equal(createConfiguredEmbeddingProvider({ ...config, HTTPS_PROXY: 'http://127.0.0.1:10808' }).id, direct.id);
  const proxied = createConfiguredEmbeddingProvider({ ...config, HTTPS_PROXY: 'http://secret-user:secret-pass@127.0.0.1:10808' });
  assert.equal(JSON.stringify(proxied).includes('secret'), false);
  assert.equal(JSON.stringify(proxied).includes('10808'), false);
  for (const proxy of ['not a url', 'ftp://127.0.0.1:1080', 'http://']) {
    assert.throws(() => createConfiguredEmbeddingProvider({ ...config, HTTPS_PROXY: proxy }), /代理/);
  }
});

await test('omitted or explicit ollama mode retains the same local provider identity', async () => {
  const { createConfiguredEmbeddingProvider, createLocalEmbeddingProvider } = await import('./embeddingClient.js');
  const config = { RESUME_EMBEDDING_MODEL: 'fixture', RESUME_EMBEDDING_DIGEST: 'a'.repeat(64) };
  const local = createLocalEmbeddingProvider({ model: 'fixture', digest: 'a'.repeat(64) });
  assert.equal(createConfiguredEmbeddingProvider(config).id, local.id);
  assert.equal(createConfiguredEmbeddingProvider({ ...config, RESUME_EMBEDDING_PROVIDER: 'ollama' }).id, local.id);
});

await test('local embeddings use the chosen model digest and never borrow a chat credential', async () => {
  const { createLocalEmbeddingProvider } = await import('./embeddingClient.js');
  const digest = 'a'.repeat(64);
  const calls = [];
  const server = http.createServer(async (req, res) => {
    calls.push(req.url);
    assert.equal(req.headers.authorization, undefined);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'embedding-fixture:latest', digest }] })); return; }
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    assert.equal(body.model, 'embedding-fixture:latest');
    assert.equal(body.truncate, false);
    res.end(JSON.stringify({ embeddings: body.input.map(() => [1, .5, 0]) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = createLocalEmbeddingProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'embedding-fixture:latest', digest });
    assert.deepEqual(await provider.embed({ texts: ['合成检索资料'], purpose: 'document' }), [[1, .5, 0]]);
    assert.deepEqual(calls, ['/api/tags', '/api/embed', '/api/tags']);
    const changed = createLocalEmbeddingProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'embedding-fixture:latest', digest: 'b'.repeat(64) });
    assert.notEqual(changed.id, provider.id);
    await assert.rejects(changed.embed({ texts: ['q'], purpose: 'query' }), /模型版本/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

await test('a model replaced during embedding cannot populate its old digest namespace', async () => {
  const { createLocalEmbeddingProvider } = await import('./embeddingClient.js');
  let changed = false;
  const provider = createLocalEmbeddingProvider({ model: 'fixture', digest: 'a'.repeat(64), fetchImpl: async url => {
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'fixture', digest: (changed ? 'b' : 'a').repeat(64) }] }));
    changed = true;
    return new Response(JSON.stringify({ model: 'fixture', embeddings: [[1, 0]] }));
  } });
  await assert.rejects(provider.embed({ texts: ['q'], purpose: 'query' }), /模型版本/);
});

await test('missing config is unconfigured, nonlocal URLs and malformed vectors are rejected', async () => {
  const { createLocalEmbeddingProvider, createConfiguredEmbeddingProvider } = await import('./embeddingClient.js');
  assert.equal(createConfiguredEmbeddingProvider({}), null);
  for (const baseUrl of ['https://external.example','http://192.168.1.1','http://user:pass@127.0.0.1','http://127.0.0.1?api_key=secret']) assert.throws(() => createLocalEmbeddingProvider({ baseUrl, model: 'model', digest: 'a'.repeat(64) }));
  let calls = 0;
  const fetchImpl = async url => { calls++; return new Response(JSON.stringify(url.endsWith('/api/tags') ? { models: [{ name: 'model:latest', digest: 'a'.repeat(64) }] } : { embeddings: [[0,0]] })); };
  const provider = createLocalEmbeddingProvider({ model: 'model:latest', digest: 'a'.repeat(64), fetchImpl });
  await assert.rejects(provider.embed({ texts: ['q'], purpose: 'query' }), /向量/);
  const controller = new AbortController(); controller.abort();
  const before = calls;
  await assert.rejects(provider.embed({ texts: ['q'], purpose: 'query', signal: controller.signal }), /abort/i);
  assert.equal(calls, before);
});
