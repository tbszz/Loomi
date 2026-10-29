import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { runCareerAgent, newMessage } from "../server/careerAgent.js";
import { createConversation } from "../src/chatStore.js";
try { process.loadEnvFile(".env"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const c = createConversation();
const inputs = [
  "这是我的真实简历，请分析并保存：\n张三\n邮箱 zhangsan@example.com\n教育经历\n华东某大学 计算机科学本科 2022-2026\n项目经历\n校园岗位助手：独立使用React、TypeScript和FastAPI开发岗位搜索与收藏系统，使用PostgreSQL存储岗位，给20名同学测试。\n实习经历\n2025年7月至9月 某软件公司 前端实习：参与后台表单组件开发和接口联调。\n技能栈\nReact、TypeScript、Python、FastAPI、PostgreSQL、Git。",
  "请将以下JD设为目标并生成完整岗位版简历：\n前端开发工程师（校招）\n岗位职责：负责React与TypeScript业务页面开发，配合后端进行接口联调，优化表单交互。\n任职要求：计算机相关本科，掌握JavaScript、React、TypeScript和Git，有实际项目经验；了解Python及数据库加分。\n不要编造我没有的经历。",
  "请针对刚才这份岗位版简历生成项目追问和七天复习计划。"
];
for (let i = 0; i < inputs.length; i++) {
  c.messages.push(newMessage("user", inputs[i]));
  const started = Date.now();
  await runCareerAgent({ conversation: c, persist: () => {}, emit: (type, data) => { if (type === "status") console.log(JSON.stringify({ step: i + 1, ...data })); }, signal: AbortSignal.timeout(160000) });
  console.log(JSON.stringify({ step: i + 1, elapsedMs: Date.now() - started, profile: !!c.context.profile, target: !!c.context.selectedJob, resume: c.context.variant?.source, days: c.context.variant?.interviewPlan?.schedule?.length }));
}
mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/live-agent-result.json", JSON.stringify(c, null, 2));
assert.ok(c.context.profile);
assert.ok(c.context.selectedJob);
assert.equal(c.context.variant?.source, "ai");
assert.equal(c.context.variant?.interviewPlan?.schedule?.length, 7);
console.log("Live MiniMax workflow passed. Output: tmp/live-agent-result.json");
