import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hiringRadarRoot, HIRING_RADAR_REVISION } from '../server/hiringRadar.js';

const root = path.resolve(hiringRadarRoot());
const manifest = JSON.parse(readFileSync(new URL('../server/hiringRadarSources.json', import.meta.url), 'utf8'));
const git = args => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
if (!existsSync(root)) {
  mkdirSync(path.dirname(root), { recursive: true });
  git(['clone', '--no-checkout', '--filter=blob:none', manifest.repository + '.git', root]);
  git(['-C', root, 'checkout', '--detach', HIRING_RADAR_REVISION]);
}
// Never reset an existing checkout or silently upgrade the provider.
if (git(['-C', root, 'rev-parse', 'HEAD']).trim() !== HIRING_RADAR_REVISION) throw new Error('Hiring Radar checkout has a different revision; preserve it and select a fresh RESUME_PROTOCOL_HIRING_RADAR_DIR.');
for (const [relative, expected] of Object.entries(manifest.runtimeFiles)) {
  const content = readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== expected) throw new Error(`Hiring Radar file differs from pinned source: ${relative}`);
}
console.log(JSON.stringify({ installed: true, root, revision: HIRING_RADAR_REVISION, domesticSources: manifest.companies.length, optionalDependency: 'Moka sources require pycryptodome in RESUME_PROTOCOL_PYTHON.' }));
