import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createDatabase } from '../server/database.js';
import { createApp } from '../server/app.js';
import { buildClaimEvidence } from '../server/claimEvidence.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resume-layout-ui-'));
const output = path.resolve(process.env.RESUME_LAYOUT_OUTPUT || path.join(tmpdir(), 'resume-layout-ui-output'));
await mkdir(output, { recursive: true });
const db = createDatabase({ filename: path.join(directory, 'test.sqlite') });
const server = createApp({ database: db, dataDir: directory, model: async () => { throw new Error('UI fixture must not call provider'); } }).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.RESUME_PROTOCOL_PORT = String(server.address().port);
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await context.request.post(`${base}/api/auth/register`, { data: { email: 'layout@example.test', name: '布局测试', password: 'layout-test-password42' } });
  const { candidate } = await (await context.request.post(`${base}/api/candidates`, { data: { name: '张三' } })).json();
  const { conversation } = await (await context.request.post(`${base}/api/conversations`, { data: { candidateId: candidate.id } })).json();
  const material = '张三\n邮箱 zhang@example.com\n教育经历\n某大学计算机本科\n项目经历\n使用 React 开发校园商品列表和搜索页面\n技能\nReact';
  assert.ok((await context.request.post(`${base}/api/conversations/${conversation.id}/documents`, { multipart: { file: { name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from(material) } } })).ok());
  const user = db.getUserByEmail('layout@example.test');
  const content = { name: '张三', targetTitle: '前端开发', contact: { email: 'zhang@example.com' }, summary: '', education: ['某大学计算机本科'], skills: ['React'], projects: ['使用 React 开发校园商品列表和搜索页面'], experience: [], awards: [] };
  const facts = db.listCandidateFacts(user.id, candidate.id).map(fact => ({ ...fact, factId: fact.id }));
  const { variantId } = db.saveResumeVariant(user.id, candidate.id, { conversationId: conversation.id, content, claims: buildClaimEvidence(content, { facts }) });
  const saved = db.getConversation(user.id, conversation.id);
  db.saveConversation(user.id, { ...saved, context: { ...saved.context, variantId, formalResume: content, variant: content } });
  await page.goto(`${base}/#workspace`);
  const control = page.getByRole('combobox', { name: '简历版式' });
  await control.waitFor();
  assert.equal(await control.locator('option').count(), 4);
  for (const template of ['campus-project', 'experienced', 'minimal']) {
    await control.selectOption(template);
    const href = await page.locator('.resume-layout-controls a').filter({ hasText: /^PDF$/ }).getAttribute('href');
    assert.equal(new URL(href, base).searchParams.get('template'), template);
    assert.equal(new URL(href, base).searchParams.get('variantId'), variantId);
    const response = await context.request.get(base + href);
    assert.ok(response.ok()); assert.match(response.headers()['content-type'], /application\/pdf/);
  }
  const responsePromise = page.waitForResponse(response => response.url().includes('/resume.pdf?') && response.url().includes('inline=1'));
  await page.getByText('查看实际 PDF 分页', { exact: true }).click();
  const response = await responsePromise;
  assert.ok(response.ok()); assert.match(response.headers()['content-disposition'], /^inline;/);
  await page.locator('.generated-resume-pdf').waitFor();
  await page.screenshot({ path: path.join(output, 'workspace-layout-light.png') });
  await page.getByRole('button', { name: '暗色', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'workspace-layout-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  // On mobile the evidence drawer can be opened using the existing panel control.
  const open = page.getByRole('button', { name: '原文与优化稿', exact: true });
  if (!(await control.isVisible()) && await open.count()) await open.first().click();
  await page.screenshot({ path: path.join(output, 'workspace-layout-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, output, checks: ['template selection', 'owned PDF downloads', 'inline PDF preview', 'light/dark', 'mobile overflow', 'no runtime errors'] }));
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close();
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('resume-layout-ui-'));
  await rm(resolved, { recursive: true, force: true });
}
