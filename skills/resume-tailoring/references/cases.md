# 改写示范案例（few-shot）

**全部案例 `synthetic: true`。** 定位是**结构示范**，不是成功实证（T13 §1）：它教"一条合格的证据链条长什么样"，不教"这样做能拿到 offer"。

- **JD 文本为真实 ATS 发布内容**，逐字引用，标 `jd_source_tier` 与 `jd_license`（T13 §5 双层标注）
- **候选人画像完全虚构**（T13 §2），不来自任何真实个人、不来自 GitHub 贡献、不用 demo 样本作种子
- 每个案例带完整证据链条：JD 要求 → 候选人证据（fact_id + proficiency）→ 匹配判定 → 改写前后（T10 §1）。缺任何一段即不能作 few-shot
- 反例标它违反的 R1–R4 规则 id（T13 §6/§8）
- 具体数字标 `[示例数值]`，是说明性数字而非可引用事实（T10 §2）

案例字段：`case_id` / `role_family` / `frame` / `scenario` / `synthetic` / `source_tier` / `license` / `jd_ref` / `jd_source_tier` / `jd_license` / `evidence_chain[]` / `reusable_patterns` / `gap_types`。

---

## CASE-01 · 软件开发-后端 · 高匹配 · 正例

```json
{
  "case_id": "rt-be-001",
  "role_family": "backend-sw",
  "frame": "performance-stability",
  "jd_suggested_frame": "performance-stability",
  "scenario": "high-match",
  "synthetic": true,
  "source_tier": "L1",
  "license": "Loomi project license",
  "jd_ref": "gh:anthropic:5139910008",
  "jd_source_tier": "L1",
  "jd_license": "Greenhouse job board content (Anthropic), retrieved 2026-10-11",
  "jd_title": "Staff+ Software Engineer, Observability"
}
```

**JD 关键要求（逐字引用）**

- `"Experience building and operating large-scale observability or monitoring infrastructure"`（Minimum qualifications）
- `"Hands-on experience with observability signals end to end, from instrumentation through ingest to query and analysis"`
- `"Reduce mean time to detection and resolution by building cross-signal correlation (from kernel-level events up to application traces), unified query interfaces, and AI-assisted diagnostic tooling"`
- `"Design and build scalable telemetry ingest and storage pipelines for metrics, logs, traces, and error data across Anthropic's multi-cluster infrastructure"`

**虚构候选人画像**：`{{candidate}}`，6 年后端/基础设施经验，前 3 年业务后端，后 3 年内部可观测性平台。

**证据链条**

| JD 要求 | fact_id | proficiency | 证据原文（虚构） | 判定 |
|---|---|---|---|---|
| large-scale observability infrastructure | `f_obs_pipeline` | deep | "负责 trace 接入 SDK 与采集管道，日均 4 亿 [示例数值] span" | Strong |
| instrumentation through ingest to query | `f_obs_e2e` | deep | "独立改造采集端到上报链路，覆盖埋点、缓冲、落盘、查询接口" | Strong |
| cross-signal correlation | `f_obs_correlation` | working | "把 trace 与日志按 trace_id 关联，告警可直接跳日志" | Adjacent |
| multi-cluster infrastructure | `f_multicluster` | oversight | "参与多集群部署方案评审，实际部署由平台组执行" | Adjacent |

`f_multicluster` 是 `oversight`：原文写"参与评审"，所以 bullet 只能写参与，不能写主导。

**改写前（问题 bullet）**

- "负责公司可观测性平台建设，熟悉 Prometheus、Grafana、OpenTelemetry" —— 无 fact_id 边界，技术名词罗列无证据形态，JD 要求被抄成能力
- "提升了系统稳定性" —— 无数字，空话
- "负责多集群部署" —— 原文是"参与评审"，责任范围通胀

**改写后（正式稿 bullets）**

| id | bullet | fact_ids | weight_keys | weight |
|---|---|---|---|---|
| b1 | 独立负责 trace 采集管道，日均 4 亿 [示例数值] span，P99 端到端延迟 3s [示例数值] | `f_obs_pipeline` | quantified-result 1.6 + technical-depth 1.3 | 2.9 |
| b2 | 打通埋点→采集→存储→查询全链路，新增链路平均接入时间从 2 天降到 4 小时 [示例数值] | `f_obs_e2e` | quantified-result 1.6 + technical-depth 1.3 | 2.9 |
| b3 | 按 trace_id 关联 trace 与日志，告警页可直接跳转上下文，平均定位时间从 40 分钟降到 12 分钟 [示例数值] | `f_obs_correlation` | quantified-result 1.6 + technical-depth 1.3 | 2.9 |
| b4 | 参与多集群部署方案评审，负责其中接入侧的一致性校验 | `f_multicluster` | technical-depth 1.3 | 1.3 |

**排序说明**：b1–b3 同为 2.9，按 `evidence_forms` 口径 b1 的系统级指标优先；b4 是 `oversight` 证据且权重低，放段尾。frame 是 `performance-stability`，若换成 `business-delivery`，b4 的措辞会往"支撑多团队接入"偏，但 b1 的"独立负责"不变——**排序与措辞变了，事实边界没变**。

**可复用表达模式**：`规模 + 端到端范围 + 前后对比指标`；`本人角色用原文措辞`。

**缺口类型**：多集群只到 oversight，hands-on 声称不允许；JD 的 "AI-assisted diagnostic tooling" 无对应事实 → 进 `omitted`，不编。

---

## CASE-02 · 软件开发-后端 · 部分匹配 · 正例

```json
{
  "case_id": "rt-be-002",
  "role_family": "backend-sw",
  "frame": "business-delivery",
  "jd_suggested_frame": "system-designer",
  "frame_source": "candidate",
  "scenario": "partial-match",
  "synthetic": true,
  "source_tier": "L1",
  "license": "Loomi project license",
  "jd_ref": "gh:anthropic:5422684008",
  "jd_source_tier": "L1",
  "jd_license": "Greenhouse job board content (Anthropic), retrieved 2026-10-11",
  "jd_title": "Staff Software Engineer, Search"
}
```

**JD 关键要求（逐字引用）**

- `"5+ years building complex distributed systems in production"`
- `"Solid grasp of search fundamentals: indexing, retrieval, ranking"`
- `"Work with a small, senior team of engineers and researchers to build Anthropic's search platform from scratch"`
- `"Establish metrics and tooling to measure and improve search quality"`

**虚构候选人画像**：`{{candidate}}`，5 年电商后端，做过搜索链路的召回侧改造，无自建搜索平台经验。

**证据链条**

| JD 要求 | fact_id | proficiency | 证据原文（虚构） | 判定 |
|---|---|---|---|---|
| 5+ years distributed systems | `f_years` | working | "5 年电商后端，负责订单与商品服务" | Adjacent |
| indexing, retrieval, ranking | `f_search_recall` | working | "改过商品搜索的召回层，加了类目过滤与同义词扩充" | Adjacent |
| build search platform from scratch | `f_search_platform` | — | 无对应事实 | Miss |
| metrics and tooling for search quality | `f_search_metric` | deep | "建了搜索badcase标注集，按'无结果/结果不相关/超时'三类归因，每周回归" | Strong |

**改写前**：把 JD 的 "build search platform from scratch" 抄成"负责搜索平台从 0 到 1 建设"——JD 要求被抄成候选人能力，直接拒绝回炉。

**改写后（正式稿 bullets）**

| id | bullet | fact_ids | weight_keys | weight |
|---|---|---|---|---|
| b1 | 搭建搜索 badcase 归因体系，按无结果/不相关/超时三类标注，周级回归，定位到召回层的占比从 61% 降到 34% [示例数值] | `f_search_metric` | quantified-result 1.5 + technical-depth 1.3 | 2.8 |
| b2 | 改造商品搜索召回层，新增类目过滤与同义词扩充，无结果率从 8.2% 降到 5.1% [示例数值] | `f_search_recall` | quantified-result 1.5 + technical-depth 1.3 | 2.8 |
| b3 | 5 年电商后端，负责订单与商品服务的日常迭代与线上问题定位 | `f_years` | delivery-count 1.3 | 1.3 |

**frame 差异提示**：`frame_source=candidate` 且与 `jd_suggested_frame` 不同，`frame_note` 必填："你选择的业务交付定位与该 JD 的 persona 有差异——JD 更强调检索与召回架构。可改选 retrieval-architecture（本 JD 属 ai-knowledge-eng / backend-sw 交叉，参数表按 backend-sw 取）。" 候选人不改，就用 `business-delivery` 出稿——**候选人对自己的定位有最终决定权**。

**omitted**：`{ text: "负责搜索平台从 0 到 1 建设", reason: "JD 要求，无候选人事实支撑", rule: "R3", action: "rejected" }`

**可复用表达模式**：`缺口显式进 omitted，不抄 JD`；`部分匹配时把最强的证据形态前置`。

**缺口类型**：无自建平台经验（Miss）；frame 与 JD persona 差异需提示。

---

## CASE-03 · AI 与知识库工程 · 部分匹配 · 正例

```json
{
  "case_id": "rt-ai-001",
  "role_family": "ai-knowledge-eng",
  "frame": "evaluation-data-quality",
  "scenario": "partial-match",
  "synthetic": true,
  "source_tier": "L1",
  "license": "Loomi project license",
  "jd_ref": "gh:anthropic:5289450008",
  "jd_source_tier": "L1",
  "jd_license": "Greenhouse job board content (Anthropic), retrieved 2026-10-11",
  "jd_title": "Staff+ Software Engineer, Enterprise Knowledge Work"
}
```

**JD 关键要求（逐字引用）**

- `"builds the products that help enterprise knowledge workers collaborate deeply with Claude for major parts of their work"`
- `"Strong coding skills"` / `"experience building and operating large-scale ... infrastructure"`

**虚构候选人画像**：`{{candidate}}`，4 年后端 + 1 年内部知识库工程，做过 RAG 问答上线，主导过评测集建设。

**证据链条**

| JD 要求 | fact_id | proficiency | 证据原文（虚构） | 判定 |
|---|---|---|---|---|
| knowledge work products | `f_kb_rag` | deep | "独立负责内部知识库 RAG 问答上线，覆盖 12 万 [示例数值] 篇文档" | Strong |
| evaluation / data quality | `f_kb_eval` | deep | "建了 800 题 [示例数值] 评测集，按检索失败/幻觉/过期三类归因" | Strong |
| retrieval tuning | `f_kb_recall` | working | "混合检索 + rerank，召回率从 0.71 到 0.86 [示例数值]" | Adjacent |
| cost / latency | `f_kb_cost` | oversight | "参与成本评审，实际改造由算法同学执行" | Adjacent |

**改写前**："熟练使用 LangChain、RAG、向量数据库"——名词罗列，无 fact_id，无规模，无结果。

**改写后（正式稿 bullets）**

| id | bullet | fact_ids | weight_keys | weight |
|---|---|---|---|---|
| b1 | 独立负责内部知识库 RAG 问答上线，覆盖 12 万 [示例数值] 篇文档，日均 1.4 万 [示例数值] 次提问 | `f_kb_rag` | quantified-result 1.5 + design-decision 1.3 | 2.8 |
| b2 | 建 800 题 [示例数值] 评测集并按检索失败/幻觉/过期三类归因，据此定位分块策略问题，无依据回答率从 19% 降到 7% [示例数值] | `f_kb_eval` | quantified-result 1.5 + methodology-depth 1.4 | 2.9 |
| b3 | 混合检索 + rerank，召回率从 0.71 提升到 0.86 [示例数值] | `f_kb_recall` | quantified-result 1.5 + technical-depth 1.3 | 2.8 |
| b4 | 参与推理成本评审，提供单次问答 token 口径的统计 | `f_kb_cost` | technical-depth 1.3 | 1.3 |

**排序说明**：frame 是 `evaluation-data-quality`，`methodology-depth` 权重 1.4 最高，b2 排第一——同一份事实若换成 `application-engineering` frame，b1 的"上线规模"会前置。**换 frame 换的是排序与侧重，b2 的评测集数字不变。**

**可复用表达模式**：`评测先行`（有评测集的人与没有的人是两个物种，参数表 success_factors）；badcase 归类维度写进 bullet。

**缺口类型**：成本/延迟只到 oversight；Agent 编排无事实 → omitted。

---

## 反例（刻意构造，标注违反的规则）

反例的作用是教"什么会被门禁拦下、为什么"（T13 §4）。每条反例都给出门禁处置与改写方向。

### CX-01 · 违反 R2：stated 引文在 JD 原文里检索不到

```json
{
  "case_id": "rt-cx-001",
  "role_family": "backend-sw",
  "frame": "system-designer",
  "synthetic": true,
  "source_tier": "L1",
  "license": "Loomi project license",
  "jd_ref": null,
  "jd_source_tier": "L4",
  "jd_license": "unverified — JD 片段为构造示例，未指向可检索的发布源；provenance 缺失时不得当成 L1 逐字引用",
  "violates": "R2"
}
```

- 输入：JD 原文写 `"Design and implement database solutions that scale to support millions of users"`，skill 输出 `sourceQuote: "精通分布式架构设计"`
- 门禁：R2 flagged——引文在 JD 原文中检索不到，可能是改写而非逐字引用
- 改写方向：引文必须是 JD 原文的逐字片段；要表达"要求架构能力"就原样引那句话

### CX-02 · 违反 R3：strong 匹配引用 needs_review 的 fact_id

```json
{
  "case_id": "rt-cx-002",
  "role_family": "ai-knowledge-eng",
  "frame": "retrieval-architecture",
  "synthetic": true,
  "source_tier": "L1",
  "license": "Loomi project license",
  "jd_ref": "gh:anthropic:5422684008",
  "jd_source_tier": "L1",
  "jd_license": "Greenhouse job board content (Anthropic), retrieved 2026-10-11",
  "violates": "R3"
}
```

- 输入：JD 要求 `"Solid grasp of search fundamentals: indexing, retrieval, ranking"`；候选人事实 `f_recall` 的 `status=needs_review`（从项目描述推断，未经用户确认）
- 输出：`verdict: Strong`，bullet 引用 `f_recall`，写"主导召回层重构"
- 门禁：R3 removed——正式稿 bullet 引用了未经确认的事实，已从正式稿摘除
- 改写方向：needs_review 的事实默认不引用；要么降到 `fact_buckets.needs_review` 并问用户（`changes_answer=true`），要么不进正式稿

### CX-03 · 违反 R1：责任范围通胀

```json
{
  "case_id": "rt-cx-003",
  "role_family": "backend-sw",
  "frame": "system-designer",
  "synthetic": true,
  "source_tier": "L1",
  "license": "Loomi project license",
  "jd_ref": null,
  "jd_source_tier": "L4",
  "jd_license": "unverified — 反例只用候选人证据演示 R1，未引用 JD 发布内容",
  "violates": "R1"
}
```

- 输入：事实原文 "参与订单系统重构，负责其中支付模块"
- 输出 bullet："独立负责订单系统重构与架构设计"
- 门禁：R1 flagged——原文只体现参与/协助，输出不得写成独立负责/主导
- 改写方向：角色措辞取原文。"参与订单系统重构，独立负责其中支付模块"——边界一句都没放大

### CX-04 · 违反 R4：跨候选污染

```json
{
  "case_id": "rt-cx-004",
  "role_family": "database",
  "frame": "data-platform-reliability",
  "synthetic": true,
  "source_tier": "L1",
  "license": "Loomi project license",
  "jd_ref": null,
  "jd_source_tier": "L4",
  "jd_license": "unverified — 反例只用候选人证据演示 R4，未引用 JD 发布内容",
  "violates": "R4"
}
```

- 输入：`candidate_id=cand_001`；bullet 引用的 `f_pg_ha` 归属 `cand_002`
- 门禁：R4 rejected——fact 不属于当前求职者，**拒绝渲染整稿**（不可恢复错误，不是摘除一条了事）
- 改写方向：bullet 的 fact_id 必须来自当前 candidate 的检索结果。这条没有"改写法"，只有"重查"

### CX-05 · 违反 R3：数字在证据里找不到

```json
{
  "case_id": "rt-cx-005",
  "role_family": "database",
  "frame": "performance-tuning",
  "synthetic": true,
  "source_tier": "L1",
  "license": "Loomi project license",
  "jd_ref": null,
  "jd_source_tier": "L4",
  "jd_license": "unverified — 反例只用候选人证据演示 R3，未引用 JD 发布内容",
  "violates": "R3"
}
```

- 输入：事实原文 "P99 延迟从 900ms 降到 120ms"
- 输出 bullet："P99 延迟降到 30ms"（把结果说好一倍）
- 门禁：R3 removed——输出中的数字在证据里找不到：30
- 改写方向：数字只能取证据里的值；想让数字更好看去改事实，不能改 bullet

### CX-06 · frame 越界：换 frame 把 inferred 说成 stated

```json
{
  "case_id": "rt-cx-006",
  "role_family": "ai-knowledge-eng",
  "frame": "application-engineering",
  "synthetic": true,
  "source_tier": "L1",
  "license": "Loomi project license",
  "jd_ref": null,
  "jd_source_tier": "L4",
  "jd_license": "unverified — 反例只用候选人证据演示 frame 越界，未引用 JD 发布内容",
  "violates": "T14 §7（frame 不是事实层；落地为 R1 flagged）"
}
```

- 输入：事实 "从项目描述推断接触过向量数据库"，`claim_type=inferred`
- 输出：因为 frame 是 `application-engineering`，bullet 写成"负责向量数据库选型与上线"，且未标 `[unverified]`
- 门禁：R1 flagged——inferred 不得作强证据；`fact_buckets` 里必须留在 inferred 栏
- 改写方向：frame 只改排序与措辞。 inferred 的事实换 frame 仍是 inferred，要么标 `[unverified]` 保留+标注，要么等用户确认升 verified

---

## 使用方式

- 作 few-shot：按 `role_family` + `scenario` 取对应案例，参考它的证据链条组织方式
- 作判据：拿不准某条 bullet 是否合格时，对照反例的门禁处置
- **不引用本文件里任何虚构数字当事实**——它们标了 `[示例数值]`，是说明性数字（T10 §2）
- 案例不覆盖全部场景；未读到的案例不得声称覆盖（T8 §6：未读到的内容不得引用）
