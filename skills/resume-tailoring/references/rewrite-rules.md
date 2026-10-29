# 改写判断规则

rewrite-rules：frame 如何驱动 bullet 选择与排序、什么算证据、以及 frame 不是事实层的边界。
门禁（R1–R4）由 当前求职工具的证据校验 执行，本文件不重复它；这里只写代码无法枚举的判断。

## 一、`bullet_weight` 驱动选择与排序

参数表每个 frame 带 `emphasis.bullet_weight`，键是 bullet 的证据形态，值是权重：

```yaml
frames:
  - id: performance-stability
    emphasis:
      bullet_weight:
        quantified-result: 1.6
        technical-depth: 1.3
        incident-ownership: 1.5
        delivery-count: 0.5
```

键名集合（三个岗位族共用，个别 frame 增补自己的键）：

| 键 | 含义 | 常见于 |
|---|---|---|
| `quantified-result` | 带前后对比的系统级数字（P99/QPS/可用性/成本） | 全部 |
| `technical-depth` | 讲到底层机制而非"用了某框架" | 全部 |
| `design-decision` | 有取舍与理由的架构/建模决策 | system-designer、data-modeling、retrieval-architecture |
| `incident-ownership` | 真实故障的定位与修复归属 | performance-stability、data-platform-reliability |
| `adoption-metric` | 平台/工具被采用的程度（接入方数量、覆盖率） | platform-tooling |
| `business-impact` | 对业务结果的影响 | business-delivery、application-engineering |
| `delivery-count` | 交付数量、需求条数 | 普遍**低权重**（0.5–1.3） |
| `domain-depth` | 业务领域知识深度 | platform-tooling 里被降权 |
| `query-count` | 治理的 SQL 条数 | data-modeling 里被降权 |
| `cost-metric` | 成本/延迟预算口径 | application-engineering |
| `methodology-depth` | 指标设计与方法论严谨度 | evaluation-data-quality |
| `paper-count` | 论文/理论研究数量 | application-engineering 里被降权 |
| `sql-trick` | 单条 SQL 技巧 | data-platform-reliability 里被降权 |

排序算法（确定性，不靠模型临场发挥）：

```text
1. 候选 bullet 全部来自阶段 2 检索到的、带 fact_id 的事实
2. 逐条命中 weight_keys：按命中键的权重求和，得 weight
   命中多个键取加权和，不取最大值——"有量化结果的深度归因 bullet"确实该排更前
3. 同分时按 evidence_forms[].weight 高者优先（high > medium > low）
4. 仍然同分，按事实的时间倒序（近期经历优先）
5. 落入 frames[].deemphasis 的条目不删除，压缩为一句或移到 skill 段末尾
```

`deemphasis` 是压缩不是删除——crud-features 被降权，但候选人确实做过，一句话留在段尾。
**只有门禁能删除条目，frame 不能。**

## 二、什么算一条 bullet 的证据

一条 bullet 要进正式稿，必须同时满足：

1. **有 fact_id**：bullet 引用的每条事实都有 id，且归属当前 `candidate_id`（R4）。没有 fact_id 的句子不得进正式稿，记入 `omitted`（reason=无 fact_id，rule=R3）
2. **证据形态落在 `evidence_forms` 里**：参数表列了这个岗位什么形态的证据有说服力。选 `course-project`（weight: low）可以，但必须显式说明规模——"课程项目，无生产量级"要写在 bullet 或摘要里，不能混过去
3. **proficiency 支撑声称**：`deep`/`working` 可作 hands-on；`oversight` 只能 led-not-performed（"带领团队完成 X，本人负责 Y"）；`historical` 不得声称（T14 §5）
4. **来源维度与深度维度分开判**：`deep` 但 `inferred` 仍降为 needs_review（T14 §5）。深度不能替代来源
5. **数字可回溯**：bullet 里的每个数字都要能在证据 span 里找到。写不出来源的数字整条摘除

证据链的完整性优先级：

```text
事实原文（sourceQuote）
  → 本人角色（参与 / 协助 / 独立负责 / 主导，取原文措辞）
  → 规模（流量/数据量/团队数，取原文数字）
  → 难点（技术约束，取原文描述）
  → 结果（前后对比，取原文数字）
```

缺环就按缺的位置处理：缺结果 → 不写结果，不编；缺角色边界 → 用参与措辞，不升格；
缺规模 → 不写规模，或用 `[unverified]` 标注并进 `fact_buckets.inferred`。

## 三、frame 是排序与措辞层，不是事实层

**同一条事实，换 frame 只改三件事：它排第几、它用哪套词、它进哪一段。** 不改它的真假。

| frame 改 | frame 不改 |
|---|---|
| bullet 顺序（weight 高的前置） | `stated` ↔ `inferred` 的来源判定 |
| 措辞侧重（"系统设计者"突出取舍，"性能攻坚"突出指标） | "参与" ↔ "独立负责"的角色措辞 |
| 段落取舍（summary 写哪一面，skill 段列哪些） | 数字、规模、时间、团队大小 |

T14 §7 的分层：**frame 命名不过门禁，bullet 选择过门禁。** 若换 frame 导致 bullet 越过 R1–R4，那是 bullet 层的问题，按 T6 §7 三级降级处置——不是 frame 的错，也不因为 frame 看起来合理就放行。

同一真相换框架的落地方式（T14 §4）：

```text
事实：参与订单系统重构，负责其中支付模块，P99 900ms → 120ms

performance-stability frame：
  前置 + 指标措辞 → "优化订单查询路径，P99 延迟从 900ms 降至 120ms"
business-delivery frame：
  前置 + 交付措辞 → "支撑三条业务线按期上线，期间主导支付模块改造"
```

两版都不改变"负责支付模块"的边界——第一版甚至没有动角色措辞，只动了排序与侧重。
第二版的"主导支付模块"仍需原文支持；若原文只写"参与"，两版都只能写参与。

## 四、措辞规则

- **动词不升格**：原文"参与"→输出"参与"；原文"负责"→输出"负责"。"主导/独立负责/牵头"只在原文有明确归属时用
- **不抄 JD 当能力**：JD 写"熟悉 Kafka"不等于候选人会 Kafka。JD 要求只在 `jd_suggested_frame` 与 requirement 匹配里出现，不进 bullets 正文
- **数字不放大**：`checkGroundedNumbers` 会摘除；不要赌它看不见
- **不填空话**：`— not evaluated` 是一等状态。没有证据的维度不写，进 `omitted` 说明原因
- **建议带三件套**：每条给用户的建议必须带 `证据引用 → 缺口 → 可立即执行的动作`。空证据的建议不输出（T6 Q3）

## 五、分栏与追问

输出固定三类分栏（T6 Q3）：`已知事实` / `推断` / `待确认`。合并即失真——用户要一眼看出哪句有据。

追问不设硬上限，自律标准是"回答它是否改变答案"（T6 Q4）：

```text
改变答案 → 问（"这个项目你独立负责还是参与？" 会改 bullet 的角色措辞）
不改变答案 → 不问（"你希望用什么字体？"）
```

`changes_answer=false` 的问题不进 `questions[]`。
