import net from 'node:net';
import crypto from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export function navigationAction(value, origin) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return 'deny';
    return url.origin === origin && !url.username && !url.password ? 'allow' : 'external';
  } catch { return 'deny'; }
}

export async function saveLocalAccount(file, account, { encrypt }) {
  const { password, ...metadata } = account;
  const encryptedPassword = encrypt(password).toString('base64');
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify({ ...metadata, encryptedPassword }), { mode: 0o600 });
  await rename(temporary, file);
}

export async function loadLocalAccount(file, codec, username) {
  try {
    const { encryptedPassword, ...metadata } = JSON.parse(await readFile(file, 'utf8'));
    const password = codec.decrypt(Buffer.from(encryptedPassword, 'base64'));
    if (metadata.version !== 1 || !metadata.email || Buffer.from(password, 'base64url').length !== 32) throw new Error('本机账户文件损坏，请先备份数据并查看日志。');
    return { ...metadata, password };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const account = { version: 1, email: `${crypto.randomUUID()}@local.resumeprotocol.app`, name: String(username || '本机用户').slice(0, 120), password: crypto.randomBytes(32).toString('base64url'), registered: false };
  // Persist before the network operation, so an interrupted registration can recover.
  await saveLocalAccount(file, account, codec);
  return account;
}

export async function authenticateLocalAccount(account, request) {
  let response = await request('/api/auth/login', account);
  if (response.status === 401 && !account.registered) {
    const registration = await request('/api/auth/register', account);
    if (!registration.ok && registration.status !== 409) throw new Error((await registration.json()).error || '无法创建本机账户');
    response = await request('/api/auth/login', account);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '本机账户登录失败');
  const cookie = response.headers.get('set-cookie');
  if (!cookie || !result.user) throw new Error('本机账户登录未返回有效会话');
  return { user: result.user, cookie };
}

export function pythonDependencyInstall(executable) {
  if (!executable) throw new Error('未找到 Python。安装 Python 3 后重启即可。');
  return { command: executable, args: ['-m', 'pip', 'install', '--user', 'reportlab', 'python-docx'] };
}

export function pythonResult(result) {
  if (!result) return { executable: null, missing: [], warnings: [{ code: 'python-missing', message: '未找到 Python。简历导出和招聘资讯采集暂不可用；上传材料与本机记录仍可使用。安装 Python 3 后重启即可。' }] };
  if (!result.executable || !Array.isArray(result.missing)) throw new Error('Python 检测结果无效。');
  const packages = result.missing.map(m => m === 'docx' ? 'python-docx' : m);
  return { executable: result.executable, missing: result.missing, warnings: packages.length ? [{ code: 'python-deps', packages, message: `Python 已找到；简历导出还需要安装 ${packages.join('、')}。` }] : [] };
}

export async function detectPython({ run = promisify(execFile), env = process.env, platform = process.platform } = {}) {
  const probe = 'import sys,json,importlib.util; print(json.dumps({"executable":sys.executable,"missing":[m for m in ["reportlab","docx"] if importlib.util.find_spec(m) is None]}))';
  const candidates = env.RESUME_PROTOCOL_PYTHON ? [[env.RESUME_PROTOCOL_PYTHON, []]] : platform === 'win32' ? [['python', []], ['py', ['-3']], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [command, prefix] of candidates) {
    try {
      const { stdout } = await run(command, [...prefix, '-c', probe], { timeout: 4000, windowsHide: true, encoding: 'utf8', env: { ...env, PYTHONIOENCODING: 'utf-8' } });
      const result = JSON.parse(stdout.trim());
      if (!result.executable) continue;
      return pythonResult(result);
    } catch { /* Windows Store aliases and broken interpreters are not usable Python. */ }
  }
  return pythonResult(null);
}

export function windowBounds(saved = {}, areas) {
  const width = Math.max(1100, Math.min(Number(saved.width) || 1440, Math.max(...areas.map(a => a.width))));
  const height = Math.max(700, Math.min(Number(saved.height) || 960, Math.max(...areas.map(a => a.height))));
  const visible = areas.some(a => Number.isFinite(saved.x) && Number.isFinite(saved.y) && saved.x >= a.x && saved.y >= a.y && saved.x + 180 <= a.x + a.width && saved.y + 100 <= a.y + a.height);
  return { width, height, ...(visible ? { x: saved.x, y: saved.y } : {}) };
}
