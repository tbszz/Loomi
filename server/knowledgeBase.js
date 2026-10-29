import { ROLE_PROFILES, scoreJob } from "./resumeEngine.js";

export const PROFILE_REQUIREMENTS = [
  {
    id: "basic",
    label: "基本信息",
    prompt: "请补充姓名、手机号、邮箱、所在城市、GitHub/作品集链接。",
    isComplete(profile) {
      return Boolean(profile.name && profile.name !== "候选人" && (profile.contact.email || profile.contact.phone));
    }
  },
  {
    id: "education",
    label: "教育经历",
    prompt: "请补充学校、专业、学历和预计毕业时间；成绩与课程仅在有助于目标岗位时提供。",
    isComplete(profile) {
      return profile.education.length > 0;
    }
  },
  {
    id: "internship",
    label: "实习/工作经历",
    prompt: "请补充公司/组织、岗位、时间、职责、协作对象、产出和量化结果。",
    isComplete(profile) {
      return profile.experience.length > 0;
    }
  },
  {
    id: "projects",
    label: "项目经历",
    prompt: "请补充项目背景、你的职责、技术栈、关键难点、结果指标和链接。",
    isComplete(profile) {
      return profile.projects.length >= 1;
    }
  },
  {
    id: "skills",
    label: "技能栈",
    prompt: "请补充语言、框架、数据库、AI 工具、工程工具和协作工具。",
    isComplete(profile) {
      return profile.skills.length >= 1;
    }
  },
  {
    id: "awards",
    optional: true,
    label: "荣誉/证书/竞赛",
    prompt: "请补充奖学金、竞赛奖项、证书、论文、开源贡献或可替代证明。",
    isComplete(profile) {
      return profile.awards.length > 0 || profile.metrics.length >= 2;
    }
  },
  {
    id: "target",
    label: "求职目标",
    prompt: "请补充目标岗位、城市、校招/实习/社招、期望行业和偏好的公司类型。",
    isComplete(_profile, options = {}) {
      return Boolean(options.role && options.job);
    }
  }
];

export const TEMPLATE_LIBRARY = [
  {
    id: "reactive-azurill",
    label: "Azurill 清爽单栏",
    source: "Inspired by Reactive Resume",
    bestFor: "校招、实习、通用技术岗",
    density: "medium",
    accent: "#2563eb",
    layout: "single",
    notes: "参考 Reactive Resume 的多模板思路，强调清晰分区和可读性。"
  },
  {
    id: "reactive-bronzor",
    label: "Bronzor 极简正式",
    source: "Inspired by Reactive Resume",
    bestFor: "后端、算法、研究型岗位",
    density: "compact",
    accent: "#111827",
    layout: "single",
    notes: "黑白高密度，适合一页内容较多的正式投递。"
  },
  {
    id: "reactive-chikorita",
    label: "Chikorita 清新校园",
    source: "Inspired by Reactive Resume",
    bestFor: "校招、产品、运营、设计协作岗",
    density: "medium",
    accent: "#0f766e",
    layout: "single",
    notes: "更突出教育、奖项、校园经历和软技能。"
  },
  {
    id: "reactive-gengar",
    label: "Gengar 技术强信号",
    source: "Inspired by Reactive Resume",
    bestFor: "AI、后端、工程平台岗位",
    density: "compact",
    accent: "#6d28d9",
    layout: "single",
    notes: "强调技能关键词、项目指标和工程复杂度。"
  },
  {
    id: "resumify-ats",
    label: "ATS 标准解析",
    source: "Inspired by Resumify",
    bestFor: "招聘系统投递、通用岗位",
    density: "medium",
    accent: "#1f2937",
    layout: "single",
    notes: "减少装饰，适合 ATS 和人工快速扫读。"
  },
  {
    id: "cn-campus",
    label: "中文校招一页",
    source: "Local CN template",
    bestFor: "大厂校招、实习转正",
    density: "compact",
    accent: "#b45309",
    layout: "single",
    notes: "教育、项目、竞赛/荣誉权重更高。"
  },
  {
    id: "ai-lab",
    label: "AI 应用工程版",
    source: "Local AI template",
    bestFor: "AI Agent、RAG、LLM 应用",
    density: "compact",
    accent: "#0e7490",
    layout: "single",
    notes: "突出模型链路、数据/检索、评测、上线闭环。"
  },
  {
    id: "product-ops",
    label: "产品运营增长版",
    source: "Local product template",
    bestFor: "产品、运营、增长、用户研究",
    density: "medium",
    accent: "#be123c",
    layout: "single",
    notes: "突出用户场景、指标、流程设计和复盘。"
  },
  {
    id: "backend-dense",
    label: "后端工程高密度",
    source: "Local backend template",
    bestFor: "后端、平台、基础架构",
    density: "compact",
    accent: "#334155",
    layout: "single",
    notes: "强调接口、数据库、并发、稳定性和监控。"
  },
  {
    id: "frontend-polished",
    label: "前端体验作品集版",
    source: "Local frontend template",
    bestFor: "前端、AI 产品前端、可视化",
    density: "medium",
    accent: "#7c3aed",
    layout: "single",
    notes: "突出交互复杂度、组件化、性能和视觉还原。"
  }
];

// The official employer registry lives in `server/officialJobSources.js`.  This
// module used to keep a second 34-company list plus a "radar" that combined it
// with the role library to emit cards labelled `official-career-site`.  Those
// cards were synthesized, not fetched, so they are gone: Job Knowledge has one
// source of truth and it never invents a posting.

export const JOB_ROLE_LIBRARY = [
  roleCard("ai", "AI Agent / RAG 应用工程师", {
    campus: ["熟悉 Python 与至少一种 Web 框架", "理解 LLM、Prompt、RAG、向量检索、Agent 工具调用", "有 AI 应用项目、评测集、Demo 或比赛经历", "能说明数据来源、召回/准确率/响应时间等指标"],
    internship: ["参与模型应用、知识库、智能客服、办公自动化等场景", "能完成接口联调、Prompt 迭代、评测记录和问题归因", "有快速学习和文档沉淀能力"],
    social: ["能设计端到端 LLM 应用架构", "熟悉检索、重排、模型路由、观测、成本控制", "有线上服务稳定性、权限、安全和数据治理经验"]
  }),
  roleCard("backend", "后端开发工程师", {
    campus: ["数据结构与算法基础扎实", "熟悉 Python/Java/Go 至少一种语言", "理解数据库、缓存、HTTP、Linux 和 Git", "有接口设计、文件处理或任务调度项目"],
    internship: ["能独立完成模块开发、接口联调和问题排查", "熟悉日志、异常处理、单元测试和代码评审", "能把需求拆成清晰开发任务"],
    social: ["有高并发、分布式、性能优化、监控告警经验", "理解系统边界、数据一致性和可观测性", "能主导服务设计和稳定性治理"]
  }),
  roleCard("frontend", "前端开发工程师", {
    campus: ["熟悉 HTML/CSS/JavaScript/React 或 Vue", "理解组件化、状态管理、响应式布局和工程化", "有复杂表单、控制台、可视化或交互项目"],
    internship: ["能完成页面开发、接口联调、兼容性处理", "关注可用性、加载性能和视觉还原", "能沉淀组件和交互规范"],
    social: ["能设计前端架构、性能优化和工程质量体系", "熟悉 TypeScript、构建工具、测试和监控", "能处理复杂业务状态和跨团队协作"]
  }),
  roleCard("product", "AI 产品经理 / 产品助理", {
    campus: ["能做需求分析、用户流程、竞品拆解和 PRD", "理解 AI 能力边界和落地场景", "有原型、数据指标、用户调研或项目推进经历"],
    internship: ["能协助需求收集、版本排期、验收和复盘", "能把业务问题拆成可执行方案", "有跨研发/设计/运营协作能力"],
    social: ["能负责产品线指标、策略和商业闭环", "熟悉 AI 工作流、数据分析和增长实验", "能做路线图和资源优先级决策"]
  }),
  roleCard("ops", "AI 运营 / 增长运营", {
    campus: ["理解内容、用户、活动、社群或渠道运营", "能做数据看板、转化分析和复盘", "有 AI 工具提效、内容生产或活动执行经历"],
    internship: ["能完成内容策划、用户触达、活动执行和数据复盘", "能用 Excel/SQL/BI 或 AI 工具提升效率", "关注转化率、留存和用户反馈"],
    social: ["能搭建增长策略、用户分层和自动化运营体系", "有预算、渠道、商业化或规模化增长经验", "能持续优化漏斗指标"]
  })
];

export function analyzeCompleteness(profile, options = {}) {
  const fields = PROFILE_REQUIREMENTS.map((item) => {
    const complete = item.isComplete(profile, options);
    return {
      id: item.id,
      label: item.label,
      complete,
      optional: Boolean(item.optional),
      prompt: complete ? "已提供相关材料，具体是否满足岗位要求仍需核对。" : item.prompt,
      evidence: collectEvidence(item.id, profile)
    };
  });
  const required = fields.filter(item=>!item.optional);
  const completed = required.filter((item) => item.complete).length;
  return {
    fields,
    missing: required.filter((item) => !item.complete),
    completeness: Math.round((completed / required.length) * 100),
    readyForResume: fields.every((item) => item.id === "awards" || item.complete)
  };
}

export function buildJobLibrary({ profile, query = "", type = "campus" } = {}) {
  const normalizedQuery = String(query || "").toLowerCase();
  return JOB_ROLE_LIBRARY.map((role) => {
    const description = [
      role.title,
      ...(role.requirements[type] || role.requirements.campus),
      role.keywords.join(" ")
    ].join("；");
    const job = {
      id: `library-${role.role}-${type}`,
      title: role.title,
      company: "岗位情报库",
      source: "role-library",
      sourceUrl: "",
      role: role.role,
      type,
      salary: "",
      location: "多城市",
      requirements: role.requirements[type] || role.requirements.campus,
      description,
      tags: role.keywords,
      matchScore: profile ? scoreJob({ title: role.title, description, tags: role.keywords }, profile, role.role) : 70,
      hidden: normalizedQuery && !description.toLowerCase().includes(normalizedQuery)
    };
    return enrichOpportunity(job, { ok: true, companyPreference: 65 }, profile, type, role.role);
  }).filter((item) => !item.hidden);
}

export async function importJobFromUrl({ url, profile, role = "ai" }) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 ResumeProtocol/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`导入失败：HTTP ${response.status}`);
  const html = await response.text();
  const text = htmlToText(html);
  const title = extractTitle(html) || text.slice(0, 36) || "导入岗位";
  const description = text.slice(0, 1600);
  return {
    id: `import-${Date.now()}`,
    title,
    company: extractCompanyFromUrl(url),
    source: "imported-url",
    sourceUrl: url,
    role,
    type: "imported",
    salary: "",
    location: "",
    requirements: extractRequirementLines(description),
    description,
    tags: inferTags(description),
    matchScore: profile ? scoreJob({ title, description, tags: inferTags(description) }, profile, role) : 70
  };
}

function roleCard(role, title, requirements) {
  const profile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  return { role, title, label: profile.label, keywords: profile.keywords, requirements };
}

function enrichOpportunity(job, source, profile, type, role) {
  const match = job.matchScore || (profile ? scoreJob(job, profile, role) : 70);
  const freshness = source.ok ? Math.max(72, 96 - Math.round((source.latencyMs || 0) / 260)) : 45;
  const apply = source.ok ? 92 : 56;
  const company = source.preference || source.companyPreference || 70;
  const typeFit = source.types?.includes(type) ? 92 : 64;
  const opportunityScore = Math.round(match * 0.45 + freshness * 0.2 + apply * 0.15 + company * 0.1 + typeFit * 0.1);
  return {
    ...job,
    matchScore: match,
    opportunityScore,
    opportunityBreakdown: {
      match,
      freshness,
      apply,
      company,
      typeFit
    }
  };
}

function collectEvidence(id, profile) {
  if (id === "basic") return [profile.name, profile.contact.email, profile.contact.phone].filter(Boolean).join(" / ");
  if (id === "education") return profile.education.slice(0, 2).join("；");
  if (id === "internship") return profile.experience.slice(0, 2).join("；");
  if (id === "projects") return profile.projects.slice(0, 2).join("；");
  if (id === "skills") return profile.skills.slice(0, 8).join(" / ");
  if (id === "awards") return [...profile.awards, ...profile.metrics].slice(0, 4).join(" / ");
  return "";
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  return (String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCompanyFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "导入来源";
  }
}

function extractRequirementLines(text) {
  const parts = String(text || "").split(/[。；;\n]/).map((item) => item.trim()).filter((item) => item.length > 12);
  return parts.filter((item) => /要求|负责|熟悉|经验|能力|优先|岗位|职责|技术|产品|运营|数据|AI|LLM|React|Python/i.test(item)).slice(0, 8);
}

function inferTags(text) {
  const tags = ["AI", "LLM", "RAG", "Python", "Java", "Go", "React", "Vue", "TypeScript", "产品", "运营", "数据分析", "SQL", "后端", "前端"];
  return tags.filter((tag) => String(text || "").toLowerCase().includes(tag.toLowerCase()));
}
