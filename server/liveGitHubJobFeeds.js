import { parseGitHubJobMarkdown } from "./githubJobSources.js";

const MINUTE = 60 * 1000;
const RAW_TIMEOUT_MS = 20_000;
const MAX_SIMPLIFY_BYTES = 20 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

export const LIVE_GITHUB_JOB_FEEDS = [
  githubLiveFeed({
    id: "github-simplify-summer-2027-internships",
    label: "Simplify Summer 2027 Internships",
    repo: "SimplifyJobs/Summer2027-Internships",
    branch: "dev",
    path: ".github/scripts/listings.json",
    format: "simplify-listings-json",
    defaultType: "internship",
    refreshMs: 30 * MINUTE,
    maxBytes: MAX_SIMPLIFY_BYTES,
    cadenceNote: "GitHub snapshot updates frequently; local polling is capped at 30 minutes."
  }),
  githubLiveFeed({
    id: "github-speedyapply-2027-ai",
    label: "SpeedyApply 2027 AI College Jobs",
    repo: "speedyapply/2027-AI-College-Jobs",
    branch: "main",
    files: ["README.md", "NEW_GRAD_USA.md", "INTERN_INTL.md", "NEW_GRAD_INTL.md"],
    format: "speedyapply-markdown",
    defaultType: "internship",
    refreshMs: 60 * MINUTE,
    maxBytes: MAX_MARKDOWN_BYTES,
    cadenceNote: "Upstream is a daily-updated public GitHub list; local polling is capped at 60 minutes."
  }),
  githubLiveFeed({
    id: "github-speedyapply-2027-swe",
    label: "SpeedyApply 2027 SWE College Jobs",
    repo: "speedyapply/2027-SWE-College-Jobs",
    branch: "main",
    files: ["README.md", "NEW_GRAD_USA.md", "INTERN_INTL.md", "NEW_GRAD_INTL.md"],
    format: "speedyapply-markdown",
    defaultType: "internship",
    refreshMs: 60 * MINUTE,
    maxBytes: MAX_MARKDOWN_BYTES,
    cadenceNote: "Upstream is a daily-updated public GitHub list; local polling is capped at 60 minutes."
  })
];

export async function loadLiveGitHubJobFeed(feed, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const commit = await fetchFeedCommit(feed, { signal, fetchImpl });
  const files = feed.files?.length ? feed.files : [feed.path];
  const texts = await Promise.all(files.map(async (path) => ({
    path,
    text: await fetchGitHubRawText(feed, path, commit.sha, { signal, fetchImpl })
  })));
  const rows = feed.format === "simplify-listings-json"
    ? parseSimplifyListingsJson(parseJsonArray(texts[0].text), feed, commit)
    : parseSpeedyApplyMarkdownFiles(texts, feed, commit);
  if (!rows.length && !feed.allowEmpty) throw new Error("empty_or_incompatible_source");
  return rows;
}

export function parseSimplifyListingsJson(listings, feed, { commitDate, commitSha } = {}) {
  if (!Array.isArray(listings)) throw new Error("invalid_source_shape");
  return listings
    .filter((item) => item?.active === true && item.url)
    .map((item) => {
      const locations = Array.isArray(item.locations) ? item.locations.filter(Boolean) : [];
      const terms = Array.isArray(item.terms) ? item.terms.filter(Boolean) : [];
      const degrees = Array.isArray(item.degrees) ? item.degrees.filter(Boolean) : [];
      const country = inferCountry(locations.join(" "));
      return {
        company_name: cleanText(item.company_name || item.company || ""),
        title: cleanText(item.title || ""),
        official_url: cleanUrl(item.url),
        company_url: cleanUrl(item.company_url),
        location: locations.join(", "),
        country,
        job_type: "实习",
        jd_text: [
          item.category ? `Category: ${cleanText(item.category)}` : "",
          terms.length ? `Terms: ${terms.map((value) => cleanText(value)).join(", ")}` : "",
          degrees.length ? `Degrees: ${degrees.map((value) => cleanText(value)).join(", ")}` : "",
          item.sponsorship ? `Sponsorship: ${cleanText(item.sponsorship)}` : "",
          locations.length ? `Locations: ${locations.map((value) => cleanText(value)).join(", ")}` : ""
        ].filter(Boolean).join(" | "),
        job_id: cleanText(item.id || ""),
        source_job_id: cleanText(item.id || ""),
        source: cleanText(item.source || "Simplify"),
        source_repository: feed.repo,
        source_commit: commitSha || "",
        source_path: feed.path,
        origin_source_url: feed.url,
        last_seen: commitDate || "",
        publish_time: epochSecondsToIso(item.date_posted),
        postingAge: epochSecondsToIso(item.date_updated) || "",
        status: "active"
      };
    })
    .filter((row) => row.company_name && row.title && row.official_url);
}

export function summarizeLiveGitHubRows(rows) {
  const byCountry = {};
  const byType = {};
  for (const row of rows) {
    const country = row.country || "Unknown";
    const type = row.job_type || "Unknown";
    byCountry[country] = (byCountry[country] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
  }
  return { total: rows.length, byCountry, byType };
}

async function fetchFeedCommit(feed, { signal, fetchImpl }) {
  const url = `https://api.github.com/repos/${feed.repo}/commits/${encodeURIComponent(feed.branch)}`;
  const json = await fetchJson(url, { signal, fetchImpl, maxBytes: 512 * 1024 });
  const sha = cleanText(json?.sha || "");
  const commitDate = cleanText(json?.commit?.committer?.date || json?.commit?.author?.date || "");
  if (!sha || !commitDate || Number.isNaN(Date.parse(commitDate))) throw new Error("invalid_commit_metadata");
  return { sha, commitSha: sha, commitDate };
}

async function fetchGitHubRawText(feed, path, sha, { signal, fetchImpl }) {
  const rawUrl = `https://raw.githubusercontent.com/${feed.repo}/${sha}/${path}`;
  const apiUrl = `https://api.github.com/repos/${feed.repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(sha)}`;
  let lastError;
  for (const url of [rawUrl, apiUrl]) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await fetchText(url, {
          signal,
          fetchImpl,
          maxBytes: feed.maxBytes || MAX_MARKDOWN_BYTES,
          accept: url.includes("api.github.com")
            ? "application/vnd.github.raw,text/plain;q=0.9,*/*;q=0.8"
            : "text/plain,application/json;q=0.9,*/*;q=0.8"
        });
      } catch (error) {
        lastError = error;
        if (signal?.aborted || error.message === "source_too_large") throw error;
      }
    }
  }
  throw new Error(`all_fetch_attempts_failed:${path}:${lastError?.message || "unknown"}`);
}

async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, { ...options, accept: "application/vnd.github+json" }));
}

async function fetchText(url, { signal, fetchImpl, maxBytes, accept }) {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(RAW_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(url, {
    headers: {
      "accept": accept,
      "user-agent": "ResumeProtocol-LiveGitHubJobFeeds"
    },
    redirect: "error",
    signal: combinedSignal
  });
  if (!response?.ok) throw new Error(`source_http_${response?.status || 0}`);
  if (typeof response.text === "function" && !response.body) {
    const value = await response.text();
    if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error("source_too_large");
    return value;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("source_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonArray(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length > 60_000) throw new Error("invalid_source_shape");
  return parsed;
}

function parseSpeedyApplyMarkdownFiles(files, feed, commit) {
  const rows = files.flatMap(({ path, text }) => parseGitHubJobMarkdown(text, {
    sourceId: feed.id,
    defaultType: inferDefaultType(path, feed.defaultType),
    filename: path
  }).map((row) => toCanonicalMarkdownRow(row, feed, commit)));
  return dedupeRows(rows.filter((row) => row.company_name && row.title && row.official_url && !row.gone));
}

function toCanonicalMarkdownRow(row, feed, { commitDate, commitSha }) {
  const location = cleanText(row.location || "");
  const country = inferCountry(location);
  return {
    company_name: cleanText(row.company || ""),
    title: cleanText(row.title || ""),
    official_url: cleanUrl(row.applyUrl),
    company_url: cleanUrl(row.companyUrl),
    location,
    country,
    job_type: row.type === "campus" ? "校招" : row.type === "social" ? "社招" : "实习",
    jd_text: [
      row.section ? `Section: ${cleanText(row.section)}` : "",
      row.filename ? `File: ${cleanText(row.filename)}` : "",
      row.salary ? `Salary: ${cleanText(row.salary)}` : "",
      row.postingAge ? `Posting: ${cleanText(row.postingAge)}` : "",
      location ? `Location: ${location}` : ""
    ].filter(Boolean).join(" | "),
    job_id: cleanText(row.applyUrl || `${row.company}|${row.title}|${location}`),
    source_job_id: cleanText(row.applyUrl || ""),
    source_repository: feed.repo,
    source_commit: commitSha || "",
    source_path: row.filename || "",
    origin_source_url: feed.url,
    last_seen: commitDate || "",
    publish_time: "",
    postingAge: cleanText(row.postingAge || ""),
    status: hasClosedSignal(`${row.title} ${row.section} ${row.postingAge}`) ? "closed" : "active",
    gone: hasClosedSignal(`${row.title} ${row.section} ${row.postingAge}`)
  };
}

function githubLiveFeed({ id, label, repo, branch, path, files, format, defaultType, refreshMs, maxBytes, cadenceNote }) {
  return {
    id,
    label,
    title: label,
    company: label,
    group: "GitHub 实时岗位源",
    url: `https://github.com/${repo}`,
    repo,
    branch,
    path,
    files: files || (path ? [path] : []),
    format,
    defaultType,
    sourceType: "github-aggregator",
    trust: "github-aggregated",
    snapshot: true,
    refreshMs,
    maxBytes,
    cadenceNote,
    note: "GitHub 聚合岗位源；开放状态和完整 JD 以官方投递页为准。"
  };
}

function inferDefaultType(path, fallback) {
  return /NEW_GRAD/i.test(path) ? "campus" : /INTERN|README/i.test(path) ? "internship" : fallback;
}

function inferCountry(value) {
  const text = String(value || "").toLowerCase();
  if (/china|beijing|shanghai|shenzhen|guangzhou|hangzhou|chengdu|hong kong|taiwan|taipei|中国|北京|上海|深圳|广州|杭州|成都|香港|台湾|台北/.test(text)) return "China";
  if (/canada|toronto|vancouver|waterloo|montreal/.test(text)) return "Canada";
  if (/singapore/.test(text)) return "Singapore";
  if (/india|bengaluru|bangalore|hyderabad|mumbai|pune|delhi/.test(text)) return "India";
  if (/united kingdom|uk|london|cambridge/.test(text)) return "United Kingdom";
  if (/germany|berlin|munich/.test(text)) return "Germany";
  if (/japan|tokyo/.test(text)) return "Japan";
  if (/australia|sydney|melbourne/.test(text)) return "Australia";
  if (/remote/.test(text)) return "Remote";
  return text ? "United States" : "";
}

function hasClosedSignal(value) {
  return /\bclosed\b|\bexpired\b|inactive|已关闭|已下线|暂停|closed/i.test(String(value || ""));
}

function epochSecondsToIso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  const millis = number > 10_000_000_000 ? number : number * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function cleanText(value, max = 5000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function encodeURIComponentPath(path) {
  return String(path || "").split("/").map(encodeURIComponent).join("/");
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.official_url || `${row.company_name}|${row.title}|${row.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
