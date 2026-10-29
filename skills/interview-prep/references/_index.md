# interview-prep references 索引

唯一索引。引用任何条目前必须先读本文件，确认条目存在与用途。未读到的内容不得引用。

## markdown 条目（按需读）

| 条目 | 用途 | 何时读 |
|---|---|---|
| [output-schema.md](output-schema.md) | 输出契约的完整字段清单与取值约束 | 阶段 3，产出前 |
| [star-examples.md](star-examples.md) | STAR 骨架 few-shot + oversight 诚实规则（led-not-performed） | 阶段 2，写项目深挖题与故事时 |
| [debrief-template.md](debrief-template.md) | practice → debrief 飞轮模板，含诚实自评框架 | 每次练习之后 |

## 题库（question-banks/）

按 T5 许可分级存放：L4 UGC 只存人工提炼后的方法论摘要 + URL + `unverified` 标记，
**不存用户提交的面经原文**（PII + 版权）。考察维度取自岗位族参数表的 `evaluation_focus`。

| 文件 | 岗位族 | 题数 | 主要考察维度 |
|---|---|---|---|
| [question-banks/backend-sw.yaml](question-banks/backend-sw.yaml) | 软件开发-后端 | 10 | design-tradeoff / scale-awareness / failure-reasoning / depth-probe |
| [question-banks/database.yaml](question-banks/database.yaml) | 数据库 / DBA | 10 | index-reasoning / isolation-reasoning / failure-scenario / schema-tradeoff / capacity-reasoning |
| [question-banks/ai-knowledge-eng.yaml](question-banks/ai-knowledge-eng.yaml) | AI 与知识库工程 | 10 | retrieval-vs-generation / metric-choice / failure-mode-analysis / cost-latency-tradeoff / hallucination-control |

每条记录字段：`question` / `type`（behavioral / system / technical / case）/ `evaluation_points` /
`strong_answer_traits` / `common_mistakes` / `family` / `source_tier` / `license`。

## 参数表（全量加载）

字段副本，非 owner。owner：`skills/jd-analysis/references/role-profiles/`。
副本带 `source_version`，版本不匹配即报错，不静默降级。

| 文件 | 岗位族 |
|---|---|
| [role-profiles/backend-sw.yaml](role-profiles/backend-sw.yaml) | 软件开发-后端 |
| [role-profiles/database.yaml](role-profiles/database.yaml) | 数据库 / DBA |
| [role-profiles/ai-knowledge-eng.yaml](role-profiles/ai-knowledge-eng.yaml) | AI 与知识库工程 |

字段定义见 [../../_schema/role-profile-schema.md](../../_schema/role-profile-schema.md)。
本 skill 只读取其中的 `evaluation_focus` / `skill_requirements` / `critical_tasks` / `industry_params.round_structure`。
