import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createDatabase } from './database.js';
import { extractCandidateMaterial } from './candidateKnowledge.js';
import { createCandidateRetrieval } from './candidateRetrieval.js';

const ZHANG_TEXT = '张三\n教育经历\n郑州轻工业大学计算机本科\n项目经历\nGreenSteps 项目使用 React 开发\n技能\nReact';
const LI_TEXT = '李四\n教育经历\n某某大学英语本科\n项目经历\n校园公众号内容运营\n技能\n内容写作';
const ZHANG_PROFILE = { name: '张三', education: ['郑州轻工业大学计算机本科'], projects: ['GreenSteps 项目使用 React 开发'], skills: ['React'] };
const LI_PROFILE = { name: '李四', education: ['某某大学英语本科'], projects: ['校园公众号内容运营'], skills: ['内容写作'] };

// A Candidate KB read must never depend on which Conversation is asking, so the
// fixture never passes a conversation id into retrieval.
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'resume-retrieval-'));
  const database = createDatabase({ filename: path.join(directory, 'state.sqlite') });
  const alice = database.createUser({ email: 'alice@example.com', name: 'Alice', passwordHash: 'hash-a' });
  const bob = database.createUser({ email: 'bob@example.com', name: 'Bob', passwordHash: 'hash-b' });
  const ingest = (userId, candidateId, documentId, name, text, profile) => {
    const conversationId = `conv-${documentId}`;
    database.saveConversation(userId, { id: conversationId, candidateId, title: name, messages: [], context: {} });
    const document = database.saveDocument(userId, { id: documentId, conversationId, candidateId, name, mimeType: 'text/plain', text });
    const { facts, chunks } = extractCandidateMaterial(document, profile);
    database.saveCandidateMaterial(userId, candidateId, document, facts, chunks);
    return document;
  };
  return { directory, database, alice, bob, ingest, retrieve: createCandidateRetrieval(database) };
}

async function withFixture(run) {
  const { directory, database, retrieve, ...rest } = fixture();
  try { await run({ database, retrieve, ...rest }); }
  finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
}

await test('a fact read from the Candidate KB keeps its verbatim source quote and document', async () => {
  await withFixture(({ database, retrieve, alice, ingest }) => {
    const zhang = database.createCandidate(alice.id, '张三');
    const document = ingest(alice.id, zhang.id, 'doc-zhang', 'zhang-resume.txt', ZHANG_TEXT, ZHANG_PROFILE);

    const pack = retrieve({ userId: alice.id, candidateId: zhang.id, query: 'React' });
    const fact = pack.facts.find(item => item.value === 'React');
    assert.ok(fact, 'a grounded skill fact is retrievable');
    assert.equal(fact.sourceQuote, 'React');
    // Provenance must be checkable against the original document text.
    assert.equal(document.text.slice(fact.sourcePosition, fact.sourcePosition + fact.sourceQuote.length), fact.sourceQuote);
    assert.equal(fact.documentId, document.id);
    assert.equal(fact.documentName, 'zhang-resume.txt');
    assert.equal(fact.status, 'user_asserted');
    assert.ok(pack.passages.some(passage => passage.text.includes('GreenSteps')));
    assert.deepEqual(pack.sources.map(source => source.documentId), [document.id]);
    assert.equal(pack.candidate.name, '张三');
  });
});

await test('a second conversation bound to the same candidate still reads the same background', async () => {
  await withFixture(({ database, retrieve, alice, ingest }) => {
    const zhang = database.createCandidate(alice.id, '张三');
    ingest(alice.id, zhang.id, 'doc-zhang', 'zhang-resume.txt', ZHANG_TEXT, ZHANG_PROFILE);
    // Conversation B never uploaded anything; the background still answers.
    database.saveConversation(alice.id, { id: 'conv-zhang-second', candidateId: zhang.id, title: '第二次对话', messages: [], context: {} });

    const pack = retrieve({ userId: alice.id, candidateId: zhang.id, query: 'GreenSteps' });
    assert.ok(pack.facts.some(fact => fact.value.includes('GreenSteps')));
    assert.ok(pack.passages.some(passage => passage.documentName === 'zhang-resume.txt'));
  });
});

await test('candidate B never reads candidate A facts or documents', async () => {
  await withFixture(({ database, retrieve, alice, ingest }) => {
    const zhang = database.createCandidate(alice.id, '张三');
    const li = database.createCandidate(alice.id, '李四');
    ingest(alice.id, zhang.id, 'doc-zhang', 'zhang-resume.txt', ZHANG_TEXT, ZHANG_PROFILE);
    ingest(alice.id, li.id, 'doc-li', 'li-resume.txt', LI_TEXT, LI_PROFILE);

    const liPack = retrieve({ userId: alice.id, candidateId: li.id, query: 'React' });
    assert.deepEqual(liPack.facts, []);
    assert.deepEqual(liPack.passages, []);
    assert.deepEqual(liPack.sources, []);
    assert.match(liPack.coverage.note, /没有匹配到证据/);

    const zhangPack = retrieve({ userId: alice.id, candidateId: zhang.id, query: '内容写作' });
    assert.deepEqual(zhangPack.facts, []);
    assert.ok(liPack.candidate.id !== zhangPack.candidate.id);
  });
});

await test('another user cannot read a candidate by reusing its id', async () => {
  await withFixture(({ database, retrieve, alice, bob, ingest }) => {
    const zhang = database.createCandidate(alice.id, '张三');
    ingest(alice.id, zhang.id, 'doc-zhang', 'zhang-resume.txt', ZHANG_TEXT, ZHANG_PROFILE);

    assert.throws(() => retrieve({ userId: bob.id, candidateId: zhang.id, query: 'React' }), /不属于当前账号/);
    assert.throws(() => retrieve({ userId: bob.id, candidateId: zhang.id, query: 'React' }), (error) => error.message !== '');
    // A missing scope is a failure, never an empty pack.
    assert.throws(() => retrieve({ userId: bob.id, candidateId: '', query: 'React' }), /缺少 candidateId/);
    assert.throws(() => retrieve({ userId: '', candidateId: zhang.id, query: 'React' }), /缺少 userId/);
    assert.throws(() => retrieve({ userId: alice.id, candidateId: zhang.id, query: '   ' }), /关键词为空/);
  });
});

await test('a punctuation-only query never degrades into arbitrary candidate evidence', async () => {
  await withFixture(({ database, retrieve, alice, ingest }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    ingest(alice.id, candidate.id, 'doc-zhang', 'zhang-resume.txt', ZHANG_TEXT, ZHANG_PROFILE);

    const pack = retrieve({ userId: alice.id, candidateId: candidate.id, query: '??? !!! 🤖' });
    assert.deepEqual(pack.facts, []);
    assert.deepEqual(pack.passages, []);
    assert.deepEqual(pack.sources, []);
    assert.match(pack.coverage.note, /没有匹配到证据/);
  });
});

await test('the evidence pack stays bounded instead of returning the whole knowledge base', async () => {
  await withFixture(({ database, retrieve, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    database.saveConversation(alice.id, { id: 'conv-bulk', candidateId: candidate.id, title: 'bulk', messages: [], context: {} });
    const factTexts=Array.from({length:12},(_,index)=>`React ${index}`);
    const passageTexts=Array.from({length:6},(_,index)=>`React 项目片段 ${index} ${'x'.repeat(500)}`);
    const text = [...factTexts,...passageTexts].join('\n');
    const document = database.saveDocument(alice.id, { id: 'doc-bulk', conversationId: 'conv-bulk', candidateId: candidate.id, name: 'bulk.txt', mimeType: 'text/plain', text });
    const facts = Array.from({ length: 12 }, (_, index) => ({
      id: `fact-${index}`, type: 'skill', value: `React ${index}`, sourceQuote: `React ${index}`,
      sourcePosition: text.indexOf(factTexts[index]), confidence: 0.8, status: 'user_asserted'
    }));
    const chunks = Array.from({ length: 6 }, (_, index) => ({
      id: `chunk-${index}`, text: passageTexts[index], start: text.indexOf(passageTexts[index]), end: text.indexOf(passageTexts[index])+passageTexts[index].length
    }));
    database.saveCandidateMaterial(alice.id, candidate.id, document, facts, chunks);

    const pack = retrieve({ userId: alice.id, candidateId: candidate.id, query: 'React' });
    assert.equal(pack.facts.length, 8);
    assert.equal(pack.passages.length, 4);
    assert.equal(pack.coverage.truncated, true);
    const total = [...pack.facts.map(fact => fact.value + fact.sourceQuote), ...pack.passages.map(passage => passage.text)]
      .reduce((sum, value) => sum + value.length, 0);
    assert.ok(total <= 4000, `evidence pack must stay bounded, got ${total} characters`);
  });
});

await test('long facts leave room for matching source passages in the bounded evidence pack', async () => {
  await withFixture(({ database, retrieve, alice }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    database.saveConversation(alice.id, { id: 'conv-long-facts', candidateId: candidate.id, title: 'long facts', messages: [], context: {} });
    const longFact = index => `React 复杂项目职责 ${index} ${'事实'.repeat(220)}`;
    const passageText = 'React 原文证据片段 保留项目上下文和来源 ' + '材料'.repeat(120);
    const factTexts = Array.from({ length: 8 }, (_, index) => longFact(index));
    const chunkTexts = [passageText, 'React 第二段原文证据 ' + '材料'.repeat(120)];
    const text = [...factTexts, ...chunkTexts].join('\n');
    const document = database.saveDocument(alice.id, { id: 'doc-long-facts', conversationId: 'conv-long-facts', candidateId: candidate.id, name: 'long-facts.txt', mimeType: 'text/plain', text });
    const facts = factTexts.map((value, index) => ({
      id: `long-fact-${index}`, type: 'project', value, sourceQuote: value,
      sourcePosition: text.indexOf(value), confidence: 0.8, status: 'user_asserted'
    }));
    const chunks = chunkTexts.map((value, index) => ({
      id: `long-chunk-${index}`, text: value, start: text.indexOf(value), end: text.indexOf(value) + value.length
    }));
    database.saveCandidateMaterial(alice.id, candidate.id, document, facts, chunks);

    const pack = retrieve({ userId: alice.id, candidateId: candidate.id, query: 'React' });

    assert.ok(pack.facts.length > 0, 'facts still contribute evidence');
    assert.ok(pack.facts.length <= 8);
    assert.ok(pack.passages.some(passage => passage.text.includes('原文证据片段')), 'source passages must not be starved by long facts');
    assert.ok(pack.passages.length <= 4);
    assert.equal(pack.sources[0].documentId, document.id);
    const total = [...pack.facts.map(fact => fact.value + fact.sourceQuote), ...pack.passages.map(passage => passage.text)]
      .reduce((sum, value) => sum + value.length, 0);
    assert.ok(total <= 4000, `evidence pack must stay bounded, got ${total} characters`);
  });
});

await test('a type filter narrows the pack and never widens the scope', async () => {
  await withFixture(({ database, retrieve, alice, ingest }) => {
    const zhang = database.createCandidate(alice.id, '张三');
    ingest(alice.id, zhang.id, 'doc-zhang', 'zhang-resume.txt', ZHANG_TEXT, ZHANG_PROFILE);

    const projects = retrieve({ userId: alice.id, candidateId: zhang.id, query: 'React', type: 'project' });
    assert.ok(projects.facts.length > 0);
    assert.ok(projects.facts.every(fact => fact.type === 'project'));

    const education = retrieve({ userId: alice.id, candidateId: zhang.id, query: 'React', type: 'education' });
    assert.deepEqual(education.facts, []);
    assert.ok(education.passages.length > 0, 'passages stay available even when the fact type has no match');
  });
});

// A real question names a kind of fact rather than a keyword, and section headings
// are never stored as facts, so a purely keyword read would find nothing.
await test('a question that names a kind of fact returns that kind', async () => {
  await withFixture(({ database, retrieve, alice, ingest }) => {
    const zhang = database.createCandidate(alice.id, '张三');
    ingest(alice.id, zhang.id, 'doc-zhang', 'zhang-resume.txt', ZHANG_TEXT, ZHANG_PROFILE);

    const pack = retrieve({ userId: alice.id, candidateId: zhang.id, query: '我之前上传过哪些项目经历' });
    assert.ok(pack.facts.length > 0, 'the question must reach the project facts');
    assert.ok(pack.facts.every(fact => fact.type === 'project'));
    assert.equal(retrieve({ userId: alice.id, candidateId: zhang.id, query: '我的教育经历' }).facts.every(fact => fact.type === 'education'), true);
  });
});

// Chinese has no word boundaries, so a long phrase must not be treated as one token.
await test('a long Chinese phrase still matches fact text', async () => {
  await withFixture(({ database, retrieve, alice, ingest }) => {
    const li = database.createCandidate(alice.id, '李四');
    ingest(alice.id, li.id, 'doc-li', 'li-resume.txt', LI_TEXT, LI_PROFILE);

    const pack = retrieve({ userId: alice.id, candidateId: li.id, query: '校园公众号内容运营做得怎么样' });
    assert.ok(pack.facts.some(fact => fact.value === '校园公众号内容运营'), 'overlapping tokens must match real fact text');
  });
});

await test('chat evidence preserves message provenance across conversations',async()=>{
  await withFixture(({database,retrieve,alice})=>{
    const candidate=database.createCandidate(alice.id,'张三');
    database.saveConversation(alice.id,{id:'assertion-source',candidateId:candidate.id,messages:[{id:'statement',role:'user',content:'我使用 React 完成页面开发。'}]});
    database.saveCandidateFact(alice.id,candidate.id,{type:'project',value:'使用 React 完成页面开发',quote:'我使用 React 完成页面开发',sourceConversationId:'assertion-source',sourceMessageId:'statement'});
    const pack=retrieve({userId:alice.id,candidateId:candidate.id,query:'React'});
    assert.equal(pack.facts[0].sourceConversationId,'assertion-source');
    assert.equal(pack.facts[0].sourceMessageId,'statement');
    assert.equal(pack.facts[0].documentId,null);
  });
});

await test('without an embedding provider retrieval stays synchronous and reports semantic unconfigured', async () => {
  await withFixture(({ database, alice, ingest }) => {
    const candidate = database.createCandidate(alice.id, '张三');
    ingest(alice.id, candidate.id, 'doc-zhang', 'zhang-resume.txt', ZHANG_TEXT, ZHANG_PROFILE);
    const retrieve = createCandidateRetrieval(database);

    const pack = retrieve({ userId: alice.id, candidateId: candidate.id, query: 'React' });

    assert.equal(typeof pack.then, 'undefined', 'legacy callers still receive a plain evidence pack');
    assert.equal(pack.coverage.semantic.status, 'unconfigured');
    assert.ok(pack.facts.some(fact => fact.value === 'React'));
  });
});
