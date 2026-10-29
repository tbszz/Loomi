import { app, BrowserWindow, Menu, ipcMain, nativeTheme, screen, shell } from 'electron';
import { fork, execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { findFreePort, navigationAction, detectPython, pythonDependencyInstall, windowBounds } from './core.js';

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
let python, pythonExecutable, installingPython;
let locale = 'en';
const text = (en, zh) => locale === 'zh' ? zh : en;
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
  locale = saved.locale === 'zh' ? 'zh' : 'en';
  makeMenu();

  const port = await findFreePort();
  origin = `http://127.0.0.1:${port}`;
  // Open the dark main window at once; the intro plays here as soon as the server answers.
  const bounds = windowBounds(saved, screen.getAllDisplays().map(display => display.workArea));
  mainWindow = new BrowserWindow({ ...bounds, minWidth: 1100, minHeight: 700, autoHideMenuBar: true, title: 'Loomi', titleBarStyle: 'hidden', titleBarOverlay: overlay('dark'), backgroundColor: '#121211', icon: path.join(here, 'assets/icon.png'), webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, additionalArguments: [`--resume-version=${app.getVersion()}`, `--loomi-locale=${locale}`, ...(['light', 'dark'].includes(saved.theme) ? [`--loomi-theme=${saved.theme}`] : [])] } });
  const session = mainWindow.webContents.session;
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
  // index.html is shared with the web build; the desktop window always reads Loomi.
  mainWindow.on('page-title-updated', event => event.preventDefault());
  installBridge();
  mainWindow.on('close', () => {
    saved = { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized(), theme: saved.theme, locale };
    // A tiny local preference file; synchronous close acknowledgement is unnecessary.
    writeFile(path.join(userData, 'window.json'), JSON.stringify(saved)).catch(error => log.write(`[desktop] Window preferences: ${error.message}\n`));
  });
  if (saved.maximized) mainWindow.maximize();
  // The installer ships its own Python with the export packages; a system Python is only the fallback.
  const bundledPython = path.join(process.resourcesPath, 'python', 'python.exe');
  if (app.isPackaged && !process.env.RESUME_PROTOCOL_PYTHON && existsSync(bundledPython)) python = await detectPython({ env: { ...process.env, RESUME_PROTOCOL_PYTHON: bundledPython } });
  if (!python?.executable) python = await detectPython();
  pythonExecutable = python.executable;
  warnings = python.warnings;
  // Export packages are installed for the user in the background; the warning only returns if that fails.
  if (python.executable && python.missing.length) {
    warnings = [];
    python = { ...python, warnings: [] };
    installingPython = installPythonDeps().catch(() => {}).finally(() => { installingPython = null; });
  }
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
      warnings = [...warnings, { code: 'server-stopped', message: '本机服务已停止。请保存当前内容并重启应用；可从帮助菜单打开日志。' }];
      mainWindow.webContents.send('desktop:warnings', warnings);
    }
  });
  await waitUntilReady();
  if (quitting) return;
  await mainWindow.loadURL(`${origin}/`);
  nativeTheme.on('updated', () => mainWindow?.webContents.send('desktop:theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
}

async function waitUntilReady() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error(text('The local service failed to start.', '本机服务未能启动。'));
    if (quitting) throw new Error(text('The app was closed.', '应用已关闭。'));
    try { const response = await fetch(`${origin}/api/auth/me`, { signal: AbortSignal.timeout(1000) }); if (response.ok && 'user' in await response.json()) return; } catch { /* keep waiting */ }
    await delay(150);
  }
  throw new Error(text('The local service did not start within 45 seconds.', '本机服务启动超时（45 秒）。'));
}

function overlay(theme) { return { color: theme === 'dark' ? '#262624' : '#faf9f6', symbolColor: theme === 'dark' ? '#f0eee7' : '#292722', height: 36 }; }

function installBridge() {
  const allowed = event => event.sender === mainWindow?.webContents && event.senderFrame === mainWindow.webContents.mainFrame && navigationAction(event.senderFrame.url, origin) === 'allow';
  const handle = (name, callback) => ipcMain.handle(name, (event, ...args) => { if (!allowed(event)) throw new Error('Desktop bridge access denied'); return callback(...args); });
  handle('desktop:open-data', () => openPath(dataDir));
  handle('desktop:open-logs', () => openPath(logPath));
  handle('desktop:diagnostics', () => ({ warnings, cloudUrl: process.env.RESUME_PROTOCOL_CLOUD_URL || 'https://app.resumeprotocol.com' }));
  handle('desktop:install-python-deps', () => {
    if (!installingPython) installingPython = installPythonDeps().finally(() => { installingPython = null; });
    return installingPython;
  });
  for (const name of ['status', 'sign-out', 'now']) handle(`desktop:sync-${name}`, localStatus);
  handle('desktop:sync-sign-in', () => { throw new Error(locale === 'zh' ? '云端账户连接尚未开放。你的材料与对话仍只保存在本机。' : 'Cloud connection is not available yet. Your materials and conversations stay on this computer.'); });
  ipcMain.on('desktop:set-locale', (event, value) => {
    if (!allowed(event) || (value !== 'en' && value !== 'zh')) return;
    locale = value;
    makeMenu();
  });
  ipcMain.on('desktop:theme', (event, theme) => {
    if (!allowed(event) || !['light', 'dark'].includes(theme)) return;
    saved.theme = theme;
    if (process.platform === 'win32') mainWindow.setTitleBarOverlay(overlay(theme));
  });
}

async function installPythonDeps() {
  const { command, args } = pythonDependencyInstall(pythonExecutable);
  log.write('\n[desktop] Installing Python export dependencies\n');
  let failure;
  try {
    await new Promise((resolve, reject) => {
      const installer = execFile(command, args, { windowsHide: true, timeout: 300000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, error => error ? reject(error) : resolve());
      installer.stdout.on('data', bytes => log.write(bytes));
      installer.stderr.on('data', bytes => log.write(bytes));
    });
  } catch (error) { failure = error; log.write(`[desktop] Python dependency install: ${error.message}\n`); }
  const checked = await detectPython({ env: { ...process.env, RESUME_PROTOCOL_PYTHON: pythonExecutable } });
  warnings = [...warnings.filter(warning => !python.warnings.includes(warning)), ...checked.warnings];
  python = checked;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:warnings', warnings);
  if (failure) throw failure;
  if (!checked.executable || checked.missing.length) throw new Error(checked.warnings.map(warning => warning.code === 'python-deps' ? text(`Python found; résumé export still needs ${warning.packages.join(', ')}.`, warning.message) : warning.code === 'python-missing' ? text('Python not found. Install Python 3, then restart.', warning.message) : warning.message || warning).join('\n'));
  return { warnings };
}

async function openPath(target) { const error = await shell.openPath(target); if (error) throw new Error(error); }
function makeMenu() {
  const label = (en, zh) => locale === 'zh' ? zh : en;
  const role = (role, en, zh) => ({ role, label: label(en, zh) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: label('Edit', '编辑'), submenu: [role('undo', 'Undo', '撤销'), role('redo', 'Redo', '重做'), { type: 'separator' }, role('cut', 'Cut', '剪切'), role('copy', 'Copy', '复制'), role('paste', 'Paste', '粘贴'), role('selectAll', 'Select all', '全选')] },
    ...(!app.isPackaged ? [{ label: label('View', '视图'), submenu: [role('reload', 'Reload', '重新加载'), role('toggleDevTools', 'Toggle developer tools', '切换开发者工具')] }] : []),
    { label: label('Help', '帮助'), submenu: [{ label: label('Open data folder', '打开数据文件夹'), click: () => openPath(dataDir).catch(showFailure) }, { label: label('Open logs', '打开日志'), click: () => openPath(logPath).catch(showFailure) }, { label: `Loomi ${app.getVersion()}`, enabled: false }, { type: 'separator' }, role('quit', 'Quit', '退出')] },
  ]));
}

function shellPage(title, detail, failed) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="${locale === 'zh' ? 'zh-CN' : 'en'}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Loomi</title><style>body{margin:0;padding:48px;background:#faf9f6;color:#292722;font:14px/1.7 'Segoe UI','Microsoft YaHei',sans-serif}.mark{width:48px;height:48px;display:grid;place-items:center;border-radius:14px;background:#b66d51;color:#fff;font-weight:700;font-size:20px}small{display:block;letter-spacing:2px;color:#756f64;margin:20px 0 8px}h1{font-size:22px;font-weight:600;margin:0 0 12px}p{color:#756f64;overflow-wrap:anywhere;user-select:text}.pulse{width:28px;height:3px;background:#b66d51;margin-top:24px;animation:pulse 1.3s ease-in-out infinite alternate}@keyframes pulse{to{opacity:.2;transform:scaleX(2)}}@media(prefers-reduced-motion:reduce){.pulse{animation:none}}</style><div class="mark">L</div><small>LOOMI</small><h1>${escape(title)}</h1><p>${escape(detail)}</p>${failed ? '' : '<div class="pulse"></div>'}</html>`)}`;
}

async function showFailure(error) {
  if (quitting) return;
  log?.write(`[desktop] ${error.stack || error.message}\n`);
  console.error(error);
  if (!loadingWindow || loadingWindow.isDestroyed()) loadingWindow = new BrowserWindow({ width: 660, height: 500, autoHideMenuBar: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  mainWindow?.destroy(); mainWindow = null;
  await loadingWindow.loadURL(shellPage(text('Can’t open the workspace right now', '暂时无法打开工作区'), text(`${error.message} Log: ${logPath}. Open it from the Help menu, then restart the app.`, `${error.message} 日志：${logPath}。你可以从「帮助」菜单打开日志，检查后重启应用。`), true));
  loadingWindow.setMenuBarVisibility(true); loadingWindow.show();
}
