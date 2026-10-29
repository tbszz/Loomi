import assert from "node:assert/strict";
import {
  LIVE_GITHUB_JOB_FEEDS,
  loadLiveGitHubJobFeed,
  parseSimplifyListingsJson,
  summarizeLiveGitHubRows
} from "./liveGitHubJobFeeds.js";

const commitDate = "2026-10-12T10:31:33Z";
const commitSha = "9ae6d106c5a6b9";

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers });
}

assert.ok(LIVE_GITHUB_JOB_FEEDS.length >= 3);
assert.ok(LIVE_GITHUB_JOB_FEEDS.every(feed => feed.sourceType === "github-aggregator"));
assert.ok(LIVE_GITHUB_JOB_FEEDS.every(feed => feed.snapshot === true));
assert.ok(LIVE_GITHUB_JOB_FEEDS.every(feed => feed.refreshMs <= 60 * 60 * 1000));
assert.ok(LIVE_GITHUB_JOB_FEEDS.some(feed => feed.id === "github-simplify-summer-2027-internships"));
assert.ok(LIVE_GITHUB_JOB_FEEDS.some(feed => feed.id === "github-speedyapply-2027-ai"));
assert.ok(LIVE_GITHUB_JOB_FEEDS.some(feed => feed.id === "github-speedyapply-2027-swe"));

const simplifyFeed = LIVE_GITHUB_JOB_FEEDS.find(feed => feed.id === "github-simplify-summer-2027-internships");
const simplifyRows = parseSimplifyListingsJson([
  {
    source: "Simplify",
    category: "Software",
    company_name: "ByteDance",
    id: "cn-1",
    title: "Software Engineer Intern, AI Platform",
    active: true,
    terms: ["Summer 2027"],
    date_updated: 1799663493,
    date_posted: 1799577093,
    url: "https://jobs.example.com/bytedance/apply",
    locations: ["Beijing, China", "Shanghai, China"],
    company_url: "https://simplify.jobs/c/ByteDance",
    sponsorship: "Other",
    degrees: ["Bachelor's", "Master's"]
  },
  {
    source: "Simplify",
    category: "Software",
    company_name: "ClosedCo",
    id: "closed-1",
    title: "Software Engineer Intern",
    active: false,
    url: "https://jobs.example.com/closed/apply",
    locations: ["New York, NY"]
  }
], simplifyFeed, { commitDate, commitSha });
assert.equal(simplifyRows.length, 1);
assert.equal(simplifyRows[0].company_name, "ByteDance");
assert.equal(simplifyRows[0].job_type, "实习");
assert.equal(simplifyRows[0].last_seen, commitDate);
assert.equal(simplifyRows[0].publish_time, "2027-01-10T10:31:33.000Z");
assert.equal(simplifyRows[0].country, "China");
assert.match(simplifyRows[0].jd_text, /Software/);
assert.match(simplifyRows[0].jd_text, /Summer 2027/);
assert.doesNotMatch(simplifyRows[0].jd_text, /负责|requirements/i);
assert.equal(simplifyRows[0].origin_source_url, simplifyFeed.url);

const speedyFeed = LIVE_GITHUB_JOB_FEEDS.find(feed => feed.id === "github-speedyapply-2027-ai");
const markdownByFile = new Map(speedyFeed.files.map(filename => [filename, `
# 2027 AI College Jobs

### International
| Company | Position | Location | Salary | Posting | Age |
|---|---|---|---|---|---|
| <a href="https://www.tencent.com"><strong>Tencent</strong></a> | Machine Learning Intern - LLM Platform | Beijing, China |  | <a href="https://careers.tencent.com/job/1"><img alt="Apply" /></a> | 1d |
` ]));
const calls = [];
const rows = await loadLiveGitHubJobFeed(speedyFeed, {
  fetchImpl: async (url) => {
    calls.push(url);
    if (url.includes("/commits/main")) return response(JSON.stringify({ sha: commitSha, commit: { committer: { date: commitDate } } }), { headers: { "content-type": "application/json" } });
    const filename = [...markdownByFile.keys()].find(name => url.endsWith(`/${name}`));
    if (filename && url.includes(commitSha)) return response(markdownByFile.get(filename));
    return response("missing", { status: 404 });
  }
});
assert.equal(rows.length, 1, "deduped repeated SpeedyApply rows across mirrored files");
assert.equal(rows[0].company_name, "Tencent");
assert.equal(rows[0].official_url, "https://careers.tencent.com/job/1");
assert.equal(rows[0].last_seen, commitDate);
assert.equal(rows[0].country, "China");
assert.match(rows[0].jd_text, /International/);
assert.ok(calls[0].includes("/commits/main"));
assert.ok(calls.slice(1).every(url => url.includes(commitSha)), "raw file reads must pin the same commit sha");

await assert.rejects(loadLiveGitHubJobFeed(speedyFeed, {
  fetchImpl: async (url) => {
    if (url.includes("/commits/main")) return response(JSON.stringify({ sha: commitSha, commit: { committer: { date: commitDate } } }));
    return response("nope", { status: 404 });
  }
}), /source_http_404|all_fetch_attempts_failed|empty_or_incompatible_source/);

const summary = summarizeLiveGitHubRows([
  ...simplifyRows,
  { ...simplifyRows[0], official_url: "https://jobs.example.com/us", country: "United States" }
]);
assert.equal(summary.total, 2);
assert.equal(summary.byCountry.China, 1);
assert.equal(summary.byCountry["United States"], 1);

console.log("liveGitHubJobFeeds tests passed");
