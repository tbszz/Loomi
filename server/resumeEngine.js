const SKILL_BANK = [
  "Python",
  "JavaScript",
  "TypeScript",
  "React",
  "Vue",
  "Vite",
  "Node.js",
  "Express",
  "FastAPI",
  "Django",
  "Flask",
  "Java",
  "Spring",
  "MySQL",
  "PostgreSQL",
  "SQLite",
  "Redis",
  "Docker",
  "Linux",
  "Git",
  "RAG",
  "LLM",
  "Agent",
  "Prompt",
  "OpenAI",
  "LangChain",
  "OCR",
  "Benchmark",
  "Playwright",
  "产品",
  "运营",
  "数据分析",
  "增长",
  "A/B",
  "PRD",
  "Figma"
];

export const ROLE_PROFILES = {
  ai: {
    label: "AI 岗",
    title: "AI Agent / RAG 应用工程师",
    keywords: ["LLM", "RAG", "Agent", "Prompt", "Python", "FastAPI", "Benchmark", "向量检索", "评测"],
    focus: "突出 AI 应用工程化、证据链、模型路由、评测指标和可解释性。",
    missing: ["模型调用链路", "RAG/检索指标", "Prompt 设计", "评测结果", "AI 项目职责"]
  },
  backend: {
    label: "后端",
    title: "Python 后端 / AI 应用后端工程师",
    keywords: ["Python", "FastAPI", "数据库", "接口", "并发", "任务队列", "日志", "缓存"],
    focus: "突出接口设计、数据建模、并发任务、文件处理、安全边界和稳定性。",
    missing: ["接口规模", "数据库设计", "并发/性能指标", "异常处理", "部署环境"]
  },
  frontend: {
    label: "前端",
    title: "React 前端 / AI 产品前端工程师",
    keywords: ["React", "TypeScript", "Vite", "组件", "状态管理", "响应式", "可视化", "交互"],
    focus: "突出复杂控制台、状态流、可视化、响应式布局和 AI 交互体验。",
    missing: ["组件拆分", "复杂状态", "接口联调", "移动端适配", "性能优化"]
  },
  product: {
    label: "产品",
    title: "AI 产品经理 / 产品助理",
    keywords: ["需求分析", "PRD", "原型", "指标", "用户流程", "竞品", "AI 工作流", "验收"],
    focus: "突出需求拆解、用户价值、流程设计、风险控制、指标验证和跨角色协作。",
    missing: ["用户场景", "指标定义", "竞品分析", "验收标准", "上线/复盘结果"]
  },
  ops: {
    label: "运营",
    title: "AI 运营 / 增长运营",
    keywords: ["内容运营", "增长", "数据分析", "转化", "活动", "用户分层", "自动化", "复盘"],
    focus: "突出内容生产、用户触达、转化漏斗、数据复盘和 AI 自动化提效。",
    missing: ["运营指标", "触达渠道", "转化结果", "活动复盘", "用户分层策略"]
  }
};

const INTERVIEW_BLUEPRINTS = {
  ai: [
    ["RAG 与检索", "能解释切分、召回、重排、引用和评测之间的取舍"],
    ["模型与 Prompt", "能说明模型选择、提示词迭代、失败样本与安全边界"],
    ["AI 工程化", "能讨论接口、缓存、降级、可观测性、成本与延迟"],
    ["评测体系", "能区分离线指标、人工评测与线上业务指标"]
  ],
  backend: [
    ["接口与数据模型", "能从需求推导 API、表结构、幂等和错误码"],
    ["性能与并发", "能定位瓶颈并解释缓存、队列、批处理与限流"],
    ["稳定性", "能说明日志、监控、重试、降级和故障恢复"],
    ["计算机基础", "复习数据库、网络、操作系统和常用数据结构"]
  ],
  frontend: [
    ["React 状态与组件", "能解释组件边界、状态归属和副作用管理"],
    ["性能与体验", "能说明渲染、加载、缓存、可访问性和指标验证"],
    ["浏览器与网络", "复习事件循环、渲染流程、HTTP 与安全基础"],
    ["工程质量", "能讨论类型、测试、构建、监控和渐进式交付"]
  ],
  product: [
    ["需求与优先级", "能从用户问题推导目标、范围和取舍"],
    ["指标体系", "能定义北极星指标、漏斗与实验判定"],
    ["AI 产品边界", "能说明能力评估、失败兜底与人机协同"],
    ["协作与推进", "能用具体案例解释对齐、冲突与复盘"]
  ],
  ops: [
    ["用户与内容", "能说明分层、触达、内容策略和渠道差异"],
    ["增长漏斗", "能拆解获客、激活、留存、转化和复购"],
    ["数据复盘", "能解释指标波动、归因假设与下一步实验"],
    ["AI 提效", "能量化自动化前后的成本、质量和风险"]
  ]
};

export const TEMPLATES = {
  ats: {
    label: "ATS 一页版",
    tone: "简洁、关键词密度高、少装饰，适合招聘系统解析。",
    sectionOrder: ["summary", "skills", "projects", "experience", "education", "links"]
  },
  cnTech: {
    label: "中文技术版",
    tone: "突出技术栈、项目职责、结果指标和工程细节。",
    sectionOrder: ["summary", "projects", "skills", "experience", "education", "links"]
  },
  aiResearch: {
    label: "AI 应用版",
    tone: "突出 Agent/RAG/评测/模型路由/业务落地。",
    sectionOrder: ["summary", "aiHighlights", "projects", "skills", "experience", "links"]
  },
  productOps: {
    label: "产品运营版",
    tone: "突出用户问题、流程设计、业务指标和协作结果。",
    sectionOrder: ["summary", "experience", "projects", "skills", "education", "links"]
  }
};

export function parseResumeText(rawText = "") {
  const text = normalize(rawText);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const contact = {
    email: firstMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i),
    phone: firstMatch(text, /(?:\+?86[-\s]?)?1[3-9]\d{9}/),
    github: firstMatch(text, /https?:\/\/github\.com\/[A-Za-z0-9_.-]+/i),
    website: firstMatch(text, /https?:\/\/(?!github\.com)[^\s，。)）]+/i)
  };
  const name = inferName(lines);
  const skills = dedupeStrings([...extractSkills(text), ...extractSkillItems(lines)]);
  const education = extractSection(lines, ["教育", "学校", "本科", "硕士", "大学", "学院", "专业"], 5);
  const projects = extractProjectBlocks(lines);
  const experience = extractExperienceBlocks(lines, projects);
  const awards = extractSection(lines, ["奖", "证书", "竞赛", "获奖", "排名"], 4);
  const metrics = Array.from(new Set(text.match(/\d+(?:\.\d+)?\s?(?:%|ms|s|秒|分钟|小时|人|个|题|w|万|k|K|倍|次|分)/g) || []));
  const links = [contact.github, contact.website].filter(Boolean);

  const profile = {
    name,
    title: inferTitle(skills, projects, experience),
    contact,
    education,
    skills,
    projects: dedupeStrings(projects.length ? projects : inferProjectBlocksFromLongText(text)),
    experience: dedupeStrings(experience),
    awards,
    metrics: metrics.slice(0, 18),
    links,
    rawLength: text.length,
    sourceConfidence: confidenceScore({ text, skills, projects, experience, education, contact })
  };
  return {
    profile,
    diagnosis: diagnoseProfile(profile),
    roleScores: scoreAllRoles(profile, ""),
    normalizedText: text
  };
}

export function generateVariant({ profile, role = "ai", template = "ats", jd = "" }) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  const templateProfile = TEMPLATES[template] || TEMPLATES.ats;
  const roleScore = scoreRole(profile, role, jd);
  const selectedSkills = rankSkills(profile.skills, roleProfile.keywords);
  const projectStrategy = buildProjectStrategy(profile.projects, roleProfile, jd, profile.metrics);
  const selectedProjects = projectStrategy.map((item) => item.original);
  const selectedExperience = selectProjects(profile.experience, roleProfile.keywords, jd);
  const summary = buildSummary(profile, roleProfile, selectedSkills, roleScore);
  const bullets = projectStrategy.map((item) => item.tailoredBullet);
  const experienceBullets = selectedExperience.map((item) => rewriteBlock(item, roleProfile, profile.metrics));
  const interviewPlan = buildInterviewPlan({ role, roleProfile, projectStrategy, gaps: roleScore.gaps, skills: selectedSkills });

  return {
    role,
    template,
    roleLabel: roleProfile.label,
    templateLabel: templateProfile.label,
    title: roleProfile.title,
    fitScore: roleScore.score,
    atsScore: Math.min(99, roleScore.score + selectedSkills.length),
    summary,
    skills: selectedSkills.slice(0, 14),
    projects: bullets.slice(0, 4),
    experience: experienceBullets.slice(0, 3),
    education: profile.education,
    links: profile.links,
    greeting: buildGreeting(profile, roleProfile, selectedProjects[0], roleScore),
    strengths: roleScore.strengths,
    gaps: roleScore.gaps,
    projectStrategy: projectStrategy.slice(0, 4),
    interviewPlan,
    templateNotes: templateProfile.tone,
    sectionOrder: templateProfile.sectionOrder,
    diff: buildDiff(profile, roleProfile, selectedSkills)
  };
}

export function createFormalResume({ profile, role = "ai", template = "aiResearch", jd = "" }) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  const variant = generateVariant({ profile, role, template, jd });
  const education = profile.education.length ? profile.education.slice(0, 3) : ["教育经历待补充"];
  const experience = normalizeResumeSection(profile.experience, "experience").slice(0, 2);
  const awards = [...profile.awards, ...profile.metrics.map((metric) => `量化结果：${metric}`)].slice(0, 4);

  return normalizeFormalResume({
    name: profile.name,
    targetTitle: roleProfile.title,
    contact: {
      phone: profile.contact.phone,
      email: profile.contact.email,
      github: profile.contact.github,
      website: profile.contact.website,
      location: ""
    },
    summary: compactSentence(variant.summary, 130),
    education,
    skills: variant.skills.slice(0, 16),
    projects: variant.projects.length
      ? variant.projects.slice(0, 3)
      : ["项目经历待补充：建议补充项目背景、职责、技术栈和量化结果。"],
    experience: (experience.length ? experience : ["实习/工作经历待补充：可写课程项目、社团协作、个人产品或比赛经历。"])
      .map((item) => compactResumeBullet(item, roleProfile, profile.metrics, true)),
    awards,
    keywords: variant.strengths.slice(0, 6),
    gaps: variant.gaps.slice(0, 5),
    source: "local",
    model: "local-rule-engine",
    templateId: template,
    targetJob: jd
  });
}

export function normalizeFormalResume(candidate = {}, fallback = {}) {
  const base = fallback || {};
  return {
    name: stringOr(candidate.name, base.name || "姓名待补充"),
    targetTitle: stringOr(candidate.targetTitle || candidate.title, base.targetTitle || "目标岗位待补充"),
    contact: {
      phone: stringOr(candidate.contact?.phone, base.contact?.phone || ""),
      email: stringOr(candidate.contact?.email, base.contact?.email || ""),
      github: stringOr(candidate.contact?.github, base.contact?.github || ""),
      website: stringOr(candidate.contact?.website, base.contact?.website || ""),
      location: stringOr(candidate.contact?.location, base.contact?.location || "")
    },
    summary: compactSentence(stringOr(candidate.summary, base.summary || ""), 170),
    education: normalizeStringList(candidate.education, base.education, 3),
    skills: normalizeStringList(candidate.skills, base.skills, 18),
    projects: dedupeBySemantic(normalizeStringList(candidate.projects, base.projects, 4).map((item) => compactSentence(item, 150))),
    experience: dedupeBySemantic(normalizeStringList(candidate.experience, base.experience, 3).map((item) => compactSentence(item, 130))),
    awards: normalizeStringList(candidate.awards, base.awards, 5),
    keywords: normalizeStringList(candidate.keywords, base.keywords, 8),
    gaps: normalizeStringList(candidate.gaps, base.gaps, 6),
    source: stringOr(candidate.source, base.source || "local"),
    model: stringOr(candidate.model, base.model || ""),
    templateId: stringOr(candidate.templateId, base.templateId || ""),
    targetJob: stringOr(candidate.targetJob, base.targetJob || "")
  };
}

export function scoreAllRoles(profile, jd = "") {
  return Object.fromEntries(Object.keys(ROLE_PROFILES).map((role) => [role, scoreRole(profile, role, jd)]));
}

export function scoreJob(job, profile, role = "ai") {
  const jd = [job.title, job.company, job.description, job.tags?.join(" ")].filter(Boolean).join("\n");
  const roleScore = scoreRole(profile, role, jd);
  const text = jd.toLowerCase();
  const blacklistPenalty = /外包|培训|无薪|保险|销售/i.test(jd) ? 18 : 0;
  const schoolBoost = /校招|实习|应届|毕业/i.test(jd) ? 6 : 0;
  const remoteBoost = /远程|remote/i.test(text) ? 2 : 0;
  return Math.max(1, Math.min(99, roleScore.score + schoolBoost + remoteBoost - blacklistPenalty));
}

export function createDemoJobs(profile, role = "ai") {
  const samples = [
    {
      id: "demo-ai-1",
      title: "AI Agent 应用工程师",
      company: "Moonshot AI",
      salary: "20-35K",
      location: "北京",
      description: "负责 LLM Agent、RAG、评测、Prompt 工程和 AI 应用后端。",
      url: "https://www.zhipin.com"
    },
    {
      id: "demo-be-1",
      title: "Python 后端开发工程师",
      company: "字节跳动",
      salary: "18-30K",
      location: "上海",
      description: "负责 FastAPI、数据库、异步任务、日志监控和 AI 工具后端。",
      url: "https://www.zhipin.com"
    },
    {
      id: "demo-pm-1",
      title: "AI 产品实习生",
      company: "腾讯",
      salary: "200-300/天",
      location: "深圳",
      description: "负责 AI 产品需求分析、竞品调研、数据指标、原型设计和项目推进。",
      url: "https://www.zhipin.com"
    }
  ];
  return samples.map((job) => ({ ...job, matchScore: scoreJob(job, profile, role), source: "demo" }));
}

function normalize(rawText) {
  const text = String(rawText || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();
  return markResumeHeadings(text);
}

const RESUME_HEADINGS = [
  "个人信息", "基本信息", "联系方式", "教育经历", "教育背景", "项目经历", "项目经验",
  "实习经历", "工作经历", "工作经验", "实践经历", "校园经历", "专业技能", "技能特长",
  "技能栈", "技能", "荣誉证书", "荣誉", "奖项", "证书", "自我评价", "个人简介"
];

function markResumeHeadings(text) {
  return RESUME_HEADINGS.reduce((current, heading) => (
    current.replace(new RegExp(`(^|[\\s。；;])${escapeRegExp(heading)}[：:]?(?=\\s|$)`, "g"), `$1\n${heading}\n`)
  ), text).replace(/\n{3,}/g, "\n\n").trim();
}

function firstMatch(text, regex) {
  return (text.match(regex) || [])[0] || "";
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function compactSentence(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function compactResumeBullet(value, roleProfile, metrics, experience = false) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const cleaned = text
    .replace(/针对[^：:。]{0,30}重写[:：]?\s*/g, "")
    .replace(/。?针对[^。]{0,50}。/g, "")
    .replace(/项目经历[:：]?/g, "")
    .replace(/实习\/?工作经历[:：]?/g, "")
    .replace(/实习经历[:：]?/g, "")
    .replace(/工作经历[:：]?/g, "")
    .replace(/当前材料匹配度.*?。/g, "")
    .replace(/所有生成内容均来自原始材料.*?。/g, "")
    .trim();
  const focus = experience ? "实习/工作" : "项目";
  const metric = metrics[0] ? `；量化结果 ${metrics[0]}` : "";
  const lead = cleaned.includes("：") ? cleaned : `${focus}描述：${cleaned}`;
  return compactSentence(`${lead}；聚焦 ${roleProfile.label}${metric}`, 160);
}

function normalizeResumeSection(items, type) {
  const cleaned = (items || [])
    .map((item) => sanitizeResumeSection(item, type))
    .filter(Boolean);
  return dedupeBySemantic(cleaned);
}

function sanitizeResumeSection(item, type) {
  const text = compactSentence(item, 180);
  const lower = text.toLowerCase();
  if (!text) return "";
  if (/^https?:\/\//i.test(text) || /@/.test(text) || /\b(?:email|phone|github|wechat)\b/i.test(text) || /邮箱|手机|联系方式|电话|微信|github/i.test(text)) return "";
  if (/^.*?(?:技能|skills?|education|education经历|education:|项目经历|实习经历|工作经历|个人简介)[:：]/i.test(text) && !/项目|系统|平台|agent|rag|实习|工作/i.test(text)) return "";
  if (/^\d{4}[-/.]\d{1,2}/.test(text)) return text;
  if (type === "project") {
    if (/教育|学校|学院|专业|学历|gpa|课程|证书|奖学金|手机号|邮箱|联系方式|个人简介|技能|技术栈|Python|React|FastAPI|SQL|Git|Docker/i.test(text) && !/项目|系统|平台|Agent|RAG|应用|工具|引擎/i.test(text)) return "";
    if (/实习|工作|公司|岗位|任职|intern/i.test(text) && !/项目|系统|平台|agent|rag/i.test(text)) return "";
    if (/[,，/、].{0,20}[,，/、].{0,20}[,，/、]/.test(text) && !/项目|系统|平台|agent|rag/i.test(text)) return "";
    if (/^(?:python|react|fastapi|sql|git|docker|vue|java|go|typescript|llm|rag|agent)(?:[,\s，/、]|$)/i.test(text) && !/项目|系统|平台|agent|rag/i.test(text)) return "";
  }
  if (type === "experience") {
    if (/教育|学校|学院|专业|学历|gpa|课程|证书|奖学金|项目|个人简介|技能|技术栈/i.test(text) && !/公司|岗位|实习|工作|intern/i.test(text)) return "";
    if (/^(?:python|react|fastapi|sql|git|docker|vue|java|go|typescript|llm|rag|agent)(?:[,\s，/、]|$)/i.test(text) && !/公司|岗位|实习|工作|intern/i.test(text)) return "";
  }
  return text;
}

function normalizeStringList(value, fallback = [], limit = 6) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return Array.from(new Set((source || []).flatMap((item) => {
    if (!item) return [];
    if (typeof item === "string") return [item.trim()].filter(Boolean);
    if (typeof item === "object") {
      const parts = [item.name, item.role, item.stack, item.description, ...(item.bullets || [])].filter(Boolean);
      return [parts.join("：").trim()].filter(Boolean);
    }
    return [String(item).trim()].filter(Boolean);
  }))).slice(0, limit);
}

function inferName(lines) {
  const first = lines.find((line) => line.length >= 2 && line.length <= 16 && !/[：:|/@]/.test(line));
  return first || "候选人";
}

function inferTitle(skills, projects, experience) {
  const text = [...skills, ...projects, ...experience].join(" ");
  if (/RAG|LLM|Agent|Prompt/i.test(text)) return "AI 应用工程候选人";
  if (/React|Vue|前端/i.test(text)) return "前端工程候选人";
  if (/FastAPI|Spring|后端|数据库/i.test(text)) return "后端工程候选人";
  if (/产品|PRD|需求/i.test(text)) return "产品候选人";
  if (/运营|增长|活动/i.test(text)) return "运营候选人";
  return "求职候选人";
}

function extractSkills(text) {
  const lower = text.toLowerCase();
  return SKILL_BANK.filter((skill) => lower.includes(skill.toLowerCase()) || text.includes(skill));
}

function extractSkillItems(lines) {
  return extractNamedSection(lines, ["技能", "技能栈", "专业技能", "技能特长", "Skills"], "skills")
    .flatMap((line) => line.split(/[、,，/|；;]+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 32 && !/^技能/.test(item));
}

function extractSection(lines, keys, radius) {
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (keys.some((key) => lines[index].includes(key))) {
      hits.push(...lines.slice(index, index + radius));
    }
  }
  return Array.from(new Set(hits)).slice(0, 8);
}

function extractBlocks(lines, keys) {
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (keys.some((key) => line.toLowerCase().includes(String(key).toLowerCase()))) {
      blocks.push(lines.slice(index, index + 5).join("；"));
    }
  }
  return Array.from(new Set(blocks)).slice(0, 8);
}

function extractProjectBlocks(lines) {
  const sectionItems = extractNamedSection(lines, ["项目经历", "项目经验", "Projects", "Project Experience"], "project");
  if (sectionItems.length) return sectionItems;
  return extractBlocks(lines, ["项目", "Project", "Hackathon", "系统", "平台", "Agent", "RAG", "应用", "工具", "引擎"])
    .map((item) => sanitizeResumeSection(item, "project"))
    .filter(Boolean);
}

function extractExperienceBlocks(lines, projects) {
  const sectionItems = extractNamedSection(lines, ["实习经历", "工作经历", "实践经历", "Experience", "Internship Experience"], "experience");
  const blocks = sectionItems.length
    ? sectionItems
    : extractBlocks(lines, ["实习", "工作经历", "工作", "公司", "岗位", "职责", "任职", "Experience", "Intern"]);
  const projectFingerprints = new Set(projects.map(fingerprint));
  return blocks.filter((block) => !projectFingerprints.has(fingerprint(block)) || /实习|公司|岗位|任职|Intern/i.test(block));
}

function extractNamedSection(lines, headings, type) {
  const normalizedHeadings = headings.map((heading) => heading.toLowerCase());
  const start = lines.findIndex((line) => {
    const normalizedLine = line.replace(/[：:]$/, "").trim().toLowerCase();
    return normalizedHeadings.includes(normalizedLine);
  });
  if (start < 0) return [];
  const items = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (isResumeSectionHeading(line)) break;
    const sanitized = line
      .replace(/^[-•·*]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/^https?:\/\//i.test(sanitized) || /邮箱|手机|联系方式|电话|微信/i.test(sanitized)) continue;
    if (sanitized) items.push(sanitized);
  }
  return dedupeStrings(items);
}

function isResumeSectionHeading(line) {
  return /^(?:个人简介|求职目标|教育经历|教育背景|项目经历|项目经验|实习经历|工作经历|实践经历|技能|技能栈|专业技能|荣誉|奖项|证书|自我评价|projects?|project experience|experience|internship experience|skills?|education|awards?)[：:]?$/i.test(String(line || "").trim());
}

function inferProjectBlocksFromLongText(text) {
  if (!text) return [];
  return text
    .split(/[。；\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 16)
    .slice(0, 4);
}

function separateProjectsAndExperience(projects, experience) {
  const dedupedProjects = dedupeStrings(projects);
  const projectFingerprints = new Set(dedupedProjects.map(fingerprint));
  const dedupedExperience = dedupeStrings(experience)
    .filter((item) => !projectFingerprints.has(fingerprint(item)) || /实习|公司|岗位|任职|Intern|工作/i.test(item))
    .filter((item) => !dedupedProjects.some((project) => semanticOverlap(project, item) > 0.65));
  return { projects: dedupedProjects, experience: dedupedExperience };
}

function dedupeStrings(items) {
  const seen = new Set();
  const output = [];
  for (const item of items || []) {
    const key = fingerprint(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function dedupeBySemantic(items) {
  const output = [];
  for (const item of items || []) {
    if (!item) continue;
    if (output.some((existing) => semanticOverlap(existing, item) > 0.72)) continue;
    output.push(item);
  }
  return output;
}

function fingerprint(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 90);
}

function semanticOverlap(left, right) {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / Math.max(a.size, b.size);
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function confidenceScore({ text, skills, projects, experience, education, contact }) {
  let score = 20;
  if (text.length > 600) score += 18;
  if (skills.length >= 5) score += 18;
  else if (skills.length >= 1) score += 8;
  if (projects.length) score += 18;
  if (experience.length) score += 10;
  if (education.length) score += 8;
  if (contact.email || contact.phone) score += 8;
  return Math.min(98, score);
}

function diagnoseProfile(profile) {
  const gaps = [];
  if (!profile.contact.email && !profile.contact.phone) gaps.push("缺少邮箱或手机号，导出简历前需要补充联系方式。");
  if (profile.skills.length < 6) gaps.push("技能栈过少，建议补充语言、框架、数据库、AI 工具和协作工具。");
  if (profile.projects.length < 2) gaps.push("项目经历不足，建议至少补充 2 个能证明能力的项目。");
  if (!profile.metrics.length) gaps.push("缺少量化结果，例如题目数、准确率、耗时、用户数、转化率或效率提升。");
  if (!profile.experience.length) gaps.push("缺少实习/工作经历，可补充课程项目、社团项目或个人产品经历替代。");
  const strengths = [];
  if (/AI|LLM|RAG|Agent/i.test(profile.skills.join(" "))) strengths.push("有 AI 应用关键词，适合包装 AI Agent / RAG 岗位。");
  if (/React|Vue|Vite/i.test(profile.skills.join(" "))) strengths.push("有前端工程栈，可转成 AI 产品前端/控制台方向。");
  if (/FastAPI|Python|SQLite|数据库/i.test(profile.skills.join(" "))) strengths.push("有后端/数据处理基础，可强调工程落地。");
  if (profile.metrics.length) strengths.push("已有可量化指标，适合写成结果导向 bullet。");
  return { gaps, strengths, completeness: profile.sourceConfidence };
}

function scoreRole(profile, role, jd = "") {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  const corpus = [profile.skills.join(" "), profile.projects.join(" "), profile.experience.join(" "), jd].join(" ");
  const hits = roleProfile.keywords.filter((keyword) => corpus.toLowerCase().includes(keyword.toLowerCase()));
  const score = Math.max(35, Math.min(98, 45 + hits.length * 6 + profile.projects.length * 3 + profile.metrics.length * 1.4));
  return {
    score: Math.round(score),
    hits,
    strengths: hits.length ? hits.map((hit) => `匹配 ${roleProfile.label} 关键词：${hit}`) : [`材料中还没有明显 ${roleProfile.label} 信号。`],
    gaps: roleProfile.missing.filter((item) => !corpus.includes(item.slice(0, 2))).slice(0, 4)
  };
}

function rankSkills(skills, keywords) {
  const exact = skills.filter((skill) => keywords.some((keyword) => skill.toLowerCase().includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(skill.toLowerCase())));
  const rest = skills.filter((skill) => !exact.includes(skill));
  return Array.from(new Set([...exact, ...rest]));
}

function selectProjects(items, keywords, jd) {
  const corpus = `${keywords.join(" ")} ${jd}`.toLowerCase();
  return [...items].sort((a, b) => scoreText(b, corpus) - scoreText(a, corpus));
}

function buildProjectStrategy(items, roleProfile, jd, metrics) {
  const keywords = uniqueStrings([...roleProfile.keywords, ...extractJdKeywords(jd)]);
  return (items || [])
    .map((original, sourceIndex) => {
      const matchedKeywords = keywords.filter((keyword) => looseIncludes(original, keyword));
      const metricEvidence = (metrics || []).filter((metric) => String(original).includes(metric));
      const title = extractProjectTitle(original, sourceIndex);
      const tailoredBullet = tailorProjectBullet(original, keywords, title);
      const rawScore = matchedKeywords.length * 12 + metricEvidence.length * 8 + (title ? 4 : 0);
      const relevanceScore = Math.min(98, Math.max(36, 42 + rawScore));
      return {
        id: `project-${sourceIndex + 1}`,
        title,
        original,
        tailoredBullet,
        matchedKeywords: matchedKeywords.slice(0, 8),
        relevanceScore,
        emphasis: roleProfile.focus,
        evidenceStatus: metricEvidence.length ? "quantified" : "needs-metric",
        evidence: metricEvidence,
        interviewQuestions: buildProjectQuestions(title, matchedKeywords, metricEvidence)
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a.title.localeCompare(b.title, "zh-CN"));
}

function extractJdKeywords(jd) {
  const stopwords = new Set(["负责", "岗位", "要求", "熟悉", "掌握", "具备", "优先", "相关", "工作", "能力", "以及", "进行", "完成", "重视"]);
  return String(jd || "")
    .split(/[\s,，、/|;；:：()（）]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && term.length <= 24 && !stopwords.has(term));
}

function looseIncludes(text, keyword) {
  const haystack = String(text || "").toLowerCase();
  const needle = String(keyword || "").toLowerCase();
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  if (/^[\u4e00-\u9fff]{4,}$/.test(needle)) {
    return [...new Set(needle.match(/[\u4e00-\u9fff]{2}/g) || [])].some((part) => haystack.includes(part));
  }
  return false;
}

function extractProjectTitle(block, sourceIndex) {
  const text = String(block || "").trim();
  const explicit = text.match(/^([^：:。；;]{2,32})[：:]/);
  if (explicit) return explicit[1].replace(/^项目经历\s*/i, "").trim();
  const firstPhrase = text.split(/[。；;，,]/)[0].replace(/^项目经历\s*/i, "").trim();
  return firstPhrase.slice(0, 28) || `项目 ${sourceIndex + 1}`;
}

function tailorProjectBullet(original, keywords, title) {
  const text = String(original || "").replace(/^项目经历\s*/i, "").trim().replace(/[。；;]+$/, "");
  const body = text.replace(new RegExp(`^${escapeRegExp(title)}[：:]?`), "").trim();
  const clauses = body.split(/[。；;]+/).map((item) => item.trim()).filter(Boolean);
  const ranked = clauses
    .map((clause, index) => ({ clause, index, score: keywords.filter((keyword) => looseIncludes(clause, keyword)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.clause)
    .slice(0, 3);
  const evidence = ranked.length ? ranked.join("；") : body;
  return compactSentence(`${title}｜${evidence}`, 180);
}

function buildProjectQuestions(title, matchedKeywords, metricEvidence) {
  const anchor = matchedKeywords[0] || "核心方案";
  return [
    `请用 30 秒说明「${title}」解决的问题、你的职责和最终结果。`,
    `围绕 ${anchor}，你比较过哪些方案，为什么选择现在的实现？`,
    `这个项目最难定位的一次问题是什么，你如何验证根因？`,
    metricEvidence.length
      ? `简历中的 ${metricEvidence.slice(0, 2).join("、")} 如何测得，测试口径和样本是什么？`
      : "如果重做一次，你会补哪一个可量化指标来证明效果？"
  ];
}

function buildInterviewPlan({ role, roleProfile, projectStrategy, gaps, skills }) {
  const technicalTopics = (INTERVIEW_BLUEPRINTS[role] || INTERVIEW_BLUEPRINTS.ai).map(([title, why], index) => ({
    id: `topic-${index + 1}`,
    title,
    why,
    priority: index < 2 ? "P0" : "P1"
  }));
  const storyBank = projectStrategy.slice(0, 3).map((project) => ({
    project: project.title,
    opening: `我在「${project.title}」中重点解决了什么问题？`,
    proof: project.evidence.length ? project.evidence.join(" / ") : "待补充量化结果",
    roleConnection: project.matchedKeywords.length
      ? `可证明 ${roleProfile.label} 所需的 ${project.matchedKeywords.slice(0, 4).join(" / ")}`
      : `需要补充与 ${roleProfile.label} 更直接的证据`,
    questions: project.interviewQuestions
  }));
  const gapFocus = gaps.length ? gaps.join("、") : "边界条件与失败复盘";
  const topSkills = skills.slice(0, 4).join(" / ") || "岗位核心技能";
  const schedule = [
    ["Day 1", "校准 JD", `逐条标记岗位要求，并核对 ${topSkills} 的事实证据。`],
    ["Day 2", "项目一号", storyBank[0] ? `完成「${storyBank[0].project}」2 分钟讲稿与追问。` : "补齐一个最相关项目的背景、动作和结果。"],
    ["Day 3", "项目二号", storyBank[1] ? `完成「${storyBank[1].project}」方案取舍、失败与复盘。` : "准备第二个互补项目或课程实践。"],
    ["Day 4", "技术主线", `复习 ${technicalTopics.slice(0, 2).map((item) => item.title).join("、")}，每题先讲思路再下结论。`],
    ["Day 5", "补齐短板", `集中处理：${gapFocus}。只补能真实说明的证据。`],
    ["Day 6", "模拟面试", "进行 45 分钟模拟：自我介绍、项目深挖、技术题、反问；记录卡顿点。"],
    ["Day 7", "复盘收口", "压缩答案、复测薄弱题，准备 3 个针对团队和岗位的反问。"]
  ].map(([day, title, action]) => ({ day, title, action }));
  return {
    roleLabel: roleProfile.label,
    technicalTopics,
    storyBank,
    schedule,
    resumeDefense: uniqueStrings(storyBank.flatMap((story) => story.questions)).slice(0, 8)
  };
}

function uniqueStrings(items) {
  return [...new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreText(text, corpus) {
  return corpus.split(/\s+/).filter((term) => term && text.toLowerCase().includes(term.toLowerCase())).length;
}

function buildSummary(profile, roleProfile, skills, roleScore) {
  const topSkills = skills.slice(0, 5).join("、") || "业务分析、项目交付";
  return `${profile.name}，${profile.title}。面向${roleProfile.label}，重点突出${roleProfile.focus} 当前材料匹配度 ${roleScore.score}，核心能力包括 ${topSkills}。`;
}

function rewriteBlock(block, roleProfile, metrics) {
  const metric = metrics[0] ? `，结果包含 ${metrics[0]} 等可量化指标` : "";
  return `${block}。针对${roleProfile.label}重写：${roleProfile.focus}${metric}。`;
}

function buildGreeting(profile, roleProfile, project, score) {
  const projectHint = project ? `我最近的相关项目包括：${project.slice(0, 80)}。` : "";
  return `您好，我想投递${roleProfile.title}。我的经历与岗位匹配度约 ${score.score}/100，${projectHint}如果方便，希望进一步沟通岗位要求。`;
}

function buildDiff(profile, roleProfile, skills) {
  return [
    `技能顺序调整：优先展示 ${skills.slice(0, 5).join(" / ") || "岗位关键词"}`,
    `叙事重心调整：${roleProfile.focus}`,
    `风险提示：所有生成内容均来自原始材料，缺口信息需要用户补充后再写入简历。`
  ];
}
