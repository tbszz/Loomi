import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import http from 'node:http';

await test('record expansion uses only owned encrypted profile counts and invalidates the scan', async () => {
  const { createApplicationRouter } = await import('./applicationRoutes.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-rows-api-'));
  let owned = true, received, checks = 0;
  const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
  const database = { getConversation: (u,t) => owned && u === 'a' && t === 't' ? { candidateId: 'c' } : null, getCandidate: (u,c) => u === 'a' && c === 'c' ? { id: c } : null, listCandidateFacts: () => [] };
  const driver = { scan: async () => ({ scanId: 'old', fields: [] }), ensureRows: async (_scope, input) => { received = input.records; assert.equal(input.validateScope(), true); checks++; return { added: 1, pending: 0, results: [] }; }, fill: async () => ({ results: [], filled: 0 }) };
  try {
    const { service } = createApplicationRouter({ database, dataDir: dir, browserService: driver });
    await service.saveProfile(scope, { education: [{ school: '大学一' }, { school: '大学二' }], projects: [{ name: '项目一' }], awards: [{ name: '奖项一' }], campusLeadership: [{ organization: '社团一' }] });
    await service.scan(scope);
    const result = await service.ensureRows(scope);
    assert.equal(result.added, 1);
    assert.deepEqual(received, { education: 2, employment: 0, projects: 1, awards: 1, campusLeadership: 1 });
    assert.equal(checks, 1);
    await assert.rejects(service.fill(scope, { scanId: 'old' }), /失效/);
    owned = false;
    await assert.rejects(service.ensureRows(scope), /不属于/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('verified upload receipts leave pending while selected-only and failed attachments remain pending', async () => {
  const { createApplicationRouter } = await import('./applicationRoutes.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-receipt-summary-'));
  const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
  const documents = [0,1,2].map(index=>({id:`d${index}`,candidateId:'c',conversationId:'t',name:`fixture${index}.txt`,mimeType:'text/plain'}));
  const database = { getConversation: () => ({ candidateId: 'c' }), getCandidate: () => ({ id: 'c' }), listCandidateFacts: () => [], listDocuments: () => documents };
  const statuses = ['attachment_uploaded', 'attachment_selected', 'failed'];
  const driver = { scan: async () => ({ scanId: 's', fields: statuses.map((_, index) => ({ id: `f${index}`, type: 'file', label: '附件' })) }), fill: async (_scope,{answers}) => {
    assert.equal(answers.length,3);
    return { filled: 0, results: statuses.map((status,index) => ({fieldId:`f${index}`,status})) };
  } };
  try {
    const { service } = createApplicationRouter({ database, dataDir: dir, browserService: driver });
    await mkdir(path.join(dir,'uploads','a'),{recursive:true});
    for (const document of documents) await writeFile(path.join(dir,'uploads','a',document.id),'synthetic fixture');
    await service.scan(scope);
    const result = await service.fill(scope, { scanId: 's', attachments: documents.map((document,index)=>({fieldId:`f${index}`,documentId:document.id})) });
    assert.equal(result.filled, 0, 'content writes and attachment receipts have separate counts');
    assert.equal(result.uploadedAttachments, 1);
    assert.equal(result.selectedAttachments, 1);
    assert.equal(result.pending, 2);
  } finally {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('application-receipt-summary-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

await test('application API enforces scoped ownership, local clients and private profile responses', async () => {
  const { createApplicationRouter } = await import('./applicationRoutes.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-api-'));
  const database = { getConversation: (owner, id) => owner === 'a' && id === 't' ? { id, candidateId: 'c' } : null, getCandidate: (owner, id) => owner === 'a' && id === 'c' ? { id } : null, listCandidateFacts: () => [] };
  const driver = { status: () => ({ connected: false }), scan: async () => ({ scanId: 'scan', fields: [{ id: 'f', label: '姓名', type: 'text', occupied: false }] }), fill: async (_scope, { answers }) => ({ results: answers.map(item => ({ fieldId: item.fieldId, status: 'filled' })), filled: answers.length, finalSubmission: 'manual' }) };
  const { router, service } = createApplicationRouter({ database, dataDir: dir, browserService: driver });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.get('user') || 'a' }; next(); });
  app.use('/api/conversations/:id/application', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/conversations/t/application`;
  const request = (suffix, data, headers = {}) => fetch(base + suffix, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
  try {
    assert.equal((await request('/status', null, { user: 'b' })).status, 404);
    assert.equal((await request('/status', null, { 'x-forwarded-for': '203.0.113.10' })).status, 403);
    const saved = await (await request('/profile', { profile: { name: '张三', identityNumber: '110101199001011234' } })).json();
    assert.ok(!JSON.stringify(saved).includes('110101199001011234'));
    const scanned = await (await request('/scan', {})).json();
    assert.equal(scanned.scanId, 'scan');
    const result = await (await request('/fill', { scanId: 'scan' })).json();
    assert.equal(result.filled, 1);
    assert.ok(!JSON.stringify(result).includes('张三'));
    await assert.rejects(service.fill({ userId: 'b', candidateId: 'c', conversationId: 't' }, {}));
    let release;
    driver.fill = async () => { await new Promise(resolve => { release = resolve; }); return { results: [], filled: 0 }; };
    const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
    const running = service.fill(scope, { scanId: 'scan' });
    while (!release) await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(service.saveProfile(scope, { name: '替换姓名' }), /进行中/);
    await assert.rejects(service.fill(scope, { scanId: 'scan' }), /进行中/);
    release(); await running;
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

await test('application fill aborts when the response connection closes after a complete POST', async () => {
  const { createApplicationRouter } = await import('./applicationRoutes.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-api-abort-'));
  const database = { getConversation: (owner, id) => owner === 'a' && id === 't' ? { id, candidateId: 'c' } : null, getCandidate: (owner, id) => owner === 'a' && id === 'c' ? { id } : null, listCandidateFacts: () => [] };
  let fillStarted;
  let releaseFill;
  const fillStartedPromise = new Promise(resolve => { fillStarted = resolve; });
  const releasedPromise = new Promise(resolve => { releaseFill = resolve; });
  let abortObserved;
  const abortObservedPromise = new Promise(resolve => { abortObserved = resolve; });
  const driver = {
    status: () => ({ connected: false }),
    scan: async () => ({ scanId: 'scan', fields: [{ id: 'f', label: '姓名', type: 'text', occupied: false }] }),
    fill: async (_scope, { signal }) => {
      fillStarted();
      signal.addEventListener('abort', () => abortObserved(true), { once: true });
      if (signal.aborted) abortObserved(true);
      await Promise.race([releasedPromise, new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))]);
      signal.throwIfAborted();
      return { results: [], filled: 0, finalSubmission: 'manual' };
    }
  };
  const { router } = createApplicationRouter({ database, dataDir: dir, browserService: driver });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'a' }; next(); });
  app.use('/api/conversations/:id/application', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/conversations/t/application`;
  try {
    await fetch(`${base}/profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { name: '张三' } }) });
    await fetch(`${base}/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const req = http.request(`${base}/fill`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    req.on('error', () => {});
    req.end(JSON.stringify({ scanId: 'scan' }));
    await fillStartedPromise;
    req.destroy();
    const observed = await Promise.race([
      abortObservedPromise,
      new Promise(resolve => setTimeout(() => resolve(false), 150))
    ]);
    assert.equal(observed, true);
  } finally {
    releaseFill();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

await test('application service propagates typed decision evidence without returning filled personal values', async () => {
  const { createApplicationRouter } = await import('./applicationRoutes.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-jev-'));
  const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
  const database = { getConversation: (owner, id) => owner === 'a' && id === 't' ? { id, candidateId: 'c' } : null, getCandidate: (owner, id) => owner === 'a' && id === 'c' ? { id } : null, listCandidateFacts: () => [] };
  const driver = { scan: async () => ({ scanId: 'scan', fields: [{ id: 'f', label: '教育程度', type: 'text' }] }), fill: async (_scope, { answers }) => { assert.equal(answers[0]?.value, '本科'); return { results: [{ fieldId: 'f', status: 'filled' }], filled: 1 }; } };
  const decisionClient = async request => { assert.ok(!JSON.stringify(request).includes('本科')); return { model: 'jev-fixture', answers: { field_0: { type: 'choice', choice: 'degree', confidence: .95, probabilities: { degree: .99, none: .01 } } } }; };
  try {
    const { service } = createApplicationRouter({ database, dataDir: dir, browserService: driver, decisionClient });
    await service.saveProfile(scope, { degree: '本科' });
    await service.scan(scope);
    const result = await service.fill(scope, { scanId: 'scan' });
    assert.equal(result.realJevCalled, true);
    assert.equal(result.decisionStatus, 'succeeded');
    assert.equal(result.decisions[0].choice, 'degree');
    assert.ok(!JSON.stringify(result).includes('本科'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('facts revoked or replaced while Jev runs cannot become webpage answers', async () => {
  const { createApplicationRouter } = await import('./applicationRoutes.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'application-source-race-'));
  const scope = { userId: 'a', candidateId: 'c', conversationId: 't' };
  const original = { id: 'contact', type: 'contact', value: 'fixture@example.test', sourceQuote: 'fixture@example.test', sourceId: 'd', status: 'verified' };
  let current = [original];
  let bound = true;
  let change;
  const written = [];
  const database = { getConversation: () => bound ? { id: 't', candidateId: 'c' } : null, getCandidate: () => ({ id: 'c' }), listCandidateFacts: () => current };
  const driver = { scan: async () => ({ scanId: 's', fields: [{ id: 'email', label: '邮箱', type: 'email' }, { id: 'degree', label: '教育程度', type: 'text' }] }), fill: async (_scope, { answers }) => { written.push(...answers); return { results: answers.map(answer => ({ fieldId: answer.fieldId, status: 'filled' })), filled: answers.length }; } };
  const decisionClient = async () => {
    change();
    return { model: 'jev-fixture', answers: { field_0: { type: 'choice', choice: 'degree', confidence: .99, probabilities: { degree: .99, none: .01 } } } };
  };
  try {
    const { service } = createApplicationRouter({ database, dataDir: dir, browserService: driver, decisionClient });
    await service.saveProfile(scope, { degree: '本科' });
    for (const replacement of [[], [{ ...original, status: 'disputed' }], [{ ...original, status: 'disabled' }], [{ ...original, value: 'changed@example.test', sourceQuote: 'changed@example.test' }]]) {
      current = [original]; written.length = 0;
      change = () => { current = replacement; };
      await service.scan(scope);
      const result = await service.fill(scope, { scanId: 's' });
      assert.equal(written.some(answer => answer.fieldId === 'email'), false);
      assert.equal(written.some(answer => answer.fieldId === 'degree'), true);
      assert.equal(result.results.find(item => item.fieldId === 'email')?.status, 'missing_evidence');
    }
    written.length = 0; current = [original];
    change = () => { bound = false; };
    await service.scan(scope);
    await assert.rejects(service.fill(scope, { scanId: 's' }), /会话不存在/);
    assert.equal(written.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
