// Synthetic data on the public portal, with all outbound writes blocked.
// This checks DOM consistency, not recruitment submission or server uploads.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplicationBrowser } from '../server/applicationForms.js';
import { createApplicationRouter } from '../server/applicationRoutes.js';
import { runCareerAgent } from '../server/careerAgent.js';
import { createDatabase } from '../server/database.js';
import { createUserModel } from '../server/modelSettings.js';

const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const realModel = process.argv.includes('--real-model');
let modelDatabase, primaryModel;
if (realModel) {
  if (!argument('--model-user')) throw new Error('--real-model requires the owned configured --model-user');
  try { process.loadEnvFile(path.resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  modelDatabase = createDatabase();
  primaryModel = createUserModel(modelDatabase,argument('--model-user'),{dataDir:path.resolve('data'),skills:['application-form']});
}
const target = argument('--url') || 'https://t6ixa9nyl6.jiandaoyun.com/f/65e1a1308ce7672fded0f0cf';
const targetUrl = new URL(target);
if (targetUrl.protocol !== 'https:' || !(targetUrl.hostname === 'jiandaoyun.com' || targetUrl.hostname.endsWith('.jiandaoyun.com'))) throw new Error('Simulation target must be a public HTTPS Jiandaoyun form');
const directory = await mkdtemp(path.join(os.tmpdir(), 'application-simulation-'));
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const publicFilterValues = new Set(['研发类','校园招聘','是','否',null]);
  const publicQueryTokens = new Map();
  const publicMethods = new Set(['eq','in']), publicTypes = new Set(), publicRelations = new Set();
  const linkPath = '/_/data_process/data/link_values';
  const filterValues = body => body?.filter?.cond?.flatMap(condition => Array.isArray(condition.value) ? condition.value : []);
  const captureBlankFilters = request => {
    if (new URL(request.url()).pathname !== linkPath) return;
    try {
      const body = request.postDataJSON();
      for (const value of filterValues(body) || []) if (typeof value === 'string' || typeof value === 'number') publicFilterValues.add(value);
      for (const key of ['fx_access_token','fx_access_type','sa_access_token']) { if (!publicQueryTokens.has(key)) publicQueryTokens.set(key,new Set()); publicQueryTokens.get(key).add(body[key]); }
      for (const condition of body.filter?.cond || []) { publicMethods.add(condition.method); publicTypes.add(condition.type); }
      publicRelations.add(body.filter?.rel);
    } catch {}
  };
  page.on('request',captureBlankFilters);
  // The blank page needs its initial form-data POST to hydrate. No synthetic
  // profile is created or inserted until the write blocker below is installed.
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.fx-external-form .fx-field').first().waitFor({ timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout:15000 });
  await page.waitForTimeout(5000);
  // Seed only blank-field metadata lookups; no option is selected here.
  for (const label of ['意向岗位大类','籍贯']) {
    const field = page.locator('.fx-field').filter({ has:page.locator('.field-name',{ hasText:new RegExp(`^${label}$`) }) });
    await field.locator('.x-combo-dropdown-label').click();
    await page.waitForTimeout(1200);
    await page.locator('.fx-field .field-name').filter({ hasText:/^姓名$/ }).click();
    await page.waitForTimeout(450);
  }
  page.off('request',captureBlankFilters);
  let blockedWrites = 0;
  let metadataQueries = 0;
  const blockedPaths = new Set();
  const blockedBodyShapes = {};
  let rejectedMetadata;
  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    let decodedUrl;
    try { decodedUrl = decodeURIComponent(requestUrl.href); } catch { decodedUrl = requestUrl.href; }
    if (/模拟|SIMULATION_ONLY|SIM20240001|13800000000|simulation@example\.invalid/i.test(decodedUrl) || /(?:^|\/)(?:submit|save|upload|log|track|analytics|collect|beacon|envelope)(?:\/|$)/i.test(requestUrl.pathname)) {
      blockedWrites++; blockedPaths.add(requestUrl.pathname); return route.abort();
    }
    if (['GET','HEAD','OPTIONS'].includes(route.request().method())) return route.continue();
    // This endpoint retrieves linked dropdown options. Permit only its bounded
    // query schema and filter values observed on the blank page/public menus;
    // no name/contact/synthetic narrative can enter the lookup request.
    const queryPath = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST' && new URL(route.request().url()).origin === new URL(target).origin && [linkPath,'/_/data_process/data/link'].includes(queryPath) && /^application\/json\b/i.test(route.request().headers()['content-type'] || '')) {
      try {
        const body = route.request().postDataJSON();
        const isLink = queryPath.endsWith('/link');
        const keys = [...(isLink ? ['widgets','fields'] : ['field','formWidgetId','hasLimit','sort']),'formId','refAppId','appId','entryId','filter','fx_access_token','fx_access_type','sa_access_token'];
        const values = filterValues(body);
        const validFilter = body?.filter && Object.keys(body.filter).every(key=>['rel','cond','omitCondIndices'].includes(key)) && publicRelations.has(body.filter.rel) && Array.isArray(body.filter.cond) && body.filter.cond.length > 0 && body.filter.cond.length <= 20 && body.filter.cond.every(condition => condition && Object.keys(condition).every(key=>['field','method','type','value','entryId'].includes(key)) && /^_widget_\d{13}$/.test(condition.field) && /^[a-f0-9]{24}$/.test(condition.entryId) && publicMethods.has(condition.method) && publicTypes.has(condition.type) && Array.isArray(condition.value) && condition.value.length <= 20) && Array.isArray(body.filter.omitCondIndices) && body.filter.omitCondIndices.every(index=>Number.isInteger(index) && index >= 0 && index < body.filter.cond.length);
        const validFields = isLink ? Array.isArray(body?.widgets) && body.widgets.length > 0 && body.widgets.length <= 20 && body.widgets.every(value=>/^_widget_\d{13}$/.test(value)) && Array.isArray(body.fields) && body.fields.length > 0 && body.fields.length <= 20 && body.fields.every(value=>value && Object.keys(value).length === 1 && /^_widget_\d{13}$/.test(value.field)) : typeof body?.hasLimit === 'boolean' && ['field','formWidgetId'].every(key=>/^_widget_\d{13}$/.test(body[key]));
        const validSort = body?.sort === undefined || Array.isArray(body.sort) && body.sort.length <= 10 && body.sort.every(sort=>sort && Object.keys(sort).length === 1 && Object.entries(sort).every(([key,value])=>/^_widget_\d{13}$/.test(key) && [1,-1].includes(value)));
        const validMeta = body && validFields && validSort && ['appId','entryId','formId','refAppId'].every(key=>/^[a-f0-9]{24}$/.test(body[key])) && ['fx_access_token','fx_access_type','sa_access_token'].every(key=>publicQueryTokens.get(key)?.has(body[key]));
        if (body && Object.keys(body).every(key=>keys.includes(key)) && validMeta && validFilter && Array.isArray(values) && values.length <= 40 && values.every(value=>publicFilterValues.has(value))) {
          metadataQueries++;
          const response = await route.fetch({ maxRedirects:0 });
          try {
            const collect = (value,key='') => {
              if (/token|secret|password/i.test(key)) return;
              if (Array.isArray(value)) { for (const item of value.slice(0,500)) collect(item,key); }
              else if (value && typeof value === 'object') { for (const [name,item] of Object.entries(value)) collect(item,name); }
              else if ((typeof value === 'string' && value.length <= 300 && !/模拟|@|1[3-9]\d{9}/.test(value)) || typeof value === 'number') publicFilterValues.add(value);
            };
            collect(await response.json());
          } catch {}
          return route.fulfill({ response });
        }
        rejectedMetadata = { queryPath, validMeta:Boolean(validMeta), validFilter:Boolean(validFilter), conditions:body.filter?.cond?.map(condition=>({method:condition.method,type:condition.type})), unknownValues:values?.filter(value=>!publicFilterValues.has(value)).map(value=>({type:typeof value,length:String(value).length,shortValue:String(value).length <= 4 ? value : undefined})) };
      } catch {}
    }
    blockedWrites++;
    blockedPaths.add(new URL(route.request().url()).pathname);
    if (['/_/data_process/data/link_values','/_/data_process/data/link'].includes(new URL(route.request().url()).pathname)) {
      try {
        const shape = value => Array.isArray(value) ? value.map(shape) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,shape(item)])) : typeof value === 'string' ? `string(${value.length})` : value;
        blockedBodyShapes[new URL(route.request().url()).pathname.endsWith('link_values') ? 'linkValues' : 'link'] = shape(route.request().postDataJSON());
      } catch { blockedBodyShapes.linkValues = 'unparsed'; }
    }
    return route.abort();
  });
  await page.waitForTimeout(1000);
  let submitClicks = 0;
  await page.exposeFunction('recordSimulationSubmit', () => { submitClicks++; });
  await page.evaluate(() => document.addEventListener('click', event => {
    if (/提交|投递/.test(event.target.closest('button,[role="button"],.x-button')?.textContent || '')) window.recordSimulationSubmit();
  }, true));
  const scope = { userId: 'simulation-owner', candidateId: 'simulation-candidate', conversationId: 'simulation-thread' };
  const syntheticDocuments = [];
  const database = {
    getConversation: (u,t) => u === scope.userId && t === scope.conversationId ? { id: t, candidateId: scope.candidateId } : null,
    getCandidate: (u,c) => u === scope.userId && c === scope.candidateId ? { id: c } : null,
    listCandidateFacts: () => [], listDocuments: u => u === scope.userId ? syntheticDocuments : []
  };
  const driver = createApplicationBrowser({ pageProvider: async () => page });
  const { service } = createApplicationRouter({ database, dataDir: directory, browserService: driver });
  await service.start(scope);
  const component = field => {
    const selector = field.section ? '.fx-sub-field' : '.fx-field';
    return page.locator(`${selector}[data-widgetname="${field.name}"]`).nth(field.recordIndex ?? 0);
  };
  const read = field => component(field).evaluate(node => {
    const radio = node.querySelector('.radio-checked');
    if (radio) return radio.querySelector('input')?.value || radio.textContent.trim();
    const tags = [...node.querySelectorAll('.value-tag[title]')].map(tag => tag.getAttribute('title'));
    if (node.querySelector('.fx-form-combocheck')) {
      if (tags.length) return tags;
      const content = node.querySelector('.value-content');
      const plain = content?.textContent.trim();
      return plain && !content.querySelector('.dropdown-label-placeholder') && !content.children.length ? [plain] : [];
    }
    return node.querySelector('.fx-form-text input,.fx-form-textarea textarea,.fx-form-datetime input')?.value ?? node.querySelector('.value-content')?.textContent?.trim() ?? '';
  });
  const menu = async (label, section = '') => {
    const dismissMenu = async () => {
      await page.locator('.fx-field').filter({has:page.locator('.field-name',{hasText:/^姓名$/})}).locator('.fx-form-text input').click();
      await page.waitForFunction(() => ![...document.querySelectorAll('.x-popup')].some(node=>node.getClientRects().length && getComputedStyle(node).visibility === 'visible'), undefined, { timeout:3000 });
    };
    await dismissMenu();
    const scan = await service.scan(scope);
    const field = scan.fields.find(f => f.label === label && (f.section || '') === section);
    assert.ok(field, `menu field ${section}/${label} must be discovered`);
    await component(field).locator('.x-combo-dropdown-label').click();
    await page.locator('.x-popup .x-combo-dropdown-item').first().waitFor({ state:'visible', timeout:3000 }).catch(() => {});
    const labels = await page.locator('.x-popup .x-combo-dropdown-item').evaluateAll((nodes,multi) => nodes.filter(n => n.getClientRects().length && !n.querySelector('.x-combo-dropdown-item') && !n.classList.contains('check-all-item') && (!multi || n.classList.contains('is-multi') && n.getAttribute('title'))).map(n => n.getAttribute('title') || n.textContent.trim()),field.type === 'jiandaoyun-multiselect');
    if (label === '意向岗位') await writeFile(path.resolve('.omx/simulation-role-options.json'),JSON.stringify(await page.locator('.x-popup .x-combo-dropdown-item').evaluateAll(nodes=>nodes.map(n=>({class:n.className,title:n.getAttribute('title'),text:n.textContent.trim(),children:n.querySelectorAll('.x-combo-dropdown-item').length}))),null,2));
    for (const label of labels) publicFilterValues.add(label);
    if (!labels.length) await writeFile(path.resolve('.omx/simulated-menu-empty.json'), JSON.stringify({ label, section, blockedPaths:[...blockedPaths], blockedBodyShapes, rejectedMetadata, component:await component(field).evaluate(node => ({ text:node.textContent.trim().slice(-200), classes:[...node.querySelectorAll('[class]')].map(n=>n.className).slice(-20) })), popups:await page.locator('.x-popup').evaluateAll(nodes=>nodes.map(n=>({class:n.className,text:n.textContent.trim().slice(0,400)}))) },null,2));
    await dismissMenu();
    return [...new Set(labels)];
  };
  const first = async (label, section) => {
    const labels = await menu(label, section);
    assert.ok(labels.length, `${section || ''}/${label} must have choices`);
    return labels[0];
  };
  const profile = {
    name: '模拟求职者', phone: '13800000000', email: 'simulation@example.invalid', ethnicity: '模拟民族', birthDate: '2003-04', studentNumber: 'SIM20240001',
    preferredRoleCategory: '研发类', degree: '本科', acceptRoleAdjustment: false,
    education: [{degree:'本科',school:'模拟大学',major:'模拟专业',endDate:'2027-06-30'}],
    hasAwards: true, hasCampusLeadership: true, hasInternship: true, referred: true, referralCode: 'SIMULATION_ONLY',
    awards: [{ name: '模拟奖项一', date: '2025-06-01' }, { name: '模拟奖项二', date: '2026-06-01' }],
    campusLeadership: [{ organization: '模拟社团一', title: '模拟职务一', startDate: '2024-10-01', endDate: '2025-06-01', description: '模拟职责一' }, { organization: '模拟社团二', title: '模拟职务二', startDate: '2025-10-01', endDate: '2026-06-01', description: '模拟职责二' }],
    employment: [{ company: '模拟公司一', title: '模拟岗位一', startDate: '2025-07-01', endDate: '2025-08-01', description: '模拟工作描述一' }, { company: '模拟公司二', title: '模拟岗位二', startDate: '2026-07-01', endDate: '2026-08-01', description: '模拟工作描述二' }]
  };
  const expectedLabels = new Map([
    ['姓名','name'],['手机','phone'],['邮箱','email'],['性别','gender'],['民族','ethnicity'],['籍贯','nativePlace'],['出生年月','birthDate'],['学历','degree'],['学位','degreeName'],['学号','studentNumber'],
    ['意向岗位大类','preferredRoleCategory'],['意向岗位','preferredRoles'],['意向团队','preferredTeams'],['意向工作地点','preferredLocation'],['语言特长','languages'],['是否接受岗位调剂','acceptRoleAdjustment'],['是否有获奖经历','hasAwards'],['是否有社团干部经历','hasCampusLeadership'],['是否有实习经历','hasInternship'],['是否内推','referred'],['内推码','referralCode'],['您在什么渠道了解到招聘消息','recruitmentChannel']
  ]);
  const recordLabels = {
    '获奖经历': ['awards', { '获奖类型':'type', '奖项级别':'level', '奖项名称':'name', '获奖时间':'date' }],
    '社团干部经历': ['campusLeadership', { '社团名称':'organization', '职位':'title', '开始时间':'startDate', '结束时间':'endDate', '工作描述':'description' }],
    '实习经历': ['employment', { '公司':'company', '职位':'title', '开始时间':'startDate', '结束时间':'endDate', '工作描述':'description' }]
  };
  const expected = field => {
    const record = recordLabels[field.section];
    const undergraduateKeys = {'本科院校':'school','本科学校':'school','本科专业':'major','本科毕业时间':'endDate','本科成绩排名':'ranking'};
    let value = record ? profile[record[0]]?.[field.recordIndex ?? 0]?.[record[1][field.label]] : Object.hasOwn(undergraduateKeys,field.label) ? profile.education[0][undergraduateKeys[field.label]] : profile[expectedLabels.get(field.label)];
    if (typeof value === 'boolean') value = value ? '是' : '否';
    return value;
  };
  const matches = (actual,wanted) => Array.isArray(wanted) ? Array.isArray(actual) && ((actual.length === wanted.length && wanted.every(value=>actual.includes(value))) || actual.length === 1 && actual[0] === wanted.join(', ')) : actual === wanted;
  const batches = [], observed = [];
  const fill = async () => {
    await service.saveProfile(scope, profile);
    let scan, result;
    const fillRuns = [];
    await runCareerAgent({ conversation: { id: scope.conversationId, candidateId: scope.candidateId, context: {}, messages: [{ role: 'user', content: '请填写当前模拟网申能用本地申请档案直接匹配的空白字段。允许使用已配置的模拟资料。请调用一次 fill_application 后直接汇报 counts 并结束本轮；缺失或不支持项保留，不重试，不生成草稿。知识库为空，本轮不需要读取或写入候选事实。网页拦截了申请写入，仅放行公开选项读取。不要提交，不要上传附件。' }] }, userId: scope.userId, emit() {}, persist() {}, signal:AbortSignal.timeout(180000),
      retrieveCandidateKnowledge:async()=>({facts:[],passages:[],coverage:{note:'isolated synthetic test profile only'}}),
      applicationService: { scan:async () => { scan=await service.scan(scope); return scan; }, fill:async input => { if (!input.scanId) { scan=await service.scan(scope); input={...input,scanId:scan.scanId}; } const fillScan=scan; result=await service.fill(scope,input); fillRuns.push({scan:fillScan,result}); if (realModel) await writeFile(path.resolve('.omx/simulated-primary-tool-progress.json'),JSON.stringify({completedBatches:batches.length,currentFillCalls:fillRuns.length,filled:result.filled,pending:result.pending,submitted:false},null,2)); return result; } },
      model: primaryModel || { runTools: async ({ execute }) => { scan = await execute('inspect_application',{}); result = await execute('fill_application',{ scan_id: scan.scanId }); return { content: [{ type:'text', text:'模拟填写结束，未提交' }] }; } } });
    assert.ok(result,'the Primary Agent must actually call fill_application');
    if (!scan) scan = await service.scan(scope);
    for (const run of fillRuns) for (const item of run.result.results.filter(item => item.status === 'filled')) {
      const field = run.scan.fields.find(f => f.id === item.fieldId);
      const actual = await read(field), wanted = expected(field);
      const correct = matches(actual,wanted);
      observed.push({ label: field.label, section: field.section || '', recordIndex: field.recordIndex, correct });
    }
    batches.push({ filled: result.filled, pending: result.pending, results: result.results.map(item => ({ label: scan.fields.find(f => f.id === item.fieldId)?.label, status:item.status })) });
    await writeFile(path.resolve('.omx/simulated-portal-batches.json'), JSON.stringify({ batches, observed, blockedWrites, blockedPaths:[...blockedPaths] },null,2));
    return service.scan(scope);
  };
  profile.gender = await first('性别');
  const nativePlaces = await menu('籍贯');
  if (nativePlaces.length) profile.nativePlace = nativePlaces[0];
  profile.degreeName = await first('学位');
  profile.recruitmentChannel = await first('您在什么渠道了解到招聘消息');
  await fill();
  profile.education[0].ranking = await first('本科成绩排名');
  profile.education[0].school = await first('本科学校');
  // Dependent choices are discovered only after the preceding choice lands.
  profile.preferredRoles = process.argv.includes('--multiple-linked') ? (await menu('意向岗位')).slice(-2) : [await first('意向岗位')];
  await fill();
  profile.preferredTeams = [await first('意向团队')];
  profile.preferredLocation = [await first('意向工作地点')];
  profile.languages = (await menu('语言特长')).slice(0,2);
  for (const record of profile.awards) { record.type = await first('获奖类型','获奖经历'); record.level = await first('奖项级别','获奖经历'); }
  await service.saveProfile(scope, profile);
  const rows = await service.ensureRows(scope);
  const finalScan = await fill();
  const finalChecks = [];
  for (const field of finalScan.fields) {
    const wanted = expected(field);
    if (wanted === undefined || field.unsupported || field.type === 'file') continue;
    const actual = await read(field);
    const correct = matches(actual,wanted);
    finalChecks.push({ label: field.label, section: field.section || '', recordIndex: field.recordIndex, correct, ...(!correct && Array.isArray(wanted) ? { expectedOptions:wanted, actualOptions:actual, selectedContent:await component(field).locator('.value-content').evaluate(node=>({text:node.textContent.trim(),children:[...node.querySelectorAll('*')].map(child=>({class:child.className,title:child.getAttribute('title'),text:child.textContent.trim()}))})) } : {}) });
  }
  let attachmentSelection;
  if (process.argv.includes('--test-attachment-selection')) {
    // Explicit test fixtures only: no real Candidate document is selected and
    // upload traffic remains blocked. A selected File is never a server receipt.
    const files = finalScan.fields.filter(field => field.type === 'file');
    assert.equal(files.length, 4, 'this target should expose two ordinary and two proof attachment fields');
    await mkdir(path.join(directory,'uploads',scope.userId),{recursive:true});
    const selections = [];
    for (const [index,field] of files.entries()) {
      const id = `simulation-attachment-${index}`;
      const name = `${id}.pdf`;
      const bytes = Buffer.from('%PDF-1.4\n% SYNTHETIC TEST ONLY\n%%EOF');
      syntheticDocuments.push({id,candidateId:scope.candidateId,conversationId:scope.conversationId,name,mimeType:'application/pdf'});
      await writeFile(path.join(directory,'uploads',scope.userId,id),bytes);
      selections.push({fieldId:field.id,documentId:id});
    }
    const attachmentResult = await service.fill(scope,{scanId:finalScan.scanId,attachments:selections});
    attachmentSelection = [];
    for (const field of files) {
      const state = await component(field).evaluate(node => ({
        fileInputs: [...node.querySelectorAll('input[type=file]')].map(input=>({count:input.files.length})),
        uploadElements: [...node.querySelectorAll('[class*="upload"],[class*="file-item"],[class*="file-list"]')].map(item=>({classes:item.className})).slice(0,20)
      }));
      attachmentSelection.push({label:field.label,section:field.section || '',recordIndex:field.recordIndex,status:attachmentResult.results.find(item=>item.fieldId===field.id)?.status,state});
    }
    await writeFile(path.resolve('.omx/simulated-attachment-network.json'),JSON.stringify({blockedPaths:[...blockedPaths],blockedWrites,serverUploadAcceptance:false},null,2));
    assert.equal(attachmentResult.filled,0,'existing content and selected files must not count as new successful content writes');
  }
  const correct = finalChecks.filter(item => item.correct).length;
  // Build the target's expected content slots independently of scanner output.
  // A missing discovered control must fail coverage instead of reducing the
  // denominator of a seemingly perfect consistency score.
  const expectedSlots = new Set([...expectedLabels.keys(), '本科学校','本科专业','本科毕业时间','本科成绩排名'].map(label=>JSON.stringify(['',null,label])));
  for (const [section,[family,labels]] of Object.entries(recordLabels)) {
    for (let index=0;index<profile[family].length;index++) for (const label of Object.keys(labels)) expectedSlots.add(JSON.stringify([section,index,label]));
  }
  const observedSlots = finalChecks.map(field=>JSON.stringify([field.section,field.recordIndex ?? null,field.label==='本科院校'?'本科学校':field.label]));
  const missingSlots = [...expectedSlots].filter(slot=>!observedSlots.includes(slot));
  assert.equal(new Set(observedSlots).size,observedSlots.length,'one discovered field cannot stand in for duplicate content slots');
  assert.deepEqual(missingSlots,[],'all independently expected target content slots must be discovered and checked');
  assert.equal(observedSlots.length,expectedSlots.size);
  const report = { kind:'write-isolated-public-portal-simulation', model:realModel ? 'configured-primary-career-agent' : 'deterministic-primary-tool-caller', syntheticData:true, isolationBoundary:'after-blank-form-load-before-any-synthetic-data', nonGetWritesBlockedExceptPublicMetadata:true, syntheticIdentityUrlsBlocked:true, publicOptionMetadataQueries:metadataQueries, blockedWrites, submitted:submitClicks > 0, serverUploadAcceptance:false, attachmentSelection, discovered:finalScan.fields.length, rowsAdded:rows.added, knownSupportedFields:finalChecks.length, correctFields:correct, consistency:correct / (finalChecks.length || 1), incorrectFields:finalChecks.filter(item => !item.correct), observedWrites:observed.length, incorrectReportedWrites:observed.filter(item => !item.correct), batches, unprovidedFields:finalScan.fields.filter(field=>!field.unsupported && field.type !== 'file' && expected(field) === undefined).map(field=>({label:field.label,type:field.type,occupied:field.occupied})), pending:finalScan.fields.filter(field => field.unsupported || field.type === 'file').map(field => ({ label:field.label, type:field.type })) };
  await writeFile(path.resolve(argument('--output') || '.omx/simulated-portal-accuracy.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify({ ...report, batches:undefined },null,2));
  assert.equal(submitClicks,0);
  assert.equal(correct,finalChecks.length,'all source-known supported fields must match the independent oracle');
  assert.equal(report.incorrectReportedWrites.length,0,'every reported successful write must be correct');
  await service.close(scope);
} finally {
  await browser.close();
  modelDatabase?.close();
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('application-simulation-')) throw new Error('Unexpected simulation temporary directory');
  await rm(directory,{recursive:true,force:true});
}
