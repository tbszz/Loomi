// End-to-end acceptance run for the Candidate knowledge flow.
//
// Runs a real HTTP server over a real SQLite database and walks the acceptance
// steps, then repeats the user-visible part in a real browser page. Only the model
// is a deterministic fixture, so the run is repeatable offline; every other layer
// (auth, upload, parsing, fact extraction, retrieval, SSE, UI) is the real one.
//
//   node scripts/acceptance-candidate-flow.mjs

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase } from '../server/database.js';
import { findLocalBrowser } from '../server/applicationForms.js';
import { createApp } from '../server/app.js';

const ZHANG_RESUME = [
  '张三', '教育经历', '2021.09-2025.06  郑州轻工业大学  计算机科学与技术  本科',
  '项目经历', 'GreenSteps 校园二手交易平台', '使用 React 与 TypeScript 开发商品列表与搜索页面',
  '技能', 'React TypeScript'
].join('\n');
const LI_RESUME = '李四\n教育经历\n某某大学英语本科\n项目经历\n校园公众号内容运营\n技能\n内容写作';
const BROWSER = findLocalBrowser();

const directory = await mkdtemp(path.join(tmpdir(), 'resume-acceptance-'));
const port = await freePort();
process.env.RESUME_PROTOCOL_PORT = String(port);

const response = text => ({ content: [{ type: 'text', text }] });
const JD_TEXT = '岗位职责：负责校园产品前端开发，要求熟悉 React 与 TypeScript。';
function toolUseName(messages = []) {
  for (const message of [...messages].reverse()) {
    if (!Array.isArray(message.content)) continue;
    const block = message.content.find(item => item?.type === 'tool_use');
    if (block) return block.name;
  }
  return null;
}
function lastUserText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user' && typeof messages[index].content === 'string') return messages[index].content;
  }
  return '';
}
function toolResult(messages = []) {
  const content = messages.at(-1)?.content;
  if (!Array.isArray(content)) return null;
  const block = content.find(item => item?.type === 'tool_result');
  if (!block) return null;
  try { return JSON.parse(block.content); } catch { return null; }
}
// Deterministic stand-in for the Primary Career Agent. It asks for candidate
// evidence before answering anything about the candidate's background, and answers
// only from what the tool returned.
const model = async ({ system, messages, tools = [] }) => {
  if (system.includes('求职 Agent')) {
    const pack = toolResult(messages);
    if (pack && Array.isArray(pack.facts)) {
      const cited = pack.facts.slice(0, 3).map(fact => fact.value + '（来源：' + fact.documentName + '）');
      return response(cited.length ? '根据材料：' + cited.join('；') : '没有检索到相关材料。' + pack.coverage.note);
    }
    const question = lastUserText(messages);
    if (/项目经历|背景|教育/.test(question) && tools.some(tool => tool.name === 'search_candidate_knowledge')) {
      return { content: [{ type: 'tool_use', id: 'acceptance-probe', name: 'search_candidate_knowledge', input: { query: question } }], stop_reason: 'tool_use' };
    }
    const lastTool = toolUseName(messages);
    const golden = /请针对这份JD生成简历并导出/.test(question || '');
    if (golden && lastTool === null && tools.some(tool => tool.name === 'save_candidate_fact')) {
      return { content: [{ type: 'tool_use', id: 'fact-1', name: 'save_candidate_fact', input: { type: 'contact', value: 'zhang-golden@example.com' } }], stop_reason: 'tool_use' };
    }
    if (golden && lastTool === 'save_candidate_fact' && tools.some(tool => tool.name === 'select_job')) {
      return { content: [{ type: 'tool_use', id: 'jd-1', name: 'select_job', input: { description: JD_TEXT, title: '前端开发工程师', role: 'frontend' } }], stop_reason: 'tool_use' };
    }
    if (golden && lastTool === 'select_job' && tools.some(tool => tool.name === 'generate_resume')) {
      return { content: [{ type: 'tool_use', id: 'gen-1', name: 'generate_resume', input: { role: 'frontend' } }], stop_reason: 'tool_use' };
    }
    if (golden && lastTool === 'generate_resume' && tools.some(tool => tool.name === 'export_resume')) {
      return { content: [{ type: 'tool_use', id: 'exp-1', name: 'export_resume', input: { format: 'pdf' } }], stop_reason: 'tool_use' };
    }
    return response('可以先告诉我你想投的岗位，我会基于你的真实材料帮你准备。');
  }
  if (system.includes('求职建议事实审校员')) return response(JSON.stringify({ answer: '已核对。', questions: [] }));
  if (system.includes('严格遵守事实的中文简历编辑') || system.includes('简历事实审校员')) {
    return response(JSON.stringify({
      name: '张三', targetTitle: '前端开发工程师', contact: {},
      summary: '使用 React 与 TypeScript 开发商品列表与搜索页面',
      education: ['2021.09-2025.06  郑州轻工业大学  计算机科学与技术  本科'],
      skills: ['React TypeScript'],
      projects: ['GreenSteps 校园二手交易平台：使用 React 与 TypeScript 开发商品列表与搜索页面'],
      experience: [], awards: [], gaps: []
    }));
  }
  return response('好的。');
};

const database = createDatabase({ filename: path.join(directory, 'acceptance.sqlite') });
const app = createApp({ database, dataDir: directory, model, search: async () => ({ jobs: [], sources: [] }) });
const server = app.listen(port, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${port}`;
const request = (url, cookie, options = {}) => fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
const register = async email => {
  const created = await request('/api/auth/register', null, { method: 'POST', body: JSON.stringify({ email, name: '验收用户', password: 'acceptance-passphrase-42' }) });
  assert.equal(created.status, 200, 'register ' + email);
  return created.headers.get('set-cookie').split(';')[0];
};
const createCandidate = async (cookie, name) => (await (await request('/api/candidates', cookie, { method: 'POST', body: JSON.stringify({ name }) })).json()).candidate;
const newConversation = async (cookie, candidateId) => (await (await request('/api/conversations', cookie, { method: 'POST', body: JSON.stringify(candidateId ? { candidateId } : {}) })).json()).conversation;
const upload = async (cookie, conversationId, name, text) => {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/plain' }), name);
  const uploaded = await fetch(`${base}/api/conversations/${conversationId}/documents`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  assert.equal(uploaded.status, 200, 'upload ' + name);
  return uploaded.json();
};
const say = async (cookie, conversationId, content) => {
  const stream = await (await request(`/api/conversations/${conversationId}/messages`, cookie, { method: 'POST', body: JSON.stringify({ content }) })).text();
  assert.match(stream, /event: done/, 'turn must finish: ' + content);
  const saved = await (await request(`/api/conversations/${conversationId}`, cookie)).json();
  return saved.conversation;
};
const lastAnswer = conversation => conversation.messages.filter(message => message.role === 'assistant' && message.kind !== 'error').at(-1)?.content || '';

const checks = [];
const pass = (step, detail) => { checks.push(step); console.log('  PASS  ' + step + (detail ? ' — ' + detail : '')); };

try {
  console.log('STEP 1  注册 / 登录 / 创建 Candidate');
  const alice = await register('alice-acceptance@example.test');
  const bob = await register('bob-acceptance@example.test');
  const zhang = await createCandidate(alice, '张三');
  const li = await createCandidate(alice, '李四');
  assert.ok(zhang.id && li.id && zhang.id !== li.id);
  assert.equal((await request(`/api/candidates/${zhang.id}/knowledge`, bob)).status, 404, 'another user cannot read the candidate at all');
  pass('注册两个用户，各自建立 Candidate 张三 / 李四', '跨用户读取他人 Candidate 返回 404');

  console.log('STEP 2  Conversation 绑定 Candidate 并上传简历，抽取带来源的事实与分块');
  const zhangConversation = await newConversation(alice, zhang.id);
  assert.equal(zhangConversation.candidateId, zhang.id);
  const { document: zhangDocument } = await upload(alice, zhangConversation.id, 'zhang-resume.txt', ZHANG_RESUME);
  const zhangDocuments = await (await request(`/api/candidates/${zhang.id}/documents`, alice)).json();
  assert.ok(zhangDocuments.documents.some(item => item.id === zhangDocument.id), 'the Document belongs to 张三');
  assert.ok(!(await (await request(`/api/candidates/${li.id}/documents`, alice)).json()).documents.some(item => item.id === zhangDocument.id), '张三 file must not appear under 李四');
  const knowledge = async query => (await (await request(`/api/candidates/${zhang.id}/knowledge?q=${encodeURIComponent(query)}`, alice)).json());
  const projectHits = await knowledge('我之前上传过哪些项目经历');
  assert.ok(projectHits.facts.length > 0, 'a natural-language question must still match facts');
  assert.ok(projectHits.facts.every(fact => fact.type === 'project'), 'the question asked for projects');
  const educationHits = await knowledge('我的教育经历');
  assert.ok(educationHits.facts.some(fact => fact.type === 'education'), 'education facts must be extracted');
  const skillHits = await knowledge('我会哪些技能');
  assert.ok(skillHits.facts.some(fact => fact.type === 'skill'), 'skill facts must be extracted');
  const zhangKnowledge = { facts: [...projectHits.facts, ...educationHits.facts, ...skillHits.facts], chunks: projectHits.chunks };
  assert.ok(zhangKnowledge.chunks.length > 0, 'chunks must exist for retrieval');
  for (const fact of zhangKnowledge.facts) {
    assert.equal(ZHANG_RESUME.slice(fact.sourcePosition, fact.sourcePosition + fact.sourceQuote.length), fact.sourceQuote, 'every fact must point at real source text');
    assert.equal(fact.sourceId, zhangDocument.id);
  }
  for (const chunk of zhangKnowledge.chunks) {
    assert.equal(ZHANG_RESUME.slice(chunk.start, chunk.end), chunk.text.slice(0, chunk.end - chunk.start));
  }
  pass('文档归属张三，事实与分块可回原文逐字核对', zhangKnowledge.facts.length + ' 条事实 / ' + zhangKnowledge.chunks.length + ' 个分块，含 education 与 skill');

  console.log('STEP 3  新会话不重新上传，Agent 通过知识检索工具读到事实并说明来源');
  const freshConversation = await newConversation(alice, zhang.id);
  assert.equal(freshConversation.messages.filter(message => message.role === 'user').length, 0, 'the new Conversation carries no user upload or message');
  assert.deepEqual(freshConversation.context?.documentIds || [], [], 'the new Conversation has no material of its own');
  const answered = await say(alice, freshConversation.id, '我的项目经历有哪些？');
  const answer = lastAnswer(answered);
  assert.match(answer, /来源：zhang-resume\.txt/, 'the Agent must name the source document');
  assert.match(answer, /GreenSteps|React/, 'the Agent must quote real candidate material');
  const traced = answered.context.candidateRetrieval;
  assert.ok(traced?.factIds?.length > 0, 'retrieval must be traced');
  assert.equal(traced.query, '我的项目经历有哪些？', 'the tool received the natural question');
  const sameQuery = await (await request(`/api/candidates/${zhang.id}/knowledge?q=${encodeURIComponent(traced.query)}`, alice)).json();
  const zhangFactIds = new Set(sameQuery.facts.map(fact => fact.id));
  assert.ok(traced.factIds.every(id => zhangFactIds.has(id)), 'every retrieved fact id must belong to 张三');
  pass('新会话零上传即可检索到张三的长期事实并标注来源', traced.factIds.length + ' 条事实，来源 zhang-resume.txt');

  console.log('STEP 4  跨 Candidate 与跨用户不可串读');
  const liConversation = await newConversation(alice, li.id);
  const { document: liDocument } = await upload(alice, liConversation.id, 'li-resume.txt', LI_RESUME);
  assert.ok((await (await request(`/api/candidates/${li.id}/documents`, alice)).json()).documents.some(item => item.id === liDocument.id));
  const liAnswered = await say(alice, liConversation.id, '我的项目经历有哪些？');
  const liAnswer = lastAnswer(liAnswered);
  assert.doesNotMatch(liAnswer, /GreenSteps|郑州轻工业大学|zhang-resume/, '李四 must never see 张三 material');
  const liOwn = await (await request(`/api/candidates/${li.id}/knowledge?q=${encodeURIComponent('项目经历')}`, alice)).json();
  assert.ok(liOwn.facts.every(fact => fact.sourceId === liDocument.id), '李四 facts must all come from 李四 documents');
  const liTraced = liAnswered.context.candidateRetrieval?.factIds || [];
  const liOwnIds = new Set(liOwn.facts.map(fact => fact.id));
  assert.ok(liTraced.length > 0, '李四 must be able to read his own material');
  assert.ok(liTraced.every(id => liOwnIds.has(id)), '李四 may only ever retrieve 李四 facts');
  const bobConversation = await newConversation(bob);
  await say(bob, bobConversation.id, '我的项目经历有哪些？');
  const bobAnswer = lastAnswer(await (await request(`/api/conversations/${bobConversation.id}`, bob)).json().then(body => body.conversation));
  assert.doesNotMatch(bobAnswer, /GreenSteps|郑州轻工业大学|zhang-resume/, 'a second user must never see 张三 material');
  pass('李四与第二用户都读不到张三的任何事实或文件', '李四只能检索到自己的 li-resume.txt');

  console.log('STEP 5  会话内不静默换人；删除会话不丢长期材料');
  const beforeSwitch = await (await request(`/api/conversations/${freshConversation.id}`, alice)).json();
  const switched = await say(alice, freshConversation.id, '现在帮李四准备简历');
  assert.equal(switched.candidateId, zhang.id, 'a Conversation must not silently change candidate');
  // The binding invariant is deterministic: no tool or turn can rebind a Conversation.
  assert.ok(!switched.messages.some(m => m.kind === 'target'), 'an in-chat switch request must not retarget the conversation');
  await request(`/api/conversations/${zhangConversation.id}`, alice, { method: 'DELETE' });
  const survived = await (await request(`/api/candidates/${zhang.id}/knowledge?q=${encodeURIComponent('项目')}`, alice)).json();
  assert.ok(survived.facts.length > 0, 'the Candidate knowledge must survive deleting its Conversation');
  const afterDelete = await newConversation(alice, zhang.id);
  const afterAnswer = lastAnswer(await say(alice, afterDelete.id, '我的项目经历有哪些？'));
  assert.match(afterAnswer, /来源：zhang-resume\.txt/, 'a Conversation created after the delete still reads the material');
  pass('会话拒绝换人，删除会话后长期材料仍可被新会话检索', '删除后仍读到 ' + survived.facts.length + ' 条事实');

  const zhangOnly = await (await request(`/api/candidates/${zhang.id}/documents`, alice)).json();
  assert.ok(zhangOnly.documents.some(item => item.id === zhangDocument.id), '张三 original file is still there');

  console.log('STEP 5b  Golden Case：粘贴 JD → 检索证据 → 定制 → 核验 → 导出，variant 与 claim 证据持久化');
  const goldenConversation = await newConversation(alice, zhang.id);
  // generate_resume needs an in-thread profile, so upload the material here; the
  // claim evidence still comes from the Candidate KB, not from this thread alone.
  await upload(alice, goldenConversation.id, 'zhang-resume.txt', ZHANG_RESUME);
  const factSaid = await say(alice, goldenConversation.id, `补充一下：我的邮箱是 zhang-golden@example.com。请针对这份JD生成简历并导出：${JD_TEXT}`);
  const variantId = factSaid.context.variantId;
  if (!variantId) console.log('Golden-case result:', factSaid.messages.filter(message => message.role === 'assistant').slice(-2).map(message => message.content).join('\n'));
  assert.ok(variantId, 'generate_resume must persist the Resume Variant');
  const goldenUserId = database.raw.prepare('SELECT id FROM users WHERE email = ?').get('alice-acceptance@example.test').id;
  const variants = database.listResumeVariants(goldenUserId, zhang.id, { conversationId: goldenConversation.id });
  assert.ok(variants.some(v => v.id === variantId), 'the persisted variant must be readable back from the database');
  const stored = database.getResumeVariant(goldenUserId, zhang.id, variantId);
  assert.ok(stored.claims.length > 0, 'the variant must persist claim mappings');
  assert.ok(stored.claims.some(claim => claim.factIds.length > 0), 'at least one claim must map to Candidate KB fact ids');
  const targetJobs = database.raw.prepare('SELECT id FROM target_jobs WHERE user_id = ? AND candidate_id = ?').all(goldenUserId, zhang.id);
  assert.ok(targetJobs.length > 0, 'the pasted JD must be persisted as a TargetJob');
  const userFacts = database.listUserAssertedFacts(goldenUserId, zhang.id);
  assert.ok(userFacts.some(fact => fact.value === 'zhang-golden@example.com'), 'the user-asserted email must be in the long-term KB');
  const pdf = await request(`/api/conversations/${goldenConversation.id}/resume.pdf`, alice);
  assert.equal(pdf.status, 200, 'export must read the persisted variant');
  assert.match(pdf.headers.get('content-type') || '', /pdf/);
  assert.ok(factSaid.messages.some(m => m.kind === 'export'), 'the agent must surface the export download link');
  pass('JD→证据→定制→核验→导出闭环：variant/claim_evidence/target_job/user_asserted 全部持久化', stored.claims.length + ' 条 claim，导出 PDF 200');

  console.log('STEP 6  真实浏览器页面：建求职者 / 上传 / 提问 / 看到带来源的回答');
  let pageErrors = [];
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    const registration = await context.request.post(`${base}/api/auth/register`, { data: { email: 'page-acceptance@example.test', name: '张三', password: 'acceptance-passphrase-42' } });
    assert.equal(registration.ok(), true, 'page user registration');
    await page.goto(`${base}/#workspace`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '下一步，我们一起准备。' }).waitFor();
    await page.getByRole('combobox', { name: '切换求职者' }).selectOption('__new_candidate__');
    await page.getByRole('textbox', { name: '求职者名称' }).fill('张三');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('combobox', { name: '切换求职者' }).waitFor();
    const composer = page.getByRole('textbox', { name: '给 Loomi 发消息' });
    await composer.fill('你好，我想准备求职。');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByText('可以先告诉我你想投的岗位，我会基于你的真实材料帮你准备。', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.aui-status'));
    await page.locator('input[type=file]').setInputFiles({ name: 'zhang-resume.txt', mimeType: 'text/plain', buffer: Buffer.from(ZHANG_RESUME) });
    await page.locator('.attachment-status.parsed').waitFor();
    await composer.fill('我的项目经历有哪些？');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByText(/来源：zhang-resume\.txt/).waitFor({ timeout: 20000 });
    const shown = await page.locator('.aui-message').last().innerText();
    assert.match(shown, /来源：zhang-resume\.txt/, 'the page must show the cited source');
    await page.getByRole('button', { name: '打开简历预览', exact: true }).click();
    await page.locator('.evidence-panel').waitFor();
    await page.getByText('长期背景事实', { exact: true }).waitFor();
    const panel = await page.locator('.evidence-panel').innerText();
    assert.match(panel, /React|郑州轻工业大学/, 'the evidence panel must list the extracted facts');
    await page.screenshot({ path: path.join(directory, 'acceptance-page.png') });
    assert.deepEqual(pageErrors, [], 'the page must not raise script errors');
    pass('真实页面上完成建档、上传、提问，回答与证据面板都显示来源', '无脚本错误，截图 ' + path.join(directory, 'acceptance-page.png'));
    console.log('  NOTE  该截图位于临时目录，运行结束后会随目录一起清理');
  } finally {
    await browser.close();
  }

  console.log('\nACCEPTANCE PASSED — ' + checks.length + ' 项');
  for (const step of checks) console.log('  - ' + step);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  database.close();
  await rm(directory, { recursive: true, force: true });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}
