import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveResumeLayout } from './resumeLayout.js';

const script = fileURLToPath(new URL('./export_resume.py', import.meta.url));
export function renderResume(resume, format, options = {}) {
  if (!['pdf','docx'].includes(format)) throw new Error('不支持的简历格式。');
  if (!resume?.name) throw new Error('请先生成优化后的简历。');
  const layout = resolveResumeLayout(resume, options);
  return runRenderer(script, {resume,format,layout});
}

export function annotatePdf(filename, annotations) {
  return runRenderer(fileURLToPath(new URL('./annotate_pdf.py', import.meta.url)), {filename,annotations});
}

function runRenderer(scriptPath, payload) {
  const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python = process.env.RESUME_PROTOCOL_PYTHON || (existsSync(bundled) ? bundled : process.platform === 'win32' ? 'python' : 'python3');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [scriptPath], { windowsHide:true, stdio:['pipe','pipe','pipe'], env:{...process.env, PYTHONIOENCODING:'utf-8'} });
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('简历导出超时，请重试。')); },30000);
    child.stdout.on('data', chunk => { size += chunk.length; if(size > 15*1024*1024) child.kill(); else chunks.push(chunk); });
    child.stderr.resume();
    child.on('error', () => {clearTimeout(timer);reject(new Error('导出运行环境不可用，请检查 Python、reportlab 和 python-docx。'));});
    child.on('close', code => { clearTimeout(timer); if(code !== 0) reject(new Error('简历导出失败，请检查导出运行环境后重试。')); else resolve(Buffer.concat(chunks)); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}
