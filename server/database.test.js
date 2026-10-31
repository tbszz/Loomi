import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "./database.js";

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "resume-protocol-db-"));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

{
  const dir = tempDir();
  const filename = path.join(dir, "state.sqlite");
  let db;
  try {
    db = createDatabase({ filename });
    const alice = db.createUser({ email: "ALICE@example.com", name: "Alice", passwordHash: "hash-a" });
    const bob = db.createUser({ email: "bob@example.com", name: "Bob", passwordHash: "hash-b" });

    assert.equal(db.getUserByEmail("alice@EXAMPLE.com").id, alice.id);
    assert.equal(db.getUserById(bob.id).email, "bob@example.com");

    const conversation = {
      id: "conv-1",
      title: "Resume targeting",
      messages: [{ role: "user", content: "hello" }],
      context: { role: "frontend" },
      createdAt: "2026-09-07T00:00:00.000Z",
      updatedAt: "2026-09-07T00:01:00.000Z"
    };
    db.saveConversation(alice.id, conversation);
    db.saveUserState(alice.id, { profile: { name: "Alice" }, memory: ["one"] });
    db.saveDocument(alice.id, { id: "doc-1", conversationId: conversation.id, name: "resume.txt", text: "source text", mimeType: "text/plain", parsedAt: "now" });

    db.createSession(alice.id, "token-hash", Date.now() + 60_000);
    assert.equal(db.getSession("token-hash").user.id, alice.id);
    db.close();

    db = createDatabase({ filename });
    assert.equal(indexExists(db, "idx_conversations_user_updated"), true);
    assert.equal(indexExists(db, "idx_documents_user_updated"), true);
    assert.equal(db.getConversation(alice.id, "conv-1").title, "Resume targeting");
    assert.equal(db.listConversations(alice.id).length, 1);
    assert.equal(db.getUserState(alice.id).profile.name, "Alice");
    assert.equal(db.listDocuments(alice.id)[0].text, "source text");
    assert.equal(db.getConversation(bob.id, "conv-1"), null);
    assert.equal(db.listConversations(bob.id).length, 0);
    assert.equal(db.listDocuments(bob.id).length, 0);

    assert.throws(() => db.saveConversation(bob.id, { ...conversation, title: "stolen" }), /另一个用户/);
    assert.throws(() => db.saveDocument(bob.id, { id: "doc-1", conversationId: conversation.id, name: "copy.txt", text: "x", mimeType: "text/plain" }), /另一个用户/);

    db.deleteConversation(alice.id, "conv-1");
    db.deleteDocument(alice.id, "doc-1");
    db.deleteSession("token-hash");
    assert.equal(db.getConversation(alice.id, "conv-1"), null);
    assert.equal(db.listDocuments(alice.id).length, 0);
    assert.equal(db.getSession("token-hash"), null);
    db.close();
    db = null;
  } finally {
    db?.close();
    cleanup(dir);
  }
}

{
  const dir = tempDir();
  const filename = path.join(dir, "state.sqlite");
  let db;
  try {
    db = createDatabase({ filename });
    const user = db.createUser({ email: "expired@example.com", name: "Expired", passwordHash: "hash" });
    db.createSession(user.id, "expired-token", Date.now() - 1);
    assert.equal(db.getSession("expired-token"), null);
    db.close();
    db = null;
  } finally {
    db?.close();
    cleanup(dir);
  }
}

{
  const dir = tempDir();
  const filename = path.join(dir, 'candidate-search.sqlite');
  let db;
  try {
    db = createDatabase({ filename });
    const user = db.createUser({ email: 'search@example.com', name: 'Search', passwordHash: 'hash' });
    const candidate = db.createCandidate(user.id, 'Candidate');
    const conversation = db.saveConversation(user.id, { id: 'search-conv', candidateId: candidate.id, title: 'search', messages: [], context: {} });
    const document = db.saveDocument(user.id, { id: 'search-doc', conversationId: conversation.id, candidateId: candidate.id, name: 'resume.txt', mimeType: 'text/plain', text: 'React 项目' });
    db.saveCandidateMaterial(user.id, candidate.id, document, [{
      id: 'search-fact', type: 'skill', value: 'React', sourceQuote: 'React', sourcePosition: 0,
      confidence: 1, status: 'user_asserted'
    }], [{ id: 'search-chunk', text: 'React 项目', start: 0, end: 8 }]);

    assert.deepEqual(db.searchCandidateKnowledge(user.id, candidate.id, '??? 🤖'), { facts: [], chunks: [] });
    assert.equal(db.searchCandidateKnowledge(user.id, candidate.id, 'React').facts[0].id, 'search-fact');
    assert.equal(db.searchCandidateKnowledge(user.id, candidate.id, '').facts[0].id, 'search-fact', 'empty query is the scoped list operation');

    // Reopening keeps an in-sync index as it is and repairs a drifted one.
    db.close();
    db = createDatabase({ filename });
    assert.equal(db.searchCandidateKnowledge(user.id, candidate.id, 'React').facts[0].id, 'search-fact');
    db.raw.exec("DELETE FROM candidate_knowledge_fts WHERE ref_id = 'search-fact'");
    db.raw.exec("INSERT INTO candidate_knowledge_fts (kind, ref_id, tokens) VALUES ('fact', 'removed-fact', 'react')");
    db.close();
    db = createDatabase({ filename });
    assert.equal(db.searchCandidateKnowledge(user.id, candidate.id, 'React').facts[0].id, 'search-fact');
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM candidate_knowledge_fts WHERE ref_id = 'removed-fact'").get().n, 0);
  } finally {
    db?.close();
    cleanup(dir);
  }
}

{
  const dir = tempDir();
  const filename = path.join(dir, 'legacy.sqlite');
  let migrated;
  try {
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE conversations (id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,id));
      CREATE TABLE documents (id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL,name TEXT NOT NULL,mime_type TEXT NOT NULL,text TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,id));
      INSERT INTO users VALUES ('u1','legacy@example.com','Legacy','hash','2026-09-01T00:00:00.000Z');
    `);
    for (const id of ['old-a','old-b']) {
      const data = JSON.stringify({id,title:id,messages:[],context:{},createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'});
      legacy.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?)').run(id,'u1',id,data,1,1);
      const document = JSON.stringify({id:`doc-${id}`,conversationId:id,name:'resume.txt',text:id,mimeType:'text/plain'});
      legacy.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)').run(`doc-${id}`,'u1','resume.txt','text/plain',id,document,1,1);
    }
    legacy.close();
    migrated = createDatabase({filename});
    const a = migrated.getConversation('u1','old-a');
    const b = migrated.getConversation('u1','old-b');
    assert.notEqual(a.candidateId,b.candidateId,'old conversations must not be merged into one candidate');
    assert.equal(migrated.listDocuments('u1').find(item => item.conversationId === a.id).candidateId,a.candidateId);
    migrated.close();
    migrated = createDatabase({filename});
    assert.equal(migrated.listCandidates('u1').length,2,'migration is idempotent');
  } finally { migrated?.close(); cleanup(dir); }
}

function indexExists(database, name) {
  const row = database.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name);
  return Boolean(row);
}

{
  const dir = tempDir();
  const database = createDatabase({ filename: path.join(dir, 'text-statement.sqlite') });
  try {
    const user = database.createUser({ email: 'statement@example.test', name: '张三', passwordHash: 'hash' });
    const candidate = database.createCandidate(user.id, '张三');
    const conversation = database.saveConversation(user.id, { id: 'statement-conv', candidateId: candidate.id, title: '补充', messages: [{ id: 'statement', role: 'user', kind: 'text', content: '补充一下：我的邮箱是 zhang@example.test。请分析目标JD：要求Docker。' }], context: {} });
    const fact = database.saveCandidateFact(user.id, candidate.id, { type: 'contact', value: 'zhang@example.test', sourceConversationId: conversation.id, sourceMessageId: 'statement' });
    assert.equal(fact.status, 'user_asserted');
    assert.equal(fact.sourceMessageId, 'statement');
    assert.throws(() => database.saveCandidateFact(user.id, candidate.id, { type: 'skill', value: 'Docker', sourceConversationId: conversation.id, sourceMessageId: 'statement' }), /第一人称/);
  } finally { database.close(); cleanup(dir); }
}

{
  const dir = tempDir();
  const database = createDatabase({ filename: path.join(dir, 'aspiration-fact.sqlite') });
  try {
    const user = database.createUser({ email: 'goal@example.test', name: '李四', passwordHash: 'hash' });
    const candidate = database.createCandidate(user.id, '李四');
    const conversation = database.saveConversation(user.id, { id: 'goal-conv', candidateId: candidate.id, title: '目标', messages: [{ id: 'goal', role: 'user', kind: 'text', content: '我想做AI产品经理。' }], context: {} });
    const fact = database.saveCandidateFact(user.id, candidate.id, { type: 'career_preference', value: 'AI产品经理', sourceConversationId: conversation.id, sourceMessageId: 'goal' });
    assert.equal(fact.status, 'user_asserted');
    assert.equal(fact.value, 'AI产品经理');
  } finally { database.close(); cleanup(dir); }
}
