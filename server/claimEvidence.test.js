import assert from 'node:assert/strict';
import { test } from 'node:test';

await test('separate skill tokens keep word boundaries without accepting Java from JavaScript', async () => {
  const { buildClaimEvidence } = await import('./claimEvidence.js');
  const facts = [{ factId: 'skills', type: 'skill', value: 'React TypeScript JavaScript', sourceQuote: 'React TypeScript JavaScript', status: 'verified' }];
  assert.doesNotThrow(() => buildClaimEvidence({ skills: ['React', 'TypeScript'] }, { facts }));
  assert.throws(() => buildClaimEvidence({ skills: ['Java'] }, { facts }), /证据/);
});

await test('claims cover identity, contact, summary and every rendered factual section', async () => {
  const {buildClaimEvidence,verifyClaimEvidence} = await import('./claimEvidence.js');
  const content = {name:'张三',contact:{email:'zhang@example.com'},summary:'使用 React 构建页面；实现搜索功能',education:['某大学本科'],skills:['React'],projects:['实现搜索功能，使用 React 开发页面'],experience:[],awards:[]};
  const facts = [ ['identity','张三'],['contact','zhang@example.com'],['project','参与项目，使用 React 开发页面，实现搜索功能'],['education','某大学本科'],['skill','React'] ].map(([type,value],index)=>({factId:`f${index}`,type,value,sourceQuote:value,status:'user_asserted'}));
  const claims=buildClaimEvidence(content,{facts});
  assert.ok(claims.some(c=>c.field==='name'));
  assert.ok(claims.some(c=>c.field==='contact.email'));
  assert.ok(claims.some(c=>c.field==='summary'));
  assert.ok(claims.every(c=>c.factIds.length));
  assert.doesNotThrow(()=>verifyClaimEvidence(content,claims,facts));
  assert.throws(()=>verifyClaimEvidence({...content,summary:'独立负责架构'},claims,facts),/证据|claim|事实/);
});

await test('a project title and sourced description can be joined with a colon', async () => {
  const { buildClaimEvidence } = await import('./claimEvidence.js');
  const facts = ['校园商品平台', '使用 React 开发搜索页面'].map((sourceQuote, index) => ({ factId: `p${index}`, type: 'project', sourceQuote, status: 'verified' }));
  assert.deepEqual(buildClaimEvidence({ projects: ['校园商品平台：使用 React 开发搜索页面'] }, { facts })[0].factIds.sort(), ['p0','p1']);
});

await test('similar text does not prove inflated responsibility, swapped metrics, negation or new technology', async () => {
  const {buildClaimEvidence} = await import('./claimEvidence.js');
  const facts=[{factId:'p',type:'project',value:'参与项目使用 React 开发页面，团队有20人，性能提升30%。',sourceQuote:'参与项目使用 React 开发页面，团队有20人，性能提升30%。',status:'user_asserted'}];
  for(const text of ['独立负责项目使用 React 开发页面','参与项目使用 React 和 Docker 开发页面','性能提升20%','熟练掌握 React','未参与项目使用 React 开发页面']) {
    assert.throws(()=>buildClaimEvidence({projects:[text]}, {facts}),/证据|事实/,text);
  }
});

await test('missing, disabled, foreign and uncovered evidence fails verification', async () => {
  const {buildClaimEvidence,verifyClaimEvidence} = await import('./claimEvidence.js');
  const fact={factId:'f',type:'skill',value:'React',sourceQuote:'React',status:'user_asserted'};
  const content={skills:['React']};
  const claims=buildClaimEvidence(content,{facts:[fact]});
  assert.throws(()=>verifyClaimEvidence(content,[{...claims[0],factIds:[]}],[fact]),/证据|事实/);
  assert.throws(()=>verifyClaimEvidence(content,[{...claims[0],factIds:['foreign']}],[fact]),/证据|事实/);
  assert.throws(()=>verifyClaimEvidence(content,claims,[{...fact,status:'disabled'}]),/证据|事实/);
  assert.throws(()=>verifyClaimEvidence(content,[],[fact]),/证据|事实/);
});
