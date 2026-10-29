import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { navigationAction, pythonDependencyInstall, pythonResult } from './core.js';

test('dependency IPC uses the server interpreter, rechecks failures and preserves unrelated warnings', async t => {
  const handlers = new Map(), calls = [], probes = [], broadcasts = [];
  let logs = '', failure, missing = ['reportlab', 'docx'];
  const executable = 'C:/Python With Spaces/python.exe';
  const window = { isDestroyed: () => false, webContents: { mainFrame: { url: 'http://127.0.0.1:1234/' }, send: (...args) => broadcasts.push(args) } };
  const fixture = {
    app: { isPackaged: false, getPath: () => process.cwd(), setPath() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => false, quit() {} },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on() {} },
    detectPython: async options => { probes.push(options); return pythonResult({ executable, missing }); },
    execFile: (command, args, options, callback) => {
      calls.push({ command, args, options });
      const child = { stdout: new PassThrough(), stderr: new PassThrough() };
      queueMicrotask(() => { child.stdout.end('pip stdout\n'); child.stderr.end('pip stderr\n'); callback(failure); });
      return child;
    },
  };
  // Inject Electron/process boundaries without launching a window or installing packages.
  // Only imports/import.meta are adapted; the production handler bodies run unchanged.
  const source = (await readFile(new URL('./main.js', import.meta.url), 'utf8')).replace(/^import .+;\r?$/gm, '').replaceAll('import.meta.url', 'mainFileUrl');
  const dependencies = { ...fixture, process, path, fileURLToPath, existsSync, navigationAction, pythonDependencyInstall, mainFileUrl: new URL('./main.js', import.meta.url).href };
  const setupFixture = compileFunction(`${source}\nreturn f => { log = f.log; mainWindow = f.window; origin = f.origin; python = f.python; pythonExecutable = python.executable; warnings = [...python.warnings, 'unrelated warning']; installBridge(); };`, Object.keys(dependencies))(...Object.values(dependencies));
    setupFixture({ log: { write: value => { logs += value; } }, window, origin: 'http://127.0.0.1:1234', python: pythonResult({ executable, missing }) });
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    const install = () => handlers.get('desktop:install-python-deps')(event);
    const diagnostics = () => handlers.get('desktop:diagnostics')(event);
    await t.test('rejects foreign renderers and subframes', () => {
      assert.throws(() => handlers.get('desktop:install-python-deps')({ ...event, sender: {} }), /access denied/);
      assert.throws(() => handlers.get('desktop:install-python-deps')({ ...event, senderFrame: { ...event.senderFrame } }), /access denied/);
      assert.equal(calls.length, 0);
    });
    await t.test('serializes installs, logs output, and rejects pip failures after rechecking', async () => {
      failure = new Error('pip fixture: network unavailable');
      const pending = install();
      assert.equal(install(), pending);
      await assert.rejects(pending, /pip fixture: network unavailable/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, executable);
      assert.deepEqual(calls[0].args, ['-m', 'pip', 'install', '--user', 'reportlab', 'python-docx']);
      assert.equal(calls[0].options.windowsHide, true);
      assert.equal(calls[0].options.timeout, 300000);
      assert.notEqual(calls[0].options.shell, true);
      assert.equal(probes[0].env.RESUME_PROTOCOL_PYTHON, executable);
      assert.match(logs, /pip stdout/); assert.match(logs, /pip stderr/); assert.match(logs, /network unavailable/);
      assert.equal(diagnostics().warnings[0], 'unrelated warning');
      assert.equal(diagnostics().warnings[1].code, 'python-deps');
      assert.equal(broadcasts.at(-1)[0], 'desktop:warnings');
    });
    await t.test('a successful pip exit cannot hide missing modules', async () => {
      failure = undefined; missing = ['docx'];
      await assert.rejects(install(), /python-docx/);
      assert.equal(diagnostics().warnings.length, 2);
    });
    await t.test('only a clean recheck clears the dependency warning', async () => {
      missing = [];
      assert.deepEqual(await install(), { warnings: ['unrelated warning'] });
      assert.deepEqual(broadcasts.at(-1), ['desktop:warnings', ['unrelated warning']]);
      assert.equal(probes.length, 3);
    });
});
