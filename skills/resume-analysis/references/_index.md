# resume-analysis references 索引

唯一索引。引用任何条目前必须先读本文件，确认条目存在与用途。未读到的内容不得引用。

## markdown 条目（按需读）

| 条目 | 用途 | 何时读 |
|---|---|---|
| [diagnosis-rules.md](diagnosis-rules.md) | 判断细则：什么 annotation 值得提、severity 怎么定、section heading 不是事实、三桶怎么分 | 阶段 1a，产出 annotation 前 |
| [output-schema.md](output-schema.md) | 输出契约的完整字段清单与取值约束 | 阶段 2g，产出前 |

## 参数表（全量加载）

| 文件 | 岗位族 |
|---|---|
| [role-profiles/backend-sw.yaml](role-profiles/backend-sw.yaml) | 软件开发-后端 |
| [role-profiles/database.yaml](role-profiles/database.yaml) | 数据库 / DBA |
| [role-profiles/ai-knowledge-eng.yaml](role-profiles/ai-knowledge-eng.yaml) | AI 与知识库工程 |

字段定义见 [../../_schema/role-profile-schema.md](../../_schema/role-profile-schema.md)。本目录为**字段副本**，owner 在 `skills/jd-analysis/references/role-profiles/`，副本带 `source_version`；版本不匹配即报错，不静默降级。

## 不存案例

按 T8 §5，本 skill 只存诊断规则，不存简历案例——它的工作是诊断当前简历，不是比对历史案例。改写示范（原文 + 诊断 + 改写前后）归 `resume-tailoring`。诊断规则的补充只进 `diagnosis-rules.md`，不新增案例文件。
