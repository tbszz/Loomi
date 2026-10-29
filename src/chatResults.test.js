import assert from "node:assert/strict";
import { formatJobPoolSummary, normalizeResultItems } from "./chatResults.js";
import { createTranslator } from './i18n.js';

assert.deepEqual(
  normalizeResultItems([
    "已有量化指标",
    { id: "target", label: "求职目标", prompt: "请补充目标岗位和城市。", complete: false },
    null
  ]),
  ["已有量化指标", "求职目标：请补充目标岗位和城市。"]
);

assert.equal(
  formatJobPoolSummary({
    jobs: [{ id: "passed" }],
    uncertainties: [{ id: "verify" }, { id: "verify-2" }],
    rejected: [{ id: "rejected" }],
    total: 24,
    offset: 20,
    hasMore: true
  }),
  "This page 21-24 / 24 · More available"
);

assert.equal(
  formatJobPoolSummary({ total: 8, offset: 0, hasMore: false }),
  "Job pool: 8"
);

assert.equal(formatJobPoolSummary({ hasMore: true }), "More source results available");
assert.equal(formatJobPoolSummary({uncertainties:[{id:'a'},{id:'b'}],total:1,offset:0,mergedSearches:2}), 'Collected 2 job leads');
assert.equal(formatJobPoolSummary({jobs:[{id:'main'}],related:[{id:'description'},{id:'mention'}],rejected:[{id:'rejected'}],total:8,offset:2,hasMore:true}), 'This page 3-6 / 8 · More available');
assert.equal(formatJobPoolSummary({related:[{id:'reference'}],total:1}), 'This page 1-1 / 1');
assert.equal(formatJobPoolSummary({jobs:[{id:'main'}],related:[{id:'reference'}],mergedSearches:2}), 'Collected 2 job leads');
assert.equal(formatJobPoolSummary({ jobs: [{}], total: 2, hasMore: true }, createTranslator('zh')), '本页 1-1 / 2 · 可换一批');

console.log("chatResults tests passed");
