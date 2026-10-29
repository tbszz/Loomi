import assert from "node:assert/strict";
import { test } from "node:test";
import { runCareerAgent as runAgent } from "./careerAgent.js";
import { compactJobCard, compactRejectedJob } from './jobDisclosure.js';
// Existing tool tests isolate execution from planning; the agent loop has no Brain gate.
const runCareerAgent = args => runAgent(args);
await test('first and follow-up visual reviews retain layout advice and validate page labels with image evidence', async () => {
  for (const previousAnalysis of [false,true]) {
    const image={type:'image',source:{type:'base64',media_type:'image/png',data:'fixture'}};
    const c={id:'pdf-advice',messages:[{role:'user',content:'检查简历布局'}],context:{profile:{},material:'测试候选人\n项目经历\n参与 React 表单开发并手动检查功能。',annotations:previousAnalysis?[{quote:'existing'}]:[]}};
    let audit = false;
    const model = async ({system,messages})=>{
      if(system.includes('简历修改建议编辑')) return {content:[{type:'text',text:'{"annotations":[]}'}]};
      assert(system.includes('事实审校员'));
      assert(messages[0].content.some(block=>block.type==='image'));
      audit=true;
      return {content:[{type:'text',text:'{"answer":"第2页顶部留白较多，建议收紧顶部间距。","questions":[]}'}]};
    };
    model.runTools=async()=>({content:[{type:'text',text:'第2页顶部留白较多，建议收紧顶部间距。'}]});
    await runAgent({conversation:c,model,emit:()=>{},persist:()=>{},readPdfPages:async()=>({pages:[{pageNumber:2,image}],totalPages:2,complete:false})});
    assert(audit);
    assert.match(c.messages.at(-1).content,/第2页顶部留白较多/);
  }
});
await test('primary Agent directly receives original PDF pages alongside the actual request', async () => {
  const image={type:'image',source:{type:'base64',media_type:'image/png',data:'fixture'}};
  const c={id:'pdf-view',messages:[{role:'user',content:'看看简历布局'}],context:{annotations:[{quote:'existing'}]}};
  await runAgent({conversation:c,emit:()=>{},persist:()=>{},readPdfPages:async()=>({documentId:'own-doc',pages:[{pageNumber:1,image}],totalPages:2,complete:false}),model:{runTools:async({messages,system})=>{
    assert(messages.at(-1).content.some(block=>block.type==='image'));
    assert(messages.at(-1).content.some(block=>block.text==='看看简历布局'));
    assert.match(system,/"complete":false/);
    return {content:[{type:'text',text:'仅查看第1页，建议缩小该页顶部留白。'}]};
  }}});
  assert.equal(c.context.pdfLayout.status,'provided');
  assert(!JSON.stringify(c).includes('base64'));
});
await test('PDF extraction order is explicitly unverified layout evidence in analysis and primary requests', async () => {
  let analyzed = false;
  const model = async ({messages}) => {
    const input = JSON.parse(messages[0].content);
    assert.equal(input.layoutEvidence.verified,false);
    assert.match(input.layoutEvidence.caution,/文本提取顺序不等于页面阅读顺序/);
    analyzed = true;
    return {content:[{type:'text',text:'{"annotations":[]}'}]};
  };
  model.runTools = async ({system}) => {
    assert.match(system,/排版与位置结论必须核对原页面图像/);
    return {content:[{type:'text',text:'尚未核对原页面布局。'}]};
  };
  const c = {id:'pdf-order',messages:[{role:'user',content:'分析简历'}],context:{profile:{},material:'实习经历\n项目经历\n课程项目：参与开发网页表单并执行手动验证。\n荣誉奖项\n实习：参与功能测试。'}};
  await runAgent({conversation:c,model,emit:()=>{},persist:()=>{}});
  assert(analyzed);
});
await test('document rereads forward model activity to the primary runtime', async () => {
  let activity = 0;
  const model = {runTools:async args=>{
    await args.execute('read_document',{}, {onProgress:()=>activity++});
    return {content:[{type:'text',text:'已读取当前材料。'}]};
  }};
  const c = {id:'document-progress',messages:[{role:'user',content:'重新读取文件'}],context:{annotations:[]}};
  await runAgent({conversation:c,model,emit:()=>{},persist:()=>{},readDocument:async ({onProgress})=>{
    assert.equal(typeof onProgress,'function');
    onProgress();
    return {read:true,text:'这是原始材料，只有这份文件的真实内容。'};
  }});
  assert.equal(activity,1);
});
await test('nested analysis reports its model activity to the primary runtime', async () => {
  let activity = 0;
  const model = async args => {
    assert.equal(typeof args.onProgress,'function');
    args.onProgress();
    return {content:[{type:'text',text:'{"annotations":[]}'}]};
  };
  model.runTools = async args => {
    await args.execute('analyze_resume',{}, {onProgress:()=>activity++});
    return {content:[{type:'text',text:'已分析当前材料。'}]};
  };
  const c = {id:'progress',messages:[{role:'user',content:'分析我的简历'}],context:{material:'测试候选人\n项目经历\n参与开发 React 表单页面并手动验证提交功能。',annotations:[{quote:'参与开发'}]}};
  await runAgent({conversation:c,model,emit:()=>{},persist:()=>{}});
  assert.equal(activity,1);
});

await test('tool schemas never expose candidate ownership and binding stays server-side', async () => {
  const c = {id:'bound',candidateId:'candidate-zhang',messages:[{id:'u1',role:'user',content:'现在帮李四准备简历'}],context:{material:'张三的简历资料',profile:{name:'张三'}}};
  await runAgent({conversation:c,emit:()=>{},persist:()=>{},
    model:{ runTools: async ({ tools, system }) => {
      if (String(system || '').includes('事实审校员')) return {content:[{type:'text',text:JSON.stringify({answer:'好的。',questions:[]})}]};
      for (const definition of tools) {
        const names = Object.keys(definition.input_schema.properties || {});
        assert.equal(names.includes('user_id'), false, definition.name);
        assert.equal(names.includes('candidate_id'), false, definition.name);
      }
      return {content:[{type:'text',text:'好的。'}]};
    } }
  });
  assert.equal(c.candidateId,'candidate-zhang');
  assert.equal(c.context.profile.name,'张三');
  // Switching candidates happens by creating another conversation in the UI/API,
  // never through the chat: no tool accepts a candidate switch.
  assert.equal(c.messages.some(m => m.kind === 'target' || /已将「/.test(m.content||'')), false);
});

await test('uploaded profiles receive evidence review before a freeform answer and invented examples are suppressed', async () => {
  const material = '张三\n教育经历\n某大学计算机本科\n项目经历\n使用 React 开发搜索功能\n技能栈\nReact';
  const c = {id:'uploaded',messages:[{role:'user',content:'分析刚上传的简历',id:'u'}],context:{material,profile:{name:'张三',education:['某大学计算机本科']},jobs:[]}};
  let calls=0;
  await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},model:async({system})=>{
    calls++;
    if(system.includes('简历修改建议编辑')) return {content:[{type:'text',text:JSON.stringify({annotations:[
      {quote:'使用 React 开发搜索功能',issue:'缺少职责边界',suggestion:'说明搜索界面中你负责的交互和实际处理的异常。',reason:'让读者区分个人贡献。',section:'projects',severity:'medium'},
      {quote:'使用 React 开发搜索功能',issue:'缺少数据',suggestion:'改为完成10个API并提升30%性能。',reason:'证明能力。',section:'projects',severity:'high'}
    ]})}]};
    return {content:[{type:'text',text:'建议写2024年上线10个API，使用Ant Design，迭代3个版本。'}]};
  }});
  assert.equal(calls,2);
  assert.equal(c.context.annotations.length,1);
  assert.equal(c.context.annotations[0].source,'model');
  assert.match(c.messages.at(-1).content,/你负责的交互/);
  assert.doesNotMatch(c.messages.at(-1).content,/10个API|30%|Ant Design|2024/);
});

const conversation = () => ({ id: "c1", messages: [{ role: "user", content: "帮我分析简历", id: "u1" }], context: { material: "张三\n教育经历\n某大学计算机本科\n项目经历\n使用 React 完成求职系统\n技能栈\nReact TypeScript", jobs: [] } });
await test("model requests tool, receives its result, and finishes a real response", async () => {
  const c = conversation();
  const events = [];
  let calls = 0;
  await runCareerAgent({ conversation: c, emit: (type, data) => events.push({ type, data }), persist: () => {},
    model: async ({ messages }) => {
      calls++;
      if (calls === 1) return { content: [{ type: "tool_use", id: "tool1", name: "analyze_resume", input: {} }], stop_reason: "tool_use" };
      if (calls === 2) return { content: [{ type: "text", text: JSON.stringify({ annotations: [
        { id: "a1", quote: "使用 React 完成求职系统", issue: "项目缺少结果", suggestion: "补充真实结果", reason: "便于核验", section: "projects", severity: "medium" }
      ] }) }], stop_reason: "end_turn" };
      assert.equal(messages.at(-1).content[0].type, "tool_result");
      assert.equal(messages.at(-1).content[0].tool_use_id, "tool1");
      assert.ok(JSON.parse(messages.at(-1).content[0].content).profile);
      return { content: [{ type: "text", text: "你的项目缺少可核对的成果，请补充实际指标。" }], stop_reason: "end_turn" };
    }
  });
  assert.equal(calls, 3);
  assert.ok(c.context.profile);
  assert.match(c.messages.at(-1).content, /原文：使用 React 完成求职系统/);
  assert.match(c.messages.at(-1).content, /建议：补充真实结果/);
  assert.ok(events.some(e => e.type === "status" && e.data.tool === "analyze_resume"));
});
await test("unknown tool is returned as an error without executing arbitrary actions", async () => {
  let calls = 0;
  await runCareerAgent({ conversation: conversation(), persist: () => {}, emit: () => {}, model: async ({ messages }) => {
    if (++calls === 1) return { content: [{ type: "tool_use", id: "t", name: "run_shell", input: { command: "anything" } }] };
    assert.equal(messages.at(-1).content[0].is_error, true);
    return { content: [{ type: "text", text: "请提供简历资料。" }] };
  } });
});
await test("loop is bounded", async () => {
  await assert.rejects(runCareerAgent({ conversation: conversation(), emit: () => {}, persist: () => {}, model: async () => ({content: [{type:"tool_use",id:"t",name:"unknown",input:{}}]}) }), /工具调用次数/);
});
await test("provider failure does not masquerade as local AI success", async () => {
  await assert.rejects(runCareerAgent({ conversation: conversation(), emit: () => {}, persist: () => {}, model: async () => {throw new Error("provider unavailable");} }), /provider unavailable/);
});
await test("generate resume keeps audited empty fields and uses JD title", async () => {
  const jd = "前端开发工程师（校招）\n岗位职责：负责React与TypeScript业务页面开发，配合后端进行接口联调。\n任职要求：计算机相关本科，掌握React、TypeScript和Git。";
  const c = {
    id: "c2",
    candidateId: 'candidate-test',
    messages: [{ role: "user", content: `${conversation().context.material}\n\n${jd}\n请生成完整岗位版简历。`, id: "u1" }],
    context: { material: conversation().context.material, jobs: [], uploadStatus:{status:"needs_review",extraction:{status:"partial"}} }
  };
  const events = [];
  let calls = 0;

  await runCareerAgent({
    conversation: c,
    emit: (type, data) => events.push({ type, data }),
    persist: () => {},
    saveTargetJob: async job => ({ ...job, id: 'target-test' }),
    saveResumeVariant: async variant => ({ ...variant, variantId: 'variant-test' }),
    retrieveCandidateKnowledge: async ({ query }) => ({ query, facts: [
      { factId: 'name', type: 'identity', value: '张三', sourceQuote: '张三', status: 'verified' },
      { factId: 'edu', type: 'education', value: '某大学计算机本科', sourceQuote: '某大学计算机本科', status: 'verified' },
      { factId: 'project', type: 'project', value: '使用 React 完成求职系统', sourceQuote: '使用 React 完成求职系统', status: 'verified' },
      { factId: 'skills', type: 'skill', value: 'React TypeScript', sourceQuote: 'React TypeScript', status: 'verified' }
    ], passages: [] }),
    model: async ({ system, messages }) => {
      calls++;
      if (calls === 1) {
        return {
          content: [
            { type: "tool_use", id: "analyze", name: "analyze_resume", input: {} },
            { type: "tool_use", id: "select", name: "select_job", input: { description: jd, title: "前端开发工程师（校招）", role: "frontend" } },
            { type: "tool_use", id: "generate", name: "generate_resume", input: { role: "frontend" } }
          ],
          stop_reason: "tool_use"
        };
      }
      if (calls === 2) {
        assert.match(system, /简历修改建议编辑/);
        return { content: [{ type: "text", text: JSON.stringify({ annotations: [
          { id: "a1", quote: "使用 React 完成求职系统", issue: "项目缺少结果", suggestion: "补充真实结果", reason: "便于核验", section: "projects", severity: "medium" }
        ] }) }], stop_reason: "end_turn" };
      }
      if (calls === 3) {
        assert.match(system, /中文简历编辑/);
        const request = JSON.parse(messages.at(-1).content);
        assert.equal(request.target.title, "前端开发工程师（校招）");
        return { content: [{ type: "text", text: JSON.stringify({
          name: "张三",
          targetTitle: "前端开发工程师（校招）",
          contact: {},
          summary: "熟悉React和TypeScript。",
          education: ["某大学计算机本科"],
          skills: ["React", "TypeScript"],
          projects: ["使用 React 完成求职系统"],
          experience: ["前端实习：参与样式调优"],
          awards: ["校级奖学金"],
          gaps: []
        }) }], stop_reason: "end_turn" };
      }
      if (calls === 4) {
        assert.match(system, /简历事实审校员/);
        const request = JSON.parse(messages.at(-1).content);
        assert.equal(request.draft.summary.includes("熟悉React"), true);
        return { content: [{ type: "text", text: JSON.stringify({
          name: "张三",
          targetTitle: "前端开发工程师（校招）",
          contact: {},
          summary: "",
          education: ["某大学计算机本科"],
          skills: ["React", "TypeScript"],
          projects: ["使用 React 完成求职系统"],
          experience: [],
          awards: [],
          gaps: ["缺少可证实摘要", "缺少可证实实习经历", "缺少奖项"]
        }) }], stop_reason: "end_turn" };
      }

      assert.equal(messages.at(-1).role, "user");
      const toolResults = messages.at(-1).content;
      assert.equal(toolResults.length, 3);
      assert.equal(toolResults.every((item) => item.type === "tool_result" && !item.is_error), true, JSON.stringify(toolResults));
      return { content: [{ type: "text", text: "岗位版简历已生成。" }], stop_reason: "end_turn" };
    }
  });

  assert.equal(calls, 5);
  assert.equal(c.context.variant.title, "前端开发工程师（校招）");
  assert.equal(c.context.variant.targetTitle, "前端开发工程师（校招）");
  assert.match(c.context.variant.sourceNotice, /已识别页面/);
  assert.match(c.messages.at(-1).content, /已识别页面/);
  assert.equal(c.context.variant.summary, "");
  assert.deepEqual(c.context.variant.experience, []);
  assert.deepEqual(c.context.variant.awards, []);
  assert.equal(c.context.formalResume, c.context.variant);
  assert.ok(events.some(e => e.type === "message" && e.data.kind === "resume"));
});
await test("search jobs keeps unverified jobs listed with their verify label and separates only explicit mismatches", async () => {
  const c = conversation();
  c.context.material += ' Git';
  c.messages = [{ role: "user", content: "国内海外均可，帮我找前端校招岗位", id: "u1" }];
  c.context.profile = {
    education: ["某大学计算机本科"],
    skills: ["React", "TypeScript", "Git"],
    projects: ["使用 React 完成求职系统"],
    experience: []
  };
  const events = [];
  let calls = 0;

  await runCareerAgent({
    conversation: c,
    emit: (type, data) => events.push({ type, data }),
    persist: () => {},
    search: async () => ({
      sources: [{ id: "snapshot", ok: true }],
      jobs: [
        { id: "phd", title: "Machine Learning PhD Intern", description: "PhD required.", requirements: ["PhD"], type: "internship", location: "United States", matchScore: 99 },
        { id: "auth", title: "Frontend New Grad", description: "US work authorization required.", requirements: ["React"], type: "campus", location: "United States", postingAge: "1d", matchScore: 95 },
        { id: "react", title: "前端开发工程师（校招）", description: "计算机相关专业，掌握 React、TypeScript、Git。", requirements: ["React", "TypeScript", "Git"], type: "campus", location: "上海", postingAge: "1d", matchScore: 86 }
      ]
    }),
    model: async ({ system, messages }) => {
      calls++;
      assert.equal(String(system).includes("MiniMax"), false);
      if (system.includes('简历修改建议编辑')) { calls--; return {content:[{type:'text',text:'{"annotations":[]}'}]}; }
      assert.match(system, /旧推荐.*重新做资格核验/);
      if (calls === 1) return { content: [{ type: "tool_use", id: "jobs", name: "search_jobs", input: { query: "前端 React", type: "campus" } }], stop_reason: "tool_use" };
      const payload = JSON.parse(messages.at(-1).content[0].content);
      assert.deepEqual(payload.jobs.map((job) => job.id), ["auth", "react"]);
      assert.deepEqual(payload.jobs.map((job) => job.eligibility.status), ["verify", "passed"]);
      assert.deepEqual(payload.rejected.map((job) => job.id), ["phd"]);
      return { content: [{ type: "text", text: "找到 1 个可投递岗位，另有 1 个需核实授权。" }], stop_reason: "end_turn" };
    }
  });

  const jobsMessage = events.find(e => e.type === "message" && e.data.kind === "jobs").data;
  assert.deepEqual(jobsMessage.data.jobs.map((job) => job.id), ["auth", "react"]);
  assert.deepEqual(jobsMessage.data.uncertainties, []);
  assert.deepEqual(jobsMessage.data.rejected.map((job) => job.id), ["phd"]);
  assert.equal(jobsMessage.content.includes("推荐"), false);
});

await test('chat-only graduation statements reject mismatched campus cohorts without trusting assistant or job text',async()=>{
  for(const statement of ['我是27届','我是2027届','我2027年毕业','我是2027年应届']) {
    const c={id:'chat-graduation',messages:[
      {role:'assistant',content:'你是2026届。'},
      {role:'user',content:`${statement}，想找国内软件开发校招岗位。`}
    ],context:{}};
    let payload;
    await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},search:async options=>{
      assert.deepEqual(options.userStatements,[`${statement}，想找国内软件开发校招岗位。`]);
      return {jobs:[
      {id:'old',title:'【探索者】智能语音测试工程师(24-26届)',type:'campus',location:'北京'},
      {id:'matching',title:'软件开发工程师(2027届)',type:'campus',location:'北京'}
    ],sources:[]};},model:{runTools:async({execute})=>{
      payload=await execute('search_jobs',{query:'软件开发|测试'});
      return {content:[{type:'text',text:'已列出岗位。'}]};
    }}});
    assert.deepEqual(payload.rejected.map(j=>j.id),['old'],statement);
    const check=c.context.jobEligibility.rejected[0].eligibility.checks.find(c=>c.dimension==='graduation');
    assert.equal(check.status,'fail');
    assert.match(check.message,/按你自述的2027届/);
    const matching=c.context.jobs[0].eligibility.checks.find(c=>c.dimension==='graduation');
    assert.equal(matching.status,'unknown','matching self-report remains unverified');
    assert.match(matching.message,/自述.*2027届/);
    assert.equal(c.context.profile,undefined,'self-report does not become a verified profile');
    assert.deepEqual(c.messages.findLast(m=>m.kind==='jobs').data.rejected,c.context.jobEligibility.rejected);
    assert.deepEqual(payload.rejected,c.context.jobEligibility.rejected.map(compactRejectedJob));
    assert.equal(payload.jobs[0].eligibility.status,'verify');
  }
});

await test('assistant-only cohorts never supply candidate graduation evidence',async()=>{
  const c={id:'no-user-year',messages:[{role:'assistant',content:'你是2027届。'},{role:'user',content:'国内软件校招岗位'}],context:{}};
  let payload;
  await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},search:async()=>({jobs:[{id:'old',title:'测试工程师(24-26届)',type:'campus',location:'北京'}],sources:[]}),model:{runTools:async({execute})=>{
    payload=await execute('search_jobs',{query:'测试'});
    return {content:[{type:'text',text:'已列出岗位。'}]};
  }}});
  assert.equal(payload.rejected.length,0);
  assert.equal(c.context.jobs[0].eligibility.checks.find(c=>c.dimension==='graduation').status,'unknown');
  assert.equal(payload.jobs[0].eligibility.status,'verify');
});

await test('search_jobs reuses bound candidate education facts and preserves self-reported provenance',async()=>{
  for(const status of ['verified','user_asserted']) {
    const c={id:'kb-graduation',candidateId:'own-candidate',messages:[{role:'user',content:'国内软件校招岗位'}],context:{}};
    const requests=[];
    let payload;
    await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},retrieveCandidateKnowledge:async request=>{
      requests.push(request);
      return {query:request.query,facts:[{factId:'edu',type:'education',value:'某大学 本科 2023-2027',sourceQuote:'某大学 本科 2023-2027',status}],passages:[]};
    },search:async()=>({jobs:[{id:'old',title:'测试工程师(24-26届)',type:'campus',location:'北京'},{id:'matching',title:'开发工程师(2027届)',type:'campus',location:'北京'}],sources:[]}),model:{runTools:async({execute})=>{
      payload=await execute('search_jobs',{query:'开发|测试'});
      return {content:[{type:'text',text:'已列出岗位。'}]};
    }}});
    assert.equal(requests.length,1);
    assert.equal(requests[0].candidateId,'own-candidate');
    assert.equal(requests[0].type,'education');
    assert.deepEqual(payload.rejected.map(j=>j.id),['old']);
    assert.equal(c.context.jobs[0].eligibility.checks.find(c=>c.dimension==='graduation').status,status==='verified'?'pass':'unknown');
    assert.equal(payload.jobs[0].eligibility.status,c.context.jobs[0].eligibility.status);
    assert.ok(c.context.candidateRetrieval.factIds.includes('edu'));
  }
});

await test('search_jobs preserves retrieval order across eligibility scores and passes match strength to both outputs',async()=>{
  const c=conversation();
  c.context.profile={education:['某大学计算机本科'],skills:['React'],experience:[]};
  c.messages=[{role:'user',content:'国内前端校招岗位'}];
  const base={title:'前端工程师',company:'合成企业',type:'campus',location:'上海',source:'official-career-site',fullDescriptionVerified:true,description:'负责React页面开发。',requirements:['掌握React'],officialListingVerifiedAt:Date.now(),retrievalMatch:'title'};
  const rows=[{...base,id:'related-passed',retrievalMatch:'description'},{...base,id:'verify',fullDescriptionVerified:false},{...base,id:'passed-low',matchScore:10},{...base,id:'rejected',requirements:['博士学历']},{...base,id:'related-verify',retrievalMatch:'mention',fullDescriptionVerified:false},{...base,id:'passed-high',matchScore:99},{...base,id:'rejected-mention',retrievalMatch:'mention',requirements:['博士学历']}];
  let payload;
  await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},search:async()=>({jobs:rows,sources:[]}),model:{runTools:async({execute})=>{
    payload=await execute('search_jobs',{query:'前端'});
    return {content:[{type:'text',text:'已列出岗位。'}]};
  }}});
  assert.deepEqual(payload.jobs.map(j=>j.id),['verify','passed-low','passed-high']);
  assert.deepEqual(payload.jobs.map(j=>j.eligibility.status),['verify','passed','passed']);
  assert.deepEqual(payload.related.map(j=>j.id),['related-passed','related-verify']);
  assert.deepEqual(payload.related.map(j=>j.eligibility.status),['passed','verify']);
  assert.deepEqual(payload.rejected.map(j=>j.id),['rejected','rejected-mention']);
  const message=c.messages.findLast(m=>m.kind==='jobs');
  assert.deepEqual(message.data.jobs,c.context.jobs);
  assert.deepEqual(message.data.related,c.context.jobEligibility.related);
  assert.deepEqual(message.data.jobs.map(compactJobCard),payload.jobs);
  assert.deepEqual(message.data.related.map(compactJobCard),payload.related);
  assert.ok(message.data.jobs.every(j=>j.retrievalMatch==='title'));
  assert.match(message.content,/其中 3 个岗位标题匹配查询方向/);
  assert.match(message.content,/2 个硬性条件已核验通过，1 个要求未读取或部分条件待核实/);
  assert.match(message.content,/相关组 2 个岗位/);
});

await test('search_jobs separates description and mention references in retrieval order in both outputs',async()=>{
  for(const strengths of [['title'],['title','description'],['title','mention'],['mention','title','description','title','mention'],['description','mention'],['title','rejected-description'],[]]) {
    const c=conversation();
    c.context.profile={education:['某大学计算机本科'],skills:['React'],experience:[]};
    c.messages=[{role:'user',content:'国内前端校招岗位'}];
    const rows=strengths.map((strength,i)=>({id:`row-${i}`,title:strength==='title'?'前端工程师':'软件工程师',type:'campus',location:'上海',description:'使用React参与前端开发。',requirements:strength==='rejected-description'?['博士学历']:['掌握React'],retrievalMatch:strength.replace('rejected-','')}));
    let payload;
    await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},search:async()=>({jobs:rows,sources:[]}),model:{runTools:async({execute})=>{
      payload=await execute('search_jobs',{query:'前端'});
      return {content:[{type:'text',text:'已列出岗位。'}]};
    }}});
    const message=c.messages.findLast(m=>m.kind==='jobs');
    const hasReferences=strengths.some(s=>['description','mention'].includes(s));
    const expectedJobs=rows.filter(j=>j.retrievalMatch==='title');
    const expectedRelated=rows.filter(j=>['description','mention'].includes(j.retrievalMatch) && !j.requirements.includes('博士学历'));
    assert.deepEqual(payload.jobs.map(j=>j.id),expectedJobs.map(j=>j.id));
    assert.deepEqual(payload.related.map(j=>j.id),expectedRelated.map(j=>j.id));
    assert.deepEqual(message.data.jobs,c.context.jobs);
    assert.deepEqual(message.data.related,c.context.jobEligibility.related);
    assert.deepEqual(message.data.jobs.map(compactJobCard),payload.jobs);
    assert.deepEqual(message.data.related.map(compactJobCard),payload.related);
    assert.deepEqual(c.context.jobs.map(compactJobCard),payload.jobs);
    assert.equal(/仅在正文中提及关键词/.test(message.content),hasReferences,JSON.stringify(strengths));
    if(hasReferences) assert.match(message.content,new RegExp(`相关组 ${expectedRelated.length} 个岗位仅在正文中提及关键词.*标题属于其他岗位.*仅供参考.*不作为查询方向的匹配或推荐`));
    assert.match(message.content,new RegExp(`其中 ${expectedJobs.length} 个岗位标题匹配查询方向`));
    assert.match(payload.note,/retrievalMatch/);
    assert.match(payload.note,/description.*mention.*不能.*匹配.*推荐/);
  }
});

await test('same-turn searches merge related rows without duplicates and keep each list in search order',async()=>{
  const c=conversation();
  c.messages=[{role:'user',content:'国内前端校招岗位'}];
  const row=(id,retrievalMatch)=>({id,retrievalMatch,title:retrievalMatch==='title'?'前端工程师':'软件工程师',type:'campus',location:'上海',description:'参与React前端页面开发。',requirements:['React']});
  const pages=[[row('related-1','description'),row('main-1','title'),row('related-2','mention')],[row('related-2','mention'),row('main-2','title'),row('related-3','description')]];
  let searches=0,payload;
  await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},search:async()=>({jobs:pages[searches++],sources:[]}),model:{runTools:async({execute})=>{
    await execute('search_jobs',{query:'前端'});
    payload=await execute('search_jobs',{query:'前端 React'});
    return {content:[{type:'text',text:'已列出岗位。'}]};
  }}});
  assert.deepEqual(payload.jobs.map(j=>j.id),['main-1','main-2']);
  assert.deepEqual(payload.related.map(j=>j.id),['related-1','related-2','related-3']);
  const messages=c.messages.filter(m=>m.kind==='jobs');
  assert.equal(messages.length,1);
  assert.deepEqual(messages[0].data.related,c.context.jobEligibility.related);
  assert.deepEqual(messages[0].data.related.map(compactJobCard),payload.related);
  assert.equal(messages[0].data.mergedSearches,2);
  assert.match(messages[0].content,/列出 2 个岗位/);
  assert.match(messages[0].content,/相关组 3 个岗位/);
});

await test('search_jobs without a query keeps unlabelled rows in the main list',async()=>{
  const c=conversation();
  c.messages=[{role:'user',content:'国内校招岗位'}];
  let payload;
  await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},search:async()=>({jobs:[{id:'no-query',title:'软件工程师',type:'campus',location:'上海',description:'参与React开发。',requirements:['React']}],sources:[]}),model:{runTools:async({execute})=>{
    payload=await execute('search_jobs',{});
    return {content:[{type:'text',text:'已列出岗位。'}]};
  }}});
  assert.deepEqual(payload.jobs.map(j=>j.id),['no-query']);
  assert.deepEqual(payload.related,[]);
});

await test("select_job accepts a pasted JD across whitespace differences and still rejects altered content", async () => {
  const pasted = "前端开发工程师（校招）\n职责：负责 React 前端页面开发\n要求：掌握 React、TypeScript";
  const run = async (descriptionInput) => {
    const c = { id: 'jd', candidateId: 'candidate-1', messages: [{ role: "user", content: `请把这个JD设为目标岗位：${pasted}`, id: "u1" }], context: {} };
    const events = [];
    let calls = 0;
    await runCareerAgent({
      conversation: c,
      emit: (type, data) => events.push({ type, data }),
      persist: () => {},
      saveTargetJob: async () => ({ id: "t1" }),
      model: async ({ system }) => {
        calls++;
        if (calls === 1) return { content: [{ type: "tool_use", id: "jd1", name: "select_job", input: { title: "前端开发工程师（校招）", description: descriptionInput } }], stop_reason: "tool_use" };
        if (String(system || '').includes('事实审校员')) return { content: [{ type: "text", text: JSON.stringify({ answer: '好的。', questions: [] }) }] };
        return { content: [{ type: "text", text: "已处理目标岗位请求。" }], stop_reason: "end_turn" };
      }
    });
    return { c, events };
  };

  const ok = await run("前端开发工程师（校招） 职责：负责 React 前端页面开发 要求：掌握 React、TypeScript");
  assert.equal(ok.c.context.selectedJob?.title, "前端开发工程师（校招）");
  assert.equal(ok.c.context.targetJobId, "t1");
  assert.ok(ok.events.some(e => e.type === "message" && e.data.kind === "target"));

  const altered = await run("前端开发工程师（校招） 职责：负责 React 前端页面开发 要求：掌握 Vue、TypeScript");
  const last = altered.c.messages.at(-1);
  assert.equal(last.role, "assistant");
  assert.match(String(last.content), /必须逐字来自用户本轮输入/);
});

await test("analyze resume emits source-quoted annotations without invented quotes", async () => {
  const c = conversation();
  const events = [];
  let calls = 0;

  await runCareerAgent({
    conversation: c,
    emit: (type, data) => events.push({ type, data }),
    persist: () => {},
    model: async ({ system, messages }) => {
      calls++;
      if (calls === 1) return { content: [{ type: "tool_use", id: "tool1", name: "analyze_resume", input: {} }], stop_reason: "tool_use" };
      if (calls === 2) {
        assert.match(system, /简历修改建议编辑/);
        return { content: [{ type: "text", text: JSON.stringify({ annotations: [
          { id: "a1", quote: "使用 React 完成求职系统", issue: "缺少真实成果", suggestion: "补充真实指标或反馈", reason: "用于岗位版简历事实审校", section: "projects", severity: "high" }
        ] }) }], stop_reason: "end_turn" };
      }
      const payload = JSON.parse(messages.at(-1).content[0].content);
      assert.ok(payload.annotations.length >= 1);
      assert.equal(payload.annotations.every((item) => c.context.material.includes(item.quote)), true);
      assert.equal(payload.annotations.every((item) => item.source === "model"), true);
      return { content: [{ type: "text", text: "已分析。" }], stop_reason: "end_turn" };
    }
  });

  const diagnosis = events.find(e => e.type === "message" && e.data.kind === "diagnosis").data;
  assert.ok(diagnosis.data.annotations.length >= 1);
  assert.equal(diagnosis.data.annotations.every((item) => c.context.material.includes(item.quote)), true);
  assert.deepEqual(Object.keys(diagnosis.data.annotations[0]).sort(), ["id", "issue", "quote", "reason", "section", "severity", "source", "suggestion"].sort());
  assert.equal(diagnosis.data.annotations[0].source, "model");
});
await test("analyze resume keeps parsed material when annotation model fails", async () => {
  const c = conversation();
  let calls = 0;

  await runCareerAgent({
    conversation: c,
    emit: () => {},
    persist: () => {},
    model: async ({ messages }) => {
      calls++;
      if (calls === 1) return { content: [{ type: "tool_use", id: "tool1", name: "analyze_resume", input: {} }], stop_reason: "tool_use" };
      if (calls === 2) throw new Error("annotation unavailable");
      const result = messages.at(-1).content[0];
      assert.equal(result.is_error, true);
      assert.match(JSON.parse(result.content).error, /annotation unavailable/);
      return { content: [{ type: "text", text: "建议生成失败，但材料已保存。" }], stop_reason: "end_turn" };
    }
  });

  assert.equal(c.context.material, conversation().context.material);
  assert.ok(c.context.profile);
});

await test("analyze resume falls back to rule annotations when model quotes cannot be located", async () => {
  const c = conversation();
  let calls = 0;

  await runCareerAgent({
    conversation: c,
    emit: () => {},
    persist: () => {},
    model: async () => {
      calls++;
      if (calls === 1) return { content: [{ type: "tool_use", id: "tool1", name: "analyze_resume", input: {} }], stop_reason: "tool_use" };
      if (calls === 2) return { content: [{ type: "text", text: JSON.stringify({ annotations: [
        { id: "bad", quote: "这是原文没有的项目成果", issue: "x", suggestion: "y", reason: "z", section: "projects", severity: "high" }
      ] }) }], stop_reason: "end_turn" };
      return { content: [{ type: "text", text: "已分析。" }], stop_reason: "end_turn" };
    }
  });

  assert.ok(c.context.annotations.length >= 1);
  assert.equal(c.context.annotations.every((item) => item.source === "rule"), true);
  assert.equal(c.context.annotations.every((item) => c.context.material.includes(item.quote)), true);
});

await test('later freeform advice is audited against original material', async () => {
  const c = conversation();
  c.context.profile = {name:'张三'};
  c.context.annotations = [{quote:'使用 React 完成求职系统'}];
  let calls = 0;
  await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},model:async({system})=>{
    calls++;
    if (system.includes('事实审校员')) return {content:[{type:'text',text:JSON.stringify({answer:'请补充搜索功能中你实际负责的交互和验收方式。'})}]};
    return {content:[{type:'text',text:'写完成10个接口，提升30%。'}]};
  }});
  assert.equal(calls,2);
  assert.match(c.messages.at(-1).content,/实际负责/);
  assert.doesNotMatch(c.messages.at(-1).content,/10|30/);
});

await test('invalid annotation JSON is repaired without bypassing source validation', async () => {
  const c=conversation(); c.context.profile={name:'张三'};
  let repaired=false;
  await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},model:async({system})=>{
    if(system.includes('简历修改建议编辑')) return {content:[{type:'text',text:'{"annotations":[invalid'}]};
    if(system.includes('只修复JSON格式')) { repaired=true; return {content:[{type:'text',text:JSON.stringify({annotations:[{quote:'使用React完成求职系统',issue:'缺少职责',suggestion:'说明实际负责的交互。',reason:'便于核实贡献。',section:'projects',severity:'medium'}]})}]}; }
    return {content:[{type:'text',text:'已完成'}]};
  }});
  assert.equal(repaired,true);
  assert.equal(c.context.annotations[0].quote,'使用 React 完成求职系统');
  assert.equal(c.context.annotations[0].source,'model');
});

await test('superficial model comments do not omit project and internship evidence checks', async () => {
  const c=conversation();
  c.context.material+='\n工作与实习经历\n某公司前端实习，参与后台表单组件开发和接口联调。';
  c.context.profile={name:'张三'};
  await runCareerAgent({conversation:c,emit:()=>{},persist:()=>{},model:async({system})=>{
    if(system.includes('简历修改建议编辑')) return {content:[{type:'text',text:JSON.stringify({annotations:[{quote:'某大学计算机本科',issue:'补充学校全称',suggestion:'填写真实全称。',reason:'核对资料。',section:'education',severity:'low'}]})}]};
    return {content:[{type:'text',text:'已完成'}]};
  }});
  for(const section of ['projects','experience']) {
    const a=c.context.annotations.find(a=>a.section===section);
    assert.equal(a.source,'rule');assert(c.context.material.includes(a.quote));
  }
  assert.match(c.messages.at(-1).content,/职责边界/);
});

const EVIDENCE_PACK = candidateId => ({
  candidate: { id: candidateId, name: '张三' },
  query: '项目',
  facts: [{ factId: 'fact-greensteps', type: 'project', value: 'GreenSteps 项目使用 React 开发', sourceQuote: 'GreenSteps 项目使用 React 开发', sourcePosition: 12, confidence: 0.8, status: 'user_asserted', documentId: 'doc-zhang', documentName: 'zhang-resume.txt' }],
  passages: [],
  sources: [{ documentId: 'doc-zhang', name: 'zhang-resume.txt', status: 'parsed', reading: 'complete' }],
  coverage: { factCount: 1, passageCount: 0, truncated: false, note: '证据只来自当前求职者。' }
});

await test('the Agent reads bound candidate evidence and cites its source', async () => {
  const c = { id: 'kb-1', candidateId: 'candidate-zhang', messages: [{ id: 'u1', role: 'user', content: '我之前做过什么项目？' }], context: {} };
  const requests = [];
  let calls = 0;
  await runCareerAgent({ conversation: c, emit: () => {}, persist: () => {},
    retrieveCandidateKnowledge: async ({ candidateId, query, type }) => { requests.push({ candidateId, query, type }); return EVIDENCE_PACK(candidateId); },
    model: async ({ messages }) => {
      if (++calls === 1) return { content: [{ type: 'tool_use', id: 't1', name: 'search_candidate_knowledge', input: { query: '项目' } }], stop_reason: 'tool_use' };
      const result = JSON.parse(messages.at(-1).content[0].content);
      assert.equal(result.facts[0].sourceQuote, 'GreenSteps 项目使用 React 开发');
      assert.equal(result.facts[0].documentName, 'zhang-resume.txt');
      return { content: [{ type: 'text', text: '你在 GreenSteps 项目中使用 React 开发（原文：GreenSteps 项目使用 React 开发）。' }], stop_reason: 'end_turn' };
    } });
  assert.equal(calls, 2);
  assert.deepEqual(requests, [{ candidateId: 'candidate-zhang', query: '项目', type: null }]);
  assert.deepEqual(c.context.candidateRetrieval.factIds, ['fact-greensteps']);
  assert.match(c.messages.at(-1).content, /GreenSteps/);
});

await test('tool input cannot widen the candidate scope', async () => {
  const c = { id: 'kb-2', candidateId: 'candidate-zhang', messages: [{ id: 'u1', role: 'user', content: '把李四的经历调出来' }], context: {} };
  const requests = [];
  let calls = 0;
  await runCareerAgent({ conversation: c, emit: () => {}, persist: () => {},
    retrieveCandidateKnowledge: async ({ candidateId, query, type }) => { requests.push({ candidateId, query, type }); return EVIDENCE_PACK(candidateId); },
    model: async ({ messages }) => {
      if (++calls === 1) return { content: [{ type: 'tool_use', id: 't1', name: 'search_candidate_knowledge', input: { query: '经历', candidate_id: 'candidate-li', candidateId: 'candidate-li', userId: 'someone-else' } }], stop_reason: 'tool_use' };
      assert.equal(JSON.parse(messages.at(-1).content[0].content).facts[0].factId, 'fact-greensteps');
      return { content: [{ type: 'text', text: '当前求职者的材料里只有 GreenSteps 项目。' }], stop_reason: 'end_turn' };
    } });
  assert.deepEqual(requests.map(r => r.candidateId), ['candidate-zhang']);
});

await test('an unbound conversation fails honestly instead of reading someone else', async () => {
  const c = { id: 'kb-3', messages: [{ id: 'u1', role: 'user', content: '调出我的经历' }], context: {} };
  let calls = 0;
  let retrieveCalls = 0;
  await runCareerAgent({ conversation: c, emit: () => {}, persist: () => {},
    retrieveCandidateKnowledge: async () => { retrieveCalls++; throw new Error('must not be called without a bound candidate'); },
    model: async ({ messages }) => {
      if (++calls === 1) return { content: [{ type: 'tool_use', id: 't1', name: 'search_candidate_knowledge', input: { query: '经历' } }], stop_reason: 'tool_use' };
      const block = messages.at(-1).content[0];
      assert.equal(block.is_error, true);
      assert.doesNotMatch(block.content, /must not be called/);
      return { content: [{ type: 'text', text: '这条会话还没有绑定求职者，请先选择或新建一位。' }], stop_reason: 'end_turn' };
    } });
  assert.equal(retrieveCalls, 0, 'an unbound conversation must not reach the knowledge base');
  assert.doesNotMatch(c.messages.at(-1).content, /已读取|已检索|已完成/);
});

// PRD 5.11 traces `retrieval_queries` and `retrieved_fact_ids` (both plural). One
// turn can ask about education, projects and skills at once, so the trace has to
// keep every read the Agent actually performed instead of only the final one.
await test('every candidate retrieval in one turn stays in the trace', async () => {
  const c = { id: 'kb-5', candidateId: 'candidate-zhang', messages: [{ id: 'u1', role: 'user', content: '我的教育经历、项目经历和技术栈分别是什么？' }], context: {} };
  const queries = [];
  const packFor = (candidateId, query) => ({
    candidate: { id: candidateId, name: '张三' },
    query,
    facts: [{ factId: `fact-${query}`, type: 'project', value: `${query} 对应的证据`, sourceQuote: `${query} 对应的证据`, sourcePosition: 0, confidence: 0.8, status: 'user_asserted', documentId: 'doc-zhang', documentName: 'zhang-resume.txt' }],
    passages: [],
    sources: [{ documentId: 'doc-zhang', name: 'zhang-resume.txt', status: 'parsed', reading: 'complete' }],
    coverage: { factCount: 1, passageCount: 0, truncated: false, note: '证据只来自当前求职者。' }
  });
  await runCareerAgent({ conversation: c, emit: () => {}, persist: () => {},
    retrieveCandidateKnowledge: async ({ candidateId, query }) => { queries.push(query); return packFor(candidateId, query); },
    model: async ({ messages }) => {
      const blocks = Array.isArray(messages.at(-1)?.content) ? messages.at(-1).content : [];
      const toolResults = blocks.filter(block => block.type === 'tool_result');
      if (!toolResults.length) {
        return { content: ['教育经历', '项目经历', '技能'].map((query, index) => ({ type: 'tool_use', id: `t${index}`, name: 'search_candidate_knowledge', input: { query } })), stop_reason: 'tool_use' };
      }
      assert.equal(toolResults.length, 3, 'all three reads must reach the model');
      return { content: [{ type: 'text', text: '三处证据都来自 zhang-resume.txt。' }], stop_reason: 'end_turn' };
    } });
  assert.deepEqual(queries, ['教育经历', '项目经历', '技能']);
  const trace = c.context.candidateRetrieval;
  assert.deepEqual(trace.queries, ['教育经历', '项目经历', '技能'], 'the trace must keep every retrieval query');
  assert.deepEqual(trace.factIds, ['fact-教育经历', 'fact-项目经历', 'fact-技能'], 'the trace must keep every retrieved fact id');
});

await test('candidate knowledge access comes from the conversation binding, not from a model decision', async () => {
  const c = { id: 'kb-4', candidateId: 'candidate-zhang', messages: [{ id: 'u1', role: 'user', content: '我做过什么项目？' }], context: {} };
  let calls = 0;
  await runAgent({ conversation: c, emit: () => {}, persist: () => {},
    retrieveCandidateKnowledge: async ({ candidateId }) => EVIDENCE_PACK(candidateId),
    model: async ({ messages }) => {
      if (++calls === 1) return { content: [{ type: 'tool_use', id: 't1', name: 'search_candidate_knowledge', input: { query: '项目' } }], stop_reason: 'tool_use' };
      assert.equal(JSON.parse(messages.at(-1).content[0].content).facts[0].factId, 'fact-greensteps');
      return { content: [{ type: 'text', text: '你在 GreenSteps 项目中使用 React 开发。' }], stop_reason: 'end_turn' };
    } });
  assert.equal(calls, 2);
});

await test("select_job reads the official JD for a searched listing and reports detail failures", async () => {
  const listing = { id: "gh-1", title: "Frontend Engineer", company: "Acme", description: "列表摘要", requirements: [], role: "frontend", source: "github-job-source", url: "https://job-boards.greenhouse.io/acme/jobs/1" };
  const run = async (enrichJob, job = listing) => {
    const c = { id: "detail", candidateId: "candidate-1", messages: [{ role: "user", content: "选这个岗位", id: "u1" }], context: { jobs: [job] } };
    const saved = [];
    let toolResult;
    await runCareerAgent({
      conversation: c, emit: () => {}, persist: () => {}, enrichJob,
      saveTargetJob: async (input) => { saved.push(input); return { id: "t1" }; },
      model: { runTools: async ({ execute }) => { toolResult = await execute("select_job", { job_id: job.id }); return { content: [{ type: "text", text: "已设为目标。" }] }; } }
    });
    return { c, saved, toolResult };
  };

  const full = { ...listing, description: "官方完整职责与要求", requirements: ["3+ years React"], fullDescriptionVerified: true };
  const verified = await run(async () => ({ status: "verified", job: full }));
  assert.equal(verified.toolResult.jdDetail, "verified");
  assert.deepEqual(verified.saved[0].requirements, ["3+ years React"]);
  assert.equal(verified.c.context.jobs[0].fullDescriptionVerified, true);
  assert(verified.c.messages.some(m => m.kind === "target" && /已从官方招聘页读取完整职责/.test(m.content)));

  const failed = await run(async () => ({ status: "failed", error: "detail_http_500", job: listing }));
  assert.equal(failed.toolResult.jdDetail, "failed");
  assert.equal(failed.saved[0].description, "列表摘要");
  assert(failed.c.messages.some(m => m.kind === "target" && /读取失败.*仍需核实/.test(m.content)));

  let called = false;
  const already = await run(async () => { called = true; return { status: "verified", job: full }; }, full);
  assert.equal(called, false);
  assert.equal(already.toolResult.jdDetail, undefined);
});
