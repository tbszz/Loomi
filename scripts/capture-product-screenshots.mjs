// Captures the product screenshots used in README and the submission PDF.
//
// Real server, real SQLite, real upload / fact extraction / retrieval / claim
// verification / UI. Only the model is a deterministic fixture so the pictures are
// repeatable offline. The candidate is fictional.
//
//   npm run build && node scripts/capture-product-screenshots.mjs

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/database.js';
import { findLocalBrowser } from '../server/applicationForms.js';

const RESUME = [
  '陈一鸣',
  'chen.yiming@example.com',
  '教育经历',
  '2022.09-2026.06  华东理工学院  软件工程  本科',
  '项目经历',
  '校园活动报名小程序',
  '负责活动列表、报名表单与签到页面开发，使用 React 与 TypeScript 实现',
  '使用 Node.js 与 Express 编写报名接口，数据存储在 MySQL',
  '课程设计：图书馆座位预约系统',
  '与两名同学合作，负责前端页面和座位状态的轮询刷新',
  '实习经历',
  '2025.07-2025.09  星河软件  前端开发实习生',
  '参与内部运营后台的表格组件开发，修复页面兼容性问题',
  '技能',
  'React TypeScript JavaScript Node.js Express MySQL Git'
].join('\n');
const JD = '前端开发实习生\n岗位职责：参与 Web 产品前端开发，与后端协作完成接口联调，持续优化页面体验。\n任职要求：2026 届本科及以上，计算机相关专业；熟悉 React 与 TypeScript；了解 Node.js 者优先。';
const lines = RESUME.split('\n');

const response = text => ({ content: [{ type: 'text', text }] });
const toolUse = (name, input = {}) => ({ content: [{ type: 'tool_use', id: `${name}-${Date.now()}`, name, input }], stop_reason: 'tool_use' });
function lastUserText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user' && typeof messages[index].content === 'string') return messages[index].content;
  }
  return '';
}
function toolsSinceUser(messages = []) {
  const names = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && typeof message.content === 'string') break;
    if (Array.isArray(message?.content)) for (const block of message.content) if (block?.type === 'tool_use') names.unshift(block.name);
  }
  return names;
}
function lastToolResult(messages = []) {
  const content = messages.at(-1)?.content;
  const block = Array.isArray(content) && content.find(item => item?.type === 'tool_result');
  try { return block ? JSON.parse(block.content) : null; } catch { return null; }
}

const PLANS = [
  [/分析/, ['analyze_resume'], '我逐句看过了你的简历：教育和技能信息完整，主要问题集中在项目的**个人贡献**和**验收结果**上。右侧"资料"卡片里标出了对应原文，每条建议都可以点开核对。'],
  [/项目经历/, ['search_candidate_knowledge'], null],
  [/JD/, ['select_job', 'generate_resume'], '已按这份 JD 生成岗位版简历。每一条内容都映射到了你背景库中的事实，JD 里出现但你材料中没有的要求（例如"持续优化页面体验"的成果）没有写进去，已列在待补充里。'],
  [/面试/, ['prepare_interview'], '面试追问和七天复习计划已经生成。追问都围绕你简历里真实写到的项目，建议先准备"报名接口"和"轮询刷新"这两段。']
];
const model = async ({ system, messages, tools = [] }) => {
  if (system.includes('求职 Agent')) {
    const question = lastUserText(messages);
    const plan = PLANS.find(([pattern]) => pattern.test(question));
    if (!plan) return response('可以先告诉我你想投的岗位，我会基于你的真实材料帮你准备。');
    const [, steps, finalText] = plan;
    const done = toolsSinceUser(messages);
    const next = steps.find(step => !done.includes(step));
    if (next && tools.some(tool => tool.name === next)) {
      if (next === 'search_candidate_knowledge') return toolUse(next, { query: question });
      if (next === 'select_job') return toolUse(next, { description: JD, title: '前端开发实习生', role: 'frontend' });
      return toolUse(next);
    }
    if (finalText) return response(finalText);
    const pack = lastToolResult(messages);
    const facts = (pack?.facts || []).filter(fact => fact.type === 'project').slice(0, 3);
    return response('根据你上传的材料，背景库里有这些项目经历：\n\n' + facts.map(fact => `- ${fact.value}（来源：${fact.documentName}）`).join('\n') + '\n\n这些信息在新会话里也能直接检索，不需要再上传一次。');
  }
  if (system.includes('求职建议事实审校员')) return response(JSON.stringify({ answer: '已核对。', questions: [] }));
  if (system.includes('简历修改建议编辑')) {
    return response(JSON.stringify({ annotations: [
      { id: 'a1', quote: lines[6], issue: '只列出了做了哪些页面，没有说明你自己解决的难点。', suggestion: '补充一句：报名表单或签到页里你独立处理过的具体问题是什么？[请补充真实信息]', reason: '面试官会追问个人贡献，原文目前无法支撑。', section: 'projects', severity: 'high' },
      { id: 'a2', quote: lines[7], issue: '接口部分缺少验收结果。', suggestion: '如果有真实使用数据（报名人数、活动场次），可以补上；没有就保持现状，不要估算。', reason: '没有结果的描述说服力弱，但编造数字风险更大。', section: 'projects', severity: 'medium' },
      { id: 'a3', quote: lines[9], issue: '团队项目中个人分工的边界还可以更清楚。', suggestion: '说明轮询刷新的间隔是怎么定的、遇到了什么问题。[请补充真实信息]', reason: '"与两名同学合作"容易被追问具体负责部分。', section: 'projects', severity: 'medium' },
      { id: 'a4', quote: lines[12], issue: '"修复页面兼容性问题"较笼统。', suggestion: '写明是哪类浏览器或设备上的问题，以及修复方式。', reason: '实习经历是最有力的证据，值得写具体。', section: 'experience', severity: 'low' }
    ] }));
  }
  if (system.includes('严格遵守事实的中文简历编辑') || system.includes('简历事实审校员')) {
    return response(JSON.stringify({
      name: '陈一鸣', targetTitle: '前端开发实习生', contact: { email: 'chen.yiming@example.com' },
      summary: '',
      education: [lines[3]],
      skills: ['React', 'TypeScript', 'JavaScript', 'Node.js', 'Express', 'MySQL', 'Git'],
      projects: [`校园活动报名小程序：${lines[6]}；${lines[7]}`, `课程设计：图书馆座位预约系统：${lines[9]}`],
      experience: [`${lines[11]}：${lines[12]}`],
      awards: [], gaps: ['JD 要求"持续优化页面体验"，材料中没有相关成果，未写入。']
    }));
  }
  if (system.includes('技术面试教练')) {
    return response(JSON.stringify({
      roleLabel: '前端开发实习生',
      technicalTopics: [{ id: 't1', title: 'React 组件与状态管理', priority: 'P0' }, { id: 't2', title: 'TypeScript 类型设计', priority: 'P0' }, { id: 't3', title: 'Express 接口与参数校验', priority: 'P1' }, { id: 't4', title: '轮询与实时刷新方案', priority: 'P1' }, { id: 't5', title: '浏览器兼容性排查', priority: 'P2' }],
      resumeDefense: ['报名表单的校验逻辑是放在前端还是后端，为什么？', '签到页面如何防止同一用户重复签到？', '报名接口的数据表是怎么设计的？', '座位状态为什么选择轮询而不是 WebSocket？', '轮询间隔是怎么确定的，如果并发量变大你会如何调整？', '实习中修复的兼容性问题具体出现在什么环境？', '如果让你重做活动列表页，你会改进哪里？'],
      schedule: [{ day: 'Day 1', title: '梳理报名小程序架构图，产出一页项目讲稿' }, { day: 'Day 2', title: '复习 React Hooks 与状态管理，完成 3 道组件题' }, { day: 'Day 3', title: 'TypeScript 泛型与类型收窄练习，整理笔记' }, { day: 'Day 4', title: '复盘报名接口设计，画出数据表与请求流程' }, { day: 'Day 5', title: '对比轮询与 WebSocket，写一段方案取舍说明' }, { day: 'Day 6', title: '按追问清单做一次 30 分钟模拟面试并录音' }, { day: 'Day 7', title: '根据录音修改讲稿，准备 2 个 STAR 故事' }]
    }));
  }
  return response('好的。');
};

const directory = await mkdtemp(path.join(tmpdir(), 'loomi-shots-'));
const output = path.resolve('docs/images');
await mkdir(output, { recursive: true });
const port = 8897;
process.env.RESUME_PROTOCOL_PORT = String(port);
const database = createDatabase({ filename: path.join(directory, 'shots.sqlite') });
const server = createApp({ database, dataDir: directory, model }).listen(port, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${port}`;
let browser;
const shots = [];
try {
  browser = await chromium.launch({ executablePath: findLocalBrowser(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1600 / 1440, reducedMotion: 'reduce' });
  await context.addInitScript(() => { try { localStorage.setItem('loomi.locale', 'zh'); localStorage.setItem('resume-protocol.theme', 'dark'); } catch {} });
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const api = context.request;
  assert((await api.post(`${base}/api/auth/register`, { data: { name: '陈一鸣', email: 'demo@example.test', password: 'Demo-fixture-only-1234' } })).ok());
  const candidate = (await (await api.post(`${base}/api/candidates`, { data: { name: '陈一鸣' } })).json()).candidate;
  const conversation = async title => {
    const created = (await (await api.post(`${base}/api/conversations`, { data: { candidateId: candidate.id } })).json()).conversation;
    await api.patch(`${base}/api/conversations/${created.id}`, { data: { title } });
    return created;
  };
  const upload = async id => assert((await api.post(`${base}/api/conversations/${id}/documents`, { multipart: { file: { name: '陈一鸣-简历.txt', mimeType: 'text/plain', buffer: Buffer.from(RESUME) } } })).ok());
  const say = async (id, content) => {
    const stream = await (await api.post(`${base}/api/conversations/${id}/messages`, { data: { content } })).text();
    assert.match(stream, /event: done/, `turn must finish: ${content}\n${stream.slice(-600)}`);
  };

  const interview = await conversation('前端实习 · 定制简历与面试');
  await upload(interview.id);
  await say(interview.id, `请针对这份 JD 定制简历：\n${JD}`);
  await say(interview.id, '帮我准备这个岗位的面试');
  const memory = await conversation('跨会话检索背景');
  await say(memory.id, '我有哪些项目经历？');
  const analysis = await conversation('简历诊断');
  await upload(analysis.id);
  await say(analysis.id, '帮我分析一下这份简历');

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const shot = async name => { await settle(); await page.waitForTimeout(300); const file = path.join(output, `${name}.png`); await page.screenshot({ path: file, animations: 'disabled' }); shots.push(file); };
  const open = async title => {
    await page.locator('.conversation-row', { hasText: title }).first().locator('button').first().click({ force: true });
    await page.locator('.aui-message').first().waitFor();
    await settle();
  };
  const scrollTo = async selector => { await page.locator(selector).last().scrollIntoViewIfNeeded(); await page.locator(selector).last().evaluate(el => el.scrollIntoView({ block: 'start' })); };

  await page.goto(`${base}/#workspace`);
  await page.locator('.workspace-chat .aui-composer-input').waitFor();

  // 1. Diagnosis with the Documents card showing facts and source annotations.
  await open('简历诊断');
  await page.locator('.chat-tools [data-card-toggle="documents"]').click();
  await page.locator('[data-card-id="documents"] .evidence-panel').waitFor();
  await scrollTo('.diagnosis-panel');
  await shot('resume-diagnosis');

  // 2. Cross-conversation retrieval with sources.
  await page.locator('.chat-tools [data-card-toggle="documents"]').click();
  await open('跨会话检索背景');
  await shot('memory-retrieval');

  // 3. Tailored resume and interview plan.
  await open('前端实习 · 定制简历与面试');
  await scrollTo('.aui-artifact');
  await page.locator('.aui-artifact button').last().click();
  await page.locator('[data-card-id="documents"]').waitFor();
  await page.waitForTimeout(4000);
  await shot('tailored-resume');
  await page.locator('.chat-tools [data-card-toggle="documents"]').click();
  await scrollTo('.interview-panel');
  await shot('interview-prep');

  // 4. Skill menu.
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await page.getByRole('heading', { name: '下一步，我们一起准备。' }).waitFor();
  await shot('home');
  await page.getByRole('textbox', { name: '给 Loomi 发消息' }).fill('/');
  await page.getByRole('listbox', { name: '可用 Skills' }).waitFor();
  await shot('skill-menu');
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '给 Loomi 发消息' }).fill('');

  // 5. Applications card.
  await page.locator('.chat-tools [data-card-toggle="apply"]').click();
  await page.locator('[data-card-id="apply"]').waitFor();
  await shot('applications');

  assert.deepEqual(errors, [], 'page errors');
  console.log(JSON.stringify({ shots }, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  database.close();
  await rm(directory, { recursive: true, force: true });
}
