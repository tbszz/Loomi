import assert from 'node:assert/strict';
import { loadJobDetail, fromHtml } from './jobDetailFetchers.js';

const json = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });
const calls = [];
const fetchImpl = async (url) => {
  calls.push(String(url));
  if (url.includes('/missing/')) return { ok: false, status: 404, text: async () => '' };
  if (url.includes('boards-api.greenhouse.io')) return json({ content: '&lt;h3&gt;About the role&lt;/h3&gt;&lt;p&gt;Build ML tooling for our platform team.&lt;/p&gt;&lt;h3&gt;Qualifications&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;Pursuing a CS degree&lt;/li&gt;&lt;/ul&gt;&lt;h3&gt;Benefits&lt;/h3&gt;&lt;p&gt;Free lunch&lt;/p&gt;' });
  if (url.includes('/wday/cxs/')) return json({ jobPostingInfo: { jobDescription: '<p>Responsibilities:</p><ul><li>Write firmware for test rigs</li></ul><p>Basic Qualifications:</p><ul><li>C++ experience</li></ul>' } });
  return { ok: false, status: 404, text: async () => '' };
};

const greenhouse = await loadJobDetail({ url: 'https://job-boards.greenhouse.io/acme/jobs/123' }, { fetchImpl });
assert.ok(calls.at(-1).endsWith('/v1/boards/acme/jobs/123'));
assert.deepEqual(greenhouse.requirements, ['Python', 'Pursuing a CS degree']);
assert.equal(greenhouse.verified, true);
assert.doesNotMatch(greenhouse.requirements.join(' '), /lunch/);

const workday = await loadJobDetail({ url: 'https://kla.wd1.myworkdayjobs.com/en-US/Search/job/Ann-Arbor-MI/Intern_R1' }, { fetchImpl });
assert.ok(calls.at(-1).endsWith('/wday/cxs/kla/Search/job/Ann-Arbor-MI/Intern_R1'));
assert.deepEqual(workday.requirements, ['C++ experience']);

assert.equal(await loadJobDetail({ url: 'https://mp.weixin.qq.com/s/abc' }, { fetchImpl }), null);
await assert.rejects(loadJobDetail({ url: 'https://job-boards.greenhouse.io/missing/jobs/9' }, { fetchImpl }), /detail_http_404/);
assert.equal(fromHtml('<p>We build things. Join us today and grow.</p>', '', 'x').verified, false, 'no requirements heading means unverified');
console.log('jobDetailFetchers tests passed');

{
  // GitLab-style headings: "What you will bring", then a salary block.
  const parsed = fromHtml("<h3>What you will do</h3><ul><li>Build CI features</li></ul><h3>What you will bring</h3><ul><li>Experience with Go</li><li>Strong communication</li></ul><h3>United States Salary Range</h3><p>$203,200 &mdash; $345,600 USD</p>", "https://job-boards.greenhouse.io/gitlab/jobs/1", "greenhouse");
  assert.deepEqual(parsed.requirements, ["Experience with Go", "Strong communication"]);
  assert.equal(parsed.verified, true);
  assert.match(parsed.description, /\$203,200 - \$345,600/);
}

{
  const parsed = fromHtml("<p>Primary Responsibilities</p><ul><li>Advise on compliance</li></ul><p>Skills and Requirements</p><ul><li>Fluent in English and Chinese</li></ul>", "", "workday");
  assert.deepEqual(parsed.requirements, ["Fluent in English and Chinese"]);
  assert.deepEqual(fromHtml("<p>Your Skills and Expertise</p><ul><li>Strong negotiation skills</li></ul>", "", "workday").requirements, ["Strong negotiation skills"]);
}
