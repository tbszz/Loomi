import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../server/database.js';
import { createCandidateRetrieval } from '../server/candidateRetrieval.js';
import { searchSemanticCandidateKnowledge } from '../server/semanticRetrieval.js';
import { createConfiguredEmbeddingProvider } from '../server/embeddingClient.js';

// Synthetic material only. A small rank/recall gate, not universal model quality.
const corpus = [
  ['ui', 'React 组件及单页应用。 Built responsive screens with reusable UI components.'],
  ['storage', 'SQLite 使用 B 树索引和 SQL 执行计划。 Tuned indexed queries.'],
  ['editorial', '公众号选题与文章撰写。 Wrote editorial calendars and newsletters.'],
  ['shipping', '仓库盘点与配送排班。 Counted stock and arranged shipping shifts.']
];
const golden = [
  ['ui', '交互式界面搭建'], ['storage', '关系存储检索加速'], ['editorial', '读者增长传播策划'],
  ['ui', 'browser interface construction'], ['storage', 'relational persistence optimization'], ['editorial', 'audience outreach storytelling']
];
const rank = (rows, key, value) => { const index = rows.findIndex(row => row[key] === value); return index < 0 ? null : index + 1; };
const namespaceHash = value => createHash('sha256').update(String(value)).digest('hex');
const scoreMargin = (rows, id) => {
  const score = rows.find(row => row.id === id)?.semanticScore ?? null;
  const competitor = Math.max(0.35, ...rows.filter(row => row.id !== id).map(row => row.semanticScore));
  return { score, margin: score === null ? null : score - competitor };
};

export async function runEmbeddingAcceptance({ embeddingProvider } = {}) {
  if (!embeddingProvider) return { status: 'unconfigured', failures: ['embedding_not_configured'], cases: [] };
  const report = { status: 'failed', providerNamespaceHash: namespaceHash(embeddingProvider.id), scope: {}, cache: {}, revocation: {}, cases: [], failures: [] };
  const directory = mkdtempSync(path.join(os.tmpdir(), 'resume-real-embedding-'));
  const filename = path.join(directory, 'acceptance.sqlite');
  let database;
  const counts = { query: 0, document: 0, calls: 0, foreign: 0 };
  const provider = {
    id: embeddingProvider.id,
    async embed(input) {
      counts.calls += 1;
      if (input.purpose === 'query') counts.query += 1;
      if (input.purpose === 'document') counts.document += input.texts.length;
      counts.foreign += input.texts.filter(text => text.includes('PRIVATE_FOREIGN_MARKER')).length;
      return embeddingProvider.embed(input);
    }
  };
  const addFailure = code => { if (!report.failures.includes(code)) report.failures.push(code); };
  try {
    database = createDatabase({ filename });
    const owner = database.createUser({ email: 'embedding-owner@example.test', name: 'Synthetic owner', passwordHash: 'not-a-login' });
    const foreign = database.createUser({ email: 'embedding-foreign@example.test', name: 'Synthetic foreign', passwordHash: 'not-a-login' });
    const candidate = database.createCandidate(owner.id, 'Synthetic candidate');
    const otherCandidate = database.createCandidate(owner.id, 'Synthetic other candidate');
    const foreignCandidate = database.createCandidate(foreign.id, 'Synthetic foreign candidate');
    const seed = (userId, candidateId, id, text) => {
      const conversationId = `conversation-${id}`;
      database.saveConversation(userId, { id: conversationId, candidateId, title: 'Synthetic material', messages: [], context: {} });
      const document = database.saveDocument(userId, { id: `document-${id}`, candidateId, conversationId, name: `${id}.txt`, mimeType: 'text/plain', text });
      database.saveCandidateMaterial(userId, candidateId, document,
        [{ id: `fact-${id}`, type: 'project', value: text, sourceQuote: text, sourcePosition: 0, status: 'verified', confidence: 1 }],
        [{ id: `chunk-${id}`, text, start: 0, end: text.length }]);
    };
    corpus.forEach(([id, text]) => seed(owner.id, candidate.id, id, text));
    seed(owner.id, otherCandidate.id, 'other', 'PRIVATE_FOREIGN_MARKER other candidate');
    seed(foreign.id, foreignCandidate.id, 'foreign', 'PRIVATE_FOREIGN_MARKER other owner');
    let retrieve = createCandidateRetrieval(database, { embeddingProvider: provider });
    const scope = { userId: owner.id, candidateId: candidate.id };
    const beforeUnauthorized = counts.calls;
    await assert.rejects(async () => retrieve({ userId: foreign.id, candidateId: candidate.id, query: golden[0][1] }));
    await assert.rejects(async () => retrieve({ userId: owner.id, candidateId: foreignCandidate.id, query: golden[0][1] }));
    report.scope.unauthorizedProviderCalls = counts.calls - beforeUnauthorized;
    assert.equal(report.scope.unauthorizedProviderCalls, 0);

    for (const [id, query] of golden) {
      const start = performance.now();
      const lexical = database.searchCandidateKnowledge(owner.id, candidate.id, query, 30);
      const semantic = await searchSemanticCandidateKnowledge(database, { ...scope, query, embeddingProvider: provider });
      if (semantic.status !== 'success') { addFailure('embedding_unavailable'); return report; }
      const pack = await retrieve({ ...scope, query });
      if (pack.coverage.semantic.status !== 'success') { addFailure('embedding_unavailable'); return report; }
      const { score, margin } = scoreMargin(semantic.facts, `fact-${id}`);
      const { score: passageScore, margin: passageMargin } = scoreMargin(semantic.chunks, `chunk-${id}`);
      const item = {
        topic: id, query,
        semanticFactRank: rank(semantic.facts, 'id', `fact-${id}`), semanticPassageRank: rank(semantic.chunks, 'id', `chunk-${id}`),
        unifiedFactRank: rank(pack.facts, 'factId', `fact-${id}`), unifiedPassageRank: rank(pack.passages, 'chunkId', `chunk-${id}`),
        lexicalTargetHits: lexical.facts.filter(row => row.id === `fact-${id}`).length + lexical.chunks.filter(row => row.id === `chunk-${id}`).length,
        score, margin, passageScore, passageMargin, latencyMs: performance.now() - start
      };
      assert.ok(Number.isFinite(item.latencyMs));
      assert.ok(score === null || Number.isFinite(score));
      assert.ok(margin === null || Number.isFinite(margin));
      assert.ok(passageScore === null || Number.isFinite(passageScore));
      assert.ok(passageMargin === null || Number.isFinite(passageMargin));
      report.cases.push(item);
      if (item.lexicalTargetHits !== 0 || item.semanticFactRank !== 1 || item.semanticPassageRank !== 1 || item.unifiedFactRank !== 1 || item.unifiedPassageRank !== 1 || margin === null || margin < 0.03 || passageMargin === null || passageMargin < 0.03) addFailure('semantic_quality');
      assert.ok(pack.facts.every(row => row.documentId.startsWith('document-') && corpus.some(([topic]) => row.documentId === `document-${topic}`)));
      assert.ok(pack.facts.every(row => row.sourceQuote === row.value && row.sourcePosition === 0));
      assert.ok(pack.passages.every(row => corpus.some(([topic, text]) => row.chunkId === `chunk-${topic}` && row.text === text)));
    }

    const cacheCount = () => Number(database.raw.prepare('SELECT COUNT(*) AS count FROM semantic_embedding_cache WHERE user_id=? AND candidate_id=? AND provider_id=?').get(owner.id, candidate.id, provider.id).count);
    report.cache.documentTextsBeforeRestart = counts.document;
    report.cache.persistedRows = cacheCount();
    assert.equal(report.cache.persistedRows, 8);
    database.close(); database = null;
    database = createDatabase({ filename });
    assert.equal(cacheCount(), report.cache.persistedRows);
    retrieve = createCandidateRetrieval(database, { embeddingProvider: provider });
    const beforeRestart = { ...counts };
    const restartSemantic = await searchSemanticCandidateKnowledge(database, { ...scope, query: golden[0][1], embeddingProvider: provider });
    const restartPack = await retrieve({ ...scope, query: golden[0][1] });
    assert.equal(restartSemantic.status, 'success');
    assert.equal(restartPack.coverage.semantic.status, 'success');
    assert.ok(restartPack.facts.some(row => row.factId === 'fact-ui'));
    report.cache.documentTextsAfterRestart = counts.document - beforeRestart.document;
    report.cache.queryCallsAfterRestart = counts.query - beforeRestart.query;
    assert.equal(report.cache.documentTextsAfterRestart, 0);
    assert.equal(report.cache.queryCallsAfterRestart, 2);

    database.deleteDocument(owner.id, 'document-ui');
    const revokedSemantic = await searchSemanticCandidateKnowledge(database, { ...scope, query: golden[0][1], embeddingProvider: provider });
    const revokedPack = await retrieve({ ...scope, query: golden[0][1] });
    assert.equal(revokedSemantic.status, 'success');
    assert.equal(revokedPack.coverage.semantic.status, 'success');
    report.revocation.staleEvidence = revokedSemantic.facts.filter(row => row.id === 'fact-ui').length + revokedSemantic.chunks.filter(row => row.id === 'chunk-ui').length + revokedPack.facts.filter(row => row.factId === 'fact-ui').length + revokedPack.passages.filter(row => row.chunkId === 'chunk-ui').length;
    report.revocation.staleCacheRows = Number(database.raw.prepare("SELECT COUNT(*) AS count FROM semantic_embedding_cache WHERE ref_id IN ('fact-ui','chunk-ui')").get().count);
    report.revocation.remainingCacheRows = cacheCount();
    assert.equal(report.revocation.staleEvidence, 0);
    assert.equal(report.revocation.staleCacheRows, 0);
    assert.equal(report.revocation.remainingCacheRows, 6);
    report.scope.foreignDocumentTexts = counts.foreign;
    assert.equal(counts.foreign, 0);
    if (!report.failures.length) report.status = 'passed';
    return report;
  } catch {
    addFailure('acceptance_invariant_failed');
    return report;
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let report;
  try { report = await runEmbeddingAcceptance({ embeddingProvider: createConfiguredEmbeddingProvider(process.env) }); }
  catch { report = { status: 'invalid_configuration', failures: ['embedding_configuration_invalid'], cases: [] }; }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
