import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase } from './database.js';
import { createApp } from './app.js';

const material = '张三\n邮箱 zhang@example.com\n教育经历\n某大学计算机本科\n项目经历\n使用 React 开发校园商品列表和搜索页面\n技能\nReact';
const draft = { name: '张三', targetTitle: '前端开发', contact: { email: 'zhang@example.com' }, summary: '', education: ['某大学计算机本科'], skills: ['React'], projects: ['使用 React 开发校园商品列表和搜索页面'], experience: [], awards: [], gaps: [] };

async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'career-closed-'));
  const database = createDatabase({ filename: path.join(directory, 'test.sqlite') });
  let generationEvidence;
  const sessions = [];
  const model = async ({ system, messages }) => {
    if (system.includes('简历编辑')) { generationEvidence = JSON.parse(messages[0].content); return { content: [{ type: 'text', text: JSON.stringify(draft) }] }; }
    if (system.includes('简历事实审校员')) return { content: [{ type: 'text', text: JSON.stringify(draft) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ annotations: [] }) }] };
  };
  model.runTools = async ({ execute, session, messages }) => {
    sessions.push(session);
    const last = messages.at(-1)?.content || '';
    if (typeof last === 'string' && last.startsWith('READ ')) {
      const result = await execute('read_document', { document_id: last.slice(5) });
      return { content: [{ type: 'text', text: result.text }] };
    }
    await execute('select_job', { description: '前端开发岗位：使用 React 制作商品列表和搜索页面，要求计算机相关专业。', title: '前端开发', role: 'frontend' });
    await execute('generate_resume', { role: 'frontend' });
    await execute('export_resume', { format: 'pdf', template: 'campus-project', section_order: ['projects', 'education'] });
    return { sessionId: '11111111-1111-4111-8111-111111111111', content: [{ type: 'text', text: '简历已生成。' }] };
  };
  const app = createApp({ database, dataDir: directory, model });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const registered = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'closed@example.test', name: '测试', password: 'closed-loop-password42' }) });
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  const request = (url, body, method = 'GET') => fetch(base + url, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try { await run({ database, request, base, cookie, sessions, evidence: () => generationEvidence }); }
  finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); database.close(); await rm(directory, { recursive: true, force: true }); }
}

await test('new thread tailors from Candidate KB and exports only persisted grounded content', () => fixture(async ({ database, request, base, cookie, sessions, evidence }) => {
  const { candidate } = await (await request('/api/candidates', { name: '张三' }, 'POST')).json();
  const { conversation: first } = await (await request('/api/conversations', { candidateId: candidate.id }, 'POST')).json();
  const form = new FormData();
  form.append('file', new Blob([material], { type: 'text/plain' }), 'resume.txt');
  assert.equal((await fetch(`${base}/api/conversations/${first.id}/documents`, { method: 'POST', headers: { Cookie: cookie }, body: form })).status, 200);
  const { conversation: fresh } = await (await request('/api/conversations', { candidateId: candidate.id }, 'POST')).json();
  const stream = await (await request(`/api/conversations/${fresh.id}/messages`, { content: '请根据前端开发岗位：使用 React 制作商品列表和搜索页面，要求计算机相关专业。定制简历并导出。' }, 'POST')).text();
  assert.match(stream, /event: done/);
  assert.doesNotMatch(stream, /event: error/);
  const { conversation } = await (await request(`/api/conversations/${fresh.id}`)).json();
  assert.ok(conversation.context.variantId, 'artifact must be persisted before success');
  assert.equal(conversation.context.export.layout.template, 'campus-project');
  assert.match(conversation.context.export.url, /template=campus-project/);
  assert.match(conversation.context.export.url, /sectionOrder=projects/);
  assert.ok(evidence()?.evidence?.facts.length, 'generation must consume KB evidence in a fresh thread');
  assert.equal(sessions[0].scope.candidateId, candidate.id);
  assert.equal(sessions[0].scope.conversationId, fresh.id);
  const user = database.getUserByEmail('closed@example.test');
  const variant = database.getResumeVariant(user.id, candidate.id, conversation.context.variantId);
  assert.ok(variant.claims.length);
  assert.ok(variant.claims.every(claim => claim.factIds.length > 0), 'every factual claim must be supported');
  const linked = await (await request(`/api/conversations/${fresh.id}/resume-evidence`)).json();
  assert.equal(linked.claims.length, variant.claims.length);
  assert.ok(linked.claims.every(claim => claim.factIds.every(id => linked.facts.some(fact => fact.id === id))), 'visible sources must cover every persisted claim');
  assert.ok(conversation.context.candidateRetrieval.queries.length);
  for (const format of ['pdf', 'docx']) {
    const response = await request(`/api/conversations/${fresh.id}/resume.${format}`);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 100);
    assert.equal(bytes.subarray(0, format === 'pdf' ? 4 : 2).toString(), format === 'pdf' ? '%PDF' : 'PK');
  }
  const inline = await request(conversation.context.export.url + '&inline=1');
  assert.equal(inline.status, 200);
  assert.match(inline.headers.get('content-disposition'), /^inline;/);
  assert.equal((await request(`/api/conversations/${fresh.id}/resume.pdf?template=unknown`)).status, 400);
  assert.equal((await request(`/api/conversations/${fresh.id}/resume.pdf?sectionOrder=projects,projects`)).status, 400);
  assert.equal((await request(`/api/conversations/${fresh.id}/resume.pdf?sectionOrder=foreign`)).status, 400);
  database.raw.prepare('UPDATE candidate_facts SET status=? WHERE candidate_id=?').run('disabled', candidate.id);
  assert.equal((await request(`/api/conversations/${fresh.id}/resume.pdf`)).status, 409, 'invalidated evidence prevents export');
}));

await test('unpersisted context draft and missing persisted variant never export through fallback', () => fixture(async ({ database, request }) => {
  const { conversation } = await (await request('/api/conversations', {}, 'POST')).json();
  const user = database.getUserByEmail('closed@example.test');
  database.saveConversation(user.id, { ...conversation, context: { formalResume: draft, variant: draft, variantId: 'missing-variant' } });
  assert.equal((await request(`/api/conversations/${conversation.id}/resume.pdf`)).status, 409);
}));

await test('failed job or variant persistence never publishes a successful resume or export', () => fixture(async ({ database, request, base, cookie }) => {
  const { candidate } = await (await request('/api/candidates', { name: '张三' }, 'POST')).json();
  const { conversation } = await (await request('/api/conversations', { candidateId: candidate.id }, 'POST')).json();
  const form = new FormData();
  form.append('file', new Blob([material], { type: 'text/plain' }), 'resume.txt');
  assert.equal((await fetch(`${base}/api/conversations/${conversation.id}/documents`, { method: 'POST', headers: { Cookie: cookie }, body: form })).status, 200);
  for (const method of ['saveTargetJob', 'saveResumeVariant']) {
    const { conversation: fresh } = await (await request('/api/conversations', { candidateId: candidate.id }, 'POST')).json();
    const original = database[method];
    database[method] = () => { throw new Error('test persistence unavailable'); };
    try {
      const stream = await (await request(`/api/conversations/${fresh.id}/messages`, { content: '请根据前端开发岗位：使用 React 制作商品列表和搜索页面，要求计算机相关专业。定制简历并导出。' }, 'POST')).text();
      assert.match(stream, /event: error/);
      const saved = (await (await request(`/api/conversations/${fresh.id}`)).json()).conversation;
      assert.equal(saved.context.variantId ?? null, null);
      assert.equal(saved.messages.some(message => ['resume','export'].includes(message.kind)), false);
      assert.equal((await request(`/api/conversations/${fresh.id}/resume.pdf`)).status, 409);
    } finally { database[method] = original; }
  }
}));

await test('full-document reads work in a new thread but cannot cross candidate ownership', () => fixture(async ({ request, base, cookie }) => {
  const { candidate } = await (await request('/api/candidates', { name: '张三' }, 'POST')).json();
  const { conversation } = await (await request('/api/conversations', { candidateId: candidate.id }, 'POST')).json();
  const form = new FormData();
  form.append('file', new Blob([material], { type: 'text/plain' }), 'resume.txt');
  const uploaded = await (await fetch(`${base}/api/conversations/${conversation.id}/documents`, { method: 'POST', headers: { Cookie: cookie }, body: form })).json();
  const { conversation: fresh } = await (await request('/api/conversations', { candidateId: candidate.id }, 'POST')).json();
  const read = await (await request(`/api/conversations/${fresh.id}/messages`, { content: `READ ${uploaded.document.id}` }, 'POST')).text();
  assert.match(read, /event: done/);
  assert.ok(read.includes('使用 React 开发校园商品列表和搜索页面'));
  const { candidate: other } = await (await request('/api/candidates', { name: '李四' }, 'POST')).json();
  const { conversation: stranger } = await (await request('/api/conversations', { candidateId: other.id }, 'POST')).json();
  const denied = await (await request(`/api/conversations/${stranger.id}/messages`, { content: `READ ${uploaded.document.id}` }, 'POST')).text();
  assert.match(denied, /event: error/);
  assert.doesNotMatch(denied, /zhang@example|校园商品/);
}));
