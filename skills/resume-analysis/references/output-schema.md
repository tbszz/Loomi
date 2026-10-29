> 集成说明：本文件保留 zzy 分析结构示例，不代表当前服务端 API 或已执行的规则校验。当前 SKILL.md 的事实状态、MCP 工具和正式产出契约优先。

# 输出契约：字段清单与取值约束

本文件为 resume-analysis 的分析记录格式参考。当前应用不提供该分支的独立诊断 API；正式产出通过现有求职 MCP 工具完成。

## 顶层

```json
{
  "sections": { ... },
  "annotations": [ ... ],
  "suggestions": [ ... ],
  "coverage": { ... }
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `sections` | object | 必填。三桶齐全，空桶为空数组，不得省略键 |
| `annotations` | array | 必填。可为空数组；每条必须带三件套（quote → issue → suggestion） |
| `suggestions` | array | 必填。skill 每遍最多产出 3 条（T9 §2），按价值降序；不凑数 |
| `coverage` | object | 建议输出。`{ evaluated, not_evaluated }` 计数，不是分数。T11 要求"未评估是一等状态" |

## sections（三桶，T6 Q3）

```json
"sections": {
  "known_facts": ["…"],
  "inferred": ["…"],
  "to_confirm": ["…"]
}
```

| 桶 | 元素约束 |
|---|---|
| `known_facts[]` | string。简历原文直接陈述、逐字可引用的事实。**section heading / 技能清单 / 自我评价里的自述条目不得进本桶**（diagnosis-rules.md §3） |
| `inferred[]` | string。原文未明说、由原文推出的结论。以 `[inferred]` 前缀标注 |
| `to_confirm[]` | string。原文缺信息、需用户确认才能判定的事项。每条对应一个可问的具体问题 |

桶间不得互相稀释：同一条结论只进一桶。原文没提的经历/数字/成果任何桶都不放。

## annotations[]

```json
{
  "id": "ann-1",
  "quote": "原句逐字引用",
  "section": "projects",
  "severity": "high",
  "issue": "问题是什么",
  "suggestion": "能立即执行的动作",
  "reason": "为什么这是个问题",
  "confidence": "supported"
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | string | 必填。`ann-<n>`，数组内唯一 |
| `quote` | string | 必填。**必须是 resume_text 里的逐字引文**，不得转述、不得拼接 |
| `section` | string | 必填。`projects` / `experience` / `skills` / `education` / `summary` / `general` |
| `severity` | string | 必填。`high` / `medium` / `low`，判据见 diagnosis-rules.md §2 |
| `issue` | string | 必填。缺口本身：读者会因此产生什么误判 |
| `suggestion` | string | 必填。可立即执行的动作；不得要求用户提供不存在的事实 |
| `reason` | string | 必填。为什么这是问题（判定依据，非修辞） |
| `confidence` | string | 建议输出。`supported` / `partial` / `unknown`（T11 证据置信度分层）。`unknown` = 未评估，一等状态，如实写出。该字段是本 skill 结构化记录的 T11 分层，在端点响应中作为附加字段出现，不破坏 api-contract §5.2 的既有字段 |

三件套硬约束：`quote`（证据引用）→ `issue` + `reason`（缺口）→ `suggestion`（动作）缺一即整条不允许输出（T6 Q3 第 2 项）。

## suggestions[]

```json
{
  "gap": "证据缺口",
  "action": "能立即做的动作",
  "question": "一个必要追问"
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `gap` | string | 必填。指向具体证据缺口，可回溯到某条 annotation |
| `action` | string | 必填。用户现在就能做的修改；不得是"量化""优化""突出亮点"这类空话 |
| `question` | string \| null | 可空。一个必要追问；判据是"回答它是否改变答案"（T6 Q4），不改变答案的问题不写。端点响应中允许 `null`（api-contract §5.2），skill 应尽量给出具体追问 |

长度上限 3，按对目标岗位的价值降序。无 jd_text 时按结构与证据质量排，并在输出开头显式声明未按目标岗位定制。

## coverage

```json
"coverage": { "evaluated": 7, "not_evaluated": 2 }
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `evaluated` | number | 已逐条评估的 bullet / section 数 |
| `not_evaluated` | number | 未评估数。**必须如实**，不得为了让总数好看而并入 evaluated |

## 没有的字段

- **无总分**：不输出 `score` / `rating` / `match_percent` 之类。LLM 打分不可复现（同 JD 跑两次分数会变），只出计数与清单。
- **无 `probability`**：不给录用概率，不把关键词覆盖包装成适配概率。
- **无改写后文本**：改写是 resume-tailoring 的职责，本 skill 只给缺口与动作。

## 门禁校验点

当前求职工具的证据校验 执行的部分（skill 文本不重复这些规则）：R1（`inferred` 桶内容的封顶与 hard_stop 禁入）、R3（引用事实必须是非 `needs_review` 的 fact_id；输出中的数字必须能在证据里逐字或等价找到）、R4（fact_id 归属当前 `candidate_id`）。违例按 T6 §7 三级降级：拒绝并回炉 / 摘除并说明 / 保留并标注。

`suggestions` 长度 ≤ 3 是 T9 §2 的可计数规则，本 schema 与 SKILL.md 约束 skill 每遍的产出上限；当前求职工具的证据校验 当前未实现该校验，落地时补。
