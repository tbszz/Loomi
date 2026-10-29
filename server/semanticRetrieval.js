const MAX_SEMANTIC_RESULTS = 256;
const EMBED_BATCH_SIZE = 32;
const MIN_COSINE = 0.35;

export async function searchSemanticCandidateKnowledge(database, {
  userId,
  candidateId,
  query,
  embeddingProvider,
  signal,
  limit = MAX_SEMANTIC_RESULTS
} = {}) {
  if (!embeddingProvider) return { status: 'unconfigured', providerId: null, facts: [], chunks: [], indexedCount: 0, usedCount: 0, truncated: false };
  let providerId = null;
  try {
    providerId = requireProviderId(embeddingProvider);
    signal?.throwIfAborted();
    const cap = Math.min(MAX_SEMANTIC_RESULTS, Math.max(1, Math.floor(Number(limit) || MAX_SEMANTIC_RESULTS)));
    const records = database.iterateSemanticCandidateRecords(userId, candidateId);
    const first = records.next();
    database.pruneSemanticEmbeddingCache(userId, candidateId, providerId);
    if (first.done) return { status: 'success', providerId, facts: [], chunks: [], indexedCount: 0, usedCount: 0, truncated: false };

    const [queryVector] = validateVectors(await embeddingProvider.embed({ texts: [String(query || '')], purpose: 'query', signal }), 1);
    signal?.throwIfAborted();

    let indexedCount = 0;
    let batch = [];
    async function embedBatch() {
      if (!batch.length) return;
      const vectors = validateVectors(await embeddingProvider.embed({ texts: batch.map(record => record.content), purpose: 'document', signal }), batch.length, queryVector.length);
      signal?.throwIfAborted();
      for (let index = 0; index < batch.length; index += 1) {
        if (!database.isSemanticCandidateRecordCurrent(userId, candidateId, batch[index])) continue;
        database.saveSemanticEmbeddingCache(userId, candidateId, providerId, batch[index], vectors[index]);
      }
      batch = [];
    }
    let entry = first;
    while (!entry.done) {
      signal?.throwIfAborted();
      const record = entry.value;
      indexedCount += 1;
      const cached = database.getSemanticEmbeddingCache(userId, candidateId, providerId, record.kind, record.refId, record.contentHash);
      if (cached?.vector) {
        validateVector(cached.vector, queryVector.length);
      } else {
        batch.push(record);
      }
      if (batch.length === EMBED_BATCH_SIZE) await embedBatch();
      entry = records.next();
    }
    await embedBatch();

    database.pruneSemanticEmbeddingCache(userId, candidateId, providerId);
    const ranked = { fact: [], chunk: [] };
    let truncated = false;
    // Re-read after every provider await has finished. Only current source-backed
    // records can score, and only one page/batch plus bounded top-k stays in RAM.
    for (const record of database.iterateSemanticCandidateRecords(userId, candidateId)) {
      signal?.throwIfAborted();
      const cached = database.getSemanticEmbeddingCache(userId, candidateId, providerId, record.kind, record.refId, record.contentHash);
      if (!cached?.vector) continue;
      const vector = validateVector(cached.vector, queryVector.length);
      const score = cosine(queryVector, vector);
      if (score < MIN_COSINE) continue;
      const top = ranked[record.kind];
      top.push({ record, score });
      top.sort((left, right) => right.score - left.score || recordKey(left.record).localeCompare(recordKey(right.record)));
      if (top.length > cap) { top.pop(); truncated = true; }
    }

    const facts = ranked.fact.map(item => ({ ...item.record.fact, score: item.score, semanticScore: item.score }));
    const chunks = ranked.chunk.map(item => ({ ...item.record.chunk, score: item.score, semanticScore: item.score }));
    return {
      status: 'success',
      providerId,
      facts,
      chunks,
      indexedCount,
      usedCount: facts.length + chunks.length,
      truncated
    };
  } catch (error) {
    // Upstream messages (including text containing "abort") are untrusted.
    // Only the caller's signal cancels this search; never expose its reason.
    if (signal?.aborted) throw new DOMException('Candidate retrieval aborted.', 'AbortError');
    return { status: 'failed', providerId, facts: [], chunks: [], indexedCount: 0, usedCount: 0, truncated: false, error: 'semantic embedding unavailable' };
  }
}

export function fuseCandidateKnowledge(lexical, semantic) {
  if (!semantic || semantic.status !== 'success') return lexical;
  return {
    facts: reciprocalRankFusion(lexical.facts || [], semantic.facts || [], row => row.id),
    chunks: reciprocalRankFusion(lexical.chunks || [], semantic.chunks || [], row => row.id)
  };
}

function reciprocalRankFusion(primary, secondary, idOf) {
  const rows = new Map();
  const add = (items, weight) => {
    items.forEach((item, index) => {
      const id = idOf(item);
      if (!id) return;
      const previous = rows.get(id);
      const score = weight / (60 + index + 1);
      if (previous) {
        previous.score += score;
        if ((item.semanticScore || 0) > (previous.item.semanticScore || 0)) previous.item = { ...previous.item, ...item };
      } else {
        rows.set(id, { item, score });
      }
    });
  };
  add(primary, 1);
  add(secondary, 1);
  return [...rows.values()].sort((left, right) => right.score - left.score).map(row => ({ ...row.item, score: row.score }));
}

function requireProviderId(provider) {
  const id = String(provider?.id || '').trim();
  if (!/^[A-Za-z0-9_.:/-]{1,160}$/.test(id) || typeof provider?.embed !== 'function') throw new Error('语义检索 provider 未正确配置。');
  return id;
}

function validateVectors(vectors, expectedCount, expectedDims = null) {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) throw new Error('embedding provider 返回数量不一致。');
  return vectors.map(vector => validateVector(vector, expectedDims));
}

function validateVector(vector, expectedDims = null) {
  if (!Array.isArray(vector) || !vector.length || vector.length > 16384 || (expectedDims && vector.length !== expectedDims)) throw new Error('embedding provider 返回维度不一致。');
  if (vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('embedding provider 返回非数值向量。');
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('embedding provider 返回无效向量。');
  return vector.map(value => value / norm);
}

function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function recordKey(record) {
  return `${record.kind}:${record.refId}`;
}

