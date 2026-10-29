import assert from "node:assert/strict";
import { JOB_FEEDS, normalizeFeedJob } from "./jobKnowledge.js";
import { COMMUNITY_JOB_SOURCES, mapHuEunCampusRows, mapHuEunCampusRow } from "./communityJobSources.js";

const now = Date.parse("2026-10-22T08:00:00Z");

const fixtureRows = [
  { "公司名称": "筛选前必看-点这里", "行业大类": "", "企业性质": "", "工作地点": "", "官方公告": "", "更新时间": "", "招聘岗位": "筛选前必看-点这里", "截止时间": "", "是否需要笔试": "", "投递方式": "", "备注/提示": "", "招聘对象": "", "批次": "", "工作地点文本": "" },
  {
    "公司名称": "中青博联",
    "行业大类": ["文化/传媒/广告/体育"],
    "企业性质": ["民企"],
    "工作地点": ["北京", "上海", "杭州"],
    "官方公告": "https://mp.weixin.qq.com/s/ijkeBWEdMWmcMvyIfE5iyA",
    "更新时间": "2026/10/22",
    "招聘岗位": "会展客户专员、活动执行专员、数字营销客户专员、文旅运营专员、空间运营专员、赛事运营专员、业务拓展专员、平面/3D设计、财务助理、人力资源助理、党务助理、文员、采购助理、签证助理、内控合规助理、法务助理......",
    "截止时间": "尽快投递",
    "是否需要笔试": ["含免笔试"],
    "投递方式": "https://doc.weixin.qq.com/forms/ANAASwcpAAwAWgAnwZkAP0CNbLppY6HXf#/fill",
    "备注/提示": "中青博联",
    "招聘对象": ["2027届"],
    "批次": ["秋招"],
    "工作地点文本": ""
  },
  {
    "公司名称": "某小厂科技",
    "行业大类": "计算机软件",
    "企业性质": "民企",
    "工作地点": "深圳",
    "官方公告": "",
    "更新时间": "2026/10/21",
    "招聘岗位": "算法实习生",
    "截止时间": "",
    "是否需要笔试": "",
    "投递方式": "https://example.com/apply?utm_source=feed",
    "备注/提示": "近地铁",
    "招聘对象": "在读硕士",
    "批次": "日常实习",
    "工作地点文本": ""
  },
  {
    "公司名称": "无链接公司",
    "官方公告": "",
    "投递方式": "",
    "更新时间": "2026/10/20",
    "招聘岗位": "若干"
  },
  {
    "公司名称": "缺时间公司",
    "官方公告": "https://mp.weixin.qq.com/s/missing-time",
    "更新时间": "",
    "招聘岗位": "若干"
  }
];

const feed = COMMUNITY_JOB_SOURCES.find((source) => source.id === "hu-eun-campus");
assert.ok(feed, "hu-eun-campus feed registered");
assert.ok(JOB_FEEDS.some((item) => item.id === "hu-eun-campus"), "community feed wired into JOB_FEEDS");

const mapped = mapHuEunCampusRows(fixtureRows);
assert.equal(mapped.length, 2, "meta/linkless/undated rows dropped");

const full = mapped[0];
assert.equal(full.company, "中青博联");
assert.equal(full.url, "https://mp.weixin.qq.com/s/ijkeBWEdMWmcMvyIfE5iyA", "官方公告 preferred over 投递方式");
assert.equal(full.location, "北京/上海/杭州");
assert.equal(full.country, "中国");
assert.equal(full.job_type, "campus");
assert.equal(full.title, "秋招·2027届", "long position blob falls back to batch·cohort title");
assert.match(full.jd_text, /岗位：会展客户专员/);
assert.match(full.jd_text, /性质：民企/);
assert.match(full.jd_text, /截止：尽快投递/);
assert.equal(full.deadline, "尽快投递");
assert.equal(full.last_seen, "2026/10/22");
assert.equal(full.publish_time, "");

const intern = mapped[1];
assert.equal(intern.url, "https://example.com/apply?utm_source=feed", "mapper keeps the raw link; canonicalUrl cleans it downstream");
assert.equal(intern.title, "算法实习生", "short position list becomes the title");
assert.equal(intern.job_type, "internship");
assert.match(intern.jd_text, /备注：近地铁/);
assert.equal(intern.last_seen, "2026/10/21");

const normalized = mapped.map((row) => normalizeFeedJob(row, feed, now));
assert.ok(normalized.every(Boolean), "mapped rows survive normalizeFeedJob");
const normalizedIntern = normalized[1];
assert.equal(normalizedIntern.company, "某小厂科技");
assert.equal(normalizedIntern.url, "https://example.com/apply", "normalizeFeedJob strips tracking params");
assert.equal(normalizedIntern.type, "internship");
assert.equal(normalizedIntern.source, "github-job-source");
assert.equal(normalizedIntern.feedId, "hu-eun-campus");
assert.equal(normalizedIntern.country, "中国");
assert.equal(normalizedIntern.fullDescriptionVerified, false, "aggregation text is never a verified official JD");
assert.equal(normalizedIntern.officiallyVerifiedAt, null);
assert.equal(normalizedIntern.observedAt, Date.parse("2026/10/21"), "observedAt is the row update time in epoch millis");

const stale = normalizeFeedJob({ ...full, last_seen: "2026-07-01" }, feed, now);
assert.ok(stale, "parseable old last_seen still normalizes; freshness is enforced at sync time");
const undated = normalizeFeedJob({ ...full, last_seen: "" }, feed, now);
assert.equal(undated, null, "missing last_seen is dropped, not treated as fresh");

assert.deepEqual(mapHuEunCampusRows(null), []);
assert.equal(mapHuEunCampusRow("not-an-object"), null);

console.log("communityJobSources tests passed");
