import assert from "node:assert/strict";
import { formatJobPoolSummary, normalizeResultItems } from "./chatResults.js";

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
  "本页 21-24 / 24 · 可换一批"
);

assert.equal(
  formatJobPoolSummary({ total: 8, offset: 0, hasMore: false }),
  "岗位池 8 条"
);

assert.equal(formatJobPoolSummary({ hasMore: true }), "还有更多来源结果");
assert.equal(formatJobPoolSummary({uncertainties:[{id:'a'},{id:'b'}],total:1,offset:0,mergedSearches:2}), '已汇总 2 条岗位线索');
assert.equal(formatJobPoolSummary({jobs:[{id:'main'}],related:[{id:'description'},{id:'mention'}],rejected:[{id:'rejected'}],total:8,offset:2,hasMore:true}), '本页 3-6 / 8 · 可换一批');
assert.equal(formatJobPoolSummary({related:[{id:'reference'}],total:1}), '本页 1-1 / 1');
assert.equal(formatJobPoolSummary({jobs:[{id:'main'}],related:[{id:'reference'}],mergedSearches:2}), '已汇总 2 条岗位线索');

console.log("chatResults tests passed");
