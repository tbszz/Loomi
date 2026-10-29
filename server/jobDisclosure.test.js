import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { CAREER_TOOLS, runCareerAgent } from './careerAgent.js';
import { createJobKnowledge } from './jobKnowledge.js';
import { createClaudeAgentModel } from './claudeAgent.js';
import * as installedSdk from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const conversation = (context = {}, content = '国内后端校招岗位') => ({
  id: 'disclosure', messages: [{ id: 'u1', role: 'user', content }], context
});
const baseJob = {
  title: '后端开发工程师', company: '测试企业', location: '北京', type: 'campus',
  source: 'official-career-site', url: 'https://jobs.example/backend',
  fullDescriptionVerified: true, officialListingVerifiedAt: Date.now(),
  description: '参与后端功能开发与测试。', requirements: ['熟悉Python'],
  retrievalMatch: 'title', largeCompany: false
};
const readError = '这些岗位不在本对话最近的搜索结果中，请先搜索或使用列表里的 id。';
const disclosureNote = '列表只含摘要；需要岗位职责、任职要求、逐项资格核验或来源时调用 get_job_details，不要凭摘要编造细节。';

test('pure card/source helpers use allowlists and keep failures distinct from idle sources', async () => {
  const { compactJobCard, compactRejectedJob, compactSources } = await import('./jobDisclosure.js');
  const job = { ...baseJob, id: 'one', deadline: '2027-01-01', provenance: ['private'], eligibility: {
    status: 'verify', reason: '待核实\n'.repeat(50), checks: [{ status: 'unknown', message: '未知\n条件' }]
  } };
  const before = structuredClone(job);
  const card = compactJobCard(job);
  assert.deepEqual(Object.keys(card).sort(), ['id', 'title', 'company', 'location', 'type', 'deadline', 'largeCompany', 'retrievalMatch', 'fullDescriptionVerified', 'eligibility'].sort());
  assert.deepEqual(Object.keys(card.eligibility).sort(), ['reason', 'status']);
  assert.equal(card.eligibility.reason.length, 120);
  assert.ok(!card.eligibility.reason.includes('\n'));
  assert.equal(compactJobCard({ eligibility: { checks: [{ status: 'unknown', message: '未知\n条件' }] } }).eligibility.reason, '未知 条件');
  assert.deepEqual(compactRejectedJob({ ...job, eligibility: { reason: 'fallback', checks: [{ status: 'pass', message: '通过' }, { status: 'fail', message: '硬性\n不符' }] } }), { id: 'one', title: job.title, company: job.company, reason: '硬性 不符' });
  assert.deepEqual(job, before);
  assert.deepEqual(compactSources(), { total: 0, ok: 0, failed: 0, failedSample: [] });
  const sources = [{ id: 'idle', syncStatus: 'idle' }, { id: 'unadapted', syncStatus: 'unadapted' }, { id: 'cached', fetchedAt: 'yesterday', error: 'today failed' }, { name: 'failed-name', ok: false }, { id: 'failed-status', syncStatus: 'failed' }, { id: 'ok', ok: true }, { id: 'reachable', syncStatus: 'reachable' }];
  const snapshot = structuredClone(sources);
  const summary = compactSources(sources);
  assert.equal(summary.total, 7);
  assert.equal(summary.ok, 2);
  assert.equal(summary.failed, 3);
  assert.deepEqual(summary.failedSample.map(s => s.id || s.name), ['cached', 'failed-name', 'failed-status']);
  assert.ok(summary.failedSample.every(s => s.error));
  assert.deepEqual(sources, snapshot);
});

test('20-job model tool_result is compact while context and jobs UI retain full records', async t => {
  const jobs = Array.from({ length: 20 }, (_, i) => ({
    ...baseJob, id: `job-${i}`, description: baseJob.description.repeat(250),
    provenance: [{ sourceId: 'official', quote: '官方岗位原文'.repeat(60) }],
    jdEvidence: { quote: '任职要求原文'.repeat(40) },
    ...(i === 0 ? { requirements: ['博士学历'] } : {}),
    ...(i === 1 ? { retrievalMatch: 'description' } : {})
  }));
  const sources = Array.from({ length: 100 }, (_, i) => ({
    id: `source-${i}`, syncStatus: i < 4 ? 'failed' : 'synced',
    error: i < 4 ? '读取失败\n'.repeat(50) : null,
    fetchedAt: new Date().toISOString(), reason: '逐来源元数据'.repeat(120)
  }));
  const summary = { synced: 96, failed: 4, unadapted: 0 };
  const c = conversation({ profile: { education: ['某大学 计算机 本科'], skills: ['Python'] } });
  let calls = 0, encoded, payload;
  await runCareerAgent({ conversation: c, emit: () => {}, persist: () => {},
    search: async () => ({ jobs, sources, summary, total: 43, offset: 0, hasMore: true }),
    model: async ({ messages }) => {
      if (++calls === 1) return { content: [{ type: 'tool_use', id: 'search', name: 'search_jobs', input: { query: '后端' } }] };
      const result = messages.at(-1).content[0];
      assert.equal(result.type, 'tool_result');
      assert.ok(!result.is_error);
      encoded = result.content;
      payload = JSON.parse(encoded);
      return { content: [{ type: 'text', text: '已列出岗位。' }] };
    }
  });
  const data = c.messages.find(m => m.kind === 'jobs').data;
  const previous = JSON.stringify({ jobs: data.jobs, uncertainties: data.uncertainties,
    related: data.related, rejected: data.rejected, sources: data.sources, coverage: data.coverage,
    total: data.total, hasMore: data.hasMore, offset: data.offset, nextOffset: data.nextOffset,
    note: payload.note.replace(disclosureNote, '') });
  t.diagnostic(`tool_result chars: before=${previous.length}, after=${encoded.length}, ratio=${(encoded.length / previous.length * 100).toFixed(2)}%`);
  assert.ok(encoded.length < previous.length * 0.2);
  for (const key of ['description', 'requirements', 'checks', 'provenance', 'jdEvidence', 'url']) {
    assert.ok(!new RegExp(`"${key}"\\s*:`).test(encoded), `model must not receive ${key}`);
  }
  assert.deepEqual(c.context.jobs, data.jobs);
  assert.deepEqual(c.context.jobSources, sources);
  assert.deepEqual(c.context.jobEligibility, { uncertainties: data.uncertainties, related: data.related, rejected: data.rejected, openQuestions: payload.openQuestions });
  for (const group of ['jobs', 'related', 'rejected']) {
    assert.deepEqual(payload[group].map(j => j.id), data[group].map(j => j.id));
    assert.ok(data[group].every(j => j.description && j.provenance && j.eligibility.checks.length));
  }
  assert.deepEqual(payload.coverage, summary);
  for (const key of ['total', 'hasMore', 'offset', 'nextOffset']) assert.equal(payload[key], data[key]);
  assert.deepEqual(c.context.jobPagination, { total: 43, hasMore: true, offset: 0, limit: 20, nextOffset: 20 });
  assert.ok(payload.openQuestions.length <= 2);
  assert.match(payload.note, /聚合数据可能过期/);
  assert.ok(payload.note.endsWith(disclosureNote));
  assert.equal(payload.sources.total, 100);
  assert.equal(payload.sources.ok, 96);
  assert.equal(payload.sources.failed, 4);
  assert.equal(payload.sources.failedSample.length, 3);
  assert.ok(payload.sources.failedSample.every(s => s.id && s.error.length <= 80 && !s.error.includes('\n')));
  assert.equal(payload.rejected[0].reason, data.rejected[0].eligibility.checks.find(check => check.status === 'fail').message.slice(0, 120));
});

test('get_job_details reads all current-context groups, bounds details, and preserves the grounded answer', async () => {
  const eligibility = { status: 'verify', reason: '资格待核实', checks: [{ dimension: 'skills', status: 'unknown', message: '请核实Python', question: '是否使用过Python？', evidence: 'internal evidence' }] };
  const listed = { ...baseJob, id: 'listed', eligibility };
  const long = { ...listed, id: 'related', description: '长'.repeat(4001), requirements: Array.from({ length: 31 }, (_, i) => `要求${i}`) };
  const context = { jobs: [listed], jobEligibility: { related: [long], rejected: [{ ...listed, id: 'rejected' }], uncertainties: [{ ...listed, id: 'uncertain' }] } };
  const snapshot = structuredClone(context);
  const c = conversation(context, '读这些岗位的完整职责和资格核验');
  const events = [];
  await runCareerAgent({ conversation: c, emit: (type, data) => events.push({ type, data }), persist: () => {},
    search: () => assert.fail('detail reads must not search'), enrichJob: () => assert.fail('detail reads must not fetch'),
    model: { runTools: async ({ execute, tools }) => {
      const definition = tools.find(tool => tool.name === 'get_job_details');
      assert.deepEqual(definition.input_schema.properties.job_ids, { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 });
      assert.deepEqual(definition.input_schema.required, ['job_ids']);
      const count = c.messages.length;
      const result = await execute('get_job_details', { job_ids: ['listed', 'related', 'rejected', 'uncertain', 'unknown'] });
      assert.equal(c.messages.length, count, 'read tool must not append a message');
      assert.deepEqual(result.missing, ['unknown']);
      assert.deepEqual(result.jobs.map(j => j.id), ['listed', 'related', 'rejected', 'uncertain']);
      assert.equal(result.jobs[0].description, listed.description);
      assert.equal(result.jobs[0].url, listed.url);
      assert.equal(result.jobs[0].source, listed.source);
      assert.equal(result.jobs[0].fullDescriptionVerified, true);
      assert.ok(!Object.hasOwn(result.jobs[0], 'descriptionTruncated'));
      assert.deepEqual(result.jobs[0].eligibility.checks, [{ dimension: 'skills', status: 'unknown', message: '请核实Python', question: '是否使用过Python？' }]);
      assert.equal(result.jobs[1].description.length, 4000);
      assert.equal(result.jobs[1].descriptionTruncated, true);
      assert.equal(result.jobs[1].requirements.length, 30);
      await assert.rejects(execute('get_job_details', { job_ids: ['unknown'] }), { message: readError });
      return { content: [{ type: 'text', text: '该岗位职责是参与后端功能开发与测试，Python条件待核实。' }] };
    } }
  });
  assert.equal(c.messages.at(-1).content, '该岗位职责是参与后端功能开发与测试，Python条件待核实。');
  assert.ok(events.some(e => e.type === 'status' && e.data.label === '正在读取岗位详情'));
  assert.deepEqual(context.jobs, snapshot.jobs);
  assert.deepEqual(context.jobEligibility, snapshot.jobEligibility);
});

test('get_job_details reports all-unknown ids as a failed model tool_result', async () => {
  const c = conversation({}, '读取这个岗位详情');
  let calls = 0;
  await runCareerAgent({ conversation: c, emit: () => {}, persist: () => {}, model: async ({ messages }) => {
    if (++calls === 1) return { content: [{ type: 'tool_use', id: 'read', name: 'get_job_details', input: { job_ids: ['unknown'] } }] };
    const result = messages.at(-1).content[0];
    assert.equal(result.is_error, true);
    assert.deepEqual(JSON.parse(result.content), { error: readError });
    return { content: [{ type: 'text', text: '未能读取。' }] };
  } });
  assert.match(c.messages.at(-1).content, /这一步没有完成/);
});

test('get_job_details cannot read a job present only in the job DB or another conversation', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const service = createJobKnowledge(db, { feeds: [{ id: 'official', kind: 'official', url: 'https://jobs.example' }], loader: async () => [{ company: '测试企业', title: '后端开发工程师', official_url: baseJob.url, job_type: 'campus', location: '北京', jd_text: baseJob.description, last_seen: new Date().toISOString() }] });
    await service.sync();
    const { jobs } = await service.search({ cacheOnly: true });
    assert.equal(jobs.length, 1, 'fixture must exist in the DB');
    const other = conversation({ jobs });
    const c = conversation({ jobs: [] }, '读取岗位职责');
    await runCareerAgent({ conversation: c, emit: () => {}, persist: () => {}, search: () => assert.fail('must not query DB for arbitrary ids'),
      model: { runTools: async ({ execute }) => {
        await assert.rejects(execute('get_job_details', { job_ids: [other.context.jobs[0].id] }), { message: readError });
        return { content: [{ type: 'text', text: '该岗位不在本对话中。' }] };
      } }
    });
  } finally { db.close(); }
});

test('get_job_details validates a required batch of one to five string ids', async () => {
  assert.ok(CAREER_TOOLS.some(tool => tool.name === 'get_job_details'));
  const c = conversation({ jobs: [{ ...baseJob, id: 'listed' }] }, '读取岗位职责');
  await runCareerAgent({ conversation: c, emit: () => {}, persist: () => {}, model: { runTools: async ({ execute }) => {
    for (const input of [{}, { job_ids: [] }, { job_ids: ['listed', 7] }, { job_ids: Array(6).fill('listed') }, { job_ids: 'listed' }]) {
      await assert.rejects(execute('get_job_details', input), /job_ids/);
    }
    return { content: [{ type: 'text', text: '参数无效。' }] };
  } } });
});

test('installed MCP enforces get_job_details batch bounds before execution', async () => {
  const calls = [];
  let schemaError;
  const model = createClaudeAgentModel({ apiKey: 'test-key', model: 'test-model', timeoutMs: 1000 }, {
    sdk: { ...installedSdk, query: ({ options }) => (async function* () {
      const server = options.mcpServers.career.instance;
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'job-disclosure-schema', version: '1' });
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        for (const input of [{}, { job_ids: [] }, { job_ids: [7] }, { job_ids: Array(6).fill('listed') }]) {
          assert.equal((await client.callTool({ name: 'get_job_details', arguments: input })).isError, true);
          assert.equal(calls.length, 0, 'invalid schema must not reach execution');
        }
        const args = { job_ids: ['listed'] };
        assert.equal((await client.callTool({ name: 'get_job_details', arguments: args })).isError, undefined);
        assert.deepEqual(calls, [args]);
      } catch (error) { schemaError = error; }
      finally { await client.close(); await server.close(); }
      yield { type: 'result', subtype: 'success', result: '已读取详情' };
    })() }
  });
  await model.runTools({ messages: [], tools: [CAREER_TOOLS.find(tool => tool.name === 'get_job_details')], execute: async (_name, args) => {
    calls.push(args);
    return { jobs: [], missing: [] };
  } });
  if (schemaError) throw schemaError;
});
