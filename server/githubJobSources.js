import { ROLE_PROFILES, scoreJob } from "./resumeEngine.js";

const RAW_TIMEOUT_MS = 35000;

export const GITHUB_JOB_SOURCES = [
  githubSource({
    id: "speedy-ai",
    company: "SpeedyApply AI/ML",
    repo: "speedyapply/2027-AI-College-Jobs",
    label: "2027 AI/ML College Jobs",
    files: ["README.md", "NEW_GRAD_USA.md", "INTERN_INTL.md", "NEW_GRAD_INTL.md"],
    types: ["campus", "internship"],
    preference: 94,
    roleBias: "ai",
    defaultType: "internship"
  }),
  githubSource({
    id: "speedy-swe",
    company: "SpeedyApply SWE",
    repo: "speedyapply/2027-SWE-College-Jobs",
    label: "2027 SWE College Jobs",
    files: ["README.md", "NEW_GRAD_USA.md", "INTERN_INTL.md", "NEW_GRAD_INTL.md"],
    types: ["campus", "internship"],
    preference: 90,
    roleBias: "backend",
    defaultType: "internship"
  }),
  githubSource({
    id: "zapply-swe",
    company: "Zapply Software Jobs",
    repo: "zapplyjobs/New-Grad-Software-Engineering-Jobs-2026",
    label: "Software Engineering Jobs 2026",
    files: ["README.md"],
    types: ["campus", "internship"],
    preference: 88,
    roleBias: "backend",
    defaultType: "campus"
  }),
  githubSource({
    id: "0voice-spring",
    company: "0voice 计算机春招",
    repo: "0voice/2026-Computer-Spring-Recruitment-Job-Compilation",
    label: "2026 Computer Spring Recruitment",
    files: ["README.md"],
    types: ["campus", "internship"],
    preference: 86,
    roleBias: "ai",
    defaultType: "campus",
    locale: "zh-CN",
    fetchMode: "api"
  })
];

const ROLE_HINTS = {
  ai: ["AI", "AIGC", "LLM", "RAG", "Agent", "GenAI", "Generative", "Machine Learning", "ML", "NLP", "CV", "Data Science", "大模型", "算法", "人工智能", "机器学习", "深度学习", "智能"],
  backend: ["Backend", "Back End", "Server", "Software Engineer", "SWE", "Java", "Python", "Go", "C++", "Platform", "Infrastructure", "后端", "服务端", "开发工程师", "云计算"],
  frontend: ["Frontend", "Front End", "React", "Vue", "Web", "TypeScript", "JavaScript", "前端", "小程序", "可视化"],
  product: ["Product", "PM", "Product Manager", "产品", "策略", "需求"],
  ops: ["Operations", "Growth", "Marketing", "运营", "增长", "内容", "市场"]
};

const TYPE_HINTS = {
  campus: ["new grad", "graduate", "entry", "college", "campus", "校招", "春招", "秋招", "提前批", "补录", "应届"],
  internship: ["intern", "internship", "co-op", "coop", "实习", "暑期实习", "日常实习"]
};

export function getGitHubJobSources() {
  return GITHUB_JOB_SOURCES.map((source) => ({
    ...source,
    syncStatus: "idle",
    sourceType: "github-aggregator",
    note: "GitHub 开源岗位情报源，刷新时实时抓取 raw Markdown。"
  }));
}

export async function refreshGitHubJobSources({ sourceIds = [], query = "", type = "campus", profile, limit = 180 } = {}) {
  const selected = selectSources(sourceIds);
  const fetchedAt = new Date().toISOString();
  const results = await Promise.all(selected.map((source) => refreshOneSource(source, { query, type, profile, fetchedAt, limit })));
  return combineSourceResults(results, { fetchedAt, limit });
}

export function refreshGitHubJobSourcesFromSnapshots({
  sourceIds = [],
  snapshots = {},
  query = "",
  type = "campus",
  profile,
  fetchedAt = new Date().toISOString(),
  limit = 180
} = {}) {
  const selected = selectSources(sourceIds);
  const results = selected.map((source) => {
    const startedAt = Date.now();
    const files = snapshots[source.id] || {};
    const fileEntries = typeof files === "string"
      ? [{ filename: "README.md", text: files }]
      : Object.entries(files).map(([filename, text]) => ({ filename, text }));
    const rows = fileEntries.flatMap(({ filename, text }) => parseGitHubJobMarkdown(text, {
      sourceId: source.id,
      defaultType: source.defaultType,
      filename
    }));
    const matchedRows = rows
      .filter((row) => matchesType(row, type))
      .filter((row) => matchesQuery(row, query));
    return {
      source,
      status: buildSourceStatus(source, {
        ok: rows.length > 0,
        status: rows.length ? 200 : 0,
        fetchedAt,
        latencyMs: Date.now() - startedAt,
        rawJobs: rows.length,
        matchedJobs: matchedRows.length,
        note: rows.length ? `从 ${fileEntries.length} 个快照解析 ${rows.length} 条岗位。` : "快照为空或结构无法解析。",
        textSample: matchedRows.slice(0, 3).map((row) => `${row.company} ${row.title}`).join("；")
      }),
      jobs: matchedRows.map((row, index) => toGitHubJob(row, { source, profile, type, fetchedAt, index }))
    };
  });
  return combineSourceResults(results, { fetchedAt, limit });
}

export function parseGitHubJobMarkdown(markdown = "", options = {}) {
  const rows = [];
  const lines = String(markdown || "").split(/\r?\n/);
  let section = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      section = stripMarkdown(heading[2]);
      continue;
    }
    if (!line.includes("|")) continue;
    const headers = splitMarkdownRow(line);
    const separator = splitMarkdownRow(lines[index + 1] || "");
    if (!isSeparatorRow(separator) || headers.length < 2) continue;

    index += 2;
    while (index < lines.length && lines[index].trim().includes("|")) {
      const cells = splitMarkdownRow(lines[index]);
      if (!isSeparatorRow(cells)) {
        const row = normalizeTableRow(headers, cells, {
          ...options,
          section
        });
        if (row) rows.push(row);
      }
      index += 1;
    }
    index -= 1;
  }

  return dedupeRows(rows);
}

async function refreshOneSource(source, { query, type, profile, fetchedAt, limit }) {
  const startedAt = Date.now();
  const fileResults = await Promise.all(source.files.map((filename) => fetchSourceFile(source, filename)));
  const okFiles = fileResults.filter((item) => item.ok);
  const rows = okFiles.flatMap((item) => parseGitHubJobMarkdown(item.text, {
    sourceId: source.id,
    defaultType: source.defaultType,
    filename: item.filename
  }));
  const matchedRows = rows
    .filter((row) => matchesType(row, type))
    .filter((row) => matchesQuery(row, query))
    .slice(0, limit);
  const failedFiles = fileResults.filter((item) => !item.ok);
  return {
    source,
    status: buildSourceStatus(source, {
      ok: rows.length > 0,
      status: rows.length ? 200 : 0,
      fetchedAt,
      latencyMs: Date.now() - startedAt,
      rawJobs: rows.length,
      matchedJobs: matchedRows.length,
      note: rows.length
        ? `已解析 ${okFiles.length}/${source.files.length} 个 GitHub raw 文件。${failedFiles.length ? `失败 ${failedFiles.length} 个文件。` : ""}`
        : failedFiles[0]?.error || "GitHub 源为空或结构无法解析。",
      textSample: matchedRows.slice(0, 3).map((row) => `${row.company} ${row.title}`).join("；")
    }),
    jobs: matchedRows.map((row, index) => toGitHubJob(row, { source, profile, type, fetchedAt, index }))
  };
}

async function fetchSourceFile(source, filename) {
  const rawUrl = `${source.rawBase}/${filename}`;
  const apiUrl = `${source.apiBase}/${encodeURIComponent(filename)}`;
  const urls = source.fetchMode === "api" ? [apiUrl, rawUrl] : [rawUrl, apiUrl];
  const errors = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "ResumeProtocol/1.0 GitHubJobSources",
          "Accept": url.includes("api.github.com") ? "application/vnd.github.raw,text/plain;q=0.9,*/*;q=0.8" : "text/plain,application/json;q=0.9,*/*;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(RAW_TIMEOUT_MS)
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return {
        ok: true,
        filename,
        url,
        text,
        etag: response.headers.get("etag") || "",
        lastModified: response.headers.get("last-modified") || ""
      };
    } catch (error) {
      errors.push(`${url.includes("api.github.com") ? "api" : "raw"} ${error.message}`);
    }
  }
  return { ok: false, filename, url: rawUrl, text: "", error: `${filename}: ${errors.join("; ")}` };
}

function toGitHubJob(row, { source, profile, type, fetchedAt, index }) {
  const role = inferRole(row, source.roleBias);
  const normalizedType = row.type || inferType(`${row.title} ${row.section} ${row.filename}`, source.defaultType || type);
  const baseJob = {
    id: `github-${source.id}-${hashRecord(row)}-${index}`,
    title: truncate(row.title || `${row.company} 招聘岗位`, 80),
    company: row.company || source.company,
    source: "github-job-source",
    sourceUrl: row.applyUrl || row.companyUrl || source.url,
    sourceGroup: source.group,
    originSourceUrl: source.url,
    applyUrl: row.applyUrl || "",
    trust: source.trust,
    role,
    type: normalizedType,
    salary: row.salary || "",
    location: row.location || "未标注",
    city: row.location || "未标注",
    updatedAt: row.postingAge ? `岗位年龄 ${row.postingAge}` : fetchedAt,
    deadline: "以 GitHub 源和官方投递页为准",
    requirements: buildRequirements(row, source, normalizedType),
    description: buildDescription(row, source, normalizedType),
    tags: inferTags(`${row.company} ${row.title} ${row.section}`),
    sourceStatus: "aggregated",
    sourceNote: `${source.label}，GitHub 开源岗位情报，需以投递页最终状态为准。`,
    sourceSyncStatus: "synced",
    applyStatus: row.applyUrl ? "github-apply-link" : "github-source-link",
    postingAge: row.postingAge || "",
    matchEvidence: buildEvidence(row, profile, role),
    gapKeywords: buildGaps(profile, role),
    recommendedProjects: recommendProjects(profile, role),
    resumeAdvice: buildAdvice(row, role)
  };
  const matchScore = profile ? scoreJob(baseJob, profile, role) : scoreFromRow(row, role);
  return enrichOpportunity({ ...baseJob, matchScore }, row, source, normalizedType);
}

function normalizeTableRow(headers, cells, options) {
  const values = Object.fromEntries(headers.map((header, index) => [normalizeHeader(header), cells[index] || ""]));
  const section = options.section || "";
  const companyCell = pick(values, ["company", "公司"]) || (/工作岗位|岗位/.test(headers.join(" ")) ? section : cells[0]);
  const titleCell = pick(values, ["position", "role", "title", "工作岗位", "岗位", "职位"]) || cells[1];
  const locationCell = pick(values, ["location", "地点", "城市"]) || "";
  const salaryCell = pick(values, ["salary", "薪资"]) || "";
  const postingCell = pick(values, ["posting", "apply", "详细内容", "招聘状态&&投递链接", "投递链接", "申请"]) || cells.at(-1) || "";
  const ageCell = pick(values, ["age", "posted", "更新日期", "date"]) || "";
  const allCells = cells.join(" ");
  const applyUrl = firstHttpUrl(postingCell) || firstHttpUrl(allCells);
  const companyUrl = firstHttpUrl(companyCell);
  const company = stripMarkdown(companyCell) || stripMarkdown(section);
  const title = stripMarkdown(titleCell);

  if (!title || title === "---" || /^NO\.?$/i.test(title)) return null;
  if (!company && !title) return null;
  if (!applyUrl && !/点击查看|投递|Apply|申请/i.test(allCells)) return null;

  return {
    sourceId: options.sourceId || "",
    filename: options.filename || "README.md",
    section,
    company,
    title,
    location: stripMarkdown(locationCell),
    salary: stripMarkdown(salaryCell),
    applyUrl,
    companyUrl,
    postingAge: stripMarkdown(ageCell || postingCell),
    type: inferType(`${title} ${section} ${options.filename || ""}`, options.defaultType)
  };
}

function combineSourceResults(results, { fetchedAt, limit }) {
  const sources = results.map((result) => result.status);
  const jobs = dedupeJobs(results.flatMap((result) => result.jobs))
    .sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0))
    .slice(0, limit);
  return {
    refreshedAt: fetchedAt,
    sources,
    jobs,
    summary: buildSummary(sources, jobs)
  };
}

function buildSourceStatus(source, details) {
  return {
    ...source,
    ok: details.ok,
    status: details.status,
    fetchedAt: details.fetchedAt,
    latencyMs: details.latencyMs,
    title: source.label,
    textSample: details.textSample || "",
    syncStatus: details.ok ? "synced" : "failed",
    sourceType: "github-aggregator",
    note: details.note,
    rawJobs: details.rawJobs || 0,
    matchedJobs: details.matchedJobs || 0
  };
}

function buildSummary(sources, jobs) {
  return {
    totalSources: sources.length,
    syncedSources: sources.filter((source) => source.ok).length,
    failedSources: sources.filter((source) => !source.ok).length,
    generatedJobs: jobs.length,
    highOpportunityJobs: jobs.filter((job) => (job.opportunityScore || 0) >= 85).length,
    officialVerifiedJobs: jobs.filter((job) => job.applyUrl || job.sourceUrl).length,
    rawJobs: sources.reduce((sum, source) => sum + (source.rawJobs || 0), 0),
    matchedJobs: sources.reduce((sum, source) => sum + (source.matchedJobs || 0), 0)
  };
}

function matchesType(row, type) {
  if (!type) return true;
  if (type === "campus") return row.type !== "internship";
  if (type === "internship") return row.type === "internship";
  return row.type === type;
}

function matchesQuery(row, query) {
  const terms = expandQuery(query);
  if (!terms.length) return true;
  const corpus = `${row.company} ${row.title} ${row.location} ${row.section}`.toLowerCase();
  return terms.some((term) => corpus.includes(term.toLowerCase()));
}

function expandQuery(query) {
  const raw = String(query || "").split(/[\s/，,、|]+/).map((item) => item.trim()).filter(Boolean);
  const joined = raw.join(" ");
  const expanded = new Set(raw);
  if (/ai|agent|rag|llm|大模型|智能|算法|机器学习/i.test(joined)) ROLE_HINTS.ai.forEach((term) => expanded.add(term));
  if (/front|react|vue|前端/i.test(joined)) ROLE_HINTS.frontend.forEach((term) => expanded.add(term));
  if (/back|后端|java|python|go|swe|software/i.test(joined)) ROLE_HINTS.backend.forEach((term) => expanded.add(term));
  if (/product|产品/i.test(joined)) ROLE_HINTS.product.forEach((term) => expanded.add(term));
  if (/ops|运营|增长/i.test(joined)) ROLE_HINTS.ops.forEach((term) => expanded.add(term));
  return [...expanded].filter((term) => term.length >= 2);
}

function inferRole(row, fallback = "ai") {
  const corpus = `${row.company} ${row.title} ${row.section}`.toLowerCase();
  const scored = Object.entries(ROLE_HINTS).map(([role, terms]) => [
    role,
    terms.filter((term) => corpus.includes(term.toLowerCase())).length
  ]);
  scored.sort((a, b) => b[1] - a[1]);
  return scored[0]?.[1] ? scored[0][0] : fallback;
}

function inferType(text, fallback = "campus") {
  const corpus = String(text || "").toLowerCase();
  if (TYPE_HINTS.internship.some((term) => corpus.includes(term.toLowerCase()))) return "internship";
  if (TYPE_HINTS.campus.some((term) => corpus.includes(term.toLowerCase()))) return "campus";
  return fallback || "campus";
}

function inferTags(text) {
  const corpus = String(text || "").toLowerCase();
  const tags = ["AI", "LLM", "RAG", "Agent", "GenAI", "Python", "Java", "Go", "React", "Vue", "TypeScript", "SWE", "后端", "前端", "产品", "运营", "数据分析", "算法", "实习", "校招"];
  return tags.filter((tag) => corpus.includes(tag.toLowerCase()));
}

function buildRequirements(row, source, type) {
  return [
    `来源：${source.label}`,
    `岗位类型：${typeLabel(type)}`,
    row.location ? `地点：${row.location}` : "",
    row.salary ? `薪资：${row.salary}` : "",
    row.postingAge ? `岗位年龄：${row.postingAge}` : "",
    row.section ? `分类：${row.section}` : ""
  ].filter(Boolean);
}

function buildDescription(row, source, type) {
  return [
    `${row.company || source.company} ${typeLabel(type)}岗位。`,
    `岗位：${row.title}`,
    row.location ? `地点：${row.location}` : "",
    row.salary ? `薪资：${row.salary}` : "",
    row.postingAge ? `GitHub 源标注：${row.postingAge}` : "",
    `来源仓库：${source.url}`
  ].filter(Boolean).join(" ");
}

function buildEvidence(row, profile, role) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  const corpus = profile ? [
    profile.skills?.join(" "),
    profile.projects?.join(" "),
    profile.experience?.join(" ")
  ].join(" ").toLowerCase() : "";
  const hits = roleProfile.keywords.filter((keyword) => corpus.includes(keyword.toLowerCase())).slice(0, 4);
  return [
    `GitHub 岗位源：${row.section || row.filename || "README"}，投递链接${row.applyUrl ? "已提取" : "待确认"}。`,
    hits.length ? `你的材料命中：${hits.join(" / ")}` : `岗位关键词：${inferTags(row.title).slice(0, 4).join(" / ") || row.title}`,
    row.postingAge ? `新鲜度信号：${row.postingAge}` : "请以官方投递页确认开放状态。"
  ];
}

function buildGaps(profile, role) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  const corpus = profile ? [
    profile.skills?.join(" "),
    profile.projects?.join(" "),
    profile.experience?.join(" ")
  ].join(" ").toLowerCase() : "";
  return roleProfile.keywords.filter((keyword) => !corpus.includes(keyword.toLowerCase())).slice(0, 5);
}

function recommendProjects(profile, role) {
  if (!profile?.projects?.length) return [];
  const keywords = (ROLE_PROFILES[role] || ROLE_PROFILES.ai).keywords.join(" ").toLowerCase();
  return [...profile.projects]
    .sort((a, b) => keywordHits(b, keywords) - keywordHits(a, keywords))
    .slice(0, 2)
    .map((item) => truncate(item, 56));
}

function buildAdvice(row, role) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  return [
    `标题建议：${roleProfile.title}`,
    `简历优先突出：${roleProfile.keywords.slice(0, 4).join(" / ")}`,
    row.applyUrl ? "投递前打开官方链接复核岗位是否仍开放。" : "从 GitHub 源进入原仓库复核投递入口。"
  ];
}

function enrichOpportunity(job, row, source, type) {
  const match = job.matchScore || 70;
  const freshness = freshnessScore(row);
  const apply = row.applyUrl ? 94 : 58;
  const company = source.preference || 70;
  const typeFit = source.types?.includes(type) ? 90 : 65;
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

function freshnessScore(row) {
  const age = String(row.postingAge || "").toLowerCase();
  const minute = age.match(/(\d+)\s*m/);
  const hour = age.match(/(\d+)\s*h/);
  const day = age.match(/(\d+)\s*d/);
  if (minute) return 98;
  if (hour) return Number(hour[1]) <= 6 ? 96 : 92;
  if (day) {
    const days = Number(day[1]);
    if (days <= 3) return 94;
    if (days <= 14) return 88;
    if (days <= 45) return 78;
    return 66;
  }
  if (/今日|今天|刚刚|新|已开启|持续更新/.test(age)) return 90;
  return 76;
}

function scoreFromRow(row, role) {
  const roleProfile = ROLE_PROFILES[role] || ROLE_PROFILES.ai;
  const corpus = `${row.company} ${row.title} ${row.section}`.toLowerCase();
  const hits = roleProfile.keywords.filter((keyword) => corpus.includes(keyword.toLowerCase())).length;
  return Math.min(94, 62 + hits * 5 + (row.applyUrl ? 7 : 0));
}

function selectSources(sourceIds) {
  const ids = new Set(sourceIds || []);
  return ids.size ? GITHUB_JOB_SOURCES.filter((source) => ids.has(source.id)) : GITHUB_JOB_SOURCES;
}

function githubSource({ id, company, repo, label, files, types, preference, roleBias, defaultType, locale = "en", fetchMode = "raw" }) {
  return {
    id,
    company,
    group: "GitHub 实时岗位源",
    url: `https://github.com/${repo}`,
    rawBase: `https://raw.githubusercontent.com/${repo}/main`,
    apiBase: `https://api.github.com/repos/${repo}/contents`,
    files,
    types,
    trust: "github-aggregated",
    sourceType: "github-aggregator",
    preference,
    roleBias,
    defaultType,
    locale,
    fetchMode,
    label
  };
}

function splitMarkdownRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function normalizeHeader(header) {
  return stripMarkdown(header)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pick(values, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
  }
  return "";
}

function firstHttpUrl(text) {
  const value = String(text || "");
  const htmlHref = value.match(/href=["'](https?:\/\/[^"']+)["']/i);
  if (htmlHref) return htmlHref[1];
  const markdownLink = value.match(/\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownLink) return markdownLink[1];
  const bare = value.match(/https?:\/\/[^\s"'<>)]*/i);
  return bare ? bare[0] : "";
}

function stripMarkdown(text) {
  return decodeHtml(String(text || ""))
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.company}|${row.title}|${row.applyUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = job.applyUrl || `${job.company}|${job.title}|${job.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function keywordHits(text, terms) {
  return terms.split(/\s+/).filter((term) => term && String(text).toLowerCase().includes(term)).length;
}

function hashRecord(row) {
  const value = `${row.sourceId}|${row.company}|${row.title}|${row.applyUrl}`;
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

function typeLabel(type) {
  return { campus: "校招/New Grad", internship: "实习/Intern", social: "社招", imported: "导入岗位" }[type] || "招聘";
}
