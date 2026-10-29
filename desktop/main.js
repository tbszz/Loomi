import { app, BrowserWindow, Menu, ipcMain, nativeTheme, safeStorage, screen, shell } from 'electron';
import { fork } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { findFreePort, navigationAction, detectPython, loadLocalAccount, saveLocalAccount, authenticateLocalAccount, windowBounds } from './core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : path.dirname(here);
// A separate profile is useful for QA and portable development; never the repository data/.
if (process.env.RESUME_PROTOCOL_DESKTOP_USER_DATA) app.setPath('userData', path.resolve(process.env.RESUME_PROTOCOL_DESKTOP_USER_DATA));
// Installs from before the Loomi rename keep their profile under the old product name.
else {
  const legacy = path.join(app.getPath('appData'), 'Resume Protocol');
  if (existsSync(legacy) && !existsSync(app.getPath('userData'))) app.setPath('userData', legacy);
}
app.setAppUserModelId('com.resumeprotocol.desktop');
const userData = app.getPath('userData');
const dataDir = path.join(userData, 'data');
const logDir = path.join(userData, 'logs');
const logPath = path.join(logDir, 'server.log');
let mainWindow, loadingWindow, child, log, origin, saved = {}, quitting = false, stopping = false, serverExited = false;
let warnings = [];
const localStatus = () => ({ state: 'local' });
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const window = mainWindow || loadingWindow;
    if (window?.isMinimized()) window.restore();
    window?.show(); window?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    quitting = true;
    if (child && !serverExited) {
      event.preventDefault();
      if (!stopping) {
        stopping = true;
        if (child.connected) child.send('shutdown');
        // Active connections may prevent graceful close; never leave an orphan server.
        setTimeout(() => { if (!serverExited) child.kill(); }, 5000).unref();
      }
    }
  });
  app.whenReady().then(start).catch(showFailure);
}

async function start() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  try { if ((await stat(logPath)).size > 5 * 1024 * 1024) await rename(logPath, `${logPath}.previous`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  log = createWriteStream(logPath, { flags: 'a' });
  log.on('error', error => { console.error('Desktop log unavailable:', error.message); app.quit(); });
  try { saved = JSON.parse(await readFile(path.join(userData, 'window.json'), 'utf8')); } catch { /* defaults */ }
  makeMenu();
  loadingWindow = new BrowserWindow({ width: 520, height: 360, resizable: false, autoHideMenuBar: true, backgroundColor: '#faf9f6', icon: path.join(here, 'assets/icon.png'), webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await loadingWindow.loadURL(shellPage('你的下一步，从这里开始。', '正在打开本机工作区', false));
  loadingWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  loadingWindow.webContents.on('will-navigate', event => event.preventDefault());

  const port = await findFreePort();
  origin = `http://127.0.0.1:${port}`;
  const python = await detectPython();
  warnings = python.warnings;
  const env = { ...process.env, RESUME_PROTOCOL_PORT: String(port), RESUME_PROTOCOL_HOST: '127.0.0.1', RESUME_PROTOCOL_DATA_DIR: dataDir, RESUME_PROTOCOL_SECURE_COOKIES: 'false', ...(python.executable ? { RESUME_PROTOCOL_PYTHON: python.executable } : {}) };
  // PDF.js classifies Electron utility processes as renderers (no DOMMatrix).
  // A regular fork in Node mode preserves its real Node detection and sqlite.
  env.ELECTRON_RUN_AS_NODE = '1';
  child = fork(path.join(root, 'desktop/server-entry.js'), [], { execPath: process.execPath, execArgv: [], cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.on('data', bytes => log.write(bytes));
  child.stderr.on('data', bytes => log.write(bytes));
  child.on('error', error => { serverExited = true; log.write(`[desktop] Server process: ${error.message}\n`); });
  child.on('exit', code => {
    serverExited = true;
    log.write(`\n[desktop] Local server exited (${code})\n`);
    if (quitting) { log.end(() => app.quit()); }
    else if (mainWindow && !mainWindow.isDestroyed()) {
      warnings = [...warnings, '本机服务已停止。请保存当前内容并重启应用；可从帮助菜单打开日志。'];
      mainWindow.webContents.send('desktop:warnings', warnings);
    }
  });
  await waitUntilReady();
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 账户加密服务不可用，无法安全保存本机账户。请检查系统账户后重试。');
  const codec = { encrypt: value => safeStorage.encryptString(value), decrypt: bytes => safeStorage.decryptString(bytes) };
  const accountPath = path.join(userData, 'local-account.json');
  const account = await loadLocalAccount(accountPath, codec, os.userInfo().username);
  const authenticated = await authenticateLocalAccount(account, (endpoint, payload) => fetch(`${origin}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: payload.email, password: payload.password, name: payload.name }), signal: AbortSignal.timeout(15000) }));
  await saveLocalAccount(accountPath, { ...account, registered: true }, codec);
  if (quitting) return;
  const bounds = windowBounds(saved, screen.getAllDisplays().map(display => display.workArea));
  mainWindow = new BrowserWindow({ ...bounds, minWidth: 1100, minHeight: 700, show: false, autoHideMenuBar: true, title: 'Loomi', titleBarStyle: 'hidden', titleBarOverlay: overlay(saved.theme), backgroundColor: saved.theme === 'dark' ? '#262624' : '#faf9f6', icon: path.join(here, 'assets/icon.png'), webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, additionalArguments: [`--resume-version=${app.getVersion()}`] } });
  const session = mainWindow.webContents.session;
  const pair = authenticated.cookie.split(';')[0];
  const separator = pair.indexOf('=');
  await session.cookies.set({ url: origin, name: pair.slice(0, separator), value: pair.slice(separator + 1), path: '/', httpOnly: true, sameSite: 'lax' });
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (new URL(details.url).origin === origin) headers['Content-Security-Policy'] = ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'"];
    callback({ responseHeaders: headers });
  });
  const external = url => { if (navigationAction(url, origin) === 'external') shell.openExternal(url).catch(error => log.write(`[desktop] External link failed: ${error.message}\n`)); };
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) mainWindow.webContents.on(event, (e, legacyUrl) => {
    const url = e.url || legacyUrl;
    if (navigationAction(url, origin) !== 'allow') { e.preventDefault(); if (e.isMainFrame !== false) external(url); }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  installBridge();
  mainWindow.on('close', () => {
    saved = { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized(), theme: saved.theme };
    // A tiny local preference file; synchronous close acknowledgement is unnecessary.
    writeFile(path.join(userData, 'window.json'), JSON.stringify(saved)).catch(error => log.write(`[desktop] Window preferences: ${error.message}\n`));
  });
  await mainWindow.loadURL(`${origin}/#workspace`);
  if (saved.maximized) mainWindow.maximize();
  mainWindow.show();
  loadingWindow?.destroy(); loadingWindow = null;
  nativeTheme.on('updated', () => mainWindow?.webContents.send('desktop:theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
}

async function waitUntilReady() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error('本机服务未能启动。');
    if (quitting) throw new Error('应用已关闭。');
    try { const response = await fetch(`${origin}/api/auth/me`, { signal: AbortSignal.timeout(1000) }); if (response.ok && 'user' in await response.json()) return; } catch { /* keep waiting */ }
    await delay(150);
  }
  throw new Error('本机服务启动超时（45 秒）。');
}

function overlay(theme) { return { color: theme === 'dark' ? '#262624' : '#faf9f6', symbolColor: theme === 'dark' ? '#f0eee7' : '#292722', height: 36 }; }

function installBridge() {
  const allowed = event => event.sender === mainWindow?.webContents && event.senderFrame === mainWindow.webContents.mainFrame && navigationAction(event.senderFrame.url, origin) === 'allow';
  const handle = (name, callback) => ipcMain.handle(name, (event, ...args) => { if (!allowed(event)) throw new Error('Desktop bridge access denied'); return callback(...args); });
  handle('desktop:open-data', () => openPath(dataDir));
  handle('desktop:open-logs', () => openPath(logPath));
  handle('desktop:diagnostics', () => ({ warnings, cloudUrl: process.env.RESUME_PROTOCOL_CLOUD_URL || 'https://app.resumeprotocol.com' }));
  for (const name of ['status', 'sign-out', 'now']) handle(`desktop:sync-${name}`, localStatus);
  handle('desktop:sync-sign-in', () => { throw new Error('云端账户连接尚未开放。你的材料与对话仍只保存在本机。'); });
  ipcMain.on('desktop:theme', (event, theme) => {
    if (!allowed(event) || !['light', 'dark'].includes(theme)) return;
    saved.theme = theme;
    if (process.platform === 'win32') mainWindow.setTitleBarOverlay(overlay(theme));
  });
}

async function openPath(target) { const error = await shell.openPath(target); if (error) throw new Error(error); }
function makeMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    ...(!app.isPackaged ? [{ label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] }] : []),
    { label: '帮助', submenu: [{ label: '打开数据文件夹', click: () => openPath(dataDir).catch(showFailure) }, { label: '打开日志', click: () => openPath(logPath).catch(showFailure) }, { label: `Loomi ${app.getVersion()}`, enabled: false }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
  ]));
}

function shellPage(title, detail, failed) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Loomi</title><style>body{margin:0;padding:48px;background:#faf9f6;color:#292722;font:14px/1.7 'Segoe UI','Microsoft YaHei',sans-serif}.mark{width:48px;height:48px;display:grid;place-items:center;border-radius:14px;background:#b66d51;color:#fff;font-weight:700;font-size:20px}small{display:block;letter-spacing:2px;color:#756f64;margin:20px 0 8px}h1{font-size:22px;font-weight:600;margin:0 0 12px}p{color:#756f64;overflow-wrap:anywhere;user-select:text}.pulse{width:28px;height:3px;background:#b66d51;margin-top:24px;animation:pulse 1.3s ease-in-out infinite alternate}@keyframes pulse{to{opacity:.2;transform:scaleX(2)}}@media(prefers-reduced-motion:reduce){.pulse{animation:none}}</style><div class="mark">L</div><small>LOOMI</small><h1>${escape(title)}</h1><p>${escape(detail)}</p>${failed ? '' : '<div class="pulse"></div>'}</html>`)}`;
}

async function showFailure(error) {
  if (quitting) return;
  log?.write(`[desktop] ${error.stack || error.message}\n`);
  console.error(error);
  if (!loadingWindow || loadingWindow.isDestroyed()) loadingWindow = new BrowserWindow({ width: 660, height: 500, autoHideMenuBar: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  mainWindow?.destroy(); mainWindow = null;
  await loadingWindow.loadURL(shellPage('暂时无法打开工作区', `${error.message} 日志：${logPath}。你可以从「帮助」菜单打开日志，检查后重启应用。`, true));
  loadingWindow.setMenuBarVisibility(true); loadingWindow.show();
}
