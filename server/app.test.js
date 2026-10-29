import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderResume } from "./resumeExport.js";
import { createApp } from "./app.js";
import { createDatabase } from "./database.js";

const directory = mkdtempSync(path.join(tmpdir(), "resume-api-"));
const database = createDatabase({ filename: path.join(directory, "app.sqlite") });
let visionCalls = 0;
const recognizedText = "张三\n教育经历\n测试大学市场营销本科\n工作经历\n门店服务与客户接待\n技能\n客户沟通";
// Deterministic trigger for the Candidate KB tool. Only the Agent turn reacts to it:
// the Brain and the fact-checker keep their own branches.
const EVIDENCE_PROBE = "RB-EVIDENCE-PROBE";
// Second deterministic trigger: one question that needs three different kinds of
// fact, which forces the real chain to run more than once in a single turn.
const EVIDENCE_PROBE_ALL = "RB-EVIDENCE-PROBE-ALL";
// Kept as a constant so grounding can be checked against the exact uploaded text.
const ZHANG_RESUME_TEXT = '张三\n教育经历\n郑州轻工业大学计算机本科\n项目经历\nGreenSteps 项目使用 React 开发\n技能\nReact';
const model = async ({ system, messages }) => {
  if (system.includes('求职 Agent')) messages = messages.map(message=>({...message,content:Array.isArray(message.content) && message.content.some(block=>block.type==='image') ? message.content.filter(block=>block.type==='text').map(block=>block.text).join('\n') : message.content}));
  if (system.includes('OCR转录器') && messages?.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image'))) {
    visionCalls++;
    return {content:[{type:'text',text:JSON.stringify({text:recognizedText})}]};
  }
  if (system.includes('求职 Agent') && (messages?.some(m => typeof m?.content === 'string' && m.content.includes(EVIDENCE_PROBE_ALL)) || messages?.some(m => typeof m?.content === 'string' && m.content.includes(EVIDENCE_PROBE)))) {
    const wantsAll = messages.some(m => typeof m?.content === 'string' && m.content.includes(EVIDENCE_PROBE_ALL));
    const toolResults = (Array.isArray(messages.at(-1)?.content) ? messages.at(-1).content : []).filter(block => block.type === 'tool_result');
    if (toolResults.length) {
      const packs = toolResults.map(block => JSON.parse(block.content));
      const facts = packs.flatMap(pack => pack.facts || []);
      return {content:[{type:'text',text:`已核对当前求职者证据：${facts.map(fact => `${fact.value}｜${fact.documentName}`).join('；') || packs[0].coverage.note}`}]};
    }
    const queries = wantsAll ? ['我的教育经历', '我的项目经历', '我的技能'] : ['React'];
    return {content:queries.map((query, index) => ({type:'tool_use',id:`probe-${index}`,name:'search_candidate_knowledge',input:{query}})),stop_reason:'tool_use'};
  }
  if (system.includes('求职建议事实审校员')) return {content:[{type:'text',text:JSON.stringify({answer:'已读取简历原文。',questions:[]})}]};
  const dialogue = (messages || []).filter(m => m.role === 'user' && typeof m.content === 'string');
  const lastUser = dialogue.at(-1) || '';
  if (system.includes('求职 Agent') && /重新读取已上传PDF/.test(lastUser.content || '')) {
    const toolResults = (Array.isArray(messages.at(-1)?.content) ? messages.at(-1).content : []).filter(block => block.type === 'tool_result');
    if (toolResults.length) return {content:[{type:'text',text:'已重新读取上传的PDF并恢复原文。'}]};
    return {content:[{type:'tool_use',id:'reread-1',name:'read_document',input:{}}],stop_reason:'tool_use'};
  }
  return { content: [{ type: "text", text: "我会根据你的真实项目帮助你准备面试。" }] };
};
const app = createApp({ database, model, dataDir: directory });
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const request = (url, cookie, options = {}) => fetch(base + url, { ...options, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
try {
  assert.equal((await request("/api/conversations")).status, 401);
  assert.equal((await request('/api/skills')).status, 401);
  const previousEnv = {
    runtime: process.env.RESUME_PROTOCOL_AGENT_RUNTIME,
    anthropic: process.env.ANTHROPIC_API_KEY,
    minimax: process.env.MINIMAX_API_KEY
  };
  process.env.RESUME_PROTOCOL_AGENT_RUNTIME = "claude";
  process.env.ANTHROPIC_API_KEY = "health-test-key";
  delete process.env.MINIMAX_API_KEY;
  const health = await (await request("/api/health")).json();
  assert.equal(health.ai.configured, true);
  assert.equal(health.ai.runtime, "claude-agent-sdk");
  assert.equal(JSON.stringify(health).includes("health-test-key"), false);
  for (const [name, value] of Object.entries(previousEnv)) {
    const key = { runtime: "RESUME_PROTOCOL_AGENT_RUNTIME", anthropic: "ANTHROPIC_API_KEY", minimax: "MINIMAX_API_KEY" }[name];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const register = async email => {
    const response = await request("/api/auth/register", null, {method:"POST", body:JSON.stringify({email,name:"测试用户",password:"A-secure-passphrase-42"})});
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const one = await register("one@example.com");
  const two = await register("two@example.com");
  // A first-time user chats and uploads without creating or picking a candidate.
  const fresh = await register("fresh@example.com");
  const freshFirst = (await (await request('/api/conversations', fresh, {method:'POST',body:'{}'})).json()).conversation;
  const freshSecond = (await (await request('/api/conversations', fresh, {method:'POST',body:'{}'})).json()).conversation;
  assert.ok(freshFirst.candidateId);
  assert.equal(freshSecond.candidateId, freshFirst.candidateId);
  assert.deepEqual((await (await request('/api/candidates', fresh)).json()).candidates.map(c => c.name), ['未命名求职者']);
  const freshUpload = new FormData();
  freshUpload.append('file', new Blob([ZHANG_RESUME_TEXT], {type:'text/plain'}), 'resume.txt');
  assert.equal((await fetch(`${base}/api/conversations/${freshFirst.id}/documents`,{method:'POST',headers:{Cookie:fresh},body:freshUpload})).status, 200);
  assert.deepEqual((await (await request('/api/candidates', fresh)).json()).candidates.map(c => c.name), ['张三']);
  const skillCatalog = await (await request('/api/skills', one)).json();
  assert.deepEqual(skillCatalog.skills.map(skill => skill.name), ['resume-analysis', 'jd-analysis', 'resume-tailoring', 'interview-prep', 'resume-layout']);
  assert.ok(skillCatalog.skills.every(skill => skill.label && skill.description));
  const zhang = (await (await request('/api/candidates', one, {method:'POST',body:JSON.stringify({name:'张三'})})).json()).candidate;
  const li = (await (await request('/api/candidates', one, {method:'POST',body:JSON.stringify({name:'李四'})})).json()).candidate;
  assert.equal((await request('/api/conversations', two, {method:'POST',body:JSON.stringify({candidateId:zhang.id})})).status, 404);
  const zhangFirst = (await (await request('/api/conversations', one, {method:'POST',body:JSON.stringify({candidateId:zhang.id})})).json()).conversation;
  const zhangSecond = (await (await request('/api/conversations', one, {method:'POST',body:JSON.stringify({candidateId:zhang.id})})).json()).conversation;
  const liConversation = (await (await request('/api/conversations', one, {method:'POST',body:JSON.stringify({candidateId:li.id})})).json()).conversation;
  assert.equal(zhangSecond.candidateId, zhang.id);
  assert.equal(liConversation.candidateId, li.id);
  assert.throws(() => database.saveConversation(database.getUserByEmail('one@example.com').id, {...zhangFirst,candidateId:li.id}), /不能切换求职者/);
  const candidateUpload = new FormData();
  candidateUpload.append('file', new Blob([ZHANG_RESUME_TEXT], {type:'text/plain'}), 'zhang-resume.txt');
  const candidateUploadResult = await fetch(`${base}/api/conversations/${zhangFirst.id}/documents`,{method:'POST',headers:{Cookie:one},body:candidateUpload});
  assert.equal(candidateUploadResult.status, 200);
  const candidateDocument = (await candidateUploadResult.json()).document;
  const zhangDocuments = await (await request(`/api/candidates/${zhang.id}/documents`, one)).json();
  assert.ok(zhangDocuments.documents.some(item => item.id === candidateDocument.id));
  assert.deepEqual((await (await request(`/api/candidates/${li.id}/documents`, one)).json()).documents, []);
  assert.equal((await request(`/api/candidates/${zhang.id}/documents`, two)).status, 404);
  const zhangKnowledge = await (await request(`/api/candidates/${zhang.id}/knowledge?q=React`, one)).json();
  assert.ok(zhangKnowledge.facts.some(fact => fact.value.includes('React') && fact.sourceQuote.includes('React')));
  assert.ok(zhangKnowledge.chunks.some(chunk => chunk.text.includes('GreenSteps')));
  assert.deepEqual((await (await request(`/api/candidates/${li.id}/knowledge?q=React`, one)).json()).facts, []);
  assert.equal((await request(`/api/candidates/${zhang.id}/knowledge`, two)).status, 404);
  // Candidate B gets its own material, so isolation is proven in both directions
  // instead of only "B happens to have nothing".
  const liUpload = new FormData();
  liUpload.append('file', new Blob(['李四\n教育经历\n某某大学英语本科\n项目经历\n校园公众号内容运营\n技能\n内容写作'], {type:'text/plain'}), 'li-resume.txt');
  const liUploadResult = await fetch(`${base}/api/conversations/${liConversation.id}/documents`,{method:'POST',headers:{Cookie:one},body:liUpload});
  assert.equal(liUploadResult.status, 200);
  const liDocument = (await liUploadResult.json()).document;
  assert.deepEqual((await (await request(`/api/candidates/${li.id}/documents`, one)).json()).documents.map(item => item.id), [liDocument.id]);
  assert.deepEqual((await (await request(`/api/candidates/${zhang.id}/documents`, one)).json()).documents.map(item => item.id), [candidateDocument.id]);
  const liKnowledge = await (await request(`/api/candidates/${li.id}/knowledge?q=${encodeURIComponent('内容写作')}`, one)).json();
  assert.ok(liKnowledge.facts.length > 0, 'candidate B reads its own material');
  assert.ok(liKnowledge.chunks.length > 0, 'candidate B reads its own chunks');
  // Neither candidate can reach the other's facts or chunks.
  assert.ok(liKnowledge.facts.every(fact => !fact.value.includes('React') && !fact.value.includes('郑州轻工业大学')));
  assert.ok(liKnowledge.chunks.every(chunk => !chunk.text.includes('GreenSteps')));
  const zhangIsolation = await (await request(`/api/candidates/${zhang.id}/knowledge?q=${encodeURIComponent('内容写作')}`, one)).json();
  assert.deepEqual(zhangIsolation.facts, []);
  assert.deepEqual(zhangIsolation.chunks, []);
  await request(`/api/conversations/${zhangFirst.id}`, one, {method:'DELETE'});
  // Deleting a work thread must not delete long-term candidate material: facts,
  // documents and retrieval chunks all outlive the Conversation.
  const zhangAfterDelete = await (await request(`/api/candidates/${zhang.id}/knowledge?q=React`, one)).json();
  assert.ok(zhangAfterDelete.facts.length > 0);
  assert.ok(zhangAfterDelete.chunks.some(chunk => chunk.text.includes('GreenSteps')));
  assert.ok((await (await request(`/api/candidates/${zhang.id}/documents`, one)).json()).documents.some(item => item.id === candidateDocument.id));
  // The evidence panel embeds this URL in an iframe. Only an explicit download may be
  // answered with an attachment: before the fix every non-PDF preview fell through to
  // res.download(), so opening the panel saved the resume the user had just uploaded
  // instead of showing it.
  const inlinePreview = await request(`/api/documents/${candidateDocument.id}?inline=1`, one);
  assert.equal(inlinePreview.status, 200);
  const inlineType = inlinePreview.headers.get("content-type") || "";
  assert.match(inlineType, /^text\/plain/, "a TXT preview must be served as text, not as a download");
  assert.match(inlineType, /charset=utf-8/);
  assert.equal((inlinePreview.headers.get("content-disposition") || "").includes("attachment"), false, "a preview must never be an attachment");
  assert.equal(inlinePreview.headers.get("x-content-type-options"), "nosniff");
  assert.match(await inlinePreview.text(), /GreenSteps/, "the preview must carry the text extracted at upload time");
  // Same document without the inline flag: the explicit download keeps its behaviour.
  const explicitDownload = await request(`/api/documents/${candidateDocument.id}`, one);
  assert.equal(explicitDownload.status, 200);
  assert.ok((explicitDownload.headers.get("content-disposition") || "").includes("attachment"), "the explicit download must stay an attachment");
  assert.match(await explicitDownload.text(), /GreenSteps/);
  // The preview must not become a way around candidate ownership.
  assert.equal((await request(`/api/documents/${candidateDocument.id}?inline=1`, two)).status, 404);
  // Cross-conversation memory end to end: the material uploaded through the first
  // Conversation (deleted just above) is still readable by the Agent in a new one.
  const zhangProbe = (await (await request('/api/conversations', one, {method:'POST',body:JSON.stringify({candidateId:zhang.id})})).json()).conversation;
  assert.equal(zhangProbe.candidateId, zhang.id);
  const zhangAnswer = await (await request(`/api/conversations/${zhangProbe.id}/messages`, one, {method:'POST',body:JSON.stringify({content:`${EVIDENCE_PROBE} 我之前上传过哪些项目经历？`})})).text();
  assert.match(zhangAnswer, /event: done/);
  assert.match(zhangAnswer, /GreenSteps/);
  assert.ok(zhangAnswer.includes(candidateDocument.name), 'the Agent must cite the source document it read');
  // Every value in that answer has to exist verbatim in the uploaded file, which is
  // what makes the citation checkable instead of anecdotal.
  const quotedEvidence = (zhangAnswer.match(/已核对当前求职者证据：([^\n]*)/) || [])[1] || '';
  const quotedValues = quotedEvidence.split('；').map(entry => entry.split('｜')[0].trim()).filter(Boolean);
  assert.ok(quotedValues.length > 0, 'the Agent must return at least one retrieved value');
  for (const value of quotedValues) assert.ok(ZHANG_RESUME_TEXT.includes(value), `quoted evidence must exist verbatim in the uploaded file: ${value}`);
  const zhangTrace = (await (await request(`/api/conversations/${zhangProbe.id}`, one)).json()).conversation.context.candidateRetrieval;
  assert.equal(zhangTrace.query, 'React');
  assert.ok(zhangTrace.factIds.length > 0);
  assert.deepEqual(zhangTrace.queries, ['React']);
  // The same request under candidate B must not surface candidate A material.
  const liProbe = (await (await request('/api/conversations', one, {method:'POST',body:JSON.stringify({candidateId:li.id})})).json()).conversation;
  const liAnswer = await (await request(`/api/conversations/${liProbe.id}/messages`, one, {method:'POST',body:JSON.stringify({content:`${EVIDENCE_PROBE} 我之前上传过哪些项目经历？`})})).text();
  assert.match(liAnswer, /event: done/);
  assert.doesNotMatch(liAnswer, /GreenSteps|郑州轻工业大学/);
  assert.ok(!liAnswer.includes(candidateDocument.name));
  // An empty evidence pack has to be reported as "no evidence" rather than filled in.
  assert.match(liAnswer, /没有匹配到证据/);
  assert.deepEqual((await (await request(`/api/conversations/${liProbe.id}`, one)).json()).conversation.context.candidateRetrieval.factIds, []);
  // A question about something the candidate never wrote must also come back empty.
  assert.deepEqual((await (await request(`/api/candidates/${zhang.id}/knowledge?q=Kubernetes`, one)).json()).facts, []);
  assert.deepEqual((await (await request(`/api/candidates/${zhang.id}/knowledge?q=Kubernetes`, one)).json()).chunks, []);
  // A second user probing through their own Conversation sees nothing of candidate A.
  const strangerProbe = (await (await request('/api/conversations', two, {method:'POST',body:'{}'})).json()).conversation;
  const strangerAnswer = await (await request(`/api/conversations/${strangerProbe.id}/messages`, two, {method:'POST',body:JSON.stringify({content:`${EVIDENCE_PROBE} 我之前上传过哪些项目经历？`})})).text();
  assert.doesNotMatch(strangerAnswer, /GreenSteps|郑州轻工业大学/);
  assert.ok(!strangerAnswer.includes(candidateDocument.name));
  assert.deepEqual((await (await request(`/api/conversations/${strangerProbe.id}`, two)).json()).conversation.context.candidateRetrieval.factIds, []);
  // Assistant prose and pasted JD text are input data, never candidate facts
  // (PRD 5.3, DEVELOPMENT_RULES 7). A whole turn must not create any.
  const ownerOne = database.getUserByEmail('one@example.com').id;
  const factsBefore = database.listCandidateFacts(ownerOne, zhang.id).map(fact => fact.id).sort();
  assert.ok(factsBefore.length > 0, 'the candidate must already have facts to protect');
  const jdProbe = (await (await request('/api/conversations', one, {method:'POST',body:JSON.stringify({candidateId:zhang.id})})).json()).conversation;
  const jdAnswer = await (await request(`/api/conversations/${jdProbe.id}/messages`, one, {method:'POST',body:JSON.stringify({content:'目标岗位 JD：要求熟练掌握 Kubernetes 与 Java，负责微服务架构设计，需五年以上经验。请据此帮我准备简历。'})})).text();
  assert.match(jdAnswer, /event: done/);
  assert.deepEqual(database.listCandidateFacts(ownerOne, zhang.id).map(fact => fact.id).sort(), factsBefore, 'a turn must not add or remove candidate facts');
  assert.deepEqual((await (await request(`/api/candidates/${zhang.id}/knowledge?q=Kubernetes`, one)).json()).facts, []);
  assert.deepEqual((await (await request(`/api/candidates/${zhang.id}/knowledge?q=${encodeURIComponent('微服务架构')}`, one)).json()).facts, []);
  // Full-chain acceptance question: one turn that needs education, project and skill
  // evidence. It runs API → Career Agent → search_candidate_knowledge → Candidate
  // Retrieval → SQLite → a cited answer, and every quoted value must be verbatim
  // text from the uploaded file.
  const allProbe = (await (await request('/api/conversations', one, {method:'POST',body:JSON.stringify({candidateId:zhang.id})})).json()).conversation;
  const allAnswer = await (await request(`/api/conversations/${allProbe.id}/messages`, one, {method:'POST',body:JSON.stringify({content:`${EVIDENCE_PROBE_ALL} 我的教育经历、项目经历和技术栈分别是什么？`})})).text();
  assert.match(allAnswer, /event: done/);
  assert.match(allAnswer, /郑州轻工业大学/);
  assert.match(allAnswer, /GreenSteps/);
  assert.match(allAnswer, /React/);
  assert.ok(allAnswer.includes(candidateDocument.name), 'the Agent must name the source document it read');
  const allValues = ((allAnswer.match(/已核对当前求职者证据：([^\n]*)/) || [])[1] || '').split('；').map(entry => entry.split('｜')[0].trim()).filter(Boolean);
  assert.ok(allValues.length >= 3, `the answer must carry the evidence it retrieved, got ${allValues.length}`);
  for (const value of allValues) assert.ok(ZHANG_RESUME_TEXT.includes(value), `quoted evidence must exist verbatim in the uploaded file: ${value}`);
  const allTrace = (await (await request(`/api/conversations/${allProbe.id}`, one)).json()).conversation.context.candidateRetrieval;
  assert.deepEqual(allTrace.queries, ['我的教育经历', '我的项目经历', '我的技能'], 'all three reads must be traced');
  assert.equal(allTrace.factIds.length, new Set(allTrace.factIds).size, 'the trace must not repeat fact ids');
  const ownedFactIds = new Set(database.listCandidateFacts(ownerOne, zhang.id).map(fact => fact.id));
  assert.ok(allTrace.factIds.length >= 3, 'every read must be traced, not only the last one');
  for (const factId of allTrace.factIds) assert.ok(ownedFactIds.has(factId), `a traced fact must belong to this candidate: ${factId}`);
  const project = (await (await request('/api/projects',one,{method:'POST',body:'{"name":"校招"}'})).json()).project;
  assert.ok(project.id);
  assert.equal((await request(`/api/projects/${project.id}`,two,{method:'PATCH',body:'{"name":"其他"}'})).status,404);
  assert.equal((await request('/api/conversations',two,{method:'POST',body:JSON.stringify({projectId:project.id})})).status,404);
  const created = await (await request("/api/conversations", one, {method:"POST",body:"{}"})).json();
  const id = created.conversation.id;
  const emptyFirstConversation = await (await request("/api/conversations", one, {method:"POST",body:"{}"})).json();
  const emptyFirst = new FormData();
  emptyFirst.append("file", new Blob([""], {type:"text/plain"}), "first-empty.txt");
  const emptyFirstUpload = await fetch(`${base}/api/conversations/${emptyFirstConversation.conversation.id}/documents`, {method:"POST",headers:{Cookie:one},body:emptyFirst});
  assert.equal(emptyFirstUpload.status, 200);
  const emptyFirstResult = await emptyFirstUpload.json();
  assert.equal(emptyFirstResult.document.parseStatus.status, "unreadable");
  assert.equal(emptyFirstResult.document.parseStatus.preservedExistingMaterial, false);
  assert.doesNotMatch(emptyFirstResult.conversation.messages.at(-1).content, /旧的有效简历资料|保留旧/);
  const moved = await (await request(`/api/conversations/${id}`,one,{method:'PATCH',body:JSON.stringify({projectId:project.id})})).json();
  assert.equal(moved.conversation.projectId,project.id);
  await request(`/api/projects/${project.id}`,one,{method:'DELETE'});
  assert.equal((await (await request(`/api/conversations/${id}`,one)).json()).conversation.projectId,null);
  assert.equal((await request(`/api/conversations/${id}/resume.pdf`,one)).status,409);
  assert.equal((await request(`/api/conversations/${id}/resume.pdf`,two)).status,404);
  assert.equal((await request(`/api/conversations/${id}`, two)).status, 404);
  assert.equal((await request(`/api/conversations/${id}`, two, {method:"DELETE"})).status, 404);
  assert.equal((await request(`/api/conversations/${id}/context`, two, {method:"PATCH",body:'{"selectedJob":{"id":"x"}}'})).status, 404);
  const badOrigin = await request("/api/conversations", one, {method:"POST",headers:{Origin:"https://attacker.example"},body:"{}"});
  assert.equal(badOrigin.status, 403);
  const reply = await request(`/api/conversations/${id}/messages`, one, {method:"POST",body:JSON.stringify({content:"你好，请帮我规划求职"})});
  const stream = await reply.text();
  assert.match(stream, /event: done/);
  assert.match(stream, /真实项目/);
  const recovered = await (await request(`/api/conversations/${id}`, one)).json();
  assert.equal(recovered.conversation.messages.filter(m => m.role === "user").length, 1);
  assert.match(recovered.conversation.messages.at(-1).content, /真实项目/);
  const upload = new FormData();
  upload.append("file", new Blob(["张三\n教育经历\n某大学计算机本科\n项目经历\n使用React完成系统\n技能栈\nReact TypeScript"], {type:"text/plain"}), "resume.txt");
  const uploaded = await fetch(`${base}/api/conversations/${id}/documents`, {method:"POST",headers:{Cookie:one},body:upload});
  assert.equal(uploaded.status, 200);
  const { document, conversation: uploadedConversation } = await uploaded.json();
  assert.equal(document.parseStatus?.status, "parsed");
  assert.equal(uploadedConversation.context.uploadStatus.status, "parsed");
  assert.equal(uploadedConversation.messages.some(message => message.role === "assistant" && message.kind === "diagnosis"), false);
  assert.match(uploadedConversation.messages.at(-1).content, /文件已保存/);
  const oldMaterial = uploadedConversation.context.material;
  const oldProfile = uploadedConversation.context.profile;
  const oldDiagnosis = uploadedConversation.context.diagnosis;
  const emptyUpload = new FormData();
  emptyUpload.append("file", new Blob(["   \n  "], {type:"text/plain"}), "empty.txt");
  const unreadableTxt = await fetch(`${base}/api/conversations/${id}/documents`, {method:"POST",headers:{Cookie:one},body:emptyUpload});
  assert.equal(unreadableTxt.status, 200);
  const emptyResult = await unreadableTxt.json();
  assert.equal(emptyResult.document.parseStatus.status, "unreadable");
  assert.equal(emptyResult.document.parseStatus.preservedExistingMaterial, true);
  assert.match(emptyResult.document.parseStatus.message, /没有读取到可用文本/);
  assert.match(emptyResult.conversation.messages.at(-1).content, /保留旧的有效简历资料/);
  assert.equal(emptyResult.conversation.context.material, oldMaterial);
  assert.deepEqual(emptyResult.conversation.context.profile, oldProfile);
  assert.deepEqual(emptyResult.conversation.context.diagnosis, oldDiagnosis);
  assert.equal(emptyResult.conversation.messages.some(message => message.role === "assistant" && message.kind === "diagnosis"), false);
  // With no usable text the preview must still explain itself instead of downloading.
  const emptyPreview = await request(`/api/documents/${emptyResult.document.id}?inline=1`, one);
  assert.equal(emptyPreview.status, 200);
  assert.match(emptyPreview.headers.get("content-type") || "", /^text\/plain/);
  assert.equal((emptyPreview.headers.get("content-disposition") || "").includes("attachment"), false);
  assert.match(await emptyPreview.text(), /下载/, "an unreadable file must say so rather than download itself");
  const damagedPdf = new FormData();
  damagedPdf.append("file", new Blob(["%PDF-1.4\nbroken"], {type:"application/pdf"}), "broken.pdf");
  const unreadablePdf = await fetch(`${base}/api/conversations/${id}/documents`, {method:"POST",headers:{Cookie:one},body:damagedPdf});
  assert.equal(unreadablePdf.status, 200);
  const pdfResult = await unreadablePdf.json();
  assert.equal(pdfResult.document.parseStatus.status, "unreadable");
  assert.equal(pdfResult.conversation.context.material, oldMaterial);
  const scanConversation = (await (await request('/api/conversations',one,{method:'POST',body:'{}'})).json()).conversation;
  const imagePdf = await renderResume({name:'x',education:[],skills:[],projects:[],experience:[],awards:[],contact:{}}, 'pdf');
  const scanUpload = new FormData(); scanUpload.append('file',new Blob([imagePdf],{type:'application/pdf'}),'scan.pdf');
  const scanResult = await (await fetch(`${base}/api/conversations/${scanConversation.id}/documents`,{method:'POST',headers:{Cookie:one},body:scanUpload})).json();
  assert.ok(visionCalls > 0, 'sparse PDF must reach image recognition');
  assert.equal(scanResult.document.parseStatus.extraction.status,'complete');
  assert.match(scanResult.conversation.context.material,/客户接待/);
  // A PDF preview still returns the original file inline, so the panel can render it.
  const pdfPreview = await request(`/api/documents/${scanResult.document.id}?inline=1`, one);
  assert.equal(pdfPreview.status, 200);
  assert.match(pdfPreview.headers.get("content-type") || "", /^application\/pdf/);
  assert.match(pdfPreview.headers.get("content-disposition") || "", /inline/);
  assert.equal((pdfPreview.headers.get("content-disposition") || "").includes("attachment"), false);
  assert.doesNotMatch(scanResult.conversation.messages.at(-1).content,/粘贴|自行|先 OCR/);
  // Simulate a previously saved file with the old, page-number-only extraction.
  const owner = database.raw.prepare('select user_id from documents where id=?').get(scanResult.document.id).user_id;
  const savedDoc = database.listDocuments(owner).find(d=>d.id===scanResult.document.id);
  database.saveDocument(owner,{...savedDoc,text:'-- 1 of 1 --',parseStatus:{status:'needs_review'}});
  const savedConversation = database.getConversation(owner,scanConversation.id);
  savedConversation.context.material='-- 1 of 1 --'; savedConversation.context.uploadStatus={status:'needs_review'};
  database.saveConversation(owner,savedConversation);
  const beforeReread=visionCalls;
  const reread = await request(`/api/conversations/${scanConversation.id}/messages`,one,{method:'POST',body:JSON.stringify({content:'重新读取已上传PDF'})});
  assert.match(await reread.text(),/event: done/);
  assert.equal(visionCalls,beforeReread+1);
  assert.match(database.getConversation(owner,scanConversation.id).context.material,/客户接待/);
  const recoveredDoc = database.listDocuments(owner).find(d=>d.id===scanResult.document.id);
  database.saveDocument(owner,{...recoveredDoc,parseStatus:{status:'needs_review'}});
  writeFileSync(path.join(directory,'uploads',owner,recoveredDoc.id),'%PDF-1.4\nbroken');
  const failedReread = await request(`/api/conversations/${scanConversation.id}/messages`,one,{method:'POST',body:JSON.stringify({content:'重新读取已上传PDF'})});
  assert.match(await failedReread.text(),/event: done/);
  assert.equal(database.listDocuments(owner).find(d=>d.id===recoveredDoc.id).text,recoveredDoc.text);
  assert.match(database.getConversation(owner,scanConversation.id).context.material,/客户接待/);
  assert.equal(database.getConversation(owner,scanConversation.id).context.uploadStatus.status,'unreadable');

  const unsupported = new FormData();
  unsupported.append("file", new Blob(["hello"], {type:"text/rtf"}), "resume.rtf");
  assert.equal((await fetch(`${base}/api/conversations/${id}/documents`, {method:"POST",headers:{Cookie:one},body:unsupported})).status, 400);
  const docs = await (await request(`/api/conversations/${id}/documents`, one)).json();
  assert.equal(docs.documents.filter(item => item.parseStatus?.status === "unreadable").length, 2);
  assert.equal((await request(`/api/documents/${document.id}`, two)).status, 404);
  assert.match(await (await request(`/api/documents/${document.id}`, one)).text(), /教育经历/);
  const exported = await request(`/api/conversations/${id}/export?format=json`, one);
  assert.equal(exported.status, 200);
  assert.ok(exported.headers.get("content-disposition").includes("attachment"));
  await request(`/api/conversations/${id}`, one, {method:"DELETE"});
  assert.equal((await request(`/api/conversations/${id}`, one)).status, 404);
  assert.equal((await request(`/api/documents/${document.id}`, one)).status, 200, 'Candidate material outlives a conversation');
  assert.equal((await request("/api/boss/apply", null, {method:"POST",body:"{}"})).status, 401);
  console.log("app integration tests passed: auth, ownership, SSE, uploads, export, deletion");
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  database.close();
  rmSync(directory, {recursive:true,force:true});
}
