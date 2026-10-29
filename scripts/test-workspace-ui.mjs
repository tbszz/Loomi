import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createDatabase } from '../server/database.js';
import { createApp } from '../server/app.js';
import { createApplicationBrowser, findLocalBrowser } from '../server/applicationForms.js';

const directory = await mkdtemp(path.join(tmpdir(), 'resume-workspace-test-'));
const screenshots = path.join(tmpdir(), 'resume-assistant-ui');
await mkdir(screenshots, { recursive: true });
const port = 8894;
process.env.RESUME_PROTOCOL_PORT = String(port);
const db = createDatabase({ filename: path.join(directory, 'test.sqlite') });
const response = text => ({ content: [{ type: 'text', text }] });
const model = async ({ system, messages, signal }) => {
  if (JSON.stringify(messages).includes('请慢一点')) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 30000);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  }
  if (system.includes('事实审校员')) return response(JSON.stringify({ answer: '可以，我们先从你的真实经历和求职目标开始。', questions: [] }));
  return response('可以，我们先从你的真实经历和求职目标开始。');
};
let applicationPage;
const applicationBrowser = createApplicationBrowser({ dataDir: directory, pageProvider: async () => applicationPage });
const app = createApp({ database: db, dataDir: directory, model, applicationBrowser, search: async () => ({ jobs: [], sources: [] }) });
const server = app.listen(port, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ executablePath: findLocalBrowser(), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
const page = await context.newPage();
const errors = [];
const apiResponses = [];
page.on('response', response => {
  const url = new URL(response.url());
  if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/api/')) apiResponses.push({ path: url.pathname, status: response.status() });
});
page.on('pageerror', error => errors.push(error.message));
const consoleErrors = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
// Opening the evidence panel embeds the document endpoint in an iframe. If that
// endpoint answers with an attachment, the browser saves the resume the user just
// uploaded instead of showing it, so any download here is a failure.
const downloads = [];
page.on('download', download => downloads.push(download.suggestedFilename()));
// The app must not need anything off this box to render: a stylesheet from an
// unreachable font host blocks DOMContentLoaded and the page comes up blank.
// Record every request instead of intercepting, so the assertion is about the
// product and not about the harness. Only render-blocking resource types are
// asserted to be local; the decorative landing video is allowed to stay remote
// because it cannot hold up the document and the page must degrade without it.
const offBoxRequests = [];
const blockingOffBoxRequests = [];
page.on('request', request => {
  const host = new URL(request.url()).hostname;
  if (host === '127.0.0.1' || host === 'localhost') return;
  offBoxRequests.push(request.url());
  if (['stylesheet', 'script', 'font'].includes(request.resourceType())) blockingOffBoxRequests.push(request.url());
});
const base = `http://127.0.0.1:${port}`;
const capture = async name => {
  await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert(sizes.scroll <= sizes.width, `${name} horizontal overflow ${JSON.stringify(sizes)}`);
};
try {
  // domcontentloaded is the event a stalled <link rel=stylesheet> used to hold back,
  // so these navigations are the regression check for the font fix.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('.landing-page').waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', { name: 'Switch language', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  assert.equal(await page.evaluate(() => localStorage.getItem('loomi.locale')), 'zh');
  await capture('landing-unchanged');
  // The landing page must be scrollable when its content is taller than the
  // viewport. min-height let the container grow with the content while body stayed
  // overflow:hidden, so the page overflowed with nothing able to scroll and an
  // anchor jump stranded the user on the lower half.
  const landingScroll = await page.evaluate(() => {
    const page_ = document.querySelector('.landing-page');
    return {
      clientHeight: page_.clientHeight,
      scrollHeight: page_.scrollHeight,
      viewport: window.innerHeight
    };
  });
  assert.equal(landingScroll.clientHeight, landingScroll.viewport,
    `landing container must be locked to the viewport, got ${landingScroll.clientHeight} of ${landingScroll.viewport}`);
  assert.ok(landingScroll.scrollHeight > landingScroll.clientHeight,
    'landing content must be taller than the viewport for this check to mean anything');
  await page.evaluate(() => { document.querySelector('.landing-page').scrollTop = 9999; });
  assert.ok(await page.evaluate(() => document.querySelector('.landing-page').scrollTop) > 0,
    'the landing page must actually scroll');
  await page.getByRole('link', { name: '使用方法' }).click();
  await page.waitForFunction(() => document.querySelector('.landing-page').scrollTop > 0,
    'the 使用方法 anchor must move the page');
  await page.evaluate(() => { document.querySelector('.landing-page').scrollTop = 0; });
  const registration = await context.request.post(`${base}/api/auth/register`, { data: { email: 'ui-fixture@example.test', name: '林同学', password: 'workspace-fixture-password' } });
  assert(registration.ok());
  await page.goto(`${base}/#workspace`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '下一步，我们一起准备。' }).waitFor();
  await capture('desktop-light-empty');
  // A back gesture or trackpad swipe must leave the workspace. The address bar
  // used to change while React stayed on the workspace, because nothing listened
  // for hashchange, so the user was stuck on the chat surface.
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.locator('.landing-page').waitFor();
  assert.equal(await page.locator('.aui-thread').count(), 0, 'back navigation must unmount the workspace thread');
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '下一步，我们一起准备。' }).waitFor();
  assert.equal(await page.locator('.landing-page').count(), 0, 'forward navigation must return to the workspace');
  assert.deepEqual(blockingOffBoxRequests, [], 'no render-blocking resource may come from an external host');
  const fonts = await page.evaluate(() => ({ status: document.fonts.status, body: getComputedStyle(document.body).fontFamily }));
  assert.equal(fonts.status, 'loaded', `no font may still be downloading: ${JSON.stringify(fonts)}`);
  assert.doesNotMatch(fonts.body, /Mackinac/i, 'the body must not wait on a downloaded webfont');
  assert.match(fonts.body, /Georgia|Songti|SimSun|Times|Arial|Segoe|YaHei|PingFang|sans-serif|serif/i);
  await page.getByRole('combobox', { name: '切换求职者' }).selectOption('__new_candidate__');
  await page.getByRole('textbox', { name: '求职者名称' }).fill('林同学');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('combobox', { name: '切换求职者' }).waitFor();
  await page.getByRole('button', { name: '诊断简历', exact: true }).click();
  assert.match(await page.locator('.aui-composer-input').inputValue(), /诊断简历/);
  const input = page.getByRole('textbox', { name: '给 Loomi 发消息' });
  await input.fill('你好，我想准备求职。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByText('可以，我们先从你的真实经历和求职目标开始。', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.aui-status'));
  assert.equal(await page.locator('.aui-message.user').count(), 1);
  await page.getByRole('button', { name: '复制回复', exact: true }).last().click();
  await page.getByRole('button', { name: '已复制回复', exact: true }).waitFor();
  await input.fill('请慢一点回答');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor();
  const runCancel = page.getByRole('button', { name: '停止当前任务', exact: true });
  await runCancel.waitFor();
  await page.waitForFunction(() => /^\d+\.\d+秒$/.test(document.querySelector('.agent-step-duration')?.textContent || ''));
  assert.match(await page.locator('.agent-elapsed').innerText(), /步骤 \d+ · \d+\.\d+秒/);
  const elapsedBefore = await page.locator('.agent-step-duration').last().innerText();
  const completedDurations = await page.locator('.agent-run-trail [data-current="false"] .agent-step-duration').allTextContents();
  await page.waitForFunction(previous => {
    const current = document.querySelector('.agent-run-trail [data-current="true"] .agent-step-duration');
    return current && Number.parseFloat(current.textContent) > Number.parseFloat(previous);
  }, elapsedBefore);
  assert.deepEqual(await page.locator('.agent-run-trail [data-current="false"] .agent-step-duration').allTextContents(), completedDurations, 'completed-step durations remain fixed');
  assert.equal(await page.locator('.aui-pending-skeleton').count(), 1);
  await capture('desktop-light-run');
  // Freeze the cancellation reconciliation snapshot, not the upload. A slow GET
  // must not replace a newer conversation after the user uploads a document.
  let releaseCancellationSnapshot;
  const cancellationSnapshotReleased = new Promise(resolve => { releaseCancellationSnapshot = resolve; });
  let captureCancellationSnapshot;
  const cancellationSnapshotCaptured = new Promise(resolve => { captureCancellationSnapshot = resolve; });
  let completeCancellationSnapshot;
  const cancellationSnapshotCompleted = new Promise(resolve => { completeCancellationSnapshot = resolve; });
  const cancellationRoute = '**/api/conversations/*';
  await page.route(cancellationRoute, async route => {
    if (route.request().method() !== 'GET' || !/^\/api\/conversations\/[^/]+$/.test(new URL(route.request().url()).pathname)) return route.continue();
    const response = await route.fetch();
    const snapshot = await response.json();
    assert.equal(snapshot.conversation.messages.some(message => message.kind === 'attachment'), false, 'the held cancellation snapshot must precede the upload');
    captureCancellationSnapshot();
    await cancellationSnapshotReleased;
    await route.fulfill({ response });
    completeCancellationSnapshot();
  });
  await runCancel.click();
  await cancellationSnapshotCaptured;
  await page.waitForFunction(() => !document.querySelector('.aui-status'));
  assert.equal(await page.locator('.aui-pending-skeleton').count(), 0, 'cancellation removes the placeholder');
  await page.getByText('已停止生成，已完成的内容仍保留。', { exact: true }).last().waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: '林同学-简历.txt', mimeType: 'text/plain', buffer: Buffer.from('林同学\n邮箱 lin@example.com\n教育经历\n某大学计算机本科\n项目经历\n用 React 制作课程项目\n技能\nReact JavaScript') });
  await page.locator('.attachment-status.parsed').waitFor();
  const cancellationResponse = page.waitForResponse(response => response.request().method() === 'GET' && /^\/api\/conversations\/[^/]+$/.test(new URL(response.url()).pathname));
  releaseCancellationSnapshot();
  await cancellationSnapshotCompleted;
  await (await cancellationResponse).finished();
  await page.unroute(cancellationRoute);
  // Give the completed response and React's next render a frame boundary, not a
  // guessed network delay, before checking whether the upload was rolled back.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.attachment-status.parsed').count(), 1, 'a late cancellation GET must preserve the completed upload');
  const consoleErrorsBefore = consoleErrors.length;
  await page.getByRole('button', { name: '资料', exact: true }).click();
  await page.locator('.evidence-panel').waitFor();
  await page.getByText('长期背景事实', { exact: true }).waitFor();
  // The panel previews a TXT resume, so the embedded endpoint has to answer with the
  // extracted text. Wait for it to render, then check that nothing was downloaded.
  await page.waitForFunction(() => Boolean(document.querySelector('.evidence-panel iframe')?.contentDocument?.body?.innerText?.trim()), null, { timeout: 15000 });
  const previewFrame = page.frames().find(frame => frame.url().includes('/api/documents/'));
  assert(previewFrame, 'the evidence iframe must load the document preview endpoint');
  assert.match(await previewFrame.evaluate(() => document.body.innerText), /林同学/, 'the panel must show the extracted text of the uploaded resume');
  await page.waitForTimeout(300);
  assert.deepEqual(downloads, [], 'opening the evidence panel must not download the uploaded file');
  assert.equal(consoleErrors.length, consoleErrorsBefore, `opening the panel must not log console errors: ${JSON.stringify(consoleErrors.slice(consoleErrorsBefore))}`);
  await capture('desktop-light-candidate-evidence');
  const panel = page.locator('[data-card-id="documents"]');
  assert.equal(await panel.evaluate(node => getComputedStyle(node).position), 'static');
  assert.equal(Math.round((await panel.boundingBox()).width), 448);
  assert((await page.locator('.workspace-chat').boundingBox()).width >= 480);
  await page.getByRole('button', { name: '弹出资料卡片', exact: true }).click();
  assert.equal(await panel.evaluate(node => getComputedStyle(node).position), 'fixed');
  const handle = panel.locator('.workspace-card-header');
  const initialPanel = await panel.boundingBox();
  const handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox.x + 30, handleBox.y + 15);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 80, handleBox.y + 60, { steps: 5 });
  await page.mouse.up();
  assert((await panel.boundingBox()).x < initialPanel.x, 'header dragging moves the floating panel');
  await page.getByRole('button', { name: '最小化资料卡片', exact: true }).click();
  assert.equal(await panel.isVisible(), false);
  assert.equal(await page.getByRole('button', { name: '展开资料卡片', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: '展开资料卡片', exact: true }).click();
  assert.equal(await panel.isVisible(), true);
  assert.equal(await page.getByRole('button', { name: '最小化资料卡片', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: '停靠资料卡片', exact: true }).click();
  await page.setViewportSize({ width: 1200, height: 1000 });
  assert.equal(await panel.evaluate(node => getComputedStyle(node).position), 'static');
  await page.setViewportSize({ width: 1024, height: 680 });
  assert.equal(await panel.getAttribute('role'), 'dialog');
  assert.equal(await page.locator('.cards-scrim').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await panel.count(), 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // 拖拽上传与回形针必须走同一条 uploadResumeFile 链路。合成 DataTransfer 走完整
  // dragenter → dragover → drop 序列，覆盖遮罩层出现、消失和真实解析状态。
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['林同学\n邮箱 lin@example.com\n教育经历\n某大学计算机本科\n项目经历\n用 Vue 制作课程项目\n技能\nVue JavaScript'], '林同学-项目集.txt', { type: 'text/plain' }));
    const thread = document.querySelector('.aui-thread');
    for (const type of ['dragenter', 'dragover']) {
      const event = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      thread.dispatchEvent(event);
    }
  });
  await page.locator('.aui-drop-overlay').waitFor();
  await capture('desktop-light-drop-overlay');
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['林同学\n邮箱 lin@example.com\n教育经历\n某大学计算机本科\n项目经历\n用 Vue 制作课程项目\n技能\nVue JavaScript'], '林同学-项目集.txt', { type: 'text/plain' }));
    const event = new DragEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    document.querySelector('.aui-thread').dispatchEvent(event);
  });
  await page.waitForFunction(() => !document.querySelector('.aui-drop-overlay'));
  await page.locator('.attachment-status.parsed').filter({ hasText: '项目集' }).waitFor();
  assert.equal(await page.locator('.aui-drop-overlay').count(), 0, 'dropping must dismiss the overlay');
  // A separate intercepted local fixture represents the recruitment website.
  // The UI, API, encrypted profile service and actual DOM writes remain real.
  const recruitment = await browser.newContext();
  applicationPage = await recruitment.newPage();
  await applicationPage.route('https://recruit.example.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<form onsubmit="window.submits++;return false"><label>姓名<input name="name"></label><label>手机号<input name="phone" value="13000000000"></label><label>期望薪资<input name="salary" value="0"></label><label>身份证号码<input name="identityNumber"></label><label>邮箱<input name="email"></label><label>简历附件<input type="file" name="resume" accept=".txt"></label><button>提交申请</button></form><script>window.submits=0</script>' }));
  await page.getByRole('button', { name: '网申', exact: true }).click();
  await page.getByText('只填空白，已有内容保留', { exact: true }).waitFor();
  await page.getByText('本地申请资料', { exact: true }).click();
  const applicationPanel = page.getByRole('region', { name: '网申填表', exact: true });
  await applicationPanel.getByLabel('姓名', { exact: true }).fill('林同学');
  const privateId = '110101200001010012';
  await applicationPanel.getByLabel('身份证号码', { exact: true }).fill(privateId);
  await applicationPanel.getByRole('button', { name: '保存本地资料', exact: true }).click();
  await page.getByText('本地申请资料已保存。', { exact: true }).waitFor();
  assert.equal(await applicationPanel.getByLabel('身份证号码', { exact: true }).inputValue(), '', 'saved private values must not be echoed');
  await applicationPanel.getByLabel('企业校招网页', { exact: true }).fill('https://recruit.example.test/form');
  await applicationPanel.getByRole('button', { name: '连接网页', exact: true }).click();
  await applicationPanel.getByRole('button', { name: '扫描当前表单', exact: true }).click();
  await page.locator('.application-fields li').first().waitFor();
  const attachmentSelection = applicationPanel.getByLabel('为简历附件选择附件', { exact: true });
  assert.equal(await attachmentSelection.count(), 1, 'blank file fields need an explicit owned-document selection');
  const attachmentOption = await attachmentSelection.locator('option').evaluateAll(options => options.find(option => option.value)?.value);
  assert.ok(attachmentOption, 'the uploaded candidate document must be available');
  await attachmentSelection.selectOption(attachmentOption);
  assert.equal(await applicationPage.locator('[name=resume]').evaluate(node => node.files.length), 0, 'selection alone must not upload');
  await applicationPanel.getByRole('button', { name: '填写空白字段', exact: true }).click();
  await applicationPanel.getByText(/已填写 \d+ 项 · 保留 \d+ 项/).waitFor();
  assert.equal(await applicationPage.locator('[name=name]').inputValue(), '林同学');
  assert.equal(await applicationPage.locator('[name=identityNumber]').inputValue(), privateId);
  assert.equal(await applicationPage.locator('[name=phone]').inputValue(), '13000000000');
  assert.equal(await applicationPage.locator('[name=salary]').inputValue(), '0');
  assert.match(await applicationPage.locator('[name=resume]').evaluate(node => node.files[0].text()), /林同学/);
  assert.equal(await applicationPage.evaluate(() => window.submits), 0);
  assert.equal((await applicationPanel.innerText()).includes(privateId), false);
  await capture('desktop-light-application');
  await applicationPanel.getByRole('button', { name: '断开浏览器', exact: true }).click();
  await page.getByRole('button', { name: '关闭网申卡片', exact: true }).click();
  await page.getByRole('button', { name: '暗色', exact: true }).click();
  await capture('desktop-dark-chat');
  await page.getByRole('button', { name: '资料', exact: true }).click();
  await capture('desktop-dark-floating-evidence');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.evidence-panel').count(), 0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('模型设置', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '新会话', exact: true }).click();
  await page.getByRole('heading', { name: '下一步，我们一起准备。' }).waitFor();
  assert.equal(await page.locator('.aui-message').count(), 0);
  assert.equal(await input.inputValue(), '');
  await capture('desktop-dark-empty');
  await page.setViewportSize({ width: 375, height: 844 });
  await capture('mobile-dark-empty');
  await page.locator('.mobile-bar .language-toggle').click();
  await page.getByRole('heading', { name: 'Let’s prepare your next step.' }).waitFor();
  await capture('mobile-dark-english');
  await page.locator('.mobile-bar .language-toggle').click();
  await page.getByRole('button', { name: '打开项目目录', exact: true }).click();
  await page.locator('.conversation-row').last().locator('button').first().click();
  await page.locator('.attachment-status.parsed').first().waitFor();
  await capture('mobile-dark-chat');
  await page.setViewportSize({ width: 1440, height: 900 });
  const mainBeforeSide = await page.locator('.workspace-chat .aui-message').allTextContents();
  const sidebarCount = await page.locator('.conversation-row').count();
  await page.getByRole('button', { name: '旁聊', exact: true }).click();
  const side = page.locator('[data-card-id="sidechat"]');
  const sideInput = side.getByRole('textbox', { name: '给旁聊发消息' });
  await sideInput.fill('请慢一点');
  await sideInput.press('Shift+Enter');
  await sideInput.pressSequentially('side question');
  assert.match(await sideInput.inputValue(), /\nside question$/);
  await sideInput.press('Enter');
  await side.getByRole('button', { name: '停止生成', exact: true }).waitFor();
  assert.equal(await page.locator('.workspace-chat .aui-composer-input').isEnabled(), true);
  assert.deepEqual(await page.locator('.workspace-chat .aui-message').allTextContents(), mainBeforeSide);
  let releaseSideSnapshot, markSideSnapshot, completeSideSnapshot;
  const sideSnapshotHeld = new Promise(resolve => { markSideSnapshot = resolve; });
  const sideSnapshotRelease = new Promise(resolve => { releaseSideSnapshot = resolve; });
  const sideSnapshotComplete = new Promise(resolve => { completeSideSnapshot = resolve; });
  await page.route('**/api/conversations/*', async route => {
    if (route.request().method() !== 'GET' || !/^\/api\/conversations\/[^/]+$/.test(new URL(route.request().url()).pathname)) return route.continue();
    const response = await route.fetch();
    markSideSnapshot();
    await sideSnapshotRelease;
    await route.fulfill({ response });
    completeSideSnapshot();
  });
  await side.getByRole('button', { name: '停止生成', exact: true }).click();
  await sideSnapshotHeld;
  await side.getByRole('button', { name: '新建旁聊', exact: true }).click();
  await side.locator('.side-chat-empty h3').waitFor();
  releaseSideSnapshot();
  await sideSnapshotComplete;
  await settleSideSnapshot();
  await page.unroute('**/api/conversations/*');
  assert.equal(await side.locator('.aui-message').count(), 0, 'late cancellation cannot overwrite a newly created side chat');
  assert.equal(await page.locator('.conversation-row').count(), sidebarCount, 'side chats never join sidebar');
  assert.deepEqual(await page.locator('.workspace-chat .aui-message').allTextContents(), mainBeforeSide);
  await page.getByRole('button', { name: '关闭旁聊卡片', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '旁聊', exact: true }).evaluate(element => document.activeElement === element), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(blockingOffBoxRequests, [], 'no render-blocking resource may be external');

  // Offline phase: with every off-box host unreachable, both pages must still come up
  // and keep their layout. This is what a demo on a locked-down network looks like.
  const offline = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await offline.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
  });
  const offlinePage = await offline.newPage();
  const offlineErrors = [];
  offlinePage.on('pageerror', error => offlineErrors.push(error.message));
  const offlineCapture = async name => {
    await offlinePage.screenshot({ path: path.join(screenshots, `${name}.png`) });
    const sizes = await offlinePage.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert(sizes.scroll <= sizes.width, `${name} horizontal overflow while offline ${JSON.stringify(sizes)}`);
  };
  assert((await offline.request.post(`${base}/api/auth/login`, { data: { email: 'ui-fixture@example.test', password: 'workspace-fixture-password' } })).ok());
  await offlinePage.goto(base, { waitUntil: 'domcontentloaded' });
  await offlinePage.locator('.landing-page').waitFor();
  await offlineCapture('offline-landing');
  await offlinePage.goto(`${base}/#workspace`, { waitUntil: 'domcontentloaded' });
  await offlinePage.reload({ waitUntil: 'domcontentloaded' });
  await offlinePage.getByRole('heading', { name: 'Let’s prepare your next step.' }).waitFor();
  await offlineCapture('offline-workspace');
  assert.deepEqual(offlineErrors, [], 'going offline must not raise script errors');
  await offline.close();

  // Exercise the production desktop entry and workspace at the minimum window
  // size. Native IPC itself is covered by desktop/main.test.js.
  const desktopContext = await browser.newContext({ viewport: { width: 1100, height: 700 }, reducedMotion: 'reduce' });
  await desktopContext.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await desktopContext.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.desktop = 'true'; }, { once: true });
    sessionStorage.setItem('resume-protocol:desktop-intro-played', '1');
    window.menuLocales = [];
    window.themeSubscriptions = 0;
    window.resumeDesktop = {
      platform: 'win32', version: 'test',
      setLocale: locale => window.menuLocales.push(locale),
      onThemeChange: callback => { window.themeSubscriptions++; window.nativeThemeCallback = callback; return () => {}; },
      getDiagnostics: async () => ({ warnings: [], cloudUrl: 'https://example.test' }),
      onWarnings: () => () => {},
      openDataFolder: async () => {}, openLogs: async () => {},
      sync: { getStatus: async () => ({ state: 'local' }), onStatus: () => () => {} },
    };
  });
  const desktopPage = await desktopContext.newPage();
  const desktopErrors = [];
  desktopPage.on('pageerror', error => desktopErrors.push(error.message));
  await desktopPage.goto(base, { waitUntil: 'domcontentloaded' });
  await desktopPage.locator('.login-submit').waitFor();
  assert.equal(await desktopPage.locator('html').getAttribute('lang'), 'en');
  assert.equal(await desktopPage.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await desktopPage.locator('.login-submit').innerText(), 'Sign in');
  assert.equal(await desktopPage.evaluate(() => window.menuLocales.at(-1)), 'en');
  const loginToggle = desktopPage.getByRole('button', { name: 'Switch language', exact: true });
  assert.ok((await loginToggle.boundingBox()).y >= 40, 'locale toggle clears native overlay and drag region');
  await desktopPage.locator('.login-submit').click();
  await desktopPage.getByText('Enter a valid email address.', { exact: true }).waitFor();
  await loginToggle.click();
  await desktopPage.getByText('请填写有效邮箱。', { exact: true }).waitFor();
  assert.equal(await desktopPage.locator('html').getAttribute('lang'), 'zh-CN');
  assert.equal(await desktopPage.evaluate(() => window.menuLocales.at(-1)), 'zh');
  await desktopPage.reload({ waitUntil: 'domcontentloaded' });
  await desktopPage.locator('.login-submit').waitFor();
  assert.equal(await desktopPage.locator('.login-submit').innerText(), '登录');
  assert.equal(await desktopPage.evaluate(() => localStorage.getItem('loomi.locale')), 'zh');
  await desktopPage.getByRole('button', { name: '切换语言', exact: true }).click();
  await desktopPage.getByRole('textbox', { name: 'Email', exact: true }).fill('ui-fixture@example.test');
  await desktopPage.locator('input[name=password]').fill('workspace-fixture-password');
  await desktopPage.locator('.login-submit').click();
  await desktopPage.locator('.workspace-shell').waitFor();
  await desktopPage.locator('.aui-thread').waitFor();
  assert.equal(await desktopPage.locator('html').getAttribute('data-theme'), 'dark');
  await desktopPage.screenshot({ path: path.join(screenshots, 'desktop-i18n-en-dark-1100x700.png') });
  await desktopPage.getByRole('button', { name: 'Light', exact: true }).click();
  assert.equal(await desktopPage.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await desktopPage.evaluate(() => window.themeSubscriptions), 0, 'renderer must not subscribe to OS theme changes');
  await desktopPage.reload({ waitUntil: 'domcontentloaded' });
  await desktopPage.locator('.workspace-shell').waitFor();
  await desktopPage.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await desktopPage.evaluate(() => localStorage.getItem('resume-protocol.theme')), 'light');
  for (const locale of ['zh', 'en']) {
    await desktopPage.locator('.chat-tools .language-toggle').click();
    await desktopPage.waitForFunction(value => document.documentElement.lang === value, locale === 'zh' ? 'zh-CN' : 'en');
    assert.equal(await desktopPage.evaluate(() => window.menuLocales.at(-1)), locale);
    const overflow = await desktopPage.evaluate(() => ({
      width: innerWidth, scroll: document.documentElement.scrollWidth,
      buttons: [...document.querySelectorAll('.chat-tools button')].map(button => ({ width: button.clientWidth, scroll: button.scrollWidth })),
    }));
    assert.ok(overflow.scroll <= overflow.width, `${locale} desktop layout does not overflow`);
    assert.ok(overflow.buttons.every(button => button.scroll <= button.width + 1), `${locale} header buttons fit`);
    await desktopPage.screenshot({ path: path.join(screenshots, `desktop-i18n-${locale}-1100x700.png`) });
  }
  assert.deepEqual(desktopErrors, []);
  const deniedPage = await desktopContext.newPage();
  const deniedErrors = [];
  deniedPage.on('pageerror', error => deniedErrors.push(error.message));
  await deniedPage.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage denied'); } }));
  await deniedPage.goto(base, { waitUntil: 'domcontentloaded' });
  await deniedPage.locator('.workspace-shell').waitFor();
  assert.equal(await deniedPage.locator('html').getAttribute('lang'), 'en');
  assert.equal(await deniedPage.locator('html').getAttribute('data-theme'), 'dark');
  await deniedPage.locator('.chat-tools .language-toggle').click();
  await deniedPage.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal(await deniedPage.evaluate(() => window.menuLocales.at(-1)), 'zh');
  assert.deepEqual(deniedErrors, []);
  await desktopContext.close();

  console.log(JSON.stringify({ passed: true, screenshots, checks: ['back-navigation', 'landing-scroll', 'landing', 'no-blocking-external-resource', 'fonts-local', 'offline-render', 'empty-state', 'suggestions', 'send-once', 'copy', 'step-durations', 'run-cancel', 'pending-skeleton', 'cancel-late-snapshot-preserves-upload', 'upload', 'drop-upload', 'preview', 'floating-drag', 'minimize-restore-focus', 'cards-dock-overlay-breakpoints', 'escape-close', 'no-implicit-download', 'application-profile-private', 'application-blank-only', 'application-explicit-owned-attachment', 'application-no-submission', 'settings', 'switch-conversation', 'mobile-no-overflow', 'side-enter-shift-enter', 'side-stop', 'side-new-thread-late-cancel-isolation', 'side-sidebar-filter', 'card-close-focus'], offBoxRequests, downloads, pageErrors: errors, consoleErrors }));
} catch (error) {
  await page.screenshot({ path: path.join(screenshots, 'failure.png') });
  console.error(JSON.stringify({ error: error.message, pageErrors: errors, apiResponses,
    uploadUi: await page.locator('input[type=file]').evaluateAll(nodes => nodes.map(node => ({ disabled: node.disabled }))).catch(() => []),
    alerts: await page.locator('[role=alert], .workspace-notice, .attachment-status').allTextContents().catch(() => []) }));
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  db.close();
  await rm(directory, { recursive: true, force: true });
}

// Full cards matrix, isolated from the deterministic model fixtures above.
await import('./test-desktop-cards.mjs');

async function settleSideSnapshot() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
