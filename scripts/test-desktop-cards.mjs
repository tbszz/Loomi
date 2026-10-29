// Headless layout acceptance. The side-chat request uses the actual server/model
// path; absent credentials must produce the server's honest error, not a fixture reply.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/database.js';
import { findLocalBrowser } from '../server/applicationForms.js';

const directory = await mkdtemp(path.join(tmpdir(), 'loomi-cards-'));
const output = path.resolve('output/desktop-cards');
await mkdir(output, { recursive: true });
const database = createDatabase({ filename: path.join(directory, 'cards.sqlite') });
process.env.RESUME_PROTOCOL_PORT = '8895';
const server = createApp({ database, dataDir: directory, search: async () => ({ jobs: [], sources: [] }) }).listen(8895, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const screenshots = [], errors = [], checks = [];
let streamResult;
try {
  browser = await chromium.launch({ executablePath: findLocalBrowser(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const registered = await context.request.post(`${base}/api/auth/register`, { data: { name: '林同学', email: 'cards@example.test', password: 'Cards-fixture-only-1234' } });
  assert(registered.ok());
  const { user } = await registered.json();
  const parent = (await (await context.request.post(`${base}/api/conversations`, { data: {} })).json()).conversation;
  const parentSaved = database.saveConversation(user.id, { ...parent, title: '前端实习 · 简历准备', context: { ...parent.context, material: '林同学，计算机本科。课程项目使用 React，负责界面开发。', profile: { name: '林同学' } }, messages: [{ id: 'main-question', role: 'user', kind: 'text', content: '我想把课程项目讲清楚，准备前端实习。', createdAt: parent.createdAt }, { id: 'main-answer', role: 'assistant', kind: 'text', content: '我们可以先梳理你实际负责的界面、遇到的问题和解决过程，再结合目标岗位调整简历。', createdAt: parent.createdAt }] });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.goto(`${base}/#workspace`);
  await page.locator('.workspace-chat .aui-composer-input').waitFor();
  const toggle = id => page.locator(`[data-card-toggle="${id}"]:visible`);
  const card = id => page.locator(`[data-card-id="${id}"]`);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function capture(name) {
    await settle();
    const geometry = await page.evaluate(() => {
      const rect = element => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      return { width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth, chat: rect(document.querySelector('.workspace-chat')), header: rect(document.querySelector('.workspace-chat .chat-header')), composer: rect(document.querySelector('.workspace-chat .aui-composer-dock')), cards: [...document.querySelectorAll('.workspace-card:not([hidden])')].map(element => ({ id: element.dataset.cardId, floating: element.dataset.floating === 'true', overlay: element.dataset.overlay === 'true', ...rect(element) })) };
    });
    assert(geometry.scroll <= geometry.width, `${name}: horizontal overflow`);
    if (geometry.width >= 1200) assert(geometry.chat.width >= 480, `${name}: chat too narrow: ${geometry.chat.width}`);
    const overlaps = (a, b) => b && b.height > 0 && a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
    for (const item of geometry.cards) {
      assert(item.x >= 0 && item.y >= 0 && item.right <= geometry.width + 1 && item.bottom <= geometry.height + 1, `${name}: offscreen ${JSON.stringify(item)}`);
      assert(!overlaps(item, geometry.header), `${name}: covers main header`);
      assert(!overlaps(item, geometry.composer), `${name}: covers main composer`);
      if (!item.floating && !item.overlay && geometry.cards.filter(c => !c.floating).length === 2) assert(item.height >= 200, `${name}: stacked card below 200px`);
    }
    for (const body of await page.locator('.side-chat .aui-message.assistant .aui-message-body:visible').all()) {
      assert((await body.boundingBox()).width >= 200, `${name}: side reply must have readable line width`);
    }
    const filename = `${name}.png`;
    await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
    screenshots.push({ filename, geometry });
  }
  async function reset(width, height, theme) {
    await page.setViewportSize({ width, height });
    await page.evaluate(({ userId, theme }) => { localStorage.removeItem(`loomi.cards.${userId}`); localStorage.setItem('resume-protocol.theme', theme); }, { userId: user.id, theme });
    await page.reload();
    await page.locator('.workspace-chat .aui-composer-input').waitFor();
  }

  // Side chat goes through the same real SSE transport and Candidate binding.
  await toggle('sidechat').click();
  const side = card('sidechat');
  await side.getByRole('textbox', { name: '给旁聊发消息' }).fill('如何用一句话说明我在课程项目中的职责？');
  const reply = page.waitForResponse(response => response.request().method() === 'POST' && /\/messages$/.test(new URL(response.url()).pathname));
  await side.getByRole('button', { name: '发送消息', exact: true }).click();
  const response = await reply;
  const sse = await response.text();
  const terminal = sse.split('\n\n').filter(frame => /^event: (done|error)/m.test(frame)).at(-1);
  assert(terminal, 'real request must terminate honestly');
  const payload = JSON.parse(terminal.split('\n').find(line => line.startsWith('data:')).slice(5));
  streamResult = { kind: terminal.startsWith('event: error') ? 'server-error' : 'real-reply', text: payload.error || payload.conversation?.messages.filter(message => message.role === 'assistant').at(-1)?.content };
  await side.getByText(streamResult.text, { exact: true }).first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.side-chat .aui-status'));
  assert.deepEqual(database.getConversation(user.id, parent.id), parentSaved, 'side stream never writes main messages/context');
  const children = database.listConversations(user.id).filter(item => item.parentId === parent.id);
  assert.equal(children.length, 1);
  assert.equal(children[0].candidateId, parent.candidateId);
  assert.equal(await page.locator('.conversation-row').count(), 1, 'side chat must stay out of sidebar');
  checks.push('real-side-SSE-reply-or-verbatim-error', 'parent-candidate', 'main-transcript-isolation', 'sidebar-filter');

  for (const theme of ['light', 'dark']) {
    for (const [width, height] of [[960, 640], [1024, 680], [1280, 800], [1440, 900], [1920, 1080]]) {
      const prefix = `${width}x${height}-${theme}`;
      await reset(width, height, theme);
      await toggle('documents').click();
      await capture(`${prefix}-one-card`);
      if (width >= 1440) {
        await toggle('apply').click();
        await capture(`${prefix}-stacked`);
        const splitter = page.getByRole('separator', { name: '调整卡片高度' });
        await splitter.focus(); await page.keyboard.press('ArrowUp');
        await capture(`${prefix}-stack-resized`);
        await page.getByRole('button', { name: '关闭网申卡片', exact: true }).click();
      } else if (width === 1280) {
        await toggle('apply').click();
        assert.equal(await card('documents').isVisible(), false);
        await page.locator('.cards-tabs').getByRole('button', { name: '资料' }).click();
        await capture(`${prefix}-tab-swap`);
        await toggle('apply').click();
        await toggle('documents').click();
        await toggle('documents').click();
      } else {
        assert.equal(await card('documents').getAttribute('role'), 'dialog');
        await page.keyboard.press('Escape');
        assert.equal(await card('documents').count(), 0);
        assert.equal(await toggle('documents').evaluate(element => element === document.activeElement), true);
        await toggle('documents').click();
      }
      await page.getByRole('button', { name: '弹出资料卡片', exact: true }).click();
      const handle = card('documents').locator('.workspace-card-header');
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.down();
      await page.mouse.move(-100, -100, { steps: 4 }); await page.mouse.up();
      await capture(`${prefix}-popped-out`);
      const grip = page.getByRole('separator', { name: '调整资料浮窗大小' });
      await grip.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
      await page.getByRole('button', { name: '停靠资料卡片', exact: true }).click();
      await page.getByRole('button', { name: '关闭资料卡片', exact: true }).click();
      await toggle('sidechat').click();
      await card('sidechat').getByText(streamResult.text, { exact: true }).first().waitFor();
      await capture(`${prefix}-side-chat-${streamResult.kind}`);
    }
  }
  checks.push('all-five-sizes-both-themes', 'one-card', 'two-stacked-minimums', 'stack-split-keyboard', 'tab-swap', 'overlay-escape-focus', 'pop-drag-clamp', 'float-resize', 'no-header-composer-overlap', 'no-window-overflow');

  await reset(1440, 900, 'light');
  await toggle('documents').click(); await toggle('apply').click(); await toggle('sidechat').click();
  assert.equal(await card('documents').isVisible(), false, 'third card demotes LRU');
  assert.equal(await card('apply').isVisible(), true);
  assert.equal(await card('sidechat').isVisible(), true);
  await page.locator('.cards-tabs button').click();
  assert.equal(await card('apply').isVisible(), false, 'tab activation updates LRU');
  const widthHandle = page.getByRole('separator', { name: '调整卡片列宽' });
  await widthHandle.focus(); await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: '弹出资料卡片', exact: true }).click();
  const stored = await page.evaluate(id => JSON.parse(localStorage.getItem(`loomi.cards.${id}`)), user.id);
  assert(stored.width > 448 && stored.popped.documents);
  await page.reload();
  await card('documents').waitFor();
  assert.equal(await card('documents').getAttribute('data-floating'), 'true');
  assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem(`loomi.cards.${id}`)), user.id), stored);
  checks.push('third-card-LRU', 'column-width-keyboard', 'layout-reload-persistence');

  // New side chat snapshots current context and never replaces the main thread.
  await page.getByRole('button', { name: '关闭资料卡片', exact: true }).click();
  await page.getByRole('button', { name: '新建旁聊', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.side-chat .side-chat-empty h3'));
  assert.equal(database.listConversations(user.id).filter(item => item.parentId === parent.id).length, 2);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.side-chat .side-chat-empty h3'));
  assert.equal(await page.locator('.side-chat .aui-message').count(), 0);
  checks.push('new-side-chat', 'latest-side-chat-reload');

  // UI notification fixtures only: persist context changes and let an ordinary
  // title PATCH return them. The model/error screenshot above stays unmocked.
  await page.getByRole('button', { name: '关闭旁聊卡片', exact: true }).click();
  for (const id of ['documents', 'apply']) if (await toggle(id).getAttribute('aria-pressed') === 'true') await toggle(id).click();
  async function refreshContext(title) {
    const response = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/conversations/${parent.id}`);
    await page.getByRole('textbox', { name: '会话标题' }).fill(title);
    await page.getByRole('textbox', { name: '会话标题' }).press('Enter');
    await response; await settle();
  }
  const mainInput = page.locator('.workspace-chat .aui-composer-input');
  await mainInput.fill('正在写的主对话草稿');
  database.saveConversation(user.id, { ...parentSaved, context: { ...parentSaved.context, variantId: 'layout-notification-fixture' } });
  await refreshContext('保留草稿的通知测试');
  assert.equal(await card('documents').count(), 0, 'draft suppresses auto-open');
  assert.equal(await toggle('documents').locator('.card-notification').count(), 1);
  assert.equal(await mainInput.inputValue(), '正在写的主对话草稿');
  await toggle('documents').click();
  assert.equal(await toggle('documents').locator('.card-notification').count(), 0);
  await page.getByRole('button', { name: '关闭资料卡片', exact: true }).click();
  await mainInput.fill('');
  const snapshot = database.getConversation(user.id, parent.id);
  database.saveConversation(user.id, { ...snapshot, context: { ...snapshot.context, export: { variantId: 'layout-notification-fixture' } } });
  await refreshContext('导出后的卡片通知测试');
  await card('documents').waitFor();
  await page.getByRole('button', { name: '关闭资料卡片', exact: true }).click();
  await refreshContext('相同导出不重复打开');
  assert.equal(await card('documents').count(), 0);
  const applying = database.getConversation(user.id, parent.id);
  database.saveConversation(user.id, { ...applying, context: { ...applying.context, selectedJob: { id: 'layout-job-fixture', title: '前端实习' } } });
  await refreshContext('只选择岗位不打开网申');
  assert.equal(await card('apply').count(), 0);
  const selected = database.getConversation(user.id, parent.id);
  database.saveConversation(user.id, { ...selected, messages: [...selected.messages, { id: 'layout-application-fixture', role: 'assistant', kind: 'application', content: '网申步骤已返回。', createdAt: new Date().toISOString() }] });
  await refreshContext('网申结果打开辅助卡片');
  await card('apply').waitFor();
  await page.getByRole('button', { name: '关闭网申卡片', exact: true }).click();
  checks.push('context-draft-defers-to-dot', 'dot-clears-on-open', 'artifact-auto-open', 'unchanged-export-no-reopen', 'selected-job-alone-no-auto-open', 'application-result-auto-open');

  // All overlay tabs belong to the dialog's keyboard focus boundary.
  await toggle('documents').click(); await toggle('apply').click();
  await page.setViewportSize({ width: 1024, height: 680 });
  const overlay = card('apply');
  const overlayTab = overlay.locator('.cards-tabs button');
  await overlayTab.focus();
  await page.keyboard.press('Enter');
  assert.equal(await card('documents').isVisible(), true);
  await page.getByRole('button', { name: '关闭辅助卡片' }).click({ position: { x: 5, y: 300 } });
  assert.equal(await card('documents').count(), 0);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  checks.push('overlay-tab-keyboard', 'scrim-close');

  // Verify normal motion is usable as well as reduced motion.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await toggle('apply').click();
  await capture('1440x900-light-normal-motion');
  assert.deepEqual(errors, []);
  const report = { passed: true, checks, streamResult, screenshots, pageErrors: errors };
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: screenshots.length, output, checks, streamResult }));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') });
  console.error({ error: error.message, pageErrors: errors, body: await page?.locator('body').innerText() });
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  database.close();
  await rm(directory, { recursive: true, force: true });
}
