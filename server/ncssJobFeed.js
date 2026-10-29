// 国家大学生就业服务平台 (ncss.cn): a public graduate-employment platform whose
// postings are mostly small and mid-size employers. It republishes jobs from
// university career centres and job boards, so its text is platform text, not
// the employer's own JD, and it is never marked as a verified official JD.
//
// Anonymous visitors can read the first 5 pages (100 jobs) of any query; later
// pages answer "请登录后查看". We stop there instead of logging in, and widen
// coverage with several CS/AI keywords instead.

const FETCH_TIMEOUT_MS = 18000;
const MAX_BYTES = 2 * 1024 * 1024;
const HOUR = 3600000, DAY = 24 * HOUR;
const USER_AGENT = "Mozilla/5.0 ResumeProtocol/1.0";
const LIST_API = "https://www.ncss.cn/student/jobs/jobslist/ajax/";
const PAGE_SIZE = 20;
const ANONYMOUS_PAGES = 5;
// jobType 01 = 全职 (graduate hiring on this platform), 03 = 实习.
const JOB_TYPES = [["01", "校招"], ["03", "实习"]];

export const NCSS_KEYWORDS = ["软件", "前端", "后端", "Java", "Python", "C++", "算法", "人工智能", "大模型", "数据", "测试", "嵌入式", "运维", "网络安全", "产品经理", "硬件"];

export const NCSS_JOB_FEEDS = [{
  id: "ncss-jobs",
  title: "国家大学生就业服务平台（计算机/AI 关键词）",
  url: "https://www.ncss.cn/student/jobs/index.html",
  originSourceUrl: "https://www.ncss.cn/student/jobs/index.html",
  format: "ncss",
  sourceType: "public-employment-platform",
  official: false,
  types: ["campus", "internship"],
  refreshMs: 12 * HOUR,
  // Keyword sampling cannot prove a missing job closed, so freshness follows
  // the platform's own update date over a 30-day window.
  freshMs: 30 * DAY
}];

export async function loadNcssJobFeed(feed, { signal, fetchImpl = fetch, keywords = NCSS_KEYWORDS, delayMs = 300 } = {}) {
  const rows = new Map();
  let requests = 0, failures = 0, lastError = "";
  for (const keyword of keywords) {
    for (const [jobType, typeLabel] of JOB_TYPES) {
      for (let page = 1; page <= ANONYMOUS_PAGES; page++) {
        signal?.throwIfAborted();
        if (requests++) await sleep(delayMs, signal);
        let json;
        try {
          json = await fetchJson(fetchImpl, listUrl(keyword, jobType, page), { signal });
        } catch (error) {
          signal?.throwIfAborted();
          failures++; lastError = error.message;
          break;
        }
        // flag:false past the anonymous pages means "log in to see more": stop.
        if (json?.flag !== true || !Array.isArray(json?.data?.list)) break;
        for (const item of json.data.list) {
          const row = toRow(item, typeLabel);
          if (row && !rows.has(row.job_id)) rows.set(row.job_id, row);
        }
        if (json.data.list.length < PAGE_SIZE) break;
      }
    }
  }
  if (!rows.size) throw new Error(failures ? `ncss_unavailable: ${lastError}` : "ncss_empty");
  return [...rows.values()];
}

export function toRow(item = {}, typeLabel = "") {
  const id = clean(item.jobId, 80);
  const title = clean(item.jobName, 300);
  const company = clean(item.recName, 200);
  const updated = Number(item.updateDate || item.publishDate);
  if (!id || !/^[A-Za-z0-9]+$/.test(id) || !title || !company || !Number.isFinite(updated)) return null;
  const pay = Number(item.lowMonthPay) > 0 ? `${item.lowMonthPay}-${item.highMonthPay}K/月` : "";
  // List fields only; the detail page text is read when the job is selected.
  const summary = [
    item.degreeName ? `学历要求：${clean(item.degreeName, 50)}` : "",
    item.major ? `专业：${[...new Set(String(item.major).replace(/★/g, "").split(/[,，]/).map(value => value.trim()).filter(Boolean))].join("、").slice(0, 400)}` : "",
    pay ? `薪资：${pay}` : "",
    item.headCount > 0 ? `招聘人数：${item.headCount}` : "",
    item.recScale ? `公司规模：${clean(item.recScale, 30)}（平台标注）` : "",
    item.recProperty ? `公司性质：${clean(item.recProperty, 30)}` : "",
    item.sourcesNameCh ? `信息来源：${clean(item.sourcesNameCh, 60)}` : ""
  ].filter(Boolean).join("\n");
  return {
    job_id: id,
    company,
    title,
    url: `https://www.ncss.cn/student/jobs/${id}/detail.html`,
    location: clean(item.areaCodeName, 100),
    job_type: /实习/.test(title) ? "实习" : typeLabel,
    jd_text: summary,
    companySize: clean(item.recScale, 30),
    last_seen: new Date(updated).toISOString(),
    publish_time: Number(item.publishDate) ? new Date(Number(item.publishDate)).toISOString().slice(0, 10) : ""
  };
}

// Detail page text for one posting, as platform text (aggregator: true).
export async function loadNcssJobDetail(url, { signal, fetchImpl = fetch } = {}) {
  const match = url.pathname.match(/^\/student\/jobs\/([A-Za-z0-9]+)\/detail\.html$/);
  if (!match) return null;
  const html = await fetchText(fetchImpl, `https://www.ncss.cn/student/jobs/${match[1]}/detail.html`, { signal });
  const body = html.match(/<div class="mainContent[^"]*">([\s\S]*?)<\/div>/);
  if (!body) throw new Error("invalid_ncss_detail_page");
  return body[1];
}

function listUrl(keyword, jobType, page) {
  const params = new URLSearchParams({ jobType, areaCode: "", jobName: keyword, industrySectors: "", property: "", categoryCode: "", memberLevel: "", recruitType: "", offset: String(page), limit: String(PAGE_SIZE), keyUnits: "", degreeCode: "", sourcesName: "", sourcesType: "" });
  return `${LIST_API}?${params}`;
}

async function fetchJson(fetchImpl, url, { signal }) {
  return JSON.parse(await fetchText(fetchImpl, url, { signal, accept: "application/json" }));
}

async function fetchText(fetchImpl, url, { signal, accept = "text/html" }) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    headers: { Accept: accept, "User-Agent": USER_AGENT },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: "error"
  });
  if (!response.ok) throw new Error(`ncss_http_${response.status}`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("ncss_too_large");
  return text;
}

function sleep(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
