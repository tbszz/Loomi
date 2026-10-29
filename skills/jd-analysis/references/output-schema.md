> 集成说明：本文件保留 zzy 分析结构示例，不代表当前服务端 API 或已执行的规则校验。当前 SKILL.md 的事实状态、MCP 工具和正式产出契约优先。

# jd-analysis 输出契约

阶段 1g 产出前读本文件。字段用于组织分析记录；当前应用不提供该分支的独立 JD 分析 API，不能声称此 JSON 已由服务端校验。

## 顶层结构

```json
{
  "jd_id": "string",
  "source_tier": "L1 | L2 | L3 | L4",
  "is_official_jd": "boolean",
  "fetched_at": "ISO8601 | null",
  "role_family": "backend-sw | database | ai-knowledge-eng",
  "persona": { },
  "requirements": [ ],
  "summary": { }
}
```

## `requirements[]`

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | string | 稳定唯一，`req-N` 或 `req-profile-<skill-id>` |
| `text` | string | JD 原文逐字引用，或参数表 `label` |
| `required` | boolean | `false` 表示加分项/优先项 |
| `status` | string | `stated`（JD 明写）/ `inferred`（推断） |
| `sourceQuote` | string | `status: stated` 时必填，必须能在 JD 原文检索到 |
| `hardStop` | boolean | `status: inferred` 时必须为 `false` |
| `importance` | string | `low` / `meaningful` / `high`。`inferred` 不得超过 `meaningful` |
| `verdict` | string | `Strong` / `Adjacent` / `Miss` / `Unknown` |
| `evidence` | object \| null | `{ fact_id, source_quote, proficiency, status }` |
| `proficiency` | string \| null | `deep` / `working` / `oversight` / `historical` |
| `note` | string \| null | 非空时必须展示给用户（如 led-not-performed 说明） |

### `verdict` 判定

| 值 | 条件 |
|---|---|
| `Strong` | 有 `deep` 级证据且 `status: verified` |
| `Adjacent` | 有 `working` 级证据，或 `deep` 但 `needs_review` |
| `Miss` | 无证据，或只有 `oversight` / `historical` 级 |
| `Unknown` | 未检索 Candidate KB（缺 `candidate_id`） |

`oversight` 级证据**永不**作 `Strong`——它是"团队做、我 review/定方向"，只能支撑 led-not-performed 表述。

### `proficiency` 四级

| 级 | 含义 | 可否作 hands-on 证据 |
|---|---|---|
| `deep` | 独立做过生产环境关键决策 | ✅ |
| `working` | 生产中日常使用，能独立完成任务 | ✅ |
| `oversight` | 团队做、我 review/定方向 | ❌ 只能 led-not-performed |
| `historical` | 学过/用过但已过时或很浅 | ❌ Miss |

`proficiency` 是**能力深度**轴，与 `status`（来源轴）正交。一个 `deep` 级技能仍可能是 `inferred`。

## `persona`

| 字段 | 类型 | 约束 |
|---|---|---|
| `frame` | string \| null | 参数表 `frames[].id`。识别不出时为 `null` |
| `frame_label` | string \| null | 展示名 |
| `frame_source` | string | `jd`（识别）/ `candidate`（自选）/ `default`（无信号） |
| `jd_suggested_frame` | string \| null | JD 识别结果，即使候选人自选也填 |
| `frame_note` | string \| null | 与 JD 建议有差异时必填，必须展示 |
| `matched_signals` | string[] | 实际命中的 `signals` 关键词 |

`frame_source: default` 时必须带说明（如"未能从该 JD 识别出明确的 persona"）——T14 §8 否决了"首次必须确认"，改为输出里显式说明。

## `summary`

计数，**不是分数**。

```json
{ "Strong": 4, "Adjacent": 2, "Miss": 1, "Unknown": 1 }
```

不输出 X/10、匹配度百分比。LLM 打分不可复现，会把用户带偏。

## 门禁对应

| 字段 | 门禁规则 |
|---|---|
| `status: inferred` + `hardStop: true` | R1 拒绝 |
| `status: inferred` + `importance: high` | R1 拒绝 |
| `status: stated` + `sourceQuote` 检索不到 | R2 拒绝 |
| `verdict: Strong/Adjacent` + 无 `fact_id` 或 `needs_review` | R3 拒绝 |
| `evidence.fact_id` 不属于当前 `candidate_id` | R4 拒绝渲染 |
