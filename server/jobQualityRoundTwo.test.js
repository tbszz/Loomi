import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { cleanJobRecord, deduplicateJobs } from './jobDataQuality.js';
import { createJobKnowledge } from './jobKnowledge.js';
import { fromHtml } from './jobDetailFetchers.js';
import { evaluateJobEligibility } from './jobEligibility.js';

const now=Date.parse('2026-10-27T12:00:00Z');
const base={id:'one',feedId:'source',company:'Acme',title:'后端工程师',location:'北京',type:'social',source:'official-career-site',url:'https://acme.jobs.feishu.cn/index/position/123/detail',sourceJobId:'123',observedAt:now,officialListingVerifiedAt:now,description:'公开职位描述'};

test('notices remain leads and activities are quarantined without filtering genuine HR positions',()=>{
  for(const title of ['人民交通出版社2027年度招聘启事','前海研究院博士后/助理研究员招聘启事','广西2027年选调生招录公告']) assert.equal(cleanJobRecord({...base,title},{now}).recordKind,'recruitment_batch',title);
  for(const title of ['扬州市重点企业赴上海交通大学专场招聘活动','公务员招录宣讲']) assert.equal(cleanJobRecord({...base,title},{now}).quarantineReason,'recruitment_event',title);
  for(const title of ['校园招聘实习生','校园招聘专员','招聘会运营专员']) assert.equal(cleanJobRecord({...base,title},{now}).recordKind,'posting',title);
});

test('explicit past deadlines and closed flags expire while invalid dates and old live listings remain visible',()=>{
  assert.equal(cleanJobRecord({...base,deadline:'2026/10/26'},{now}).expiryReason,'deadline_passed');
  assert.equal(cleanJobRecord({...base,deadline:'2026年10月27日'},{now}).expiryReason,null);
  assert.equal(cleanJobRecord({...base,deadline:'2026/02/30'},{now}).expiryReason,null);
  assert.equal(cleanJobRecord({...base,closed:true},{now}).expiryReason,'source_closed');
  const old=cleanJobRecord({...base,publishedAt:'2023-06-30'},{now});
  assert.equal(old.expiryReason,null);
  assert.ok(old.freshnessWarnings.includes('old_publication_date'));
});

test('an old aggregated recruitment notice is isolated without excluding an explicitly multi-cohort current batch',()=>{
  const historical=cleanJobRecord({...base,source:'domestic-feed',officialListingVerifiedAt:null,title:'辽宁省2024年度选调应届毕业生工作公告',publishedAt:'2024-03-18'},{now});
  assert.equal(historical.quarantineReason,'historical_recruitment_notice');
  const current=cleanJobRecord({...base,title:'秋招·2027届/2026届/2025届'},{now});
  assert.equal(current.quarantineReason,null);
});

test('canonical ATS posting IDs merge alternate portal URLs but preserve tenant and requisition boundaries',()=>{
  const alternate={...base,id:'two',feedId:'other',url:'https://acme.jobs.feishu.cn/career/position/123?lang=zh-CN'};
  const merged=deduplicateJobs([base,alternate],{now});
  assert.equal(merged.length,1);
  assert.equal(merged[0].provenance.length,2);
  assert.equal(deduplicateJobs([base,{...alternate,url:'https://other.jobs.feishu.cn/career/position/123'}],{now}).length,2);
  assert.equal(deduplicateJobs([base,{...alternate,sourceJobId:'456',url:'https://acme.jobs.feishu.cn/index/position/456/detail'}],{now}).length,2);
});

test('Chinese wrapped and inline headings produce distinct responsibilities and requirements',()=>{
  const parsed=fromHtml('【岗位职责】\n负责后端系统开发、维护与性能优化。\n【任职条件】\n熟悉 Python 与数据库。\n薪资福利\n免费午餐。','https://example.com','cache');
  assert.equal(parsed.sectionEvidenceComplete,true);
  assert.deepEqual(parsed.requirements,['熟悉 Python 与数据库。']);
  assert.deepEqual(parsed.responsibilities,['负责后端系统开发、维护与性能优化。']);
  assert.equal(fromHtml('岗位职责：负责后端系统开发、维护与性能优化。\n岗位要求：熟悉 Python 与数据库。','','cache').sectionEvidenceComplete,true);
  assert.equal(fromHtml('职位描述很长，但未提供任何明确的任职要求。','','cache').sectionEvidenceComplete,false);
});

test('multiple alternative role sections do not automatically become one verified hard-requirement list',()=>{
  const text='方向1\n岗位职责\n负责后端开发与维护\n任职要求\n熟悉 Python\n方向2\n岗位职责\n负责前端页面开发\n任职要求\n熟悉 React';
  assert.equal(fromHtml(text,'','cache').sectionEvidenceComplete,false);
});

test('requirement sentences are not mistaken for headings and discarded',()=>{
  const parsed=fromHtml('Responsibilities\nBuild backend systems.\nRequirements\nYou should have experience with Python and SQL.\nStrong communication skills.','','cache');
  assert.deepEqual(parsed.requirements,['You should have experience with Python and SQL.','Strong communication skills.']);
});

test('company culture and unknown bracketed sections cannot leak into extracted hard requirements',()=>{
  const parsed=fromHtml('岗位职责\n负责界面动效设计与制作。\n任职要求\n1. 熟悉动画制作流程。\n2. 有相关项目经验。\n我们秉承开放、共享的文化理念\n【态度】\n积极热情。\n【生活】\n免费午餐和公寓。','','cache');
  assert.deepEqual(parsed.requirements,['1. 熟悉动画制作流程。','2. 有相关项目经验。']);
  assert.equal(parsed.sectionEvidenceComplete,true);
  const unknown=fromHtml('岗位职责\n负责后端系统开发与维护。\n任职要求\n熟悉 Python。\n【团队文化】\n免费午餐。','','cache');
  assert.deepEqual(unknown.requirements,['熟悉 Python。']);
});

test('recruitment year matching covers Chinese text and ambiguous notice dates never trigger expiry',()=>{
  const notice=cleanJobRecord({...base,source:'domestic-feed',officialListingVerifiedAt:null,title:'辽宁省2024年度选调应届毕业生工作公告',publishedAt:'2024-03-18'},{now});
  assert.equal(notice.quarantineReason,'historical_recruitment_notice');
  assert.equal(cleanJobRecord({...base,deadline:'2026/01/01至2026/12/31'},{now}).expiryReason,null);
  assert.equal(cleanJobRecord({...base,deadline:'2026/10/26(可能延期)'},{now}).expiryReason,null);
});

test('cleanup extracts cached sections only from a declared official origin and preserves other tables',async()=>{
  const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE candidate_facts(value TEXT); INSERT INTO candidate_facts VALUES ('unchanged')");
  const description='岗位职责：\n负责后端系统开发、维护与性能优化。\n任职要求：\n熟悉 Python 与数据库。';
  const official={id:'official',kind:'official',url:'https://acme.jobs.feishu.cn/index',company:'Acme'};
  const aggregator={id:'aggregator',url:'https://feed.example/jobs.json'};
  const row={company:'Acme',title:'后端工程师',location:'北京',job_type:'social',job_id:'123',url:'https://acme.jobs.feishu.cn/index/position/123/detail',jd_text:description,last_seen:new Date(now).toISOString()};
  const service=createJobKnowledge(db,{clock:()=>now,feeds:[official,aggregator],loader:async()=>[row]});
  await service.sync();
  for(const saved of db.prepare('SELECT rowid,payload FROM job_knowledge_records').all()) {
    const job=JSON.parse(saved.payload);job.fullDescriptionVerified=false;job.requirements=[];
    db.prepare('UPDATE job_knowledge_records SET payload=? WHERE rowid=?').run(JSON.stringify(job),saved.rowid);
  }
  const preview=service.cleanRecords();assert.equal(preview.jdEvidenceUpgrades,1);
  const apply=service.cleanRecords({apply:true});assert.equal(apply.jdEvidenceUpgrades,1);
  assert.equal(service.cleanRecords({apply:true}).changedRecords,0);
  const stored=db.prepare('SELECT source_id,payload FROM job_knowledge_records').all().map(r=>({...JSON.parse(r.payload),sourceId:r.source_id}));
  assert.equal(stored.find(r=>r.sourceId==='official').fullDescriptionVerified,true);
  assert.equal(stored.find(r=>r.sourceId==='aggregator').fullDescriptionVerified,false);
  assert.equal(db.prepare('SELECT value FROM candidate_facts').get().value,'unchanged');
  const result=await service.search({cacheOnly:true,query:'后端'});assert.equal(result.total,1);assert.equal(result.jobs[0].provenance.length,2);
  db.close();
});

test('recruitment batches cannot be marked eligibility-passed merely because a summary is long',()=>{
  const result=evaluateJobEligibility({...base,recordKind:'recruitment_batch',fullDescriptionVerified:true,description:'招聘批次介绍包含很多岗位，但未指定具体职责。'},{},{now:new Date(now).toISOString()});
  assert.equal(result.checks.find(c=>c.dimension==='source_completeness')?.status,'unknown');
});

test('cached JD upgrades reject foreign hosts, wrong tenants, missing sections and truncated bodies',async()=>{
  const body='岗位职责：\n负责后端系统开发、维护与性能优化。\n任职要求：\n熟悉 Python 与数据库。';
  const cases=[
    {feed:{id:'one',kind:'official',url:'https://acme.jobs.feishu.cn/index'},url:'https://foreign.jobs.feishu.cn/index/position/123/detail',description:body},
    {feed:{id:'one',kind:'official',parser:'moka',url:'https://app.mokahr.com/social-recruitment/acme/1'},url:'https://app.mokahr.com/social-recruitment/other/2/job/123',description:body},
    {feed:{id:'one',kind:'official',url:'https://acme.jobs.feishu.cn/index'},url:base.url,description:'岗位职责：\n负责后端系统开发、维护与性能优化。'},
    {feed:{id:'one',kind:'official',url:'https://acme.jobs.feishu.cn/index'},url:base.url,description:body+'后续内容'.repeat(5000)}
  ];
  for(const item of cases) {
    const db=new DatabaseSync(':memory:');
    const service=createJobKnowledge(db,{feeds:[item.feed],clock:()=>now,loader:async()=>[{company:'Acme',title:'后端工程师',url:item.url,jd_text:item.description,last_seen:new Date(now).toISOString()}]});
    await service.sync();
    assert.equal((await service.search({cacheOnly:true})).jobs[0].fullDescriptionVerified,false);
    assert.equal(service.cleanRecords().jdEvidenceUpgrades,0);
    db.close();
  }
});

test('expired cached rows disappear without deleting source history and update source counts on apply',async()=>{
  const db=new DatabaseSync(':memory:');
  const row={company:'Acme',title:'后端工程师',url:base.url,jd_text:'公开职位描述',last_seen:new Date(now).toISOString()};
  const service=createJobKnowledge(db,{clock:()=>now,feeds:[{id:'one'}],loader:async()=>[row]});
  await service.sync();
  const saved=db.prepare('SELECT payload FROM job_knowledge_records').get();
  db.prepare('UPDATE job_knowledge_records SET payload=?').run(JSON.stringify({...JSON.parse(saved.payload),deadline:'2026/10/26'}));
  assert.equal((await service.search({cacheOnly:true})).total,0);
  const cleaned=service.cleanRecords({apply:true});
  assert.equal(cleaned.newlyExpiredRecords,1);
  assert.equal(db.prepare('SELECT count FROM job_knowledge_sources').get().count,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM job_knowledge_records').get().n,1);
  assert.equal(service.cleanRecords({apply:true}).changedRecords,0);
  db.close();
});
