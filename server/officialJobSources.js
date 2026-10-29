/**
 * Official Chinese employer career sites.
 *
 * Design rule: **a source may only emit a job record when this module knows the
 * concrete shape of that source's data.**
 *
 * The previous version treated twelve different career sites as one generic
 * HTML-scraping problem.  That does not work: every one of these sites is a
 * single-page app that renders its listing from its own JSON endpoint, so the
 * HTML shell contains no jobs.  Measured on 2026-10-12, the generic scraper
 * produced 15 rows for 12 companies, of which only 10 were real (all Baidu);
 * the rest were navigation links and WeChat articles dressed up as jobs.
 *
 * So each source declares an `adapter`:
 *
 *   json-api        the company's own JSON endpoint, with a field mapper
 *   html            a server-rendered page carrying an embedded JSON array
 *                   and/or schema.org JobPosting JSON-LD
 *   unadapted       the official entry is registered and shown to users, but
 *                   no extractor exists yet, so the source yields zero rows
 *                   instead of guessing
 *
 * `unadapted` is deliberately not a failure state: the honest answer is
 * "we have not wired this company's API yet", never a fabricated job.
 */

const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TITLE_CHARS = 180;
/** A description shorter than this is a snippet, not a verifiable full JD. */
const FULL_JD_MIN_CHARS = 200;
const USER_AGENT = "ResumeProtocol-OfficialJobSource/1.1";
/**
 * Some career-site gateways reject anything that is not a full browser user
 * agent string (ByteDance answers 405 to `ResumeProtocol-...` and even to a
 * bare `Mozilla/5.0`).  These are public job listings, so reading them the way
 * the browser reads them is fine — but keep it opt-in per source, so we only
 * give up our own identity where the gateway leaves no choice.
 */
const BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** Detail-page enrichment is bounded and polite: few rows, few parallel calls. */
const DETAIL_CONCURRENCY = 4;
/**
 * Hard ceiling on a page walk.  It is deliberately generous: a source declares how
 * many pages it needs (网易's inventory is 27 pages of 100), and silently clamping
 * that to a smaller number would look like "this employer only has 1000 jobs".
 */
const MAX_PAGES = 50;
/**
 * How many pages of one source may be in flight together.  Kept at the same width
 * as the detail enrichment so a single sync never fans out wider than this.
 */
const PAGE_CONCURRENCY = 4;

export const ADAPTER_STATUS = Object.freeze({
  VERIFIED: "verified",
  UNADAPTED: "unadapted"
});

/* ------------------------------------------------------------------ *
 * Text and URL helpers
 * ------------------------------------------------------------------ */

function text(value, max = 40_000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function decodeEntities(value) {
  return text(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function stripTags(value) {
  return decodeEntities(String(value ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function canonicalUrl(value, baseUrl) {
  try {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const url = new URL(raw, baseUrl);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    // A fragment that starts with "/" is a hash route, not a scroll anchor:
    // 京东 addresses each job as `#/details?id=…`, so dropping the hash would
    // turn every detail link into the site root.
    if (!/^#\//.test(url.hash)) url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(ref|source)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return "";
  }
}

function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "";
  }
}

function firstString(...values) {
  for (const value of values) {
    const normalized = text(value, 500);
    if (normalized) return normalized;
  }
  return "";
}

function toIso(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

/** "2026年10月12日" / "2026-10-12" / epoch millis -> ISO date, or "". */
function toIsoDate(value) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  // Epoch inputs are reduced to a date too, so every source reports the same shape.
  if (Number.isFinite(numeric) && numeric > 1e11) return new Date(numeric).toISOString().slice(0, 10);
  const match = String(value).match(/(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return toIso(value).slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Job-type inference
 * ------------------------------------------------------------------ */

const TYPE_PATTERNS = [
  ["internship", /实习|intern(?:ship)?|实训|暑期|日常实习/i],
  ["campus", /校招|校园|应届|毕业生|graduate|campus|new\s*grad|管培/i],
  ["social", /社招|社会招聘|experienced|professional|全职|正式员工/i]
];

/**
 * Prefer what the listing itself says; fall back to the type the endpoint is
 * dedicated to (a "social recruitment" API returns social roles even when the
 * title carries no keyword).  Never guess beyond that.
 *
 * Adapters that carry a definitive per-row type field pass `job_type` instead —
 * see `officialRow`.  Title keywords are a heuristic, and a 社招 HR role called
 * "校园招聘专员" would otherwise be filed as a campus opening.
 */
function inferJobType(typeText, source) {
  const haystack = text(typeText, 2_000);
  const explicit = TYPE_PATTERNS.find(([, pattern]) => pattern.test(haystack));
  if (explicit) return explicit[0];
  return source.adapter?.defaultType || null;
}

/* ------------------------------------------------------------------ *
 * Row shape + validity
 * ------------------------------------------------------------------ */

const GENERIC_TITLES = new Set([
  "首页", "登录", "注册", "招聘", "招聘帮助", "校园招聘", "社会招聘", "实习生招聘",
  "了解百度", "了解我们", "关于我们", "职位", "岗位", "职位列表", "岗位列表",
  "成长与发展", "招聘动态", "联系我们", "更多", "查看更多"
]);
/**
 * Only announcement-shaped titles.  A bare word list is dangerous here: "活动",
 * "资讯", "指南" and "分享" all appear inside legitimate role names
 * (活动运营, 内容资讯…), so a plain alternation would silently drop real jobs.
 */
const ANNOUNCEMENT_TITLE_RE = /(?:正式启动|招聘动态|招聘公告|招聘简章|重要提醒|宣讲会|招聘现场|应届生全球招聘|^FAQs?\b|招聘.{0,4}(?:启动|公告|答疑|指南))/i;

const NORMALIZED_JOB_TYPES = new Set(["campus", "internship", "social"]);

function officialRow(source, fields, now) {
  const declared = NORMALIZED_JOB_TYPES.has(fields.job_type) ? fields.job_type : null;
  return {
    company_name: firstString(fields.company_name, source.company),
    title: text(fields.title, 300),
    official_url: canonicalUrl(fields.official_url, fields.baseUrl || source.entryUrl),
    location: firstString(fields.location, source.defaultLocation),
    // An adapter that reads the portal/type straight off the payload is
    // authoritative; title keywords are only a fallback.
    job_type: declared || inferJobType(fields.typeText || "", source),
    jd_text: text(fields.jd_text, 20_000),
    publish_time: text(fields.publish_time, 50),
    deadline: text(fields.deadline, 50),
    last_seen: new Date(now).toISOString(),
    source_id: source.id,
    source_group: source.group,
    source_trust: source.trust,
    origin_source_url: source.entryUrl,
    full_description_verified: Boolean(fields.full_description_verified),
    status: fields.closed ? "closed" : "open"
  };
}

function hostAllowed(url, source) {
  const host = hostOf(url);
  if (!host) return false;
  const allowed = [hostOf(source.entryUrl), ...(source.allowedHosts || [])].filter(Boolean);
  return allowed.some(candidate => host === candidate || host.endsWith(`.${candidate}`));
}

/**
 * Structured adapters rarely produce junk, but a single bad record is worse
 * than a missing one: it becomes a "job" the user can be asked to apply for.
 */
function isUsableRow(row, source) {
  const title = text(row.title, 300);
  if (title.length < 2 || title.length > MAX_TITLE_CHARS) return false;
  if (!row.official_url || !hostAllowed(row.official_url, source)) return false;
  const normalized = title.replace(/[\s|·•\-—_]+/g, "").trim();
  if (!normalized || GENERIC_TITLES.has(normalized)) return false;
  if (ANNOUNCEMENT_TITLE_RE.test(title)) return false;
  return true;
}

function dedupeRows(rows) {
  const unique = new Map();
  for (const row of rows) {
    if (!row?.official_url || !row?.title) continue;
    const existing = unique.get(row.official_url);
    const better = !existing
      || (!existing.full_description_verified && row.full_description_verified)
      || (row.jd_text || "").length > (existing.jd_text || "").length;
    if (better) unique.set(row.official_url, row);
  }
  return [...unique.values()];
}

/* ------------------------------------------------------------------ *
 * HTML extractors
 * ------------------------------------------------------------------ */

function flattenJson(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJson);
  if (!value || typeof value !== "object") return [];
  const nested = [];
  if (Array.isArray(value["@graph"])) nested.push(...flattenJson(value["@graph"]));
  for (const [key, child] of Object.entries(value)) {
    if (key === "@graph") continue;
    if (child && typeof child === "object") nested.push(...flattenJson(child));
  }
  return [value, ...nested];
}

/**
 * Only `@type: JobPosting` counts.  The previous version also accepted any
 * object that happened to carry title + url + a long description, which let
 * unrelated structured data through as job records.
 */
function jsonLdJobPostings(html) {
  const postings = [];
  const scriptRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || "").matchAll(scriptRe)) {
    let parsed;
    try {
      parsed = JSON.parse(decodeEntities(match[1]).trim());
    } catch {
      continue; // a broken block must not hide the ones after it
    }
    for (const item of flattenJson(parsed)) {
      const type = String(item?.["@type"] ?? "").toLowerCase();
      if (type.includes("jobposting")) postings.push(item);
    }
  }
  return postings;
}

function extractArrayLiteral(html, marker) {
  const source = String(html || "");
  const start = source.indexOf(marker);
  if (start < 0) return [];
  const arrayStart = source.indexOf("[", start + marker.length);
  if (arrayStart < 0) return [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = arrayStart; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) {
      try {
        return JSON.parse(source.slice(arrayStart, index + 1).replace(/\bundefined\b/g, "null"));
      } catch {
        return [];
      }
    }
  }
  return [];
}

function jsonLocation(value) {
  if (Array.isArray(value)) return value.map(jsonLocation).filter(Boolean).join("；");
  if (typeof value === "string") return text(value, 300);
  if (!value || typeof value !== "object") return "";
  const address = value.address || value;
  return [address.streetAddress, address.addressLocality, address.addressRegion, address.addressCountry]
    .filter(Boolean).map(item => text(item, 100)).join(" ");
}

function jsonLdRow(item, source, pageUrl, now) {
  const description = stripTags(firstString(item?.description, item?.articleBody));
  const organization = typeof item?.hiringOrganization === "string"
    ? item.hiringOrganization
    : item?.hiringOrganization?.name;
  const employmentType = Array.isArray(item?.employmentType)
    ? item.employmentType.join(" ")
    : item?.employmentType;
  return officialRow(source, {
    company_name: organization,
    title: firstString(item?.title, item?.name),
    official_url: firstString(item?.url, item?.sameAs),
    baseUrl: pageUrl,
    location: jsonLocation(item?.jobLocation || item?.applicantLocationRequirements) || source.defaultLocation,
    typeText: `${employmentType || ""} ${firstString(item?.title, item?.name)}`,
    jd_text: description,
    publish_time: firstString(item?.datePosted, ""),
    deadline: firstString(item?.validThrough, ""),
    full_description_verified: description.length >= FULL_JD_MIN_CHARS
  }, now);
}

/** Parse one official career page without network access. */
export function parseOfficialPage(html, source, { pageUrl, now = Date.now() } = {}) {
  const adapter = source?.adapter;
  if (!source?.id || adapter?.kind !== "html") return [];
  const base = pageUrl || adapter.pageUrl || source.entryUrl;
  const rows = [];
  for (const marker of adapter.markers || []) {
    for (const item of extractArrayLiteral(html, marker)) {
      const row = adapter.map(item, { source, pageUrl: base, now });
      if (row && isUsableRow(row, source)) rows.push(row);
    }
  }
  if (adapter.jsonLd !== false) {
    for (const item of jsonLdJobPostings(html)) {
      const row = jsonLdRow(item, source, base, now);
      if (isUsableRow(row, source)) rows.push(row);
    }
  }
  return dedupeRows(rows);
}

/* ------------------------------------------------------------------ *
 * Network layer
 * ------------------------------------------------------------------ */

function withTimeout({ signal, timeoutMs }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readResponseBody(response, signal) {
  if (!response?.ok) throw new Error(`source_http_${response?.status || 0}`);
  if (response.body && typeof response.body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_PAGE_BYTES) throw new Error("source_too_large");
      chunks.push(chunk);
      signal?.throwIfAborted();
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_PAGE_BYTES) throw new Error("source_too_large");
  return body;
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

function officialSource({ id, company, group, trust, entryUrl, types, adapter, locale = "zh-CN", defaultLocation = "中国", allowedHosts }) {
  if (!id || !company || !entryUrl || !adapter?.kind) throw new Error(`invalid_official_source:${id || "unknown"}`);
  return Object.freeze({
    id,
    company,
    group,
    trust,
    entryUrl,
    officialUrl: entryUrl,
    url: adapter.pageUrl || adapter.request?.(1)?.url || entryUrl,
    types: Object.freeze([...types]),
    locale,
    defaultLocation,
    allowedHosts: Object.freeze([...(allowedHosts || [])]),
    sourceType: "official-company",
    kind: "official",
    format: adapter.kind === "json-api" ? "json" : "html",
    adapter: Object.freeze({
      ...adapter,
      status: adapter.status || ADAPTER_STATUS.UNADAPTED,
      reason: adapter.reason || (adapter.status === ADAPTER_STATUS.VERIFIED ? "" : "尚未适配该官网的职位接口，只能提供官方入口。")
    }),
    note: "企业官方招聘页面；岗位状态和完整要求以投递页为准。"
  });
}

/**
 * An entry-only source.  `reason` is worth filling in whenever someone has
 * actually looked: "the API answers 0 rows to an anonymous session" is a far more
 * useful thing to tell an operator than a generic "not wired up yet".
 */
function unadapted({ id, company, group, trust, entryUrl, types, reason }) {
  return officialSource({
    id,
    company,
    group,
    trust,
    entryUrl,
    types,
    adapter: { kind: "unadapted", status: ADAPTER_STATUS.UNADAPTED, reason }
  });
}

const TENCENT_QUERY = (page, pageSize) => "https://careers.tencent.com/tencentcareer/api/post/Query"
  + `?timestamp=${Date.now()}&countryId=&cityId=&bgIds=&productId=&categoryId=&parentCategoryId=`
  + `&attrId=&keyword=&pageIndex=${page}&pageSize=${pageSize}&language=zh-cn&area=cn`;

const BYTEDANCE_ORIGIN = "https://jobs.bytedance.com";
/** 小米 runs its own tenant of the same ATSX / 飞书招聘 platform. */
const XIAOMI_ORIGIN = "https://xiaomi.jobs.f.mioffice.cn";

/**
 * ByteDance serves every portal from one endpoint, and the portal is selected by
 * **request headers**, not by the body:
 *
 *   no header                      -> 社招 (10000 rows)
 *   Portal-Channel: campus         -> 校招 (7466 rows, 正式 + 实习)
 *   Portal-Channel: social         -> empty list
 *
 * The campus header even *overrides* `portal_type` (portal_type 6 together with
 * the campus headers still returns campus rows), so the two feeds are told apart
 * by headers alone.  Captured 2026-10-12 from `jobs.bytedance.com/campus/position`.
 */
const BYTEDANCE_CAMPUS_HEADERS = Object.freeze({
  "website-path": "campus",
  "Portal-Channel": "campus",
  "Portal-Platform": "pc"
});

/**
 * ATSX / 飞书招聘 is a **multi-tenant** recruiting SaaS, not a single company's site:
 * 字节跳动 runs it on `jobs.bytedance.com`, 小米 on `xiaomi.jobs.f.mioffice.cn`.
 * Both expose the same `POST /api/v1/search/job/posts` request/response shape, so
 * the mapping is written once and each tenant supplies its own origin, portal
 * selector, headers and detail route.
 *
 * The **portal selector is per tenant and is the thing to get right**, because it
 * fails silently when wrong (see each source's note):
 *
 *   字节   `Portal-Channel` request header (campus / social); absent = 社招
 *   小米   `website-path` request header (index / campus / internship / newretailing)
 *
 * `detailPath` is the front-end route prefix for a job page, read off the live
 * site's own links rather than guessed: `/campus/position/<id>/detail` for 字节
 * campus, `/index/position/<id>/detail` for 小米 social.
 *
 * `pageSize` maps to the request's `limit` and both tenants honour at least 1000,
 * so coverage is bought with page *depth* rather than page *count*: 字节社招 is
 * 10000 rows, which is 100 requests at 100/page but 10 at 1000/page.
 */
function atsxAdapter({
  origin,
  entryPath,
  detailPath,
  portalType,
  portalEntrance,
  defaultType,
  headers = {},
  // 字节 sends `use_default_distance`; 小米 answers fine without it, so it stays
  // opt-in rather than being sent to every tenant.
  useDefaultDistance = false,
  // How many rows one request asks for.  This is a real lever, not a hint: both
  // tenants honour at least 1000, which turns 字节社招 from a 100-page walk into a
  // 10-page one.  It must be the same number the request sends and the loader
  // compares against, or the walk would call page 1 "short" and stop after it.
  pageSize = 100,
  pages = 3
}) {
  return {
    kind: "json-api",
    status: ADAPTER_STATUS.VERIFIED,
    pages,
    pageSize,
    defaultType,
    request: (page) => ({
      url: `${origin}/api/v1/search/job/posts`,
      method: "POST",
      headers: {
        accept: "application/json",
        // The gateway answers 405 (with an empty body) to anything that is not a
        // full browser user agent — seen on both tenants.
        "user-agent": BROWSER_USER_AGENT,
        "accept-language": "zh-CN,zh;q=0.9",
        origin,
        referer: `${origin}${entryPath}`,
        ...headers
      },
      body: {
        keyword: "",
        limit: pageSize,
        offset: (page - 1) * pageSize,
        job_category_id_list: [],
        tag_id_list: [],
        location_code_list: [],
        subject_id_list: [],
        recruitment_id_list: [],
        portal_type: portalType,
        job_function_id_list: [],
        storefront_id_list: [],
        ...(useDefaultDistance ? { use_default_distance: true } : {}),
        ...(portalEntrance === undefined ? {} : { portal_entrance: portalEntrance })
      }
    }),
    pick: (payload) => (Array.isArray(payload?.data?.job_post_list) ? payload.data.job_post_list : []),
    map: (item, { source, now }) => {
      const cities = Array.isArray(item?.city_list)
        ? item.city_list.map(city => text(city?.name, 60)).filter(Boolean)
        : [];
      const category = [item?.job_category?.parent?.name, item?.job_category?.name].filter(Boolean).join("/");
      const recruit = item?.recruit_type;
      const recruitType = typeof recruit === "string"
        ? recruit
        : firstString(recruit?.name, recruit?.i18n_name);
      const recruitParent = typeof recruit === "string"
        ? ""
        : firstString(recruit?.parent?.name, recruit?.parent?.i18n_name);
      // The portal says 校招 or 社招; inside the campus portal the child says
      // 正式 or 实习.  Read it off the payload instead of guessing from the title.
      const jobType = /实习/.test(recruitType) ? "internship"
        : /校招|校园/.test(`${recruitParent}${recruitType}`) ? "campus"
        : /社招|社会招聘/.test(`${recruitParent}${recruitType}`) ? "social"
        : undefined;
      const subjectName = item?.job_subject?.name;
      // The campus set is split into graduation cohorts ("2027届校园招聘"), which
      // is exactly what a student needs to know before applying.
      const subject = firstString(
        typeof subjectName === "string" ? subjectName : subjectName?.zh_cn,
        typeof subjectName === "object" ? subjectName?.i18n : ""
      );
      const description = text(item?.description);
      const requirement = text(item?.requirement);
      return officialRow(source, {
        title: item?.title,
        official_url: `${origin}${detailPath}/${firstString(item?.id)}/detail`,
        location: cities.join("；") || firstString(item?.city_info?.name),
        job_type: jobType,
        typeText: `${recruitParent} ${recruitType} ${category} ${item?.title || ""}`,
        jd_text: [
          subject ? `招聘批次：${subject}` : "",
          description,
          requirement ? `任职要求：\n${requirement}` : ""
        ].filter(Boolean).join("\n\n"),
        publish_time: toIsoDate(item?.publish_time),
        full_description_verified: Boolean(description && requirement)
      }, now);
    }
  };
}

/** 字节跳动's tenant of the shared ATSX platform. */
function bytedanceAdapter(options) {
  return atsxAdapter({ origin: BYTEDANCE_ORIGIN, useDefaultDistance: true, ...options });
}

/**
 * 小米's tenant of the same platform, on its own domain.
 *
 * The portal selector here is `website-path`, and it is the *only* thing that
 * selects the portal — `portal_type`, `portal_entrance` and `Portal-Channel` are
 * accepted and then ignored (sweeping `portal_type` over 1/2/6/7/99 with the
 * campus header returns the same 782 campus rows every time).
 *
 * Measured 2026-10-12:
 *
 *   website-path: index          1987 社招/全职
 *   website-path: campus          782 校招/正式
 *   website-path: internship      580 校招/实习
 *   website-path: newretailing     97 校招/正式 (新零售 program, 96 of 97 disjoint)
 *   website-path: social          HTTP 200 + `msg:"site not exist"`, no rows
 *   website-path: (omitted)      2188 — a **different, larger** set than `index`,
 *                                 which no page on the site ever shows
 *
 * Two silent failures live in that table.  Guessing `social` (the obvious name for
 * the social portal) yields zero rows dressed as a success.  And omitting the
 * header yields 2188 rows that look perfectly plausible — only comparing against
 * the count the page itself displays (1987) exposes the mismatch.  Both are why
 * the social source below pins `website-path: index` explicitly.
 */
function xiaomiAdapter({ websitePath, detailPath, defaultType, pages, pageSize = 1000 }) {
  return atsxAdapter({
    origin: XIAOMI_ORIGIN,
    entryPath: `/${websitePath}`,
    detailPath,
    portalType: 6,
    portalEntrance: 1,
    defaultType,
    headers: {
      "website-path": websitePath,
      "Portal-Channel": "saas-career",
      "Portal-Platform": "pc"
    },
    pageSize,
    pages
  });
}

/**
 * 京东 writes its campus city as "上海市-上海市"; the city is the last segment.
 */
function jdCity(value) {
  const parts = text(value, 60).split(/[-—–]/).map(part => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

const HUAWEI_GATEWAY = "https://apigw-dgg-b0.huawei.com/api/apig/channelhw";

/**
 * 华为's gateway rejects any call without a tenant header, and it does so with
 * **HTTP 200 and a SUCCESS-shaped envelope**:
 *
 *   {"code":"TenantContextError","httpCode":200,"message":"missing tenant code!!!"}
 *
 * A status-code check would call that a success.  `x-jalor-tenantAlias: hcm` is
 * the value the site itself sends (captured 2026-10-12); `X-HW-ID` is the gateway
 * app id, which the site passes both as a header and as a query parameter.
 */
const HUAWEI_HEADERS = Object.freeze({
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  "user-agent": BROWSER_USER_AGENT,
  "X-HW-ID": "app_000000035886",
  origin: "https://career.huawei.com",
  referer: "https://career.huawei.com/",
  "x-jalor-tenantAlias": "hcm",
  "x-alb-gray": "prod",
  "x-language": "zh_CN",
  "x-Referer": "https://career.huawei.com/cn"
});

/**
 * 华为 deliberately withholds the JD for about half of its campus postings.  Both
 * the list endpoint and the detail endpoint return the same sentence,
 * 「请您详见岗位意向中的岗位职责」/「…岗位要求」 — the real text only appears once the
 * candidate is inside the application flow.
 *
 * That sentence is not a job description.  Storing it would be a small
 * fabrication, and because the detail endpoint returns the very same sentence,
 * there is no detail call worth making for this portal either — so the adapter
 * declares none, and those rows are stored with no JD at all, which is the truth.
 * Measured 2026-10-12: 56 of 102 campus rows are withheld, 0 of 462 social rows.
 */
const HUAWEI_WITHHELD_JD_RE = /^请您详见岗位意向中的岗位(职责|要求)[。.]?$/;

function huaweiJd(duty, requirement) {
  const parts = [];
  const add = (value, label) => {
    const body = text(value, 8_000);
    if (!body || HUAWEI_WITHHELD_JD_RE.test(body)) return;
    parts.push(`${label}：\n${body}`);
  };
  add(duty, "岗位职责");
  add(requirement, "岗位要求");
  return parts.join("\n\n");
}

/**
 * One portal per adapter, selected by the request-body field `jobType`:
 *
 *   "CR"  校招 102 rows — 应届生 (`scenarioCode` 0) + 实习生 (`scenarioCode` 1)
 *   "SR"  社招 462 rows
 *   "IR"  **not** 实习: it is the union of the other two (564 = 462 + 102)
 *
 * and any unrecognised value silently returns that same union — `jobType: "ZZ"`
 * answers 564 rows, HTTP 200, `status: "SUCCESS"`.  So a typo here would look
 * exactly like a working adapter while quietly duplicating every job.  Only "CR"
 * and "SR" are ever requested; the union is never used.
 *
 * `resolveType` reads the portal out of the payload per row rather than applying
 * one default to the whole feed, because the campus portal mixes 应届生 and 实习生.
 */
function huaweiAdapter({ jobType, defaultType, resolveType, pages }) {
  return {
    kind: "json-api",
    status: ADAPTER_STATUS.VERIFIED,
    pages,
    pageSize: 100,
    defaultType,
    request: (page) => ({
      url: `${HUAWEI_GATEWAY}/recruitmentPosition/pub/getJobPage`,
      method: "POST",
      headers: HUAWEI_HEADERS,
      body: { curPage: page, pageSize: 100, jobType }
    }),
    pick: (payload) => (Array.isArray(payload?.data?.result) ? payload.data.result : []),
    map: (item, { source, now }) => {
      // `advertisementId` is the key the detail route uses (`positionJumpInfo`
      // in the page's component data); it is distinct from the integration id.
      const advertisementId = firstString(item?.advertisementId);
      if (!advertisementId) return null;
      const jdText = huaweiJd(item?.mainBusiness, item?.jobRequire);
      return officialRow(source, {
        title: firstString(item?.jobNameNew, item?.jobName),
        official_url: `https://career.huawei.com/cn/job-details?advertisementId=${advertisementId}`,
        location: text(item?.workPlace, 300),
        job_type: resolveType(item),
        typeText: [
          text(item?.scenarioName, 40),
          text(item?.categoryName, 40),
          text(item?.jobFamilyName, 40),
          text(item?.deptName, 80),
          text(item?.jobName, 120)
        ].filter(Boolean).join(" "),
        jd_text: jdText,
        publish_time: toIsoDate(item?.lastUpdateDate),
        full_description_verified: Boolean(jdText)
      }, now);
    }
  };
}

const IFLYTEK_ORIGIN = "https://iflytek.zhiye.com";

/**
 * 北森 / zhiye.com is the **second multi-tenant recruiting SaaS** in this registry
 * (the first being ATSX / 飞书招聘).  Every tenant serves the same
 * `POST /api/Jobad/GetJobAdPageList`; the portal is chosen by the body field
 * `Category`, a list of numeric ids whose **meaning is per tenant**:
 *
 *   科大讯飞  iflytek.zhiye.com
 *     1 社会招聘 721 · 2 校园招聘 119 · 4 飞星计划 11
 *     5 飞凡计划 3  · 6 校园大使 1   · 7 星火X顶尖AI人才计划 31
 *     (sum 886 = the no-Category union, measured — so grouping is not a distortion)
 *   vivo      vivo.zhiye.com — a different mapping and only 24 rows, and that
 *             board is an *employee* portal, so it is deliberately not registered.
 *
 * Because `Category` takes an array, one source can span several portals
 * (校园 = [2,4,5,6,7]).  This platform fails *safely* on a bad enum — unlike
 * 华为's `jobType`, where an unknown value silently returns the whole union,
 * `Category: ["999"]` answers 0 rows.
 *
 * Two measured traps, both of which look like working code:
 *
 *  1. `PostDate` is the literal string `"0001-01-01T00:00:00"` on **886 of 886**
 *     rows.  It is a null sentinel, not a date, and `toIsoDate` would happily
 *     turn it into `"0001-01-01"` — dating the entire board to year 1 while the
 *     value still *looks* like a well-formed date.  `ChangeDate` is the only real
 *     timestamp the list exposes.
 *  2. The detail route is `/job/detail?jobAdId=<id>`, but the parameter is named
 *     after the **wrong field**: it only accepts the GUID `Id`
 *     (`247b87c5-020b-458b-8c39-66a85dd04c5f`).  Passing the integer `JobAdId`
 *     (`190832627`) renders the bare SPA shell — HTTP 200, no 404, byte-for-byte
 *     the same as a bogus id.  Verified in a fresh tab.
 *
 * A third trap lives in the request, not the response: **`DisplayFields` is a real
 * field selector.**  `LocNames` comes back as `[]` and `ClassificationOne` as
 * `null` unless their ids (`LocId`, `ClassificationOne`) are listed — the response
 * still looks perfectly well-formed, the fields are just quietly zeroed.  A first
 * probe that asked for only `["Category", "Kind"]` therefore concluded, wrongly,
 * that this platform has no location data at all.  With the site's own list the
 * truth is the opposite: 886 of 886 rows carry locations (`安徽省·合肥市`,
 * `广东省·广州市/深圳市` — 61 distinct for 社招, 26 for 校招).  So `BEISEN_FIELDS`
 * mirrors the list the site itself sends, rather than a hand-picked subset.
 *
 * The list already carries full `Duty` + `Require` on every row, and the detail
 * page adds nothing the list lacks, so this adapter declares no detail route.
 */
const BEISEN_FIELDS = Object.freeze([
  "Category", "Kind", "LocId", "ClassificationOne", "WorkWeChatQrCode"
]);

/** 北森 writes a missing date as 0001-01-01 instead of omitting the field. */
const BEISEN_NULL_DATE_RE = /^0001-01-01/;

function beisenDate(value) {
  const raw = firstString(value);
  return BEISEN_NULL_DATE_RE.test(raw) ? "" : toIsoDate(raw);
}

/**
 * `LocNames` is an array of the platform's own location strings — `安徽省·合肥市`,
 * `上海市`, or `广东省·广州市/深圳市` when one posting covers several cities.  They
 * are joined rather than normalised, because the province prefix is information the
 * site chose to give and a bare city name would throw it away.
 */
function beisenLocation(item) {
  const names = Array.isArray(item?.LocNames) ? item.LocNames : [];
  return names.map(name => text(name, 60)).filter(Boolean).join("；");
}

function beisenJd(duty, requirement) {
  const parts = [];
  const add = (value, label) => {
    const body = text(value, 8_000);
    if (body) parts.push(`${label}：\n${body}`);
  };
  add(duty, "工作职责");
  add(requirement, "任职资格");
  return parts.join("\n\n");
}

function beisenAdapter({ origin, categories, entryPath, defaultType, resolveType, pages, pageSize = 500 }) {
  return {
    kind: "json-api",
    status: ADAPTER_STATUS.VERIFIED,
    pages,
    pageSize,
    defaultType,
    request: (page) => ({
      url: `${origin}/api/Jobad/GetJobAdPageList`,
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        // The endpoint answers 200 even with no origin/referer at all; these are
        // sent to stay faithful to the site's own request, not because it needs them.
        "user-agent": BROWSER_USER_AGENT,
        origin,
        referer: `${origin}${entryPath}`
      },
      body: {
        // 0-based, verified: index 0/1/2 return disjoint rows.  The loader hands
        // us 1-based page numbers, so the offset happens here.
        PageIndex: page - 1,
        PageSize: pageSize,
        KeyWords: "",
        SpecialType: 0,
        PortalId: "",
        Category: [...categories],
        DisplayFields: [...BEISEN_FIELDS]
      }
    }),
    // `Data` is the array itself (not wrapped in an object) and `Count` is the total.
    pick: (payload) => (Array.isArray(payload?.Data) ? payload.Data : []),
    map: (item, { source, now }) => {
      // The GUID, not `JobAdId` — see trap 2 above.
      const id = firstString(item?.Id);
      if (!id) return null;
      const jdText = beisenJd(item?.Duty, item?.Require);
      return officialRow(source, {
        title: firstString(item?.JobAdName, item?.JobName),
        official_url: `${origin}/job/detail?jobAdId=${id}`,
        // Only populated because `LocId` is in DisplayFields — see the note above.
        location: beisenLocation(item),
        job_type: resolveType ? resolveType(item) : defaultType,
        typeText: [
          text(item?.Category, 40),
          text(item?.Kind, 20),
          text(item?.ClassificationOne, 60),
          text(item?.ClassificationTwo, 60),
          text(item?.JobAdName, 120)
        ].filter(Boolean).join(" "),
        jd_text: jdText,
        publish_time: beisenDate(item?.ChangeDate),
        full_description_verified: Boolean(jdText)
      }, now);
    }
  };
}

/** 讯飞's 星火X portal mixes 全职 and 实习 under one category, so read `Kind`. */
function iflytekCampusType(item) {
  return /实习/.test(text(item?.Kind, 20)) ? "internship" : "campus";
}

/**
 * Keep the registry explicit.  It is useful to show users which companies were
 * searched, and it lets an operator disable one source without touching the
 * parser.  URLs are public employer career pages, not third-party aggregators.
 */
export const OFFICIAL_JOB_SOURCES = Object.freeze([
  officialSource({
    id: "tencent-careers",
    company: "腾讯",
    group: "互联网 / AI",
    trust: 98,
    entryUrl: "https://careers.tencent.com/search.html",
    types: ["social"],
    // 腾讯 runs *two* application systems at once: most postings are on
    // careers.tencent.com, but 314 of the 2243 social rows link straight to
    // 腾讯's own Workday tenant (`tencent.wd1.myworkdayjobs.com/Tencent_Careers`).
    // Those are real 腾讯 jobs on a real 腾讯-controlled board, not an aggregator
    // link, so the host allow-list has to name it — otherwise `hostAllowed()`
    // silently drops them as "off-site", which is how the source ended up at
    // 1929 rows while the endpoint reported 2243.
    allowedHosts: ["tencent.wd1.myworkdayjobs.com"],
    adapter: {
      kind: "json-api",
      status: ADAPTER_STATUS.VERIFIED,
      // 腾讯 reports 2253 社招 rows and honours pageSize up to at least 500, so
      // 6 pages of 500 cover the board — the old 3 pages of 100 reached 13% of it.
      pages: 6,
      pageSize: 500,
      defaultType: "social",
      request: (page) => ({
        url: TENCENT_QUERY(page, 500),
        method: "GET",
        headers: { accept: "application/json" }
      }),
      pick: (payload) => (Array.isArray(payload?.Data?.Posts) ? payload.Data.Posts : []),
      map: (item, { source, now }) => {
        const row = officialRow(source, {
          title: item?.RecruitPostName,
          official_url: String(item?.PostURL || "").replace(/^http:/, "https:")
            || `https://careers.tencent.com/jobdesc.html?postId=${firstString(item?.PostId)}`,
          location: [item?.CountryName, item?.LocationName].filter(Boolean).join(" "),
          typeText: `${item?.RequireWorkYearsName || ""} ${item?.CategoryName || ""} ${item?.RecruitPostName || ""}`,
          jd_text: item?.Responsibility,
          publish_time: toIsoDate(item?.LastUpdateTime),
          // The list endpoint publishes duties only; the requirement text lives on
          // the detail page, so this starts unverified and `detail` upgrades it.
          full_description_verified: false,
          closed: item?.IsValid === false
        }, now);
        row.detailKey = firstString(item?.PostId);
        return row;
      },
      // The detail budget is a *rate limit*, not a coverage limit.  It used to be
      // 300, sized for the old three-page walk; the walk now reaches the whole
      // 2243-row board, so 300 would have left 87% of the rows with duties but no
      // requirements.  At 900 a cold database converges in three syncs (~20 s of
      // detail calls each) and every later sync only pays for newly posted jobs,
      // because completed JDs are restored from storage without a request.
      detail: {
        maxPerSync: 900,
        request: (row) => ({
          url: `https://careers.tencent.com/tencentcareer/api/post/ByPostId?postId=${encodeURIComponent(row.detailKey || "")}&language=zh-cn`,
          method: "GET",
          headers: { accept: "application/json" }
        }),
        pick: (payload) => payload?.Data,
        map: (data, row) => {
          const responsibility = text(data?.Responsibility, 8_000);
          const requirement = text(data?.Requirement, 8_000);
          return {
            jd_text: [
              responsibility ? `工作职责：\n${responsibility}` : "",
              requirement ? `任职要求：\n${requirement}` : ""
            ].filter(Boolean).join("\n\n") || row.jd_text,
            publish_time: toIsoDate(data?.LastUpdateTime) || row.publish_time,
            full_description_verified: Boolean(responsibility && requirement)
          };
        }
      }
    }
  }),
  officialSource({
    id: "bytedance-careers",
    company: "字节跳动",
    group: "互联网 / AI",
    trust: 97,
    entryUrl: "https://jobs.bytedance.com/experienced/positions",
    types: ["social"],
    adapter: bytedanceAdapter({
      entryPath: "/experienced/positions",
      detailPath: "/experienced/position",
      portalType: 6,
      defaultType: "social",
      headers: {},
      // 字节社招 reports 10000 rows.  It used to fall through to the factory's
      // default of 3 pages × 100 = 300 rows — 3% of the board, and silently so:
      // the walk ended because it ran out of *declared* pages, not because the
      // board ran out of jobs.  `limit` accepts 1000, so ten requests now cover it.
      pageSize: 1000,
      pages: 12
    })
  }),
  officialSource({
    id: "bytedance-campus",
    company: "字节跳动",
    group: "互联网 / AI",
    trust: 97,
    entryUrl: "https://jobs.bytedance.com/campus/position",
    types: ["campus", "internship"],
    adapter: bytedanceAdapter({
      entryPath: "/campus/position",
      detailPath: "/campus/position",
      portalType: 3,
      portalEntrance: 1,
      defaultType: "campus",
      headers: BYTEDANCE_CAMPUS_HEADERS,
      // Campus is the target user's main scenario, so it gets the deepest walk.
      // 字节校招 reports 7468 rows; five pages of 100 reached 7% of them.  At
      // limit 1000 the whole board costs eight requests.
      pageSize: 1000,
      pages: 9
    })
  }),
  officialSource({
    id: "baidu-social",
    company: "百度",
    group: "互联网 / AI",
    trust: 97,
    entryUrl: "https://talent.baidu.com/jobs/social-list",
    types: ["social"],
    adapter: {
      kind: "html",
      status: ADAPTER_STATUS.VERIFIED,
      pageUrl: "https://talent.baidu.com/jobs/social-list",
      defaultType: "social",
      // The social list page is server-rendered with its result set inlined.
      markers: ['"listDetailData":'],
      map: (item, { source, pageUrl, now }) => {
        let officialUrl = pageUrl;
        try {
          const url = new URL(pageUrl);
          const id = firstString(item?.postId, item?.jobId);
          if (id) url.searchParams.set("postId", id);
          officialUrl = url.href;
        } catch {
          officialUrl = pageUrl;
        }
        const condition = text(item?.serviceCondition, 8_000);
        const content = text(item?.workContent, 8_000);
        return officialRow(source, {
          title: firstString(item?.name, item?.title),
          official_url: officialUrl,
          location: firstString(item?.workPlace, source.defaultLocation),
          typeText: `${item?.projectType || ""} ${item?.recruitType || ""} ${item?.name || ""}`,
          jd_text: [
            condition ? `任职要求：\n${condition}` : "",
            content ? `工作内容：\n${content}` : ""
          ].filter(Boolean).join("\n\n"),
          publish_time: toIsoDate(item?.publishDate),
          deadline: toIsoDate(item?.deadline),
          full_description_verified: Boolean(condition && content),
          closed: item?.isValid === false
        }, now);
      }
    }
  }),

  // 网易's job site.  `currentPage` (not pageIndex/pageNo) is the page parameter —
  // the other spellings are silently ignored and quietly return page 1.  The list
  // text is byte-identical to the detail endpoint, so no detail call is needed.
  // `workType` 0 = 全职, 1 = 实习 (612 of 2699 at the time of writing).
  //
  // `pageSize` has a hard ceiling of **200**: 250 and above answer HTTP 200 with a
  // 92-byte body and zero rows.  That is the dangerous kind of limit — a zero-row
  // first page reads as "short page, board exhausted", so the walk would stop
  // immediately and report a successful sync with 0 jobs.  Hence the regression
  // test pinning this value.
  officialSource({
    id: "netease-careers",
    company: "网易",
    group: "内容 / 娱乐",
    trust: 95,
    entryUrl: "https://hr.163.com/job-list.html",
    types: ["social", "internship"],
    adapter: {
      kind: "json-api",
      status: ADAPTER_STATUS.VERIFIED,
      pages: 15,
      pageSize: 200,
      defaultType: "social",
      request: (page) => ({
        url: "https://hr.163.com/api/hr163/position/queryPage",
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          "user-agent": BROWSER_USER_AGENT,
          origin: "https://hr.163.com",
          referer: "https://hr.163.com/job-list.html"
        },
        body: { currentPage: page, pageSize: 200 }
      }),
      pick: (payload) => (Array.isArray(payload?.data?.list) ? payload.data.list : []),
      map: (item, { source, now }) => {
        const id = firstString(item?.id);
        if (!id) return null;
        const cities = (item?.workPlaceNameList || []).map(city => text(city, 60)).filter(Boolean);
        const typeWord = item?.workType === 1 ? "实习" : item?.workType === 0 ? "全职" : "";
        const description = text(item?.description, 8_000);
        const requirement = text(item?.requirement, 8_000);
        return officialRow(source, {
          title: item?.name,
          official_url: `https://hr.163.com/job-detail.html?id=${id}`,
          location: cities.join("；"),
          // workType is definitive: 0 = 全职, 1 = 实习.  A 社招 HR role titled
          // "校园招聘专员" must not be filed as a campus opening.
          job_type: item?.workType === 1 ? "internship" : item?.workType === 0 ? "social" : undefined,
          typeText: `${typeWord} ${item?.firstPostTypeName || ""} ${item?.productName || ""} ${item?.name || ""}`,
          jd_text: [
            description ? `职位描述：\n${description}` : "",
            requirement ? `任职要求：\n${requirement}` : ""
          ].filter(Boolean).join("\n\n"),
          publish_time: toIsoDate(item?.updateTime),
          full_description_verified: Boolean(description && requirement)
        }, now);
      }
    }
  }),

  // 美团's campus list already carries duties and requirements, so no detail call
  // is needed.  The route `/web/position/detail?jobUnionId=…` and the request body
  // were both read off the live site (bundle route table + captured XHR).
  officialSource({
    id: "meituan-careers",
    company: "美团",
    group: "电商 / 生活服务",
    trust: 96,
    entryUrl: "https://zhaopin.meituan.com/web/campus",
    types: ["campus", "internship"],
    adapter: {
      kind: "json-api",
      status: ADAPTER_STATUS.VERIFIED,
      // 美团 self-reports 563 rows (data.page.totalCount, 2026-10-12).  Six pages
      // of 100 left only 37 rows of headroom, i.e. one hiring round away from
      // silently truncating — the same shape as 字节社招 sitting at 3%.  Eight
      // pages leaves 237.  The extra pages are nearly free: pages are fetched in
      // batches of four and the walk stops after the batch containing the first
      // short page, so overshoot is bounded by three requests.
      pages: 8,
      pageSize: 100,
      defaultType: "campus",
      request: (page) => ({
        url: "https://zhaopin.meituan.com/api/official/job/getJobList",
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          "user-agent": BROWSER_USER_AGENT,
          origin: "https://zhaopin.meituan.com",
          referer: "https://zhaopin.meituan.com/web/campus"
        },
        body: {
          page: { pageNo: page, pageSize: 100 },
          jobShareType: "1",
          keywords: "",
          cityList: [],
          department: [],
          jfJgList: [],
          // jobType 1 = 校招, 2 = 实习; this pair is the campus page's own default.
          jobType: [{ code: "1", subCode: [] }, { code: "2", subCode: [] }],
          typeCode: [],
          specialCode: []
        }
      }),
      pick: (payload) => (Array.isArray(payload?.data?.list) ? payload.data.list : []),
      map: (item, { source, now }) => {
        const jobUnionId = firstString(item?.jobUnionId);
        if (!jobUnionId) return null;
        const cities = (item?.cityList || []).map(city => text(city?.name, 60)).filter(Boolean);
        const department = (item?.department || []).map(entry => text(entry?.name, 60)).filter(Boolean).join("/");
        // Spelling the portal out in words lets the shared type inference pick
        // campus vs internship per row instead of one default for the whole feed.
        const typeWord = item?.jobType === "2" ? "实习" : item?.jobType === "1" ? "校招" : "";
        const duty = text(item?.jobDuty, 8_000);
        const requirement = text(item?.jobRequirement, 8_000);
        return officialRow(source, {
          title: item?.name,
          official_url: `https://zhaopin.meituan.com/web/position/detail?jobUnionId=${jobUnionId}`,
          location: cities.join("；"),
          // jobType 1 = 校招, 2 = 实习 — a definitive field, not a title guess.
          job_type: item?.jobType === "2" ? "internship" : item?.jobType === "1" ? "campus" : undefined,
          typeText: `${typeWord} ${item?.jobFamily || ""} ${item?.jobFamilyGroup || ""} ${department} ${item?.name || ""}`,
          jd_text: [
            duty ? `工作职责：\n${duty}` : "",
            requirement ? `任职要求：\n${requirement}` : ""
          ].filter(Boolean).join("\n\n"),
          publish_time: toIsoDate(item?.refreshTime),
          full_description_verified: Boolean(duty && requirement)
        }, now);
      }
    }
  }),

  // 京东 addresses each job through a hash route (`#/details?id=<publishId>`,
  // read from the route table in its umi bundle), and the list response already
  // carries full duties and requirements, so no detail call is needed.
  officialSource({
    id: "jd-careers",
    company: "京东",
    group: "电商 / 生活服务",
    trust: 96,
    entryUrl: "https://campus.jd.com/#/jobs",
    types: ["campus", "internship"],
    adapter: {
      kind: "json-api",
      status: ADAPTER_STATUS.VERIFIED,
      // 京东 self-reports 124 rows (body.totalNumber, 2026-10-12) and its list
      // response already carries full duties, so two pages left 76 rows of
      // headroom — under one page.  Four pages leaves 276, for at most three
      // extra requests (see the batching note on 美团 above).
      pages: 4,
      pageSize: 100,
      defaultType: "campus",
      request: (page) => ({
        url: "https://campus.jd.com/api/wx/position/page?type=present",
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json;charset=UTF-8",
          "user-agent": BROWSER_USER_AGENT,
          origin: "https://campus.jd.com",
          referer: "https://campus.jd.com/"
        },
        body: {
          pageSize: 100,
          pageIndex: page - 1,
          parameter: { positionName: "", planIdList: [], jobDirectionCodeList: [], workCityCodeList: [], positionDeptList: [] }
        }
      }),
      pick: (payload) => (Array.isArray(payload?.body?.items) ? payload.body.items : []),
      map: (item, { source, now }) => {
        const publishId = firstString(item?.publishId);
        // Without a stable id there is no addressable job page, so there is no record.
        if (!publishId) return null;
        const cities = [...new Set((item?.requirementVoList || []).map(entry => jdCity(entry?.workCity)).filter(Boolean))];
        const workContent = text(item?.workContent, 8_000);
        const qualification = text(item?.qualification, 8_000);
        return officialRow(source, {
          title: item?.positionName,
          official_url: `https://campus.jd.com/#/details?id=${publishId}`,
          location: cities.join("；"),
          // The whole endpoint is the campus portal.
          job_type: "campus",
          typeText: `${item?.jobDirection || ""} ${item?.jobCategory || ""} ${item?.positionName || ""}`,
          jd_text: [
            workContent ? `工作内容：\n${workContent}` : "",
            qualification ? `任职要求：\n${qualification}` : ""
          ].filter(Boolean).join("\n\n"),
          publish_time: toIsoDate(item?.publishTime),
          full_description_verified: Boolean(workContent && qualification)
        }, now);
      }
    }
  }),

  // 华为 serves both portals from one gateway endpoint; `jobType` in the body picks
  // the portal.  The campus portal mixes 应届生 and 实习生, told apart by
  // `scenarioCode` (0 / 1), so the type is resolved per row.
  officialSource({
    id: "huawei-campus",
    company: "华为",
    group: "消费电子 / 智能硬件",
    trust: 98,
    entryUrl: "https://career.huawei.com/cn/campus-recruitment-job-list",
    types: ["campus", "internship"],
    adapter: huaweiAdapter({
      jobType: "CR",
      defaultType: "campus",
      pages: 3,
      resolveType: (item) => (item?.scenarioCode === "1" ? "internship" : item?.scenarioCode === "0" ? "campus" : undefined)
    })
  }),

  officialSource({
    id: "huawei-careers",
    company: "华为",
    group: "消费电子 / 智能硬件",
    trust: 98,
    entryUrl: "https://career.huawei.com/cn/social-recruitment-job-list",
    types: ["social"],
    adapter: huaweiAdapter({
      jobType: "SR",
      defaultType: "social",
      pages: 6,
      resolveType: () => "social"
    })
  }),

  // 小米 runs the same ATSX platform as 字节, on its own domain, with three disjoint
  // portals.  Its real board is NOT hr.xiaomi.com — see the note on the source below.
  officialSource({
    id: "xiaomi-careers",
    company: "小米",
    group: "消费电子 / 智能硬件",
    trust: 95,
    // The site's own social portal is `/index`, and the count it displays there
    // (1987) only matches when `website-path: index` is sent — see xiaomiAdapter.
    entryUrl: `${XIAOMI_ORIGIN}/index`,
    types: ["social"],
    adapter: xiaomiAdapter({ websitePath: "index", detailPath: "/index/position", defaultType: "social", pages: 3 })
  }),

  officialSource({
    id: "xiaomi-campus",
    company: "小米",
    group: "消费电子 / 智能硬件",
    trust: 95,
    entryUrl: `${XIAOMI_ORIGIN}/campus`,
    types: ["campus"],
    adapter: xiaomiAdapter({ websitePath: "campus", detailPath: "/campus/position", defaultType: "campus", pages: 2 })
  }),

  officialSource({
    id: "xiaomi-internship",
    company: "小米",
    group: "消费电子 / 智能硬件",
    trust: 95,
    entryUrl: `${XIAOMI_ORIGIN}/internship`,
    types: ["internship"],
    adapter: xiaomiAdapter({ websitePath: "internship", detailPath: "/internship/position", defaultType: "internship", pages: 2 })
  }),

  // 科大讯飞 runs 北森.  Its 「实习生招聘」 nav item is a real portal (/intern/jobs)
  // but that portal asks for Category ["3"] and the platform answers **0 rows**, so
  // no separate internship source is registered — the 12 实习 rows that do exist
  // live inside the campus categories and are split out by `iflytekCampusType`.
  // Registering an empty source would just be a page that always finds nothing.
  officialSource({
    id: "iflytek-careers",
    company: "科大讯飞",
    group: "互联网 / AI",
    trust: 84,
    // The old entry (campus.iflytek.com) 301s to this host; pointing entryUrl at a
    // *different* host would make hostAllowed() reject every row this source emits.
    entryUrl: `${IFLYTEK_ORIGIN}/social/jobs`,
    types: ["social"],
    adapter: beisenAdapter({
      origin: IFLYTEK_ORIGIN,
      categories: ["1"],
      entryPath: "/social/jobs",
      defaultType: "social",
      resolveType: () => "social",
      pages: 4
    })
  }),

  officialSource({
    id: "iflytek-campus",
    company: "科大讯飞",
    group: "互联网 / AI",
    trust: 84,
    entryUrl: `${IFLYTEK_ORIGIN}/campus/jobs`,
    types: ["campus", "internship"],
    adapter: beisenAdapter({
      origin: IFLYTEK_ORIGIN,
      // 校园招聘 + 飞星计划 + 飞凡计划 + 校园大使 + 星火X顶尖AI人才计划.
      categories: ["2", "4", "5", "6", "7"],
      entryPath: "/campus/jobs",
      defaultType: "campus",
      resolveType: iflytekCampusType,
      pages: 4
    })
  }),

  // Registered official entries without an extractor yet.  These produce zero
  // rows on purpose: an empty result the agent can explain beats a fake job.
  unadapted({
    id: "alibaba-careers", company: "阿里巴巴", group: "互联网 / AI", trust: 98,
    entryUrl: "https://talent.alibaba.com/campus/position-list", types: ["campus", "internship", "social"],
    reason: "接口已探明（POST /position/search，需先取 XSRF-TOKEN 作 _csrf），但未登录时会话下接口与页面都返回 0 个岗位，需要登录态才能取到职位，暂不接入。"
  }),
  unadapted({ id: "pinduoduo-careers", company: "拼多多", group: "电商 / 生活服务", trust: 96, entryUrl: "https://careers.pinduoduo.com/jobs", types: ["campus", "internship", "social"] }),
  unadapted({ id: "didi-careers", company: "滴滴", group: "电商 / 生活服务", trust: 94, entryUrl: "https://talent.didiglobal.com/", types: ["campus", "internship", "social"] }),
  unadapted({ id: "kuaishou-careers", company: "快手", group: "内容 / 娱乐", trust: 95, entryUrl: "https://zhaopin.kuaishou.cn/", types: ["campus", "internship", "social"] }),
  unadapted({ id: "honor-careers", company: "荣耀", group: "消费电子 / 智能硬件", trust: 82, entryUrl: "https://career.hihonor.com/", types: ["campus", "internship", "social"] }),
  unadapted({ id: "oppo-careers", company: "OPPO", group: "消费电子 / 智能硬件", trust: 82, entryUrl: "https://careers.oppo.com/", types: ["campus", "internship", "social"] }),
  unadapted({ id: "vivo-careers", company: "vivo", group: "消费电子 / 智能硬件", trust: 80, entryUrl: "https://hr.vivo.com/", types: ["campus", "internship", "social"] }),
  unadapted({ id: "dji-careers", company: "大疆", group: "消费电子 / 智能硬件", trust: 89, entryUrl: "https://we.dji.com/", types: ["campus", "internship", "social"] }),
  unadapted({ id: "byd-careers", company: "比亚迪", group: "新能源 / 智能制造", trust: 82, entryUrl: "https://job.byd.com/", types: ["campus", "internship", "social"] }),
  unadapted({ id: "catl-careers", company: "宁德时代", group: "新能源 / 智能制造", trust: 80, entryUrl: "https://www.catl.com/careers/", types: ["campus", "internship", "social"] }),
  unadapted({ id: "sensetime-careers", company: "商汤科技", group: "互联网 / AI", trust: 82, entryUrl: "https://www.sensetime.com/cn/careers", types: ["campus", "internship", "social"] }),
  unadapted({ id: "sangfor-careers", company: "深信服", group: "企业软件 / 云服务", trust: 82, entryUrl: "https://hr.sangfor.com/", types: ["campus", "internship", "social"] })
]);

/* ------------------------------------------------------------------ *
 * Loaders
 * ------------------------------------------------------------------ */

async function fetchJson(request, { signal, timeoutMs, fetchImpl }) {
  const hasBody = request.body !== undefined;
  const response = await fetchImpl(request.url, {
    method: request.method || "GET",
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      // Endpoints that take a JSON body reject the default text/plain that the
      // fetch implementation would otherwise attach.
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(request.headers || {})
    },
    body: hasBody ? JSON.stringify(request.body) : undefined,
    redirect: "follow",
    signal: withTimeout({ signal, timeoutMs })
  });
  const raw = await readResponseBody(response, signal);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("source_invalid_json");
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * A list endpoint often publishes duties only; the requirement text lives on the
 * detail page.  Enriching every row would mean hundreds of requests per sync, so
 * a source caps it (`detail.maxPerSync`).
 *
 * The cap is a *rate limit*, not a coverage limit.  The caller passes the rows
 * whose JD was already completed in an earlier sync (`knownDetails`, keyed by the
 * canonical job URL); those are restored from storage without a request, and the
 * budget is spent on the rows that still need it.  That keeps the budget
 * advancing every sync and makes the whole thing self-healing: a row whose detail
 * request failed stays unverified and is retried next time.  A failed detail
 * request must never drop the list row.
 */
async function enrichRows(source, rows, options) {
  const detail = source.adapter?.detail;
  if (!detail || typeof detail.request !== "function" || typeof detail.map !== "function") return rows;
  const limit = Math.max(0, Math.min(Number(detail.maxPerSync) || 0, rows.length));
  if (!limit) return rows;
  const known = options.knownDetails instanceof Map ? options.knownDetails : new Map();
  for (const row of rows) {
    const completed = known.get(row.official_url);
    if (typeof completed !== "string" || !completed) continue;
    row.jd_text = completed;
    row.full_description_verified = true;
  }
  const targets = rows.filter(row => !row.full_description_verified).slice(0, limit);
  if (!targets.length) return rows;
  const patches = await mapWithConcurrency(targets, DETAIL_CONCURRENCY, async (row) => {
    try {
      const request = detail.request(row, source);
      if (!request?.url) return null;
      const payload = await fetchJson(request, options);
      const picked = detail.pick ? detail.pick(payload, row) : payload;
      if (!picked) return null;
      return detail.map(picked, row, source);
    } catch {
      return null;
    }
  });
  targets.forEach((row, index) => {
    const patch = patches[index];
    if (patch) Object.assign(row, patch);
  });
  return rows;
}

async function loadJsonApiSource(source, options) {
  const adapter = source.adapter;
  const pages = Math.max(1, Math.min(Number(adapter.pages) || 1, MAX_PAGES));
  const pageSize = Number(adapter.pageSize) || 100;
  const rows = [];
  // Pages inside one source used to be walked strictly one at a time, which made a
  // deep source the slowest thing in the whole sync: 小米社招 is 20 pages and took
  // 22 s on its own, turning a 7 s sync into a 24 s one.  They are independent
  // reads, so they now go out in batches.
  //
  // The first page is still fetched alone.  It answers "is this source small?"
  // for the price of one request, so a 10-row source does not pay for four.
  let page = 1;
  let alone = true;
  while (page <= pages) {
    const batch = [];
    const size = alone ? 1 : PAGE_CONCURRENCY;
    alone = false;
    for (let index = 0; index < size && page <= pages; index += 1, page += 1) batch.push(page);
    const payloads = await mapWithConcurrency(batch, PAGE_CONCURRENCY, async (target) => {
      options.signal?.throwIfAborted();
      return fetchJson(adapter.request(target, source), options);
    });
    let shortPageSeen = false;
    payloads.forEach((payload, index) => {
      const items = adapter.pick(payload);
      if (!Array.isArray(items)) throw new Error("source_invalid_shape");
      for (const item of items) {
        const row = adapter.map(item, { source, page: batch[index], now: options.now });
        if (row && isUsableRow(row, source)) rows.push(row);
      }
      if (items.length < pageSize) shortPageSeen = true;
    });
    if (shortPageSeen) break;
  }
  return enrichRows(source, rows, options);
}

async function loadHtmlSource(source, options) {
  const adapter = source.adapter;
  const pageUrl = adapter.pageUrl || source.entryUrl;
  const response = await options.fetchImpl(pageUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.1",
      "user-agent": USER_AGENT
    },
    redirect: "follow",
    signal: withTimeout(options)
  });
  const html = await readResponseBody(response, options.signal);
  return parseOfficialPage(html, source, { pageUrl: response.url || pageUrl, now: options.now });
}

/**
 * Load one official source and report what actually happened, so the caller can
 * distinguish "no listings right now" from "no adapter exists yet".
 */
export async function loadOfficialSource(source, { signal, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now(), knownDetails } = {}) {
  const adapter = source?.adapter;
  if (!adapter?.kind) throw new Error("source_missing_adapter");
  const options = { signal, fetchImpl, timeoutMs, now, knownDetails };
  if (adapter.kind === "unadapted") {
    return { rows: [], adapterKind: "unadapted", adapterStatus: adapter.status, reason: adapter.reason, fetched: false };
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch_unavailable");
  const rows = adapter.kind === "json-api"
    ? await loadJsonApiSource(source, options)
    : await loadHtmlSource(source, options);
  return {
    rows: dedupeRows(rows),
    adapterKind: adapter.kind,
    adapterStatus: adapter.status,
    reason: adapter.reason || "",
    fetched: true
  };
}

/** Fetch and parse one official source. Exported for deterministic loader tests. */
export async function loadOfficialJobFeed(source, options = {}) {
  const { rows } = await loadOfficialSource(source, options);
  return rows;
}

export function getOfficialJobSources() {
  return OFFICIAL_JOB_SOURCES.map(source => ({
    ...source,
    types: [...source.types],
    allowedHosts: [...source.allowedHosts]
  }));
}

export function officialSourcesByStatus(status) {
  return getOfficialJobSources().filter(source => source.adapter.status === status);
}
