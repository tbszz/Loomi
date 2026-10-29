import assert from "node:assert/strict";
import { test } from "node:test";
import { validateInterviewPlan, validateResumeDraft } from "./generatedContent.js";

const material = `
张三
邮箱 zhangsan@example.com
教育经历
华东某大学 计算机科学本科 2022-2026
项目经历
校园岗位助手：独立使用React、TypeScript和FastAPI开发岗位搜索与收藏系统，使用PostgreSQL存储岗位，给20名同学测试。
实习经历
2025年7月至9月 某软件公司 前端实习：参与后台表单组件开发和接口联调。
技能栈
React、TypeScript、Python、FastAPI、PostgreSQL、Git。
`;

const profile = {
  name: "张三",
  contact: { email: "zhangsan@example.com", phone: "", github: "", website: "", location: "" },
  education: ["华东某大学 计算机科学本科 2022-2026"],
  projects: ["校园岗位助手：独立使用React、TypeScript和FastAPI开发岗位搜索与收藏系统，使用PostgreSQL存储岗位，给20名同学测试。"],
  experience: ["2025年7月至9月 某软件公司 前端实习：参与后台表单组件开发和接口联调。"],
  skills: ["React", "TypeScript", "Python", "FastAPI", "PostgreSQL", "Git"]
};

const validInterviewPlan = () => ({
  roleLabel: "前端开发工程师（校招）",
  topic: "校园岗位助手项目追问",
  resumeDefense: [
    "你在校园岗位助手中具体负责了哪些 React 和 TypeScript 工作？",
    "你如何说明项目里 FastAPI 与 PostgreSQL 的职责边界？",
    "你在实习表单组件开发中如何处理接口联调问题？"
  ],
  schedule: Array.from({ length: 7 }, (_, index) => ({
    day: `Day ${index + 1}`,
    title: `复习主题 ${index + 1}`,
    tasks: [`任务 ${index + 1}`]
  }))
});

const validResumeDraft = () => ({
  name: "张三",
  contact: { email: "zhangsan@example.com" },
  education: ["华东某大学 | 计算机科学 | 本科 | 2022 - 2026"],
  skills: ["React", "TypeScript", "Python", "FastAPI", "PostgreSQL", "Git"],
  projects: [
    "校园岗位助手 | 独立开发 | React + TypeScript + FastAPI + PostgreSQL，实现岗位搜索与收藏功能，给20名同学测试。"
  ],
  experience: [
    "某软件公司 | 前端实习 | 2025.07 - 2025.09，参与后台表单组件开发、样式调优和接口联调。"
  ]
});

await test("validates and normalizes an interview plan with question defenses and exact 7 day schedule", () => {
  const normalized = validateInterviewPlan(validInterviewPlan());

  assert.equal(normalized.roleLabel, "前端开发工程师（校招）");
  assert.equal(normalized.topic, "校园岗位助手项目追问");
  assert.equal(normalized.schedule.length, 7);
  assert.equal(normalized.schedule.every((item) => typeof item.day === "string" && typeof item.title === "string"), true);
  assert.equal(normalized.resumeDefense.every((item) => /[?？]$/.test(item)), true);
});

await test("rejects interview resume defense statements that invent first-person facts", () => {
  const candidate = validInterviewPlan();
  candidate.resumeDefense[0] = "我在项目里用 useMemo 优化筛选逻辑，并用 PostgreSQL 索引提升查询性能。";

  assert.throws(() => validateInterviewPlan(candidate), /面试追问.*问句|第一人称/);
});

await test("rejects interview plans that are not exactly seven days or contain non-string schedule fields", () => {
  const sixDays = validInterviewPlan();
  sixDays.schedule = sixDays.schedule.slice(0, 6);
  assert.throws(() => validateInterviewPlan(sixDays), /7天/);

  const nonString = validInterviewPlan();
  nonString.schedule[2] = { day: 3, title: "复习主题 3" };
  assert.throws(() => validateInterviewPlan(nonString), /字符串/);
});

await test("validates a resume draft while allowing profile facts and date format changes", () => {
  const normalized = validateResumeDraft(validResumeDraft(), { material, profile });

  assert.equal(normalized.name, "张三");
  assert.equal(normalized.contact.email, "zhangsan@example.com");
  assert.deepEqual(normalized.skills, ["React", "TypeScript", "Python", "FastAPI", "PostgreSQL", "Git"]);
  assert.equal(normalized.projects.every((item) => typeof item === "string"), true);
  assert.equal(normalized.experience.every((item) => typeof item === "string"), true);
});

await test("rejects resume skills that are not present in the source material or profile", () => {
  const candidate = validResumeDraft();
  candidate.skills = [...candidate.skills, "Vue", "Docker"];

  assert.throws(() => validateResumeDraft(candidate, { material, profile }), /技能.*凭空/);
});

await test("rejects resume drafts with hallucinated numeric metrics", () => {
  const candidate = validResumeDraft();
  candidate.projects[0] = "校园岗位助手 | 独立开发 | 将搜索响应时间优化到200ms，支持1000名用户。";

  assert.throws(() => validateResumeDraft(candidate, { material, profile }), /数字|指标/);
});

await test("rejects percentage metrics even when the same plain number exists in source material", () => {
  const candidate = validResumeDraft();
  candidate.projects[0] = "校园岗位助手 | 独立开发 | 将岗位搜索转化率提升20%。";

  assert.throws(() => validateResumeDraft(candidate, { material, profile }), /数字|指标/);
});

await test("rejects resume drafts that fabricate identity, contact, or education facts", () => {
  const candidate = validResumeDraft();
  candidate.contact.email = "other@example.com";
  candidate.education = ["清华大学 计算机科学 本科 2022-2026"];

  assert.throws(() => validateResumeDraft(candidate, { material, profile }), /基本信息|教育/);
});

await test("rejects awards that are not present in source material or profile", () => {
  const candidate = validResumeDraft();
  candidate.awards = ["校级一等奖学金"];

  assert.throws(() => validateResumeDraft(candidate, { material, profile }), /奖项|荣誉/);
});

console.log("generatedContent tests passed");
