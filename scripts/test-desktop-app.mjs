import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { findFreePort } from '../desktop/core.js';

const output = 'output/desktop';
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(path.join(tmpdir(), 'loomi-desktop-app-'));
const port = await findFreePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, RESUME_PROTOCOL_DATA_DIR: dataDir, RESUME_PROTOCOL_PORT: String(port), RESUME_PROTOCOL_HOST: '127.0.0.1', RESUME_PROTOCOL_SECURE_COOKIES: 'false' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', bytes => { serverLog += bytes; });
server.stderr.on('data', bytes => { serverLog += bytes; });
const errors = [], checks = [], screenshots = [];
let browser;
async function shot(page, name) { const file = `${output}/${name}.png`; await page.screenshot({ path: file }); screenshots.push(file); }
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
async function bridge(context) {
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.desktop = 'true'; }, { once: true });
    let listeners = [], attempts = 0;
    let warnings = [{ code: 'python-deps', message: 'Python 已找到；简历导出还需要安装 reportlab、python-docx。' }];
    window.setDesktopTestWarnings = value => { warnings = value; listeners.forEach(callback => callback(warnings)); };
    window.resumeDesktop = {
      platform: 'win32', version: 'test', openDataFolder: async () => {}, openLogs: async () => {},
      onThemeChange: () => () => {}, getDiagnostics: async () => ({ warnings, cloudUrl: 'https://app.resumeprotocol.com' }),
      onWarnings: callback => { listeners.push(callback); return () => { listeners = listeners.filter(item => item !== callback); }; },
      installPythonDeps: async () => {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 250));
        if (attempts === 1) throw new Error('pip fixture: network unavailable');
        if (attempts === 2) throw new Error('Python 已找到；简历导出还需要安装 reportlab。');
        warnings = []; listeners.forEach(callback => callback(warnings)); return { warnings };
      },
      sync: { getStatus: async () => ({ state: 'local' }), onStatus: () => () => {}, signIn: async () => { throw new Error('云端账户连接尚未开放。'); }, signOut: async () => ({ state: 'local' }), syncNow: async () => ({ state: 'local' }) },
    };
  });
}
try {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}: ${serverLog}`);
    try { if ((await fetch(`${origin}/api/auth/me`)).ok) break; } catch {}
    if (attempt === 149) throw new Error(`Server startup timed out: ${serverLog}`);
    await delay(100);
  }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, colorScheme: 'light' });
  await bridge(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('resume-protocol.theme', 'light'));
  await page.goto(origin);
  await check('intro plays above an inert login, dark entry despite saved light workspace', async () => {
    await page.locator('.loomi-intro').waitFor();
    assert.equal(await page.locator('.desktop-login').evaluate(node => node.closest('[inert]')?.getAttribute('aria-hidden')), 'true');
    assert.equal(await page.locator('.desktop-login').evaluate(node => getComputedStyle(node).colorScheme), 'dark');
    await shot(page, 'intro-1100x700');
    await page.locator('.loomi-intro').waitFor({ state: 'detached', timeout: 12000 });
    assert.equal(await page.locator('.desktop-login').evaluate(node => Boolean(node.closest('[inert]'))), false);
    await shot(page, 'login-1100x700');
  });
  const email = `desktop-${Date.now()}@example.test`, password = 'desktop-fixture-password';
  await check('server login error is shown verbatim', async () => {
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    const response = page.waitForResponse(response => response.url().endsWith('/api/auth/login'));
    await page.locator('.login-submit').click();
    const result = await (await response).json();
    await page.getByRole('alert').filter({ hasText: result.error }).waitFor();
  });
  await check('register authenticates against the real server and opens workspace after the success reaction', async () => {
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.getByLabel('称呼').fill('桌面测试');
    await page.locator('.login-submit').click();
    await page.locator('.desktop-login[data-status="success"]').waitFor();
    await page.locator('.workspace-shell').waitFor();
    assert.equal(await page.locator('.workspace-shell').getAttribute('data-theme'), 'light');
    assert.match(await page.locator('.desktop-titlebar').innerText(), /Loomi/);
  });
  for (const [width, height] of [[1100, 700], [1440, 960]]) {
    await check(`settings opens with warning and account visible at ${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      const card = page.locator('.desktop-account-card');
      await card.waitFor();
      assert.equal(await card.evaluate(node => node.parentElement.parentElement.tagName), 'FOOTER');
      const settings = page.getByRole('button', { name: '设置', exact: true });
      const bounds = await settings.boundingBox();
      assert(bounds.width >= 55 && bounds.height >= 30 && bounds.y + bounds.height <= height);
      const cardBounds = await card.boundingBox();
      assert(cardBounds.y + cardBounds.height <= bounds.y);
      await shot(page, `workspace-${width}x${height}`);
      await settings.click();
      await page.getByRole('heading', { name: '模型设置' }).waitFor();
      await shot(page, `settings-${width}x${height}`);
      await page.getByRole('button', { name: '关闭设置' }).click();
      await page.getByRole('heading', { name: '模型设置' }).waitFor({ state: 'detached' });
    });
  }
  await check('cloud icon retains accessible label and dialog', async () => {
    await page.getByRole('button', { name: '连接云端账户', exact: true }).click();
    await page.getByRole('dialog', { name: '连接云端账户' }).waitFor();
    await page.getByRole('button', { name: '关闭云端账户窗口' }).click();
  });
  await check('dependency install shows progress, pip failure, failed recheck, then clears warnings only on success', async () => {
    const install = page.getByRole('button', { name: '一键安装', exact: true });
    await install.click();
    assert.equal(await page.getByRole('button', { name: '正在安装…', exact: true }).isDisabled(), true);
    await page.getByRole('alert').filter({ hasText: 'pip fixture: network unavailable' }).waitFor();
    await install.click();
    await page.getByRole('alert').filter({ hasText: '简历导出还需要安装 reportlab。' }).waitFor();
    await shot(page, 'dependency-install-failed-recheck');
    await install.click();
    await page.locator('.desktop-warning').waitFor({ state: 'detached' });
  });
  await check('existing session plays intro then goes directly to workspace; reload does not replay', async () => {
    const sessionPage = await context.newPage();
    await sessionPage.goto(origin);
    await sessionPage.locator('.loomi-intro').waitFor();
    await sessionPage.getByRole('button', { name: '跳过' }).click();
    await sessionPage.locator('.workspace-shell').waitFor();
    await sessionPage.reload();
    await sessionPage.locator('.workspace-shell').waitFor();
    assert.equal(await sessionPage.locator('.loomi-intro').count(), 0);
    await sessionPage.close();
  });
  await check('an existing session can retry a failed workspace load without being trapped behind inert login', async () => {
    const recovery = await context.newPage();
    await recovery.route('**/api/projects', async route => {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'workspace fixture: temporarily unavailable' }) });
      await recovery.unroute('**/api/projects');
    });
    await recovery.goto(origin);
    await recovery.getByRole('button', { name: '跳过' }).click();
    await recovery.getByRole('alert').filter({ hasText: 'workspace fixture: temporarily unavailable' }).waitFor();
    await recovery.getByRole('button', { name: '重新打开工作区' }).click({ timeout: 3000 });
    await recovery.locator('.workspace-shell').waitFor();
    await recovery.close();
  });
  await check('logout returns to login without replay; normal login returns to workspace', async () => {
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.locator('.desktop-login').waitFor();
    assert.equal(await page.locator('.loomi-intro').count(), 0);
    await shot(page, 'logout-login-1440x960');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.locator('.login-submit').click();
    await page.locator('.workspace-shell').waitFor();
  });
  await check('warning details wrap in bounded space and can be dismissed', async () => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.evaluate(() => window.setDesktopTestWarnings(['未找到 Python。' + '请安装 Python 3 后重启即可。'.repeat(40)]));
    assert.equal(await page.getByRole('button', { name: '一键安装', exact: true }).count(), 0);
    assert(await page.locator('.desktop-warning-details').evaluate(node => node.clientHeight <= 64 && node.scrollHeight > node.clientHeight && node.scrollWidth <= node.clientWidth));
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('heading', { name: '模型设置' }).waitFor();
    await page.getByRole('button', { name: '关闭设置' }).click();
    await shot(page, 'long-warning-1100x700');
    await page.getByRole('button', { name: '收起环境提示' }).click();
    assert.equal(await page.locator('.desktop-warning').count(), 0);
  });
  await check('desktop hash navigation cannot strand an authenticated user on inert login', async () => {
    await page.evaluate(() => { window.location.hash = ''; });
    await page.waitForTimeout(100);
    await page.locator('.workspace-shell').waitFor({ timeout: 3000 });
    assert.equal(await page.locator('.desktop-login').count(), 0);
  });
  await check('web landing and auth remain available without desktop bridge', async () => {
    const web = await browser.newContext();
    const webPage = await web.newPage();
    await webPage.route('https://**/*', route => route.abort());
    await webPage.goto(origin);
    await webPage.locator('.landing-page').waitFor();
    assert.equal(await webPage.locator('.desktop-login, .loomi-intro').count(), 0);
    assert.equal(await webPage.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\/assets\/(?:DesktopEntry|DesktopAccount|desktop)-/.test(entry.name)).length), 0);
    await web.close();
  });
  assert.deepEqual(errors, []);
  console.log(`PASS ${checks.length} desktop app checks; ${screenshots.length} screenshots; 0 page errors`);
} finally {
  await browser?.close();
  server.kill();
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  await writeFile(`${output}/app-check-results.json`, JSON.stringify({ checks, screenshots, errors }, null, 2));
  await writeFile(`${output}/app-check-server.log`, serverLog);
  await rm(dataDir, { recursive: true, force: true });
}
