import { loadNcssJobDetail } from "./ncssJobFeed.js";

// On-demand official JD fetch for one selected job. Each fetcher reads the
// employer's own posting (careers site or its ATS), never another aggregator.
// Returns null when no fetcher supports the link; throws when a supported fetch fails.

const FETCH_TIMEOUT_MS = 18000;
const MAX_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 ResumeProtocol/1.0";
const REQUIREMENT_HEADING = /^(?:任职要求|岗位要求|任职资格|职位要求|requirements?|(?:basic|minimum|preferred)?\s*qualifications?|what you(?:(?:'|’)?ll| will) (?:need|bring)|what we(?:'|’)?re looking for|who you are|you (?:have|bring|should have)|(?:your )?skills (?:and|&) (?:experience|expertise|requirements))\b/i;
const OTHER_HEADING = /^(?:岗位职责|工作职责|职位描述|(?:primary |key |main )?responsibilities|what you(?:(?:'|’)?ll| will) do|about (?:us|the (?:team|role|company))|benefits|perks|compensation|pay (?:range|transparency)|salary|equal (?:employment )?opportunity|why join|our (?:benefits|culture)|[a-z ]{0,40}(?:salary|pay) range)\b/i;
const DUTY_HEADING = /^(?:(?:primary |key |main )?responsibilities|what you(?:(?:'|’)?ll| will) do|about the role)\b/i;

function sectionHeading(line) {
  const heading=line.normalize('NFKC').replace(/^(?:[一二三四五六七八九十]+[、.]|[1-9][、.])\s*/,'').replace(/^【([^】]+)】\s*[:：]?\s*/,'$1:');
  const chinese=[
    ['requirements',/^(?:任职要求|岗位要求|任职资格|职位要求|招聘要求|任职条件)(?:\s*[:：]\s*(.*))?$/],
    ['responsibilities',/^(?:岗位职责|工作职责|职位描述|工作内容|职位职责)(?:\s*[:：]\s*(.*))?$/],
    ['other',/^(?:薪资福利|薪酬福利|福利待遇|薪资待遇|加分项|优先条件|公司介绍|企业文化|团队介绍|关于我们|公司文化)(?:\s*[:：]\s*(.*))?$/]
  ];
  for(const [kind,pattern] of chinese) {const match=heading.match(pattern);if(match)return {kind,body:match[1]||''};}
  if(/^【[^】\n]{1,30}】\s*[:：]?\s*$/.test(line) || /^(?:我们(?:秉承|倡导|崇尚|坚持).{0,40}(?:文化|理念)|关于(?:公司|团队))/.test(line)) return {kind:'other',body:''};
  if(heading.length>80) return null;
  for(const [kind,pattern] of [['requirements',REQUIREMENT_HEADING],['responsibilities',DUTY_HEADING],['other',OTHER_HEADING]]) {
    const match=heading.match(pattern);
    if(!match) continue;
    const tail=heading.slice(match[0].length).trim();
    if(!tail || tail.startsWith(':') || tail.startsWith('：')) return {kind,body:tail.replace(/^[:：]\s*/,'')};
  }
  return null;
}

export async function loadJobDetail(job, { signal, fetchImpl = fetch } = {}) {
  const url = parseUrl(job?.url);
  if (!url) return null;
  if (/(^|\.)greenhouse\.io$/i.test(url.hostname)) return loadGreenhouseDetail(url, { signal, fetchImpl });
  if (/\.myworkdayjobs\.com$/i.test(url.hostname)) return loadWorkdayDetail(url, { signal, fetchImpl });
  if (/^(www\.)?ncss\.cn$/i.test(url.hostname)) {
    const html = await loadNcssJobDetail(url, { signal, fetchImpl });
    // A republishing platform: readable text, never a verified official JD.
    return html === null ? null : { ...fromHtml(html, url.href, "ncss"), verified: false, aggregator: true };
  }
  return null;
}

// job-boards.greenhouse.io/{board}/jobs/{id} → public Job Board API.
async function loadGreenhouseDetail(url, { signal, fetchImpl }) {
  const match = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  if (!match) return null;
  const json = await fetchJson(fetchImpl, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(match[1])}/jobs/${match[2]}`, { signal });
  if (!json?.content) throw new Error("invalid_greenhouse_detail_response");
  return fromHtml(decodeHtml(json.content), url.href, "greenhouse");
}

// {tenant}.wdN.myworkdayjobs.com/[locale/]{site}/job/{path} → the CXS JSON the page itself loads.
async function loadWorkdayDetail(url, { signal, fetchImpl }) {
  const parts = url.pathname.split("/").filter(Boolean);
  const jobIndex = parts.indexOf("job");
  if (jobIndex < 1 || jobIndex === parts.length - 1) return null;
  const tenant = url.hostname.split(".")[0];
  const site = parts[jobIndex - 1];
  const api = `${url.origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/job/${parts.slice(jobIndex + 1).join("/")}`;
  const json = await fetchJson(fetchImpl, api, { signal });
  const html = json?.jobPostingInfo?.jobDescription;
  if (!html) throw new Error("invalid_workday_detail_response");
  return fromHtml(html, url.href, "workday");
}

// Splits a posting into its full text and the lines under a requirements
// heading. No such heading → requirements stay empty and the JD stays unverified.
export function fromHtml(html, url, provider) {
  const lines = htmlToText(html).split("\n").map((line) => line.trim()).filter(Boolean);
  const requirements = [],responsibilities=[];
  const headings={requirements:0,responsibilities:0};
  let section='other',truncated=false;
  const append=line=>{
    const target=section==='requirements'?requirements:section==='responsibilities'?responsibilities:null;
    if(!target || !line.trim()) return;
    if(target.length>=30 || line.length>1000) truncated=true;
    if(target.length<30) target.push(line.slice(0,1000));
  };
  for (const line of lines) {
    const heading=sectionHeading(line);
    if(heading) {
      section=heading.kind;
      if(section in headings) headings[section]++;
      append(heading.body);
    } else append(line);
  }
  const fullText=lines.join('\n');
  if(fullText.length>20000) truncated=true;
  const description = fullText.slice(0, 20000);
  return { description, requirements, responsibilities, url, provider,
    sectionEvidenceComplete:!truncated && description.length>=20 && responsibilities.length>0 && requirements.length>0 && headings.responsibilities===1 && headings.requirements===1,
    verified: !truncated && description.length >= 20 && requirements.length > 0 };
}

function htmlToText(html) {
  return decodeHtml(String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h[1-6]|ul|ol|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\r\f\v]+/g, " ");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;|&ndash;/g, "-")
    .replace(/&amp;/g, "&");
}

async function fetchJson(fetchImpl, url, { signal }) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: "error"
  });
  if (!response.ok) throw new Error(`detail_http_${response.status}`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("detail_too_large");
  return JSON.parse(text);
}

function parseUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
