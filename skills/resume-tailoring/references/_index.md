# resume-tailoring references 索引

唯一索引。引用任何条目前必须先读本文件，确认条目存在与用途。未读到的内容不得引用。

## markdown 条目（按需读）

| 条目 | 用途 | 何时读 |
|---|---|---|
| [rewrite-rules.md](rewrite-rules.md) | 改写判断规则：`frames[].emphasis.bullet_weight` 如何驱动 bullet 选择与排序、什么算一条 bullet 的证据、frame 是排序/措辞层不是事实层的边界 | 阶段 1a 与阶段 2g，每次改写前 |
| [output-schema.md](output-schema.md) | 输出契约的完整字段清单与取值约束 | 阶段 3，产出前 |
| [cases.md](cases.md) | 改写示范案例（few-shot）。全部 `synthetic: true`：JD 真实、候选人画像虚构；含正例与标了 R1–R4 的反例 | 阶段 2f/2g，需要示范合格证据链条或反例判据时 |

## 参数表（全量加载）

字段副本，owner 是 `skills/jd-analysis/references/role-profiles/`。副本带 `source_version`，与 owner 的 `version` 不匹配即报错，不静默降级。

| 文件 | 岗位族 |
|---|---|
| [role-profiles/backend-sw.yaml](role-profiles/backend-sw.yaml) | 软件开发-后端 |
| [role-profiles/database.yaml](role-profiles/database.yaml) | 数据库 / DBA |
| [role-profiles/ai-knowledge-eng.yaml](role-profiles/ai-knowledge-eng.yaml) | AI 与知识库工程 |

字段定义见 [../../_schema/role-profile-schema.md](../../_schema/role-profile-schema.md)。

改写实际取用的字段只有三组：`frames[].emphasis`（`project_types` / `skill_groups` / `bullet_weight`）、`frames[].deemphasis`、`evidence_forms`。其余字段由 jd-analysis 消费，本 skill 不解释其取值。

## 版本

`references/DATA_VERSION` 是本 skill 要求的最低数据集版本，运行时与 SKILL.md frontmatter 的 `requires_data` 比对；低于即明确报错（T5 §4，不静默降级）。
