import { ROLE_PROFILES, scoreJob } from "./resumeEngine.js";

export const CAMPUS_AGGREGATOR_URL = "http://101.132.173.68/campus/campus_recruit.html";

export const CAMPUS_AGGREGATOR_SOURCE = {
  id: "campus-aggregator",
  company: "2026 校招聚合源",
  group: "第三方校招聚合源",
  url: CAMPUS_AGGREGATOR_URL,
  types: ["campus", "internship"],
  trust: "aggregated",
  sourceType: "third-party-aggregator",
  preference: 78
};

const ROLE_HINTS = {
  ai: ["AI", "AIGC", "LLM", "RAG", "Agent", "算法", "人工智能", "大模型", "机器学习", "深度学习", "NLP", "CV", "智能"],
  backend: ["后端", "服务端", "Java", "Python", "Go", "C++", "开发工程师", "数据库", "平台", "架构"],
  frontend: ["前端", "React", "Vue", "Web", "小程序", "TypeScript", "JavaScript", "交互", "可视化"],
  product: ["产品", "PM", "需求", "用户", "策略", "商业化", "解决方案"],
  ops: ["运营", "增长", "内容", "社群", "用户运营", "活动", "新媒体", "市场"]
};

const TYPE_HINTS = {
  campus: ["校招", "春招", "秋招", "提前批", "补录", "26春招", "27春招", "26秋招", "27秋招"],
  internship: ["实习", "日常实习", "暑期实习", "仅实习"]
};

export async function refreshCampusAggregator({ query = "", type = "campus", profile, limit = 120 } = {}) {
  const startedAt = Date.now();
  const response = await fetch(CAMPUS_AGGREGATOR_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 ResumeProtocol/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`聚合源抓取失败：HTTP ${response.status}`);
  const html = await response.text();
  return refreshCampusAggregatorFromHtml({
    html,
    query,
    type,
    profile,
    limit,
    fetchedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    headers: {
      lastModified: response.headers.get("last-modified") || "",
      etag: response.headers.get("etag") || "",
      contentLength: response.headers.get("content-length") || ""
    }
  });
}

export function refreshCampusAggregatorFromHtml({
  html,
  query = "",
  type = "campus",
  profile,
  limit = 120,
  fetchedAt = new Date().toISOString(),
  latencyMs = 0,
  headers = {}
} = {}) {
  const rows = parseCampusAggregatorHtml(html);
  const filteredRows = rows
    .filter((row) => matchesType(row, type))
    .filter((row) => matchesQuery(row, query))
    .slice(0, Math.max(1, limit));
  const status = {
    ...CAMPUS_AGGREGATOR_SOURCE,
    ok: true,
    status: 200,
    fetchedAt,
    latencyMs,
    syncStatus: "synced",
    title: extractTitle(html) || "2026年校园招聘信息汇总",
    textSample: `抓取 ${rows.length} 条聚合招聘记录，当前筛选 ${filteredRows.length} 条。`,
    note: "第三方聚合源，已保留原始来源链接和网申链接。",
    rawJobs: rows.length,
    matchedJobs: filteredRows.length,
    lastModified: headers.lastModified || "",
    etag: headers.etag || ""
  };
  const jobs = filteredRows
    .map((row, index) => toAggregatorJob(row, { profile, type, fetchedAt, index }))
    .sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0));
  return {
    refreshedAt: fetchedAt,
    sources: [status],
    jobs,
    summary: buildAggregatorSummary(status, jobs)
  };
}

export function parseCampusAggregatorHtml(html = "") {
  const marker = "const RAW_DATA = ";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error("未找到 RAW_DATA，聚合源页面结构可能已变化。");
  const arrayStart = html.indexOf("[", markerIndex);
  if (arrayStart < 0) throw new Error("RAW_DATA 起始数组不存在。");
  const arrayEnd = findJsonArrayEnd(html, arrayStart);
  if (arrayEnd < 0) throw new Error("RAW_DATA 数组未闭合。");
  const data = JSON.parse(html.slice(arrayStart, arrayEnd));
  if (!Array.isArray(data)) throw new Error("RAW_DATA 不是数组。");
  return data;
}

function findJsonArrayEnd(text, arrayStart) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = arrayStart; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function toAggregatorJob(row, { profile, type, fetchedAt, index }) {
  const role = inferRole(row);
  const title = makeJobTitle(row);
  const tags = inferTags(row);
  const description = [
    `${row.company || "未知公司"} ${typeLabel(normalizeType(row, type))}招聘。`,
    `岗位：${row.positions || "岗位未标注"}`,
    row.evaluation ? `公司/岗位评价：${row.evaluation}` : "",
    row.industry ? `行业：${row.industry}` : "",
    row.year ? `面向届别：${row.year}` : "",
    row.education ? `学历：${row.education}` : "",
    row.linkSource ? `信息来源：${row.linkSource}` : ""
  ].filter(Boolean).join(" ");
  const baseJob = {
    id: `campus-${hashRecord(row)}-${index}`,
    title,
    company: row.company || "未知公司",
    source: "campus-aggregator",
    sourceUrl: row.appLink || row.sourceLink || CAMPUS_AGGREGATOR_URL,
    sourceGroup: "第三方校招聚合源",
    originSourceUrl: row.sourceLink || "",
    applyUrl: row.appLink || "",
    trust: "aggregated",
    role,
    type: normalizeType(row, type),
    salary: "",
    location: row.location || "未标注",
    city: row.location || "未标注",
    updatedAt: row.fullDate || row.updateDate || fetchedAt,
    deadline: row.fullDate || row.updateDate || "以来源为准",
    requirements: buildRequirements(row),
    description,
    tags,
    sourceStatus: "aggregated",
    sourceNote: "来自第三方聚合页面，请以网申链接或信息来源为准。",
    sourceSyncStatus: "synced",
    applyStatus: row.appLink ? "aggregator-apply-link" : "aggregator-source-link",
    matchEvidence: buildAggregatorEvidence(row, profile, role),
    gapKeywords: buildAggregatorGaps(row, profile, role),
    recommendedProjects: recommendProjects(profile, role),
    resumeAdvice: buildAggregatorAdvice(row, role)
  };
  const matchScore = profile ? scoreJob(baseJob, profile, role) : scoreFromRecord(row, role);
  return enrichAggregatorOpportunity({ ...baseJob, matchScore }, row);
}

function buildRequirements(row) {
  return [
    row.batch ? `招聘批次：${row.batch}` : "",
    row.location ? `工作地点：${row.location}` : "",
    row.positions ? `岗位方向：${truncate(row.positions, 90)}` : "",
    row.education ? `学历要求：${row.education}` : "",
    row.year ? `面向届别：${row.year}` : "",
    row.industry ? `行业：${row.industry}` : "",
    row.linkSource ? `信息来源：${row.linkSource}` : ""
  ].filter(Boolean);
}

function enrichAggregatorOpportunity(job, row) {
  const freshness = freshnessScore(row);
  const apply = row.appLink ? 90 : row.sourceLink ? 76 : 48;
  const company = row.evaluation ? 82 : 68;
  const typeFit = job.type === "campus" || job.type === "internship" ? 88 : 62;
  const match = job.matchScore || 70;
  const opportunityScore = Math.round(match * 0.45 + freshness * 0.2 + apply * 0.15 + company * 0.1 + typeFit * 0.1);
  return {
    ...job,
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

function buildAggregatorSummary(source, jobs) {
  return {
    totalSources: 1,
    syncedSources: source.ok ? 1 : 0,
    failedSources: source.ok ? 0 : 1,
    generatedJobs: jobs.length,
    highOpportunityJobs: jobs.filter((job) => (job.opportunityScore || 0) >= 85).length,
    officialVerifiedJobs: jobs.filter((job) => job.applyUrl).length,
    rawJobs: source.rawJobs || 0,
    matchedJobs: source.matchedJobs || jobs.length
  };
}

function matchesType(row, type) {
  if (!type || type === "campus") {
    return !matchesAny(row, TYPE_HINTS.internship) || matchesAny(row, TYPE_HINTS.campus);
  }
  if (type === "internship") return matchesAny(row, TYPE_HINTS.internship);
  return true;
}

function matchesQuery(row, query) {
  const terms = expandQuery(query);
  if (!terms.length) return true;
  const corpus = rowCorpus(row).toLowerCase();
  return terms.some((term) => corpus.includes(term.toLowerCase()));
}

function expandQuery(query) {
  const raw = String(query || "").split(/[\s/，,、|]+/).map((item) => item.trim()).filter(Boolean);
  const joined = raw.join(" ").toLowerCase();
  const expanded = new Set(raw);
  if (/ai|agent|rag|llm|大模型|智能|算法/i.test(joined)) {
    ROLE_HINTS.ai.forEach((term) => expanded.add(term));
  }
  if (/front|react|vue|前端/i.test(joined)) ROLE_HINTS.frontend.forEach((term) => expanded.add(term));
  if (/back|后端|java|python|go/i.test(joined)) ROLE_HINTS.backend.forEach((term) => expanded.add(term));
  if (/product|产品/i.test(joined)) ROLE_HINTS.product.forEach((term) => expanded.add(term));
  if (/ops|运营|增长/i.test(joined)) ROLE_HINTS.ops.forEach((term) => expanded.add(term));
  return [...expanded].filter((term) => term.length >= 2);
}

function inferRole(row) {
  const corpus = rowCorpus(row);
  const scored = Object.entries(ROLE_HINTS).map(([role, terms]) => [
    role,
    terms.filter((term) => corpus.toLowerCase().includes(term.toLowerCase())).length
  ]);
  scored.sort((a, b) => b[1] - a[1]);
  return scored[0]?.[1] ? scored[0][0] : "ai";
}

function inferTags(row) {
  const corpus = rowCorpus(row);
  const tags = ["AI", "LLM", "RAG", "Agent", "Python", "Java", "Go", "React", "Vue", "TypeScript", "算法", "后端", "前端", "产品", "运营", "数据分析", "SQL", "实习", "校招"];
  return tags.filter((tag) => corpus.toLowerCase().includes(tag.toLowerCase()));
}

function normalizeType(row, fallback) {
  if (matchesAny(row, TYPE_HINTS.internship)) return "internship";
  if (matchesAny(row, TYPE_HINTS.campus)) return "campus";
  return fallback || "campus";
}

function matchesAny(row, terms) {
  const corpus = rowCorpus(row);
  return terms.some((term) => corpus.includes(term));
}

function rowCorpus(row) {
  return [
    row.company,
    row.batch,
    row.location,
    row.positions,
    row.evaluation,
    row.industry,
    row.year,
    row.education,
    row.linkSource
  ].filter(Boolean).join(" ");
}

function makeJobTitle(row) {
  const positions = String(row.positions || "").replace(/\s+/g, " ").trim();
  if (!positions) return `${row.company || "聚合源"} 招聘岗位`;
  const first = positions.split(/\s{2,}|、|，|,|;|；/).find(Boolean) || positions;
  return truncate(first, 34);
}

function buildAggregatorEvidence(row, profile, role) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  const corpus = profile ? [
    profile.skills?.join(" "),
    profile.projects?.join(" "),
    profile.experience?.join(" ")
  ].join(" ").toLowerCase() : "";
  const hits = roleProfile.keywords.filter((keyword) => corpus.includes(keyword.toLowerCase())).slice(0, 4);
  return [
    `岗位来自 ${row.linkSource || "第三方聚合源"}，网申链接${row.appLink ? "可用" : "待从来源确认"}。`,
    hits.length ? `你的材料命中：${hits.join(" / ")}` : `岗位关键词：${inferTags(row).slice(0, 4).join(" / ") || "校招 / 实习 / 项目经验"}`,
    row.evaluation ? `来源评价：${truncate(row.evaluation, 42)}` : `岗位方向：${truncate(row.positions || "", 42)}`
  ];
}

function buildAggregatorGaps(row, profile, role) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  const corpus = profile ? [
    profile.skills?.join(" "),
    profile.projects?.join(" "),
    profile.experience?.join(" ")
  ].join(" ").toLowerCase() : "";
  return roleProfile.keywords
    .filter((keyword) => !corpus.includes(keyword.toLowerCase()))
    .slice(0, 5);
}

function recommendProjects(profile, role) {
  if (!profile?.projects?.length) return [];
  const keywords = (ROLE_PROFILES[role] || ROLE_PROFILES.ai).keywords.join(" ").toLowerCase();
  return [...profile.projects]
    .sort((a, b) => keywordHits(b, keywords) - keywordHits(a, keywords))
    .slice(0, 2)
    .map((item) => truncate(item, 56));
}

function buildAggregatorAdvice(row, role) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  return [
    `标题建议：${roleProfile.title}`,
    `简历优先突出：${roleProfile.keywords.slice(0, 4).join(" / ")}`,
    row.industry ? `行业适配：补充和 ${row.industry} 场景相关的项目结果。` : "补充项目指标、协作对象和交付结果。"
  ];
}

function scoreFromRecord(row, role) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  const corpus = rowCorpus(row).toLowerCase();
  const hits = roleProfile.keywords.filter((keyword) => corpus.includes(keyword.toLowerCase())).length;
  return Math.min(92, 62 + hits * 5 + (row.appLink ? 6 : 0) + (row.evaluation ? 4 : 0));
}

function freshnessScore(row) {
  const text = `${row.fullDate || ""} ${row.updateDate || ""}`;
  if (/今日|今天|05-2[6-9]|2026-05-2[6-9]/.test(text)) return 96;
  if (/05|2026-05|本周|近一周/.test(text)) return 88;
  if (/招满即止|长期有效/.test(text)) return 78;
  return 70;
}

function keywordHits(text, terms) {
  return terms.split(/\s+/).filter((term) => term && String(text).toLowerCase().includes(term)).length;
}

function hashRecord(row) {
  const value = `${row.company}|${row.positions}|${row.appLink}|${row.sourceLink}`;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function truncate(text, length) {
  const value = String(text || "").trim();
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function extractTitle(html) {
  return (String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/\s+/g, " ")
    .trim();
}

function typeLabel(type) {
  return { campus: "校招", internship: "实习", social: "社招", imported: "导入岗位" }[type] || "招聘";
}
