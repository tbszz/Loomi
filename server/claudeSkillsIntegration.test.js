import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createClaudeAgentModel } from './claudeAgent.js';
import { runCareerAgent } from './careerAgent.js';
const scope={userId:'u',candidateId:'c',conversationId:'t'};
const fakeSdk=query=>({query,tool:(name,description,schema,handler)=>({name,handler}),createSdkMcpServer:value=>value});
await test('real slash request survives a synthetic user note after pre-analysis failure', async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'skill-request-'));
 try {
  const sdkModel=createClaudeAgentModel({apiKey:'test',sessionDirectory:directory},{sdk:fakeSdk(({prompt})=>(async function*(){
   const input=await prompt[Symbol.asyncIterator]().next();
   assert.match(JSON.stringify(input.value.message.content),/当前用户明确调用 \/jd-analysis/);
   yield {type:'result',subtype:'success',result:'unverified success'};
  })())});
  const model=async()=>{throw new Error('fixture pre-analysis failure');};
  model.runtime=sdkModel.runtime;
  model.runTools=async args=>{
   assert.equal(args.requestedSkill,'jd-analysis');
   assert.match(args.messages.at(-1).content,/材料分析暂未完成/);
   return sdkModel.runTools(args);
  };
  const conversation={id:'t',candidateId:'c',messages:[{role:'user',content:'/jd-analysis 分析岗位'}],context:{profile:{},material:'这是用户提供的真实项目材料，用于验证前置分析失败分支。'}};
  await assert.rejects(runCareerAgent({conversation,userId:'u',model,emit:()=>{},persist:()=>{}}),/未成功加载/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
await test('explicit slash Skill is actually loaded and failure can recover without a stale trace', async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'skill-slash-'));
 try {
  for(const results of [[false,true],[true,false]]) {
   const model=createClaudeAgentModel({apiKey:'test',sessionDirectory:directory},{sdk:fakeSdk(({prompt})=>(async function*(){
    const input=await prompt[Symbol.asyncIterator]().next();
    assert.match(JSON.stringify(input.value.message.content),/当前用户明确调用 \/jd-analysis/);
    for(const [index,failed] of results.entries()) {
      yield {type:'assistant',message:{content:[{type:'tool_use',id:`s${index}`,name:'Skill',input:{skill:'jd-analysis'}}]}};
      yield {type:'user',message:{content:[{type:'tool_result',tool_use_id:`s${index}`,is_error:failed,content:'fixture'}]}};
    }
    yield {type:'result',subtype:'success',result:'done'};
   })())});
   const turn=()=>model.runTools({messages:[{role:'user',content:'/jd-analysis 分析这个岗位'}],session:{scope}});
   if(results.at(-1)) await assert.rejects(turn(),/未成功加载/);
   else assert.deepEqual((await turn()).runtimeTrace.usedSkills,['jd-analysis']);
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
await test('latest MiniMax rate-limit response is truthful and a successful retry clears it',async()=>{
 for(const success of [false,true]){
  const model=createClaudeAgentModel({apiKey:'test',provider:'minimax',baseUrl:'https://api.minimaxi.com/anthropic'},{sdk:fakeSdk(()=>(async function*(){
   yield {type:'system',subtype:'api_retry',error_status:429};
   yield {type:'result',subtype:success?'success':'error_during_execution',is_error:!success,result:success?'done':undefined};
  })())});
  if(success) assert.equal((await model({messages:[]})).content[0].text,'done');
  else await assert.rejects(model({messages:[]}),/MiniMax.*HTTP 429/);
 }
});
await test('proxy transport configuration passes only allowlisted environment variables',async()=>{
 const prev=process.env.HTTPS_PROXY,secret=process.env.UNRELATED_SECRET;
 process.env.HTTPS_PROXY='http://127.0.0.1:7897';process.env.UNRELATED_SECRET='hidden';
 try{
  const model=createClaudeAgentModel({apiKey:'test'},{sdk:fakeSdk(({options})=>(async function*(){
   assert.equal(options.env.HTTPS_PROXY,'http://127.0.0.1:7897');assert.equal(options.env.UNRELATED_SECRET,undefined);
   yield {type:'result',subtype:'success',result:'done'};
  })())});await model({messages:[]});
 }finally{if(prev===undefined) delete process.env.HTTPS_PROXY;else process.env.HTTPS_PROXY=prev;if(secret===undefined) delete process.env.UNRELATED_SECRET;else process.env.UNRELATED_SECRET=secret;}
});
