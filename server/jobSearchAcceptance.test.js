import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { evaluateJobEligibility } from './jobEligibility.js';
import { createJobKnowledge } from './jobKnowledge.js';
import { cleanJobRecord } from './jobDataQuality.js';

const now = Date.parse('2026-10-27T12:00:00Z');
const profile = { education: ['某大学 计算机科学 本科 2023-2027'], skills: ['Python'], experience: ['2026.06-2026.08 软件开发实习'], projects: [] };
const job = { source: 'official-career-site', title: '后端开发工程师', company: '测试企业', type: 'campus', location: '北京', fullDescriptionVerified: true, officialListingVerifiedAt: now, description: '负责后端服务系统的开发维护与功能测试。', requirements: ['熟悉Python'] };
const check = (extra, p, dimension) => evaluateJobEligibility({ ...job, ...extra }, p || profile, { now: new Date(now).toISOString() }).checks.find(c => c.dimension === dimension);

test('one cohort repeated in cached description and structured requirements is one cohort', () => {
  const extra = { description: '面向2027届毕业生，负责后端开发。', requirements: ['2027届毕业生', '熟悉Python'] };
  assert.equal(check(extra, profile, 'graduation').status, 'pass');
  assert.equal(check(extra, { ...profile, education: ['某大学 本科 2016-2020'] }, 'graduation').status, 'fail');
  assert.equal(check({ ...extra, requirements: ['2026届或2027届毕业生'] }, profile, 'graduation').status, 'pass');
  assert.equal(check({ ...extra, requirements: ['2026届或2027届毕业生'] }, { ...profile, education: ['某大学 本科 2021-2025'] }, 'graduation').status, 'fail');
});

test('Chinese minimum degree phrasing is enforced while preferred higher degrees stay optional', () => {
  assert.equal(check({ requirements: ['硕士及以上学历，熟悉Python'] }, profile, 'education').status, 'fail');
  assert.equal(check({ requirements: ['本科及以上学历，硕士优先，熟悉Python'] }, profile, 'education').status, 'pass');
  assert.equal(check({ requirements: ['本科或硕士学历，熟悉Python'] }, profile, 'education').status, 'pass');
  assert.equal(check({ requirements: ['学历要求：硕士，熟悉Python'] }, profile, 'education').status, 'fail');
  assert.equal(check({ requirements: ['硕士及以上学历，有项目实习经验或者机器人大赛拿过奖的优秀本科也可以'] }, profile, 'education').status, 'unknown');
});

test('preferred majors and experience do not become mandatory exclusions', () => {
  const switcher = { ...profile, education: ['某大学 市场营销 本科 2016-2020'] };
  assert.equal(check({ requirements: ['本科及以上学历，计算机相关专业优先，熟悉Python'] }, switcher, 'major'), undefined);
  assert.equal(check({ requirements: ['本科及以上学历，3年以上开发经验优先，熟悉Python'] }, switcher, 'experience').status, 'pass');
  assert.equal(check({ requirements: ['计算机相关专业，必须具备3年以上开发经验，熟悉Python'] }, switcher, 'major').status, 'fail');
});

test('project duration is not proof of professional experience', () => {
  const result = check({ requirements: ['要求3年以上开发经验，熟悉Python'] }, { ...profile, experience: [], projects: ['3年Python项目经验'] }, 'experience');
  assert.equal(result.status, 'unknown');
});

test('unrelated employment totals cannot prove domain-specific experience', () => {
  const switcher = { ...profile, experience: ['5年市场运营经验，无软件开发工作经验'] };
  assert.equal(check({ requirements: ['3年以上软件开发经验，熟悉Python'] }, switcher, 'experience').status, 'unknown');
  assert.equal(check({ requirements: ['3年以上测试经验，熟悉Python'] }, switcher, 'experience').status, 'unknown');
  assert.equal(check({ requirements: ['3年以上软件开发经验，熟悉Python'] }, { ...profile, experience: ['5年软件开发经验'] }, 'experience').status, 'pass');
  assert.equal(check({ requirements: ['3年以上后端开发经验，具备测试经验', '熟悉Python'] }, { ...profile, experience: ['5年后端开发经验', '1年测试经验'] }, 'experience').status, 'pass');
  assert.equal(check({ requirements: ['3年以上硬件开发或测试经验'] }, { ...profile, experience: ['5年硬件开发经验'] }, 'experience').status, 'pass');
  assert.equal(check({ requirements: ['3年以上硬件开发或测试经验'] }, { ...profile, experience: ['1年测试经验', '5年硬件开发经验'] }, 'experience').status, 'pass');
  assert.equal(check({ requirements: ['5年以上固件，OS相关开发或测试经验'] }, { ...profile, experience: ['5年市场运营经验'] }, 'experience').status, 'unknown');
});

test('short-form cohorts stay explicit rather than silently passing as no restriction', () => {
  assert.equal(check({ title: '24/25届后端工程师' }, profile, 'graduation').status, 'fail');
  assert.equal(check({ title: '24-26届后端工程师' }, profile, 'graduation').status, 'fail');
  assert.equal(check({ title: '27届后端工程师' }, profile, 'graduation').status, 'pass');
});

test('one-of and minimum-count skill requirements preserve their alternatives', () => {
  assert.equal(check({ requirements: ['熟练掌握 Java、Python 中至少一种语言'] }, profile, 'skills').status, 'pass');
  assert.equal(check({ requirements: ['熟悉Python或Java，熟悉SQL'] }, profile, 'skills').status, 'unknown');
  assert.equal(check({ requirements: ['熟悉Python或Java，熟悉SQL'] }, { ...profile, skills: ['Python', 'SQL'] }, 'skills').status, 'pass');
  assert.equal(check({ requirements: ['熟悉Python、Java中的两种语言'] }, profile, 'skills').status, 'unknown');
  assert.equal(check({ requirements: ['熟悉Python和Java'] }, profile, 'skills').status, 'unknown');
  assert.equal(check({ requirements: ['熟悉Python或Java，同时精通SQL'] }, profile, 'skills').status, 'unknown');
  assert.equal(check({ requirements: ['熟悉Python或Java，SQL必须掌握'] }, profile, 'skills').status, 'unknown');
  assert.equal(check({ requirements: ['熟悉Python及Java或Go'] }, profile, 'skills').status, 'unknown');
  assert.equal(check({ requirements: ['熟悉Python，至少具备两种项目实践经历'] }, profile, 'skills').status, 'pass');
  assert.equal(check({ description: '任职要求\n熟悉Python\n对AI工具有兴趣，愿意学习新技术', requirements: ['熟悉Python', '对AI工具有兴趣，愿意学习新技术'] }, profile, 'skills').status, 'pass');
});

test('structured closure and deadlines use the same day-end semantics as cache visibility', () => {
  assert.equal(check({ deadline: '2026/10/27' }, profile, 'freshness').status, 'pass');
  assert.equal(check({ deadline: '2026/10/26' }, profile, 'freshness').status, 'fail');
  assert.equal(check({ deadline: '2026/10/26（可能延期）' }, profile, 'freshness').status, 'unknown');
  assert.equal(check({ closed: true }, profile, 'freshness').status, 'fail');
});

test('explicit official campus titles take precedence over a generic social portal route', () => {
  const cleaned = cleanJobRecord({ ...job, type: 'social', title: '27届秋招-后端研发工程师', url: 'https://app.mokahr.com/social-recruitment/acme/1/job/123' }, { now });
  assert.equal(cleaned.type, 'campus');
  assert.equal(cleaned.rawType, 'social');
  assert.deepEqual(cleanJobRecord(cleaned, { now }), cleaned);
  assert.equal(cleanJobRecord({ ...job, type: 'social', title: '校园招聘运营专员' }, { now }).type, 'social');
});

test('candidate eligibility and complete individual postings are prioritized before pagination', async () => {
  const db = new DatabaseSync(':memory:');
  const feed = { id: 'test-official', kind: 'official', url: 'https://jobs.example' };
  const make = (id, company, verified, requirements, title = '后端开发工程师') => ({ company, title, official_url: `https://jobs.example/${id}`, job_type: 'campus', jd_text: '岗位职责：负责后端服务开发维护。\n任职要求：' + requirements.join('；'), requirements, full_description_verified: verified, location: '北京', last_seen: new Date(now).toISOString() });
  const rows = [make('summary', 'A公司', false, []), make('wrong', 'B公司', true, ['硕士及以上学历', '熟悉Python']), make('fit1', 'C公司', true, ['本科及以上学历', '熟悉Python']), make('fit2', 'C公司', true, ['本科及以上学历', '熟悉Python']), make('batch', 'D公司', false, [], '后端人才招聘公告')];
  const service = createJobKnowledge(db, { feeds: [feed], clock: () => now, loader: async () => rows });
  await service.sync();
  const first = await service.search({ query: '后端', type: 'campus', region: 'domestic', profile, cacheOnly: true, limit: 2 });
  const next = await service.search({ query: '后端', type: 'campus', region: 'domestic', profile, cacheOnly: true, limit: 2, offset: 2 });
  assert.deepEqual(first.jobs.map(j => j.url.split('/').at(-1)), ['fit1', 'fit2']);
  assert.equal(first.total, rows.length, 'pool total still includes unverified/rejected records');
  assert.equal(first.hasMore, true);
  assert.equal(new Set([...first.jobs, ...next.jobs].map(j => j.id)).size, 4);
  assert.ok(!next.jobs.some(j => j.url.endsWith('/wrong')), 'known mismatch belongs after unknowns');
  const other = await service.search({ query: '后端', type: 'campus', region: 'domestic', profile: { ...profile, education: ['某大学 计算机 硕士 2024-2027'] }, cacheOnly: true, limit: 2 });
  assert.ok(other.jobs.some(j => j.url.endsWith('/wrong')), 'ranking uses each supplied candidate independently');
  assert.ok(db.prepare('SELECT payload FROM job_knowledge_records').all().every(r => !JSON.parse(r.payload).eligibility), 'candidate decisions never enter shared job storage');
  db.close();
});

test('persisted exclusions are applied to ranking before taking a page', async () => {
  const db = new DatabaseSync(':memory:');
  const service = createJobKnowledge(db, { feeds: [{ id: 'one' }], clock: () => now, loader: async () => ['后端销售顾问', '后端工程师'].map((title, i) => ({ company: `公司${i}`, title, official_url: `https://jobs.example/${i}`, job_type: 'campus', jd_text: '负责相关业务的系统工作与协作。', location: '北京', last_seen: new Date(now).toISOString() })) });
  await service.sync();
  const r = await service.search({ query: '后端', profile, exclude: ['销售'], cacheOnly: true, limit: 1 });
  assert.equal(r.jobs[0].title, '后端工程师');
  db.close();
});

test('a direct role-title match ranks ahead of incidental body mentions despite missing candidate evidence', async () => {
  const db = new DatabaseSync(':memory:');
  const service = createJobKnowledge(db, { feeds: [{ id: 'one', kind: 'official', url: 'https://jobs.example' }], clock: () => now, loader: async () => [
    { company: 'A', title: '市场运营顾问', requirements: ['熟悉Python'], jd_text: '与后端团队合作开展营销活动，熟悉Python。' },
    { company: 'B', title: '后端开发工程师', requirements: ['熟悉Python和Java'], jd_text: '负责后端开发工作，任职要求：熟悉Python和Java。' }
  ].map((r, i) => ({ ...r, official_url: `https://jobs.example/${i}`, job_type: 'campus', full_description_verified: true, location: '北京', last_seen: new Date(now).toISOString() })) });
  await service.sync();
  assert.equal((await service.search({ query: '后端', profile, cacheOnly: true, limit: 1 })).jobs[0].title, '后端开发工程师');
  db.close();
});
