import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadNcssJobFeed, toRow, NCSS_JOB_FEEDS } from './ncssJobFeed.js';
import { loadJobDetail } from './jobDetailFetchers.js';
import { createJobKnowledge } from './jobKnowledge.js';

const at = Date.parse('2026-10-26T00:00:00Z');
const item = (id, over = {}) => ({ jobId: id, jobName: '前端开发工程师', recName: '厦门正航软件科技有限公司', areaCodeName: '福建', degreeName: '本科及以上', major: '计算机科学与技术,★软件工程,软件工程', recScale: '100-499人', recProperty: '民营企业', sourcesNameCh: '北京邮电大学', headCount: 3, lowMonthPay: 8, highMonthPay: 12, publishDate: at - 86400000, updateDate: at - 3600000, ...over });
const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body) });
const page = list => json({ flag: true, data: { list, pagenation: { count: 200, total: 10, limit: 20, offset: 1 } } });

// Paging stops at the login wall and at a short page; ids are deduped across queries.
{
  const seen = [];
  const fetchImpl = async (url) => {
    const params = new URL(url).searchParams;
    seen.push(`${params.get('jobName')}|${params.get('jobType')}|${params.get('offset')}`);
    if (params.get('jobName') === '前端' && params.get('jobType') === '01') {
      const offset = Number(params.get('offset'));
      if (offset >= 3) return json({ flag: false, global: [{ des: '请登录后查看' }], data: null });
      return page(Array.from({ length: 20 }, (_, index) => item(`P${offset}x${index}`)));
    }
    return page([item('P1x0'), item('Intern1', { jobName: 'Java实习生', recScale: '5000以上' })]);
  };
  const rows = await loadNcssJobFeed(NCSS_JOB_FEEDS[0], { fetchImpl, keywords: ['前端', '后端'], delayMs: 0 });
  assert.deepEqual(seen, ['前端|01|1', '前端|01|2', '前端|01|3', '前端|03|1', '后端|01|1', '后端|03|1']);
  assert.equal(rows.length, 41);
  const intern = rows.find(row => row.job_id === 'Intern1');
  assert.equal(intern.job_type, '实习');
  assert.equal(intern.url, 'https://www.ncss.cn/student/jobs/Intern1/detail.html');
}

// The summary carries list fields; ids that could escape the URL path are dropped.
{
  const row = toRow(item('Abc123'), '校招');
  assert.match(row.jd_text, /学历要求：本科及以上/);
  assert.match(row.jd_text, /专业：计算机科学与技术、软件工程$/m);
  assert.match(row.jd_text, /公司规模：100-499人（平台标注）/);
  assert.equal(row.last_seen, new Date(at - 3600000).toISOString());
  assert.equal(toRow(item('../x'), '校招'), null);
}

// Every request failing is a failure, never an empty success.
await assert.rejects(loadNcssJobFeed(NCSS_JOB_FEEDS[0], { fetchImpl: async () => json({}, false), keywords: ['前端'], delayMs: 0 }), /ncss_unavailable/);

// Detail text is platform text: readable, never a verified official JD.
{
  const html = '<div class="details"><div class="jobdetail-box"><div class="mainContent mainContent-geshi">岗位职责：负责前端页面开发<br>任职要求：<br>1. 熟悉 Vue3 或 React</div></div></div>';
  const detail = await loadJobDetail({ url: 'https://www.ncss.cn/student/jobs/Abc123/detail.html' }, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => html }) });
  assert.equal(detail.verified, false);
  assert.equal(detail.aggregator, true);
  assert.match(detail.description, /熟悉 Vue3 或 React/);
  assert.equal(await loadJobDetail({ url: 'https://www.ncss.cn/student/jobs/index.html' }), null);
}

// Through the knowledge base: platform headcount marks large companies, and
// selecting a job reports platform text as "aggregator", not verified.
{
  const db = new DatabaseSync(':memory:');
  const service = createJobKnowledge(db, { clock: () => at, feeds: NCSS_JOB_FEEDS,
    loader: async () => [toRow(item('Small1'), '校招'), toRow(item('Big1', { recName: '某集团', recScale: '10000人以上' }), '校招')],
    detailLoader: async () => ({ description: '任职要求：熟悉 React', requirements: ['熟悉 React'], url: '', provider: 'ncss', verified: false, aggregator: true }) });
  const small = await service.search({ companyScale: 'small_mid' });
  assert.deepEqual(small.jobs.map(job => job.title), ['前端开发工程师']);
  assert.equal(small.jobs[0].companySize, '100-499人');
  assert.equal((await service.search({ companyScale: 'large' })).jobs[0].company, '某集团');
  const enriched = await service.enrich(small.jobs[0]);
  assert.equal(enriched.status, 'aggregator');
  assert.equal(enriched.job.fullDescriptionVerified, false);
  db.close();
}
console.log('ncssJobFeed tests passed');
