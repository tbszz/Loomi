import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { createCandidateRetrieval } from './candidateRetrieval.js';
import { searchSemanticCandidateKnowledge } from './semanticRetrieval.js';

function fixture(filename = path.join(mkdtempSync(path.join(os.tmpdir(), 'resume-semantic-')), 'state.sqlite')) {
  const directory = path.dirname(filename);
  const database = createDatabase({ filename });
  const alice = database.createUser({ email: `alice-${Math.random()}@example.com`, name: 'Alice', passwordHash: 'hash-a' });
  const bob = database.createUser({ email: `bob-${Math.random()}@example.com`, name: 'Bob', passwordHash: 'hash-b' });
  return { directory, database, alice, bob, filename };
}

function seedMaterial(database, userId, candidateId, { documentId = 'doc-main', text, facts, chunks }) {
  database.saveConversation(userId, { id: `conv-${documentId}`, candidateId, title: documentId, messages: [], context: {} });
  const document = database.saveDocument(userId, { id: documentId, conversationId: `conv-${documentId}`, candidateId, name: `${documentId}.txt`, mimeType: 'text/plain', text });
  database.saveCandidateMaterial(userId, candidateId, document, facts.map(fact => ({
    id: fact.id,
    type: fact.type || 'project',
    value: fact.value,
    sourceQuote: fact.value,
    sourcePosition: text.indexOf(fact.value),
    confidence: 0.9,
    status: fact.status || 'user_asserted'
  })), chunks.map(chunk => ({
    id: chunk.id,
    text: chunk.text,
    start: text.indexOf(chunk.text),
    end: text.indexOf(chunk.text) + chunk.text.length
  })));
  return document;
}

function semanticProvider({ id = 'test-embed-v1', failOn, badVectorFor, invalidVectorFor, delayDocument = null } = {}) {
  const calls = [];
  const vectorFor = (text) => {
    if (badVectorFor && String(text).includes(badVectorFor)) return [NaN, 0];
    if (invalidVectorFor && String(text).includes(invalidVectorFor)) return ['1', 0, 0];
    if (/front-end framework|React|GreenSteps|SPA/i.test(text)) return [1, 0, 0];
    if (/operations|公众号|写作/i.test(text)) return [0, 1, 0];
    if (/database|SQLite/i.test(text)) return [0, 0, 1];
    return [0.01, 0.01, 0.01];
  };
  return {
    id,
    calls,
    async embed({ texts, purpose, signal }) {
      signal?.throwIfAborted();
      calls.push({ purpose, texts: [...texts] });
      if (failOn && purpose === failOn) throw new Error('provider failed with secret-token and phone 13800138000');
      if (delayDocument && purpose === 'document') await delayDocument();
      signal?.throwIfAborted();
      return texts.map(vectorFor);
    }
  };
}

async function withFixture(run) {
  const fx = fixture();
  try { await run(fx); }
  finally { fx.database.close(); rmSync(fx.directory, { recursive: true, force: true }); }
}

await test('semantic retrieval recalls evidence with no lexical overlap and marks semantic success', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    const text = 'GreenSteps 项目使用 React 构建单页应用\n校园公众号内容运营';
    seedMaterial(database, alice.id, candidate.id, {
      text,
      facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React 构建单页应用' }, { id: 'fact-ops', value: '校园公众号内容运营' }],
      chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React 构建单页应用' }, { id: 'chunk-ops', text: '校园公众号内容运营' }]
    });
    const provider = semanticProvider();
    const retrieve = createCandidateRetrieval(database, { embeddingProvider: provider });

    const pack = await retrieve({ userId: alice.id, candidateId: candidate.id, query: 'front-end framework' });

    assert.equal(pack.coverage.semantic.status, 'success');
    assert.ok(pack.facts.some(fact => fact.factId === 'fact-react'));
    assert.ok(pack.passages.some(passage => passage.chunkId === 'chunk-react'));
    assert.equal(provider.calls.some(call => call.purpose === 'query'), true);
    assert.equal(provider.calls.some(call => call.purpose === 'document'), true);
  });
});

await test('ownership is checked before embedding so cross-user reads make zero provider calls', async () => {
  await withFixture(async ({ database, alice, bob }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    seedMaterial(database, alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });
    const provider = semanticProvider();
    const retrieve = createCandidateRetrieval(database, { embeddingProvider: provider });

    await assert.rejects(async () => retrieve({ userId: bob.id, candidateId: candidate.id, query: 'front-end framework' }), /不属于当前账号/);
    assert.equal(provider.calls.length, 0);
  });
});

await test('document embeddings are cached across database restarts and content changes invalidate old entries', async () => {
  const fx = fixture();
  try {
    const candidate = fx.database.createCandidate(fx.alice.id, '张三');
    seedMaterial(fx.database, fx.alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });
    const provider = semanticProvider();
    await createCandidateRetrieval(fx.database, { embeddingProvider: provider })({ userId: fx.alice.id, candidateId: candidate.id, query: 'front-end framework' });
    assert.equal(provider.calls.filter(call => call.purpose === 'document').length, 1);
    fx.database.close();

    const reopened = createDatabase({ filename: fx.filename });
    const providerAfterRestart = semanticProvider();
    await createCandidateRetrieval(reopened, { embeddingProvider: providerAfterRestart })({ userId: fx.alice.id, candidateId: candidate.id, query: 'front-end framework' });
    assert.equal(providerAfterRestart.calls.filter(call => call.purpose === 'document').length, 0, 'cached document vectors survive restart');

    const changed = 'GreenSteps 项目使用 React 构建 SPA';
    seedMaterial(reopened, fx.alice.id, candidate.id, { documentId: 'doc-main', text: changed, facts: [{ id: 'fact-react', value: changed }], chunks: [{ id: 'chunk-react', text: changed }] });
    const providerAfterChange = semanticProvider();
    await createCandidateRetrieval(reopened, { embeddingProvider: providerAfterChange })({ userId: fx.alice.id, candidateId: candidate.id, query: 'front-end framework' });
    assert.equal(providerAfterChange.calls.filter(call => call.purpose === 'document').length, 1, 'changed content is re-embedded');
    reopened.close();
  } finally {
    rmSync(fx.directory, { recursive: true, force: true });
  }
});

await test('records deleted or disputed while embedding is in flight are not returned', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    seedMaterial(database, alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });
    let release;
    const provider = semanticProvider({ delayDocument: () => new Promise(resolve => { release = resolve; }) });
    const retrieve = createCandidateRetrieval(database, { embeddingProvider: provider });
    const pending = retrieve({ userId: alice.id, candidateId: candidate.id, query: 'front-end framework' });
    await Promise.resolve();
    database.deleteDocument(alice.id, 'doc-main');
    release();

    const pack = await pending;

    assert.deepEqual(pack.facts, []);
    assert.deepEqual(pack.passages, []);
    assert.equal(pack.coverage.semantic.status, 'success');
    assert.equal(database.raw.prepare('SELECT count(*) AS count FROM semantic_embedding_cache').get().count, 0);
  });
});

await test('lexical hits are revalidated after semantic await before fusion', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    seedMaterial(database, alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });
    let release;
    const provider = semanticProvider({ delayDocument: () => new Promise(resolve => { release = resolve; }) });
    const retrieve = createCandidateRetrieval(database, { embeddingProvider: provider });
    const pending = retrieve({ userId: alice.id, candidateId: candidate.id, query: 'React' });
    await Promise.resolve();
    database.deleteDocument(alice.id, 'doc-main');
    release();

    const pack = await pending;

    assert.deepEqual(pack.facts, []);
    assert.deepEqual(pack.passages, []);
  });
});

await test('facts disputed while embedding is in flight are removed from lexical and semantic results', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    seedMaterial(database, alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });
    let release;
    const provider = semanticProvider({ delayDocument: () => new Promise(resolve => { release = resolve; }) });
    const pending = createCandidateRetrieval(database, { embeddingProvider: provider })({ userId: alice.id, candidateId: candidate.id, query: 'React' });
    await Promise.resolve();
    database.raw.prepare("UPDATE candidate_facts SET status='disputed' WHERE id='fact-react'").run();
    release();

    const pack = await pending;

    assert.deepEqual(pack.facts, []);
    assert.deepEqual(pack.passages, []);
    assert.equal(database.raw.prepare('SELECT count(*) AS count FROM semantic_embedding_cache').get().count, 0);
  });
});

await test('bad vectors and provider errors are reported honestly while lexical evidence remains available', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    seedMaterial(database, alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });

    const badPack = await createCandidateRetrieval(database, { embeddingProvider: semanticProvider({ badVectorFor: 'GreenSteps' }) })({ userId: alice.id, candidateId: candidate.id, query: 'React' });
    assert.equal(badPack.coverage.semantic.status, 'failed');
    assert.ok(badPack.facts.some(fact => fact.factId === 'fact-react'));

    const failedPack = await createCandidateRetrieval(database, { embeddingProvider: semanticProvider({ failOn: 'document' }) })({ userId: alice.id, candidateId: candidate.id, query: 'React' });
    assert.equal(failedPack.coverage.semantic.status, 'failed');
    assert.equal(failedPack.coverage.semantic.error, 'semantic embedding unavailable');
    assert.doesNotMatch(JSON.stringify(failedPack.coverage.semantic), /secret-token|13800138000|provider failed/);
    assert.ok(failedPack.facts.some(fact => fact.factId === 'fact-react'));
  });
});

await test('vectors must be strict finite numbers, not numeric strings or coerced values', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    seedMaterial(database, alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });

    const pack = await createCandidateRetrieval(database, { embeddingProvider: semanticProvider({ invalidVectorFor: 'GreenSteps' }) })({ userId: alice.id, candidateId: candidate.id, query: 'React' });

    assert.equal(pack.coverage.semantic.status, 'failed');
    assert.equal(pack.coverage.semantic.error, 'semantic embedding unavailable');
    assert.ok(pack.facts.some(fact => fact.factId === 'fact-react'));
    for (const vector of [[true, 0, 0], [null, 1, 0], [0, 0, 0], [Number.MAX_VALUE, Number.MAX_VALUE]]) {
      const provider = { id: 'bad-vector', embed: async ({ purpose, texts }) => texts.map(() => purpose === 'query' ? [1, 0, 0] : vector) };
      const invalid = await createCandidateRetrieval(database, { embeddingProvider: provider })({ userId: alice.id, candidateId: candidate.id, query: 'React' });
      assert.equal(invalid.coverage.semantic.status, 'failed');
    }
    const longId = semanticProvider({ id: 'x'.repeat(161) });
    const rejected = await createCandidateRetrieval(database, { embeddingProvider: longId })({ userId: alice.id, candidateId: candidate.id, query: 'React' });
    assert.equal(rejected.coverage.semantic.status, 'failed');
    assert.equal(longId.calls.length, 0);
  });
});

await test('abort propagates instead of being reported as semantic failure', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    seedMaterial(database, alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });
    const controller = new AbortController();
    const provider = semanticProvider({ delayDocument: async () => controller.abort() });
    const retrieve = createCandidateRetrieval(database, { embeddingProvider: provider });

    await assert.rejects(() => retrieve({ userId: alice.id, candidateId: candidate.id, query: 'front-end framework', signal: controller.signal }), /abort/i);
  });
});

await test('provider abort-like errors cannot leak through cancellation or bypass lexical fallback', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, 'Fixture');
    seedMaterial(database, alice.id, candidate.id, { text: 'React', facts: [{ id: 'f', value: 'React' }], chunks: [] });
    for (const error of [new Error('upstream aborted; credential=synthetic-secret'), new DOMException('synthetic-secret', 'AbortError')]) {
      const provider = { id: 'provider-abort-fixture', embed: async () => { throw error; } };
      const pack = await createCandidateRetrieval(database, { embeddingProvider: provider })({ userId: alice.id, candidateId: candidate.id, query: 'React' });
      assert.equal(pack.coverage.semantic.status, 'failed');
      assert.doesNotMatch(JSON.stringify(pack.coverage), /synthetic-secret|upstream/);
      assert.equal(pack.facts[0]?.factId, 'f');
    }
    const controller = new AbortController();
    const provider = { id: 'provider-cancel', embed: async () => { controller.abort(new Error('synthetic-secret')); controller.signal.throwIfAborted(); } };
    await assert.rejects(createCandidateRetrieval(database, { embeddingProvider: provider })({ userId: alice.id, candidateId: candidate.id, query: 'React', signal: controller.signal }), error => {
      assert.equal(error.name, 'AbortError');
      assert.doesNotMatch(String(error.stack), /synthetic-secret/);
      assert.equal(error.cause, undefined);
      return true;
    });
  });
});

await test('semantic fusion deduplicates hybrid hits and keeps pack bounds explicit', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    const entries = Array.from({ length: 20 }, (_, index) => `GreenSteps ${index} 使用 React 构建 SPA`);
    seedMaterial(database, alice.id, candidate.id, {
      text: entries.join('\n'),
      facts: entries.map((value, index) => ({ id: `fact-${index}`, value })),
      chunks: entries.map((text, index) => ({ id: `chunk-${index}`, text }))
    });
    const pack = await createCandidateRetrieval(database, { embeddingProvider: semanticProvider() })({
      userId: alice.id,
      candidateId: candidate.id,
      query: 'React',
      bounds: { scan: 30, facts: 3, passages: 2, factChars: 320, passageChars: 600, totalChars: 4000 }
    });

    assert.equal(new Set(pack.facts.map(fact => fact.factId)).size, pack.facts.length);
    assert.equal(new Set(pack.passages.map(passage => passage.chunkId)).size, pack.passages.length);
    assert.equal(pack.facts.length, 3);
    assert.equal(pack.passages.length, 2);
    assert.equal(pack.coverage.truncated, true);
    assert.equal(pack.coverage.semantic.truncated, false);
  });
});

await test('semantic cache writes require current ownership and matching active record hash', async () => {
  await withFixture(async ({ database, alice, bob }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    seedMaterial(database, alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });
    const [record] = database.listSemanticCandidateRecords(alice.id, candidate.id);

    assert.throws(() => database.saveSemanticEmbeddingCache(bob.id, candidate.id, 'provider-a', record, [1, 0, 0]), /求职者不存在|不属于当前用户/);
    assert.throws(() => database.getSemanticEmbeddingCache(bob.id, candidate.id, 'provider-a', record.kind, record.refId, record.contentHash), /求职者不存在|不属于当前用户/);
    assert.throws(() => database.pruneSemanticEmbeddingCache(bob.id, candidate.id, 'provider-a', []), /求职者不存在|不属于当前用户/);
    assert.throws(() => database.saveSemanticEmbeddingCache(alice.id, candidate.id, 'provider-a', record, ['1', 0, 0]), /向量无效/);

    const changed = 'GreenSteps 项目使用 React 构建 SPA';
    seedMaterial(database, alice.id, candidate.id, { documentId: 'doc-main', text: changed, facts: [{ id: 'fact-react', value: changed }], chunks: [{ id: 'chunk-react', text: changed }] });
    assert.throws(() => database.saveSemanticEmbeddingCache(alice.id, candidate.id, 'provider-a', record, [1, 0, 0]), /语义缓存记录已失效/);
  });
});

await test('semantic cache is isolated by provider namespace', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    seedMaterial(database, alice.id, candidate.id, { text: 'GreenSteps 项目使用 React', facts: [{ id: 'fact-react', value: 'GreenSteps 项目使用 React' }], chunks: [{ id: 'chunk-react', text: 'GreenSteps 项目使用 React' }] });
    await createCandidateRetrieval(database, { embeddingProvider: semanticProvider({ id: 'provider-a' }) })({ userId: alice.id, candidateId: candidate.id, query: 'front-end framework' });

    const providerB = semanticProvider({ id: 'provider-b' });
    await createCandidateRetrieval(database, { embeddingProvider: providerB })({ userId: alice.id, candidateId: candidate.id, query: 'front-end framework' });

    assert.equal(providerB.calls.filter(call => call.purpose === 'document').length, 1);
  });
});

await test('semantic retrieval scans beyond 256 facts and still recalls source passages in bounded batches', async () => {
  await withFixture(async ({ database, alice, bob }) => {
    const candidate = database.createCandidate(alice.id, 'Large background');
    const distractors = Array.from({ length: 260 }, (_, index) => `SQLite storage record ${index}`);
    const target = 'GreenSteps 使用 React 构建 SPA';
    seedMaterial(database, alice.id, candidate.id, {
      text: [...distractors, target].join('\n'),
      facts: [...distractors.map((value, index) => ({ id: `filler-${index}`, value })), { id: 'late-target', value: target }],
      chunks: [{ id: 'late-passage', text: target }]
    });
    const foreign = database.createCandidate(bob.id, 'Foreign');
    seedMaterial(database, bob.id, foreign.id, {
      documentId: 'foreign-doc', text: 'GreenSteps foreign private record',
      facts: [{ id: 'foreign-fact', value: 'GreenSteps foreign private record' }], chunks: []
    });
    const provider = semanticProvider();
    const pack = await createCandidateRetrieval(database, { embeddingProvider: provider })({
      userId: alice.id, candidateId: candidate.id, query: 'front-end framework'
    });
    assert.equal(pack.coverage.semantic.indexedCount, 262);
    assert.equal(pack.facts[0]?.factId, 'late-target');
    assert.equal(pack.passages[0]?.chunkId, 'late-passage');
    assert.ok(provider.calls.filter(call => call.purpose === 'document').every(call => call.texts.length <= 32));
    assert.equal(provider.calls.flatMap(call => call.texts).some(text => text.includes('foreign private')), false);
    assert.equal(database.raw.prepare('SELECT COUNT(*) AS n FROM semantic_embedding_cache WHERE user_id=? AND candidate_id=?').get(alice.id, candidate.id).n, 262);

    const hot = semanticProvider();
    const ranked = await searchSemanticCandidateKnowledge(database, {
      userId: alice.id, candidateId: candidate.id, query: 'front-end framework', embeddingProvider: hot, limit: 1
    });
    assert.equal(ranked.indexedCount, 262, 'the output limit must not limit corpus coverage');
    assert.equal(ranked.facts[0]?.id, 'late-target');
    assert.equal(ranked.chunks[0]?.id, 'late-passage');
    assert.equal(hot.calls.filter(call => call.purpose === 'document').length, 0, 'later-page cache entries survive subsequent queries');
  });
});

await test('invalid provenance in an entire first page does not hide valid later records', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, 'Sparse valid evidence');
    const values = Array.from({ length: 260 }, (_, index) => `SQLite invalid record ${index}`);
    const target = 'GreenSteps 使用 React';
    seedMaterial(database, alice.id, candidate.id, {
      text: [...values, target].join('\n'),
      facts: [...values.map((value, index) => ({ id: `invalid-${index}`, value })), { id: 'valid-late', value: target }], chunks: []
    });
    database.raw.prepare("UPDATE candidate_facts SET source_quote='not in source' WHERE id LIKE 'invalid-%'").run();
    const provider = semanticProvider();
    const result = await searchSemanticCandidateKnowledge(database, {
      userId: alice.id, candidateId: candidate.id, query: 'front-end framework', embeddingProvider: provider
    });
    assert.equal(result.status, 'success');
    assert.equal(result.facts[0]?.id, 'valid-late');
    assert.equal(provider.calls.flatMap(call => call.texts).some(text => text.includes('invalid record')), false);
  });
});

await test('cache pruning checks authoritative provenance rather than membership in a partial page', async () => {
  await withFixture(async ({ database, alice }) => {
    const candidate = database.createCandidate(alice.id, 'Paged cache');
    const value = 'GreenSteps 使用 React';
    seedMaterial(database, alice.id, candidate.id, {
      text: value, facts: [{ id: 'cached-fact', value }], chunks: [{ id: 'cached-chunk', text: value }]
    });
    const records = database.listSemanticCandidateRecords(alice.id, candidate.id);
    for (const record of records) database.saveSemanticEmbeddingCache(alice.id, candidate.id, 'paged-cache', record, [1, 0, 0]);
    database.pruneSemanticEmbeddingCache(alice.id, candidate.id, 'paged-cache', records.slice(0, 1));
    assert.equal(database.raw.prepare('SELECT COUNT(*) AS n FROM semantic_embedding_cache').get().n, 2);
    database.deleteDocument(alice.id, 'doc-main');
    database.pruneSemanticEmbeddingCache(alice.id, candidate.id, 'paged-cache', []);
    assert.equal(database.raw.prepare('SELECT COUNT(*) AS n FROM semantic_embedding_cache').get().n, 0);
  });
});
