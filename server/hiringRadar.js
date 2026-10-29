import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('./hiringRadarSources.json', import.meta.url), 'utf8'));
export const HIRING_RADAR_REVISION = manifest.revision;
export const hiringRadarRoot = () => process.env.RESUME_PROTOCOL_HIRING_RADAR_DIR || path.join(process.env.RESUME_PROTOCOL_DATA_DIR || path.join(projectRoot, 'data'), 'integrations', 'hiring-radar');
export const HIRING_RADAR_FEEDS = manifest.companies.map(company => ({
  id: `hiring-radar-${company.key}`, localKey: company.key, company: company.company,
  title: `${company.company}（Hiring Radar）`, ...company, format: 'hiring-radar', kind: 'official',
  sourceType: 'official-company', group: 'Hiring Radar 国内企业官网',
  originSourceUrl: manifest.repository, refreshMs: 12 * 3600000,
  // The bridge rejects partial walks before any snapshot is imported.
  snapshot: true, allowEmpty: true, adapter: { kind: 'hiring-radar', status: 'verified', reason: '已适配采集契约；实际连通性以同步状态为准。' }
}));

const plain = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
function jobType(value) {
  const text = String(value || '');
  const types = [/实习|intern/i.test(text) && 'internship', /校招|校园|应届|campus|graduate/i.test(text) && 'campus', /社招|社会|全职|full.?time|experienced/i.test(text) && 'social'].filter(Boolean);
  return types.length === 1 ? types[0] : '';
}

export function mapHiringRadarRows(rows, feed, now = Date.now()) {
  const origin = new URL(feed.url);
  return rows.flatMap(row => {
    let url;
    try { url = new URL(row.url || row.apply_url); } catch { return []; }
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== origin.hostname || url.username || url.password || !row.title || !row.id) return [];
    const requirements = Array.isArray(row.requirements) ? row.requirements.map(plain).filter(Boolean) : [];
    let published = row.date;
    if (/^\d{10,13}$/.test(String(published))) published = new Date(Number(published) * (String(published).length === 10 ? 1000 : 1)).toISOString();
    return [{ company: feed.company, title: plain(row.title), official_url: url.href,
      location: plain(row.location), country: plain(row.country), job_type: jobType(row.type),
      job_id: String(row.id), jd_text: plain(row.jd), requirements,
      full_description_verified: row.verifiedSections === true && requirements.length > 0 && plain(row.jd).length > 20,
      publish_time: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : '',
      last_seen: new Date(now).toISOString(), companySize: plain(row.size),
      origin_source_url: feed.url, source_revision: HIRING_RADAR_REVISION,
      source_provider: 'hiring-radar', sharedUrl: feed.parser === 'beisen' }];
  });
}

export async function loadHiringRadarFeed(feed, { signal, now = Date.now(), runner = runHiringRadar } = {}) {
  signal?.throwIfAborted();
  const envelope = await runner(feed, { signal });
  signal?.throwIfAborted();
  if (envelope?.complete !== true) throw new Error('hiring_radar_incomplete_collection');
  if (envelope.source !== feed.localKey || envelope.revision !== HIRING_RADAR_REVISION || !Array.isArray(envelope.jobs) || envelope.jobs.length > 10000) throw new Error('invalid_hiring_radar_response');
  const rows = mapHiringRadarRows(envelope.jobs, feed, now);
  if (rows.length !== envelope.jobs.length) throw new Error('invalid_hiring_radar_posting_identity');
  return rows;
}

export function runHiringRadar(feed, { signal } = {}) {
  const root = hiringRadarRoot();
  if (!existsSync(path.join(root, 'radar', 'http.py'))) throw new Error('hiring_radar_not_installed: run npm run jobs:setup-hiring-radar');
  const python = process.env.RESUME_PROTOCOL_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  // Pass only runtime/network environment. Candidate/model credentials never
  // enter this public-data process. No shell, arbitrary scripts or plugins.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|LANG|HTTPS?_PROXY|NO_PROXY)$/i.test(key)));
  Object.assign(env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', path.join(projectRoot, 'scripts', 'hiring-radar-bridge.py'), root, feed.localKey], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env, signal });
    let stdout = '', bytes = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('hiring_radar_timeout')); }, 120000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 20 * 1024 * 1024) { child.kill(); finish(new Error('hiring_radar_response_too_large')); } else stdout += chunk; });
    // Drain without forwarding third-party exception contents or environment.
    child.stderr.resume();
    child.on('error', error => finish(error.name === 'AbortError' ? error : new Error('hiring_radar_runtime_unavailable')));
    child.on('close', code => {
      if (code !== 0) {
        let reason = `exit_${code}`;
        try { const output = JSON.parse(stdout); if (/^[A-Za-z_]{1,80}$/.test(output.error)) reason = output.error; } catch {}
        return finish(new Error(`hiring_radar_collection_failed:${feed.localKey}:${reason}`));
      }
      try { finish(null, JSON.parse(stdout)); } catch { finish(new Error('invalid_hiring_radar_json')); }
    });
  });
}
