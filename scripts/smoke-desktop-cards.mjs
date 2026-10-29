// Real Electron startup, using an isolated profile in this worktree.
import assert from 'node:assert/strict';
import path from 'node:path';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { _electron as electron } from 'playwright-core';

const output = path.resolve('output/desktop-cards');
await mkdir(output, { recursive: true });
const env = { ...process.env, RESUME_PROTOCOL_DESKTOP_USER_DATA: path.resolve('tmp/cards-electron-profile') };
delete env.ELECTRON_RUN_AS_NODE;
// Do not require('electron'): that entry point may install into shared node_modules.
const executablePath = path.resolve('node_modules/electron/dist/electron.exe');
await access(executablePath);
const app = await electron.launch({ executablePath, args: [path.resolve('.')], env, timeout: 60000 });
let origin;
try {
  let page;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    page = app.windows().find(window => /^http:\/\/127\.0\.0\.1:\d+\/#workspace/.test(window.url()));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(page, 'Electron must open its local workspace');
  origin = new URL(page.url()).origin;
  await page.locator('.workspace-chat .aui-composer-input').waitFor();
  await page.locator('.desktop-account-card').waitFor();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  assert.equal(await page.locator('.chat-header [data-card-toggle]').count(), 3);
  await page.locator('.chat-header [data-card-toggle="documents"]').click();
  await page.locator('[data-card-id="documents"]').waitFor();
  await page.locator('.evidence-panel .candidate-facts').waitFor();
  assert.equal(await page.locator('[data-card-id="documents"]').getAttribute('data-floating'), 'false');
  const runtime = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('#workspace'));
    const preferences = window.webContents.getLastWebPreferences();
    return { electron: process.versions.electron, node: process.versions.node, sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation };
  });
  assert(runtime.sandbox && runtime.contextIsolation);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'electron-workspace.png'), animations: 'disabled' });
  await writeFile(path.join(output, 'electron-verification.json'), JSON.stringify({ passed: true, runtime, checks: ['workspace-starts', 'local-account', 'three-toggles', 'documents-default-docked'], pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ passed: true, runtime, workspace: 'rendered', documents: 'docked' }));
} finally {
  await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); }).catch(() => {});
  await app.waitForEvent('close', { timeout: 15000 }).catch(() => app.close());
  if (origin) await assert.rejects(fetch(`${origin}/api/health`), /fetch failed/, 'owned Electron server must close');
}
