// Candidate evidence retrieval for the Primary Career Agent.
//
// Isolation is an application invariant, not a model decision: every read is
// scoped by the user_id + candidate_id the server supplies, and the Agent tool
// surface never exposes those fields. A wrong scope must raise a real error;
// only a correctly scoped query with no matches may return an empty pack.

import { fuseCandidateKnowledge, searchSemanticCandidateKnowledge } from './semanticRetrieval.js';

export const FACT_TYPES = [
  'identity', 'contact', 'education', 'experience',
  'project', 'skill', 'achievement', 'metric', 'career_preference'
];

export const EVIDENCE_BOUNDS = {
  // Retrieval reads this many rows per store, then the pack is cut to the
  // smaller limits below so the Agent never receives the whole Candidate KB.
  scan: 30,
  facts: 8,
  passages: 4,
  factChars: 320,
  passageChars: 600,
  totalChars: 4000
};

// PRD 5.4 "Structured Fact Search". A question like 我的项目经历 names a kind of
// fact rather than a keyword, and section headings are never stored as facts, so
// without this a perfectly reasonable question would match nothing.
const TYPE_ALIASES = {
  identity: ['姓名', '名字', '个人信息'],
  contact: ['联系方式', '电话', '邮箱', '手机'],
  education: ['教育', '学历', '学校', '大学', '本科', '硕士', '博士', '专业', '毕业'],
  experience: ['实习', '工作经历', '工作经验', '公司', '职责', '任职'],
  project: ['项目', '作品', '系统', '平台'],
  skill: ['技能', '技术栈', '技术', '工具', '语言'],
  achievement: ['奖项', '荣誉', '获奖', '奖学金', '证书'],
  metric: ['指标', '数字', '量化', '成果', '提升'],
  career_preference: ['期望', '意向', '偏好', '目标岗位']
};

export function hintedFactTypes(query = '') {
  const text = String(query);
  return Object.entries(TYPE_ALIASES)
    .filter(([, aliases]) => aliases.some(alias => text.includes(alias)))
    .map(([type]) => type);
}

export function createCandidateRetrieval(database, { embeddingProvider = null } = {}) {
  return function retrieveCandidateEvidence({ userId, candidateId, query = '', type = null, bounds = EVIDENCE_BOUNDS, signal } = {}) {
    const owner = requireScope(userId, 'userId');
    const scopeId = requireScope(candidateId, 'candidateId');
    const text = String(query ?? '').trim();
    if (!text) throw new Error('检索关键词为空。请用一个具体的关键词、项目名或技术名再检索一次。');
    // Ownership check: another user's candidateId is a failure, not an empty result.
    const candidate = database.getCandidate(owner, scopeId);
    if (!candidate) throw new Error('求职者不存在或不属于当前账号，无法检索个人背景。');

    if (!embeddingProvider) return assembleEvidencePack({ database, owner, scopeId, candidate, text, type, bounds, semantic: { status: 'unconfigured' } });
    return retrieveWithSemantic({ database, owner, scopeId, candidate, text, type, bounds, embeddingProvider, signal });
  };
}

async function retrieveWithSemantic({ database, owner, scopeId, candidate, text, type, bounds, embeddingProvider, signal }) {
  const semantic = await searchSemanticCandidateKnowledge(database, { userId: owner, candidateId: scopeId, query: text, embeddingProvider, signal });
  signal?.throwIfAborted();
  if (!database.getCandidate(owner, scopeId)) throw new Error('求职者不存在或不属于当前账号，无法检索个人背景。');
  // An async provider may have overlapped a source deletion or dispute. Fetch
  // lexical evidence now as well, rather than fusing a pre-await snapshot.
  const lexical = database.searchCandidateKnowledge(owner, scopeId, text, bounds.scan, { hintedTypes: hintedFactTypes(text) });
  const found = fuseCandidateKnowledge(lexical, semantic);
  return assembleEvidencePack({ database, owner, scopeId, candidate, text, type, bounds, found, semantic: semanticCoverage(semantic) });
}

function assembleEvidencePack({ database, owner, scopeId, candidate, text, type, bounds, found = null, semantic = { status: 'unconfigured' } }) {
    const documents = candidateDocuments(database, owner, scopeId);
    const lexical = found || database.searchCandidateKnowledge(owner, scopeId, text, bounds.scan, { hintedTypes: hintedFactTypes(text) });
    const facts = (type ? lexical.facts.filter(fact => fact.type === type) : lexical.facts);
    const limit = { ...bounds };
    let budget = limit.totalChars;
    const passageReserve = reservePassageBudget(limit, lexical.chunks.length);
    let factBudget = Math.max(0, budget - passageReserve);
    let truncated = false;

    const pickedFacts = [];
    for (const fact of facts) {
      if (pickedFacts.length >= limit.facts) { truncated = facts.length > pickedFacts.length; break; }
      const entry = {
        factId: fact.id,
        type: fact.type,
        value: clip(fact.value, limit.factChars),
        sourceQuote: clip(fact.sourceQuote, limit.factChars),
        sourceType: fact.sourceType,
        sourceConversationId: fact.sourceType === 'user_asserted' ? fact.sourceId : null,
        sourceMessageId: fact.sourceMessageId || null,
        sourcePosition: fact.sourcePosition,
        confidence: fact.confidence,
        status: fact.status,
        documentId: fact.sourceType === 'document' ? fact.sourceId : null,
        documentName: documents.get(fact.sourceId)?.name || null
      };
      const cost = entry.value.length + entry.sourceQuote.length;
      if (cost > budget || cost > factBudget) { truncated = true; break; }
      budget -= cost;
      factBudget -= cost;
      pickedFacts.push(entry);
    }

    const pickedPassages = [];
    for (const chunk of lexical.chunks) {
      if (pickedPassages.length >= limit.passages) { truncated = truncated || lexical.chunks.length > pickedPassages.length; break; }
      const entry = {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentName: documents.get(chunk.documentId)?.name || null,
        text: clip(chunk.text, limit.passageChars),
        start: chunk.start,
        end: chunk.end
      };
      if (entry.text.length > budget) { truncated = true; break; }
      budget -= entry.text.length;
      pickedPassages.push(entry);
    }

    const used = new Set([...pickedFacts.map(fact => fact.documentId), ...pickedPassages.map(passage => passage.documentId)]);
    const sources = [...used].map(id => documents.get(id)).filter(Boolean).map(document => ({
      documentId: document.id,
      name: document.name,
      // Distinguish complete / partial / unreadable reading (DESIGN.md §5).
      status: document.parseStatus?.status || null,
      reading: document.parseStatus?.extraction?.status || null
    }));

    return {
      candidate: { id: candidate.id, name: candidate.name },
      query: text,
      facts: pickedFacts,
      passages: pickedPassages,
      sources,
      coverage: {
        factCount: pickedFacts.length,
        passageCount: pickedPassages.length,
        truncated,
        semantic,
        note: pickedFacts.length || pickedPassages.length
          ? '以下证据只来自当前求职者的材料。引用经历、技术或数字时必须保留 sourceQuote 与 documentName。'
          : '当前求职者的材料中没有匹配到证据。不要据此补写经历，也不要使用其他求职者或岗位要求的内容。'
      }
    };
}

function reservePassageBudget(limit, chunkCount) {
  const passageSlots = Math.min(Number(limit.passages) || 0, chunkCount);
  if (!passageSlots) return 0;
  const slots = Math.max(1, (Number(limit.facts) || 0) + (Number(limit.passages) || 0));
  const fairSlot = Math.floor((Number(limit.totalChars) || 0) / slots);
  return passageSlots * Math.min(Number(limit.passageChars) || 0, fairSlot);
}

function semanticCoverage(semantic) {
  return {
    status: semantic.status,
    providerId: semantic.providerId || null,
    indexedCount: semantic.indexedCount || 0,
    usedCount: semantic.usedCount || 0,
    truncated: Boolean(semantic.truncated),
    error: semantic.status === 'failed' ? semantic.error || 'semantic retrieval failed' : undefined
  };
}

function candidateDocuments(database, userId, candidateId) {
  const documents = new Map();
  for (const document of database.listDocuments(userId)) {
    if (document.candidateId === candidateId) documents.set(document.id, document);
  }
  return documents;
}

function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function requireScope(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`个人背景检索缺少 ${field}，已拒绝执行。`);
  return text;
}
