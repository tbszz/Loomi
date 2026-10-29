// Builds build/python: the official Windows embeddable Python plus the export packages,
// shipped inside the installer so resume export works on machines without Python.
// Needs a host Python with pip (only to fetch wheels); the result never uses it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const version = '3.12.10';
const archive = `python-${version}-embed-amd64.zip`;
const sha256 = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3';
const packages = ['reportlab==5.1.0', 'python-docx==1.2.0', 'pypdf==6.7.5', 'pdfplumber==0.11.10'];
const cache = path.resolve('tmp/python-cache'), target = path.resolve('build/python'), sitePackages = path.join(target, 'Lib', 'site-packages');
const hostPython = process.env.RESUME_PROTOCOL_BUILD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit', windowsHide: true });

await mkdir(cache, { recursive: true });
const zipPath = path.join(cache, archive);
if (!existsSync(zipPath)) {
  const response = await fetch(`https://www.python.org/ftp/python/${version}/${archive}`);
  if (!response.ok) throw new Error(`Python download failed: HTTP ${response.status}`);
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
}
const actual = createHash('sha256').update(await readFile(zipPath)).digest('hex');
if (actual !== sha256) { await rm(zipPath); throw new Error(`${archive} sha256 mismatch: ${actual}`); }

await rm(target, { recursive: true, force: true });
await mkdir(sitePackages, { recursive: true });
// Windows' bsdtar reads zip archives; a Git Bash GNU tar on PATH would treat D: as a remote host.
run(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar', ['-xf', zipPath, '-C', target]);
// The embeddable build ignores site-packages until its ._pth file names it.
const pth = path.join(target, `python${version.split('.').slice(0, 2).join('')}._pth`);
await writeFile(pth, `${(await readFile(pth, 'utf8')).replace(/^#\s*import site/m, 'import site').trimEnd()}\nLib\\site-packages\n`);
run(hostPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile', '--only-binary=:all:', '--platform', 'win_amd64', '--python-version', version.split('.').slice(0, 2).join('.'), '--implementation', 'cp', '--target', sitePackages, ...packages]);
run(path.join(target, 'python.exe'), ['-I', '-c', 'import reportlab, docx, pypdf, pdfplumber; print("bundled python ok")']);
