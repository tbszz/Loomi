import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createJobKnowledge,normalizeFeedJob,JOB_RETENTION} from './jobKnowledge.js';
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE users(id TEXT); INSERT INTO users VALUES ("keep");'.replace('"keep"',"'keep'"));
let now=Date.parse('2026-09-08T00:00:00Z'),calls=0,fail=false;
const feed={id:'fixture'};
test('company diversity crosses JD quality offsets within a relevance band',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const rows=['A','B','C'].flatMap(company=>Array.from({length:company==='A'?8:2},(_,i)=>({
    company,title:`后端开发工程师${i}`,job_type:'campus',location:'北京',
    jd_text:'负责后端软件开发与平台维护，熟悉Python。',full_description_verified:company==='A',
    url:`https://jobs.example/diversity/${company}/${i}`,last_seen:new Date(at).toISOString()
  })));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'diversity',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    const result=await service.search({query:'后端',type:'campus',profile:{},cacheOnly:true,limit:100});
    assert.equal(result.total,12);
    assert.ok(result.jobs.every(j=>j.eligibility.status==='verify'));
    assert.deepEqual(new Set(result.jobs.slice(0,6).map(j=>j.company)),new Set(['A','B','C']));
    for(const company of ['A','B','C']) assert.deepEqual(result.jobs.filter(j=>j.company===company).map(j=>j.title),rows.filter(j=>j.company===company).map(j=>j.title));
    const second=await service.search({query:'后端',type:'campus',profile:{},cacheOnly:true,limit:6,offset:6});
    assert.deepEqual(second.jobs.map(j=>j.id),result.jobs.slice(6).map(j=>j.id));
  } finally {await service.stop();db.close();}
});

test('self-reported graduation rejects mismatches before search pagination',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const rows=['24-26届','2027届'].map((cohort,i)=>({company:`合成企业${i}`,title:`开发工程师(${cohort})`,job_type:'campus',location:'北京',url:`https://jobs.example/cohort/${i}`,last_seen:new Date(at).toISOString()}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'cohort',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    const options={query:'开发',type:'campus',userStatements:['我是27届'],cacheOnly:true,limit:1};
    const first=await service.search(options);
    const second=await service.search({...options,offset:1});
    assert.equal(first.jobs[0].title,'开发工程师(2027届)');
    assert.equal(first.jobs[0].eligibility.status,'verify');
    assert.equal(second.jobs[0].eligibility.status,'rejected');
  } finally {await service.stop();db.close();}
});
test('campus role relevance follows all six bands and keeps rejected rows last',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const rows=[
    {key:'domain',title:'芯片后端工程师',job_type:'campus',full_description_verified:true},
    {key:'body-senior',title:'系统架构师',jd_text:'负责后端服务开发，要求5年以上工作经验。',full_description_verified:true},
    {key:'title-senior',title:'高级后端工程师',full_description_verified:true},
    {key:'body-neutral',title:'产品助理',jd_text:'配合后端服务开发。'},
    {key:'body-campus',title:'产品助理',job_type:'campus',jd_text:'配合后端服务开发。',full_description_verified:true},
    {key:'title-neutral',title:'后端开发工程师'},
    {key:'title-campus',title:'后端开发工程师',job_type:'campus'},
    {key:'rejected',title:'后端排除工程师',job_type:'campus'}
  ].map(r=>({company:`合成企业${r.key}`,url:`https://jobs.example/bands/${r.key}`,jd_text:'负责本岗位相关业务与团队协作。',location:'北京',last_seen:new Date(at).toISOString(),...r}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'bands',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    const result=await service.search({query:'后端',type:'campus',exclude:['排除'],cacheOnly:true,limit:100});
    assert.equal(result.total,rows.length);
    assert.deepEqual(result.jobs.map(j=>j.url.split('/').at(-1)),['title-campus','title-neutral','body-campus','title-senior','body-senior','body-neutral','domain','rejected']);
    assert.equal(result.jobs.at(-1).eligibility.status,'rejected');
  } finally {await service.stop();db.close();}
});

test('non-campus searches rank title roles above incidental mentions regardless of career stage',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  for(const [query,title,bodyTitle,description] of [
    ['数据分析','高级数据分析师','招聘专员','需要数据分析能力。'],
    ['客户端|Android|iOS','高级Android工程师','产品助理','配合客户端、Android、iOS研发团队。'],
    ['C++','高级C++工程师','策略算法工程师','掌握Java/C++/Python 至少一门。'],
    ['后端','高级后端工程师','芯片后端工程师','负责后端设计。']
  ]) {
    const db=new DatabaseSync(':memory:');
    const rows=[{title:bodyTitle,job_type:'campus',jd_text:description,full_description_verified:true},{title,jd_text:'需要5年以上工作经验。'}]
      .map((r,i)=>({company:`合成企业${i}`,url:`https://jobs.example/non-campus/${i}`,last_seen:new Date(at).toISOString(),...r}));
    const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'roles',kind:'official'}],loader:async()=>rows});
    try {
      await service.sync();
      assert.deepEqual((await service.search({query,cacheOnly:true})).jobs.map(j=>j.title),[title,bodyTitle],query);
    } finally {await service.stop();db.close();}
  }
});

test('a title must match every non-tech group of one matching branch including aliases',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const rows=[
    {title:'Java工程师',jd_text:'配合后端开发。',job_type:'campus',full_description_verified:true},
    {title:'Backend工程师',jd_text:'使用Java开发。',job_type:'campus',full_description_verified:true},
    {title:'Java高级Backend工程师'},
    {title:'Java后端工程师'},
    {title:'Java Android工程师',jd_text:'配合后端开发。',job_type:'campus',full_description_verified:true}
  ].map((r,i)=>({company:`合成企业${i}`,url:`https://jobs.example/groups/${i}`,jd_text:'负责平台开发维护。',last_seen:new Date(at).toISOString(),...r}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'groups',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    for(const type of ['campus',undefined]) {
      const result=await service.search({query:'Java 后端|Backend Android',type,cacheOnly:true});
      const titles=result.jobs.map(j=>j.title);
      assert.equal(result.summary.titleMatches,3);
      assert.equal(result.summary.descriptionOnly,2);
      for(const job of result.jobs) assert.equal(job.retrievalMatch,['Backend工程师','Java高级Backend工程师','Java后端工程师'].includes(job.title)?'title':'description',job.title);
      for(const partial of ['Java工程师','Java Android工程师']) assert.ok(titles.indexOf('Java后端工程师')<titles.indexOf(partial),partial);
      if(type==='campus') assert.ok(titles.indexOf('Java工程师')<titles.indexOf('Java高级Backend工程师'));
      else assert.ok(titles.indexOf('Java高级Backend工程师')<titles.indexOf('Java工程师'));
    }
  } finally {await service.stop();db.close();}
});

test('tech requirements preserve campus title relevance without weakening the AND pool',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const rows=[
    {key:'campus-body',title:'AI后端开发工程师',job_type:'campus',jd_text:'要求熟悉Java开发。'},
    {key:'campus-title',title:'Java后端开发工程师',job_type:'campus',jd_text:'负责平台开发维护。'},
    {key:'untyped',title:'Java后端开发工程师',jd_text:'负责平台开发维护。'},
    {key:'alternatives',title:'后端开发工程师',job_type:'campus',jd_text:'Java/Go/Python 任选其一。'},
    {key:'absent',title:'后端开发工程师',job_type:'campus',jd_text:'负责平台开发维护。'},
    {key:'metadata-only',company:'Java',title:'后端开发工程师',job_type:'campus',jd_text:'负责平台开发维护。'},
    {key:'separate-requirement',title:'后端开发工程师(AI大模型开发平台)',job_type:'campus',jd_text:'Java/Go/Python 任选其一；要求Java开发经验。'}
  ].map(r=>({company:'合成企业',url:`https://jobs.example/tech-role/${r.key}`,location:'北京',last_seen:new Date(at).toISOString(),...r}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'tech-role',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    const before=db.prepare('SELECT payload FROM job_knowledge_records ORDER BY rowid').all();
    const result=await service.search({query:'Java 后端开发',type:'campus',cacheOnly:true,limit:100});
    const keys=result.jobs.map(j=>j.url.split('/').at(-1));
    const byKey=Object.fromEntries(result.jobs.map(j=>[j.url.split('/').at(-1),j]));
    assert.equal(result.total,6,'only the row with no Java anywhere is excluded');
    assert.equal(result.summary.titleMatches,6);
    assert.equal(result.summary.descriptionOnly,0);
    for(const key of keys) assert.equal(byKey[key].retrievalMatch,'title',key);
    assert.ok(keys.indexOf('separate-requirement')<keys.indexOf('alternatives'),'substantive Java beats alternatives-only Java with equal title hits');
    assert.ok(!keys.includes('absent'));
    assert.ok(keys.indexOf('campus-body')<keys.indexOf('untyped'),'campus title band precedes untyped titles');
    assert.ok(keys.indexOf('campus-title')<keys.indexOf('campus-body'),'title tech hits still break ties within a tier');
    const javaOnly=await service.search({query:'Java',type:'campus',cacheOnly:true,limit:100});
    assert.equal(javaOnly.total,result.total);
    assert.equal(javaOnly.jobs.find(j=>j.url.endsWith('/campus-body')).retrievalMatch,'description');
    assert.equal(javaOnly.jobs.find(j=>j.url.endsWith('/alternatives')).retrievalMatch,'mention');
    assert.equal(javaOnly.jobs.find(j=>j.url.endsWith('/metadata-only')).retrievalMatch,'description');
    const page=await service.search({query:'Java 后端开发',type:'campus',cacheOnly:true,limit:1,offset:1});
    assert.equal(page.total,result.total);
    assert.deepEqual(page.summary,result.summary);
    assert.equal(page.jobs[0].id,result.jobs[1].id);
    assert.deepEqual(db.prepare('SELECT payload FROM job_knowledge_records ORDER BY rowid').all(),before);
  } finally {await service.stop();db.close();}
});

test('mixed React role queries accept alternatives while ranking substantive evidence first',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const rows=[
    {key:'alternatives',title:'27届秋招-前端开发工程师',jd_text:'熟悉React/Vue任一。'},
    {key:'substantive',title:'27届秋招-前端开发工程师',jd_text:'负责React组件维护。'},
    {key:'title',title:'27届秋招-React前端开发工程师',jd_text:'熟悉React/Vue任一。'},
    {key:'role-in-body',title:'27届秋招-软件工程师',jd_text:'负责前端开发，熟悉React。'},
    {key:'absent',title:'27届秋招-前端开发工程师',jd_text:'熟悉Vue。'}
  ].map(r=>({company:'合成企业',url:`https://jobs.example/react-role/${r.key}`,last_seen:new Date(at).toISOString(),...r}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'react-role',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    for(const type of [undefined,'campus']) {
      const result=await service.search({query:'React 前端开发',type,cacheOnly:true});
      assert.equal(result.total,4);
      assert.equal(result.summary.titleMatches,3);
      assert.deepEqual(result.jobs.map(j=>j.url.split('/').at(-1)),['title','substantive','alternatives','role-in-body']);
      assert.deepEqual(result.jobs.map(j=>j.retrievalMatch),['title','title','title','description']);
      const techOnly=await service.search({query:'React',type,cacheOnly:true});
      assert.equal(techOnly.jobs.find(j=>j.url.endsWith('/alternatives')).retrievalMatch,'mention');
    }
  } finally {await service.stop();db.close();}
});

test('role suffix variants and Chinese prefix aliases remain title matches through FTS',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  for(const [query,titles,excluded] of [
    ['后端开发',['服务端开发工程师','后端研发工程师','服务端研发工程师'],'Backend开发工程师'],
    ['后端研发',['后端开发工程师','服务端开发工程师','服务端研发工程师'],'Backend研发工程师'],
    ['C++ 开发',['27届秋招-c++研发工程师'],'C++工程师'],
    ['c++开发',['c++研发工程师'],'C工程师'],
    ['开发',['研发工程师'],'产品工程师'],
    ['研发',['开发工程师'],'产品工程师'],
    ['后端',['Backend工程师'],'产品工程师'],
    ['LLM开发',['LLM研发工程师'],'大模型研发工程师'],
    ['大模型开发',['大模型研发工程师'],'large language model开发工程师'],
    ['计算机开发',['计算机研发工程师'],'数据开发工程师'],
    ['芯片后端开发',['芯片后端研发工程师'],'后端研发工程师']
  ]) {
    const db=new DatabaseSync(':memory:');
    const rows=[...titles,excluded].map((title,i)=>({company:'合成企业',title,jd_text:'负责日常工作。',url:`https://jobs.example/role-variants/${i}`,last_seen:new Date(at).toISOString()}));
    const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'role-variants',kind:'official'}],loader:async()=>rows});
    try {
      await service.sync();
      const prepare=db.prepare.bind(db);
      let usedFts=false;
      db.prepare=sql=>{
        if(sql.startsWith('SELECT') && sql.includes('payload')) {
          assert.match(sql,/job_knowledge_fts MATCH \?/,'generated alternates must not cause an accidental full scan');
          usedFts=true;
        }
        return prepare(sql);
      };
      const result=await service.search({query,cacheOnly:true});
      assert.equal(result.total,titles.length,query);
      assert.deepEqual(result.jobs.map(j=>j.title).sort(),[...titles].sort(),query);
      assert.ok(result.jobs.every(j=>j.retrievalMatch==='title' && j.retrievalDomainPenalty===0),query);
      assert.ok(usedFts,query);
    } finally {await service.stop();db.close();}
  }
});

test('category prefixes do not create compound title synonyms',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const rows=[
    {title:'数据网络工程师',jd_text:'熟悉计算机网络。'},
    {title:'安全网络工程师',jd_text:'熟悉计算机网络。'},
    {title:'计算机网络工程师',jd_text:'负责网络维护。'},
    {title:'算法平台工程师',jd_text:'熟悉人工智能平台和ai平台。'}
  ].map((row,i)=>({company:'合成企业',url:`https://jobs.example/category-prefix/${i}`,last_seen:new Date(at).toISOString(),...row}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'category-prefix',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    const result=await service.search({query:'计算机网络',cacheOnly:true});
    assert.equal(result.total,3);
    assert.equal(result.summary.titleMatches,1);
    for(const job of result.jobs) assert.equal(job.retrievalMatch,job.title==='计算机网络工程师'?'title':'description',job.title);
    for(const query of ['人工智能平台','ai平台']) {
      const result=await service.search({query,cacheOnly:true});
      assert.equal(result.total,1,query);
      assert.equal(result.jobs[0].retrievalMatch,'description',query);
    }
  } finally {await service.stop();db.close();}
});

test('machine learning remains a role group and tech-only branches still require all terms in the title',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const rows=[
    {title:'机器学习工程师',jd_text:'要求Python和SQL开发经验。'},
    {title:'Python工程师',jd_text:'负责机器学习，要求SQL开发经验。'},
    {title:'Python SQL工程师',jd_text:'负责机器学习平台开发。'}
  ].map((r,i)=>({company:`合成企业${i}`,url:`https://jobs.example/tech-only/${i}`,last_seen:new Date(at).toISOString(),...r}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'tech-only',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    const mixed=await service.search({query:'Python 机器学习',cacheOnly:true});
    assert.equal(mixed.total,3);
    assert.equal(mixed.jobs[0].title,'机器学习工程师');
    assert.deepEqual(mixed.jobs.map(j=>j.retrievalMatch),['title','description','description']);
    const techOnly=await service.search({query:'Python SQL',cacheOnly:true});
    assert.equal(techOnly.total,3);
    assert.equal(techOnly.jobs[0].title,'Python SQL工程师');
    assert.deepEqual(techOnly.jobs.map(j=>j.retrievalMatch),['title','description','description']);
  } finally {await service.stop();db.close();}
});

test('retrieval strength and whole-pool counts distinguish role titles from description references',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  for(const [query,title,others,description] of [
    ['前端','Frontend工程师',['软件开发工程师','智能语音测试工程师','射频工程师'],'参与前端开发协作。'],
    ['硬件测试','硬件测试工程师',['硬件工程师'],'负责硬件测试。']
  ]) {
    const db=new DatabaseSync(':memory:');
    const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'strength',kind:'official'}],loader:async()=>[title,...others].map((title,i)=>({company:`合成企业${i}`,title,jd_text:description,url:`https://jobs.example/strength/${i}`,last_seen:new Date(at).toISOString()}))});
    try {
      await service.sync();
      const all=await service.search({query,cacheOnly:true});
      assert.deepEqual(all.jobs.map(j=>j.retrievalMatch),['title',...others.map(()=>'description')]);
      assert.equal(all.summary.titleMatches,1);
      assert.equal(all.summary.descriptionOnly,others.length);
      const page=await service.search({query,cacheOnly:true,limit:1,offset:1});
      assert.equal(page.summary.titleMatches,1);
      assert.equal(page.summary.descriptionOnly,others.length);
      assert.equal(page.total,others.length+1);
      assert.equal(page.jobs[0].retrievalMatch,'description');
      const empty=await service.search({query:'无此岗位',cacheOnly:true});
      assert.equal(empty.summary.titleMatches,0);
      assert.equal(empty.summary.descriptionOnly,0);
    } finally {await service.stop();db.close();}
  }
});

test('alternative-only occurrences remain in total as mentions after substantive descriptions within a band',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const mentions=['Java/C++/Python 至少一种','如 Java、Go、Python、C++ 等','C/C++/MATLAB','熟悉 Java、C++、Python 其中一种','Python/C++ 至少一门','熟悉Java、C++中任意一种','例如Java、C++等语言'];
  const descriptions=['精通C++','精通C++、Linux','精通C++、Linux等技能','至少一年C++开发经验','Java/C++/Python 至少一种；精通C++','如 Java、Go、Python、C++ 等。负责C++服务开发。','掌握C++、Linux，任职等级不限'];
  const db=new DatabaseSync(':memory:');
  const rows=[...mentions.map(jd_text=>({title:'策略算法工程师',jd_text,full_description_verified:true})),...descriptions.map(jd_text=>({title:'软件工程师',jd_text})),{title:'C++工程师',jd_text:mentions[0]}]
    .map((r,i)=>({company:`合成企业${i}`,url:`https://jobs.example/alternatives/${i}`,last_seen:new Date(at).toISOString(),...r}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'alternatives',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    const before=db.prepare('SELECT payload FROM job_knowledge_records ORDER BY rowid').all();
    for(const type of [undefined,'campus']) {
      const result=await service.search({query:'C++',type,cacheOnly:true,limit:100});
      assert.equal(result.total,rows.length);
      assert.deepEqual(result.jobs.map(j=>j.retrievalMatch),['title',...descriptions.map(()=>'description'),...mentions.map(()=>'mention')]);
      assert.equal(result.summary.titleMatches,1);
      assert.equal(result.summary.descriptionOnly,mentions.length+descriptions.length);
      for(const job of result.jobs) assert.equal(job.retrievalMatch,job.title==='C++工程师'?'title':mentions.includes(job.description)?'mention':'description',job.description);
      const page=await service.search({query:'C++',type,cacheOnly:true,limit:2,offset:descriptions.length});
      assert.deepEqual(page.jobs.map(j=>j.id),result.jobs.slice(descriptions.length,descriptions.length+2).map(j=>j.id));
      assert.equal(page.summary.descriptionOnly,mentions.length+descriptions.length);
    }
    assert.deepEqual(db.prepare('SELECT payload FROM job_knowledge_records ORDER BY rowid').all(),before,'retrieval metadata must not mutate shared records');
  } finally {await service.stop();db.close();}
});

test('software testing demotes chip, cell, reliability and RF titles while explicit domains retain intent',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  for(const query of ['测试','testing','QA']) {
    const db=new DatabaseSync(':memory:');
    const titles=['芯片','电芯','可靠性','射频','软件'].map(domain=>`${domain} ${query}工程师`);
    const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'testing-domains',kind:'official'}],loader:async()=>titles.map((title,i)=>({company:`合成企业${i}`,title,url:`https://jobs.example/testing/${i}`,last_seen:new Date(at).toISOString()}))});
    try {
      await service.sync();
      const result=await service.search({query,cacheOnly:true});
      assert.equal(result.total,5);
      assert.equal(result.jobs[0].title,titles.at(-1));
      assert.ok(result.jobs.slice(1).every(j=>j.retrievalDomainPenalty===1));
      for(const domain of ['芯片','电芯','可靠性','射频']) {
        const explicit=await service.search({query:`${domain} ${query}`,cacheOnly:true});
        assert.equal(explicit.total,1);
        assert.equal(explicit.jobs[0].retrievalDomainPenalty,0);
        assert.equal(explicit.jobs[0].retrievalMatch,'title');
      }
    } finally {await service.stop();db.close();}
  }
});

test('explicit compact chip testing queries retain title matches',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'chip-testing',kind:'official'}],loader:async()=>[{company:'合成企业',title:'芯片测试工程师',url:'https://jobs.example/chip-testing',last_seen:new Date(at).toISOString()}]});
  try {
    await service.sync();
    const result=await service.search({query:'芯片测试',cacheOnly:true});
    assert.equal(result.total,1);
    assert.equal(result.jobs[0].retrievalDomainPenalty,0);
    assert.equal(result.jobs[0].retrievalMatch,'title');
  } finally {await service.stop();db.close();}
});

test('season and cohort titles rank as batches even when stored as postings without mutating rows',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const titles=['秋招·2027届','2027届校园招聘','春招','合成企业春招','秋招·2027届·后端工程师','产品助理'];
  const rows=titles.map((title,i)=>({company:'合成企业',title,url:`https://jobs.example/batches/${i}`,job_type:'campus',jd_text:'配合后端开发工作。',full_description_verified:i!==5,last_seen:new Date(at).toISOString()}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'batches',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    const before=db.prepare('SELECT payload FROM job_knowledge_records ORDER BY rowid').all();
    assert.equal(JSON.parse(before[2].payload).recordKind,'posting');
    const result=await service.search({query:'后端',type:'campus',cacheOnly:true});
    assert.deepEqual(result.jobs.slice(0,2).map(j=>j.title),['秋招·2027届·后端工程师','产品助理']);
    assert.deepEqual(new Set(result.jobs.slice(2).map(j=>j.title)),new Set(titles.slice(0,4)));
    assert.deepEqual(db.prepare('SELECT payload FROM job_knowledge_records ORDER BY rowid').all(),before);
  } finally {await service.stop();db.close();}
});

test('digitalisation software titles avoid chip penalties while digital chip titles retain them',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const titles=['数字前端工程师','数字后端工程师','数字中后端工程师','数字IC后端工程师','数字化后端开发主管工程师','数字化前端开发工程师'];
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'digital',kind:'official'}],loader:async()=>titles.map((title,i)=>({company:`合成企业${i}`,title,url:`https://jobs.example/digital/${i}`,job_type:'campus',last_seen:new Date(at).toISOString()}))});
  try {
    await service.sync();
    const result=await service.search({query:'前端|后端',cacheOnly:true});
    for(const job of result.jobs) assert.equal(job.retrievalDomainPenalty,Number(!job.title.startsWith('数字化')),job.title);
    assert.ok(result.jobs.slice(0,2).every(j=>j.title.startsWith('数字化')));
    const explicit=await service.search({query:'数字化 后端|后端',cacheOnly:true});
    assert.equal(explicit.jobs.find(j=>j.title==='数字后端工程师').retrievalDomainPenalty,1);
  } finally {await service.stop();db.close();}
});

test('campus evidence outranks JD completeness and untyped seniority, preserving diversity and pages',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const db=new DatabaseSync(':memory:');
  const rows=[
    {title:'后端工程师',jd_text:'任职要求：5年及以上工作经验，熟悉Python。',verified:true},
    ...['资深','高级','专家','负责人'].map(marker=>({title:`后端${marker}`,verified:true})),
    {title:'后端工程师',jd_text:'任职要求：3年以上产品经验，熟悉Python。',verified:true},
    {title:'后端工程师',jd_text:'任职要求：1-2年工作经验，熟悉Python。',verified:true},
    {title:'后端研发',verified:false},
    {title:'后端开发',verified:true,url:'https://jobs.example/campusrecruitment/neutral'},
    {title:'后端软件开发',job_type:'campus',verified:false,company:'共同公司'},
    {title:'后端平台开发',job_type:'campus',verified:false,company:'共同公司'},
    {title:'后端服务开发',job_type:'campus',verified:false,company:'另一公司'},
    ...['校招','应届','毕业生','27届','秋招','管培'].map(signal=>({title:'后端工程师',jd_text:`面向${signal}，熟悉Python，负责后端服务开发和平台维护。`,verified:false}))
  ].map((r,i)=>({company:`合成企业${i}`,title:'后端工程师',jd_text:'负责后端服务开发和平台维护，熟悉Python。',job_type:'',location:'北京',last_seen:new Date(at).toISOString(),url:`https://jobs.example/stage/${i}`,...r,full_description_verified:r.verified}));
  const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:'stages',kind:'official'}],loader:async()=>rows});
  try {
    await service.sync();
    const profile={education:['某大学 本科 2023-2027'],skills:['Python'],experience:[]};
    for(const candidate of [undefined,profile]) {
      const options={query:'后端',type:'campus',profile:candidate,cacheOnly:true};
      const all=await service.search({...options,limit:100});
      assert.equal(all.total,rows.length,'ranking must not discard untyped discoveries');
      const positive=all.jobs.filter(j=>j.type==='campus'||/校招|应届|毕业生|27届|秋招|管培/.test(j.description));
      const neutral=all.jobs.filter(j=>['后端研发','后端开发'].includes(j.title));
      const negative=all.jobs.filter(j=>/资深|高级|专家|负责人/.test(j.title)||/\d.*年.*经验/.test(j.description));
      assert.equal(positive.length,9);
      assert.ok(Math.max(...positive.map(j=>all.jobs.indexOf(j)))<Math.min(...neutral.map(j=>all.jobs.indexOf(j))));
      assert.ok(Math.max(...neutral.map(j=>all.jobs.indexOf(j)))<Math.min(...negative.map(j=>all.jobs.indexOf(j))));
      assert.equal(all.jobs.find(j=>j.url.includes('campusrecruitment')).type,null,'URL paths are not campus evidence');
      const first=await service.search({...options,limit:2});
      const second=await service.search({...options,limit:2,offset:2});
      assert.equal(new Set(first.jobs.map(j=>j.company)).size,2);
      assert.deepEqual([...first.jobs,...second.jobs].map(j=>j.id),all.jobs.slice(0,4).map(j=>j.id));
    }
  } finally {await service.stop();db.close();}
});

test('ambiguous software terms demote other title domains without changing totals or explicit domain intent',async()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');
  const cases=[
    {query:'后端',good:'后端软件工程师',others:['芯片后端工程师','数字中后端工程师','后端流程工程师','模拟后端设计','版图后端设计','后端验证工程师'],explicit:'芯片后端'},
    {query:'前端',good:'前端软件工程师',others:['SoC前端设计工程师','芯片前端验证工程师','数字前端工程师'],explicit:'SoC前端'},
    {query:'测试',good:'软件测试工程师',others:['硬件测试工程师','电池测试工程师','电气测试工程师','整机测试工程师','产线测试工程师','测试操作员','测试员(派遣)'],explicit:'硬件测试'},
    {query:'运营',good:'产品运营专员',others:['安全运营工程师','运营运维工程师'],explicit:'安全运营'},
    {query:'大模型',good:'LLM算法工程师',others:['AIGC设计师','AIGC美术师','AIGC动画师','AIGC视频制作'],explicit:'AIGC设计师'},
    {query:'LLM',good:'LLM算法工程师',others:['AIGC设计师','AIGC动画师'],explicit:'AIGC动画师'}
  ];
  for(const [index,item] of cases.entries()) {
    const db=new DatabaseSync(':memory:');
    const titles=[...item.others,item.good];
    const service=createJobKnowledge(db,{clock:()=>at,feeds:[{id:`domain${index}`,kind:'official'}],loader:async()=>titles.map((title,i)=>({company:`合成企业${i}`,title,url:`https://jobs.example/domain/${index}/${i}`,job_type:'campus',jd_text:'岗位职责：负责本岗位相关业务，推动团队项目执行。',last_seen:new Date(at).toISOString(),full_description_verified:i<item.others.length}))});
    try {
      await service.sync();
      const result=await service.search({query:item.query,cacheOnly:true,limit:100});
      assert.equal(result.total,titles.length,item.query);
      assert.equal(result.jobs[0].title,item.good,item.query);
      assert.ok((await service.search({query:item.explicit,cacheOnly:true})).jobs.some(j=>j.title===item.others[0]||j.title.toLowerCase().includes(item.explicit.toLowerCase())),item.explicit);
      const next=await service.search({query:item.query,cacheOnly:true,limit:1,offset:1});
      assert.equal(next.jobs[0].id,result.jobs[1].id);
    } finally {await service.stop();db.close();}
  }
});
const row={company_name:'测试公司',title:'前端实习',official_url:'https://example.com/jobs/1?utm_source=x',location:'上海',job_type:'实习',jd_text:'真实岗位描述',last_seen:new Date(now).toISOString()};
const service=createJobKnowledge(db,{clock:()=>now,feeds:[feed],loader:async()=>{calls++;if(fail)throw new Error('offline');return [row,{...row,official_url:'https://example.com/jobs/1'}];}});
assert.equal(normalizeFeedJob({...row,last_seen:''},feed,now),null);
assert.equal(normalizeFeedJob({...row,official_url:'javascript:alert(1)'},feed,now),null);
await service.sync();assert.equal(calls,1);
let result=await service.search({query:'前端',type:'internship'});
assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].fullDescriptionVerified,false);assert.equal(calls,1);
assert.equal(result.sources[0].count,1,'source counts must reflect unique active records rather than duplicate input rows');
const restarted=createJobKnowledge(db,{clock:()=>now,feeds:[feed],loader:async()=>{throw new Error('must not refresh early')}});
await restarted.sync();assert.equal((await restarted.search({query:'前端'})).jobs.length,1);
now+=JOB_RETENTION.refreshMs;fail=true;await service.sync();
assert.equal((await service.search({query:'前端'})).jobs.length,1);
now+=JOB_RETENTION.freshMs;fail=false;await service.sync();
assert.equal((await service.search({query:'前端'})).jobs.length,0);
assert.equal(db.prepare('SELECT COUNT(*) n FROM job_knowledge_records WHERE archived_at IS NOT NULL').get().n,1);
now+=60*86400000;service.cleanup(true);await service.sync({force:true});
// Archived postings stay as history instead of being deleted.
assert.equal(db.prepare('SELECT COUNT(*) n FROM job_knowledge_records WHERE archived_at IS NOT NULL').get().n,1);
assert.equal((await service.search({query:'前端'})).jobs.length,0);
assert.equal(db.prepare('SELECT id FROM users').get().id,'keep');
assert.equal(db.prepare('SELECT COUNT(*) n FROM job_knowledge_runs').get().n,1);
// A second worker cannot synchronize a source while the first holds its lease.
let release,otherCalls=0;
const owner=createJobKnowledge(db,{clock:()=>now,feeds:[{id:'lease'}],loader:()=>new Promise(resolve=>{release=()=>resolve([{...row,last_seen:new Date(now).toISOString()}]);})});
const other=createJobKnowledge(db,{clock:()=>now,feeds:[{id:'lease'}],loader:async()=>{otherCalls++;return [row]}});
const running=owner.sync({force:true});await other.sync({force:true});assert.equal(otherCalls,0);release();await running;
await service.stop();db.close();

const queryDb=new DatabaseSync(':memory:');
const queryNow=Date.parse('2026-09-08T00:00:00Z');
const queryRows=[
  {...row,title:'AI算法实习',official_url:'https://example.com/jobs/ai-intern',job_type:'实习',jd_text:'机器学习 人工智能 模型训练',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'行政实习',official_url:'https://example.com/jobs/admin-intern',job_type:'实习',jd_text:'办公室支持 文档整理',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'AI算法工程师',official_url:'https://example.com/jobs/ai-social',job_type:'社招',jd_text:'人工智能 平台 工程',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'AI过期实习',official_url:'https://example.com/jobs/stale-ai-intern',job_type:'实习',jd_text:'人工智能 过期岗位',last_seen:new Date(queryNow-JOB_RETENTION.freshMs-1000).toISOString()},
  {...row,title:'C++开发实习',official_url:'https://example.com/jobs/cpp-intern',job_type:'实习',jd_text:'C++ 工程开发',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'.NET平台实习',official_url:'https://example.com/jobs/dotnet-intern',job_type:'实习',jd_text:'.NET C# 后端',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'Node.js后端实习',official_url:'https://example.com/jobs/nodejs-intern',job_type:'实习',jd_text:'Node.js API 服务',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'Backend Engineer',official_url:'https://example.com/jobs/backend-intern-type',job_type:'internship',jd_text:'Build backend services',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'Detail Training Coordinator',official_url:'https://example.com/jobs/detail-training',job_type:'社招',jd_text:'Coordinate training details',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'Detail Training Coordinator AI Engineer',official_url:'https://example.com/jobs/detail-training-ai',job_type:'社招',jd_text:'Coordinate training details and AI engineering',last_seen:new Date(queryNow).toISOString()}
];
const queryService=createJobKnowledge(queryDb,{clock:()=>queryNow,feeds:[{id:'query'}],loader:async()=>queryRows});
await queryService.sync({force:true});
const compound=await queryService.search({query:'AI实习'});
const spaced=await queryService.search({query:'AI 实习'});
assert.deepEqual(compound.jobs.map(job=>job.id),spaced.jobs.map(job=>job.id));
assert.deepEqual(compound.jobs.map(job=>job.title),['AI算法实习']);
assert.deepEqual((await queryService.search({query:'人工智能实习'})).jobs.map(job=>job.title),['AI算法实习']);
assert.equal((await queryService.search({query:'量子实习'})).jobs.length,0);
assert.deepEqual((await queryService.search({query:'AI',type:'social'})).jobs.map(job=>job.title),['AI算法工程师','Detail Training Coordinator AI Engineer']);
assert.deepEqual((await queryService.search({query:'C++实习'})).jobs.map(job=>job.title),['C++开发实习']);
assert.deepEqual((await queryService.search({query:'C++ 实习'})).jobs.map(job=>job.title),['C++开发实习']);
assert.deepEqual((await queryService.search({query:'.NET实习'})).jobs.map(job=>job.title),['.NET平台实习']);
assert.deepEqual((await queryService.search({query:'Node.js实习'})).jobs.map(job=>job.title),['Node.js后端实习']);
assert.deepEqual((await queryService.search({query:'Backend internship'})).jobs.map(job=>job.title),['Backend Engineer']);
assert.deepEqual((await queryService.search({query:'AI|C++',type:'internship'})).jobs.map(job=>job.title),['AI算法实习','C++开发实习']);
assert.deepEqual((await queryService.search({query:'AI Detail',type:'social'})).jobs.map(job=>job.title),['Detail Training Coordinator AI Engineer']);
assert.deepEqual((await queryService.search({query:'AI Coordinate',type:'social'})).jobs.map(job=>job.title),['Detail Training Coordinator AI Engineer']);
assert.equal((await queryService.search({query:'AI过期'})).jobs.length,0);
assert.equal((await queryService.search({query:`${'x'.repeat(120)} 前端`})).jobs.length,0);
await queryService.stop();queryDb.close();
console.log('Background knowledge tests passed: sync, dedup, failure retention, freshness, cleanup, restart, lease, read-only search');

// Search should bootstrap/refresh due feeds, broaden technical role vocabulary,
// search locations, and paginate a diverse pool rather than repeat one company.
const discoveryDb=new DatabaseSync(':memory:');
let discoveryNow=Date.parse('2026-10-12T00:00:00Z'),discoveryCalls=0;
const discoveryRows=Array.from({length:8},(_,i)=>({...row,company_name:i<6?'大公司':`公司${i}`,
  title:i%2?'机器学习实习':'后端开发实习',location:'北京',job_type:'实习',
  official_url:`https://example.com/discovery/${i}`,last_seen:new Date(discoveryNow).toISOString()}));
discoveryRows.push({...row,title:'算法实习',location:'上海',official_url:'https://example.com/discovery/shanghai',last_seen:new Date(discoveryNow).toISOString()});
const discovery=createJobKnowledge(discoveryDb,{clock:()=>discoveryNow,feeds:[{id:'discovery'}],loader:async()=>{discoveryCalls++;return discoveryRows;}});
const firstPage=await discovery.search({query:'计算机 实习',location:'北京',limit:3});
assert.equal(discoveryCalls,1,'first search must not read an empty, never-synchronized cache');
assert.equal(firstPage.total,8);
assert.equal(firstPage.hasMore,true);
assert.equal(new Set(firstPage.jobs.map(j=>j.company)).size,3);
const secondPage=await discovery.search({query:'计算机 实习',location:'北京',limit:3,offset:3});
assert.equal(secondPage.jobs.some(j=>firstPage.jobs.some(previous=>previous.id===j.id)),false);
assert.equal(discoveryCalls,1,'fresh sources must not refresh for each pagination request');
assert.equal((await discovery.search({query:'AI实习',location:'北京'})).jobs.length,4);
discoveryNow+=JOB_RETENTION.refreshMs;
await discovery.search({query:'AI'});assert.equal(discoveryCalls,2,'due snapshots refresh during search');
await discovery.search({query:'AI',refresh:true});assert.equal(discoveryCalls,3);
await discovery.stop();discoveryDb.close();

const officialRow={...row,jd_text:'负责后端服务开发、接口设计、系统测试以及性能优化工作。',requirements:['计算机相关专业'],fullDescriptionVerified:true,publish_time:'',last_seen:new Date(queryNow).toISOString(),officialListingVerifiedAt:new Date(queryNow).toISOString()};
const official=normalizeFeedJob(officialRow,{id:'official-test',kind:'official'},queryNow);
assert.equal(official.source,'official-career-site');
assert.equal(official.fullDescriptionVerified,true);
assert.deepEqual(official.requirements,['计算机相关专业'],'explicit requirements from verified official rows remain available downstream');
assert.equal(official.officialListingVerifiedAt,queryNow);
assert.equal(official.publishedAt,'','observing official listing must not invent its publication date');
assert.equal(normalizeFeedJob(officialRow,{id:'aggregator'},queryNow).fullDescriptionVerified,false);

const dedupDb=new DatabaseSync(':memory:');
const dedupService=createJobKnowledge(dedupDb,{clock:()=>queryNow,feeds:[{id:'official',kind:'official'},{id:'summary'}],loader:async feed=>[feed.kind==='official'?officialRow:{...officialRow,jd_text:'聚合摘要'.repeat(100)}]});
assert.equal((await dedupService.search()).jobs[0].source,'official-career-site','a longer aggregator summary must not replace the verified official JD');
await dedupService.stop();dedupDb.close();

const relevanceDb=new DatabaseSync(':memory:');
const relevance=createJobKnowledge(relevanceDb,{clock:()=>queryNow,feeds:[{id:'relevance'}],loader:async()=>[
  {...row,title:'行政实习',jd_text:'整理AI项目文档',official_url:'https://example.com/relevance/admin',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'机器学习实习',jd_text:'研发算法',official_url:'https://example.com/relevance/ml',last_seen:new Date(queryNow).toISOString()}
]});
assert.equal((await relevance.search({query:'AI实习'})).jobs[0].title,'机器学习实习','technical title should rank above incidental AI mention in unrelated duties');
await relevance.stop();relevanceDb.close();

const sharedDb=new DatabaseSync(':memory:');
const sharedList=createJobKnowledge(sharedDb,{clock:()=>queryNow,feeds:[{id:'official-shared',kind:'official'}],loader:async()=>[
  {...officialRow,title:'机器学习实习',job_id:'post-a'},
  {...officialRow,title:'前端实习',job_id:'post-b'}
]});
assert.equal((await sharedList.search()).jobs.length,2,'two jobs sharing a list URL must retain distinct source identities');
await sharedList.stop();sharedDb.close();

const typeDb=new DatabaseSync(':memory:');
const typed=createJobKnowledge(typeDb,{clock:()=>queryNow,feeds:[{id:'types'}],loader:async()=>[
  {...row,company:'',company_name:'未知类型公司',title:'AI后端工程师',job_type:'',official_url:'https://example.com/types/unknown',last_seen:new Date(queryNow).toISOString()},
  {...row,company:'',company_name:'实习公司',title:'算法实习',job_type:'实习',official_url:'https://example.com/types/intern',last_seen:new Date(queryNow).toISOString()}
]});
assert.equal((await typed.search({query:'AI|后端',type:'internship'})).jobs[0].title,'算法实习','verified employment type should rank ahead of unknown-type discoveries');
await typed.stop();typeDb.close();

const liveDb=new DatabaseSync(':memory:');
let liveNow=queryNow,liveRows=[{...row,last_seen:new Date(queryNow).toISOString()}],liveCalls=0;
const live=createJobKnowledge(liveDb,{clock:()=>liveNow,feeds:[{id:'snapshot',snapshot:true,allowEmpty:true,refreshMs:15*60000}],loader:async()=>{liveCalls++;return liveRows;}});
await live.search();liveNow+=15*60000;liveRows=[];
assert.equal((await live.search()).jobs.length,0,'removed jobs must leave the searchable snapshot at the next source cadence');
assert.equal(liveCalls,2);
assert.equal(liveDb.prepare('SELECT count,error FROM job_knowledge_sources').get().count,0);
assert.equal(liveDb.prepare('SELECT count,error FROM job_knowledge_sources').get().error,null);
await live.stop();liveDb.close();

const regionDb=new DatabaseSync(':memory:');
const region=createJobKnowledge(regionDb,{clock:()=>queryNow,feeds:[{id:'regions',sourceType:'github-aggregator'}],loader:async()=>[
  {...row,title:'AI实习',location:'San Jose, CA',country:'United States',official_url:'https://example.com/region/us',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'AI实习',location:'Paris, France',country:'France',official_url:'https://example.com/region/fr',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'AI实习',location:'Beijing, China',country:'China',official_url:'https://example.com/region/cn',last_seen:new Date(queryNow).toISOString()},
  {...row,title:'AI实习',location:'Remote',official_url:'https://example.com/region/unknown',last_seen:new Date(queryNow).toISOString()}
]});
assert.equal((await region.search({query:'AI',region:'domestic',limit:1})).jobs[0].country,'China','region must be applied before page limits');
assert.equal((await region.search({query:'AI',region:'domestic'})).total,1);
await region.stop();regionDb.close();

const githubNormalized=normalizeFeedJob({...officialRow,country:'China',postingAge:'3d'},{id:'github-test',sourceType:'github-aggregator'},queryNow);
assert.equal(githubNormalized.source,'github-job-source');
assert.equal(githubNormalized.fullDescriptionVerified,false);
assert.equal(githubNormalized.country,'China');

// On-demand detail: enrich stores the official JD, a later list sync keeps it,
// and http/https copies of one posting collapse into the verified one.
{
  const detailDb=new DatabaseSync(':memory:');
  const at=Date.parse('2026-10-20T00:00:00Z');
  const listRow={company_name:'腾讯',title:'后台开发实习',official_url:'http://careers.tencent.com/jobdesc.html?postId=1',job_type:'实习',jd_text:'负责后台服务',last_seen:new Date(at).toISOString()};
  let detailCalls=0,detailMode='ok';
  const service=createJobKnowledge(detailDb,{clock:()=>at,feeds:[{id:'agg'}],loader:async()=>[listRow],detailLoader:async()=>{
    detailCalls++;
    if(detailMode==='fail') throw new Error('detail_http_503');
    if(detailMode==='none') return null;
    return {description:'岗位职责：负责后台服务开发。\n任职要求：熟悉 Go 或 C++。',requirements:['熟悉 Go 或 C++'],url:'https://careers.tencent.com/jobdesc.html?postId=1',provider:'tencent',verified:true};
  }});
  const [job]=(await service.search({query:'后台'})).jobs;
  assert.equal(job.fullDescriptionVerified,false);
  detailMode='fail';
  const failed=await service.enrich(job);
  assert.equal(failed.status,'failed');assert.equal(failed.job.fullDescriptionVerified,false);
  detailMode='none';
  assert.equal((await service.enrich(job)).status,'unsupported');
  detailMode='ok';
  const enriched=await service.enrich(job);
  assert.equal(enriched.status,'verified');assert.deepEqual(enriched.job.requirements,['熟悉 Go 或 C++']);
  assert.equal((await service.enrich(enriched.job)).status,'already');assert.equal(detailCalls,3);
  await service.sync({force:true});
  const [kept]=(await service.search({query:'后台'})).jobs;
  assert.equal(kept.fullDescriptionVerified,true,'a list re-sync must not erase a fetched official JD');
  assert.match(kept.description,/任职要求/);
  const dupDb=new DatabaseSync(':memory:');
  const dup=createJobKnowledge(dupDb,{clock:()=>at,feeds:[{id:'agg'},{id:'live',kind:'official'}],loader:async feed=>feed.id==='agg'?[listRow]:[{...listRow,official_url:'https://careers.tencent.com/jobdesc.html?postId=1',jd_text:'负责后台服务开发与性能优化，参与高并发系统设计与线上稳定性保障',requirements:['熟悉 Go'],fullDescriptionVerified:true,officialListingVerifiedAt:new Date(at).toISOString()}]});
  const deduped=await dup.search({query:'后台'});
  assert.equal(deduped.total,1);assert.equal(deduped.jobs[0].fullDescriptionVerified,true);
  assert.equal(typeof deduped.sources[0].historyCount,'number');
  detailDb.close();dupDb.close();
}

{
  // Kuaishou links every posting to one list page: job_id must keep them apart.
  const at=Date.parse('2026-10-20T00:00:00Z');
  const base={company:'快手',url:'https://campus.kuaishou.cn/recruit/campus/e/',jd_text:'负责商业化策略产品设计与数据分析，推动产品迭代',requirements:['本科及以上学历'],fullDescriptionVerified:true,last_seen:new Date(at).toISOString()};
  const sharedDb=new DatabaseSync(':memory:');
  const shared=createJobKnowledge(sharedDb,{clock:()=>at,feeds:[{id:'ks',kind:'official'}],loader:async()=>[{...base,job_id:'a',title:'策略产品经理'},{...base,job_id:'b',title:'数据分析师'},{...base,job_id:'c',title:'后端开发'}]});
  const listed=await shared.search({});
  assert.equal(listed.total,3,'postings sharing one list-page URL stay separate records');
  assert.equal(new Set(listed.jobs.map(job=>job.id)).size,3);
  sharedDb.close();
}

{
  // Full-text index, per-source freshness, stated deadlines and company scale.
  const at=Date.parse('2026-10-26T00:00:00Z');
  const day=86400000;
  const row=(over)=>({company:'深圳某机器人',title:'软件开发工程师',url:`https://example.com/${over.id}`,jd_text:'负责前端开发与 React 组件维护',last_seen:new Date(at-day).toISOString(),...over});
  const indexDb=new DatabaseSync(':memory:');
  const feeds=[{id:'campus',freshMs:60*day},{id:'live'}];
  const indexed=createJobKnowledge(indexDb,{clock:()=>at,feeds,loader:async feed=>feed.id==='campus'?[
    row({id:'old-campus',title:'2027届校园招聘',last_seen:new Date(at-30*day).toISOString()}),
    row({id:'closed',deadline:'2026/10/15'}),
    row({id:'open',deadline:'2026/11/30',title:'嵌入式算法实习'}),
    row({id:'asap',deadline:'尽快投递',company:'腾讯',title:'后台开发'})
  ]:[row({id:'old-live',last_seen:new Date(at-30*day).toISOString()}),row({id:'fresh',title:'Frontend Engineer',company:'Acme',jd_text:'Build React apps for customers'})]});
  const ids=async(options)=>(await indexed.search({limit:50,...options})).jobs.map(job=>job.url.split('/').pop()).sort();
  assert.deepEqual(await ids({}),['asap','fresh','old-campus','open'],'campus batches stay for the season; passed deadlines and stale live rows do not');
  assert.deepEqual(await ids({query:'前端'}),['asap','fresh','old-campus','open'],'two-character Chinese terms match through the bigram index, with aliases');
  assert.deepEqual(await ids({query:'组件'}),['asap','old-campus','open']);
  assert.deepEqual(await ids({query:'算法'}),['open']);
  assert.deepEqual(await ids({query:'frontend'}),['fresh']);
  assert.deepEqual(await ids({query:'岗'}),[],'a lone CJK character falls back to scanning');
  assert.deepEqual(await ids({query:'校'}),['old-campus']);
  assert.deepEqual(await ids({companyScale:'small_mid'}),['fresh','old-campus','open']);
  assert.deepEqual(await ids({companyScale:'large'}),['asap']);
  assert.equal((await indexed.search({query:'后台'})).jobs[0].largeCompany,true);
  // A database from before the index existed is indexed on first open.
  indexDb.exec("DELETE FROM job_knowledge_meta WHERE key='fts'; DROP TABLE job_knowledge_fts;");
  const reopened=createJobKnowledge(indexDb,{clock:()=>at,feeds,loader:async()=>{throw new Error('offline');}});
  assert.deepEqual((await reopened.search({query:'算法'})).jobs.map(job=>job.title),['嵌入式算法实习']);
  indexDb.close();
}
