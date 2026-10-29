// A real browser + scoped service + Career Agent run over a local golden form.
// The model is a deterministic tool caller; these metrics do not claim live
// provider quality or real recruitment portal coverage.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApplicationBrowser } from '../server/applicationForms.js';
import { createApplicationRouter } from '../server/applicationRoutes.js';
import { runCareerAgent } from '../server/careerAgent.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'application-accuracy-'));
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const profile = { name: '测试候选人', phone: '13800138000', email: 'candidate@example.test', gender: '女', birthDate: '2003-04-05', education: [{ school: '测试大学', major: '软件工程', startDate: '2021-09' }, { school: '第二大学', major: '计算机', startDate: '2025-09' }] };
  await page.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
    <form onsubmit="window.submits++;return false">
    <label>姓名<input id="name" name="name" required></label>
    <label>手机<input id="phone" name="phone" required></label>
    <label>邮箱<input id="email" name="email" type="email" required></label>
    <label>出生日期<input id="birth" name="birthDate" type="date"></label>
    <label>期望薪资<input id="salary" name="expectedSalary" value="0"></label>
    <label>到岗时间<input id="available" name="availableDate" type="date" required></label>
    <label>姓名<input id="other" name="name" value="保留已有名字"></label>
    <div role="radiogroup" aria-label="性别"><label><input id="male" name="sex" type="radio" value="男">男</label><label><input id="female" name="sex" type="radio" value="女">女</label></div>
    <fieldset><legend>是否有工作经验</legend><label><input id="false" name="experienced" type="radio" value="false" checked>否</label><label><input name="experienced" type="radio" value="true">是</label></fieldset>
    ${profile.education.map((_, i) => `<fieldset data-row="education-${i}"><legend>教育经历</legend><label>学校<input id="school-${i}"></label><label>专业<input id="major-${i}"></label><label>入学时间<input id="start-${i}" type="month"></label></fieldset>`).join('')}
    <label><input id="consent" type="checkbox">同意隐私协议</label><button>提交</button></form><script>window.submits=0</script>` }));
  await page.goto('https://recruit.example.test/form');
  const scope = { userId: 'gold-owner', candidateId: 'gold-candidate', conversationId: 'gold-thread' };
  const database = { getConversation: (u, t) => u === scope.userId && t === scope.conversationId ? { id: t, candidateId: scope.candidateId } : null, getCandidate: (u,c) => u === scope.userId && c === scope.candidateId ? { id: c } : null, listCandidateFacts: () => [] };
  const driver = createApplicationBrowser({ pageProvider: async () => page });
  const { service } = createApplicationRouter({ database, dataDir: directory, browserService: driver });
  await service.saveProfile(scope, profile);
  await service.start(scope);
  let scan, result;
  const conversation = { id: scope.conversationId, candidateId: scope.candidateId, context: {}, messages: [{ role: 'user', content: '请填写当前网申表单' }] };
  await runCareerAgent({ conversation, userId: scope.userId, emit() {}, persist() {}, applicationService: { scan: () => service.scan(scope), fill: input => service.fill(scope, input) }, model: { runTools: async ({ execute }) => {
    scan = await execute('inspect_application', {});
    result = await execute('fill_application', { scan_id: scan.scanId });
    return { content: [{ type: 'text', text: '尚未提交' }] };
  } } });
  const expected = { name: profile.name, phone: profile.phone, email: profile.email, birth: profile.birthDate, 'school-0': profile.education[0].school, 'major-0': profile.education[0].major, 'start-0': profile.education[0].startDate, 'school-1': profile.education[1].school, 'major-1': profile.education[1].major, 'start-1': profile.education[1].startDate };
  let correct = 0;
  for (const [id, value] of Object.entries(expected)) if (await page.locator(`#${id}`).inputValue() === value) correct++;
  if (await page.locator('#female').isChecked()) correct++;
  const preserved = await page.locator('#salary').inputValue() === '0' && await page.locator('#other').inputValue() === '保留已有名字' && await page.locator('#false').isChecked();
  assert.equal(await page.locator('#available').inputValue(), '', 'missing preferences are never guessed');
  assert.equal(await page.locator('#consent').isChecked(), false);
  assert.equal(await page.evaluate(() => window.submits), 0);
  const required = await page.locator('input[required]').evaluateAll(nodes => ({ total: nodes.length, completed: nodes.filter(node => node.value !== '').length }));
  const report = { kind: 'local-golden-agent-service-browser', model: 'deterministic-tool-caller', attempted: result.filled + result.results.filter(item => item.status === 'failed').length, correctFilled: correct, availableBlank: Object.keys(expected).length + 1, precision: correct / (result.filled || 1), availableCoverage: correct / (Object.keys(expected).length + 1), existingPreserved: preserved, requiredCompleted: required.completed, requiredTotal: required.total, missingPreferences: result.results.filter(item => item.status === 'missing').length, submitted: false, realPortalAcceptance: false };
  assert.equal(correct, 11);
  assert.equal(result.filled, 11);
  assert.equal(preserved, true);
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) await writeFile(path.resolve(process.argv[outputIndex + 1]), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('application-accuracy-')) throw new Error('Unexpected acceptance temporary directory');
  await rm(directory, { recursive: true, force: true });
}
