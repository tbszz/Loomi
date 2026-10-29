import assert from "node:assert/strict";
import {
  CAMPUS_AGGREGATOR_SOURCE,
  parseCampusAggregatorHtml,
  refreshCampusAggregatorFromHtml
} from "./campusAggregator.js";
import { parseResumeText } from "./resumeEngine.js";

const sampleHtml = `
<!doctype html>
<html>
<head><title>2026年校园招聘信息汇总</title></head>
<body>
<script>
const RAW_DATA = [
  {"updateDate":"05-26","fullDate":"2026-05-26","month":"5月","company":"安克创新","batch":"校招","location":"深圳","positions":"AI应用工程师 前端开发工程师","sourceLink":"https://example.com/source","linkSource":"飞书Wiki","appLink":"https://example.com/apply","isKey":"0","evaluation":"全球化智能硬件企业，AI产品体验强","industry":"互联网/科技","year":"27届","nature":"民企","education":"本科及以上","isCommercial":"0","commercialExpiry":"","isFeaturedCard":"0"},
  {"updateDate":"长期有效","fullDate":"长期有效","month":"长期有效","company":"某金融机构","batch":"实习","location":"上海","positions":"量化研究实习生 Python开发实习生","sourceLink":"https://example.com/source2","linkSource":"公众号","appLink":"https://example.com/apply2","isKey":"0","evaluation":"金融科技团队","industry":"金融/银行","year":"26届, 27届","nature":"央国企","education":"不限","isCommercial":"0","commercialExpiry":"","isFeaturedCard":"0"}
];
function render(){ console.log(RAW_DATA.length); }
</script>
</body>
</html>`;

const profile = parseResumeText("邹子涵 React Python RAG Agent FastAPI AI Native 工具开发").profile;
const parsed = parseCampusAggregatorHtml(sampleHtml);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].company, "安克创新");

const result = refreshCampusAggregatorFromHtml({
  html: sampleHtml,
  profile,
  query: "AI Agent",
  type: "campus"
});

assert.equal(CAMPUS_AGGREGATOR_SOURCE.id, "campus-aggregator");
assert.equal(result.sources.length, 1);
assert.equal(result.sources[0].sourceType, "third-party-aggregator");
assert.equal(result.summary.rawJobs, 2);
assert.equal(result.jobs.length, 1);
assert.equal(result.jobs[0].company, "安克创新");
assert.equal(result.jobs[0].source, "campus-aggregator");
assert.equal(result.jobs[0].sourceGroup, "第三方校招聚合源");
assert.equal(result.jobs[0].applyUrl, "https://example.com/apply");
assert.ok(result.jobs[0].opportunityScore > 0);
assert.ok(result.jobs[0].matchEvidence.length > 0);

console.log("campusAggregator tests passed");
