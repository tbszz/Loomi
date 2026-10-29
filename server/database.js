import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { FACT_TYPES } from "./candidateRetrieval.js";
import { verifyClaimEvidence } from './claimEvidence.js';
import { validFactSourceSpan } from './candidateKnowledge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

// Auto-created candidates carry this name until the first readable resume names them.
export const DEFAULT_CANDIDATE_NAME = "未命名求职者";

export function createDatabase({ filename } = {}) {
  const resolvedFilename = filename || path.join(process.env.RESUME_PROTOCOL_DATA_DIR || path.join(root, "data"), "resume-protocol.sqlite");
  mkdirSync(path.dirname(resolvedFilename), { recursive: true });

  const db = new DatabaseSync(resolvedFilename);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  let retrievalMode = migrate(db);

  return {
    raw: db,
    get retrievalMode() { return retrievalMode; },

    // Test/maintenance hook: force the FTS5 index path on or off. Turning it
    // off drops the index; turning it back on recreates and repopulates it
    // from the source tables.
    setRetrievalMode(mode) {
      if (mode === "fts5") {
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS candidate_knowledge_fts USING fts5(tokens, kind UNINDEXED, ref_id UNINDEXED)`);
        db.exec("DELETE FROM candidate_knowledge_fts");
        const insert = db.prepare("INSERT INTO candidate_knowledge_fts (kind, ref_id, tokens) VALUES (?, ?, ?)");
        for (const row of db.prepare("SELECT id, value FROM candidate_facts").all()) insert.run("fact", row.id, indexTokens(row.value).join(" "));
        for (const row of db.prepare("SELECT id, text FROM document_chunks").all()) insert.run("chunk", row.id, indexTokens(row.text).join(" "));
      } else if (mode === "fallback") {
        db.exec("DROP TABLE IF EXISTS candidate_knowledge_fts");
      } else {
        throw new Error("retrievalMode 必须是 fts5 或 fallback。");
      }
      retrievalMode = mode;
      return retrievalMode;
    },

    createUser({ email, name, passwordHash }) {
      const user = {
        id: randomUUID(),
        email: normalizeEmail(email),
        name: normalizeName(name),
        passwordHash: requireString(passwordHash, "passwordHash"),
        createdAt: nowIso()
      };
      db.prepare(`
        INSERT INTO users (id, email, name, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(user.id, user.email, user.name, user.passwordHash, user.createdAt);
      return publicUser(user);
    },

    getUserByEmail(email) {
      const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email));
      return row ? userFromRow(row) : null;
    },

    getUserById(id) {
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(requireString(id, "userId"));
      return row ? userFromRow(row) : null;
    },

    createSession(userId, tokenHash, expiresAt) {
      const session = {
        id: randomUUID(),
        userId: requireString(userId, "userId"),
        tokenHash: requireString(tokenHash, "tokenHash"),
        expiresAt: toMillis(expiresAt, "expiresAt"),
        createdAt: Date.now()
      };
      db.prepare(`
        INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(session.id, session.userId, session.tokenHash, session.expiresAt, session.createdAt);
      return session;
    },

    getSession(tokenHash) {
      const hash = requireString(tokenHash, "tokenHash");
      const row = db.prepare(`
        SELECT
          sessions.id AS session_id,
          sessions.user_id,
          sessions.token_hash,
          sessions.expires_at,
          sessions.created_at AS session_created_at,
          users.email,
          users.name,
          users.created_at AS user_created_at
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
      `).get(hash);
      if (!row) return null;
      if (Number(row.expires_at) <= Date.now()) {
        db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
        return null;
      }
      return {
        id: row.session_id,
        userId: row.user_id,
        tokenHash: row.token_hash,
        expiresAt: Number(row.expires_at),
        createdAt: Number(row.session_created_at),
        user: publicUser({
          id: row.user_id,
          email: row.email,
          name: row.name,
          createdAt: row.user_created_at
        })
      };
    },

    deleteSession(tokenHash) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(requireString(tokenHash, "tokenHash"));
    },

    // One live reset code per user: issuing a new one replaces the old.
    createPasswordReset(userId, codeHash, expiresAt) {
      const reset = { id: randomUUID(), userId: requireString(userId, "userId"), codeHash: requireString(codeHash, "codeHash"), expiresAt: toMillis(expiresAt, "expiresAt"), attempts: 0, createdAt: Date.now() };
      db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(reset.userId);
      db.prepare("INSERT INTO password_resets (id, user_id, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(reset.id, reset.userId, reset.codeHash, reset.expiresAt, reset.createdAt);
      return reset;
    },

    getPasswordReset(userId) {
      const row = db.prepare("SELECT * FROM password_resets WHERE user_id = ?").get(requireString(userId, "userId"));
      return row ? { id: row.id, userId: row.user_id, codeHash: row.code_hash, expiresAt: Number(row.expires_at), attempts: Number(row.attempts), createdAt: Number(row.created_at) } : null;
    },

    recordPasswordResetAttempt(id) {
      db.prepare("UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?").run(requireString(id, "resetId"));
    },

    deletePasswordReset(id) {
      db.prepare("DELETE FROM password_resets WHERE id = ?").run(requireString(id, "resetId"));
    },

    // A new password signs out every existing session and burns the reset code.
    resetUserPassword(userId, passwordHash) {
      const id = requireString(userId, "userId");
      db.exec("BEGIN");
      try {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(requireString(passwordHash, "passwordHash"), id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    listConversations(userId) {
      return db.prepare(`
        SELECT data FROM conversations
        WHERE user_id = ?
        ORDER BY updated_at DESC
      `).all(requireString(userId, "userId")).map((row) => parseJson(row.data, null)).filter(Boolean).map(conversation => ({ ...conversation, parentId: conversation.parentId || null }));
    },

    listCandidates(userId) {
      return db.prepare("SELECT id, name, created_at AS createdAt FROM candidates WHERE user_id = ? ORDER BY created_at DESC").all(requireString(userId, "userId"));
    },

    getCandidate(userId, candidateId) {
      return db.prepare("SELECT id, name, created_at AS createdAt FROM candidates WHERE user_id = ? AND id = ?").get(requireString(userId, "userId"), requireString(candidateId, "candidateId")) || null;
    },

    renameCandidate(userId, candidateId, name) {
      const owner = requireString(userId, "userId");
      const next = requireString(name, "candidate.name").slice(0, 120);
      db.prepare("UPDATE candidates SET name = ? WHERE user_id = ? AND id = ?").run(next, owner, requireString(candidateId, "candidateId"));
      return this.getCandidate(owner, candidateId);
    },

    createCandidate(userId, name) {
      const owner = requireString(userId, "userId");
      const candidate = { id: randomUUID(), name: requireString(name, "candidate.name").slice(0, 120), createdAt: nowIso() };
      db.prepare("INSERT INTO candidates (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").run(candidate.id, owner, candidate.name, candidate.createdAt);
      return candidate;
    },

    listProjects(userId) {
      return db.prepare('SELECT id, name, created_at AS createdAt FROM projects WHERE user_id = ? ORDER BY created_at DESC').all(requireString(userId, 'userId'));
    },

    saveProject(userId, project) {
      const owner = requireString(userId, 'userId');
      const id = project.id || randomUUID();
      assertGlobalOwner(db, 'projects', id, owner);
      db.prepare('INSERT INTO projects (id, user_id, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name').run(id, owner, requireString(project.name, 'project.name').slice(0, 100), project.createdAt || nowIso());
      return this.listProjects(owner).find(p => p.id === id);
    },

    deleteProject(userId, id) {
      db.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').run(userId, id);
    },

    getConversation(userId, id) {
      const row = db.prepare("SELECT data, agent_session_id AS agentSessionId FROM conversations WHERE user_id = ? AND id = ?").get(requireString(userId, "userId"), requireString(id, "conversationId"));
      if (!row) return null;
      const conversation = parseJson(row.data, null);
      if (conversation) conversation.parentId ||= null;
      if (conversation) conversation.agentSessionId = row.agentSessionId || conversation.agentSessionId || null;
      return conversation;
    },

    saveConversation(userId, conversation) {
      const ownerId = requireString(userId, "userId");
      const saved = normalizeConversation(conversation);
      assertGlobalOwner(db, "conversations", saved.id, ownerId);
      const existing = db.prepare("SELECT candidate_id, agent_session_id FROM conversations WHERE user_id = ? AND id = ?").get(ownerId, saved.id);
      if (existing && saved.candidateId && existing.candidate_id !== saved.candidateId) throw new Error("会话不能切换求职者，请为另一位求职者新建会话。");
      saved.candidateId = existing?.candidate_id || saved.candidateId || this.createCandidate(ownerId, DEFAULT_CANDIDATE_NAME).id;
      if (!this.getCandidate(ownerId, saved.candidateId)) throw new Error("求职者不存在或不属于当前用户。");
      // The agent_session_id column is the source of truth; keep the last known
      // session id when a caller saves a conversation without one.
      saved.agentSessionId = saved.agentSessionId || existing?.agent_session_id || null;
      db.prepare(`
        INSERT INTO conversations (id, user_id, candidate_id, title, data, agent_session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET
          title = excluded.title,
          data = excluded.data,
          agent_session_id = excluded.agent_session_id,
          updated_at = excluded.updated_at
      `).run(saved.id, ownerId, saved.candidateId, saved.title, JSON.stringify(saved), saved.agentSessionId, Date.parse(saved.createdAt), Date.parse(saved.updatedAt));
      return saved;
    },

    deleteConversation(userId, id) {
      db.prepare("DELETE FROM conversations WHERE user_id = ? AND id = ?").run(requireString(userId, "userId"), requireString(id, "conversationId"));
    },

    getUserState(userId) {
      const row = db.prepare("SELECT data FROM user_states WHERE user_id = ?").get(requireString(userId, "userId"));
      return row ? parseJson(row.data, {}) : {};
    },

    saveUserState(userId, state) {
      const ownerId = requireString(userId, "userId");
      const data = state && typeof state === "object" ? state : {};
      const updatedAt = Date.now();
      db.prepare(`
        INSERT INTO user_states (user_id, data, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at
      `).run(ownerId, JSON.stringify(data), updatedAt);
      return data;
    },

    listDocuments(userId) {
      return db.prepare(`
        SELECT data FROM documents
        WHERE user_id = ?
        ORDER BY updated_at DESC
      `).all(requireString(userId, "userId")).map((row) => parseJson(row.data, null)).filter(Boolean);
    },

    saveDocument(userId, document) {
      const ownerId = requireString(userId, "userId");
      const saved = normalizeDocument(document);
      assertGlobalOwner(db, "documents", saved.id, ownerId);
      const conversation = saved.conversationId ? this.getConversation(ownerId, saved.conversationId) : null;
      if (!conversation) throw new Error("文件必须绑定当前用户的会话。");
      if (saved.candidateId && saved.candidateId !== conversation.candidateId) throw new Error("文件与会话所属求职者不一致。");
      const existing = db.prepare("SELECT candidate_id FROM documents WHERE user_id = ? AND id = ?").get(ownerId, saved.id);
      if (existing && existing.candidate_id !== conversation.candidateId) throw new Error("文件不能切换求职者。");
      saved.candidateId = conversation.candidateId;
      db.prepare(`
        INSERT INTO documents (id, user_id, candidate_id, name, mime_type, text, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET
          name = excluded.name,
          mime_type = excluded.mime_type,
          text = excluded.text,
          data = excluded.data,
          updated_at = excluded.updated_at
      `).run(saved.id, ownerId, saved.candidateId, saved.name, saved.mimeType, saved.text, JSON.stringify(saved), Date.parse(saved.createdAt), Date.parse(saved.updatedAt));
      return saved;
    },

    saveCandidateMaterial(userId, candidateId, document, facts, chunks) {
      const owner = requireString(userId, "userId");
      const candidate = this.getCandidate(owner, candidateId);
      if (!candidate || document.candidateId !== candidateId) throw new Error("求职者或文件归属不一致。");
      const stored = db.prepare('SELECT text FROM documents WHERE user_id=? AND candidate_id=? AND id=?').get(owner,candidateId,document.id);
      if (!stored) throw new Error('来源文件不存在或不属于当前求职者。');
      for (const fact of facts) {
        if (!FACT_TYPES.includes(fact.type) || !['verified','user_asserted','disputed','disabled'].includes(fact.status) || !validFactSourceSpan(stored.text,fact) || String(fact.value).replace(/\s/g,'')!==fact.sourceQuote.replace(/\s/g,'')) throw new Error('候选人事实缺少真实来源文本位置或来源是否定陈述。');
        const existingFact=db.prepare('SELECT user_id,candidate_id,source_id FROM candidate_facts WHERE id=?').get(fact.id);
        if(existingFact && (existingFact.user_id!==owner || existingFact.candidate_id!==candidateId || existingFact.source_id!==document.id)) throw new Error('事实ID归属不一致。');
      }
      for(const chunk of chunks) {
        if(stored.text.slice(chunk.start,chunk.end)!==chunk.text || chunk.end<=chunk.start) throw new Error('文档片段缺少真实来源文本位置。');
        const previous=db.prepare('SELECT user_id,candidate_id,document_id FROM document_chunks WHERE id=?').get(chunk.id);
        if(previous && (previous.user_id!==owner || previous.candidate_id!==candidateId || previous.document_id!==document.id)) throw new Error('文档片段ID归属不一致。');
      }
      db.exec("BEGIN");
      try {
        const statuses = new Map(db.prepare("SELECT id,status FROM candidate_facts WHERE user_id = ? AND candidate_id = ? AND source_id = ?")
          .all(owner, candidateId, document.id).map(row => [row.id, row.status]));
        db.prepare(`DELETE FROM semantic_embedding_cache
          WHERE user_id=? AND candidate_id=? AND (
            (kind='fact' AND ref_id IN (SELECT id FROM candidate_facts WHERE user_id=? AND candidate_id=? AND source_id=?))
            OR (kind='chunk' AND ref_id IN (SELECT id FROM document_chunks WHERE user_id=? AND candidate_id=? AND document_id=?))
          )`).run(owner,candidateId,owner,candidateId,document.id,owner,candidateId,document.id);
        if(retrievalMode==='fts5') db.prepare('DELETE FROM candidate_knowledge_fts WHERE ref_id IN (SELECT id FROM candidate_facts WHERE user_id=? AND candidate_id=? AND source_id=? UNION SELECT id FROM document_chunks WHERE user_id=? AND candidate_id=? AND document_id=?)').run(owner,candidateId,document.id,owner,candidateId,document.id);
        db.prepare("DELETE FROM candidate_facts WHERE user_id = ? AND candidate_id = ? AND source_id = ?").run(owner, candidateId, document.id);
        db.prepare("DELETE FROM document_chunks WHERE user_id = ? AND candidate_id = ? AND document_id = ?").run(owner, candidateId, document.id);
        const insertFact = db.prepare(`INSERT INTO candidate_facts (id,user_id,candidate_id,type,value,source_type,source_id,source_quote,source_position,confidence,status,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const fact of facts) insertFact.run(fact.id, owner, candidateId, fact.type, fact.value, "document", document.id, fact.sourceQuote, fact.sourcePosition, fact.confidence, statuses.get(fact.id) || fact.status, nowIso());
        const insertChunk = db.prepare(`INSERT INTO document_chunks (id,user_id,candidate_id,document_id,text,start_position,end_position) VALUES (?,?,?,?,?,?,?)`);
        for (const chunk of chunks) insertChunk.run(chunk.id, owner, candidateId, document.id, chunk.text, chunk.start, chunk.end);
        if (retrievalMode === "fts5") {
          const deleteIndex = db.prepare(`DELETE FROM candidate_knowledge_fts WHERE ref_id = ?`);
          const insertIndex = db.prepare(`INSERT INTO candidate_knowledge_fts (kind, ref_id, tokens) VALUES (?, ?, ?)`);
          for (const fact of facts) { deleteIndex.run(fact.id); insertIndex.run("fact", fact.id, indexTokens(fact.value).join(" ")); }
          for (const chunk of chunks) { deleteIndex.run(chunk.id); insertIndex.run("chunk", chunk.id, indexTokens(chunk.text).join(" ")); }
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },

    searchCandidateKnowledge(userId, candidateId, query = "", limit = 12, { hintedTypes = [] } = {}) {
      const owner = requireString(userId, "userId");
      if (!this.getCandidate(owner, candidateId)) throw new Error('求职者不存在或不属于当前用户。');
      const hasQuery = String(query).trim().length > 0;
      const words = queryTokens(query);
      // A punctuation/emoji-only query carries no retrieval intent; never let it
      // degrade into a bounded "match everything" read of the Candidate KB.
      // A truly empty query stays the internal, ownership-scoped list operation
      // used by the Candidate evidence panel and integrity tests.
      if (hasQuery && !words.length) return { facts: [], chunks: [] };
      const cap = Math.min(30, Math.max(1, limit));
      const hinted = new Set(hintedTypes);
      if (retrievalMode === "fts5" && words.length) {
        const match = words.map(word => `"${word.replace(/"/g, '""')}"`).join(" OR ");
        const factRows = db.prepare(`
          SELECT f.id, f.type, f.value, f.source_type AS sourceType, f.source_id AS sourceId,
                 f.source_quote AS sourceQuote, f.source_position AS sourcePosition, f.source_message_id AS sourceMessageId,
                 f.confidence, f.status, bm25(candidate_knowledge_fts) AS rank
          FROM candidate_knowledge_fts
          JOIN candidate_facts f ON f.id = candidate_knowledge_fts.ref_id
          WHERE candidate_knowledge_fts MATCH ? AND candidate_knowledge_fts.kind = 'fact'
            AND f.user_id = ? AND f.candidate_id = ? AND f.status IN ('verified','user_asserted')
          ORDER BY rank LIMIT ?
        `).all(match, owner, candidateId, cap);
        const currentFactIds=new Set(this.listCandidateFacts(owner,candidateId).map(f=>f.id));
        const facts = factRows.filter(row=>currentFactIds.has(row.id)).map(row => ({ ...row, score: -row.rank, rank: undefined }));
        // Keep the hinted-type fallback: hinted facts that FTS missed stay reachable.
        if (hinted.size && facts.length < cap) {
          const seen = new Set(facts.map(fact => fact.id));
          for (const row of this.listCandidateFacts(owner,candidateId)) {
            if (facts.length >= cap) break;
            if (seen.has(row.id) || !hinted.has(row.type)) continue;
            facts.push({ ...row, score: 1 });
          }
        }
        const chunks = db.prepare(`
          SELECT c.id, c.document_id AS documentId, c.text, c.start_position AS start, c.end_position AS end,
                 bm25(candidate_knowledge_fts) AS rank
          FROM candidate_knowledge_fts
          JOIN document_chunks c ON c.id = candidate_knowledge_fts.ref_id
          WHERE candidate_knowledge_fts MATCH ? AND candidate_knowledge_fts.kind = 'chunk'
            AND c.user_id = ? AND c.candidate_id = ?
          ORDER BY rank LIMIT ?
        `).all(match, owner, candidateId, cap).filter(row=>chunkProvenanceValid(db,owner,candidateId,row)).map(row => ({ ...row, score: -row.rank, rank: undefined }));
        return { facts: facts.sort((a,b) => b.score - a.score), chunks: chunks.sort((a,b) => b.score - a.score) };
      }
      const rank = text => {
        const haystack = String(text).toLocaleLowerCase();
        return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
      };
      const rows = this.listCandidateFacts(owner,candidateId);
      // A hinted type keeps its facts reachable even when the wording never appears
      // in a fact value, so 我的项目经历 still returns the project facts.
      const facts = rows.map(row => {
        const content = rank(row.value);
        return { ...row, score: content + (content ? 0 : (hinted.has(row.type) ? 1 : 0)) };
      }).filter(row => (!hasQuery && !words.length) || row.score).sort((a,b) => b.score - a.score).slice(0, cap);
      const chunks = db.prepare("SELECT id,document_id AS documentId,text,start_position AS start,end_position AS end FROM document_chunks WHERE user_id = ? AND candidate_id = ?").all(owner, candidateId)
        .filter(row=>chunkProvenanceValid(db,owner,candidateId,row)).map(row => ({ ...row, score: rank(row.text) })).filter(row => (!hasQuery && !words.length) || row.score).sort((a,b) => b.score - a.score).slice(0, cap);
      return { facts, chunks };
    },

    listSemanticCandidateRecords(userId, candidateId, { limit = 256 } = {}) {
      const cap = Math.min(256, Math.max(1, Number(limit) || 256));
      const records = [];
      for (const record of this.iterateSemanticCandidateRecords(userId, candidateId)) {
        records.push(record);
        if (records.length >= cap) break;
      }
      return records;
    },

    *iterateSemanticCandidateRecords(userId, candidateId, { pageSize = 256 } = {}) {
      const owner = requireString(userId, 'userId');
      const scopeId = requireString(candidateId, 'candidateId');
      if (!this.getCandidate(owner, scopeId)) throw new Error('求职者不存在或不属于当前用户。');
      const size = Math.min(256, Math.max(1, Math.floor(Number(pageSize) || 256)));
      const sources = [
        { kind: 'fact', table: 'candidate_facts', fields: 'id,type,value,source_type AS sourceType,source_id AS sourceId,source_quote AS sourceQuote,source_position AS sourcePosition,source_message_id AS sourceMessageId,confidence,status', eligible: " AND status IN ('verified','user_asserted')" },
        { kind: 'chunk', table: 'document_chunks', fields: 'id,document_id AS documentId,text,start_position AS start,end_position AS end', eligible: '' }
      ];
      // Fix each upper cursor before yielding: continuous appends cannot make a
      // search infinite. Page raw rows first, then validate provenance; an empty
      // valid page is not the end of the corpus.
      const ceilings = sources.map(source => db.prepare(`SELECT MAX(rowid) AS cursor FROM ${source.table} WHERE user_id=? AND candidate_id=?`).get(owner, scopeId).cursor || 0);
      for (const [index, source] of sources.entries()) {
        const select = db.prepare(`SELECT rowid AS cursor,${source.fields} FROM ${source.table} WHERE user_id=? AND candidate_id=? AND rowid>? AND rowid<=?${source.eligible} ORDER BY rowid LIMIT ?`);
        let cursor = 0;
        while (cursor < ceilings[index]) {
          const rows = select.all(owner, scopeId, cursor, ceilings[index], size);
          if (!rows.length) break;
          cursor = rows.at(-1).cursor;
          for (const row of rows) {
            delete row.cursor;
            const valid = source.kind === 'fact' ? factProvenanceValid(db, owner, scopeId, row) : chunkProvenanceValid(db, owner, scopeId, row);
            if (!valid) continue;
            const content = source.kind === 'fact' ? row.value : row.text;
            yield { kind: source.kind, refId: row.id, content, contentHash: semanticContentHash(source.kind, content), [source.kind]: row };
          }
        }
      }
    },

    isSemanticCandidateRecordCurrent(userId, candidateId, record) {
      if (!this.getCandidate(userId, candidateId)) throw new Error('求职者不存在或不属于当前用户。');
      return semanticRecordValid(db, userId, candidateId, record?.kind, record?.refId, record?.contentHash);
    },

    getSemanticEmbeddingCache(userId, candidateId, providerId, kind, refId, contentHash) {
      if (!this.getCandidate(userId, candidateId)) throw new Error('求职者不存在或不属于当前用户。');
      if (!semanticRecordValid(db, userId, candidateId, kind, refId, contentHash)) return null;
      const row = db.prepare(`SELECT vector_json AS vectorJson, dims FROM semantic_embedding_cache
        WHERE user_id=? AND candidate_id=? AND provider_id=? AND kind=? AND ref_id=? AND content_hash=?`)
        .get(requireString(userId, 'userId'), requireString(candidateId, 'candidateId'), requireString(providerId, 'providerId'), requireString(kind, 'kind'), requireString(refId, 'refId'), requireString(contentHash, 'contentHash'));
      if (!row) return null;
      return { vector: parseJson(row.vectorJson, null), dims: row.dims };
    },

    saveSemanticEmbeddingCache(userId, candidateId, providerId, record, vector) {
      if (!this.getCandidate(userId, candidateId)) throw new Error('求职者不存在或不属于当前用户。');
      if (!semanticRecordValid(db, userId, candidateId, record?.kind, record?.refId, record?.contentHash)) throw new Error('语义缓存记录已失效。');
      if (!Array.isArray(vector) || !vector.length || vector.length > 16384 || vector.some(value => typeof value !== 'number' || !Number.isFinite(value)) || !Number.isFinite(Math.hypot(...vector)) || !vector.some(value => value !== 0)) throw new Error('语义缓存向量无效。');
      db.prepare(`INSERT INTO semantic_embedding_cache (user_id,candidate_id,provider_id,kind,ref_id,content_hash,dims,vector_json,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id,candidate_id,provider_id,kind,ref_id) DO UPDATE SET
          content_hash=excluded.content_hash,
          dims=excluded.dims,
          vector_json=excluded.vector_json,
          updated_at=excluded.updated_at`)
        .run(requireString(userId, 'userId'), requireString(candidateId, 'candidateId'), requireString(providerId, 'providerId'),
          requireString(record.kind, 'record.kind'), requireString(record.refId, 'record.refId'), requireString(record.contentHash, 'record.contentHash'),
          vector.length, JSON.stringify(vector), nowIso());
    },

    pruneSemanticEmbeddingCache(userId, candidateId, providerId) {
      const owner = requireString(userId, 'userId');
      const scopeId = requireString(candidateId, 'candidateId');
      if (!this.getCandidate(owner, scopeId)) throw new Error('求职者不存在或不属于当前用户。');
      const provider = requireString(providerId, 'providerId');
      const rows = db.prepare(`SELECT kind,ref_id AS refId,content_hash AS contentHash FROM semantic_embedding_cache WHERE user_id=? AND candidate_id=? AND provider_id=?`).all(owner, scopeId, provider);
      const remove = db.prepare(`DELETE FROM semantic_embedding_cache WHERE user_id=? AND candidate_id=? AND provider_id=? AND kind=? AND ref_id=?`);
      for (const row of rows) {
        if (!semanticRecordValid(db, owner, scopeId, row.kind, row.refId, row.contentHash)) remove.run(owner, scopeId, provider, row.kind, row.refId);
      }
    },

    saveTargetJob(userId, candidateId, job = {}) {
      const owner = requireString(userId, "userId");
      if (!this.getCandidate(owner, candidateId)) throw new Error("求职者不存在或不属于当前用户。");
      const id = requireString(job.id || randomUUID(), "targetJob.id");
      assertGlobalOwner(db, "target_jobs", id, owner);
      assertCandidateRecord(db,'target_jobs',id,owner,candidateId);
      assertConversationScope(this,owner,candidateId,job.conversationId);
      const saved = {
        id,
        userId: owner,
        candidateId,
        conversationId: job.conversationId || null,
        title: requireString(job.title, "targetJob.title"),
        company: job.company ? String(job.company) : null,
        description: requireString(job.description, "targetJob.description"),
        requirements: JSON.stringify(Array.isArray(job.requirements) ? job.requirements : []),
        role: job.role ? String(job.role) : null,
        source: job.source ? String(job.source) : null,
        sourceMetadata: JSON.stringify(job.sourceMetadata || {url:job.url || job.originalUrl || null,sourceId:job.sourceId || null,observedAt:job.observedAt || null,fetchedAt:job.fetchedAt || null,validity:job.validity || 'unverified'}),
        createdAt: job.createdAt || nowIso()
      };
      db.prepare(`
        INSERT INTO target_jobs (id, user_id, candidate_id, conversation_id, title, company, description, requirements, role, source, source_metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          conversation_id = excluded.conversation_id,
          title = excluded.title,
          company = excluded.company,
          description = excluded.description,
          requirements = excluded.requirements,
          role = excluded.role,
          source = excluded.source,
          source_metadata = excluded.source_metadata
      `).run(saved.id, owner, candidateId, saved.conversationId, saved.title, saved.company, saved.description, saved.requirements, saved.role, saved.source, saved.sourceMetadata, saved.createdAt);
      return this.getTargetJob(owner, candidateId, id);
    },

    getTargetJob(userId, candidateId, targetJobId) {
      const row = db.prepare("SELECT id, user_id AS userId, candidate_id AS candidateId, conversation_id AS conversationId, title, company, description, requirements, role, source, created_at AS createdAt FROM target_jobs WHERE user_id = ? AND candidate_id = ? AND id = ?")
        .get(requireString(userId, "userId"), requireString(candidateId, "candidateId"), requireString(targetJobId, "targetJobId"));
      if (!row) return null;
      const metadata=db.prepare('SELECT source_metadata FROM target_jobs WHERE id=?').get(row.id);
      return { ...row, requirements: parseJson(row.requirements, []),sourceMetadata:parseJson(metadata.source_metadata,{}) };
    },

    saveResumeVariant(userId, candidateId, variant = {}) {
      const owner = requireString(userId, "userId");
      if (!this.getCandidate(owner, candidateId)) throw new Error("求职者不存在或不属于当前用户。");
      const id = requireString(variant.id || randomUUID(), "resumeVariant.id");
      assertGlobalOwner(db, "resume_variants", id, owner);
      assertCandidateRecord(db,'resume_variants',id,owner,candidateId);
      assertConversationScope(this,owner,candidateId,variant.conversationId);
      if (variant.targetJobId && !this.getTargetJob(owner, candidateId, variant.targetJobId)) throw new Error("目标岗位不存在或不属于当前求职者。");
      const content = variant.content && typeof variant.content === "object" ? JSON.stringify(variant.content) : requireString(variant.content, "resumeVariant.content");
      const claims = Array.isArray(variant.claims) ? variant.claims : [];
      if(!variant.content || typeof variant.content!=='object' || Array.isArray(variant.content)) throw new Error('简历必须是可核验事实的结构化内容。');
      verifyClaimEvidence(variant.content,claims,this.listCandidateFacts(owner,candidateId));
      const createdAt = nowIso();
      db.exec("BEGIN");
      try {
        db.prepare(`
          INSERT INTO resume_variants (id, user_id, candidate_id, conversation_id, target_job_id, title, role, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, owner, candidateId, variant.conversationId || null, variant.targetJobId || null,
          variant.title ? String(variant.title) : null, variant.role ? String(variant.role) : null, content, createdAt);
        const insertClaim = db.prepare(`
          INSERT INTO claim_evidence (id, variant_id, user_id, candidate_id, claim_text, claim_field, fact_ids, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const claim of claims) {
          insertClaim.run(randomUUID(), id, owner, candidateId,
            requireString(claim.claimText, "claim.claimText"),
            requireString(claim.field,'claim.field'),
            JSON.stringify(Array.isArray(claim.factIds) ? claim.factIds.map(String) : []),
            createdAt);
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return { variantId: id, claimCount: claims.length };
    },

    listResumeVariants(userId, candidateId, { conversationId } = {}) {
      const rows = conversationId
        ? db.prepare("SELECT id, user_id AS userId, candidate_id AS candidateId, conversation_id AS conversationId, target_job_id AS targetJobId, title, role, content, created_at AS createdAt FROM resume_variants WHERE user_id = ? AND candidate_id = ? AND conversation_id = ? ORDER BY created_at DESC").all(requireString(userId, "userId"), requireString(candidateId, "candidateId"), conversationId)
        : db.prepare("SELECT id, user_id AS userId, candidate_id AS candidateId, conversation_id AS conversationId, target_job_id AS targetJobId, title, role, content, created_at AS createdAt FROM resume_variants WHERE user_id = ? AND candidate_id = ? ORDER BY created_at DESC").all(requireString(userId, "userId"), requireString(candidateId, "candidateId"));
      return rows.map(row => ({ ...row, content: parseJson(row.content, null) }));
    },

    getResumeVariant(userId, candidateId, variantId) {
      const row = db.prepare("SELECT id, user_id AS userId, candidate_id AS candidateId, conversation_id AS conversationId, target_job_id AS targetJobId, title, role, content, created_at AS createdAt FROM resume_variants WHERE user_id = ? AND candidate_id = ? AND id = ?")
        .get(requireString(userId, "userId"), requireString(candidateId, "candidateId"), requireString(variantId, "variantId"));
      if (!row) throw new Error("简历版本不存在或不属于当前求职者。");
      return { ...row, content: parseJson(row.content, null), claims: db.prepare("SELECT id, claim_text AS claimText, claim_field AS field, fact_ids AS factIds, created_at AS createdAt FROM claim_evidence WHERE variant_id = ? AND user_id=? AND candidate_id=? ORDER BY created_at ASC").all(variantId,userId,candidateId)
        .map(claim => ({ ...claim, factIds: parseJson(claim.factIds, []) })) };
    },

    assertResumeVariantGrounded(userId,candidateId,variantId) {
      const variant=this.getResumeVariant(userId,candidateId,variantId);
      verifyClaimEvidence(variant.content,variant.claims,this.listCandidateFacts(userId,candidateId));
      return variant;
    },

    listCandidateFacts(userId,candidateId) {
      if(!this.getCandidate(userId,candidateId)) throw new Error('求职者不存在或不属于当前用户。');
      return db.prepare("SELECT id,type,value,source_type AS sourceType,source_id AS sourceId,source_quote AS sourceQuote,source_position AS sourcePosition,source_message_id AS sourceMessageId,confidence,status FROM candidate_facts WHERE user_id=? AND candidate_id=? AND status IN ('verified','user_asserted')").all(userId,candidateId).filter(fact=>factProvenanceValid(db,userId,candidateId,fact));
    },

    saveCandidateFact(userId, candidateId, fact = {}) {
      const owner = requireString(userId, "userId");
      if (!this.getCandidate(owner, candidateId)) throw new Error("求职者不存在或不属于当前用户。");
      if (!FACT_TYPES.includes(fact.type)) throw new Error(`未知的事实类型：${fact.type}`);
      const value = requireString(fact.value, "fact.value");
      const conversationId=requireString(fact.sourceConversationId,'事实来源会话/sourceConversationId');
      const messageId=requireString(fact.sourceMessageId,'事实来源消息/sourceMessageId');
      assertConversationScope(this,owner,candidateId,conversationId);
      const message=this.getConversation(owner,conversationId).messages.find(m=>m.id===messageId && m.role==='user' && (!m.kind || m.kind==='text'));
      const quote=fact.quote ? requireString(fact.quote,'fact.quote') : value;
      const statement=message && String(message.content || '').split(/[。！？\n]/u).find(text=>text.includes(value) && text.includes(quote));
      const declaration=String(statement || '').trim().replace(/^(?:补充(?:一下)?|另外|补充信息)\s*[：:，,]\s*/u,'');
      const selfDeclared=/^(?:我(?:的|是|在|曾|参与|使用|负责|做|会|熟|毕业|就读|期望|希望|想|打算|准备|有)|本人)/u.test(declaration);
      const thirdParty=/(?:我的|本人(?:的)?)(?:朋友|同学|同事|导师|室友|队友)/u.test(declaration);
      const futureFact=fact.type!=='career_preference' && /(?:希望|计划|打算|准备|想要|想学|需要学|将要)/u.test(declaration);
      const negated=statement && !validFactSourceSpan(statement,{sourceQuote:value,sourcePosition:statement.indexOf(value)});
      if(!statement || !quote.includes(value) || !selfDeclared || thirdParty || futureFact || negated || /(?:JD|岗位要求|任职要求|职位描述|招聘要求|候选人要求)/i.test(statement)) throw new Error('事实必须逐字来自当前求职者用户消息中的明确第一人称陈述，不能来自JD、推测、第三方或助手。');
      const conflictKey=typeConflictKey(fact.type,value);
      const conflicts=conflictKey ? db.prepare("SELECT id,type,value FROM candidate_facts WHERE user_id=? AND candidate_id=? AND status!='disabled'").all(owner,candidateId).filter(f=>typeConflictKey(f.type,f.value)===conflictKey && f.value!==value) : [];
      const saved = {
        id: randomUUID(),
        userId: owner,
        candidateId,
        type: fact.type,
        value,
        sourceType: "user_asserted",
        sourceId: conversationId,
        sourceMessageId: messageId,
        sourceQuote: quote,
        sourcePosition: String(message.content).indexOf(quote),
        confidence: 1,
        status: conflicts.length ? 'disputed' : 'user_asserted',
        createdAt: nowIso()
      };
      db.prepare(`INSERT INTO candidate_facts (id,user_id,candidate_id,type,value,source_type,source_id,source_quote,source_position,source_message_id,confidence,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(saved.id, owner, candidateId, saved.type, saved.value, saved.sourceType, saved.sourceId, saved.sourceQuote, saved.sourcePosition,saved.sourceMessageId, saved.confidence, saved.status, saved.createdAt);
      for(const previous of conflicts) db.prepare("UPDATE candidate_facts SET status='disputed' WHERE id=? AND user_id=? AND candidate_id=?").run(previous.id,owner,candidateId);
      if (retrievalMode === "fts5") {
        db.prepare("DELETE FROM candidate_knowledge_fts WHERE ref_id = ?").run(saved.id);
        db.prepare("INSERT INTO candidate_knowledge_fts (kind, ref_id, tokens) VALUES ('fact', ?, ?)").run(saved.id, indexTokens(saved.value).join(" "));
      }
      return saved;
    },

    listUserAssertedFacts(userId, candidateId) {
      return db.prepare(`SELECT id, type, value, source_type AS sourceType, source_id AS sourceId, source_quote AS sourceQuote, confidence, status, created_at AS createdAt
        FROM candidate_facts WHERE user_id = ? AND candidate_id = ? AND source_type = 'user_asserted' ORDER BY created_at ASC`)
        .all(requireString(userId, "userId"), requireString(candidateId, "candidateId"));
    },

    deleteDocument(userId, id) {
      const owner = requireString(userId, "userId");
      db.prepare(`DELETE FROM semantic_embedding_cache
        WHERE user_id=? AND (
          (kind='chunk' AND ref_id IN (SELECT id FROM document_chunks WHERE user_id=? AND document_id=?))
          OR (kind='fact' AND ref_id IN (SELECT id FROM candidate_facts WHERE user_id=? AND source_type='document' AND source_id=?))
        )`).run(owner, owner, id, owner, id);
      if (retrievalMode === "fts5") {
        db.prepare(`DELETE FROM candidate_knowledge_fts WHERE ref_id IN (SELECT id FROM document_chunks WHERE user_id = ? AND document_id = ? UNION SELECT id FROM candidate_facts WHERE user_id=? AND source_type='document' AND source_id=?)`).run(owner, id,owner,id);
      }
      db.prepare("DELETE FROM candidate_facts WHERE user_id=? AND source_type='document' AND source_id=?").run(owner,id);
      db.prepare("DELETE FROM documents WHERE user_id = ? AND id = ?").run(owner, id);
    },

    close() {
      db.close();
    }
  };
}

function migrate(db) {
  // Probe FTS5 once per open. Official node:sqlite builds usually ship it; if
  // the virtual table cannot be created we keep the JS bigram ranking fallback.
  let retrievalMode = "fallback";
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS candidate_knowledge_fts USING fts5(tokens, kind UNINDEXED, ref_id UNINDEXED)`);
    retrievalMode = "fts5";
  } catch {
    db.exec("DROP TABLE IF EXISTS candidate_knowledge_fts");
    retrievalMode = "fallback";
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id TEXT REFERENCES candidates(id),
      title TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS user_states (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id TEXT REFERENCES candidates(id),
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      text TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS candidate_facts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_quote TEXT NOT NULL,
      source_position INTEGER,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      start_position INTEGER NOT NULL,
      end_position INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
      ON conversations (user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_documents_user_updated
      ON documents (user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_candidate_facts_scope ON candidate_facts (user_id,candidate_id);
    CREATE INDEX IF NOT EXISTS idx_document_chunks_scope ON document_chunks (user_id,candidate_id);

    CREATE TABLE IF NOT EXISTS target_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      conversation_id TEXT,
      title TEXT NOT NULL,
      company TEXT,
      description TEXT NOT NULL,
      requirements TEXT NOT NULL DEFAULT '[]',
      role TEXT,
      source TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resume_variants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      conversation_id TEXT,
      target_job_id TEXT REFERENCES target_jobs(id),
      title TEXT,
      role TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claim_evidence (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL REFERENCES resume_variants(id) ON DELETE CASCADE,
      user_id TEXT,
      candidate_id TEXT,
      claim_text TEXT NOT NULL,
      fact_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_target_jobs_scope ON target_jobs (user_id, candidate_id);
    CREATE INDEX IF NOT EXISTS idx_resume_variants_scope ON resume_variants (user_id, candidate_id);
    CREATE INDEX IF NOT EXISTS idx_claim_evidence_variant ON claim_evidence (variant_id);

    CREATE TABLE IF NOT EXISTS semantic_embedding_cache (
      user_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      dims INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id,candidate_id,provider_id,kind,ref_id)
    );

    CREATE INDEX IF NOT EXISTS idx_semantic_embedding_scope
      ON semantic_embedding_cache (user_id,candidate_id,provider_id);
  `);
  for(const [table,column,definition] of [['target_jobs','source_metadata',"TEXT NOT NULL DEFAULT '{}'"],['claim_evidence','claim_field',"TEXT"],['candidate_facts','source_message_id','TEXT']]) {
    if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  for (const table of ["conversations", "documents"]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === "candidate_id")) db.exec(`ALTER TABLE ${table} ADD COLUMN candidate_id TEXT REFERENCES candidates(id)`);
  }
  if (!db.prepare("PRAGMA table_info(conversations)").all().some(column => column.name === "agent_session_id")) {
    db.exec("ALTER TABLE conversations ADD COLUMN agent_session_id TEXT");
  }
  // Old conversations may belong to different people. Keep each in its own
  // Candidate instead of merging all historical material under one account.
  for (const row of db.prepare("SELECT id,user_id,data FROM conversations WHERE candidate_id IS NULL").all()) {
    const candidateId = randomUUID();
    db.prepare("INSERT INTO candidates (id,user_id,name,created_at) VALUES (?,?,?,?)").run(candidateId,row.user_id,"旧会话求职者",nowIso());
    const data = parseJson(row.data, {});
    data.candidateId = candidateId;
    db.prepare("UPDATE conversations SET candidate_id = ?, data = ? WHERE id = ? AND user_id = ?").run(candidateId,JSON.stringify(data),row.id,row.user_id);
  }
  for (const row of db.prepare("SELECT id,user_id,data FROM documents WHERE candidate_id IS NULL").all()) {
    const data = parseJson(row.data, {});
    let candidateId = data.conversationId ? db.prepare("SELECT candidate_id FROM conversations WHERE user_id = ? AND id = ?").get(row.user_id,data.conversationId)?.candidate_id : null;
    if (!candidateId) {
      candidateId = randomUUID();
      db.prepare("INSERT INTO candidates (id,user_id,name,created_at) VALUES (?,?,?,?)").run(candidateId,row.user_id,"旧文件求职者",nowIso());
    }
    data.candidateId = candidateId;
    db.prepare("UPDATE documents SET candidate_id = ?, data = ? WHERE id = ? AND user_id = ?").run(candidateId,JSON.stringify(data),row.id,row.user_id);
  }
  // Rebuild from authoritative rows on startup, including databases upgraded
  // from the pre-FTS implementation and records removed while FTS was unavailable.
  if(retrievalMode==='fts5') {
    db.exec('DELETE FROM candidate_knowledge_fts');
    const insert=db.prepare('INSERT INTO candidate_knowledge_fts(kind,ref_id,tokens) VALUES (?,?,?)');
    for(const row of db.prepare('SELECT id,value FROM candidate_facts').all()) insert.run('fact',row.id,indexTokens(row.value).join(' '));
    for(const row of db.prepare('SELECT id,text FROM document_chunks').all()) insert.run('chunk',row.id,indexTokens(row.text).join(' '));
  }
  return retrievalMode;
}

function assertCandidateRecord(db,table,id,userId,candidateId) {
  const row=db.prepare(`SELECT user_id,candidate_id FROM ${table} WHERE id=?`).get(id);
  if(row && (row.user_id!==userId || row.candidate_id!==candidateId)) throw new Error('记录与当前求职者归属不一致。');
}

function assertConversationScope(database,userId,candidateId,conversationId) {
  if(!conversationId) return;
  const conversation=database.getConversation(userId,conversationId);
  if(!conversation || conversation.candidateId!==candidateId) throw new Error('来源会话不存在或与当前求职者归属不一致。');
}

function typeConflictKey(type,value) {
  if(type==='identity') return 'identity';
  if(type==='contact') {
    if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'contact:email';
    if(/^[+\d\s()-]{7,}$/.test(value)) return 'contact:phone';
  }
  return null;
}

function factProvenanceValid(db,userId,candidateId,fact) {
  if(fact.sourceType==='document') {
    const document=db.prepare('SELECT text FROM documents WHERE user_id=? AND candidate_id=? AND id=?').get(userId,candidateId,fact.sourceId);
    return Boolean(document && validFactSourceSpan(document.text,fact));
  }
  // User statements are immutable quoted evidence. They outlive the work thread.
  return fact.sourceType==='user_asserted' && Boolean(fact.sourceMessageId && fact.sourceId && fact.sourceQuote && fact.sourceQuote.includes(fact.value));
}

function chunkProvenanceValid(db,userId,candidateId,chunk) {
  const document=db.prepare('SELECT text FROM documents WHERE user_id=? AND candidate_id=? AND id=?').get(userId,candidateId,chunk.documentId);
  if(!document || document.text.slice(chunk.start,chunk.end)!==chunk.text) return false;
  return !db.prepare("SELECT 1 FROM candidate_facts WHERE user_id=? AND candidate_id=? AND source_type='document' AND source_id=? AND status IN ('disputed','disabled') AND source_position < ? AND source_position + LENGTH(source_quote) > ? LIMIT 1").get(userId,candidateId,chunk.documentId,chunk.end,chunk.start);
}

function semanticContentHash(kind, content) {
  return createHash('sha256').update(`${kind}\0${String(content)}`).digest('hex');
}

function semanticRecordValid(db, userId, candidateId, kind, refId, contentHash) {
  if (kind === 'fact') {
    const fact = db.prepare("SELECT value,source_type AS sourceType,source_id AS sourceId,source_quote AS sourceQuote,source_position AS sourcePosition,source_message_id AS sourceMessageId FROM candidate_facts WHERE user_id=? AND candidate_id=? AND id=? AND status IN ('verified','user_asserted')").get(userId, candidateId, refId);
    return Boolean(fact && semanticContentHash(kind, fact.value) === contentHash && factProvenanceValid(db, userId, candidateId, fact));
  }
  if (kind === 'chunk') {
    const chunk = db.prepare('SELECT document_id AS documentId,text,start_position AS start,end_position AS end FROM document_chunks WHERE user_id=? AND candidate_id=? AND id=?').get(userId, candidateId, refId);
    return Boolean(chunk && semanticContentHash(kind, chunk.text) === contentHash && chunkProvenanceValid(db, userId, candidateId, chunk));
  }
  return false;
}

function normalizeConversation(conversation) {
  if (!conversation || typeof conversation !== "object") throw new Error("conversation must be an object");
  const timestamp = nowIso();
  return {
    id: requireString(conversation.id || randomUUID(), "conversation.id"),
    candidateId: conversation.candidateId || null,
    parentId: typeof conversation.parentId === 'string' ? conversation.parentId : null,
    title: String(conversation.title || "Untitled conversation").slice(0, 200),
    projectId: typeof conversation.projectId === 'string' ? conversation.projectId : null,
    agentSessionId: typeof conversation.agentSessionId === 'string' && conversation.agentSessionId.trim() ? conversation.agentSessionId.trim() : null,
    messages: Array.isArray(conversation.messages) ? conversation.messages : [],
    context: conversation.context && typeof conversation.context === "object" ? conversation.context : {},
    createdAt: normalizeIso(conversation.createdAt, timestamp),
    updatedAt: normalizeIso(conversation.updatedAt, timestamp)
  };
}

function normalizeDocument(document) {
  if (!document || typeof document !== "object") throw new Error("document must be an object");
  const timestamp = nowIso();
  return {
    ...document,
    id: requireString(document.id || randomUUID(), "document.id"),
    name: String(document.name || "Untitled document").slice(0, 240),
    text: String(document.text || ""),
    mimeType: String(document.mimeType || "text/plain").slice(0, 120),
    createdAt: normalizeIso(document.createdAt, timestamp),
    updatedAt: normalizeIso(document.updatedAt, timestamp)
  };
}

function assertGlobalOwner(db, table, id, userId) {
  const row = db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).get(id);
  if (row && row.user_id !== userId) {
    throw new Error("这个记录属于另一个用户。");
  }
}

// Chinese has no word boundaries, so treating a whole question as one token would
// match nothing. Index Han text as overlapping bigrams and keep ASCII words whole,
// so "我之前上传过哪些项目经历" still finds a 项目 or 经历 fact.
function queryTokens(query = '') {
  const text = String(query).toLocaleLowerCase();
  const tokens = new Set(text.match(/[a-z][a-z0-9+.#-]*|\d+(?:\.\d+)?%?/gu) || []);
  for (const run of text.match(/[\p{Script=Han}]+/gu) || []) {
    if (run.length === 1) { tokens.add(run); continue; }
    for (let index = 0; index < run.length - 1; index += 1) tokens.add(run.slice(index, index + 2));
  }
  return [...tokens];
}

// Shared with the FTS5 index: Han text is pre-bigramed into space-separated
// tokens because FTS5 unicode61 cannot segment Chinese on its own.
export function indexTokens(text = '') {
  return queryTokens(text);
}

function normalizeEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("请填写邮箱。");
  return normalized;
}

function normalizeName(name) {
  const normalized = String(name || "").trim();
  if (!normalized) throw new Error("请填写姓名。");
  return normalized.slice(0, 120);
}

function requireString(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${field} 不能为空。`);
  return text;
}

function normalizeIso(value, fallback) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function toMillis(value, field) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`${field} is required`);
}

function nowIso() {
  return new Date().toISOString();
}

function userFromRow(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    createdAt: row.created_at
  };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
