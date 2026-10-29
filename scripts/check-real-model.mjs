// Actual SDK integration: observe successful Skill tool results, never fixtures.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../server/database.js';
import { createApp } from '../server/app.js';
import { createDefaultModel } from '../server/modelClient.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(project, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
assert.ok(process.env.ANTHROPIC_API_KEY || process.env.MINIMAX_API_KEY, 'real-model smoke needs a configured provider key');

const directory = await mkdtemp(path.join(tmpdir(), 'real-model-'));
const database = createDatabase({ filename: path.join(directory, 'real.sqlite') });
const sdkModel = createDefaultModel({ dataDir: directory });
assert.equal(sdkModel.runtime, 'claude-agent-sdk', 'this smoke requires the real SDK runtime');
const observedTurns = [];
// Observe the real provider without replacing its SDK loop or career tools.
const model = args => sdkModel(args);
model.runTools = async args => {
  const outcome = await sdkModel.runTools({ ...args, execute: async (...input) => {
    try { const result = await args.execute(...input); console.log(`  TOOL ${input[0]}: completed`); return result; }
    catch (error) { console.log(`  TOOL ${input[0]}: ${error.message}`); throw error; }
  } });
  observedTurns.push({ sessionId: outcome.sessionId, resumed: outcome.resumed, ...outcome.runtimeTrace });
  return outcome;
};
const app = createApp({ database, dataDir: directory, model });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const request = (url, cookie, options = {}) => fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });

const ZHANG_RESUME = [
  '张三', 'zhang@example.test', '教育经历', '2021.09-2025.06  郑州轻工业大学  计算机科学与技术  本科',
  '项目经历', 'GreenSteps 校园二手交易平台', '使用 React 与 TypeScript 开发商品列表与搜索页面',
  '技能', 'React TypeScript'
].join('\n');

const jd = '前端开发工程师：开发 Web 商品展示页面与搜索功能，要求 React、TypeScript。Kubernetes 为岗位优先项，未具备也可以申请。';
const skills = ['resume-analysis', 'jd-analysis', 'resume-tailoring', 'interview-prep'];
const say = async (cookie, conversationId, content, expectedSkill) => {
  const before = observedTurns.length;
  const response = await request(`/api/conversations/${conversationId}/messages`, cookie, { method: 'POST', body: JSON.stringify({ content }) });
  assert.equal(response.status, 200);
  const stream = await response.text();
  // Never print raw provider errors, request metadata or credentials.
  assert.doesNotMatch(stream, /event: error/, `turn failed during ${expectedSkill}`);
  assert.match(stream, /event: done/, `turn did not finish during ${expectedSkill}`);
  const observation = observedTurns.slice(before).at(-1);
  assert.ok(observation, 'a real SDK primary turn must complete');
  console.log('  Skill trace:', JSON.stringify({ discovered: observation.discoveredSkills, requested: observation.requestedSkills, used: observation.usedSkills }));
  for (const skill of skills) assert.ok(observation.discoveredSkills?.includes(skill), `SDK did not discover ${skill}`);
  assert.ok(observation.usedSkills?.includes(expectedSkill), `${expectedSkill} must return a successful real SDK Skill tool_result`);
  const conversation = (await (await request(`/api/conversations/${conversationId}`, cookie)).json()).conversation;
  assert.equal(conversation.agentSessionId, observation.sessionId, 'persist the actual SDK session id');
  console.log(`  PASS ${expectedSkill}; real Skill result observed; resumed=${observation.resumed}`);
  return { conversation, observation };
};

try {
  const registered = await request('/api/auth/register', null, { method: 'POST', body: JSON.stringify({ email: 'real-model@example.test', name: '张三', password: 'real-model-passphrase-42' }) });
  assert.equal(registered.status, 200);
  const registration = await registered.json();
  const userId = registration.user.id;
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  const { candidate } = await (await request('/api/candidates', cookie, { method: 'POST', body: JSON.stringify({ name: '张三' }) })).json();
  const { conversation } = await (await request('/api/conversations', cookie, { method: 'POST', body: JSON.stringify({ candidateId: candidate.id }) })).json();

  const form = new FormData();
  form.append('file', new Blob([ZHANG_RESUME], { type: 'text/plain' }), 'zhang-resume.txt');
  const uploaded = await fetch(`${base}/api/conversations/${conversation.id}/documents`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  assert.equal((await uploaded.json()).document.parseStatus.status, 'parsed');

  console.log('TURN 1: real resume-analysis Skill and candidate evidence');
  const first = await say(cookie, conversation.id, '请使用 resume-analysis Skill 分析我的真实简历，先检索个人背景库，告诉我项目职责有哪些证据，不要生成新简历。', skills[0]);
  assert.ok(first.conversation.context.candidateRetrieval?.factIds?.length, 'candidate retrieval must carry evidence IDs');
  const factsBefore = database.listCandidateFacts(userId, candidate.id);
  const workspaceBefore = await readdir(path.join(directory, 'agent-sessions'));

  console.log('TURN 2: real jd-analysis Skill and same-session continuity');
  const second = await say(cookie, conversation.id, `请使用 jd-analysis Skill 分析下面目标 JD，逐项核对我的材料，保存为当前目标。它是招聘要求，不是我的经历：\n${jd}`, skills[1]);
  assert.equal(second.observation.resumed, true);
  assert.equal(second.conversation.agentSessionId, first.conversation.agentSessionId);
  assert.deepEqual(await readdir(path.join(directory, 'agent-sessions')), workspaceBefore, 'resume must reuse the scoped workspace');
  assert.ok(second.conversation.context.targetJobId, 'target JD must persist');
  assert.deepEqual(database.listCandidateFacts(userId, candidate.id), factsBefore, 'JD requirements must not become candidate facts');

  console.log('TURN 3: new thread, shared Candidate KB, real resume-tailoring');
  const { conversation: secondThread } = await (await request('/api/conversations', cookie, { method: 'POST', body: JSON.stringify({ candidateId: candidate.id }) })).json();
  const third = await say(cookie, secondThread.id, `请使用 resume-tailoring Skill，为以下 JD 生成岗位版简历。材料已在我的个人背景库，不要要求再次上传；先检索真实姓名、教育、技能、项目证据。教育、技能和项目优先逐字保留事实，不补数字、职责或经历；没有证据的内容留空。\n目标 JD：\n${jd}`, skills[2]);
  assert.notEqual(third.conversation.agentSessionId, first.conversation.agentSessionId);
  assert.ok(third.conversation.context.candidateRetrieval?.factIds?.length, 'new thread must retrieve existing candidate evidence');
  assert.ok(third.conversation.context.variantId, 'tailored resume must be persisted');
  assert.ok(third.conversation.context.claimCount > 0, 'tailored resume must carry claim evidence');
  assert.equal(database.listCandidateFacts(userId, candidate.id).some(fact => String(fact.value).includes('Kubernetes')), false);
  for (const format of ['pdf', 'docx']) {
    const download = await request(`/api/conversations/${secondThread.id}/resume.${format}`, cookie);
    assert.equal(download.status, 200, `${format} export must read the verified persisted variant`);
    assert.ok((await download.arrayBuffer()).byteLength > 100);
  }

  console.log('TURN 4: real interview-prep Skill and grounded interview plan');
  const fourth = await say(cookie, secondThread.id, '请使用 interview-prep Skill，围绕刚才的岗位版简历生成面试追问和七天复习计划，不编造我使用过的技术或成果。', skills[3]);
  assert.equal(fourth.observation.resumed, true);
  assert.equal(fourth.conversation.agentSessionId, third.conversation.agentSessionId);
  assert.ok(fourth.conversation.context.variant?.interviewPlan);
  console.log('REAL-MODEL SMOKE PASSED: four successful Skills, continuity, cross-thread KB, JD separation, verified PDF/DOCX');
} finally {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  database.close();
  await rm(directory, { recursive: true, force: true });
}
