import assert from 'node:assert/strict';
import {test} from 'node:test';
import {searchScope} from './careerPolicy.js';
import {evaluateJobEligibility} from './jobEligibility.js';
import {analyzeCompleteness} from './knowledgeBase.js';
import {runCareerAgent as runAgent} from './careerAgent.js';
const runCareerAgent = args => runAgent(args);
const user=content=>({role:'user',content});
assert.deepEqual(searchScope([user('帮我找工作')]),{region:null,type:null});
assert.deepEqual(searchScope([{role:'assistant',content:'国内实习'},user('帮我找工作')]),{region:null,type:null});
assert.deepEqual(searchScope([user('只考虑国内实习岗位')]),{region:'domestic',type:'internship'});
assert.deepEqual(searchScope([user('国内校招岗位'),user('不要校招，找实习')]),{region:'domestic',type:'internship'});
await test('searchScope prefers the requested campus jobs over internship background', () => {
  const message='我是2027届计算机科学与技术本科生（2023-2027），会Java、Spring Boot、MySQL、Redis，有3个月后端开发实习。帮我找国内后端开发的校招岗位。';
  assert.deepEqual(searchScope([user(message)]),{region:'domestic',type:'campus'});
});
await test('searchScope distinguishes requested types from experience mentions', () => {
  for (const [message,type] of [
    ['有实习经历，想找社招','social'],
    ['找实习','internship'],
    ['校招和实习都看看',null],
    ['我是校招生，推荐几个实习','internship'],
    ['我了解校招。搜索后端实习岗位','internship'],
    ['我了解校招；寻找后端实习岗位','internship'],
    ['我了解校招;看看后端实习岗位','internship'],
    ['有3个月后端开发实习',null],
    ['有实习经历',null],
    ['有实习经验',null],
    ['做过后端开发实习',null],
    ['在某公司实习过',null],
    ['找有实习经验要求的校招岗位','campus'],
    ['校招，做过后端实习','campus'],
    ['帮我投后端实习岗位','internship'],
    ['匹配几个校招岗位','campus'],
    ['在国内找实习','internship']
  ]) assert.equal(searchScope([user(message)]).type,type,message);
});
await test('searchScope preserves negations, later overrides and region preferences', () => {
  assert.deepEqual(searchScope([user('国内校招岗位'),user('有3个月后端开发实习')]),{region:'domestic',type:'campus'});
  assert.deepEqual(searchScope([user('国内实习岗位'),user('不看实习，推荐校招')]),{region:'domestic',type:'campus'});
  assert.equal(searchScope([user('校招岗位'),user('不要校招')]).type,null);
  assert.equal(searchScope([user('实习岗位'),user('不看实习')]).type,null);
  assert.deepEqual(searchScope([user('国内校招岗位'),user('找海外社招工作')]),{region:'overseas',type:'social'});
  assert.deepEqual(searchScope([user('地区不限，推荐几个实习')]),{region:'any',type:'internship'});
});
const profile={name:'测试',contact:{email:'x@example.com'},education:['某大学 计算机本科 2024–2028'],skills:['React'],projects:['React 搜索项目'],experience:[],awards:[],metrics:[]};
const job={title:'2026届前端校招',type:'campus',location:'上海',description:'计算机本科，React前端业务开发',postingAge:'1d'};
assert.equal(evaluateJobEligibility(job,profile,{type:'campus',region:'domestic'}).checks.find(c=>c.dimension==='graduation').status,'fail');
assert.equal(evaluateJobEligibility({...job,location:'United States'},profile,{region:'domestic'}).checks.find(c=>c.dimension==='region').status,'fail');
assert.equal(evaluateJobEligibility(job,profile,{type:'social'}).checks.find(c=>c.dimension==='job_type').status,'fail');
const diagnosis=analyzeCompleteness(profile);
assert(!diagnosis.missing.some(f=>['projects','skills','awards'].includes(f.id)));
const c={id:'policy',context:{},messages:[user('帮我推荐岗位')]};
await runCareerAgent({conversation:c,persist:()=>{},emit:()=>{},model:async()=>({content:[{type:'text',text:'最推荐微软博士实习：https://example.com/fake'}]})});
assert.doesNotMatch(c.messages.at(-1).content,/微软|example.com/);
assert.match(c.messages.at(-1).content,/国内.*海外/);
let searched=false;
const c2={id:'scope',context:{},messages:[user('帮我找工作')]};
let calls=0;
await runCareerAgent({conversation:c2,persist:()=>{},emit:()=>{},search:async()=>{searched=true;return {jobs:[]}},model:async()=> ++calls===1?{content:[{type:'tool_use',id:'s',name:'search_jobs',input:{query:'AI',type:'campus'}}]}:{content:[{type:'text',text:'已推荐'}]}});
assert.equal(searched,false);
console.log('Career SOP regressions passed: scope, cohort, region, type, completeness, fabricated recommendations');
