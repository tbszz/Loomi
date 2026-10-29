import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ADAPTER_STATUS,
  getOfficialJobSources,
  loadOfficialJobFeed,
  loadOfficialSource,
  officialSourcesByStatus,
  parseOfficialPage
} from "./officialJobSources.js";
import { createJobKnowledge, isSyncableFeed } from "./jobKnowledge.js";

const now = Date.parse("2026-10-12T08:00:00.000Z");
const jsonResponse = (payload) => ({ ok: true, status: 200, url: "https://example.com/final", text: async () => JSON.stringify(payload) });
const htmlResponse = (html) => ({ ok: true, status: 200, url: "https://example.com/final", text: async () => html });
const sources = getOfficialJobSources();
const verified = officialSourcesByStatus(ADAPTER_STATUS.VERIFIED);
const unadapted = officialSourcesByStatus(ADAPTER_STATUS.UNADAPTED);

/* Registry integrity -------------------------------------------------- */

assert.ok(sources.length >= 20, "the registry must cover the mainstream domestic employers");
assert.equal(new Set(sources.map(source => source.id)).size, sources.length, "source ids must be unique");
assert.ok(sources.every(source => {
  const url = new URL(source.entryUrl);
  return source.company && url.protocol === "https:" && source.group && source.trust >= 80 && source.types.length;
}));
assert.ok(sources.every(source => !/github|lagou|zhipin|liepin/i.test(source.entryUrl)));
assert.ok(sources.every(source => source.adapter?.kind && source.adapter?.status));
assert.equal(verified.length + unadapted.length, sources.length);
assert.equal(getOfficialJobSources().length, sources.length);

// A verified source must know how to read its own payload.  Nothing else may
// claim to produce jobs.
assert.ok(verified.length >= 4, "at least four feeds must have a real adapter, campus included");
assert.ok(verified.every(source => source.adapter.status === ADAPTER_STATUS.VERIFIED));
assert.ok(verified.every(source => (source.adapter.kind === "json-api"
  ? typeof source.adapter.pick === "function" && typeof source.adapter.map === "function" && typeof source.adapter.request === "function"
  : Array.isArray(source.adapter.markers) && typeof source.adapter.map === "function")));
assert.ok(unadapted.every(source => source.adapter.kind === "unadapted" && !source.adapter.map && source.adapter.reason));

// 美团 is zhaopin.meituan.com.  campus.meitu.com belongs to 美图 and was the
// reason three navigation links were once imported as Meituan jobs.
assert.equal(new URL(sources.find(source => source.id === "meituan-careers").entryUrl).host, "zhaopin.meituan.com");
assert.ok(sources.every(source => !/meitu\.com/i.test(source.entryUrl)));

/* Adapter mapping (offline fixtures) ---------------------------------- */

// Field shapes recorded from the live endpoints on 2026-10-12.
const tencent = sources.find(source => source.id === "tencent-careers");
const tencentRequests = [];
const tencentRows = await loadOfficialJobFeed(tencent, {
  now,
  fetchImpl: async (url, options) => {
    tencentRequests.push({ url, options });
    if (url.includes("/post/ByPostId")) {
      return jsonResponse({
        Code: 200,
        Data: {
          PostId: "1",
          Responsibility: "负责服务端系统设计与开发。",
          Requirement: "熟悉 Node.js、分布式系统与数据库设计。",
          LastUpdateTime: "2026年10月12日"
        }
      });
    }
    return jsonResponse({
      Data: {
        Count: 1,
        Posts: [{
          PostId: "1",
          RecruitPostName: "高级后端工程师",
          CountryName: "中国",
          LocationName: "深圳",
          CategoryName: "技术",
          Responsibility: "负责服务端系统设计与开发。",
          LastUpdateTime: "2026年10月12日",
          PostURL: "http://careers.tencent.com/jobdesc.html?postId=1",
          IsValid: true,
          RequireWorkYearsName: "三年以上工作经验"
        }]
      }
    });
  }
});
assert.equal(tencentRows.length, 1);
assert.equal(tencentRows[0].company_name, "腾讯");
assert.equal(tencentRows[0].official_url, "https://careers.tencent.com/jobdesc.html?postId=1", "an official http link is upgraded, never dropped");
assert.equal(tencentRows[0].location, "中国 深圳");
assert.equal(tencentRows[0].job_type, "social", "the social endpoint types its rows even without a keyword in the title");
assert.equal(tencentRows[0].publish_time, "2026-10-12");
assert.equal(tencentRows[0].last_seen, new Date(now).toISOString());
assert.equal(tencentRows[0].origin_source_url, tencent.entryUrl);
// The list endpoint carries duties only, so the row is upgraded by the detail call.
assert.equal(tencentRows[0].full_description_verified, true, "the detail endpoint supplies the requirement text");
assert.match(tencentRows[0].jd_text, /任职要求：/);
assert.match(tencentRows[0].jd_text, /熟悉 Node\.js/);
assert.equal(tencentRequests.length, 2, "one list request, then one detail request");
assert.match(tencentRequests[0].url, /pageIndex=1/);
assert.equal(tencentRequests[0].options.headers["user-agent"], "ResumeProtocol-OfficialJobSource/1.1");
assert.match(tencentRequests[1].url, /ByPostId\?postId=1/);

// Detail enrichment is capped, and a detail failure must not lose the list row.
assert.ok(Number.isInteger(tencent.adapter.detail.maxPerSync) && tencent.adapter.detail.maxPerSync > 0);
const cappedSource = { ...tencent, adapter: { ...tencent.adapter, detail: { ...tencent.adapter.detail, maxPerSync: 3 } } };
const cappedPosts = Array.from({ length: 5 }, (_value, index) => ({
  PostId: String(index + 1),
  RecruitPostName: `后端开发工程师${index + 1}`,
  LocationName: "深圳",
  Responsibility: "负责服务端系统设计与开发。",
  LastUpdateTime: "2026年10月12日",
  PostURL: `https://careers.tencent.com/jobdesc.html?postId=${index + 1}`,
  IsValid: true
}));
const cappedRequests = [];
const cappedRows = await loadOfficialJobFeed(cappedSource, {
  now,
  fetchImpl: async (url) => {
    cappedRequests.push(url);
    if (url.includes("/post/ByPostId")) {
      if (url.includes("postId=2")) return { ok: false, status: 500, url, text: async () => "" };
      return jsonResponse({ Data: { Responsibility: "负责服务端系统设计与开发。", Requirement: "熟悉 Node.js。", LastUpdateTime: "2026年10月12日" } });
    }
    return jsonResponse({ Data: { Count: cappedPosts.length, Posts: cappedPosts } });
  }
});
assert.equal(cappedRows.length, 5, "every list row survives, enriched or not");
assert.equal(cappedRequests.filter(url => url.includes("/post/ByPostId")).length, 3, "detail calls are bounded by maxPerSync");
assert.equal(cappedRows.filter(row => row.full_description_verified).length, 2);
assert.equal(cappedRows[1].full_description_verified, false);
assert.match(cappedRows[1].jd_text, /负责服务端系统设计与开发/, "a failed detail call keeps the duties from the list");
assert.equal(cappedRows[3].full_description_verified, false, "rows past the cap keep the list payload");

// The cap is a rate limit, not a coverage limit.  Driving it through the real
// jobKnowledge path also guards the regression that made an earlier draft wrong:
// rebuilding a row from the list alone silently downgraded a JD that an earlier
// sync had already completed.
const detailDb = new DatabaseSync(":memory:");
const detailCalls = [];
const detailFetch = async (url) => {
  if (String(url).includes("/post/ByPostId")) {
    detailCalls.push(String(url));
    return jsonResponse({ Data: { Responsibility: "负责服务端系统设计与开发。", Requirement: "熟悉 Node.js。", LastUpdateTime: "2026年10月12日" } });
  }
  return jsonResponse({ Data: { Count: cappedPosts.length, Posts: cappedPosts } });
};
const rateTencent = { ...tencent, adapter: { ...tencent.adapter, detail: { ...tencent.adapter.detail, maxPerSync: 2 } } };
const detailService = createJobKnowledge(detailDb, {
  clock: () => now,
  feeds: [rateTencent],
  loader: (feed, options) => loadOfficialJobFeed(feed, { ...options, fetchImpl: detailFetch })
});
const storedVerified = () => detailDb.prepare(
  "SELECT COUNT(*) AS n FROM job_knowledge_records WHERE json_extract(payload,'$.fullDescriptionVerified')=1"
).get().n;
const storedRows = () => detailDb.prepare("SELECT COUNT(*) AS n FROM job_knowledge_records").get().n;
const perPass = [];
for (let pass = 0; pass < 4; pass += 1) {
  const before = detailCalls.length;
  await detailService.sync({ force: true });
  perPass.push(detailCalls.length - before);
  assert.equal(storedRows(), 5, "the list is complete on every pass");
}
assert.deepEqual(perPass, [2, 2, 1, 0], "each sync completes the next slice of the detail budget");
assert.equal(storedVerified(), 5, "an already-completed JD must survive later syncs");
assert.equal(detailCalls.length, 5, "each detail page is fetched exactly once across syncs");
await detailService.stop();
detailDb.close();

const bytedance = sources.find(source => source.id === "bytedance-careers");
const bytedanceRequests = [];
const bytedanceRows = await loadOfficialJobFeed(bytedance, {
  now,
  fetchImpl: async (url, options) => {
    bytedanceRequests.push({ url, options });
    return jsonResponse({
      code: 0,
      data: {
        count: 1,
        job_post_list: [{
          id: "7694585349214030133",
          title: "AI 应用工程师",
          description: "负责大模型应用研发、评测和上线迭代。",
          requirement: "熟悉 Python、RAG 与向量检索。",
          job_category: { name: "算法", parent: { name: "研发" } },
          city_list: [{ name: "北京" }, { name: "上海" }],
          recruit_type: { name: "社招" },
          publish_time: 1791535405262
        }]
      }
    });
  }
});
assert.equal(bytedanceRows.length, 1);
assert.equal(bytedanceRows[0].official_url, "https://jobs.bytedance.com/experienced/position/7694585349214030133/detail");
assert.equal(bytedanceRows[0].location, "北京；上海");
assert.equal(bytedanceRows[0].job_type, "social");
assert.match(bytedanceRows[0].jd_text, /任职要求：/);
assert.equal(bytedanceRows[0].full_description_verified, true, "duties + requirements is a verifiable JD");
assert.equal(bytedanceRequests[0].options.method, "POST");
assert.equal(bytedanceRequests[0].options.headers["content-type"], "application/json");
assert.equal(JSON.parse(bytedanceRequests[0].options.body).offset, 0);
// Regression guard: `Portal-Channel: social` makes the endpoint answer with an
// empty list, so the social adapter must not send a portal header at all.
assert.equal(bytedanceRequests[0].options.headers["Portal-Channel"], undefined);
assert.equal(JSON.parse(bytedanceRequests[0].options.body).portal_entrance, undefined);

/* Campus portal (same endpoint, selected by request headers) ---------- */

const bytedanceCampus = sources.find(source => source.id === "bytedance-campus");
assert.ok(bytedanceCampus, "campus coverage is the target user's main scenario");
assert.equal(new URL(bytedanceCampus.entryUrl).host, "jobs.bytedance.com");
assert.deepEqual(bytedanceCampus.types, ["campus", "internship"]);
assert.equal(bytedanceCampus.adapter.status, ADAPTER_STATUS.VERIFIED);
// Campus is the target user's main scenario, so both 字节 feeds must be able to
// walk their *whole* board rather than take a token sample.  Comparing page
// counts is the wrong test now that `pageSize` is a lever — 社招 legitimately has
// more pages because it has a bigger board.  Compare reach against the totals the
// endpoint itself reports instead (10000 社招 / 7468 校招, measured 2026-10-12).
assert.ok(
  bytedanceCampus.adapter.pages * bytedanceCampus.adapter.pageSize >= 7468,
  "the campus feed must be able to reach all 7468 campus rows"
);
assert.ok(
  bytedance.adapter.pages * bytedance.adapter.pageSize >= 10000,
  "the social feed must be able to reach all 10000 social rows"
);

const campusRequests = [];
const campusRows = await loadOfficialJobFeed(bytedanceCampus, {
  now,
  fetchImpl: async (url, options) => {
    campusRequests.push({ url, options });
    return jsonResponse({
      code: 0,
      data: {
        count: 2,
        // Shapes recorded from jobs.bytedance.com/campus/position on 2026-10-12.
        job_post_list: [
          {
            id: "7667878785178552629",
            title: "XR系统应用开发工程师 - 移动OS",
            description: "团队介绍：聚焦 AI 与智能硬件的深度融合，参与从技术探索到场景落地的全链路研发。",
            requirement: "1、2027届获得本科及以上学历，计算机、软件工程等相关专业优先；",
            job_category: { name: "客户端", parent: { name: "研发" } },
            city_list: [{ name: "北京" }],
            recruit_type: { id: "201", name: "正式", parent: { id: "2", name: "校招" } },
            job_subject: { id: "7649336829398468869", name: { zh_cn: "2027届校园招聘", en_us: null, i18n: "2027届校园招聘" } },
            publish_time: 1785317156317
          },
          {
            id: "7595092459300292869",
            title: "代码质量大模型算法实习生-质量技术",
            description: "负责代码质量方向的大模型数据构建与效果评测。",
            requirement: "熟悉 Python，了解大模型评测方法。",
            job_category: { name: "算法", parent: { name: "研发" } },
            city_list: [{ name: "杭州" }],
            recruit_type: { id: "202", name: "实习", parent: { id: "2", name: "校招" } },
            job_subject: { id: "1", name: { zh_cn: "日常实习", i18n: "日常实习" } },
            publish_time: 1768370276228
          }
        ]
      }
    });
  }
});
assert.equal(campusRows.length, 2);
assert.equal(campusRows[0].job_type, "campus", "校招/正式 is a campus role");
assert.equal(campusRows[1].job_type, "internship", "校招/实习 is an internship");
assert.equal(campusRows[0].official_url, "https://jobs.bytedance.com/campus/position/7667878785178552629/detail");
assert.equal(campusRows[1].official_url, "https://jobs.bytedance.com/campus/position/7595092459300292869/detail");
assert.equal(campusRows[0].location, "北京");
assert.equal(campusRows[0].full_description_verified, true);
// The graduation cohort is the one thing a student must check before applying.
assert.match(campusRows[0].jd_text, /^招聘批次：2027届校园招聘/);
assert.match(campusRows[1].jd_text, /^招聘批次：日常实习/);
assert.match(campusRows[0].jd_text, /任职要求：/);
// The portal switch is a request header, and it overrides portal_type.
assert.equal(campusRequests[0].options.headers["Portal-Channel"], "campus");
assert.equal(campusRequests[0].options.headers["website-path"], "campus");
assert.equal(campusRequests[0].options.headers["Portal-Platform"], "pc");
assert.equal(campusRequests[0].options.headers["user-agent"], bytedanceRequests[0].options.headers["user-agent"]);
assert.equal(JSON.parse(campusRequests[0].options.body).portal_type, 3);
assert.equal(JSON.parse(campusRequests[0].options.body).portal_entrance, 1);
assert.equal(campusRequests.length, 1, "a short page ends the walk");

// Two feeds for one employer must not collapse into one source id.
assert.equal(sources.filter(source => source.company === "字节跳动").length, 2);

// The Baidu extractor is declared per source, not hard-coded in the parser.
const baidu = sources.find(source => source.id === "baidu-social");
const baiduPost = {
  name: "FDE工程师（前沿部署工程师）（J106469）",
  postId: "bac8b0ef-ca7e-46c9-a15f-2a81c776140f",
  workPlace: "北京市",
  publishDate: "2026-10-12",
  serviceCondition: "本科及以上，熟悉 Python 与大模型应用。",
  workContent: "负责 AI 应用研发、评测和上线迭代。"
};
const baiduHtml = `<html><body><script>window.__INITIAL_DATA__={"listDetailData":[${JSON.stringify(baiduPost)}]}</script></body></html>`;
const baiduRows = parseOfficialPage(baiduHtml, baidu, { pageUrl: baidu.adapter.pageUrl, now });
assert.equal(baiduRows.length, 1);
assert.equal(baiduRows[0].title, baiduPost.name);
assert.equal(baiduRows[0].location, "北京市");
assert.equal(baiduRows[0].job_type, "social");
assert.match(baiduRows[0].official_url, /postId=bac8b0ef/);
assert.equal(baiduRows[0].full_description_verified, true);
assert.deepEqual(
  parseOfficialPage(baiduHtml, tencent, { pageUrl: tencent.entryUrl, now }),
  [],
  "a JSON-API source must not read someone else's embedded payload"
);

/* False positives are refused ----------------------------------------- */

// The exact shapes that used to be imported as jobs: navigation entries,
// recruitment announcements and off-site article links.
const junkHtml = `<script>window.__INITIAL_DATA__={"listDetailData":${JSON.stringify([
  { ...baiduPost, name: "校园招聘", postId: "nav-1" },
  { ...baiduPost, name: "2027届校园招聘正式启动", postId: "news-1" },
  { ...baiduPost, name: "华为2024届应届生全球招聘", postId: "news-2" }
])}}</script>`;
assert.deepEqual(parseOfficialPage(junkHtml, baidu, { pageUrl: baidu.adapter.pageUrl, now }), []);
// ...and the opposite mistake: a role name that merely contains an
// announcement-ish word must survive the filter.
const roleTitleRows = parseOfficialPage(
  `<script>window.__INITIAL_DATA__={"listDetailData":${JSON.stringify([
    { ...baiduPost, name: "《三角洲行动》-国服活动运营（世界观衍生）", postId: "role-1" },
    { ...baiduPost, name: "微信视频号-高级推荐大模型算法工程师-直播方向", postId: "role-2" }
  ])}}</script>`,
  baidu,
  { pageUrl: baidu.adapter.pageUrl, now }
);
assert.deepEqual(roleTitleRows.map(row => row.title), [
  "《三角洲行动》-国服活动运营（世界观衍生）",
  "微信视频号-高级推荐大模型算法工程师-直播方向"
]);
assert.deepEqual(
  parseOfficialPage('<a href="/campus-recruitment">校园招聘</a><a href="/post/200">后端开发实习</a>', baidu, { pageUrl: baidu.adapter.pageUrl, now }),
  [],
  "plain links are never promoted to job records"
);
assert.deepEqual(
  parseOfficialPage(
    `<script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "百度", url: "https://talent.baidu.com/about", description: "公司介绍。".repeat(60) })}</script>`,
    baidu,
    { pageUrl: baidu.adapter.pageUrl, now }
  ),
  [],
  "non-JobPosting structured data is ignored"
);
const jsonLdJob = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "数据分析师",
  url: "https://talent.baidu.com/jobs/social-list?postId=ld-1",
  description: "负责指标体系与数据分析。".repeat(30),
  datePosted: "2026-09-01",
  hiringOrganization: { name: "百度" },
  jobLocation: { address: { addressLocality: "北京市" } }
};
const jsonLdRows = parseOfficialPage(
  `<script type="application/ld+json">${JSON.stringify(jsonLdJob)}</script>`,
  baidu,
  { pageUrl: baidu.adapter.pageUrl, now }
);
assert.equal(jsonLdRows.length, 1);
assert.equal(jsonLdRows[0].title, "数据分析师");
assert.equal(jsonLdRows[0].company_name, "百度");
assert.equal(jsonLdRows[0].full_description_verified, true);
assert.deepEqual(
  parseOfficialPage(
    `<script type="application/ld+json">${JSON.stringify({ ...jsonLdJob, url: "https://mp.weixin.qq.com/s/announcement" })}</script>`,
    baidu,
    { pageUrl: baidu.adapter.pageUrl, now }
  ),
  [],
  "a JobPosting hosted off the official site is not an official job"
);

/* 京东: hash routes and a list that already carries the full JD ------- */

const jd = sources.find(source => source.id === "jd-careers");
assert.equal(jd.adapter.status, ADAPTER_STATUS.VERIFIED, "京东 must not stay entry-only");
const jdRequests = [];
const jdRows = await loadOfficialJobFeed(jd, {
  now,
  fetchImpl: async (url, options) => {
    jdRequests.push({ url, options });
    return jsonResponse({
      success: true,
      // Shape recorded from campus.jd.com/api/wx/position/page on 2026-10-12.
      body: {
        totalNumber: 1,
        pageCount: 0,
        items: [{
          publishId: 9260,
          reqId: 2474,
          positionName: "安全管理/损耗控制",
          publishTime: 1786938172000,
          jobDirection: "一线职能方向",
          jobCategory: "物流防损类",
          workContent: "1.负责所辖业务区域的各项安全管理工作或损耗控制工作；\n2.依据法规及公司策略，拟定安全管理制度。",
          qualification: "1.2026年10月1日至2027年9月30日期间毕业，统招本科及以上学历；\n2.逻辑思维清晰，能够积极主动地思考并推动问题解决。",
          requirementVoList: [
            { workCity: "上海市-上海市" },
            { workCity: "广东省-深圳市" },
            { workCity: "上海市-上海市" }
          ]
        }]
      }
    });
  }
});
assert.equal(jdRows.length, 1);
assert.equal(jdRows[0].title, "安全管理/损耗控制");
// The point of the hash rule: without it every 京东 detail link collapses to the
// site root, so the user is sent to a job list instead of the job.
assert.equal(jdRows[0].official_url, "https://campus.jd.com/#/details?id=9260");
assert.equal(jdRows[0].location, "上海市；深圳市", "cities are de-duplicated and reduced to the city segment");
assert.equal(jdRows[0].job_type, "campus");
assert.equal(jdRows[0].publish_time, "2026-08-17");
assert.match(jdRows[0].jd_text, /^工作内容：/);
assert.match(jdRows[0].jd_text, /任职要求：/);
assert.equal(jdRows[0].full_description_verified, true);
assert.match(jdRequests[0].url, /position\/page\?type=present/);
assert.equal(JSON.parse(jdRequests[0].options.body).pageIndex, 0);
assert.equal(jdRequests[0].options.headers["user-agent"], bytedanceRequests[0].options.headers["user-agent"]);

// A posting without an addressable page is dropped, never linked to a guess.
const jdWithoutId = await loadOfficialJobFeed(jd, {
  now,
  fetchImpl: async () => jsonResponse({ success: true, body: { items: [{ positionName: "无编号岗位", workContent: "内容", qualification: "要求" }] } })
});
assert.deepEqual(jdWithoutId, []);

// ...while a plain scroll anchor is still stripped, so the same job does not
// appear twice under two fragments.
const anchorRows = parseOfficialPage(
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "数据分析师",
    url: "https://talent.baidu.com/jobs/social-list?postId=anchor-1#apply",
    description: "负责指标体系与数据分析。".repeat(30),
    hiringOrganization: { name: "百度" }
  })}</script>`,
  baidu,
  { pageUrl: baidu.adapter.pageUrl, now }
);
assert.equal(anchorRows[0].official_url, "https://talent.baidu.com/jobs/social-list?postId=anchor-1");

/* 美团 / 网易: definitive per-row type, and a page walk that is not truncated -- */

const meituan = sources.find(source => source.id === "meituan-careers");
assert.equal(meituan.adapter.status, ADAPTER_STATUS.VERIFIED, "美团 must not stay entry-only");
const meituanRequests = [];
const meituanRows = await loadOfficialJobFeed(meituan, {
  now,
  fetchImpl: async (url, options) => {
    meituanRequests.push({ url, options });
    return jsonResponse({
      // Shape recorded from zhaopin.meituan.com/api/official/job/getJobList.
      data: {
        page: { pageNo: 1, pageSize: 100, totalPage: 1, totalCount: 2 },
        list: [
          {
            jobUnionId: "4697320043", name: "AI全栈工程师", jobType: "1", jobFamily: "技术类", jobFamilyGroup: "软件",
            cityList: [{ name: "北京市" }, { name: "上海市" }], department: [{ name: "到家研发平台" }],
            jobDuty: "1. 参与 AI 应用的全栈开发。", jobRequirement: "1. 熟悉 React 与 Node.js。",
            refreshTime: 1786960999000, jobStatus: "000"
          },
          {
            jobUnionId: "4634824849", name: "小象超市-招聘实习生", jobType: "2", jobFamily: "职能类",
            cityList: [{ name: "北京市" }], department: [],
            jobDuty: "1. 协助招聘工作。", jobRequirement: "1. 本科及以上学历，27届及以后在校生。",
            refreshTime: 1786960999000, jobStatus: "000"
          }
        ]
      }
    });
  }
});
assert.equal(meituanRows.length, 2);
assert.equal(meituanRows[0].job_type, "campus", "jobType 1 is the campus portal");
assert.equal(meituanRows[1].job_type, "internship", "jobType 2 is the internship portal");
assert.equal(meituanRows[0].official_url, "https://zhaopin.meituan.com/web/position/detail?jobUnionId=4697320043");
assert.equal(meituanRows[0].location, "北京市；上海市");
assert.equal(meituanRows[0].publish_time, "2026-08-17");
assert.match(meituanRows[0].jd_text, /^工作职责：/);
assert.equal(meituanRows[0].full_description_verified, true);
assert.deepEqual(JSON.parse(meituanRequests[0].options.body).jobType, [{ code: "1", subCode: [] }, { code: "2", subCode: [] }]);

const netease = sources.find(source => source.id === "netease-careers");
assert.equal(netease.adapter.status, ADAPTER_STATUS.VERIFIED, "网易 must not stay entry-only");
const neteaseRows = await loadOfficialJobFeed(netease, {
  now,
  fetchImpl: async () => jsonResponse({
    // Shape recorded from hr.163.com/api/hr163/position/queryPage.
    data: {
      total: 3, pages: 1,
      list: [
        {
          id: 73424, name: "资深特效设计师（设计/制作）", workType: 0, firstPostTypeName: "游戏艺术",
          productName: "网易游戏（互娱）", workPlaceNameList: ["广州市"], recruitNum: 1,
          description: "1.配合产品美术总监制定游戏特效风格。", requirement: "1. 八年以上特效设计工作经验。",
          reqEducationName: "大专", reqWorkYearsName: "5-10年", updateTime: 1791812276000
        },
        {
          id: 75030, name: "商业化创新产品实习生", workType: 1, firstPostTypeName: "产品",
          productName: "网易云音乐", workPlaceNameList: ["杭州市"],
          description: "1.参与产品需求梳理。", requirement: "1. 在校生，每周至少 4 天。",
          updateTime: 1791812276000
        },
        {
          // The regression this guards: a 社招 HR role whose title mentions campus
          // recruitment must not be filed as a campus opening.
          id: 77777, name: "校园招聘专员", workType: 0, firstPostTypeName: "职能支持",
          productName: "网易传媒", workPlaceNameList: ["北京市"],
          description: "1.负责校园招聘项目的落地执行。", requirement: "1. 三年以上招聘经验。",
          updateTime: 1791812276000
        }
      ]
    }
  })
});
assert.equal(neteaseRows.length, 3);
assert.equal(neteaseRows[0].job_type, "social", "workType 0 is a full-time role");
assert.equal(neteaseRows[1].job_type, "internship", "workType 1 is an internship");
assert.equal(neteaseRows[2].job_type, "social", "the payload's workType beats the word 校园 in the title");
assert.equal(neteaseRows[0].official_url, "https://hr.163.com/job-detail.html?id=73424");
assert.equal(neteaseRows[0].location, "广州市");
assert.match(neteaseRows[0].jd_text, /^职位描述：/);

/* 华为: two portals on one gateway, and a JD that is deliberately withheld ---- */

const huaweiCampus = sources.find(source => source.id === "huawei-campus");
const huaweiSocial = sources.find(source => source.id === "huawei-careers");
assert.equal(huaweiCampus.adapter.status, ADAPTER_STATUS.VERIFIED, "华为校招 must not stay entry-only");
assert.equal(huaweiSocial.adapter.status, ADAPTER_STATUS.VERIFIED, "华为社招 must not stay entry-only");
assert.equal(huaweiCampus.company, huaweiSocial.company, "one employer, two portals");
assert.equal(unadapted.some(source => source.id === "huawei-careers"), false, "华为 must have left the entry-only list");

const huaweiRequests = [];
const huaweiRows = await loadOfficialJobFeed(huaweiCampus, {
  now,
  fetchImpl: async (url, options) => {
    huaweiRequests.push({ url, options });
    return jsonResponse({
      // Shape recorded from apigw-dgg-b0.huawei.com/api/apig/channelhw/
      // recruitmentPosition/pub/getJobPage.
      status: "SUCCESS",
      data: {
        pageVO: { totalRows: 4, curPage: 1, pageSize: 100, totalPages: 1 },
        result: [
          {
            advertisementId: "36384", jobName: "AI Infra工程师", scenarioCode: "0", scenarioName: "应届生",
            categoryName: "研发类", workPlace: "苏州/杭州/北京", lastUpdateDate: "2026-08-17",
            // Verbatim: both fields are the withheld sentence, not a JD.
            mainBusiness: "请您详见岗位意向中的岗位职责",
            jobRequire: "请您详见岗位意向中的岗位要求"
          },
          {
            advertisementId: "44058", jobName: "律师（董秘方向）", scenarioCode: "0", scenarioName: "应届生",
            categoryName: "法务类", workPlace: "全球", lastUpdateDate: "2026-10-08",
            mainBusiness: "1. 支撑海外子公司董事会规范有效、合法合规运作。",
            jobRequire: "1. 法学或法律相关专业；已通过法律职业资格考试者优先。"
          },
          {
            advertisementId: "51001", jobName: "软件开发实习生", scenarioCode: "1", scenarioName: "实习生",
            categoryName: "研发类", workPlace: "深圳市", lastUpdateDate: "2026-09-01",
            mainBusiness: "1. 参与模块开发与联调。", jobRequire: "1. 在校生，每周至少三天。"
          },
          { jobName: "缺少广告位的岗位", scenarioCode: "0" }
        ]
      }
    });
  }
});
assert.equal(huaweiRows.length, 3, "a row with no advertisementId has no detail link, so it is dropped");
assert.equal(huaweiRows[0].job_type, "campus", "scenarioCode 0 is 应届生");
assert.equal(huaweiRows[2].job_type, "internship", "scenarioCode 1 is 实习生");
assert.equal(huaweiRows[0].official_url, "https://career.huawei.com/cn/job-details?advertisementId=36384");
assert.equal(huaweiRows[0].location, "苏州/杭州/北京");
assert.equal(huaweiRows[0].publish_time, "2026-08-17");

// 华为 withholds the JD for roughly half its campus postings (56 of 102 measured on
// 2026-10-12).  The withheld sentence is not a job description, so it must never be
// stored as one; and since the detail endpoint returns that same sentence, there is
// no detail route worth declaring — which is also why no detail request is spent.
assert.equal(huaweiRows[0].jd_text, "", "the withheld sentence must not be stored as a JD");
assert.equal(huaweiRows[0].full_description_verified, false, "a withheld JD is not a verified JD");
assert.equal(huaweiRows[1].full_description_verified, true);
assert.match(huaweiRows[1].jd_text, /^岗位职责：/);
assert.equal(huaweiCampus.adapter.detail, undefined, "no detail route: the detail endpoint repeats the list text");
assert.equal(huaweiRequests.length, 1, "and therefore no detail request is issued");

// The portal is a body field here (unlike 字节, where it is a header), and the
// gateway needs its tenant header — without it the gateway answers HTTP 200 with
// {"code":"TenantContextError"}, a failure wearing a success envelope.
const huaweiBody = JSON.parse(huaweiRequests[0].options.body);
assert.equal(huaweiBody.jobType, "CR");
assert.equal(huaweiRequests[0].options.headers["x-jalor-tenantAlias"], "hcm");
assert.equal(huaweiRequests[0].options.headers["X-HW-ID"], "app_000000035886");

// jobType "IR" is the union of 校招 and 社招 (564 = 462 + 102), and any unrecognised
// value silently returns that same union: `jobType: "ZZ"` answers 564 rows with HTTP
// 200 and status SUCCESS.  Asking for it would file every job twice, so no adapter
// may ever request it — only the two real portals are allowed.
assert.equal(huaweiSocial.adapter.request(1).body.jobType, "SR");
for (const source of [huaweiCampus, huaweiSocial]) {
  assert.ok(["CR", "SR"].includes(source.adapter.request(1).body.jobType),
    `${source.id} must request a real portal, never the union`);
}

// A declared page walk must actually run.  It used to be silently clamped to 10,
// which read as "this employer only has 1000 jobs".
assert.ok(netease.adapter.pages > 10, "网易's inventory is more than ten pages");
const pageWalk = [];
const deepSource = {
  ...tencent,
  adapter: {
    ...tencent.adapter,
    detail: undefined,
    pages: 27,
    // The fixture below serves 100 rows per page, so the declared page size must
    // match it — otherwise the walk sees a "short" first page and stops.
    pageSize: 100,
    request: (page) => ({ url: `https://careers.tencent.com/list?pageIndex=${page}`, method: "GET" })
  }
};
await loadOfficialJobFeed(deepSource, {
  now,
  fetchImpl: async (url) => {
    pageWalk.push(url);
    return jsonResponse({ Data: { Posts: Array.from({ length: 100 }, (_v, index) => ({
      PostId: `${pageWalk.length}-${index}`,
      RecruitPostName: `岗位 ${pageWalk.length}-${index}`,
      PostURL: `https://careers.tencent.com/jobdesc.html?postId=${pageWalk.length}-${index}`
    })) } });
  }
});
assert.equal(pageWalk.length, 27, "all declared pages are walked, not clamped to ten");

// Pages inside one source are read in parallel now, but the walk must still visit
// every declared page exactly once and keep the rows complete.
assert.equal(new Set(pageWalk).size, 27, "no page is fetched twice");

// A short page still ends the walk early, and because the first page is fetched on
// its own a small source costs exactly one request.
const shortWalk = [];
await loadOfficialJobFeed({
  ...tencent,
  adapter: { ...tencent.adapter, detail: undefined, pages: 12, pageSize: 100, request: (page) => ({ url: `https://careers.tencent.com/list?p=${page}`, method: "GET" }) }
}, {
  now,
  fetchImpl: async (url) => {
    shortWalk.push(url);
    const page = Number(new URL(url).searchParams.get("p"));
    return jsonResponse({ Data: { Posts: Array.from({ length: page === 3 ? 7 : 100 }, (_v, index) => ({
      PostId: `${page}-${index}`,
      RecruitPostName: `岗位 ${page}-${index}`,
      PostURL: `https://careers.tencent.com/jobdesc.html?postId=${page}-${index}`
    })) } });
  }
});
assert.ok(shortWalk.length < 12, "a short page ends the walk instead of reading all declared pages");
assert.ok(shortWalk.some(url => url.endsWith("p=3")), "the short page was reached");

/* 小米: a second tenant of the same ATSX platform --------------------- */

const xiaomiSocial = sources.find(source => source.id === "xiaomi-careers");
const xiaomiCampus = sources.find(source => source.id === "xiaomi-campus");
const xiaomiInternship = sources.find(source => source.id === "xiaomi-internship");
for (const source of [xiaomiSocial, xiaomiCampus, xiaomiInternship]) {
  assert.equal(source.adapter.status, ADAPTER_STATUS.VERIFIED, `${source.id} must not stay entry-only`);
  assert.equal(source.company, "小米");
}
assert.equal(unadapted.some(source => source.company === "小米"), false, "小米 must have left the entry-only list");

const xiaomiRequests = [];
const xiaomiRows = await loadOfficialJobFeed(xiaomiCampus, {
  now,
  fetchImpl: async (url, options) => {
    xiaomiRequests.push({ url, options });
    return jsonResponse({
      // Shape recorded from xiaomi.jobs.f.mioffice.cn/api/v1/search/job/posts.
      data: {
        count: 2,
        job_post_list: [
          {
            id: "7695673449327888650", title: "数字底盘系统开发工程师-汽车",
            city_list: [{ name: "南京" }, { name: "北京" }],
            recruit_type: { id: "201", name: "正式", parent: { id: "2", name: "校招" } },
            job_subject: { name: "2027届校园招聘计划" },
            description: "1.负责数字底盘相关系统开发与集成。", requirement: "1. 车辆工程相关专业。",
            publish_time: 1791788700785
          },
          { id: "7695738836218890550", title: "语音产品经理实习生", recruit_type: { name: "实习", parent: { name: "校招" } }, city_list: [{ name: "北京" }] }
        ]
      }
    });
  }
});
assert.equal(xiaomiRows.length, 2);
assert.equal(xiaomiRows[0].job_type, "campus", "recruit_type.parent 校招 + child 正式");
assert.equal(xiaomiRows[1].job_type, "internship", "child 实习 wins over the campus parent");
assert.equal(xiaomiRows[0].official_url, "https://xiaomi.jobs.f.mioffice.cn/campus/position/7695673449327888650/detail");
assert.equal(xiaomiRows[0].location, "南京；北京");
assert.equal(xiaomiRows[0].publish_time, "2026-10-12");
assert.match(xiaomiRows[0].jd_text, /^招聘批次：2027届校园招聘计划/);
assert.equal(xiaomiRows[0].full_description_verified, true);

// The portal is selected by the `website-path` request header.  Omitting it returns
// a *different, larger* set (2188 rows) than the site's own social portal shows
// (1987), so the header must be pinned on every source — including social, whose
// value is `index`, not `social`.
const xiaomiBody = JSON.parse(xiaomiRequests[0].options.body);
assert.equal(xiaomiBody.portal_type, 6);
assert.equal(xiaomiRequests[0].options.headers["website-path"], "campus");
assert.equal(xiaomiSocial.adapter.request(1).headers["website-path"], "index");
assert.equal(xiaomiInternship.adapter.request(1).headers["website-path"], "internship");
// `website-path: social` and any unrecognised value answer HTTP 200 with
// msg "site not exist" and no rows — a zero dressed as a success.
for (const source of [xiaomiSocial, xiaomiCampus, xiaomiInternship]) {
  assert.ok(["index", "campus", "internship"].includes(source.adapter.request(1).headers["website-path"]),
    `${source.id} must pin a real portal, never a name that resolves to "site not exist"`);
}

// 字节 and 小米 are the same platform, so they share one mapping — the difference is
// only the tenant's origin, portal selector and detail route.
assert.equal(xiaomiRows[0].official_url.startsWith("https://xiaomi.jobs.f.mioffice.cn/"), true);
const byteRowsAgain = await loadOfficialJobFeed(sources.find(source => source.id === "bytedance-campus"), {
  now,
  fetchImpl: async () => jsonResponse({ data: { count: 1, job_post_list: [{ id: "9", title: "测试岗位", recruit_type: { name: "正式", parent: { name: "校招" } } }] } })
});
assert.equal(byteRowsAgain[0].official_url, "https://jobs.bytedance.com/campus/position/9/detail",
  "the shared factory still builds 字节 URLs on 字节's origin");

/* 科大讯飞: the second tenant of the second shared platform (北森) ----- */

const iflytekSocial = sources.find(source => source.id === "iflytek-careers");
const iflytekCampus = sources.find(source => source.id === "iflytek-campus");
for (const source of [iflytekSocial, iflytekCampus]) {
  assert.equal(source.adapter.status, ADAPTER_STATUS.VERIFIED, `${source.id} must not stay entry-only`);
  assert.equal(source.company, "科大讯飞");
}
assert.equal(unadapted.some(source => source.company === "科大讯飞"), false, "科大讯飞 must have left the entry-only list");
// The old entry was campus.iflytek.com, which 301s to the 北森 tenant.  Keeping it
// would make hostAllowed() reject every row this source emits, because the rows
// live on iflytek.zhiye.com.
assert.equal(new URL(iflytekCampus.entryUrl).host, "iflytek.zhiye.com");
assert.equal(new URL(iflytekSocial.entryUrl).host, "iflytek.zhiye.com");

// 北森's `Category` selects the portal, and the ids are per tenant.  The dedicated
// 实习生招聘 portal (/intern/jobs) asks for Category ["3"] and the platform answers
// **0 rows**, so it must never be registered as a source of its own.
const CAMPUS_CATEGORIES = ["2", "4", "5", "6", "7"];
assert.deepEqual(iflytekCampus.adapter.request(1).body.Category, CAMPUS_CATEGORIES);
assert.deepEqual(iflytekSocial.adapter.request(1).body.Category, ["1"]);
for (const source of [iflytekSocial, iflytekCampus]) {
  const body = source.adapter.request(1).body;
  assert.ok(Array.isArray(body.Category) && body.Category.length, `${source.id} must pin a portal, never omit Category`);
  assert.equal(body.Category.includes("3"), false, `${source.id} must not request the empty 实习生 portal`);
  // PageIndex is 0-based on this platform; the loader hands out 1-based pages.
  assert.equal(body.PageIndex, 0);
  assert.equal(source.adapter.request(2).body.PageIndex, 1);
  assert.equal(body.PageSize, 500);
  assert.equal(source.adapter.detail, undefined, `${source.id} needs no detail walk — the list already carries the JD`);
}

// `DisplayFields` is a real field selector, not a hint.  Drop `LocId` and the
// response still looks well-formed — `LocNames` just comes back as [] — so a
// subset here silently zeroes real data (and once produced the wrong conclusion
// that this platform has no location at all).
for (const field of ["LocId", "ClassificationOne"]) {
  assert.ok(iflytekCampus.adapter.request(1).body.DisplayFields.includes(field),
    `DisplayFields must list ${field}, or that field comes back silently empty`);
}

const beisenCampusRows = await loadOfficialJobFeed(iflytekCampus, {
  now,
  fetchImpl: async () => jsonResponse({
    // Shape recorded from iflytek.zhiye.com/api/Jobad/GetJobAdPageList on 2026-10-12.
    Count: 3,
    Data: [
      {
        Id: "247b87c5-020b-458b-8c39-66a85dd04c5f", JobAdId: 190832627,
        JobAdName: "【飞星计划】AI研究算法工程师-语音大模型方向(J12674)",
        Category: "飞星计划", CategoryId: "4", Kind: "全职",
        Duty: "1、研发多模态大模型等下一代人工智能核心技术。",
        Require: "1、2027届重点院校硕士及以上学历。",
        PostDate: "0001-01-01T00:00:00", ChangeDate: "2026-09-15T09:42:59.3850603",
        LocNames: ["安徽省·合肥市"], LocId: null, ClassificationOne: "AI研究序列", ClassificationTwo: null, Status: 1
      },
      {
        Id: "aaaabbbb-1111-2222-3333-444455556666", JobAdId: 190832628,
        JobAdName: "【星火X计划】大模型算法实习生(J14522)",
        Category: "星火X顶尖AI人才计划", CategoryId: "7", Kind: "实习",
        Duty: "参与大模型训练与调优。", Require: "熟悉 PyTorch。",
        PostDate: "0001-01-01T00:00:00", ChangeDate: "2026-09-20T10:00:00",
        LocNames: ["广东省·广州市/深圳市"]
      },
      {
        Id: "ccccdddd-5555-6666-7777-888899990000", JobAdId: 190832629,
        JobAdName: "校园大使(J90001)", Category: "校园大使", CategoryId: "6", Kind: "",
        Duty: "负责校园宣传与活动组织。", Require: "在校学生。",
        PostDate: "0001-01-01T00:00:00", ChangeDate: "0001-01-01T00:00:00",
        LocNames: []
      }
    ]
  })
});
assert.equal(beisenCampusRows.length, 3);
// 星火X mixes 全职 and 实习 under one category, so the type comes from `Kind`.
assert.equal(beisenCampusRows[0].job_type, "campus");
assert.equal(beisenCampusRows[1].job_type, "internship", "Kind 实习 wins even inside the campus categories");
assert.equal(beisenCampusRows[2].job_type, "campus", "a blank Kind falls back to the portal's default");
assert.match(beisenCampusRows[0].jd_text, /^工作职责：/);
assert.match(beisenCampusRows[0].jd_text, /任职资格：/);
assert.equal(beisenCampusRows[0].full_description_verified, true);
// Locations come through only because `LocId` is in DisplayFields; the platform's
// own format is kept (province prefix included), and a row that genuinely has no
// location falls back to the source default instead of inventing a city.
assert.equal(beisenCampusRows[0].location, "安徽省·合肥市");
assert.equal(beisenCampusRows[1].location, "广东省·广州市/深圳市");
assert.equal(beisenCampusRows[2].location, "中国", "an empty LocNames falls back to the source default");

// The detail route's parameter is *named* `jobAdId` but only accepts the GUID `Id`.
// Passing the integer `JobAdId` renders the bare SPA shell at HTTP 200.
assert.equal(beisenCampusRows[0].official_url,
  "https://iflytek.zhiye.com/job/detail?jobAdId=247b87c5-020b-458b-8c39-66a85dd04c5f");
assert.equal(/190832627/.test(beisenCampusRows[0].official_url), false,
  "the integer JobAdId must never reach the URL — that route renders nothing");
assert.ok(beisenCampusRows.every(row => row.official_url.startsWith("https://iflytek.zhiye.com/")));

// `PostDate` is the literal string 0001-01-01 on 886 of 886 live rows — a null
// sentinel, not a date.  Mapping it would date the whole board to year 1 while
// still looking like a well-formed date.
assert.equal(beisenCampusRows[0].publish_time, "2026-09-15", "the real date is ChangeDate");
assert.equal(beisenCampusRows[2].publish_time, "", "a sentinel-only row has no publish date at all");
assert.equal(beisenCampusRows.some(row => row.publish_time.startsWith("0001")), false,
  "the 0001-01-01 sentinel must never be stored as a date");

const beisenSocialRows = await loadOfficialJobFeed(iflytekSocial, {
  now,
  fetchImpl: async () => jsonResponse({
    Count: 2,
    Data: [
      {
        Id: "69810347-e80d-46ef-b9b2-0f86ca2701d5", JobAdId: 190861893,
        JobAdName: "高级政府公共事务经理(J14313)", Category: "社会招聘", CategoryId: "1", Kind: "全职",
        Duty: "1、负责政府科技项目的申报工作。", Require: "1、本科及以上学历。",
        PostDate: "0001-01-01T00:00:00", ChangeDate: "2026-09-11T17:27:58",
        LocNames: ["安徽省·合肥市", "上海市"]
      },
      {
        // PostDate carries a real-looking date and ChangeDate is the sentinel.  If
        // the adapter read PostDate this row would publish as 2026-01-05.
        Id: "ffffffff-0000-1111-2222-333333333333", JobAdId: 190861894,
        JobAdName: "测试工程师(J14314)", Category: "社会招聘", CategoryId: "1", Kind: "全职",
        Duty: "负责测试。", Require: "熟悉自动化测试。",
        PostDate: "2026-01-05T00:00:00", ChangeDate: "0001-01-01T00:00:00"
      }
    ]
  })
});
assert.equal(beisenSocialRows[0].job_type, "social");
assert.equal(beisenSocialRows[0].publish_time, "2026-09-11");
assert.equal(beisenSocialRows[1].publish_time, "",
  "PostDate is never read, even when it holds a plausible date");
assert.ok(beisenSocialRows.every(row => row.job_type === "social"));
assert.equal(beisenSocialRows[0].location, "安徽省·合肥市；上海市",
  "a multi-city posting keeps every city the platform listed");

/* Page size is a real lever, and it must match what the request asks for --- */

// A page walk decides "the board is exhausted" by seeing a page shorter than
// `adapter.pageSize`.  If the request asks for a different number than the adapter
// declares, the walk calls page 1 short and stops — a silent 0-row sync.  These
// assertions pin the request's page size to the declared one for every family.
const requestBody = (source, page = 1) => {
  const body = source.adapter.request(page).body;
  return typeof body === "string" ? JSON.parse(body) : body;
};
for (const source of verified) {
  const adapter = source.adapter;
  if (adapter.kind !== "json-api" || !adapter.pageSize) continue;
  const request = adapter.request(1);
  const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  const url = new URL(request.url);
  // Families put the page size in different places: ATSX uses body.limit, 网易 and
  // 北森 body.pageSize, 美团 body.page.pageSize, 腾讯 a query parameter.
  const asked = body?.limit ?? body?.pageSize ?? body?.PageSize ?? body?.page?.pageSize
    ?? Number(url.searchParams.get("pageSize"));
  assert.equal(asked, adapter.pageSize,
    `${source.id} asks for ${asked} rows but declares pageSize ${adapter.pageSize}`);
}
assert.equal(requestBody(sources.find(s => s.id === "xiaomi-careers"), 1).offset, 0);
assert.equal(requestBody(sources.find(s => s.id === "xiaomi-careers"), 3).offset, 2000,
  "the offset must follow the declared page size, not a hard-coded 100");

// 网易 caps `pageSize` at 200: 250 and above answer HTTP 200 with a 92-byte body
// and zero rows, which reads as "board exhausted" and would silently empty the
// source.  Pin it well below the cliff.
const neteaseSource = sources.find(source => source.id === "netease-careers");
assert.ok(neteaseSource.adapter.pageSize <= 200, "网易 must not exceed its 200-row page ceiling");
assert.equal(requestBody(neteaseSource).pageSize, neteaseSource.adapter.pageSize);

// 腾讯 runs two application systems at once.  314 of its 2243 social rows link to
// 腾讯's own Workday tenant rather than careers.tencent.com.  Those are real jobs
// on a 腾讯-controlled board, so the host allow-list must name it — the generic
// "off-site link" guard is right to reject aggregators but was silently eating
// these, which is why the source reported 1929 rows against a 2243 total.
const tencentSource = sources.find(source => source.id === "tencent-careers");
assert.ok(tencentSource.allowedHosts.includes("tencent.wd1.myworkdayjobs.com"),
  "腾讯's own Workday tenant must be allow-listed");
const tencentMixed = await loadOfficialJobFeed(tencentSource, {
  now,
  fetchImpl: async (url) => {
    if (url.includes("/post/ByPostId")) {
      return jsonResponse({ Code: 200, Data: { PostId: "1", Responsibility: "职责", Requirement: "要求" } });
    }
    return jsonResponse({
      Data: {
        Count: 3,
        Posts: [
          { PostId: "1", RecruitPostName: "服务端开发工程师", PostURL: "https://careers.tencent.com/jobdesc.html?postId=1" },
          { PostId: "2", RecruitPostName: "战略投资经理", PostURL: "https://tencent.wd1.myworkdayjobs.com/Tencent_Careers/job/China-Shenzhen/Strategic-Investment-Manager_R107748-2" },
          // A genuine aggregator link must still be refused.
          { PostId: "3", RecruitPostName: "后端开发", PostURL: "https://www.lagou.com/jobs/12345.html" }
        ]
      }
    });
  }
});
assert.equal(tencentMixed.length, 2, "腾讯's Workday row is kept, the aggregator row is not");
assert.ok(tencentMixed.some(row => row.official_url.includes("myworkdayjobs.com")));

// Coverage floors.  These were all silently truncating before: 字节社招 fell
// through to the factory default of 3 pages × 100 = 300 rows out of 10000 (3%),
// and 腾讯 reached 299 of 2253 (13%).  A full walk must be able to reach the
// totals the endpoints themselves report.
//
// The totals below are what each endpoint says about itself, read on 2026-10-12
// by `scripts/check-source-coverage.mjs`.  That script discovers the field name
// per platform (ATSX `data.count`, 北森 `Count`, 腾讯 `Data.Count`, 网易
// `data.total`, 美团 `data.page.totalCount`, 京东 `body.totalNumber`) instead of
// hard-coding it, because a hard-coded table is precisely the thing that rots
// silently — which is the failure this whole block exists to catch.
const coverage = [
  ["bytedance-careers", 10000],
  ["bytedance-campus", 7468],
  ["netease-careers", 2699],
  ["tencent-careers", 2243],
  ["xiaomi-careers", 1987],
  ["xiaomi-campus", 782],
  ["iflytek-careers", 721],
  ["xiaomi-internship", 580],
  ["meituan-careers", 563],
  ["huawei-careers", 462],
  ["iflytek-campus", 165],
  ["jd-careers", 124],
  ["huawei-campus", 102]
];
for (const [id, reportedTotal] of coverage) {
  const adapter = sources.find(source => source.id === id).adapter;
  const reach = adapter.pages * adapter.pageSize;
  assert.ok(reach >= reportedTotal,
    `${id} can only reach ${reach} rows but the endpoint reports ${reportedTotal}`);
  // Reaching the board *today* is not enough.  A source with less than one page
  // of headroom is one hiring round away from silently truncating, which is how
  // 字节社招 sat at 3% for as long as it did.  This is the assertion that caught
  // 美团 (37 rows of headroom on six pages) and 京东 (76 on two).
  assert.ok(reach - reportedTotal >= adapter.pageSize,
    `${id} has only ${reach - reportedTotal} rows of headroom across ${adapter.pages} pages of ${adapter.pageSize} — under one page, so a single growth spurt truncates it silently`);
}

/* Unadapted sources stay honest --------------------------------------- */

let unadaptedFetches = 0;
const unadaptedResult = await loadOfficialSource(unadapted[0], {
  now,
  fetchImpl: async () => { unadaptedFetches += 1; throw new Error("must not fetch"); }
});
assert.equal(unadaptedFetches, 0, "an unadapted source is never fetched");
assert.deepEqual(unadaptedResult.rows, []);
assert.equal(unadaptedResult.fetched, false);
assert.equal(unadaptedResult.adapterKind, "unadapted");
assert.equal(unadaptedResult.adapterStatus, ADAPTER_STATUS.UNADAPTED);
// An entry-only source must say why.  A generic source gets the default wording;
// a source somebody actually investigated carries a specific operator note.
assert.ok(unadaptedResult.reason.length > 10, "an unadapted source must explain itself");
const genericUnadapted = sources.find(source => source.id === "didi-careers");
assert.match(genericUnadapted.adapter.reason, /尚未适配/, "a source nobody has investigated yet gets the default note");
const alibaba = sources.find(source => source.id === "alibaba-careers");
assert.match(alibaba.adapter.reason, /登录态/, "an investigated source records what was actually found");
assert.equal(isSyncableFeed(unadapted[0]), false);
assert.equal(isSyncableFeed(tencent), true);

const failing = await loadOfficialJobFeed(tencent, {
  now,
  fetchImpl: async () => ({ ok: false, status: 503, url: tencent.entryUrl, text: async () => "" })
}).then(() => null, error => error);
assert.equal(failing?.message, "source_http_503", "a failing source must surface as a failure");

/* jobKnowledge integration -------------------------------------------- */

const db = new DatabaseSync(":memory:");
const loaded = [];
const service = createJobKnowledge(db, {
  clock: () => now,
  feeds: [tencent, unadapted[0]],
  loader: async (feed) => {
    loaded.push(feed.id);
    return [{
      company_name: feed.company,
      title: "后端开发实习",
      official_url: "https://careers.tencent.com/jobdesc.html?postId=9",
      location: "深圳",
      job_type: "internship",
      jd_text: "参与后端服务开发与联调。",
      last_seen: new Date(now).toISOString(),
      source_group: feed.group,
      source_trust: feed.trust,
      origin_source_url: feed.entryUrl,
      full_description_verified: false
    }];
  }
});
await service.sync({ force: true });
assert.deepEqual(loaded, [tencent.id], "only adapted sources are synchronized");
const searched = await service.search({ query: "后端实习", type: "internship" });
assert.equal(searched.jobs.length, 1);
assert.equal(searched.jobs[0].source, "official-career-site");
assert.equal(searched.jobs[0].sourceType, "official-company");
assert.equal(searched.jobs[0].originSourceUrl, tencent.entryUrl);
const tencentMeta = searched.sources.find(source => source.id === tencent.id);
assert.equal(tencentMeta.syncStatus, "synced");
assert.equal(tencentMeta.count, 1);
assert.equal(tencentMeta.company, "腾讯");
assert.equal(tencentMeta.adapterKind, "json-api");
assert.equal(tencentMeta.officialUrl, tencent.entryUrl);
const unadaptedMeta = searched.sources.find(source => source.id === unadapted[0].id);
assert.equal(unadaptedMeta.syncStatus, "unadapted", "an unadapted source is reported, not hidden");
assert.equal(unadaptedMeta.count, null);
assert.equal(unadaptedMeta.adapterStatus, "unadapted");
assert.ok(unadaptedMeta.reason.length > 10, "the reason reaches the agent, not just the registry");
assert.equal(searched.summary.registered, 2);
assert.equal(searched.summary.unadapted, 1);
await service.stop();
db.close();

// A reachable official page with nothing to import is not a failure.
const emptyDb = new DatabaseSync(":memory:");
const emptyService = createJobKnowledge(emptyDb, { clock: () => now, feeds: [baidu], loader: async () => [] });
await emptyService.sync({ force: true });
const emptySources = (await emptyService.search()).sources;
assert.equal(emptySources[0].syncStatus, "reachable");
assert.equal(emptySources[0].count, 0);
assert.equal(emptySources[0].error, null);
await emptyService.stop();
emptyDb.close();

console.log("Official job source tests passed: registry, per-company adapters (incl. ByteDance campus portal and the 北森 tenant), false-positive refusal, unadapted honesty, jobKnowledge integration");
