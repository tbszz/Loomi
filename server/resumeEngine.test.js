import assert from "node:assert/strict";
import { createFormalResume, generateVariant, parseResumeText } from "./resumeEngine.js";

const profile = {
  name: "李明",
  title: "软件工程学生",
  contact: { email: "liming@example.com", phone: "13800138000", github: "", website: "" },
  education: ["某大学 软件工程 本科 2023-2027"],
  projects: [
    "Atlas RAG 知识库：基于 Python、FastAPI、SQLite FTS5 和 RAG 构建文档检索服务；设计 chunk 检索与引用链路；2047 道测试题成功率 99.95%。",
    "Canvas 控制台：基于 React、TypeScript 和 Vite 实现任务看板；拆分可复用组件并完成响应式适配；首屏耗时降低 35%。"
  ],
  experience: [],
  skills: ["Python", "FastAPI", "RAG", "React", "TypeScript", "Vite", "SQLite", "Git"],
  awards: [],
  metrics: ["2047 道", "99.95%", "35%"],
  links: [],
  sourceConfidence: 90
};

const jd = "负责 React、TypeScript 前端开发，重视组件化、响应式、性能优化和接口联调。";

{
  const frontend = generateVariant({ profile, role: "frontend", template: "cnTech", jd });
  const ai = generateVariant({ profile, role: "ai", template: "aiResearch", jd: "负责 RAG、FastAPI、检索评测与 AI Agent 工程化。" });

  assert.equal(frontend.projectStrategy[0].original.includes("Canvas 控制台"), true, "前端岗位应优先选择前端证据");
  assert.equal(ai.projectStrategy[0].original.includes("Atlas RAG"), true, "AI 岗位应优先选择 AI 证据");
  assert.notEqual(frontend.projects[0], ai.projects[0], "不同岗位应生成不同的项目排序或叙事");
}

{
  const variant = generateVariant({ profile, role: "frontend", template: "cnTech", jd });
  const strategy = variant.projectStrategy[0];
  assert.equal(typeof strategy.tailoredBullet, "string");
  assert.equal(strategy.tailoredBullet.length > 20, true);
  assert.equal(strategy.relevanceScore >= 0 && strategy.relevanceScore <= 100, true);
  assert.equal(strategy.matchedKeywords.includes("React"), true);
  assert.equal(strategy.interviewQuestions.length >= 3, true);

  const sourceNumbers = new Set(strategy.original.match(/\d+(?:\.\d+)?/g) || []);
  const generatedNumbers = strategy.tailoredBullet.match(/\d+(?:\.\d+)?/g) || [];
  assert.equal(generatedNumbers.every((number) => sourceNumbers.has(number)), true, "岗位化项目不得编造数字");
}

{
  const variant = generateVariant({ profile, role: "backend", template: "ats", jd: "Python FastAPI 数据库 接口 性能" });
  assert.equal(variant.interviewPlan.technicalTopics.length >= 4, true);
  assert.equal(variant.interviewPlan.storyBank.length >= 1, true);
  assert.equal(variant.interviewPlan.schedule.length, 7);
  assert.equal(variant.interviewPlan.resumeDefense.length >= 4, true);

  const formal = createFormalResume({ profile, role: "backend", template: "ats", jd: "Python FastAPI 数据库 接口 性能" });
  assert.deepEqual(formal.projects, variant.projects.slice(0, 3), "正式简历应复用岗位化项目内容");
}

{
  const parsed = parseResumeText(`张三
教育经历
某某大学 软件工程 本科 2023-2027
项目经历
PPTSight 文档问答系统：基于 FastAPI、React、SQLite FTS5 和 RAG 实现多格式文档问答，测试集 2047 题。
SafeFile 文件整理助手：基于 Python、OCR 和 Web UI 实现预览、确认执行和撤销，51 个单元测试通过。
实习经历
参与 AI 工具原型设计和前后端联调，负责整理需求、实现页面、编写测试。
技能
Python、FastAPI、React、SQLite、RAG、Git`);
  assert.equal(parsed.profile.projects.length, 2, "应按项目经历 section 提取独立项目");
  assert.equal(parsed.profile.projects.some((item) => item.includes("实习经历")), false, "项目不得吞入实习 section");
  assert.equal(parsed.profile.projects.some((item) => item.startsWith("技能")), false, "项目不得吞入技能 section");
}

{
  const parsed = parseResumeText("田绿华 个人简历 基本信息 手机 13800138000 邮箱 tian@example.com 教育背景 某某大学 市场营销 本科 工作经历 喜茶门店服务，负责顾客接待、饮品制作和收银协作 项目经验 校园社群活动策划，负责物料筹备和现场执行 技能特长 门店服务、客户沟通、活动策划");
  assert.equal(parsed.profile.contact.phone, "13800138000", "一行式 PDF 文本也应提取手机号");
  assert.equal(parsed.profile.contact.email, "tian@example.com", "一行式 PDF 文本也应提取邮箱");
  assert.equal(parsed.profile.education.some((item) => item.includes("某某大学")), true, "应识别教育背景");
  assert.equal(parsed.profile.experience.some((item) => item.includes("喜茶门店服务")), true, "应识别非技术工作经历");
  assert.equal(parsed.profile.projects.some((item) => item.includes("校园社群活动")), true, "应识别项目经验");
  assert.equal(parsed.profile.skills.some((item) => item.includes("客户沟通")), true, "应保留简历技能段中的非技术技能");
  assert.equal(parsed.profile.sourceConfidence >= 72, true, "真实简历不应被判为低置信空材料");
}

console.log("resumeEngine tests passed");
