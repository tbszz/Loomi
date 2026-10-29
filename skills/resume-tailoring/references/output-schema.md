> 集成说明：本文件保留 zzy 分析结构示例，不代表当前服务端 API 或已执行的规则校验。当前 SKILL.md 的事实状态、MCP 工具和正式产出契约优先。

# resume-tailoring 输出契约

字段清单与取值约束。产出前必读。所有标"必填"的字段缺失即拒绝执行，不容推断。

## 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `candidate_id` | ✅ | 候选人 id。所有 `fact_ids` 必须归属它（R4） |
| `role_family` | ✅ | `backend-sw` / `database` / `ai-knowledge-eng` |
| `role_profile_version` | ✅ | 本次使用的参数表版本，如 `backend-sw@1.0.0` |
| `frame` | ✅ | 生效 frame 的 id，取值须在所加载参数表的 `frames[].id` 内 |
| `frame_source` | ✅ | `candidate`（用户自选）/ `jd`（JD 识别，含 frame 未传时的默认） |
| `jd_suggested_frame` | ✅ | JD 识别出的 frame id。与 `frame` 相同时也填 |
| `frame_note` | 条件 | `frame_source=candidate` 且与 `jd_suggested_frame` 不同时**必填**：提示差异，不改写候选人的决定（T14 §6）。`frame_source=jd` 时填"使用 JD 识别结果" |
| `bullets[]` | ✅ | 见下。可为空数组——空也是合法输出，等于"当前证据不支持定制稿" |
| `omitted[]` | ✅ | 被摘除/压缩的条目。可为空数组，但字段必须在 |
| `fact_buckets` | ✅ | 三类分栏，见下 |
| `questions[]` | ✅ | 追问。可为空数组 |
| `status` | ✅ | `ok` / `rejected` / `needs_review` / `partial`，由 当前求职工具的证据校验 回填 |
| `policy` | ✅ | 门禁回填：`checked` / `violations[]` / `quality_tier` |

## `frame`

合法 id 按岗位族取参数表 `frames[]`：

| role_family | 合法 frame id |
|---|---|
| `backend-sw` | `system-designer` / `performance-stability` / `platform-tooling` / `business-delivery` |
| `database` | `data-modeling` / `performance-tuning` / `data-platform-reliability` |
| `ai-knowledge-eng` | `retrieval-architecture` / `evaluation-data-quality` / `application-engineering` |

frame 命名本身**不过门禁**（T14 §7）——叫"系统设计者"还是"平台构建者"是措辞。但 frame 驱动的 **bullet 选择与排序要过门禁**：选了没有证据支撑的项目即 R3 违例。

## `bullets[]`

| 字段 | 必填 | 取值约束 |
|---|---|---|
| `id` | ✅ | bullet 唯一 id，门禁按它定位摘除 |
| `text` | ✅ | bullet 正文。中文简历正文，英文技术名词保留原文 |
| `fact_ids` | ✅ | **非空数组**。空数组的 bullet 不得进正式稿——出口门禁直接摘除并记 `omitted`（T9 §3）。多事实合成的 bullet 列全部 fact_id |
| `section` | ✅ | 所属简历段：`summary` / `experience` / `project` / `skill` |
| `claim_type` | ✅ | `stated`（JD 原文逐字可检）/ `inferred`（从证据推断，标 needs_review） |
| `weight_keys` | ✅ | 本条命中的 `bullet_weight` 键名列表，如 `["quantified-result","technical-depth"]` |
| `weight` | ✅ | 按参数表 `bullet_weight` 加权后的排序分。数值型 |
| `provenance` | ✅ | `{ fact_id, proficiency, evidence_form }`。`proficiency` ∈ `deep`/`working`/`oversight`/`historical`；`evidence_form` 取参数表 `evidence_forms[].form` |
| `frame_note` | 可选 | 该 bullet 因 frame 产生的措辞变化说明（如"performance-stability frame 下前置"） |

约束：

- `claim_type=inferred` 的 bullet **不得**作为 hard_stop 的支撑（R1），并按 T6 §7 保留+标注 `[unverified]`
- `provenance.proficiency=oversight` 的 bullet 不得写成 hands-on（`oversight` 只能 led-not-performed，T14 §5）
- bullet 正文里的数字必须能在 `fact_id` 指向的证据 span 里逐字或等价找到（R3，数字放大即摘除）

## `omitted[]`

| 字段 | 必填 | 取值约束 |
|---|---|---|
| `text` | ✅ | 被摘除/压缩的原文或候选 bullet |
| `reason` | ✅ | 人读的原因：无 fact_id / needs_review / 跨候选 / 数字无来源 / frame 降权压缩 / 与 JD 无关 |
| `rule` | 条件 | 命中门禁规则时填 `R1`–`R4`；纯 frame 降权（如 `deemphasis` 命中）留空 |
| `action` | ✅ | `removed`（摘除）/ `compressed`（压缩为一句）/ `rejected`（整稿回炉） |

正式稿摘除必须在响应里说明摘掉了哪几条及原因（T6 §7"摘除 + 说明"）。静默删除不允许。

## `fact_buckets`

T6 Q3 三类分栏，**不得合并**：

```json
{
  "stated":    ["<有逐字证据的事实 id 或描述>"],
  "inferred":  ["<从证据推断、待确认的事实>"],
  "needs_review": ["<需要用户确认后才能进正式稿的事实>"]
}
```

- `stated` 的每条必须能回溯到 JD 原文或 KB 证据 span
- `inferred` 一律低 confidence，默认不进正式稿；要进必须显式标 `[unverified]`
- `needs_review` 的事实**默认不引用**；用户确认是唯一升 `verified` 的路径（T6 Q2）

## `questions[]`

| 字段 | 必填 | 取值约束 |
|---|---|---|
| `question_id` | ✅ | `q1` / `q2` … |
| `text` | ✅ | 问题正文 |
| `options` | 可选 | 候选答案。开放式问题留空 |
| `changes_answer` | ✅ | 布尔。回答它是否改变最终稿子的选择与排序——**这是唯一的追问正当理由**（T6 Q4） |

不设硬上限。`changes_answer=false` 的问题不要问。

## 示例骨架

```json
{
  "candidate_id": "cand_001",
  "role_family": "backend-sw",
  "role_profile_version": "backend-sw@1.0.0",
  "frame": "performance-stability",
  "frame_source": "candidate",
  "jd_suggested_frame": "system-designer",
  "frame_note": "你选择的定位与该 JD 的 persona 有差异——JD 更强调架构设计。可改选 system-designer。",
  "bullets": [
    {
      "id": "b1",
      "text": "主导订单库慢查询治理，P99 从 900ms 降至 120ms",
      "fact_ids": ["f_order_slowquery"],
      "section": "experience",
      "claim_type": "stated",
      "weight_keys": ["quantified-result", "technical-depth"],
      "weight": 2.9,
      "provenance": { "fact_id": "f_order_slowquery", "proficiency": "deep", "evidence_form": "slow-query-metric-delta" }
    }
  ],
  "omitted": [
    { "text": "负责微服务架构设计与性能提升", "reason": "原文只体现参与，写成独立负责属责任范围通胀", "rule": "R1", "action": "removed" }
  ],
  "fact_buckets": {
    "stated": ["订单库慢查询治理（f_order_slowquery）"],
    "inferred": ["推测接触过 Kafka，JD 与项目均未明示"],
    "needs_review": ["容量规划经验待确认"]
  },
  "questions": [
    { "question_id": "q1", "text": "这个项目的容量规划是你独立做的吗？", "options": ["独立负责", "参与", "不了解"], "changes_answer": true }
  ],
  "status": "ok",
  "policy": { "checked": ["R1", "R2", "R3", "R4"], "violations": [], "quality_tier": "excellent" }
}
```
