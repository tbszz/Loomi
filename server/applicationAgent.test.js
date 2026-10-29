import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCareerAgent, isApplicationFillRequest } from './careerAgent.js';

await test('Agent passes bounded fact-linked drafts only with the inspected scan identity', async () => {
  const conversation = { id: 'thread', candidateId: 'candidate', context: {}, messages: [{ role: 'user', content: '请填写当前网申表单' }] };
  const drafts = [{ fieldId: 'degree', value: '本科', factIds: ['edu'] }];
  let captured;
  await runCareerAgent({ conversation, userId: 'owner', emit() {}, persist() {}, applicationService: { fill: async input => { captured = input; return { filled: 1 }; } }, model: { runTools: async ({ execute }) => {
    await assert.rejects(execute('fill_application', { drafts_json: JSON.stringify(drafts) }), /扫描/);
    await execute('fill_application', { scan_id: 'scan', drafts_json: JSON.stringify(drafts) });
    return { content: [{ type: 'text', text: '未提交' }] };
  } } });
  assert.equal(captured.scanId, 'scan');
  assert.deepEqual(captured.drafts, drafts);
});

await test('record expansion is an authorized Agent tool and never available to read-only turns', async () => {
  let added = 0;
  for (const content of ['看看网申表单', '请填写当前网申表单']) {
    const conversation = { id: 't', candidateId: 'c', context: {}, messages: [{ role: 'user', content }] };
    await runCareerAgent({ conversation, userId: 'u', emit() {}, persist() {}, applicationService: { ensureRows: async () => { added++; return { added: 1, pending: 0 }; } }, model: { runTools: async ({ execute, tools }) => {
      assert.equal(tools.some(tool => tool.name === 'ensure_application_rows'), content.startsWith('请'));
      if (content.startsWith('请')) assert.equal((await execute('ensure_application_rows', {})).added, 1);
      else await assert.rejects(execute('ensure_application_rows', {}), /明确/);
      return { content: [{ type: 'text', text: '尚未提交' }] };
    } } });
  }
  assert.equal(added, 1);
});

await test('only explicit present-turn fill commands authorize webpage writes', async () => {
  for (const request of ['帮我填网页长表单', '请填写当前网页空白字段', '继续填写网申表单', '请填写当前网申表单，不要提交，不要覆盖已有内容', '请填写当前网申，不要上传附件']) assert.equal(isApplicationFillRequest(request), true, request);
  for (const request of ['默认只填写空白字段并保留你已经输入的内容', '你可以帮我填表吗', '不要填写网页', '如何填写表单', '看看网申表单', '解释填写网申表单的注意事项', '填写网申表单是什么意思', '我只想了解填写网申的步骤', '请解释填写表单的步骤']) assert.equal(isApplicationFillRequest(request), false, request);
  let writes = 0;
  for (const input of ['查看网申表单', '不要填写网页', '普通职业问题']) {
    const conversation = { id: 'thread', candidateId: 'candidate', context: {}, messages: [{ id: 'user', role: 'user', content: input }] };
    await runCareerAgent({ conversation, userId: 'owner', emit() {}, persist() {}, applicationService: { fill: async () => { writes++; } }, model: { runTools: async ({ tools, execute }) => {
      assert.equal(tools.some(tool => tool.name === 'fill_application'), false);
      await assert.rejects(execute('fill_application', {}), /明确.*填写请求/);
      return { content: [{ type: 'text', text: '尚未填写。' }] };
    } } });
  }
  assert.equal(writes, 0);
});

await test('Agent summaries preserve selected and received attachment counts without treating them as content writes', async () => {
  const conversation = { id: 'thread', candidateId: 'candidate', context: {}, messages: [{role:'user',content:'请填写当前网申表单'}] };
  await runCareerAgent({ conversation, userId:'owner', emit(){}, persist(){}, applicationService:{fill:async()=>({filled:2,preserved:1,pending:1,selectedAttachments:1,uploadedAttachments:1})},model:{runTools:async({execute})=>{
    await execute('fill_application',{});
    return {content:[{type:'text',text:'尚未提交。'}]};
  }}});
  const result = conversation.messages.find(message=>message.kind==='application');
  assert.equal(result.data.filled,2);
  assert.equal(result.data.selectedAttachments,1);
  assert.equal(result.data.uploadedAttachments,1);
  assert.match(result.content,/网站已接收 1 个附件/);
  assert.match(result.content,/1 个附件已选择，待确认网站接收/);
});

await test('explicit fill request uses server-bound service and reports partial results without personal values', async () => {
  const conversation = { id: 'thread', candidateId: 'candidate', context: {}, messages: [{ id: 'user', role: 'user', content: '帮我填网页长表单' }] };
  let writes = 0;
  await runCareerAgent({ conversation, userId: 'owner', emit() {}, persist() {}, applicationService: { fill: async ({ signal }) => { assert.equal(signal?.aborted, undefined); writes++; return { filled: 1, preserved: 2, pending: 3, results: [] }; } }, model: { runTools: async ({ tools, execute, session }) => {
    assert.equal(session.scope.candidateId, 'candidate');
    assert.ok(tools.some(tool => tool.name === 'fill_application'));
    const result = await execute('fill_application', {});
    assert.equal(result.pending, 3);
    return { content: [{ type: 'text', text: '未提交。' }] };
  } } });
  assert.equal(writes, 1);
  const result = conversation.messages.find(message => message.kind === 'application');
  assert.equal(result.data.finalSubmission, 'manual');
  assert.equal(result.data.realJevCalled, false);
  assert.match(result.content, /保留 2.*3 项.*尚未提交/);
});

await test('Jev invocation metadata reflects the bound service and retrieval receives cancellation', async () => {
  const controller = new AbortController();
  const conversation = { id: 'thread', candidateId: 'candidate', context: {}, messages: [{ role: 'user', content: '帮我填网页长表单' }] };
  await runCareerAgent({ conversation, userId: 'owner', signal: controller.signal, emit() {}, persist() {},
    retrieveCandidateKnowledge: async input => {
      assert.equal(input.signal, controller.signal);
      return { query: input.query, facts: [], passages: [], coverage: { note: '无证据' } };
    },
    applicationService: { fill: async () => ({ filled: 1, preserved: 0, pending: 0, realJevCalled: true, decisionRuntime: 'jev-latest', decisionStatus: 'succeeded' }) },
    model: { runTools: async ({ execute }) => {
      await execute('search_candidate_knowledge', { query: '教育' });
      await execute('fill_application', {});
      return { content: [{ type: 'text', text: '尚未提交。' }] };
    } }
  });
  const report = conversation.messages.find(message => message.kind === 'application');
  assert.equal(report.data.realJevCalled, true);
  assert.equal(report.data.decisionRuntime, 'jev-latest');
  assert.equal(report.data.decisionStatus, 'succeeded');
});
