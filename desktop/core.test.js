import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findFreePort, navigationAction, detectPython, pythonDependencyInstall, pythonResult, loadLocalAccount, authenticateLocalAccount, windowBounds } from './core.js';
import { syncStatusLabel } from '../src/desktop/sync-status.js';

test('free port is bound only on loopback and is available after selection', async () => {
  const port = await findFreePort();
  assert.ok(port > 0);
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  await new Promise(resolve => server.close(resolve));
});

test('navigation requires the exact local origin; external links only permit http(s)', () => {
  const origin = 'http://127.0.0.1:4321';
  for (const url of [origin, `${origin}/#workspace`, `${origin}/api/documents/x`]) assert.equal(navigationAction(url, origin), 'allow');
  for (const url of ['https://example.com', 'http://127.0.0.1:4322', 'http://127.0.0.1.evil.test:4321']) assert.equal(navigationAction(url, origin), 'external');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'garbage']) assert.equal(navigationAction(url, origin), 'deny');
});

test('account is encrypted, stable across restarts, and corruption never creates a new identity', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'desktop-account-'));
  const file = path.join(dir, 'local-account.json');
  const codec = { encrypt: text => Buffer.from(text).reverse(), decrypt: bytes => Buffer.from(bytes).reverse().toString() };
  try {
    const account = await loadLocalAccount(file, codec, 'Alice');
    assert.equal(Buffer.from(account.password, 'base64url').length, 32);
    assert.equal(account.name, 'Alice');
    assert.ok(!(await readFile(file, 'utf8')).includes(account.password));
    assert.deepEqual(await loadLocalAccount(file, codec, 'Other'), account);
    await writeFile(file, 'broken');
    await assert.rejects(loadLocalAccount(file, codec, 'Alice'));
    assert.equal(await readFile(file, 'utf8'), 'broken');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a pending account recovers after register acknowledgement is lost', async () => {
  const calls = [];
  const request = async endpoint => {
    calls.push(endpoint);
    if (endpoint === '/api/auth/login' && calls.length === 1) return new Response('{}', { status: 401 });
    if (endpoint === '/api/auth/register') return new Response('{}', { status: 409 });
    return new Response('{"user":{"id":"local"}}', { headers: { 'set-cookie': 'resume_protocol_session=token; HttpOnly; Path=/' } });
  };
  const result = await authenticateLocalAccount({ email: 'a@local.test', password: 'secret', name: 'A', registered: false }, request);
  assert.equal(result.cookie, 'resume_protocol_session=token; HttpOnly; Path=/');
  assert.deepEqual(calls, ['/api/auth/login', '/api/auth/register', '/api/auth/login']);
});

test('registered account login failure is never silently replaced', async () => {
  const calls = [];
  await assert.rejects(authenticateLocalAccount({ registered: true }, async endpoint => {
    calls.push(endpoint); return new Response('{"error":"登录失败"}', { status: 401 });
  }), /登录失败/);
  assert.deepEqual(calls, ['/api/auth/login']);
});

test('Python detection skips store aliases, resolves interpreter, reports missing modules without blocking', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, args]);
    if (command === 'python') throw new Error('missing');
    return { stdout: JSON.stringify({ executable: 'C:/Python/python.exe', missing: ['reportlab'] }) };
  };
  const result = await detectPython({ run, platform: 'win32', env: {} });
  assert.equal(result.executable, 'C:/Python/python.exe');
  assert.match(result.warnings[0].message, /reportlab/);
  assert.ok(calls.every(([, args]) => args.includes('-c')));
  assert.equal((await detectPython({ run: async () => { throw new Error('not found'); }, env: {}, platform: 'win32' })).executable, null);
});

test('dependency install uses the detected interpreter as a literal executable with fixed pip arguments', () => {
  assert.deepEqual(pythonDependencyInstall('C:/Python With Spaces/python.exe'), { command: 'C:/Python With Spaces/python.exe', args: ['-m', 'pip', 'install', '--user', 'reportlab', 'python-docx'] });
  assert.throws(() => pythonDependencyInstall(null), /未找到 Python/);
});

test('dependency warnings identify repairable modules and disappear only after a clean probe', () => {
  const missing = pythonResult({ executable: 'python.exe', missing: ['reportlab', 'docx'] });
  assert.deepEqual(missing.missing, ['reportlab', 'docx']);
  assert.equal(missing.warnings[0].code, 'python-deps');
  assert.match(missing.warnings[0].message, /reportlab、python-docx/);
  assert.deepEqual(pythonResult({ executable: 'python.exe', missing: [] }).warnings, []);
  assert.equal(pythonResult(null).executable, null);
  assert.match(pythonResult(null).warnings[0], /未找到 Python/);
  assert.throws(() => pythonResult({ executable: 'python.exe' }), /Python/);
});

test('dependency recheck pins the same interpreter passed to the server and never falls back', async () => {
  const calls = [];
  const result = await detectPython({ env: { RESUME_PROTOCOL_PYTHON: 'C:/Detected/python.exe' }, platform: 'win32', run: async (command, args, options) => {
    calls.push({ command, args, options });
    throw new Error('probe failed');
  } });
  assert.equal(result.executable, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'C:/Detected/python.exe');
  assert.equal(calls[0].options.windowsHide, true);
});

test('remembered bounds from a removed monitor are restored to a visible display', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.equal(windowBounds({ x: -3000, y: 0, width: 1400, height: 900 }, [area]).x, undefined);
  assert.equal(windowBounds({ x: 20, y: 20, width: 1400, height: 900 }, [area]).x, 20);
});

test('contract states have honest Chinese labels', () => {
  assert.equal(syncStatusLabel({ state: 'local' }), '仅保存在本机');
  assert.equal(syncStatusLabel({ state: 'syncing' }), '正在同步');
  assert.equal(syncStatusLabel({ state: 'synced' }), '已同步');
  assert.equal(syncStatusLabel({ state: 'offline', pending: 3 }), '离线（3 项待上传）');
  assert.equal(syncStatusLabel({ state: 'error', message: '连接超时' }), '同步出错（连接超时）');
  assert.equal(syncStatusLabel({ state: 'unknown' }), '同步出错（无法识别账户状态）');
});
