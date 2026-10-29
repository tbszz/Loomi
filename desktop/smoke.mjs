// Real Electron acceptance check; no server/model fixtures. Run after npm run build.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const packaged = process.argv.includes('--packaged');
const output = path.resolve('output/desktop');
const profile = path.resolve('tmp', packaged ? 'desktop-packaged-profile' : 'desktop-dev-profile');
await mkdir(output, { recursive: true });
const env = { ...process.env, RESUME_PROTOCOL_DESKTOP_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = packaged ? path.resolve('release/win-unpacked/Resume Protocol.exe') : require('electron');
const app = await electron.launch({ executablePath, args: packaged ? [] : [path.resolve('.')], env, timeout: 60000 });
let page;
const errors = [];
try {
  // The first window is the splash; pick the authenticated local workspace.
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    page = app.windows().find(window => /^http:\/\/127\.0\.0\.1:\d+\/#workspace/.test(window.url()));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(page, `Workspace did not open; inspect ${profile}/logs/server.log`);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.desktop-account-card').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.desktop-status').innerText(), '仅保存在本机');
  assert.equal(await page.locator('.auth-layer').count(), 0);
  const runtime = await app.evaluate(({ app, BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('http://127.0.0.1:'));
    return { node: process.versions.node, electron: process.versions.electron, packaged: app.isPackaged, preferences: main.webContents.getLastWebPreferences(), pid: process.pid };
  });
  assert.ok(Number(runtime.node.split('.')[0]) >= 22);
  assert.equal(runtime.preferences.sandbox, true);
  assert.equal(runtime.preferences.contextIsolation, true);
  assert.equal(runtime.preferences.nodeIntegration, false);
  const user = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user);
  assert.ok(user?.email.endsWith('@local.resumeprotocol.app'));
  const documentsBefore = await page.evaluate(async () => (await (await fetch('/api/documents')).json()).documents?.length || 0).catch(() => 0);
  await page.locator('input[type=file]').setInputFiles({ name: '桌面验收-简历.txt', mimeType: 'text/plain', buffer: Buffer.from('林同学\n教育经历\n示例大学 计算机科学 本科\n项目经历\n使用 React 和 JavaScript 完成课程项目，负责界面开发。\n技能\nReact JavaScript') });
  await page.locator('.attachment-status.parsed').first().waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: '打开简历预览', exact: true }).click();
  await page.waitForFunction(() => Boolean(document.querySelector('.evidence-panel iframe')?.contentDocument?.body?.innerText?.includes('林同学')), null, { timeout: 15000 });
  const suffix = packaged ? 'packaged' : 'dev';
  await page.screenshot({ path: path.join(output, `${suffix}-light.png`) });
  await page.getByRole('button', { name: '连接云端账户', exact: true }).click();
  const dialog = page.locator('.desktop-dialog');
  await dialog.getByLabel('邮箱', { exact: true }).fill('desktop-test@example.test');
  await dialog.getByLabel('密码', { exact: true }).fill('Only-for-local-UI-test');
  await dialog.getByRole('button', { name: '连接账户', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').innerText(), /尚未开放/);
  assert.equal(await dialog.getByLabel('密码', { exact: true }).inputValue(), '');
  await page.screenshot({ path: path.join(output, `${suffix}-cloud-dialog.png`) });
  await page.getByRole('button', { name: '关闭云端账户窗口' }).click();
  await page.getByRole('button', { name: '暗色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: path.join(output, `${suffix}-dark.png`) });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(await page.evaluate(() => window.resumeDesktop.sync.syncNow()), { state: 'local' });
  await assert.rejects(page.evaluate(() => window.resumeDesktop.sync.signIn({ email: '', password: '', cloudUrl: '' })), /尚未开放/);
  const accountFile = await readFile(path.join(profile, 'local-account.json'), 'utf8');
  const account = JSON.parse(accountFile);
  assert.ok(account.encryptedPassword && !account.password && account.registered);
  const log = await readFile(path.join(profile, 'logs/server.log'), 'utf8');
  assert.match(log, /node:sqlite available/);
  const probeRoot = packaged ? path.resolve('release/win-unpacked/resources/app.asar.unpacked') : path.resolve('.');
  // Exercise the actual installed SDK transport in a utility process; stop after
  // its initialize handshake. This requires no provider key and makes no chat claim.
  const probe = path.join(profile, 'probe-sdk.mjs');
  await writeFile(probe, `import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';const require=createRequire(${JSON.stringify(path.join(probeRoot, 'package.json'))});const sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href);const controller=new AbortController();const stream=sdk.query({prompt:'Reply OK',options:{cwd:${JSON.stringify(profile)},env:{...process.env,CLAUDE_CONFIG_DIR:${JSON.stringify(path.join(profile, 'sdk-probe'))}},tools:[],maxTurns:1,abortController:controller}});try{const result=await stream.initializationResult();process.parentPort.postMessage({ok:true,commands:result.commands?.length??0});}catch(e){process.parentPort.postMessage({ok:false,error:e.message});}finally{controller.abort();stream.close();}`);
  const sdk = await app.evaluate(({ utilityProcess }, probe) => new Promise(resolve => {
    const child = utilityProcess.fork(probe, [], { stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'SDK initialize timeout', stderr }); }, 30000);
    child.on('message', result => { clearTimeout(timer); resolve(result); });
    child.on('exit', code => { clearTimeout(timer); resolve({ ok: false, error: `SDK probe exited ${code}`, stderr }); });
  }), probe);
  assert.equal(sdk.ok, true, JSON.stringify(sdk));
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, `${suffix}-verification.json`), JSON.stringify({ runtime, userId: user.id, sdk, documentsBefore, txtUpload: 'parsed and previewed', screenshots: [`${suffix}-light.png`, `${suffix}-dark.png`, `${suffix}-cloud-dialog.png`], pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ mode: suffix, node: runtime.node, electron: runtime.electron, localAccount: 'authenticated', upload: 'parsed and previewed', sdk, pageErrors: errors }));
} finally {
  // app.close() can terminate without the normal app quit path. Explicitly quit
  // first to verify that the owned local server actually shuts down.
  await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); }).catch(() => {});
  await app.waitForEvent('close', { timeout: 15000 }).catch(() => app.close());
}
