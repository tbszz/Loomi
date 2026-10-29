// Read-only by default. --write uses only owned Candidate facts on the named
// public page; it never submits or supplies synthetic/missing candidate values.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDatabase } from '../server/database.js';
import { createApplicationBrowser } from '../server/applicationForms.js';
import { createApplicationRouter } from '../server/applicationRoutes.js';
import { runCareerAgent } from '../server/careerAgent.js';
import { createUserModel } from '../server/modelSettings.js';

const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const url = argument('--url');
const scope = { userId: argument('--user'), candidateId: argument('--candidate'), conversationId: argument('--conversation') };
const sourceDocumentId = argument('--document');
const write = process.argv.includes('--write');
const realModel = process.argv.includes('--real-model');
if (realModel) { try { process.loadEnvFile(path.resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
if (!url || Object.values(scope).some(value => !value) || !sourceDocumentId) throw new Error('Specify --url --user --candidate --conversation --document');
const database = createDatabase();
const conversation = database.getConversation(scope.userId, scope.conversationId);
assert.equal(conversation?.candidateId, scope.candidateId, 'owned conversation must match selected candidate');
const source = database.listDocuments(scope.userId).find(doc => doc.id === sourceDocumentId && doc.candidateId === scope.candidateId);
assert.ok(source, 'owned candidate source document required');
const facts = database.listCandidateFacts(scope.userId, scope.candidateId).filter(fact => fact.sourceId === sourceDocumentId);
const scopedDatabase = Object.create(database);
scopedDatabase.listCandidateFacts = (u,c) => {
  assert.equal(u, scope.userId); assert.equal(c, scope.candidateId);
  return database.listCandidateFacts(u,c).filter(fact => fact.sourceId === sourceDocumentId);
};
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.fx-external-form .fx-field').first().waitFor({ timeout: 30000 });
  const driver = createApplicationBrowser({ pageProvider: async () => page });
  const { service } = createApplicationRouter({ database: scopedDatabase, dataDir: path.resolve('data'), browserService: driver });
  await service.start(scope);
  let scan = await service.scan(scope);
  // The denominator comes from the portal's field layout, independently of the
  // adapter's supported-control class list, so unknown widget types count too.
  const visibleControls = await page.locator('.fx-external-form .fx-field').evaluateAll(fields => {
    const visible = node => node?.getClientRects().length && getComputedStyle(node).visibility === 'visible' && !node.closest('.ui-invisible');
    return fields.reduce((count, field) => {
      if (!visible(field)) return count;
      const component = field.querySelector(':scope > .field-component > *');
      if (!visible(component) || component.classList.contains('fx-form-separator')) return count;
      if (component.classList.contains('fx-subform')) return count + [...component.querySelectorAll('.fx-sub-field')].filter(child => visible(child.querySelector(':scope > .field-component > *'))).length;
      return count + 1;
    }, 0);
  });
  const report = { kind: 'live-public-portal', write, model: realModel ? 'configured-primary-career-agent' : 'deterministic-tool-caller', source: 'selected-owned-document', discovered: scan.fields.length, visibleControls, discoveryCoverage: scan.fields.length / (visibleControls || 1), supported: scan.fields.filter(field => !field.unsupported).length, requiredFields: scan.fields.filter(field => field.required).length, correctFilled: null, attempted: 0, precision: null, pending: null, submitted: false, unsupported: scan.fields.filter(field => field.unsupported).map(({ label,type }) => ({ label,type })) };
  if (write) {
    const education = facts.find(fact => fact.type === 'education' && /本科/.test(fact.value));
    const degree = scan.fields.find(field => field.label === '学历');
    const drafts = degree && education ? [{ fieldId: degree.id, value: '本科', factIds: [education.id] }] : [];
    let result;
    const turn = { ...conversation, agentSessionId: null, context: {}, messages: [{ role: 'user', content: '请填写当前网申表单的姓名、手机、邮箱、学历这四项。只使用已上传简历的证据，其他字段保留空白，最终提交由我完成。' }] };
    const toolCaller = { runTools: async ({ execute }) => {
      result = await execute('fill_application', { scan_id: scan.scanId, drafts_json: JSON.stringify(drafts) });
      return { content: [{ type: 'text', text: '尚未提交' }] };
    } };
    const usedTools = [];
    await runCareerAgent({ conversation: turn, userId: scope.userId, emit() {}, persist() {}, signal: AbortSignal.timeout(180000),
      retrieveCandidateKnowledge: async ({ query }) => ({ query, facts: [...facts].sort((a,b) => ['identity','contact','education'].includes(b.type) - ['identity','contact','education'].includes(a.type)).slice(0,32), passages: [], coverage: { note: 'selected owned resume source' } }),
      applicationService: { scan: async () => { scan = await service.scan(scope); return scan; }, fill: async input => { usedTools.push('fill_application'); result = await service.fill(scope, input); return result; } },
      model: realModel ? createUserModel(database, scope.userId, { dataDir: path.resolve('data'), skills: ['application-form'] }) : toolCaller });
    assert.ok(result, 'primary Agent must actually invoke fill_application');
    report.usedTools = usedTools;
    const expected = new Map();
    for (const field of scan.fields) {
      if (field.label === '姓名') {
        const values = [...new Set(facts.filter(fact => fact.type === 'identity').map(fact => fact.value.replace(/^姓名\s*[:：]?\s*/, '').trim()))];
        if (values.length === 1) expected.set(field.id, values[0]);
      }
      if (/^(手机|邮箱)$/.test(field.label)) {
        const pattern = field.label === '手机' ? /(?:\+?86[-\s]?)?1[3-9]\d{9}/ : /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
        const values = [...new Set(facts.filter(fact => fact.type === 'contact').map(fact => fact.value.match(pattern)?.[0]).filter(Boolean))];
        if (values.length === 1) expected.set(field.id, values[0]);
      }
    }
    const currentDegree = scan.fields.find(field => field.label === '学历');
    if (currentDegree && education) expected.set(currentDegree.id, '本科');
    let correct = 0;
    for (const record of result.results.filter(item => item.status === 'filled')) {
      const field = scan.fields.find(field => field.id === record.fieldId);
      const actual = await page.locator(`.fx-field[data-widgetname="${field.name}"]`).evaluate(node => node.querySelector('input,textarea')?.value ?? node.querySelector('.value-content')?.textContent?.trim());
      if (expected.has(field.id) && actual === expected.get(field.id)) correct++;
    }
    report.attempted = result.filled + result.results.filter(item => item.status === 'failed').length;
    report.correctFilled = correct;
    report.precision = report.attempted ? correct / report.attempted : null;
    report.availableVerifiedFields = expected.size;
    report.availableCoverage = expected.size ? correct / expected.size : null;
    report.pending = result.pending;
    report.pendingFields = result.results.filter(item => !['filled','preserved'].includes(item.status)).map(item => ({ label: scan.fields.find(field => field.id === item.fieldId)?.label, status: item.status }));
    assert.equal(correct, result.filled, 'every reported fill must match the selected source');
  }
  const output = argument('--output');
  if (output) await writeFile(path.resolve(output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await service.close(scope);
} finally { await browser.close(); database.close(); }
