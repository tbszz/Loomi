import assert from "node:assert/strict";
import { buildJobQueries, classifyAgentIntent, planAgentAction } from "./agentIntent.js";

assert.equal(classifyAgentIntent("帮我诊断一下这份简历"), "intake");
assert.equal(classifyAgentIntent("找上海的 AI Agent 校招岗位"), "jobs");
assert.equal(classifyAgentIntent("按照这个 JD 生成前端岗位版简历"), "resume");
assert.equal(classifyAgentIntent("根据当前项目准备面试和追问"), "interview");
assert.equal(classifyAgentIntent("我接下来应该做什么"), "help");
assert.equal(classifyAgentIntent("教育经历\n某大学软件工程\n项目经历\n使用 React 和 FastAPI 完成检索系统"), "intake");
assert.equal(classifyAgentIntent("李明\n教育经历\n某大学软件工程本科\n项目经历\nCampusCopilot 校招助手：使用 React 和 FastAPI 完成岗位匹配系统\n技能栈\nReact、TypeScript、Python、RAG"), "intake");
assert.deepEqual(buildJobQueries("帮我找前端校招岗位"), ["前端", ""]);
assert.deepEqual(buildJobQueries("帮我找 AI Agent 岗位"), ["AI Agent", "AI", ""]);

{
  const result = planAgentAction("", {});
  assert.equal(result.intent, "empty");
  assert.equal(result.action, "none");
  assert.equal(result.target, "chat");
  assert.match(result.message, /最想完成什么/);
}

{
  const result = planAgentAction("诊断简历", { hasMaterial: true });
  assert.equal(result.action, "analyze");
  assert.equal(result.target, "chat");
}

{
  const result = planAgentAction("生成岗位版简历", { hasProfile: false, hasJob: false });
  assert.equal(result.action, "request-material");
  assert.equal(result.target, "chat");
  assert.match(result.message, /职业资料/);
}

{
  const result = planAgentAction("生成岗位版简历", { hasProfile: true, hasJob: false });
  assert.equal(result.action, "search-jobs");
  assert.equal(result.target, "chat");
  assert.match(result.message, /目标岗位/);
}

{
  const result = planAgentAction("生成岗位版简历", { hasProfile: true, hasJob: true });
  assert.equal(result.action, "generate-resume");
  assert.equal(result.target, "chat");
}

{
  const result = planAgentAction("准备面试", { hasVariant: false });
  assert.equal(result.action, "request-resume");
  assert.equal(result.target, "chat");
}

{
  const result = planAgentAction("准备面试", { hasVariant: true });
  assert.equal(result.action, "prepare-interview");
  assert.equal(result.target, "chat");
}

console.log("agentIntent tests passed");
