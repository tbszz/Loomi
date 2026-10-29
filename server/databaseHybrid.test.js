import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase, indexTokens } from "./database.js";
import { test } from 'node:test';
import { buildClaimEvidence } from './claimEvidence.js';

function assertedFact(db,userId,candidateId,{type,value,quote}) {
  const id=`asserted-${crypto.randomUUID()}`;
  const statement=`我的${type}信息是：${value}`;
  db.saveConversation(userId,{id,candidateId,messages:[{id:'m1',role:'user',content:statement}]});
  return db.saveCandidateFact(userId,candidateId,{type,value,quote:quote || value,sourceConversationId:id,sourceMessageId:'m1'});
}

await test('domain ownership and claim evidence are enforced at the write boundary',()=>{
  const db=createDatabase({filename:':memory:'});
  try {
    const user=db.createUser({email:'truth@example.test',name:'truth',passwordHash:'x'});
    const a=db.createCandidate(user.id,'A'), b=db.createCandidate(user.id,'B');
    const convo=db.saveConversation(user.id,{id:'ca',candidateId:a.id,messages:[]});
    const job=db.saveTargetJob(user.id,a.id,{conversationId:convo.id,title:'JD A',description:'描述'});
    assert.throws(()=>db.saveTargetJob(user.id,b.id,{id:job.id,title:'changed',description:'wrong'}),/求职者|归属/);
    assert.throws(()=>db.saveTargetJob(user.id,b.id,{conversationId:convo.id,title:'x',description:'wrong'}),/求职者|归属/);
    const fact=assertedFact(db,user.id,a.id,{type:'skill',value:'React'});
    const foreign=assertedFact(db,user.id,b.id,{type:'skill',value:'React'});
    const content={skills:['React']};
    const claims=buildClaimEvidence(content,{facts:[fact]});
    for(const factIds of [[],['missing'],[foreign.id]]) assert.throws(()=>db.saveResumeVariant(user.id,a.id,{content,claims:[{...claims[0],factIds}]}),/证据|事实/);
    const saved=db.saveResumeVariant(user.id,a.id,{conversationId:convo.id,targetJobId:job.id,content,claims});
    assert.equal(db.assertResumeVariantGrounded(user.id,a.id,saved.variantId).id,saved.variantId);
    db.raw.prepare("UPDATE candidate_facts SET status='disabled' WHERE id=?").run(fact.id);
    assert.throws(()=>db.assertResumeVariantGrounded(user.id,a.id,saved.variantId),/证据|事实/);
  } finally {db.close();}
});

await test('user assertions need a bound real user message and preserve conflicts',()=>{
  const db=createDatabase({filename:':memory:'});
  try {
    const user=db.createUser({email:'assertions@example.test',name:'truth',passwordHash:'x'});
    const c=db.createCandidate(user.id,'A');
    assert.throws(()=>db.saveCandidateFact(user.id,c.id,{type:'skill',value:'React'}),/来源|会话|消息/);
    db.saveConversation(user.id,{id:'s',candidateId:c.id,messages:[{id:'jd',role:'user',content:'JD要求：熟练使用 React。'},{id:'assistant',role:'assistant',content:'我使用 React'}]});
    for (const sourceMessageId of ['jd','assistant']) assert.throws(()=>db.saveCandidateFact(user.id,c.id,{type:'skill',value:'React',sourceConversationId:'s',sourceMessageId}),/用户|陈述|事实/);
    const misleading=['我的朋友使用 React。','我希望学习 React。','请把“我使用 React”写进简历。','我没有使用 React。'];
    for(const [index,content] of misleading.entries()) {
      db.saveConversation(user.id,{id:`misleading-${index}`,candidateId:c.id,messages:[{id:'m',role:'user',content}]});
      assert.throws(()=>db.saveCandidateFact(user.id,c.id,{type:'skill',value:'React',sourceConversationId:`misleading-${index}`,sourceMessageId:'m'}),/用户|陈述|事实/);
    }
    const first=assertedFact(db,user.id,c.id,{type:'contact',value:'a@example.com'});
    const second=assertedFact(db,user.id,c.id,{type:'contact',value:'b@example.com'});
    assert.equal(first.status,'user_asserted');
    assert.equal(second.status,'disputed');
    assert.equal(db.listUserAssertedFacts(user.id,c.id).find(f=>f.id===first.id).status,'disputed');
    assert.equal(assertedFact(db,user.id,c.id,{type:'contact',value:'a@example.com'}).status,'disputed','repeating one side cannot silently resolve a conflict');
    assert.deepEqual(db.searchCandidateKnowledge(user.id,c.id,'!!!'),{facts:[],chunks:[]});
  } finally {db.close();}
});

await test('source document ownership, spans and fact lifecycle are authoritative',()=>{
  const db=createDatabase({filename:':memory:'});
  try {
    const user=db.createUser({email:'spans@example.test',name:'truth',passwordHash:'x'});
    const a=db.createCandidate(user.id,'A'),b=db.createCandidate(user.id,'B');
    db.saveConversation(user.id,{id:'span-c',candidateId:a.id,messages:[]});
    const document=db.saveDocument(user.id,{id:'span-doc',conversationId:'span-c',text:'项目未使用 Java。',mimeType:'text/plain'});
    const fact={id:'span-f',type:'skill',value:'Java',sourceQuote:'Java',sourcePosition:6,confidence:1,status:'user_asserted'};
    assert.throws(()=>db.saveCandidateMaterial(user.id,b.id,{...document,candidateId:b.id},[fact],[]),/来源|归属/);
    assert.throws(()=>db.saveCandidateMaterial(user.id,a.id,document,[fact],[]),/来源|否定/);
    assert.throws(()=>db.saveResumeVariant(user.id,a.id,{content:{madeUp:'claim'},claims:[]}),/事实|证据/);
  } finally {db.close();}
});

await test('FTS startup rebuilds pre-indexed rows and deletion removes document facts',()=>{
  const dir=tempDir();
  const filename=path.join(dir,'rebuild.sqlite');
  let db;
  try {
    db=createDatabase({filename});
    const user=db.createUser({email:'rebuild@example.test',name:'truth',passwordHash:'x'});
    const c=db.createCandidate(user.id,'A');
    db.setRetrievalMode('fallback');
    assertedFact(db,user.id,c.id,{type:'project',value:'legacyproject'});
    db.close();
    db=createDatabase({filename});
    assert.ok(db.searchCandidateKnowledge(user.id,c.id,'legacyproject').facts.length);
    db.saveConversation(user.id,{id:'delete-c',candidateId:c.id,messages:[]});
    const document=db.saveDocument(user.id,{id:'delete-doc',conversationId:'delete-c',text:'React',mimeType:'text/plain'});
    db.saveCandidateMaterial(user.id,c.id,document,[{id:'delete-f',type:'skill',value:'React',sourceQuote:'React',sourcePosition:0,confidence:1,status:'user_asserted'}],[]);
    db.deleteDocument(user.id,document.id);
    assert.equal(db.searchCandidateKnowledge(user.id,c.id,'React').facts.length,0);
  } finally {db?.close(); cleanup(dir);}
});

await test('changed source text invalidates old facts and persisted artifacts',()=>{
  const db=createDatabase({filename:':memory:'});
  try {
    const user=db.createUser({email:'source-change@example.test',name:'truth',passwordHash:'x'});
    const c=db.createCandidate(user.id,'A');
    db.saveConversation(user.id,{id:'change-c',candidateId:c.id,messages:[]});
    const document=db.saveDocument(user.id,{id:'change-doc',conversationId:'change-c',text:'React',mimeType:'text/plain'});
    const fact={id:'change-f',type:'skill',value:'React',sourceQuote:'React',sourcePosition:0,confidence:1,status:'user_asserted'};
    db.saveCandidateMaterial(user.id,c.id,document,[fact],[]);
    const content={skills:['React']},claims=buildClaimEvidence(content,{facts:[fact]});
    const variant=db.saveResumeVariant(user.id,c.id,{content,claims});
    db.saveDocument(user.id,{...document,text:'Python'});
    assert.equal(db.searchCandidateKnowledge(user.id,c.id,'React').facts.length,0);
    assert.throws(()=>db.assertResumeVariantGrounded(user.id,c.id,variant.variantId),/证据|事实/);
  } finally {db.close();}
});

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "resume-protocol-db-hybrid-"));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// 1. Fresh DB: new tables, agent_session_id column, retrieval capability flag.
{
  const dir = tempDir();
  let db;
  try {
    db = createDatabase({ filename: path.join(dir, "fresh.sqlite") });
    assert.ok(["fts5", "fallback"].includes(db.retrievalMode), "retrievalMode must be fts5 or fallback");
    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    for (const table of ["target_jobs", "resume_variants", "claim_evidence"]) {
      assert.ok(tables.includes(table), `${table} must exist`);
    }
    const columns = db.raw.prepare("PRAGMA table_info(conversations)").all().map(column => column.name);
    assert.ok(columns.includes("agent_session_id"), "conversations.agent_session_id must exist");
  } finally { db?.close(); cleanup(dir); }
}

// 2. Legacy DB: idempotent migration adds the column and new tables.
{
  const dir = tempDir();
  const filename = path.join(dir, "legacy.sqlite");
  let migrated;
  try {
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE conversations (id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,id));
      INSERT INTO users VALUES ('u1','legacy@example.com','Legacy','hash','2026-09-01T00:00:00.000Z');
      INSERT INTO conversations VALUES ('c1','u1','old',JSON_OBJECT('id','c1','title','old'),1,1);
    `);
    legacy.close();
    migrated = createDatabase({ filename });
    const columns = migrated.raw.prepare("PRAGMA table_info(conversations)").all().map(column => column.name);
    assert.ok(columns.includes("agent_session_id"));
    const tables = migrated.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    assert.ok(["target_jobs", "resume_variants", "claim_evidence"].every(t => tables.includes(t)));
    // Round 2: reopening is idempotent.
    migrated.close();
    migrated = createDatabase({ filename });
    assert.equal(migrated.getConversation("u1", "c1").title, "old");
  } finally { migrated?.close(); cleanup(dir); }
}

// 3. agentSessionId round-trip (column is source of truth, hydrated into data JSON).
{
  const dir = tempDir();
  let db;
  try {
    db = createDatabase({ filename: path.join(dir, "session.sqlite") });
    const user = db.createUser({ email: "a@example.com", name: "A", passwordHash: "h" });
    const conversation = db.saveConversation(user.id, { id: "conv-1", title: "t", agentSessionId: "sess-123", messages: [] });
    assert.equal(conversation.agentSessionId, "sess-123");
    assert.equal(db.getConversation(user.id, "conv-1").agentSessionId, "sess-123");
    db.close();
    db = createDatabase({ filename: path.join(dir, "session.sqlite") });
    assert.equal(db.getConversation(user.id, "conv-1").agentSessionId, "sess-123", "agentSessionId survives reopen");
    // Saving without one keeps the last known session id.
    db.saveConversation(user.id, { id: "conv-1", title: "t2", messages: [] });
    assert.equal(db.getConversation(user.id, "conv-1").agentSessionId, "sess-123");
    assert.equal(db.getConversation("someone-else", "conv-1"), null);
  } finally { db?.close(); cleanup(dir); }
}

// 4. Target jobs + resume variants + claim evidence, ownership isolation.
{
  const dir = tempDir();
  let db;
  try {
    db = createDatabase({ filename: path.join(dir, "variants.sqlite") });
    const alice = db.createUser({ email: "alice@example.com", name: "Alice", passwordHash: "h" });
    const bob = db.createUser({ email: "bob@example.com", name: "Bob", passwordHash: "h" });
    const candidateA = db.createCandidate(alice.id, "候选A");
    const candidateB = db.createCandidate(alice.id, "候选B");

    const fact = assertedFact(db,alice.id, candidateA.id, { type: "skill", value: "熟练使用 React" });
    assert.equal(fact.sourceType, "user_asserted");
    assert.ok(fact.sourceId.startsWith('asserted-'));
    assert.equal(fact.sourceQuote, "熟练使用 React");
    assert.equal(fact.confidence, 1);
    assert.equal(fact.status, "user_asserted");
    assert.throws(() => db.saveCandidateFact(alice.id, candidateA.id, { type: "made_up", value: "x" }), /未知的事实类型/);
    assert.throws(() => db.saveCandidateFact(bob.id, candidateA.id, { type: "skill", value: "x" }), /求职者不存在/);

    db.saveConversation(alice.id,{id:'conv-1',candidateId:candidateA.id,messages:[]});
    const job = db.saveTargetJob(alice.id, candidateA.id, {
      conversationId: "conv-1",
      title: "前端工程师",
      company: "Acme",
      description: "负责 Web 前端开发",
      requirements: [{ text: "3年以上经验" }],
      role: "frontend",
      source: "manual"
    });
    assert.equal(job.title, "前端工程师");
    assert.deepEqual(job.requirements, [{ text: "3年以上经验" }]);
    // Upsert by id.
    const job2 = db.saveTargetJob(alice.id, candidateA.id, { id: job.id, title: "前端工程师（高级）", description: "d" });
    assert.equal(job2.title, "前端工程师（高级）");
    assert.equal(db.getTargetJob(bob.id, candidateA.id, job.id), null);
    assert.equal(db.getTargetJob(alice.id, candidateB.id, job.id), null);

    const result = db.saveResumeVariant(alice.id, candidateA.id, {
      conversationId: "conv-1",
      targetJobId: job.id,
      title: "定制简历 v1",
      role: "frontend",
      content: {skills:['React']},
      claims: [{ field:'skills.0',claimText: "React", factIds: [fact.id] }]
    });
    assert.ok(result.variantId);
    assert.equal(result.claimCount, 1);

    const variants = db.listResumeVariants(alice.id, candidateA.id);
    assert.equal(variants.length, 1);
    assert.deepEqual(variants[0].content, {skills:['React']});
    assert.equal(db.listResumeVariants(alice.id, candidateA.id, { conversationId: "conv-1" }).length, 1);
    assert.equal(db.listResumeVariants(alice.id, candidateA.id, { conversationId: "conv-9" }).length, 0);
    assert.equal(db.listResumeVariants(alice.id, candidateB.id).length, 0);
    assert.equal(db.listResumeVariants(bob.id, candidateA.id).length, 0);

    const detail = db.getResumeVariant(alice.id, candidateA.id, result.variantId);
    assert.equal(detail.claims.length, 1);
    assert.deepEqual(detail.claims[0].factIds, [fact.id]);
    assert.equal(detail.targetJobId, job.id);
    // Wrong owner / wrong candidate must throw, not return data.
    assert.throws(() => db.getResumeVariant(bob.id, candidateA.id, result.variantId), /简历版本不存在/);
    assert.throws(() => db.getResumeVariant(alice.id, candidateB.id, result.variantId), /简历版本不存在/);
    // Bob cannot save over Alice's variant id (using Bob's own candidate).
    const candidateBob = db.createCandidate(bob.id, "候选Bob");
    assert.throws(() => db.saveResumeVariant(bob.id, candidateBob.id, { id: result.variantId, content: "stolen" }), /另一个用户/);
    // Variant referencing another candidate's target job is rejected.
    assert.throws(() => db.saveResumeVariant(alice.id, candidateB.id, { targetJobId: job.id, content: "x" }), /目标岗位不存在/);
  } finally { db?.close(); cleanup(dir); }
}

// 5. Hybrid retrieval: user-asserted facts are searchable; Han bigram query matches; isolation holds.
{
  const dir = tempDir();
  let db;
  try {
    db = createDatabase({ filename: path.join(dir, "retrieval.sqlite") });
    assert.equal(db.retrievalMode, "fts5", "expected FTS5 on this node:sqlite build");
    const alice = db.createUser({ email: "alice@example.com", name: "Alice", passwordHash: "h" });
    const bob = db.createUser({ email: "bob@example.com", name: "Bob", passwordHash: "h" });
    const candidateA = db.createCandidate(alice.id, "候选A");
    const candidateB = db.createCandidate(alice.id, "候选B");

    assertedFact(db,alice.id, candidateA.id, { type: "project", value: "电商平台重构项目" });
    assertedFact(db,alice.id, candidateA.id, { type: "skill", value: "TypeScript" });
    const candidateBob = db.createCandidate(bob.id, "候选Bob");
    assertedFact(db,bob.id, candidateBob.id, { type: "project", value: "社交App项目" });

    const found = db.searchCandidateKnowledge(alice.id, candidateA.id, "项目经历", 12, { hintedTypes: ["project"] });
    assert.ok(found.facts.some(fact => fact.value === "电商平台重构项目"), "Han bigram query must match the project fact");
    assert.ok(found.facts.every(fact => fact.value !== "社交App项目"), "facts from other users/candidates must never leak");
    assert.ok(found.facts.every(fact => fact.score > 0), "FTS results need a higher-is-better score");

    const ascii = db.searchCandidateKnowledge(alice.id, candidateA.id, "typescript");
    assert.ok(ascii.facts.some(fact => fact.value === "TypeScript"), "ASCII query must match case-insensitively");

    // Wrong-owner candidate still returns empty (no throw from the search surface).
    assert.throws(()=>db.searchCandidateKnowledge(bob.id, candidateA.id, "项目"),/求职者不存在/);

    // status filter still applies in the FTS path.
    db.raw.prepare("UPDATE candidate_facts SET status='disputed' WHERE value='电商平台重构项目'").run();
    const afterDispute = db.searchCandidateKnowledge(alice.id, candidateA.id, "电商");
    assert.ok(!afterDispute.facts.some(fact => fact.value === "电商平台重构项目"), "disputed facts must stay hidden");
  } finally { db?.close(); cleanup(dir); }
}

// 6. FTS fallback path still ranks (simulated unavailable FTS5).
{
  const dir = tempDir();
  const filename = path.join(dir, "fallback.sqlite");
  let db;
  try {
    db = createDatabase({ filename });
    const alice = db.createUser({ email: "a@example.com", name: "A", passwordHash: "h" });
    const candidate = db.createCandidate(alice.id, "候选");
    // Drop the virtual table and force the fallback code path.
    db.setRetrievalMode("fallback");
    assert.equal(db.retrievalMode, "fallback");
    assertedFact(db,alice.id, candidate.id, { type: "project", value: "电商项目" });
    const found = db.searchCandidateKnowledge(alice.id, candidate.id, "电商项目", 12);
    assert.ok(found.facts.some(fact => fact.value === "电商项目"), "fallback ranking must still find the fact");
    assert.ok(found.facts[0].score > 0);
    assert.ok(indexTokens("项目经历").includes("项目"));
  } finally { db?.close(); cleanup(dir); }
}

// 7. FTS index stays in sync across saveCandidateMaterial (delete + re-insert).
{
  const dir = tempDir();
  let db;
  try {
    db = createDatabase({ filename: path.join(dir, "sync.sqlite") });
    const alice = db.createUser({ email: "a@example.com", name: "A", passwordHash: "h" });
    const conversation = db.saveConversation(alice.id, { id: "conv-1", title: "t", messages: [] });
    db.saveDocument(alice.id, { id: "doc-1", conversationId: "conv-1", name: "resume.txt", text: "旧项目名称 legacyname\n旧项目详情段落 oldchunktext", mimeType: "text/plain" });
    db.saveCandidateMaterial(alice.id, conversation.candidateId,
      { id: "doc-1", candidateId: conversation.candidateId },
      [{ id: "f-1", type: "project", value: "旧项目名称 legacyname", sourceQuote: "旧项目名称 legacyname", sourcePosition: 0, confidence: 1, status: "user_asserted" }],
      [{ id: "c-1", text: "旧项目详情段落 oldchunktext", start: 17, end: 17+'旧项目详情段落 oldchunktext'.length }]);
    let found = db.searchCandidateKnowledge(alice.id, conversation.candidateId, "legacyname");
    assert.ok(found.facts.some(fact => fact.id === "f-1"));

    // Same document re-saved with new content: FTS must not keep stale rows.
    db.saveDocument(alice.id, { id: "doc-1", conversationId: "conv-1", name: "resume.txt", text: "新项目名称 freshname\n新项目详情段落 newchunktext", mimeType: "text/plain" });
    db.saveCandidateMaterial(alice.id, conversation.candidateId,
      { id: "doc-1", candidateId: conversation.candidateId },
      [{ id: "f-1", type: "project", value: "新项目名称 freshname", sourceQuote: "新项目名称 freshname", sourcePosition: 0, confidence: 1, status: "user_asserted" }],
      [{ id: "c-1", text: "新项目详情段落 newchunktext", start: 16, end: 16+'新项目详情段落 newchunktext'.length }]);
    found = db.searchCandidateKnowledge(alice.id, conversation.candidateId, "freshname");
    assert.ok(found.facts.some(fact => fact.id === "f-1"), "reindexed fact must be findable");
    const staleFacts = db.searchCandidateKnowledge(alice.id, conversation.candidateId, "legacyname");
    const staleChunks = db.searchCandidateKnowledge(alice.id, conversation.candidateId, "oldchunktext");
    assert.ok(!staleFacts.facts.some(fact => fact.id === "f-1") && !staleChunks.chunks.some(chunk => chunk.id === "c-1"), "stale FTS rows must be gone");

    // Document delete cleans up chunk index rows.
    db.deleteDocument(alice.id, "doc-1");
    assert.equal(db.searchCandidateKnowledge(alice.id, conversation.candidateId, "newchunktext").chunks.length, 0);
  } finally { db?.close(); cleanup(dir); }
}

console.log("database hybrid tests passed");
