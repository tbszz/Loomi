// Local operator acceptance: cache reads only; no model calls or source sync.
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobKnowledge } from '../server/jobKnowledge.js';
import { evaluateJobEligibility } from '../server/jobEligibility.js';
import { createDatabase } from '../server/database.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = process.env.RESUME_PROTOCOL_DATA_DIR || path.join(root, 'data');
const db = new DatabaseSync(path.join(dataDir, 'resume-protocol.sqlite'), { readOnly: true });
const now = Date.now();
const scenarios = [
  { id: 'graduate', label: '应届本科技术岗（合成场景）', query: 'AI|后端|前端', type: 'campus', region: 'domestic', profile: { education: ['普通大学 计算机科学 本科 2023-2027'], skills: ['Python', 'Java', 'SQL', 'Git'], experience: ['2026.06-2026.08 软件开发实习'], projects: ['Python FastAPI 后端项目'] } },
  { id: 'switcher', label: '市场运营转后端（合成场景）', query: '后端', type: 'social', region: 'domestic', profile: { education: ['普通大学 市场营销 本科 2016-2020'], skills: ['Python', 'SQL', 'Git'], experience: ['5年市场运营经验，无软件开发工作经验'], projects: ['半年Python自学项目'] } },
  { id: 'experienced', label: '五年Java后端（合成场景）', query: '后端', type: 'social', region: 'domestic', profile: { education: ['普通大学 计算机科学 本科 2015-2019'], skills: ['Java', 'Spring', 'MySQL', 'Redis', 'Linux', 'Docker', 'Git'], experience: ['5年Java后端开发经验'], projects: ['分布式服务开发'] } }
];
const conversationId = process.argv.find(arg => arg.startsWith('--conversation-id='))?.slice('--conversation-id='.length);
let candidateEvidence = null;
if (conversationId) {
  // The conversation supplies both ownership keys. Use the existing database
  // ownership + provenance checks on a copy; never migrate the live database.
  const binding = db.prepare('SELECT user_id,candidate_id FROM conversations WHERE id=?').get(conversationId);
  if (!binding?.candidate_id) throw new Error('Bound candidate conversation not found.');
  const folder = path.join(root, 'tmp', 'job-search-acceptance');
  mkdirSync(folder, { recursive: true });
  const copyPath = path.join(folder, `candidate-audit-${now}.sqlite`);
  await backup(db, copyPath);
  const store = createDatabase({ filename: copyPath });
  try {
    if (!store.getCandidate(binding.user_id, binding.candidate_id)) throw new Error('Candidate ownership mismatch.');
    const facts = store.listCandidateFacts(binding.user_id, binding.candidate_id);
    const fields = { education: 'education', skill: 'skills', experience: 'experience', project: 'projects' };
    const profile = { education: [], skills: [], experience: [], projects: [] };
    for (const fact of facts) if (fields[fact.type]) profile[fields[fact.type]].push(fact.value);
    for (const key of Object.keys(profile)) profile[key] = [...new Set(profile[key])];
    candidateEvidence = { candidateRef: createHash('sha256').update(binding.user_id + ':' + binding.candidate_id).digest('hex').slice(0, 12), scopedUsableFacts: facts.length, fieldCounts: Object.fromEntries(Object.entries(profile).map(([key, rows]) => [key, rows.length])), ownershipAndProvenanceChecked: true };
    if (facts.length) scenarios.push({ id: 'existing-candidate', label: '已有绑定候选人（匿名、本地证据）', query: 'AI|后端|前端', type: 'campus', region: 'domestic', profile, private: true });
  } finally { store.raw.close(); }
}
const service = createJobKnowledge(db, { clock: () => now });
const reports = [];
try {
  for (const scenario of scenarios) {
    const start = performance.now();
    const result = await service.search({ ...scenario, cacheOnly: true, limit: 20 });
    const rows = result.jobs.map(job => {
      const eligibility = evaluateJobEligibility(job, scenario.profile, { type: scenario.type, region: scenario.region, now: new Date(now).toISOString() });
      return { id: job.id, feedId: job.feedId, company: job.company, title: job.title, location: job.location, url: job.url, type: job.type, recordKind: job.recordKind, fullDescriptionVerified: job.fullDescriptionVerified, requirements: job.requirements, eligibility: scenario.private ? { status: eligibility.status, checks: eligibility.checks.map(check => ({ dimension: check.dimension, status: check.status })) } : eligibility };
    });
    const next = await service.search({ ...scenario, cacheOnly: true, limit: 20, offset: 20 });
    if (rows.some(job => next.jobs.some(other => job.id === other.id))) throw new Error('Pagination repeats jobs: ' + scenario.id);
    const counts = rows.reduce((counts, job) => (counts[job.eligibility.status]++, counts), { passed: 0, verify: 0, rejected: 0 });
    reports.push({ scenario: scenario.id, label: scenario.label, query: scenario.query, type: scenario.type, region: scenario.region, totalPool: result.total, firstPage: { returned: rows.length, counts, completeDescriptions: rows.filter(job => job.fullDescriptionVerified).length, recruitmentBatches: rows.filter(job => job.recordKind === 'recruitment_batch').length, distinctCompanies: new Set(rows.map(job => job.company)).size }, paginationNoDuplicates: true, elapsedMs: Math.round(performance.now() - start), rows });
  }
  const baselinePath = path.join(root, 'tmp', 'job-search-acceptance', 'before.json');
  const before = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
  const report = { at: new Date(now).toISOString(), mode: 'read_only_cache', candidateEvidence, comparison: reports.map(after => {
    const prior = before?.reports.find(row => row.scenario === after.scenario);
    return { scenario: after.scenario, before: prior ? { totalPool: prior.total, counts: prior.counts, completeDescriptions: prior.rows.filter(row => row.verified).length } : null, after: after.firstPage };
  }), reports, limits: ['合成场景验证检索和规则行为，不代表真实用户整体匹配率。', 'passed仅表示当前实现的资格检查通过，不证明所有自然语言门槛已被识别。', '缓存结果不是逐条实时开放状态核验；缺失地区、完整要求或候选人证据时仍待核实。', '运营经验不自动等同于开发经验；职业相关性需要结合具体履历核实。'] };
  const folder = path.join(dataDir, 'job-audits');
  mkdirSync(folder, { recursive: true });
  const reportPath = path.join(folder, 'job-search-acceptance.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, candidateEvidence, comparison: report.comparison }, null, 2));
} finally { db.close(); }
