import assert from 'node:assert/strict';
import { test } from 'node:test';

await test('typed field choices use only public purpose tokens, never profile values or personal labels', async () => {
  const { decideApplicationFields } = await import('./applicationDecisions.js');
  let called = 0;
  const result = await decideApplicationFields({ fields: [{ id: 'education', label: '张三 110101199001011234 最高教育程度', type: 'text' }], profile: { degree: '本科', name: '张三', identityNumber: '110101199001011234', address: '私密住址' }, decisionClient: async input => {
    called++;
    const raw = JSON.stringify(input);
    for (const secret of ['张三', '110101199001011234', '本科', '私密住址']) assert.ok(!raw.includes(secret));
    assert.equal(input.questions.field_0.type, 'choice');
    assert.deepEqual(Object.keys(input.questions.field_0.criteria), ['degree', 'none']);
    return { model: 'jev-fixture', answers: { field_0: { type: 'choice', choice: 'degree', confidence: .95, probabilities: { degree: .98, none: .02 } } }, usage: { input_tokens: 1, output_tokens: 1 } };
  } });
  assert.equal(called, 1);
  assert.equal(result.mappings.get('education'), 'degree');
  assert.equal(result.realJevCalled, true);
  assert.ok(!JSON.stringify(result.decisions).includes('本科'));
});

await test('field judgment cannot override occupied, sensitive, consent or unknown fields', async () => {
  const { decideApplicationFields } = await import('./applicationDecisions.js');
  let calls = 0;
  const result = await decideApplicationFields({ fields: [{ id: 'occupied', label: '教育程度', type: 'text', occupied: true }, { id: 'sensitive', label: '身份证教育程度', type: 'text' }, { id: 'consent', label: '授权教育程度', type: 'text' }, { id: 'unknown', label: '任意信息', type: 'text' }], profile: { degree: '本科' }, decisionClient: async () => { calls++; throw new Error('must not run'); } });
  assert.equal(calls, 0);
  assert.equal(result.mappings.size, 0);
  assert.equal(result.realJevCalled, false);
});

await test('low confidence, none, unavailable and invalid choices stay manual', async () => {
  const { decideApplicationFields } = await import('./applicationDecisions.js');
  for (const choice of ['none', 'degree', 'identityNumber']) {
    const result = await decideApplicationFields({ fields: [{ id: 'f', label: '教育程度', type: 'text' }], profile: { degree: '本科' }, decisionClient: async () => ({ model: 'jev-fixture', answers: { field_0: { type: 'choice', choice, confidence: .6, probabilities: { degree: .6, none: .4 } } } }) });
    assert.equal(result.mappings.size, 0);
    assert.equal(result.skipped[0].status, 'manual_required');
  }
  const missing = await decideApplicationFields({ fields: [{ id: 'f', label: '教育程度', type: 'text' }], profile: { degree: '本科' }, decisionClient: async () => { throw Object.assign(new Error('secret provider details'), { code: 'missing_api_key' }); } });
  assert.equal(missing.realJevCalled, false);
  assert.equal(missing.providerStatus, 'unavailable');
  assert.ok(!JSON.stringify(missing).includes('secret provider details'));
});
