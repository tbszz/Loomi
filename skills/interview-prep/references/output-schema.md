> 集成说明：本文件保留 zzy 分析结构示例，不代表当前服务端 API 或已执行的规则校验。当前 SKILL.md 的事实状态、MCP 工具和正式产出契约优先。

# interview-prep 输出 schema

结构化记录（JSON/YAML）。字段清单与取值约束。产出前必读本文件。

## 顶层结构

```yaml
plan: PlanDay[]                # 每日计划，长度 = days
project_questions: ProjectQuestion[]   # 项目深挖题
technical_review: TechnicalReviewItem[] # 技术复习清单
buckets:                       # T6 Q3 三类分栏，不得合并
  known_facts: BucketItem[]
  inferred: BucketItem[]
  to_confirm: BucketItem[]
meta: Meta
```

## `plan[]`

| 字段 | 类型 | 约束 |
|---|---|---|
| `day` | int | 1-based，连续，长度 = `days` |
| `focus` | string | 当日主题，中文。必须来自参数表 `evaluation_focus` / `critical_tasks` / `skill_requirements`，不得自造 |
| `tasks` | Task[] | 2–5 条 |

`Task`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `task` | string | 可执行动作，具体到"练哪道题 / 改哪段故事" |
| `question_id` | string? | 关联题库 id；无库存题时为空并在 `note` 说明 |
| `kind` | enum | `practice` / `review` / `story` / `research` / `rest` |
| `est_minutes` | int | >0，单日合计 ≤ 180 |
| `source_tier` | enum | `L1`–`L4`，缺即不得入库（T5 §4） |

## `project_questions[]`

针对候选人项目的深挖题。**必须先检索 Candidate KB 再生成**（SKILL.md 阶段 2）。

| 字段 | 类型 | 约束 |
|---|---|---|
| `question` | string | 中文问句 |
| `based_on` | string | 基于哪个项目/事实，**必须带 `fact_id`** |
| `evaluation_focus` | string[] | 取值必须是参数表 `evaluation_focus[].id`，如 `design-tradeoff`。不得使用参数表之外的维度 |
| `probe_depth` | enum | `surface` / `second` / `third`——对应"往下挖三层"的 depth-probe |
| `oversight_level` | enum | `deep` / `working` / `oversight` / `historical`。`historical` 的题不出——参数表规定不得声称 |
| `source_tier` | enum | `L1`–`L4` |

## `technical_review[]`

技术复习清单。**来源必须是参数表的 `evaluation_focus`**——那是 profile 侧对"面试真正考察什么"的
权威答案（T4）。不从通用技术榜单、不从个人猜测生成。

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | string | 复习项 id |
| `title` | string | 中文标题 |
| `why` | string | **必须引用 `evaluation_focus[].note` 或参数表字段**，说明为什么这个岗位族要考它 |
| `evaluation_focus` | string | 参数表 `evaluation_focus[].id`，必填 |
| `priority` | enum | `high` / `medium` / `low`。`high` 只给 KB 有 gap 或 `evaluation_focus` 标为高权的项 |
| `linked_skill` | string? | 参数表 `skill_requirements` 的 key，如 `concurrency-control` |
| `source_tier` | enum | `L1`–`L4` |

`priority` 判定顺序：KB 实际级别低于 `skill_requirements.min_level` 的项 → `high`；
等于 `min_level` 低于 `preferred_level` → `medium`；其余 → `low`。
级别口径：`deep` / `working` / `oversight` / `historical`（T14 Q5）。

## `buckets`

T6 Q3：三类分栏，**永不合并**。

| 字段 | 类型 | 约束 |
|---|---|---|
| `claim` | string | 中文陈述 |
| `fact_id` | string? | `known_facts` 必填，且必须归属当前 `candidate_id`（T6 R4） |
| `basis` | string? | `inferred` 必填，说明推断依据 |
| `unverified` | bool | `inferred` 恒为 `true` |
| `question` | string | `to_confirm` 的问题 |
| `changes_answer_by` | string | 回答它会改变哪个结论。**答不出这项的问题不进 `to_confirm`**（T6 Q4：追问不设硬上限，自律标准是"是否改变答案"） |

## `meta`

| 字段 | 类型 | 约束 |
|---|---|---|
| `candidate_id` | string | **必填**。缺即拒绝执行，不容推断 |
| `role_family` | enum | `backend-sw` / `database` / `ai-knowledge-eng` |
| `days` | int | 1–30，缺省 7。越界即 clamp 到边界并在 `note` 声明 |
| `data_version` | string | 实际加载的数据版本 |
| `requires_data` | string | SKILL.md frontmatter 声明值。低于即报错，不静默降级（T5 §4） |
| `not_evaluated` | string[] | **一等状态**（T6 Q3）。显式列出未评估项，不得用通用话术填空 |
| `source_text_used` | bool | 是否真的读了 JD / KB。false 时输出必须开头声明未按目标岗位定制 |

## 门禁

输出经 当前求职工具的证据校验 校验。确定性规则由代码执行，本文件不重复定义：

- R1 `inferred` 不得进高优项、重要性封顶
- R2 `evidence=stated` 的引文必须能在 JD 原文检索到
- R3 `known_facts` / 正式稿 bullet 必须引用非 `needs_review` 的 `fact_id`
- R4 渲染时校验 `fact_id` 归属当前 `candidate_id`，跨候选即拒绝

违例按 T6 Q7 三级降级：拒绝并回炉 / 摘除 + 说明 / 保留 + 标注 `[unverified]`。

## 明确禁止的字段

- 任何总分、X/10、百分制匹配度——LLM 打分不可复现
- 无 `fact_id` 的"独立负责"类 ownership 声称
- `historical` 级技能的"已掌握"标注
